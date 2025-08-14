from dataclasses import dataclass
from typing import Any, Dict, List, Union

import torch
import whisper
from transformers import (
    WhisperForConditionalGeneration,
    WhisperProcessor,
)

from ._base import ASRModelHandler

    
@dataclass
class DataCollatorSpeechSeq2SeqWithPadding:
    processor: Any
    decoder_start_token_id: int

    def __call__(self, features: List[Dict[str, Union[List[int], torch.Tensor]]]) -> Dict[str, torch.Tensor]:
        # split inputs and labels since they have to be of different lengths and need different padding methods
        # first treat the audio inputs by simply returning torch tensors
        input_features = [{"input_features": feature["input_features"]} for feature in features]
        batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")

        # get the tokenized label sequences
        label_features = [{"input_ids": feature["labels"]} for feature in features]
        # pad the labels to max length
        labels_batch = self.processor.tokenizer.pad(label_features, return_tensors="pt")

        # replace padding with -100 to ignore loss correctly
        labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)

        # if bos token is appended in previous tokenization step,
        # cut bos token here as it's append later anyways
        if (labels[:, 0] == self.decoder_start_token_id).all().cpu().item():
            labels = labels[:, 1:]

        batch["labels"] = labels

        return batch

class WhisperHandler(ASRModelHandler):
    """Handler for Whisper models."""
    @property
    def model_type(self) -> str:
        return "seq2seq" 

    def get_processor(self, model_checkpoint: str, vocab_dict: dict, **kwargs) -> WhisperProcessor:
        """Loads and returns the Whisper processor."""
        supported_languages = whisper.tokenizer.LANGUAGES

        language = kwargs.get("language", None)

        if language and language.lower() in list(supported_languages.values()):
            processor = WhisperProcessor.from_pretrained(model_checkpoint, language=language, task="transcribe")
        else:
            processor = WhisperProcessor.from_pretrained(model_checkpoint, language=None, task="transcribe")

        return processor

    def get_model(self, model_checkpoint: str, processor: WhisperProcessor, **kwargs) -> WhisperForConditionalGeneration:
        """Loads and returns the Whisper model for conditional generation."""
        model = WhisperForConditionalGeneration.from_pretrained(model_checkpoint)

        language = kwargs.get("language", None)
        supported_languages = whisper.tokenizer.LANGUAGES

        if language and language.lower() in list(supported_languages.values()):
            model.generation_config.language = language
        else:
            model.generation_config.language = None

        model.generation_config.task = "transcribe"
        model.generation_config.forced_decoder_ids = None
            
        return model

    def get_data_collator(self, processor: WhisperProcessor, model: WhisperForConditionalGeneration, **kwargs) -> DataCollatorSpeechSeq2SeqWithPadding:
        """Returns the specific data collator for Whisper."""
        return DataCollatorSpeechSeq2SeqWithPadding(processor=processor, decoder_start_token_id=model.config.decoder_start_token_id,)
    
    def prepare_dataset(self, batch: dict, processor: WhisperProcessor, **kwargs):
        """Prepares a single batch for the model."""
        audio = batch["audio"]
        batch["input_features"] = processor.feature_extractor(audio["array"], sampling_rate=audio["sampling_rate"]).input_features[0]
        batch["labels"] = processor.tokenizer(batch["normalized_text"]).input_ids
        return batch