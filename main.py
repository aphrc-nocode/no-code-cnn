# No-Code AI Platform Backend with FastAPI
# Core architecture for reusable ML pipelines with image support

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union
from enum import Enum
import asyncio
import uuid
import json
import sys
from datetime import datetime
import torch
import torchvision.transforms as transforms
from torch.utils.data import DataLoader, Dataset
import torch.nn as nn
import torch.optim as optim
from PIL import Image
import io
import numpy as np
from pathlib import Path
import logging
from mlflow_server import start_mlflow_server, get_mlflow_ui_url
import os
import mlflow
import zipfile
import shutil
import traceback
import glob
import base64

# Import pipeline base class
from pipelines.base_pipeline import BasePipeline
from pipelines.image_classification_pipeline import ImageClassificationPipeline
from pipelines.object_detection_pipeline import ObjectDetectionPipeline
from pipelines.image_segmentation_pipeline import ImageSegmentationPipeline

# Import MLflow utilities
from mlflow_utils import (
    setup_mlflow, start_run, log_metrics, log_model,
    end_run, log_batch_metrics
)

from data_loaders import create_dataloaders

# Import Responsible AI Toolkit
from responsible_ai import (
    ClassBalanceAnalyzer,
    LimeExplainer,
    ShapExplainer,
    GradCAMExplainer,
    FairnessAnalyzer,
    ModelCardGenerator,
    DataCardGenerator,
    BiasResourceLibrary
)


# ==================== Models & Schemas ====================

class TaskType(str, Enum):
    IMAGE_CLASSIFICATION = "image_classification"
    OBJECT_DETECTION = "object_detection"
    IMAGE_SEGMENTATION = "image_segmentation"
    STYLE_TRANSFER = "style_transfer"

class SegmentationType(str, Enum):
    SEMANTIC = "semantic"
    INSTANCE = "instance"

class ModelArchitecture(str, Enum):
    # Classification architectures
    RESNET18 = "resnet18"
    RESNET50 = "resnet50"
    VGG16 = "vgg16"
    EFFICIENTNET = "efficientnet"
    MOBILENET = "mobilenet"
    
    # Object detection architectures
    FASTER_RCNN = "faster_rcnn"
    SSD = "ssd"
    RETINANET = "retinanet"
    YOLO = "yolo"
    
    # Hugging Face transformer object detection architectures
    DETR_RESNET50 = "detr_resnet50"
    DETR_RESNET101 = "detr_resnet101"
    YOLOS_SMALL = "yolos_small"
    YOLOS_BASE = "yolos_base"
    OWLV2_BASE = "owlv2_base"
    
    # Segmentation architectures
    FCN = "fcn"
    DEEPLABV3 = "deeplabv3"
    MASK_RCNN = "mask_rcnn"
    UNET = "unet"
    

class TrainingStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class SegmentationType(str, Enum):
    SEMANTIC = "semantic"
    INSTANCE = "instance"

class DatasetSource(str, Enum):
    LOCAL = "local"

    

class PipelineConfig(BaseModel):
    name: str   
    task_type: TaskType
    architecture: ModelArchitecture
    num_classes: int = 10
    batch_size: int = 32
    learning_rate: float = 0.001
    epochs: int = 10
    image_size: tuple = (224, 224)
    augmentation_enabled: bool = True
    early_stopping: bool = True
    patience: int = 5  # Early stopping patience
    
    # Hugging Face specific configuration
    use_hf_transformers: bool = False
    hf_model_checkpoint: str = None  # Will be set based on architecture selection
    feature_extraction_only: bool = False
    patience: int = 5
    segmentation_type: Optional[SegmentationType] = SegmentationType.SEMANTIC
    dataset_source: Optional[DatasetSource] = DatasetSource.LOCAL

class TrainingJob(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    pipeline_config: PipelineConfig
    status: TrainingStatus = TrainingStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    metrics: Dict[str, float] = {}
    model_path: Optional[str] = None
    logs: List[str] = []    
    linked_dataset_id: Optional[str] = None  # <-- Add this field


# ==================== Pipeline Factory ====================

class PipelineFactory:
    """Factory to create appropriate pipeline based on task type"""
    
    # Define mappings from architecture enums to HF model checkpoints
    HF_MODEL_MAPPING = {
        ModelArchitecture.DETR_RESNET50: "facebook/detr-resnet-50",
        ModelArchitecture.DETR_RESNET101: "facebook/detr-resnet-101",
        ModelArchitecture.YOLOS_SMALL: "hustvl/yolos-small",
        ModelArchitecture.YOLOS_BASE: "hustvl/yolos-base",
        ModelArchitecture.OWLV2_BASE: "owlv2-base-patch16-ensemble",
    }
    
    @staticmethod
    def create_pipeline(config: PipelineConfig) -> BasePipeline:
        # Check if using a Hugging Face transformer architecture
        if config.architecture in PipelineFactory.HF_MODEL_MAPPING:
            # Set HF-specific configuration
            config.use_hf_transformers = True
            config.hf_modezzl_checkpoint = PipelineFactory.HF_MODEL_MAPPING[config.architecture]
        
        if config.task_type == TaskType.IMAGE_CLASSIFICATION:
            from pipelines.image_classification_pipeline import ImageClassificationPipeline
            return ImageClassificationPipeline(config)
        elif config.task_type == TaskType.OBJECT_DETECTION:
            from pipelines.object_detection_pipeline import ObjectDetectionPipeline
            return ObjectDetectionPipeline(config)
        elif config.task_type == TaskType.IMAGE_SEGMENTATION:
            from pipelines.image_segmentation_pipeline import ImageSegmentationPipeline
            return ImageSegmentationPipeline(config)
        else:
            raise ValueError(f"Unsupported task type: {config.task_type}")

# ==================== Utility Functions ====================

def smart_extract_zip(zip_path: Path, extract_to: Path) -> None:
    """
    Smart ZIP extraction that handles nested folder structures.
    If ZIP contains a single root folder, extracts its contents directly.
    Otherwise, extracts everything as-is.
    """
    
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        # Get list of all files/folders in the ZIP
        all_items = zip_ref.namelist()
        
        # Check if there's a common root folder
        if all_items:
            # Get the first level directories/files
            top_level_items = set()
            for item in all_items:
                # Split path and get first component
                parts = item.split('/')
                if parts[0]:  # Ignore empty strings
                    top_level_items.add(parts[0])
            
            # If there's only one top-level item and it's a directory
            if len(top_level_items) == 1:
                root_folder = list(top_level_items)[0]
                
                # Check if this root folder contains all the files
                all_in_root = all(item.startswith(root_folder + '/') or item == root_folder for item in all_items)
                
                if all_in_root:
                    # Extract to a temporary directory first
                    temp_extract = extract_to.parent / f"{extract_to.name}_temp"
                    temp_extract.mkdir(exist_ok=True)
                    
                    try:
                        # Extract everything to temp directory
                        zip_ref.extractall(temp_extract)
                        
                        # Move contents of root folder to final destination
                        root_folder_path = temp_extract / root_folder
                        if root_folder_path.exists() and root_folder_path.is_dir():
                            # Move all contents from root folder to extract_to
                            for item in root_folder_path.iterdir():
                                destination = extract_to / item.name
                                if destination.exists():
                                    if destination.is_dir():
                                        shutil.rmtree(destination)
                                    else:
                                        destination.unlink()
                                shutil.move(str(item), str(destination))
                        else:
                            # Fallback: normal extraction
                            zip_ref.extractall(extract_to)
                    finally:
                        # Clean up temp directory
                        if temp_extract.exists():
                            shutil.rmtree(temp_extract)
                    return
        
        # Normal extraction if no nested folder issue
        zip_ref.extractall(extract_to)

# ==================== Storage & Job Management ====================

class JobManager:
    """Manages training jobs and their lifecycle"""
    
    def __init__(self):
        self.jobs: Dict[str, TrainingJob] = {}
        self.running_jobs: Dict[str, asyncio.Task] = {}
        self.loaded_models: Dict[str, tuple[nn.Module, Dict]] = {}  # Cache for loaded models
        
        # Initialize MLflow
        setup_mlflow()
    
    def create_job(self, config: PipelineConfig) -> TrainingJob:
        """Create a new training job"""
        job = TrainingJob(pipeline_config=config)
        self.jobs[job.id] = job
        return job
    
    async def start_job(self, job_id: str, dataset_path: str):
        """Start a training job with the given dataset"""
        job = self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        # Ensure models directory exists
        Path("models").mkdir(exist_ok=True)
        
        # Create model directory for this job
        job_model_dir = Path(f"models/{job_id}")
        job_model_dir.mkdir(exist_ok=True)
        
        # Set job status to running
        job.status = TrainingStatus.RUNNING
        job.started_at = datetime.now()
        
        # Create pipeline for this job
        pipeline = PipelineFactory.create_pipeline(job.pipeline_config)
        
        # Start training in the background
        asyncio.create_task(self._run_training(pipeline, job_id, dataset_path))
        
        return {"message": "Training started", "job_id": job_id}
    
    async def _run_training(self, pipeline: BasePipeline, job_id: str, dataset_path: str):
        """Run the training pipeline"""
        try:
            result = await pipeline.train(dataset_path, job_id)
            
            job = self.jobs[job_id]
            job.status = TrainingStatus.COMPLETED if result["status"] == "completed" else TrainingStatus.FAILED
            job.completed_at = datetime.now()
            
            if result["status"] == "completed":
                job.model_path = result["model_path"]
                if "metrics" in result:
                    job.metrics.update(result["metrics"])
                job.logs.append(f"Training completed successfully. Model saved to {result['model_path']}")
                
                # Clear model from cache if it exists
                if job_id in self.loaded_models:
                    del self.loaded_models[job_id]
            else:
                job.logs.append(f"Training failed: {result.get('error', 'Unknown error')}")
                
        except Exception as e:
            job = self.jobs[job_id]
            job.status = TrainingStatus.FAILED
            job.completed_at = datetime.now()
            job.logs.append(f"Training failed with exception: {str(e)}")
        
        finally:
            # Clean up
            if job_id in self.running_jobs:
                del self.running_jobs[job_id]
    
    def get_job(self, job_id: str) -> Optional[TrainingJob]:
        """Get job by ID"""
        return self.jobs.get(job_id)
    
    def list_jobs(self) -> List[TrainingJob]:
        """List all jobs"""
        return list(self.jobs.values())
    
    def _load_model(self, model_path: str, pipeline_config: PipelineConfig) -> nn.Module:
        """Load a model from a saved checkpoint"""
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Try to load from MLflow if available
        try:
            import mlflow
            # Check if model is in MLflow and load from there
            try:
                # Find the run_id from the job_id (model_path contains job_id)
                job_id = Path(model_path).stem
                # Try to load model from the MLflow artifacts
                model = mlflow.pytorch.load_model(f"models:/{job_id}/production", map_location=device)
                model.eval()
                return model
            except Exception:
                # Fall back to local file if MLflow loading fails
                pass
        except ImportError:
            # MLflow not available, use local file
            pass
    
        # Create pipeline to get model architecture
        pipeline = PipelineFactory.create_pipeline(pipeline_config)
        model = pipeline.create_model()
        
        # Load saved weights from local file
        # Since this is our own checkpoint, we can safely use weights_only=False
        try:
            # First try with weights_only=True for security
            checkpoint = torch.load(model_path, map_location=device, weights_only=True)
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                model.load_state_dict(checkpoint['model_state_dict'])
            else:
                model.load_state_dict(checkpoint)
            
            model.eval()
            return model
        except Exception as e:
            # Fall back to weights_only=False since this is our own trusted checkpoint
            try:
                checkpoint = torch.load(model_path, map_location=device, weights_only=False)
                
                if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                    model.load_state_dict(checkpoint['model_state_dict'])
                else:
                    model.load_state_dict(checkpoint)
                    
                model.eval()
                return model
            except Exception as nested_e:
                raise ValueError(f"Failed to load model: {str(e)} | {str(nested_e)}")
    
    def _get_transform(self, pipeline_config: PipelineConfig) -> transforms.Compose:
        """Get the transforms for a model"""
        pipeline = PipelineFactory.create_pipeline(pipeline_config)
        return pipeline.get_transforms()
    
    def _get_class_map(self, model_path: str) -> Dict:
        """Get class mapping from saved model"""
        # Try to get class mapping from MLflow
        try:
            import mlflow
            job_id = Path(model_path).stem
            
            # Try to get class mapping from MLflow artifacts
            try:
                client = mlflow.tracking.MlflowClient()
                runs = client.search_runs(
                    experiment_ids=[mlflow.get_experiment_by_name("no-code-ml-experiments").experiment_id],
                    filter_string=f"attributes.run_name = 'job_{job_id}'"
                )
                
                if runs:
                    run_id = runs[0].info.run_id
                    artifact_path = client.download_artifacts(run_id, "class_to_idx.json")
                    
                    if artifact_path:
                        with open(artifact_path, 'r') as f:
                            import json
                            class_to_idx = json.load(f)
                            # Create a reverse mapping from index to class name
                            return {str(idx): cls for cls, idx in class_to_idx.items()}
            except Exception:
                # Fall back to local file
                pass
        except ImportError:
            # MLflow not available
            pass
            
        # Fall back to local file - use weights_only=False since this is our own checkpoint
        try:
            checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
            if isinstance(checkpoint, dict) and 'class_to_idx' in checkpoint:
                # Create a reverse mapping from index to class name
                return {str(idx): cls for cls, idx in checkpoint['class_to_idx'].items()}
        except Exception as e:
            print(f"Warning: Failed to load class mapping from {model_path}: {e}")
        return {}
    
    async def predict(self, job_id: str, image: Image.Image) -> Dict:
        """Make prediction using a trained model"""
        job = self.get_job(job_id)
        if not job or job.status != TrainingStatus.COMPLETED:
            raise ValueError("Model not ready for prediction")
            
        if not job.model_path or not Path(job.model_path).exists():
            raise ValueError(f"Model file not found: {job.model_path}")
        
        # Load model if not already in cache
        if job_id not in self.loaded_models:
            try:
                model = self._load_model(job.model_path, job.pipeline_config)
                class_map = self._get_class_map(job.model_path)
                self.loaded_models[job_id] = (model, class_map)
            except Exception as e:
                raise ValueError(f"Failed to load model: {str(e)}")
        
        model, class_map = self.loaded_models[job_id]
        
        # Create pipeline based on task type
        pipeline = PipelineFactory.create_pipeline(job.pipeline_config)
        
        # Use the pipeline's predict method to get predictions
        try:
            result = await pipeline.predict(image, model)
            print(f"Pipeline prediction result keys: {list(result.keys())}")
            
            # Process the prediction result based on task type
            if job.pipeline_config.task_type == TaskType.IMAGE_CLASSIFICATION:
                # Format the classification results - handle the actual pipeline output format
                if "predictions" in result:
                    # New format from pipeline
                    pipeline_predictions = result["predictions"]
                    formatted_predictions = []
                    
                    for pred in pipeline_predictions:
                        class_idx = pred["class_id"]
                        confidence = pred["confidence"] * 100  # Convert to percentage
                        class_name = class_map.get(str(class_idx), f"Class {class_idx}")
                        
                        formatted_predictions.append({
                            "class_id": class_idx,
                            "class_name": class_name,
                            "confidence": confidence
                        })
                    
                    return {
                        "predictions": formatted_predictions,
                        "top_prediction": formatted_predictions[0] if formatted_predictions else None,
                        "task_type": "image_classification"
                    }
                else:
                    # Fallback for old format (if any)
                    probabilities = result.get("probabilities", [])
                    predicted_classes = result.get("predicted_classes", [])
                    confidence_scores = result.get("confidence_scores", []);
                    
                    predictions = []
                    for i, (class_idx, score) in enumerate(zip(predicted_classes, confidence_scores)):
                        class_name = class_map.get(str(class_idx), f"Class {class_idx}")
                        confidence = score * 100
                        predictions.append({
                            "class_id": class_idx,
                            "class_name": class_name,
                            "confidence": confidence
                        })
                    
                    return {
                        "predictions": predictions,
                        "top_prediction": predictions[0] if predictions else None,
                        "all_probabilities": probabilities
                    }
            
            elif job.pipeline_config.task_type == TaskType.OBJECT_DETECTION:
                # Handle new format from ObjectDetectionPipeline
                if "predictions" in result:
                    # New format: result contains ['predictions', 'status', 'num_detections']
                    detections = result.get("predictions", [])
                    # detections is already in the correct format with keys: 'box', 'confidence', 'class_name', 'label'
                    
                    # Convert to the expected API format
                    formatted_detections = []
                    for detection in detections:
                        formatted_detections.append({
                            "box": detection["box"],  # [x1, y1, x2, y2]
                            "class_id": detection["label"],
                            "class_name": detection["class_name"],
                            "confidence": detection["confidence"]
                        })
                    
                    return {
                        "detections": formatted_detections,
                        "count": len(formatted_detections)
                    }
                else:
                    # Old format (fallback): result contains ['boxes', 'scores', 'labels']
                    boxes = result["boxes"]
                    scores = result["scores"]
                    labels = result["labels"]
                    
                    detections = []
                    for i, (box, score, label) in enumerate(zip(boxes, scores, labels)):
                        class_name = class_map.get(str(label), f"Class {label}")
                        confidence = score * 100
                        detections.append({
                            "box": box,  # [x1, y1, x2, y2]
                            "class_id": label,
                            "class_name": class_name,
                            "confidence": confidence
                        })
                    
                    return {
                        "detections": detections,
                        "count": len(detections)
                    }
            
            elif job.pipeline_config.task_type == TaskType.IMAGE_SEGMENTATION:
                # Format the segmentation results
                if job.pipeline_config.segmentation_type == SegmentationType.SEMANTIC:
                    # For semantic segmentation
                    segmentation_mask = result["segmentation_mask"]
                    probabilities = result.get("probabilities", [])
                    
                    # Convert class indices to class names for visualization
                    class_mapping = {int(idx): name for name, idx in class_map.items()}
                    
                    return {
                        "segmentation_mask": segmentation_mask,
                        "class_mapping": class_mapping,
                        "probabilities": probabilities
                    }
                else:
                    # For instance segmentation
                    masks = result.get("masks", [])
                    boxes = result.get("boxes", [])
                    scores = result.get("scores", [])
                    labels = result.get("labels", [])
                    
                    instances = []
                    for i, (mask, box, score, label) in enumerate(zip(masks, boxes, scores, labels)):
                        class_name = class_map.get(str(label), f"Class {label}")
                        confidence = score * 100
                        instances.append({
                            "mask": mask,
                            "box": box,
                            "class_id": label,
                            "class_name": class_name,
                            "confidence": confidence
                        })
                    
                    return {
                        "instances": instances,
                        "count": len(instances)
                    }
            else:
                return result
                
        except Exception as e:
            raise ValueError(f"Prediction failed: {str(e)}")
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job and its associated files"""
        if job_id not in self.jobs:
            return False
            
        # Stop running job if exists
        if job_id in self.running_jobs:
            self.running_jobs[job_id].cancel()
            del self.running_jobs[job_id]
        
        # Remove model from cache if loaded
        if job_id in self.loaded_models:
            del self.loaded_models[job_id]
            
        # Delete model file if exists
        job = self.jobs[job_id]
        if job.model_path and Path(job.model_path).exists():
            Path(job.model_path).unlink()
            
        # Delete dataset if exists
        dataset_path = Path(f"datasets/{job_id}")
        if dataset_path.exists():
            import shutil
            shutil.rmtree(dataset_path)
            
        # Remove from jobs dict
        del self.jobs[job_id]
        return True

# ==================== FastAPI Application ====================

app = FastAPI(title="No-Code AI Platform", version="1.0.0")

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import MLflow server utilities
from mlflow_server import (
    start_mlflow_server, stop_mlflow_server, 
    get_mlflow_ui_url, get_experiment_details
)

# Global job manager instance
job_manager = JobManager()

# ==================== API Endpoints ====================

@app.get("/")
async def root():
    return {
        "message": "No-Code AI Platform API", 
        "version": "1.0.0",
        "pytorch_version": torch.__version__,
        "gpu_available": torch.cuda.is_available()
    }

# MLflow integration endpoints
@app.post("/mlflow/start-server")
async def start_mlflow():
    """Start the MLflow UI server"""
    result = start_mlflow_server()
    return {"message": result}

@app.post("/mlflow/stop-server")
async def stop_mlflow():
    """Stop the MLflow UI server"""
    result = stop_mlflow_server()
    return {"message": result}

@app.get("/mlflow/ui-url")
async def get_ui_url():
    """Get the URL for the MLflow UI"""
    return {"url": get_mlflow_ui_url()}

@app.get("/mlflow/experiments")
async def get_experiments():
    """Get details about MLflow experiments"""
    return get_experiment_details()

@app.get("/jobs/{job_id}/mlflow")
async def get_job_mlflow_info(job_id: str):
    """Get MLflow information for a specific job"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    from mlflow_utils import EXPERIMENT_NAME
    
    try:
        experiment = mlflow.get_experiment_by_name(EXPERIMENT_NAME)
        if not experiment:
            return {"message": "No MLflow experiment found"}
        
        # Search for runs with this job ID
        client = mlflow.tracking.MlflowClient()
        runs = client.search_runs(
            experiment_ids=[experiment.experiment_id],
            filter_string=f"attributes.run_name = 'job_{job_id}'"
        )
        
        if not runs:
            return {"message": f"No MLflow runs found for job {job_id}"}
        
        run = runs[0]
        return {
            "run_id": run.info.run_id,
            "status": run.info.status,
            "start_time": run.info.start_time,
            "end_time": run.info.end_time,
            "metrics": run.data.metrics,
            "params": run.data.params,
            "mlflow_ui_url": f"{get_mlflow_ui_url()}/#/experiments/{experiment.experiment_id}/runs/{run.info.run_id}"
        }
    except Exception as e:
        return {"message": f"Error retrieving MLflow information: {str(e)}"}

@app.post("/pipelines", response_model=TrainingJob)
async def create_pipeline(config: PipelineConfig):
    """Create a new training pipeline"""
    try:
        job = job_manager.create_job(config)
        return job
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/pipelines/{job_id}/train")
async def start_training(job_id: str, background_tasks: BackgroundTasks):
    """Start training for a specific job"""
    try:
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        if not job.linked_dataset_id:
            raise HTTPException(status_code=400, detail="No dataset linked to this job. Please link a dataset first.")
        dataset_path = f"datasets/{job.linked_dataset_id}"
        result = await job_manager.start_job(job_id, dataset_path)
        return result  
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/pipelines/{job_id}", response_model=TrainingJob)
async def get_pipeline_status(job_id: str):
    """Get the status of a training job"""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/pipelines", response_model=List[TrainingJob])
async def list_pipelines():
    """List all training jobs"""
    return job_manager.list_jobs()


@app.get("/datasets/versions")
async def list_dataset_versions(
    dataset_name: Optional[str] = None,
    source: Optional[str] = None
):
    """List all dataset versions with optional filtering"""
    try:
        from dataset_versioning import DatasetVersionManager
        version_manager = DatasetVersionManager("datasets")
        
        versions = version_manager.list_dataset_versions(dataset_name, source)
        return {
            "count": len(versions),
            "versions": [v.to_dict() for v in versions]
        }
    except ImportError:
        raise HTTPException(status_code=500, detail="Dataset versioning system not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list dataset versions: {str(e)}")

@app.get("/datasets/versions/{job_id}")
async def get_dataset_version(job_id: str):
    """Get detailed information about a specific dataset version"""
    try:
        from dataset_versioning import DatasetVersionManager
        version_manager = DatasetVersionManager("datasets")
        
        version = version_manager.get_dataset_version(job_id)
        if not version:
            raise HTTPException(status_code=404, detail=f"Dataset version {job_id} not found")
        
        return version.to_dict()
    except ImportError:
        raise HTTPException(status_code=500, detail="Dataset versioning system not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dataset version: {str(e)}")

@app.delete("/datasets/{job_id}")
async def delete_dataset(job_id: str):
    """Delete a dataset and its version information"""
    try:
        from dataset_versioning import DatasetVersionManager
        version_manager = DatasetVersionManager("datasets")
        
        success = version_manager.delete_dataset(job_id)
        if not success:
            raise HTTPException(status_code=500, detail=f"Failed to delete dataset {job_id}")
        
        return {"message": f"Dataset {job_id} deleted successfully"}
    except ImportError:
        # Fall back to basic deletion if versioning is not available
        dataset_dir = Path(f"datasets/{job_id}")
        if not dataset_dir.exists():
            raise HTTPException(status_code=404, detail=f"Dataset {job_id} not found")
        
        try:
            import shutil
            shutil.rmtree(dataset_dir)
            return {"message": f"Dataset {job_id} deleted successfully"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete dataset: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete dataset: {str(e)}")

# ==================== Dataset Upload Endpoints ====================

@app.post("/upload-dataset/{job_id}/{class_name}")
async def create_dataset_class(job_id: str, class_name: str):
    """Create a class directory in the dataset folder"""
    try:
        # Create dataset class directory
        class_dir = Path(f"datasets/{job_id}/{class_name}")
        class_dir.mkdir(parents=True, exist_ok=True)
        return {"message": f"Created class directory {class_name} for job {job_id}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/upload-dataset/{job_id}")
async def upload_dataset_file(
    job_id: str,
    task_type: str = "image_classification",
    dataset_name: str = None,
    file: UploadFile = File(...),
    class_name: str = Form(None),
    file_type: str = Form("image")  # 'image', 'annotation', or 'zip'
):
    """Upload a file to the dataset folder. Supports images, annotation files, and zipped COCO datasets."""
    try:
        dataset_dir = Path(f"datasets/{job_id}")
        dataset_dir.mkdir(parents=True, exist_ok=True)
        
        # Save dataset_config.json
        config_file = dataset_dir / "dataset_config.json"
        config = {}
        if config_file.exists():
            try:
                with open(config_file, "r") as f:
                    config = json.load(f)
            except: pass
        config["task_type"] = task_type
        if dataset_name:
            config["dataset_name"] = dataset_name
        with open(config_file, "w") as f:
            json.dump(config, f)

        if file_type == "zip":
            # Save and extract zip file using smart extraction
            zip_path = dataset_dir / file.filename
            with open(zip_path, "wb") as f:
                content = await file.read()
                f.write(content)
            smart_extract_zip(zip_path, dataset_dir)
            zip_path.unlink()  # Remove zip after extraction
            return {"message": f"Extracted {file.filename} to {dataset_dir}"}

        elif file_type == "annotation" and file.filename.lower().endswith(".json"):
            # Save annotation file to annotations/ or root
            annotations_dir = dataset_dir / "annotations"
            annotations_dir.mkdir(parents=True, exist_ok=True)
            file_path = annotations_dir / file.filename
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            return {"message": f"Uploaded annotation {file.filename} to {annotations_dir}"}

        else:
            # Default: treat as image, requires class_name
            if not class_name:
                raise HTTPException(status_code=400, detail="class_name is required for image upload.")
            class_dir = dataset_dir / class_name
            class_dir.mkdir(parents=True, exist_ok=True)
            file_path = class_dir / file.filename
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            return {"message": f"Uploaded {file.filename} to {class_name} directory"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/predict/{job_id}")
async def predict(job_id: str, file: UploadFile = File(...), confidence_threshold: float = Form(0.5)):
    """Make predictions using a trained model"""
    import time
    start_time = time.time()
    
    try:
        print(f"Prediction request for job_id: {job_id}")
        print(f"Confidence threshold received: {confidence_threshold}")
        
        # Check if job exists
        job = job_manager.get_job(job_id)
        if not job:
            print(f"Job {job_id} not found")
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        print(f"Job status: {job.status}")
        print(f"Model path: {job.model_path}")
        
        if job.status != TrainingStatus.COMPLETED:
            print(f"Model not ready. Status: {job.status}")
            raise HTTPException(status_code=400, detail=f"Model not ready for prediction. Status: {job.status}")
        
        if not job.model_path:
            print("No model path found")
            raise HTTPException(status_code=400, detail="No model path found for this job")
        
        # Check if model file exists
        from pathlib import Path
        if not Path(job.model_path).exists():
            print(f"Model file not found: {job.model_path}")
            raise HTTPException(status_code=400, detail=f"Model file not found: {job.model_path}")
        
        # Load image
        print("Loading image...")
        image_data = await file.read()
        print(f"Image data size: {len(image_data)} bytes")
        
        try:
            image = Image.open(io.BytesIO(image_data))
            print(f"Image loaded: {image.size}, mode: {image.mode}")
        except Exception as img_error:
            print(f"Error loading image: {img_error}")
            raise HTTPException(status_code=400, detail=f"Invalid image file: {str(img_error)}")
        
        # Load model and make prediction
        print("Making prediction...")
        try:
            prediction_result = await job_manager.predict(job_id, image)
            print("Prediction successful")
        except Exception as pred_error:
            print(f"Prediction error: {pred_error}")
            raise HTTPException(status_code=400, detail=f"Prediction failed: {str(pred_error)}")
        
        # Add task type to the response for client-side handling
        prediction_result["task_type"] = job.pipeline_config.task_type
        if job.pipeline_config.task_type == TaskType.IMAGE_SEGMENTATION:
            prediction_result["segmentation_type"] = job.pipeline_config.segmentation_type
        
        # Calculate processing time
        processing_time = time.time() - start_time
        prediction_result["processing_time"] = processing_time
        
        # Import visualization utilities
        from visualization_utils import (
            draw_bounding_boxes, draw_segmentation_mask, 
            pil_to_base64, log_prediction_results
        )
        
        # Log prediction results
        log_prediction_results(
            job_id, 
            job.pipeline_config.task_type, 
            prediction_result, 
            processing_time
        )
        
        # Create annotated images for visualization
        if job.pipeline_config.task_type == TaskType.OBJECT_DETECTION:
            # Get detections and apply confidence filtering
            detections = prediction_result.get("detections", [])
            original_count = len(detections)
            
            if detections:
                # Filter detections based on confidence threshold
                filtered_detections = []
                for detection in detections:
                    confidence = detection.get("confidence", 0)
                    # Convert percentage to decimal if needed
                    if confidence > 1:
                        confidence = confidence / 100
                    
                    if confidence >= confidence_threshold:
                        filtered_detections.append(detection)
                
                print(f"Filtered detections: {len(filtered_detections)} from {original_count} (threshold: {confidence_threshold})")
                
                # Update the prediction result with filtered detections
                prediction_result["detections"] = filtered_detections
                
                if filtered_detections:
                    # Draw bounding boxes only for filtered detections
                    annotated_image = draw_bounding_boxes(image, filtered_detections)
                    # Convert to base64 for frontend display
                    prediction_result["annotated_image"] = pil_to_base64(annotated_image)
                    print(f"Created annotated image with {len(filtered_detections)} detections")
                else:
                    # No detections above threshold, return original image
                    prediction_result["annotated_image"] = pil_to_base64(image)
                    print("No detections above confidence threshold, returning original image")
            else:
                # No detections, return original image
                prediction_result["annotated_image"] = pil_to_base64(image)
                print("No detections found, returning original image")
                
        elif job.pipeline_config.task_type == TaskType.IMAGE_SEGMENTATION:
            # Draw segmentation mask overlay
            if job.pipeline_config.segmentation_type == SegmentationType.SEMANTIC:
                segmentation_mask = prediction_result.get("segmentation_mask")
                class_mapping = prediction_result.get("class_mapping", {})
                if segmentation_mask is not None and class_mapping:
                    annotated_image = draw_segmentation_mask(image, segmentation_mask, class_mapping)
                    prediction_result["annotated_image"] = pil_to_base64(annotated_image)
                    print("Created segmentation overlay")
                else:
                    prediction_result["annotated_image"] = pil_to_base64(image)
            else:
                # For instance segmentation, just return original for now
                # TODO: Implement instance segmentation visualization
                prediction_result["annotated_image"] = pil_to_base64(image)
                
        elif job.pipeline_config.task_type == TaskType.IMAGE_CLASSIFICATION:
            # For classification, just return the original image
            prediction_result["annotated_image"] = pil_to_base64(image)
            
        print("Returning prediction result with annotations")
        return prediction_result
    
    except HTTPException as e:
        print(f"HTTP Exception: {e.detail}")
        raise e
    except Exception as e:
        print(f"Unexpected error in prediction endpoint: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    
# ==================== Pipeline Management Endpoints ====================
@app.delete("/pipelines/{job_id}")
async def delete_pipeline(job_id: str):
    """Delete a training job and its associated resources"""
    success = job_manager.delete_job(job_id)
    if not success:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"message": f"Job {job_id} deleted successfully"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(),
        "active_jobs": len(job_manager.running_jobs)
    }

@app.get("/datasets/available")
async def list_available_datasets():
    """List all available datasets"""
    try:
        dataset_dir = Path("datasets")
        if not dataset_dir.exists():
            return []
        
        datasets = []
        for d in dataset_dir.iterdir():
            if d.is_dir():
                # Skip special directories
                if d.name.startswith('.') or d.name == '__pycache__':
                    continue
                
                # Try to determine the task type based on directory structure or content
                task_type = "image_classification"  # Default
                dataset_name_from_config = None
                
                # Check for dataset_config.json
                config_file = d / "dataset_config.json"
                if config_file.exists():
                    try:
                        with open(config_file, "r") as f:
                            config = json.load(f)
                            task_type = config.get("task_type", task_type)
                            dataset_name_from_config = config.get("dataset_name", None)
                    except: pass
                    
                is_coco_dataset = False
                
                # Check for COCO format (annotations directory or JSON files)
                annotations_dir = d / "annotations"
                if annotations_dir.exists() and annotations_dir.is_dir():
                    json_files = list(annotations_dir.glob("*.json"))
                    if json_files:
                        is_coco_dataset = True
                        task_type = "object_detection"
                
                # Also check for JSON files in the root directory that might be COCO annotations
                if not is_coco_dataset:
                    json_files = list(d.glob("*.json"))
                    for json_file in json_files:
                        try:
                            with open(json_file, 'r') as f:
                                content = json.load(f)
                                # Simple check for COCO format
                                if all(key in content for key in ["images", "annotations", "categories"]):
                                    is_coco_dataset = True
                                    task_type = "object_detection"
                                    break
                        except:
                            continue
                
                # Look for directory structure indicators
                if not is_coco_dataset and "detection" in d.name.lower():
                    task_type = "object_detection"
                elif "segmentation" in d.name.lower():
                    task_type = "image_segmentation"
                
                # Check for class directories (for classification datasets)
                classes = [c.name for c in d.iterdir() if c.is_dir() and not c.name == "annotations"]
                
                # Count items (images) in the dataset
                item_count = 0
                if is_coco_dataset:
                    # For COCO datasets, count all images in the dataset recursively
                    image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif']
                    for ext in image_extensions:
                        found_images = list(d.glob(f"**/*{ext}"))
                        item_count += len(found_images)
                    
                    # If still 0, try a more comprehensive search (might be slower but more reliable)
                    if item_count == 0:
                        import glob
                        for ext in image_extensions:
                            found_images = glob.glob(str(d) + f"/**/*{ext}", recursive=True)
                            item_count += len(found_images)
                    
                    # Print debug info
                    print(f"Found {item_count} images in COCO dataset: {d.name}")
                    
                    # Try to get class names from the COCO annotations
                    if not classes:
                        # Use either json_files from annotations dir or the ones found in root
                        coco_jsons = json_files if json_files else list(d.glob("**/*.json"))
                        for json_file in coco_jsons:
                            try:
                                with open(json_file, 'r') as f:
                                    content = json.load(f)
                                    if "categories" in content:
                                        classes = [cat["name"] for cat in content["categories"]]
                                        print(f"Found {len(classes)} classes in COCO dataset: {d.name}")
                                        break
                            except Exception as e:
                                print(f"Error parsing JSON {json_file}: {str(e)}")
                                continue
                else:
                    # For classification datasets, count by class
                    if classes:
                        image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif']
                        for cls in classes:
                            class_path = d / cls
                            image_files = [f for f in class_path.iterdir() 
                                        if f.is_file() and any(f.name.lower().endswith(ext) for ext in image_extensions)]
                            item_count += len(image_files)
                
                # Skip empty datasets - for COCO datasets, we don't require classes to be detected
                if not is_coco_dataset and not classes:
                    continue
                
                # For COCO datasets with no detected images, skip as well
                if is_coco_dataset and item_count == 0:
                    print(f"Skipping COCO dataset with no images: {d.name}")
                    continue
                
                datasets.append({
                    "id": d.name,
                    "name": dataset_name_from_config if dataset_name_from_config else d.name.replace('_', ' ').title(),
                    "classes": classes if classes else ["(COCO format dataset)"],
                    "task_type": task_type,
                    "item_count": item_count,
                    "is_coco_format": is_coco_dataset
                })
        
        return datasets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing datasets: {str(e)}")

from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()
DATASETS_DIR = BASE_DIR / "datasets"

@app.post("/pipelines/{job_id}/dataset/{dataset_id}")
async def link_dataset_to_job(job_id: str, dataset_id: str):
    try:
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        dataset_path = DATASETS_DIR / dataset_id
        print(f"Linking dataset: {dataset_id}")
        print(f"Dataset path: {dataset_path}")
        print(f"Dataset path exists: {dataset_path.exists()}")
        print(f"Dataset path is directory: {dataset_path.is_dir() if dataset_path.exists() else False}")
        
        all_datasets = [d.name for d in DATASETS_DIR.iterdir() if d.is_dir()]
        print(f"Available datasets: {all_datasets}")
        
        if not dataset_path.exists() or not dataset_path.is_dir():
            raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
        
        job.linked_dataset_id = dataset_id
        return {"message": f"Successfully linked dataset {dataset_id} to job {job_id}"}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to link dataset: {str(e)}")

@app.post("/upload-detection-dataset/{job_id}")
async def upload_detection_dataset(job_id: str, task_type: str = "object_detection", dataset_name: str = None, file: UploadFile = File(...)):
    """
    Upload a COCO format object detection dataset as a zip file.
    The zip file should contain the images and annotations in the COCO format structure.
    The entire structure is preserved when extracting.
    """
    try:
        dataset_dir = Path(f"datasets/{job_id}")
        dataset_dir.mkdir(parents=True, exist_ok=True)
        
        # Save dataset_config.json
        config_file = dataset_dir / "dataset_config.json"
        config = {}
        if config_file.exists():
            try:
                with open(config_file, "r") as f:
                    config = json.load(f)
            except: pass
        config["task_type"] = task_type
        if dataset_name:
            config["dataset_name"] = dataset_name
        with open(config_file, "w") as f:
            json.dump(config, f)
        
        # Verify that the uploaded file is a zip file
        if not file.filename.lower().endswith(('.zip')):
            raise HTTPException(status_code=400, detail="Only ZIP files are supported for object detection datasets")
        
        # Save the zip file temporarily
        zip_path = dataset_dir / file.filename
        with open(zip_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        # Extract the zip file using smart extraction to avoid nested folders
        smart_extract_zip(zip_path, dataset_dir)
        
        # Delete the temporary zip file
        zip_path.unlink()
        
        return {
            "message": f"Object detection dataset uploaded and extracted successfully to {dataset_dir}",
            "dataset_id": job_id,
            "task_type": "object_detection"
        }
    except Exception as e:
        # If something goes wrong, delete any partial files
        if dataset_dir.exists():
            import shutil
            try:
                if zip_path.exists():
                    zip_path.unlink()
            except:
                pass
        raise HTTPException(status_code=400, detail=f"Failed to process dataset: {str(e)}")


# ==================== Responsible AI Toolkit Endpoints ====================

class ClassBalanceRequest(BaseModel):
    dataset_id: Optional[str] = None
    labels: Optional[List[int]] = None
    class_names: Optional[List[str]] = None

@app.post("/responsible-ai/class-balance")
async def analyze_class_balance(request: ClassBalanceRequest):
    """Analyze class balance in dataset. Accepts either a dataset_id (auto-extracts labels) or raw labels."""
    try:
        labels = None
        class_names = request.class_names

        # Clean dataset_id input
        dataset_id = request.dataset_id.strip() if request.dataset_id else None

        if dataset_id:
            # Auto-extract labels from dataset directory structure
            dataset_path = Path(f"datasets/{dataset_id}")
            if not dataset_path.exists() or not dataset_path.is_dir():
                raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

            image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'}
            
            # Check for dataset_config.json
            config_file = dataset_path / "dataset_config.json"
            task_type = "image_classification"
            if config_file.exists():
                try:
                    with open(config_file, "r") as f:
                        config = json.load(f)
                        task_type = config.get("task_type", task_type)
                except: pass

            if task_type == "semantic_segmentation":
                raise HTTPException(status_code=400, detail="Class balance analysis for semantic segmentation datasets is not directly supported via folder structure.")

            # Detect if dataset follows object detection structure
            is_coco = False
            json_files = []
            
            # Check for standard COCO structure
            ann_dir = dataset_path / "annotations"
            if ann_dir.is_dir():
                json_files = list(ann_dir.glob("*.json"))
            
            # If no JSON in annotations, check root for JSON
            if not json_files:
                json_files = list(dataset_path.glob("*.json"))
            
            # Validate JSON if found
            for jf in json_files:
                try:
                    with open(jf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if all(k in data for k in ["images", "annotations", "categories"]):
                            is_coco = True
                            target_json = data
                            break
                except:
                    continue

            if is_coco:
                extracted_class_names = [cat.get("name", str(i)) for i, cat in enumerate(target_json["categories"])]
                extracted_labels = [ann.get("category_id") for ann in target_json["annotations"] if "category_id" in ann]
                if not extracted_labels:
                    raise HTTPException(status_code=400, detail="No labels found in COCO annotation file.")
                labels = np.array(extracted_labels)
                if class_names is None:
                    class_names = extracted_class_names
                print(f"Extracted {len(labels)} labels from COCO annotations in dataset {dataset_id}")
            else:
                # Fallback to classification folder structure
                class_dirs = sorted([
                    d for d in dataset_path.iterdir()
                    if d.is_dir() and d.name not in ('annotations', '__pycache__') and not d.name.startswith('.')
                ])
                if not class_dirs:
                    raise HTTPException(status_code=400, detail="No valid dataset structure found.")
                
                extracted_labels = []
                extracted_class_names = []
                for class_idx, class_dir in enumerate(class_dirs):
                    extracted_class_names.append(class_dir.name)
                    image_count = sum(1 for f in class_dir.iterdir() if f.is_file() and f.suffix.lower() in image_extensions)
                    extracted_labels.extend([class_idx] * image_count)
                
                if not extracted_labels:
                    raise HTTPException(status_code=400, detail="No images found in dataset.")
                labels = np.array(extracted_labels)
                if class_names is None:
                    class_names = extracted_class_names

        elif request.labels is not None:
            labels = np.array(request.labels)
        else:
            raise HTTPException(status_code=400, detail="Either 'dataset_id' or 'labels' must be provided.")

        # Manual distribution calculation to avoid NumPy objects
        # Count occurrences of each label
        unique, counts = np.unique(labels, return_counts=True)
        # Build distribution dict mapping class name or index to count
        distribution = {}
        for idx, cnt in zip(unique, counts):
            # COCO category IDs are often 1-indexed; adjust if class_names length matches max label
            if class_names:
                if max(labels) == len(class_names):
                    # Assume labels are 1-indexed
                    name_idx = int(idx) - 1
                else:
                    name_idx = int(idx)
                name = class_names[name_idx] if 0 <= name_idx < len(class_names) else str(int(idx))
            else:
                name = str(int(idx))
            distribution[name] = int(cnt)
        # Simple recommendations placeholder (could be extended)
        recommendations = {"message": "Manual distribution computed"}
        # Generate a simple report string
        report = f"Class distribution: {distribution}"

        # Build response and ensure everything is JSON‑serializable
        response = {
            "distribution": distribution,
            "recommendations": recommendations,
            "report": report,
        }
        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Class balance analysis failed: {str(e)}")

class FairnessAnalysisRequest(BaseModel):
    y_true: List[int]
    y_pred: List[int]
    subgroup_labels: List[int]
    privileged_group: int = 0

@app.post("/responsible-ai/fairness-analysis")
async def analyze_fairness(request: FairnessAnalysisRequest):
    """Analyze fairness across subgroups"""
    try:
        analyzer = FairnessAnalyzer()
        y_true = np.array(request.y_true)
        y_pred = np.array(request.y_pred)
        subgroup_labels = np.array(request.subgroup_labels)
        
        subgroup_metrics = analyzer.analyze_subgroup_performance(y_true, y_pred, subgroup_labels)
        fairness_metrics = analyzer.calculate_fairness_metrics(y_true, y_pred, subgroup_labels, request.privileged_group)
        demographic_parity = analyzer.calculate_demographic_parity(y_pred, subgroup_labels)
        equalized_odds = analyzer.calculate_equalized_odds(y_true, y_pred, subgroup_labels)
        
        return {
            "subgroup_metrics": subgroup_metrics,
            "fairness_metrics": fairness_metrics,
            "demographic_parity": demographic_parity,
            "equalized_odds": equalized_odds,
            "report": analyzer.generate_fairness_report(),
            "mitigation_strategies": analyzer.get_mitigation_strategies()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fairness analysis failed: {str(e)}")

class ModelCardRequest(BaseModel):
    model_name: str
    model_architecture: str
    dataset_name: str
    training_metrics: Dict[str, float]
    fairness_results: Optional[Dict[str, Any]] = None

@app.post("/responsible-ai/generate-model-card")
async def generate_model_card(request: ModelCardRequest):
    """Generate a model card with responsible AI information"""
    try:
        generator = ModelCardGenerator()
        generator.auto_populate_from_training(
            model_name=request.model_name,
            model_architecture=request.model_architecture,
            dataset_name=request.dataset_name,
            training_metrics=request.training_metrics,
            fairness_results=request.fairness_results
        )
        
        model_card = generator.generate_model_card()
        json_card = generator.generate_json_model_card()
        
        return {
            "model_card_markdown": model_card,
            "model_card_json": json_card
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model card generation failed: {str(e)}")

@app.get("/responsible-ai/bias-types")
async def get_bias_types():
    """Get information about different types of bias"""
    try:
        library = BiasResourceLibrary()
        return {"bias_types": library.bias_types}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve bias types: {str(e)}")

@app.get("/responsible-ai/bias-examples")
async def get_bias_examples(domain: Optional[str] = None):
    """Get real-world bias examples"""
    try:
        library = BiasResourceLibrary()
        examples = library.get_bias_examples(domain)
        return {"bias_examples": examples}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve bias examples: {str(e)}")

@app.get("/responsible-ai/mitigation-strategies")
async def get_mitigation_strategies(stage: Optional[str] = None):
    """Get bias mitigation strategies"""
    try:
        library = BiasResourceLibrary()
        strategies = library.get_mitigation_strategies(stage)
        return {"mitigation_strategies": strategies}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve mitigation strategies: {str(e)}")

@app.get("/responsible-ai/checklist")
async def get_bias_checklist(category: Optional[str] = None):
    """Get bias detection and mitigation checklist"""
    try:
        library = BiasResourceLibrary()
        checklist = library.get_checklist(category)
        return {"checklist": checklist}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve checklist: {str(e)}")

@app.post("/responsible-ai/bias-report")
async def generate_bias_report(detected_biases: List[str]):
    """Generate a comprehensive bias report"""
    try:
        library = BiasResourceLibrary()
        report = library.generate_bias_report(detected_biases)
        return {"bias_report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate bias report: {str(e)}")

@app.get("/responsible-ai/search")
async def search_bias_info(query: str):
    """Search bias information by keyword"""
    try:
        library = BiasResourceLibrary()
        results = library.search_bias_info(query)
        return {"search_results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@app.post("/responsible-ai/dataset-validation/{dataset_id}")
async def validate_dataset(dataset_id: str):
    """Validate dataset and generate a Data Card with visual statistics."""
    try:
        from visualization_utils import create_class_distribution_plot, pil_to_base64, draw_bounding_boxes
        dataset_path = Path(f"datasets/{dataset_id}")
        if not dataset_path.exists() or not dataset_path.is_dir():
            raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

        # Load config
        config_file = dataset_path / "dataset_config.json"
        task_type = "image_classification"
        dataset_name = dataset_path.name
        if config_file.exists():
            try:
                with open(config_file, "r") as f:
                    config = json.load(f)
                    task_type = config.get("task_type", task_type)
                    dataset_name = config.get("dataset_name", dataset_name)
            except: pass

        image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'}
        missing_data = []
        invalid_labels = []
        data_anomalies = []
        class_distribution = {}
        sample_images = []

        is_coco = (task_type in ["object_detection", "instance_segmentation"])

        if is_coco:
            # Load COCO annotations - look in annotations/, root, or recursively (e.g. train/valid/test folders)
            json_files = []
            ann_dir = dataset_path / "annotations"
            if ann_dir.is_dir():
                json_files = list(ann_dir.glob("*.json"))
            
            if not json_files:
                json_files = list(dataset_path.glob("**/*.json"))
                
            # Filter out dataset_config.json
            json_files = [jf for jf in json_files if jf.name != "dataset_config.json"]

            target_json = None
            target_json_path = None
            for jf in json_files:
                try:
                    with open(jf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if all(k in data for k in ["images", "annotations", "categories"]):
                            target_json = data
                            target_json_path = jf
                            break
                except: continue

            if target_json:
                cat_id_to_name = {cat["id"]: cat.get("name", str(cat["id"])) for cat in target_json["categories"]}
                image_id_to_file = {img["id"]: img["file_name"] for img in target_json["images"]}
                
                # Distribution
                for ann in target_json["annotations"]:
                    cat_id = ann.get("category_id")
                    if cat_id in cat_id_to_name:
                        cname = cat_id_to_name[cat_id]
                        class_distribution[cname] = class_distribution.get(cname, 0) + 1
                    else:
                        invalid_labels.append(f"Annotation with unknown category_id: {cat_id}")

                # Sample images with boxes
                sampled_classes = set()
                for img_info in target_json["images"]:
                    if len(sampled_classes) >= len(cat_id_to_name): break
                    img_id = img_info["id"]
                    file_name = img_info["file_name"]
                    
                    # Find if this image has an annotation of a class we haven't sampled yet
                    anns_for_img = [a for a in target_json["annotations"] if a.get("image_id") == img_id]
                    if not anns_for_img: continue
                    
                    cat_id = anns_for_img[0].get("category_id")
                    cname = cat_id_to_name.get(cat_id, "Unknown")
                    
                    if cname not in sampled_classes:
                        # Try finding the image:
                        # 1. Relative to the JSON directory (common for train/test splits inside folders)
                        # 2. Directly in the dataset folder
                        # 3. In the images/ folder
                        img_file_path = None
                        possible_paths = []
                        if target_json_path:
                            possible_paths.append(target_json_path.parent / file_name)
                        possible_paths.append(dataset_path / file_name)
                        possible_paths.append(dataset_path / "images" / file_name)
                        
                        for p in possible_paths:
                            if p.exists():
                                img_file_path = p
                                break
                                
                        if img_file_path is not None:
                            try:
                                pil_img = Image.open(img_file_path).convert("RGB")
                                detections = []
                                for a in anns_for_img:
                                    if "bbox" in a:
                                        x, y, w, h = a["bbox"]
                                        c_id = a.get("category_id")
                                        c_n = cat_id_to_name.get(c_id, "Unknown")
                                        detections.append({
                                            "box": [x, y, x+w, y+h],
                                            "class_name": c_n,
                                            "confidence": 100.0
                                        })
                                if detections:
                                    pil_img = draw_bounding_boxes(pil_img, detections)
                                    
                                # Resize for frontend display
                                pil_img.thumbnail((400, 400))
                                b64_img = pil_to_base64(pil_img, format="JPEG")
                                sample_images.append({
                                    "class_name": cname,
                                    "image_base64": b64_img
                                })
                                sampled_classes.add(cname)
                            except Exception as e:
                                data_anomalies.append(f"Failed to load/annotate image {file_name}: {str(e)}")
                        else:
                            missing_data.append(f"Image referenced in annotations not found: {file_name}")

            else:
                missing_data.append("Could not find a valid COCO annotation JSON file.")

        else:
            # Classification folder structure
            classes = [d.name for d in dataset_path.iterdir() if d.is_dir() and not d.name.startswith('.')]
            if not classes:
                missing_data.append("No class folders found in dataset directory.")
            else:
                for c in classes:
                    c_path = dataset_path / c
                    images = [f for f in c_path.iterdir() if f.is_file() and f.suffix.lower() in image_extensions]
                    class_distribution[c] = len(images)
                    if len(images) == 0:
                        missing_data.append(f"Class folder '{c}' is empty.")
                    else:
                        # Grab 1 sample image
                        try:
                            pil_img = Image.open(images[0]).convert("RGB")
                            pil_img.thumbnail((400, 400))
                            b64_img = pil_to_base64(pil_img, format="JPEG")
                            sample_images.append({
                                "class_name": c,
                                "image_base64": b64_img
                            })
                        except Exception as e:
                            data_anomalies.append(f"Corrupted image in class '{c}': {images[0].name}")

        total_samples = sum(class_distribution.values())
        num_classes = len(class_distribution)

        # Balance check
        is_balanced = True
        balance_ratio = 1.0
        if num_classes > 0 and total_samples > 0:
            counts = list(class_distribution.values())
            max_c = max(counts)
            min_c = min(counts)
            if min_c == 0:
                is_balanced = False
                balance_ratio = 0.0
            else:
                balance_ratio = min_c / max_c
                if balance_ratio < 0.5:
                    is_balanced = False

        # Generate Data Card
        generator = DataCardGenerator()
        generator.set_dataset_overview(
            dataset_name=dataset_name,
            task_type=task_type,
            total_samples=total_samples,
            num_classes=num_classes,
            format_type="COCO" if is_coco else "Folder Structure"
        )
        generator.set_validation_summary(
            missing_data=missing_data,
            invalid_labels=invalid_labels,
            data_anomalies=data_anomalies,
            is_balanced=is_balanced,
            balance_ratio=balance_ratio
        )
        generator.set_class_distribution(class_distribution)
        
        considerations = [
            "Am I using a representative dataset? (Ensure your dataset is sampled in a way that represents your users.)",
            "Is there real-world / human bias in my data? (Consider historical biases that might be present in labels.)",
            "Data validation helps mitigate missing features or wrongly assigned labels."
        ]
        generator.set_fairness_considerations(considerations)
        generator.set_intended_use(f"Training for {task_type}")
        
        data_card_md = generator.generate_data_card()

        # Distribution plot base64
        dist_plot_b64 = None
        if class_distribution:
            try:
                plot_path = create_class_distribution_plot(class_distribution, title=f"{dataset_name} Distribution")
                with open(plot_path, "rb") as f:
                    dist_plot_b64 = base64.b64encode(f.read()).decode()
            except: pass

        return {
            "status": "success",
            "data_card_markdown": data_card_md,
            "distribution_plot_base64": dist_plot_b64,
            "sample_images": sample_images
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

