# asr_train.py

import argparse
import os
import random
import json
from functools import partial

import datasets
import evaluate
import numpy as np
import torch
import wandb
from datasets import Audio, DatasetDict, load_dataset, concatenate_datasets
from transformers import (
    EarlyStoppingCallback, 
    Trainer,
    Seq2SeqTrainer,
    TrainingArguments,
    Seq2SeqTrainingArguments,
    TrainerCallback 
)
from asr_utils.factory import get_model_handler
from asr_utils.metrics import compute_ctc_metrics_fn, compute_seq2seq_metrics_fn
from asr_utils.utils import (
    add_duration_column, 
    find_problematic_audio_files, 
    random_split, 
    split_hf_dataset,
    process_prepared_speech_dataset, 
    create_vocabulary_from_data
)

class JSONMetricsCallback(TrainerCallback):
    def __init__(self, output_dir, metrics_filename="training_metrics.json"):
        super().__init__()
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.metrics_file = os.path.join(output_dir, metrics_filename)

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs is not None:
            if any(k.startswith("eval_") for k in logs.keys()):
                with open(self.metrics_file, "a") as f:
                    f.write(json.dumps(logs) + "\n")

def get_args():
    parser = argparse.ArgumentParser(description="Train an ASR model.")
    parser.add_argument("--metrics_filename", type=str, default="training_metrics.json")
    parser.add_argument("--model_output_root", type=str, default="model_outputs")
    parser.add_argument("--data_dir", type=str, required=True)
    parser.add_argument("--model_checkpoint", type=str, required=True)
    parser.add_argument("--run_name", type=str, default="asr-finetune")
    parser.add_argument("--version", type=str, default="1.0.0")
    parser.add_argument("--language_code", type=str, default="eng")
    parser.add_argument("--language", type=str, default="english")
    parser.add_argument("--num_proc", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--speaker_id_column", type=str, default=None)
    parser.add_argument("--text_column", type=str, default="sentence")
    parser.add_argument("--target_sampling_rate", type=int, default=16_000)
    parser.add_argument("--min_duration_s", type=float, default=1.0)
    parser.add_argument("--max_duration_s", type=float, default=30.0)
    parser.add_argument("--min_transcript_len", type=int, default=10)
    parser.add_argument("--max_transcript_len", type=int, default=300)
    parser.add_argument("--apply_outlier_filtering", action="store_true")
    parser.add_argument("--outlier_std_devs", type=float, default=2.0)
    parser.add_argument("--is_presplit", action="store_true")
    parser.add_argument("--speaker_disjointness", action="store_true", help="Ensure speaker disjointness in splits.")
    parser.add_argument("--train_ratio", type=float, default=0.8)
    parser.add_argument("--dev_ratio", type=float, default=0.1)
    parser.add_argument("--test_ratio", type=float, default=0.1)
    parser.add_argument("--epochs", type=float, default=5.0)
    parser.add_argument("--learning_rate", type=float, default=3e-4)
    parser.add_argument("--lr_scheduler_type", type=str, default="linear")
    parser.add_argument("--warmup_ratio", type=float, default=0.1)
    parser.add_argument("--train_batch_size", type=int, default=16)
    parser.add_argument("--eval_batch_size", type=int, default=16)
    parser.add_argument("--gradient_accumulation_steps", type=int, default=1)
    parser.add_argument("--gradient_checkpointing", action="store_true", help="Enable gradient checkpointing to save memory.")
    parser.add_argument("--optimizer", type=str, default="adamw_torch")
    parser.add_argument("--early_stopping_patience", type=int, default=5)
    parser.add_argument("--early_stopping_threshold", type=float, default=1e-3)
    parser.add_argument("--hub_user_id", type=str, default="")
    parser.add_argument("--push_to_hub", action="store_true")
    parser.add_argument("--hub_private_repo", action="store_true")
    parser.add_argument("--log_to_wandb", action="store_true")
    parser.add_argument("--wandb_project", type=str, default=None)
    parser.add_argument("--wandb_entity", type=str, default=None)
    return parser.parse_args()

def main():
    args = get_args()
    
    output_dir = os.path.join(args.model_output_root, f"{args.model_checkpoint.split('/')[-1].replace('/','-')}-{args.run_name}-{args.version}")
    os.makedirs(output_dir, exist_ok=True)

    if args.push_to_hub and args.hub_user_id:
        hub_model_id = os.path.join(args.hub_user_id, f"{args.model_checkpoint.split('/')[-1].replace('/','-')}-{args.run_name}-{args.version}")
    else:
        hub_model_id = None


    AUDIO_COLUMN = "audio"
    DURATION_COLUMN = "duration"
    NORMALIZED_TEXT_COLUMN = "normalized_text"
    
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    datasets.utils.logging.set_verbosity_error()
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    
    model_handler = get_model_handler(args.model_checkpoint)
    model_type = model_handler.model_type
    
    try:
        # --- MODIFIED: Restructured data loading and cleaning logic ---
        print("1. Loading dataset from audio folder...")
        dataset = load_dataset("audiofolder", data_dir=args.data_dir, num_proc=args.num_proc)
        dataset = dataset.cast_column(AUDIO_COLUMN, Audio(sampling_rate=args.target_sampling_rate))
        
        print("\n2. Checking for and removing problematic audio files...")
        for split in dataset.keys():
            print(f"  - Checking split: {split}")
            problematic_files = find_problematic_audio_files(dataset[split], audio_column=AUDIO_COLUMN, verbose=False)
            if problematic_files:
                print(f"  - Found {len(problematic_files)} problematic files in '{split}'. Removing them.")
                indices_to_remove = {item["index"] for item in problematic_files}
                indices_to_keep = [i for i, _ in enumerate(dataset[split]) if i not in indices_to_remove]
                dataset[split] = dataset[split].select(indices_to_keep)

        if len(concatenate_datasets(list(dataset.values()))) == 0:
            raise ValueError("Dataset is empty after removing problematic files.")

        print("\n3. Adding duration column...")
        dataset = add_duration_column(dataset, num_proc=args.num_proc, audio_column=AUDIO_COLUMN, duration_column=DURATION_COLUMN)
        
        if not args.is_presplit:
            print("\n4. Performing new train/validation/test split...")
            # Combine all splits first to ensure all speakers are considered
            combined_dataset = concatenate_datasets(list(dataset.values()))

            if args.speaker_id_column and args.speaker_disjointness:
                train, dev, test = split_hf_dataset(
                    dataset=combined_dataset,
                    speaker_id_col=args.speaker_id_column,
                    duration_col=DURATION_COLUMN,
                    train_ratio=args.train_ratio,
                    dev_ratio=args.dev_ratio,
                    test_ratio=args.test_ratio,
                    random_seed=args.seed,
                    num_proc=args.num_proc,
                )
            else:
                train, dev, test = random_split(
                    combined_dataset,
                    train_ratio=args.train_ratio,
                    dev_ratio=args.dev_ratio,
                    random_seed=args.seed,
                )
            dataset = DatasetDict({"train": train, "validation": dev, "test": test})
        
        print("\n5. Filtering and normalizing dataset...")
        dataset = process_prepared_speech_dataset(
            input_dataset=dataset, 
            text_column=args.text_column, 
            normalized_text_column=NORMALIZED_TEXT_COLUMN, 
            duration_column=DURATION_COLUMN, 
            min_duration_s=args.min_duration_s, 
            max_duration_s=args.max_duration_s, 
            min_transcript_len=args.min_transcript_len, 
            max_transcript_len=args.max_transcript_len, 
            outlier_std_devs=args.outlier_std_devs, 
            apply_outlier_filtering=args.apply_outlier_filtering, 
            num_proc=args.num_proc,
        )
    except Exception as e:
        raise RuntimeError(f"Critical error processing dataset: {e}") from e


    # Create vocab first, but processor will be saved later
    vocab_dict = create_vocabulary_from_data(dataset, NORMALIZED_TEXT_COLUMN)
    # The initial vocab.json is written to the main output_dir
    vocab_path = os.path.join(output_dir, "vocab.json")
    processor_kwargs = {
        "language": args.language,
        "language_code": args.language_code,
        "vocab_file_path": vocab_path 
    }
    processor = model_handler.get_processor(args.model_checkpoint, vocab_dict, **processor_kwargs)
    
    prepare_fn = partial(model_handler.prepare_dataset, processor=processor)
    dataset = dataset.map(prepare_fn, remove_columns=next(iter(dataset.values())).column_names, num_proc=args.num_proc, desc="Preparing dataset")

    model = model_handler.get_model(args.model_checkpoint, processor)
    data_collator = model_handler.get_data_collator(processor, model)
    wer_metric = evaluate.load("wer")
    cer_metric = evaluate.load("cer")
    compute_metrics = compute_ctc_metrics_fn(processor, wer_metric, cer_metric) if model_type == "ctc" else compute_seq2seq_metrics_fn(processor, wer_metric, cer_metric)
    
    if args.log_to_wandb:
        wandb.init(project=args.wandb_project, entity=args.wandb_entity, name=args.run_name)
    else:
        wandb.init(mode="disabled")

    json_metrics_callback = JSONMetricsCallback(output_dir=output_dir, metrics_filename=args.metrics_filename)
    early_stopping_callback = EarlyStoppingCallback(early_stopping_patience=args.early_stopping_patience, early_stopping_threshold=args.early_stopping_threshold)
    callbacks = [json_metrics_callback, early_stopping_callback]

    training_args_class = Seq2SeqTrainingArguments if model_type == "seq2seq" else TrainingArguments
    training_args = training_args_class(
        output_dir=output_dir,
        per_device_train_batch_size=args.train_batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        eval_strategy="epoch",
        logging_strategy="epoch",
        save_strategy="epoch",
        num_train_epochs=args.epochs,
        gradient_checkpointing=args.gradient_checkpointing,
        fp16=torch.cuda.is_available(),
        learning_rate=args.learning_rate,
        lr_scheduler_type=args.lr_scheduler_type,
        warmup_ratio=args.warmup_ratio,
        save_total_limit=1,
        load_best_model_at_end=True,
        metric_for_best_model="wer",
        greater_is_better=False,
        optim='adamw_torch',
        push_to_hub=args.push_to_hub,
        hub_model_id=hub_model_id,
        hub_private_repo=args.hub_private_repo,
        dataloader_num_workers=args.num_proc,
        report_to="wandb" if args.log_to_wandb and wandb.run else "none",
        remove_unused_columns=False,
        **(dict(group_by_length=True) if model_type == "ctc" else dict(predict_with_generate=True, generation_max_length=225))
    )

    trainer_class = Seq2SeqTrainer if model_type == "seq2seq" else Trainer
    trainer = trainer_class(
        model=model,
        args=training_args,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        processing_class=processor.feature_extractor,
        callbacks=callbacks
    )

    trainer.train()

    processor.save_pretrained(output_dir)

    if args.push_to_hub:
        trainer.push_to_hub(commit_message="End of training")

    results = trainer.evaluate(eval_dataset=dataset["test"], metric_key_prefix="test")
    
    with open(json_metrics_callback.metrics_file, "a") as f:
        f.write(json.dumps(results) + "\n")

    print("\n--- Pipeline Finished ---")

if __name__ == "__main__":
    main()