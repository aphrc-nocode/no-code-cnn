import json
import os
from typing import Dict, Union, List
import torch
from dataclasses import dataclass

from transformers import (
    SeamlessM4TFeatureExtractor,
    Wav2Vec2BertForCTC,
    Wav2Vec2BertProcessor,
    Wav2Vec2CTCTokenizer,
)

from ._base import ASRModelHandler

@dataclass
class DataCollatorCTCWithPadding:
    processor: Wav2Vec2BertProcessor
    padding: Union[bool, str] = True

    def __call__(self, features: List[Dict[str, Union[List[int], torch.Tensor]]]) -> Dict[str, torch.Tensor]:
        input_features = [{"input_features": feature["input_features"]} for feature in features]
        label_features = [{"input_ids": feature["labels"]} for feature in features]

        batch = self.processor.pad(input_features=input_features, padding=self.padding, return_tensors="pt")
        labels_batch = self.processor.pad(labels=label_features, padding=self.padding, return_tensors="pt")
        
        labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)
        batch["labels"] = labels
        return batch


class Wav2Vec2BertHandler(ASRModelHandler):
    """Handler for Wav2Vec2-BERT models."""
    @property
    def model_type(self) -> str:
        return "ctc"

    def get_processor(self, model_checkpoint: str, vocab_dict: dict, **kwargs) -> Wav2Vec2BertProcessor:
        """Loads and returns the Wav2Vec2-BERT processor."""
        vocab_file_path = kwargs.get("vocab_file_path", "./vocab.json")
        
        # Create vocab if it doesn't exist
        if not os.path.exists(vocab_file_path):
            vocab_dir = os.path.dirname(vocab_file_path)
            if vocab_dir and not os.path.exists(vocab_dir):
                os.makedirs(vocab_dir, exist_ok=True)

            with open(vocab_file_path, "w", encoding="utf-8") as vocab_file:
                json.dump(vocab_dict, vocab_file)

        tokenizer = Wav2Vec2CTCTokenizer.from_pretrained(
            os.path.dirname(vocab_file_path) if os.path.dirname(vocab_file_path) else "./",
            unk_token="[UNK]",
            pad_token="[PAD]",
            word_delimiter_token="|",
        )
        
        feature_extractor = SeamlessM4TFeatureExtractor.from_pretrained(model_checkpoint)
        return Wav2Vec2BertProcessor(feature_extractor=feature_extractor, tokenizer=tokenizer)

    def get_model(self, model_checkpoint: str, processor: Wav2Vec2BertProcessor, **kwargs) -> Wav2Vec2BertForCTC:
        """Loads and returns the Wav2Vec2-BERT model."""

        model = Wav2Vec2BertForCTC.from_pretrained(
            model_checkpoint,
            attention_dropout=0.0,
            hidden_dropout=0.0,
            feat_proj_dropout=0.0,
            mask_time_prob=0.0,
            layerdrop=0.0,
            ctc_loss_reduction="mean",
            add_adapter=True,
            pad_token_id=processor.tokenizer.pad_token_id,
            vocab_size=len(processor.tokenizer),
            ignore_mismatched_sizes=True,
        )

        return model

    def get_data_collator(self, processor: Wav2Vec2BertProcessor, model: Wav2Vec2BertForCTC, **kwargs) -> DataCollatorCTCWithPadding:
        """Returns the data collator for Wav2Vec2-BERT."""
        return DataCollatorCTCWithPadding(processor=processor, padding=True)
    
    def prepare_dataset(self, batch: dict, processor: Wav2Vec2BertProcessor, **kwargs):
        """Prepares a single batch for the model."""
        audio = batch["audio"]
        batch["input_features"] = processor(audio["array"], sampling_rate=audio["sampling_rate"]).input_features[0]
        batch["input_length"] = len(batch["input_features"])
        batch["labels"] = processor(text=batch["normalized_text"]).input_ids
        return batch