# object_detection_train.py

import os
import argparse
import json
import sys
import subprocess
from functools import partial
import wandb
import datasets

from transformers import TrainingArguments, Trainer, TrainerCallback, EarlyStoppingCallback
from object_detection_utils.data_utils import augment_and_transform_batch, filter_invalid_objects_coco
from object_detection_utils.augmentations import get_train_transform, get_validation_transform
from object_detection_utils.model_utils import load_model, load_image_processor, collate_fn
from object_detection_utils.metrics import compute_metrics

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

def main(args):
    """Main function to run the training and evaluation."""
    
    # --- MODIFIED: New data loading and preprocessing logic ---
    if not os.path.exists(args.processed_data_dir) or args.force_preprocess:
        print("Processed dataset not found or reprocessing forced.")
        print("Running preprocessing script...")
        
        preprocess_script_path = os.path.join(
            os.path.dirname(__file__), "object_detection_utils", "preprocess_data.py"
        )
        
        subprocess.run([
            sys.executable, preprocess_script_path,
            "--raw_data_dir", args.data_dir,
            "--processed_data_dir", args.processed_data_dir
        ], check=True)
    else:
        print(f"Found existing processed dataset at {args.processed_data_dir}")

    print("Loading processed dataset from disk...")
    dataset = datasets.load_from_disk(args.processed_data_dir)
    
    if not args.log_to_wandb:
        wandb.init(mode="disabled")
    else:
        wandb.init(project=args.wandb_project, entity=args.wandb_entity, name=args.run_name)

    output_dir = os.path.join(args.model_output_root, f"{args.model_checkpoint.split('/')[-1]}-{args.run_name}-{args.version}")
    
    if args.push_to_hub and args.hub_user_id:
        hub_model_id = f"{args.hub_user_id}/{os.path.basename(output_dir)}"
    else:
        hub_model_id = None

    dataset = dataset.map(filter_invalid_objects_coco, num_proc=args.num_proc)

    categories = dataset["train"].features["objects"].feature["category"].names
    id2label = {i: name for i, name in enumerate(categories)}
    label2id = {v: k for k, v in id2label.items()}
    
    image_processor = load_image_processor(args.model_checkpoint, args.max_image_size)
    model = load_model(args.model_checkpoint, id2label, label2id)

    train_transform = get_train_transform(args.max_image_size)
    val_transform = get_validation_transform()
    
    train_transform_batch = partial(augment_and_transform_batch, transform=train_transform, image_processor=image_processor)
    validation_transform_batch = partial(augment_and_transform_batch, transform=val_transform, image_processor=image_processor)

    dataset["train"] = dataset["train"].with_transform(train_transform_batch)
    dataset["validation"] = dataset["validation"].with_transform(validation_transform_batch)
    test_dataset = dataset["test"].with_transform(validation_transform_batch)

    eval_compute_metrics_fn = partial(compute_metrics, image_processor=image_processor, id2label=id2label)
    
    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=args.train_batch_size,
        per_device_eval_batch_size=args.eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        gradient_checkpointing=args.gradient_checkpointing,
        num_train_epochs=args.epochs,
        fp16=args.fp16,
        logging_strategy="epoch",
        save_strategy="epoch",
        eval_strategy="epoch",
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        optim='adamw_torch',
        save_total_limit=1,
        metric_for_best_model="eval_map",
        greater_is_better=True,
        load_best_model_at_end=True,
        remove_unused_columns=False,
        eval_do_concat_batches=False,
        dataloader_num_workers=args.num_proc,
        seed=args.seed,
        push_to_hub=args.push_to_hub,
        hub_model_id=hub_model_id
    )
    
    json_metrics_callback = JSONMetricsCallback(output_dir=output_dir, metrics_filename=args.metrics_filename)
    early_stopping_callback = EarlyStoppingCallback(
        early_stopping_patience=args.early_stopping_patience,
        early_stopping_threshold=args.early_stopping_threshold
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        data_collator=collate_fn,
        compute_metrics=eval_compute_metrics_fn,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        tokenizer=image_processor,
        callbacks=[json_metrics_callback, early_stopping_callback]
    )

    trainer.train()

    image_processor.save_pretrained(output_dir)

    if args.push_to_hub:
        trainer.push_to_hub()

    test_metrics = trainer.evaluate(eval_dataset=test_dataset, metric_key_prefix="test")
    
    with open(json_metrics_callback.metrics_file, "a") as f:
        f.write(json.dumps(test_metrics) + "\n")

    print("\n--- Training and Evaluation Complete ---")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train an object detection model.")
    
    parser.add_argument("--data_dir", type=str, required=True, help="Path to the RAW data directory (from unzipped file).")
    parser.add_argument("--processed_data_dir", type=str, required=True, help="Path to store/load the processed Arrow dataset.")
    parser.add_argument("--force_preprocess", action="store_true", help="Force reprocessing of the dataset even if it exists.")
    parser.add_argument("--metrics_filename", type=str, default="training_metrics.json")
    parser.add_argument("--model_output_root", type=str, default="model_outputs")
    parser.add_argument("--model_checkpoint", type=str, default="facebook/detr-resnet-50")
    parser.add_argument("--run_name", type=str, default="detr-finetune")
    parser.add_argument("--version", type=str, default="0.0")
    parser.add_argument("--max_image_size", type=int, default=600)
    parser.add_argument("--train_batch_size", type=int, default=8)
    parser.add_argument("--eval_batch_size", type=int, default=8)
    parser.add_argument("--gradient_accumulation_steps", type=int, default=1)
    parser.add_argument("--gradient_checkpointing", action="store_true")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--learning_rate", type=float, default=5e-5)
    parser.add_argument("--weight_decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--num_proc", type=int, default=4)
    parser.add_argument("--fp16", action="store_true")
    parser.add_argument("--push_to_hub", action="store_true")
    parser.add_argument("--hub_user_id", type=str, default=None)
    parser.add_argument("--log_to_wandb", action="store_true")
    parser.add_argument("--wandb_project", type=str, default=None)
    parser.add_argument("--wandb_entity", type=str, default=None)
    parser.add_argument("--early_stopping_patience", type=int, default=5)
    parser.add_argument("--early_stopping_threshold", type=float, default=0.0)
    args = parser.parse_args()
    main(args)