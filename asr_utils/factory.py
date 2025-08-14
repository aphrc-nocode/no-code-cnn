# asr_utils/factory.py

from .models._wav2vec2_bert import Wav2Vec2BertHandler
from .models._xlsr import XLSRHandler
from .models._whisper import WhisperHandler

def get_model_handler(model_checkpoint: str):
    """
    Factory function to get the appropriate model handler based on the model checkpoint.
    """
    if "w2v-bert-2.0" in model_checkpoint:
        print("Identified Wav2Vec2-BERT model. Using Wav2Vec2BertHandler.")
        return Wav2Vec2BertHandler()
    elif "xls-r" in model_checkpoint.lower():
        print("Identified XLS-R model. Using XLSRHandler.")
        return XLSRHandler()
    elif "whisper" in model_checkpoint.lower():
        print("Identified Whisper model. Using WhisperHandler.")
        return WhisperHandler()
    else:
        # Default to Wav2Vec2-BERT or raise an error
        print(f"Could not identify model type from checkpoint '{model_checkpoint}'. Defaulting to Wav2Vec2BertHandler.")
        return Wav2Vec2BertHandler()

