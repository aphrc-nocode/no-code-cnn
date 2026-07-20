"""
Base pipeline interface for all computer vision tasks.
"""
import torch
import torch.nn as nn
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, Tuple
from pathlib import Path
import os
import mlflow

class BasePipeline(ABC):
    """Base class for all ML pipelines"""
    
    def __init__(self, config):
        self.config = config
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.run_id = None

    def load_parent_weights(self, model: nn.Module) -> nn.Module:
        parent_model_id = getattr(self.config, "parent_model_id", None)
        if not parent_model_id:
            return model
            
        project_id = getattr(self.config, "project_id", "default")
        # Standardized path: logs/projects/{project_id}/models/{parent_model_id}/model.pth
        parent_path = Path("logs/projects") / project_id / "models" / parent_model_id / "model.pth"
        if not parent_path.exists():
            # Legacy fallbacks
            parent_path = Path("logs/models") / parent_model_id / "final_model.pth"
            if not parent_path.exists():
                parent_path = Path("logs/models") / f"{parent_model_id}.pth"
        
        if parent_path.exists():
            print(f"Inheriting weights from parent model: {parent_path}")
            try:
                checkpoint = torch.load(parent_path, map_location=self.device)
                
                # Check for model_state_dict key
                if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                    state_dict = checkpoint['model_state_dict']
                else:
                    state_dict = checkpoint
                
                # Load weights into the model
                model_state = model.state_dict()
                
                # Filter out keys with size mismatch (e.g. final classifier layer)
                filtered_state = {}
                for k, v in state_dict.items():
                    if k in model_state:
                        if v.size() == model_state[k].size():
                            filtered_state[k] = v
                        else:
                            print(f"Skipping key {k} due to size mismatch: parent {v.size()} vs current {model_state[k].size()}")
                    else:
                        # Try module. prefixes (saved from DataParallel)
                        clean_k = k.replace("module.", "")
                        if clean_k in model_state and v.size() == model_state[clean_k].size():
                            filtered_state[clean_k] = v
                
                model_state.update(filtered_state)
                model.load_state_dict(model_state, strict=False)
                print(f"Successfully loaded {len(filtered_state)} weights from parent model.")
            except Exception as e:
                print(f"Error loading parent model weights: {e}")
        else:
            print(f"Parent model weights not found at: {parent_path}")
        return model
    
    @abstractmethod
    async def train(self, dataset_path: str, job_id: str) -> Dict[str, Any]:
        """Train a model on the given dataset and return metrics"""
        pass
    
    @abstractmethod
    def create_model(self) -> nn.Module:
        """Create a model based on the configuration"""
        pass
    
    @abstractmethod
    def get_transforms(self):
        """Get transforms for the input data"""
        pass
    
    @abstractmethod
    async def predict(self, image, model=None) -> Dict[str, Any]:
        """Make a prediction using the trained model"""
        pass
    
    @abstractmethod
    async def evaluate(self, dataset_path: str) -> Dict[str, Any]:
        """Evaluate the model on a test dataset"""
        pass
    
    @staticmethod
    @abstractmethod
    def get_metrics() -> List[str]:
        """Get the list of metrics supported by this pipeline"""
        pass
