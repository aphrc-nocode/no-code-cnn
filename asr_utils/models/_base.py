from abc import ABC, abstractmethod
from typing import Any

from transformers import AutoModel, AutoConfig, AutoProcessor, AutoTokenizer

class ASRModelHandler(ABC):
    """Abstract base class for ASR model handlers."""

    @property
    @abstractmethod
    def model_type(self) -> str:
        """Returns the model type, e.g., 'ctc' or 'seq2seq'."""
        pass

    @abstractmethod
    def get_processor(self, model_checkpoint: str, vocab_dict: dict, **kwargs) -> AutoProcessor:
        """Loads and returns the processor for the model."""
        pass

    @abstractmethod
    def get_model(self, model_checkpoint: str, processor: AutoProcessor, **kwargs) -> AutoModel:
        """Loads and returns the model for fine-tuning."""
        pass

    @abstractmethod
    def get_data_collator(self, processor: AutoProcessor, model: AutoModel, **kwargs) -> Any:
        """Returns the data collator for the model."""
        pass
