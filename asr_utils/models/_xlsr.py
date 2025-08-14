from dataclasses import dataclass
from typing import Union, List, Dict
import torch
import os
import json

from transformers import (
    Wav2Vec2FeatureExtractor,
    Wav2Vec2ForCTC,
    Wav2Vec2Processor,
    Wav2Vec2CTCTokenizer,
)

from ._base import ASRModelHandler


@dataclass
class DataCollatorCTCWithPadding:
    processor: Wav2Vec2Processor
    padding: Union[bool, str] = True

    def __call__(self, features: List[Dict[str, Union[List[int], torch.Tensor]]]) -> Dict[str, torch.Tensor]:
        input_features = [{"input_values": feature["input_values"]} for feature in features]
        label_features = [{"input_ids": feature["labels"]} for feature in features]

        batch = self.processor.pad(input_features=input_features, padding=self.padding, return_tensors="pt")
        labels_batch = self.processor.pad(labels=label_features, padding=self.padding, return_tensors="pt")
        
        labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)
        batch["labels"] = labels
        return batch

class XLSRHandler(ASRModelHandler):
    """Handler for XLS-R based models (e.g., wav2vec2-xls-r-300m)."""
    @property
    def model_type(self) -> str:
        return "ctc"

    def get_processor(self, model_checkpoint: str, vocab_dict: dict, **kwargs) -> Wav2Vec2Processor:
        """Loads and returns the Wav2Vec2 processor."""
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
        
        feature_extractor = Wav2Vec2FeatureExtractor(feature_size=1, sampling_rate=16000, padding_value=0.0, do_normalize=True, return_attention_mask=True)
        return Wav2Vec2Processor(feature_extractor=feature_extractor, tokenizer=tokenizer)

    def get_model(self, model_checkpoint: str, processor: Wav2Vec2Processor, **kwargs) -> Wav2Vec2ForCTC:
        """Loads and returns the Wav2Vec2 model."""
        model = Wav2Vec2ForCTC.from_pretrained(
            model_checkpoint,
            attention_dropout=0.0,
            hidden_dropout=0.0,
            feat_proj_dropout=0.0,
            mask_time_prob=0.05,
            layerdrop=0.0,
            ctc_loss_reduction="mean",
            pad_token_id=processor.tokenizer.pad_token_id,
            vocab_size=len(processor.tokenizer),
        )

        model.freeze_feature_encoder()

        return model

    def get_data_collator(self, processor: Wav2Vec2Processor, model: Wav2Vec2ForCTC, **kwargs) -> DataCollatorCTCWithPadding:
        """Returns the data collator for CTC-based models."""
        return DataCollatorCTCWithPadding(processor=processor, padding=True)
    
    def prepare_dataset(self, batch: dict, processor: Wav2Vec2Processor, **kwargs):
        """Prepares a single batch for the model."""
        audio = batch["audio"]
        batch["input_values"] = processor(audio["array"], sampling_rate=audio["sampling_rate"]).input_values[0]
        batch["input_length"] = len(batch["input_values"])
        batch["labels"] = processor(text=batch["normalized_text"]).input_ids
        return batch
