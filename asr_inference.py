# asr_inference.py

import argparse
import torch
from transformers import pipeline
import warnings
import os
import sys

def run_asr_inference(model_checkpoint: str, audio_path: str):
    """
    Runs ASR inference on a single audio file and prints the transcription.
    
    Args:
        model_checkpoint (str): Path to the fine-tuned model checkpoint.
        audio_path (str): Path to the input audio file.
    """
    try:
        warnings.filterwarnings("ignore", message="Passing `forced_decoder_ids` an empty list is deprecated")

        device = 0 if torch.cuda.is_available() else -1
        
        # --- REVERTED: Load the entire pipeline directly from the checkpoint path ---
        # This now works because all necessary files are in the same directory.
        asr_pipeline = pipeline(
            "automatic-speech-recognition",
            model=model_checkpoint,
            device=device
        )
        
        print(f"Running ASR inference on {audio_path}", file=sys.stderr)
        
        result = asr_pipeline(audio_path)
        
        transcription = result.get("text", "Transcription not found.")
        
        # Print the transcription directly to stdout for the API to capture
        print(transcription)

    except Exception as e:
        print(f"Error during ASR inference: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run ASR inference on an audio file.")
    parser.add_argument("--model_checkpoint", type=str, required=True, help="Path to the trained ASR model checkpoint.")
    parser.add_argument("--audio_path", type=str, required=True, help="Path to the input audio file.")
    
    args = parser.parse_args()
    
    run_asr_inference(
        model_checkpoint=args.model_checkpoint,
        audio_path=args.audio_path
    )