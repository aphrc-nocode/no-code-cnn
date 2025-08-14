# asr_utils/models/__init__.py
# Makes the model handlers importable within the package.
from ._base import ASRModelHandler
from ._wav2vec2_bert import Wav2Vec2BertHandler
from ._xlsr import XLSRHandler
from ._whisper import WhisperHandler