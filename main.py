# No-Code AI Platform Backend with FastAPI
# Core architecture for reusable ML pipelines with image support
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form, Depends, APIRouter, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from auth import (
    get_current_user, get_current_approved_user, get_admin_user,
    User, UserResponse, create_access_token, verify_password,
    hash_password, user_manager
)

from typing import List, Dict, Any, Optional, Union
from enum import Enum
import asyncio
import uuid
import json
import sys
from datetime import datetime
import torch
torch.set_num_threads(2)
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
from enum import Enum

import minio_utils

DATASETS_BUCKET = os.getenv("MINIO_DATASETS_BUCKET", "datasets")
MODELS_BUCKET = os.getenv("MINIO_MODELS_BUCKET", "models")
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
from project_manager import Project, project_manager
from mlflow_utils import (
    setup_mlflow, start_run, log_metrics, log_model,
    end_run, log_batch_metrics
)

from data_loaders import create_dataloaders

# Import Responsible AI Toolkit
from responsible_ai import (
    ClassBalanceAnalyzer,
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
    project_id: Optional[str] = "default"
    task_type: TaskType
    architecture: Union[ModelArchitecture, str]
    num_classes: int = 10
    batch_size: int = 32
    learning_rate: float = 0.001
    epochs: int = 10
    image_size: tuple = (224, 224)
    augmentation_enabled: bool = True
    augmentation_types: Optional[List[str]] = ["horizontal_flip", "vertical_flip", "random_rotation", "color_jitter"]
    early_stopping: bool = True
    patience: int = 5  # Early stopping patience
    parent_model_id: Optional[str] = None  # <-- Added for weights inheritance
    
    # Hugging Face specific configuration
    use_hf_transformers: bool = False
    hf_model_checkpoint: Optional[str] = None  # Will be set based on architecture selection
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
    metrics: Dict[str, Any] = {}
    model_path: Optional[str] = None
    logs: List[str] = []    
    linked_dataset_id: Optional[str] = None  # <-- Add this field
    history: List[Dict[str, Any]] = []  # <-- Store epoch-by-epoch training metrics


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
            config.hf_model_checkpoint = PipelineFactory.HF_MODEL_MAPPING[config.architecture]
        
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
        self.max_concurrent_jobs = int(os.getenv("MAX_CONCURRENT_JOBS", "1"))
        self.queue: List[tuple[str, str]] = []  # Queue of (job_id, dataset_path)
        
        # Initialize MLflow
        setup_mlflow()
        
        # Recover jobs from completed checkpoints
        self._recover_jobs()
        
    def save_job_metadata(self, job: TrainingJob):
        """Save job metadata locally and upload to MinIO"""
        try:
            project_id = getattr(job.pipeline_config, "project_id", "default")
            job_dir = Path("logs/projects") / project_id / "models" / job.id
            job_dir.mkdir(parents=True, exist_ok=True)
            meta_file = job_dir / "job_metadata.json"
            
            # Serialize using Pydantic's JSON generator
            job_json = job.json()
            with open(meta_file, "w") as f:
                f.write(job_json)
                
            # Upload to MinIO
            minio_utils.upload_file(MODELS_BUCKET, f"{job.id}/job_metadata.json", str(meta_file))
        except Exception as e:
            print(f"Warning: Failed to save job metadata for {job.id}: {e}")

    def _recover_jobs(self):
        """Recover all training job metadata dynamically and exclusively from MinIO S3 object storage."""
        try:
            client = minio_utils.get_minio_client()
            if not client.bucket_exists(MODELS_BUCKET):
                print(f"MinIO bucket '{MODELS_BUCKET}' does not exist yet. No jobs recovered.")
                return

            objects = client.list_objects(MODELS_BUCKET, recursive=True)
            recovered_count = 0
            for obj in objects:
                if obj.object_name.endswith("job_metadata.json"):
                    parts = obj.object_name.split("/")
                    job_id = parts[0] if len(parts) >= 2 else obj.object_name.replace("/job_metadata.json", "")
                    
                    if job_id in self.jobs:
                        continue
                    
                    # Fetch object metadata directly into memory from MinIO
                    try:
                        response = client.get_object(MODELS_BUCKET, obj.object_name)
                        try:
                            job_data = json.loads(response.read().decode('utf-8'))
                        finally:
                            response.close()
                            response.release_conn()

                        # Reconstruct datetimes from ISO strings
                        if job_data.get("created_at") and isinstance(job_data["created_at"], str):
                            job_data["created_at"] = datetime.fromisoformat(job_data["created_at"])
                        if job_data.get("started_at") and isinstance(job_data["started_at"], str):
                            job_data["started_at"] = datetime.fromisoformat(job_data["started_at"])
                        if job_data.get("completed_at") and isinstance(job_data["completed_at"], str):
                            job_data["completed_at"] = datetime.fromisoformat(job_data["completed_at"])

                        job = TrainingJob(**job_data)
                        self.jobs[job.id] = job
                        recovered_count += 1
                    except Exception as parse_err:
                        print(f"Error parsing job metadata for object '{obj.object_name}' from MinIO: {parse_err}")
            
            print(f"Pure MinIO Recovery: Successfully recovered {recovered_count} jobs dynamically from MinIO bucket '{MODELS_BUCKET}'. Total active jobs: {len(self.jobs)}.")
        except Exception as e:
            print(f"Warning: Failed to recover jobs from MinIO: {e}")
    
    def create_job(self, config: PipelineConfig) -> TrainingJob:
        """Create a new training job"""
        job = TrainingJob(pipeline_config=config)
        self.jobs[job.id] = job
        self.save_job_metadata(job)
        return job
    
    async def start_job(self, job_id: str, dataset_path: str):
        """Start a training job with the given dataset, or queue it if worker slots are full"""
        job = self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")
        
        # Ensure dataset is local by lazy downloading from MinIO
        local_dataset_path = Path(dataset_path)
        if not local_dataset_path.exists() or not local_dataset_path.is_dir() or not any(local_dataset_path.iterdir() if local_dataset_path.exists() else []):
            dataset_id = local_dataset_path.name
            if minio_utils.exists(DATASETS_BUCKET, dataset_id):
                print(f"Dataset '{dataset_id}' not found locally for training. Downloading from MinIO...")
                minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(local_dataset_path))
            else:
                raise ValueError(f"Dataset '{dataset_id}' does not exist locally or in MinIO")

        # Check if job is already running
        if job_id in self.running_jobs:
            return {"message": "Job is already running", "job_id": job_id, "status": str(job.status)}

        # Check if job is already queued
        if any(item[0] == job_id for item in self.queue):
            return {"message": "Job is already queued", "job_id": job_id, "status": "pending"}

        # Check if we have active slots
        if len(self.running_jobs) >= self.max_concurrent_jobs:
            job.status = TrainingStatus.PENDING
            job.logs.append(f"Job queued (Position: {len(self.queue) + 1}). Waiting for active training run to finish...")
            self.save_job_metadata(job)
            self.queue.append((job_id, dataset_path))
            print(f"Job {job_id} queued with status PENDING. Currently running: {list(self.running_jobs.keys())}. Queue size: {len(self.queue)}")
            return {"message": "Training queued", "job_id": job_id, "status": "pending"}

        # Ensure models directory exists
        models_base_dir = Path(os.getenv("MODELS_DIR", "logs/models"))
        models_base_dir.mkdir(parents=True, exist_ok=True)
        
        # Create model directory for this job
        job_model_dir = models_base_dir / job_id
        job_model_dir.mkdir(exist_ok=True)
        
        # Set job status to running
        job.status = TrainingStatus.RUNNING
        job.started_at = datetime.now()
        job.logs.append("Acquired active worker slot. Starting training pipeline...")
        self.save_job_metadata(job)
        
        # Create pipeline for this job
        pipeline = PipelineFactory.create_pipeline(job.pipeline_config)
        
        # Start training in the background
        task = asyncio.create_task(self._run_training(pipeline, job_id, dataset_path))
        self.running_jobs[job_id] = task
        
        return {"message": "Training started", "job_id": job_id, "status": "running"}
    
    async def _run_training(self, pipeline: BasePipeline, job_id: str, dataset_path: str):
        """Run the training pipeline"""
        # Yield control immediately to allow uvicorn to send the response to the client
        await asyncio.sleep(0.2)
        try:
            result = await pipeline.train(dataset_path, job_id)
            
            job = self.jobs[job_id]
            job.status = TrainingStatus.COMPLETED if result["status"] == "completed" else TrainingStatus.FAILED
            job.completed_at = datetime.now()
            
            if result["status"] == "completed":
                job.model_path = result["model_path"]
                if "metrics" in result:
                    if isinstance(result["metrics"], dict):
                        job.metrics.update(result["metrics"])
                    elif isinstance(result["metrics"], list) and result["metrics"]:
                        # For object detection, save the final epoch's metrics as the job final metrics
                        job.metrics.update(result["metrics"][-1])
                        
                # Update history
                if "history" in result:
                    job.history = result["history"]
                elif "metrics" in result and isinstance(result["metrics"], list):
                    job.history = result["metrics"]
                    
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
            # Save final job state & upload to MinIO
            job = self.jobs.get(job_id)
            if job:
                self.save_job_metadata(job)
                # If training completed successfully, sync local model folder to MinIO
                if job.status == TrainingStatus.COMPLETED:
                    try:
                        if job.model_path and Path(job.model_path).exists():
                            local_job_model_dir = Path(job.model_path).parent
                        else:
                            models_base_dir = Path(os.getenv("MODELS_DIR", "logs/models"))
                            local_job_model_dir = models_base_dir / job_id
                        
                        if local_job_model_dir.exists():
                            minio_utils.upload_directory(MODELS_BUCKET, job_id, str(local_job_model_dir))
                            print(f"Synced model directory for {job_id} to MinIO")
                    except Exception as e:
                        print(f"Warning: Failed to sync model directory to MinIO for {job_id}: {e}")
            
            # Start the next job in the queue
            self._trigger_next_job()
            
    def _trigger_next_job(self):
        """Trigger the next queued job if concurrency slot is available"""
        if len(self.running_jobs) < self.max_concurrent_jobs and self.queue:
            next_job_id, next_dataset_path = self.queue.pop(0)
            print(f"Acquired slot for queued job {next_job_id}. Starting...")
            asyncio.create_task(self._run_queued_job(next_job_id, next_dataset_path))

    async def _run_queued_job(self, job_id: str, dataset_path: str):
        """Start the training loop for a queued job"""
        job = self.get_job(job_id)
        if not job:
            return
        
        # Ensure models directory exists
        models_base_dir = Path(os.getenv("MODELS_DIR", "logs/models"))
        models_base_dir.mkdir(parents=True, exist_ok=True)
        
        # Create model directory for this job
        job_model_dir = models_base_dir / job_id
        job_model_dir.mkdir(exist_ok=True)
        
        # Set job status to running
        job.status = TrainingStatus.RUNNING
        job.started_at = datetime.now()
        job.logs.append("Acquired active worker slot. Starting training pipeline...")
        self.save_job_metadata(job)
        
        # Create pipeline for this job
        pipeline = PipelineFactory.create_pipeline(job.pipeline_config)
        
        # Start training in the background
        task = asyncio.create_task(self._run_training(pipeline, job_id, dataset_path))
        self.running_jobs[job_id] = task
    
    def get_job(self, job_id: str) -> Optional[TrainingJob]:
        """Get job by ID"""
        return self.jobs.get(job_id)
    
    def list_jobs(self) -> List[TrainingJob]:
        """List all jobs"""
        return list(self.jobs.values())
    
    def _load_model(self, model_path: str, pipeline_config: PipelineConfig) -> nn.Module:
        """Load a model from a saved checkpoint"""
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Lazy download model from MinIO if local file doesn't exist
        if model_path and not Path(model_path).exists():
            job_id = Path(model_path).parent.name
            local_dir = Path(model_path).parent
            local_dir.mkdir(parents=True, exist_ok=True)
            print(f"Local model path '{model_path}' not found. Downloading model files for job '{job_id}' from MinIO...")
            try:
                if minio_utils.exists(MODELS_BUCKET, f"{job_id}/model.pth"):
                    minio_utils.download_file(MODELS_BUCKET, f"{job_id}/model.pth", str(model_path))
                    print(f"Downloaded model.pth for job {job_id} from MinIO")
                elif minio_utils.exists(MODELS_BUCKET, job_id):
                    minio_utils.download_directory(MODELS_BUCKET, job_id, str(local_dir))
                    print(f"Downloaded model directory for job {job_id} from MinIO")
            except Exception as dl_err:
                print(f"Warning: MinIO model download error: {dl_err}")

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
    
        # Try to read configuration from local file checkpoint to align config properties (like num_classes)
        if Path(model_path).exists():
            try:
                # Load with weights_only=False just for config dictionary extraction
                checkpoint = torch.load(model_path, map_location="cpu", weights_only=False)
                if isinstance(checkpoint, dict) and 'config' in checkpoint:
                    chk_config = checkpoint['config']
                    if isinstance(chk_config, dict):
                        for k, v in chk_config.items():
                            if hasattr(pipeline_config, k):
                                setattr(pipeline_config, k, v)
                    elif hasattr(chk_config, 'num_classes'):
                        pipeline_config.num_classes = chk_config.num_classes
                        if hasattr(chk_config, 'architecture'):
                            pipeline_config.architecture = chk_config.architecture
            except Exception as e:
                print(f"Warning: Failed to preload config from checkpoint: {e}")

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
        # Lazy download model from MinIO if local file doesn't exist
        if model_path and not Path(model_path).exists():
            job_id = Path(model_path).parent.name
            if minio_utils.exists(MODELS_BUCKET, job_id):
                print(f"Local model path '{model_path}' not found for class map. Downloading from MinIO...")
                local_dir = Path(model_path).parent
                minio_utils.download_directory(MODELS_BUCKET, job_id, str(local_dir))

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
            if isinstance(checkpoint, dict):
                if 'class_to_idx' in checkpoint:
                    # Create a reverse mapping from index to class name
                    return {str(idx): cls for cls, idx in checkpoint['class_to_idx'].items()}
                elif 'config' in checkpoint and isinstance(checkpoint['config'], dict) and 'class_names' in checkpoint['config']:
                    class_names = checkpoint['config']['class_names']
                    return {str(idx): cls for idx, cls in enumerate(class_names)}
        except Exception as e:
            print(f"Warning: Failed to load class mapping from {model_path}: {e}")
        return {}
    
    async def predict(self, job_id: str, image: Image.Image) -> Dict:
        """Make prediction using a trained model"""
        job = self.get_job(job_id)
        if not job or job.status != TrainingStatus.COMPLETED:
            raise ValueError("Model not ready for prediction")
            
        # Check and download model from MinIO if missing locally
        if job.model_path and not Path(job.model_path).exists():
            if minio_utils.exists(MODELS_BUCKET, job_id):
                print(f"Model file '{job.model_path}' not found locally. Downloading from MinIO...")
                local_dir = Path(job.model_path).parent
                minio_utils.download_directory(MODELS_BUCKET, job_id, str(local_dir))

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
                project = project_manager.get_project(job.pipeline_config.project_id) if hasattr(job.pipeline_config, 'project_id') else None
                project_classes = list(project.classes) if (project and project.classes) else list(getattr(job.pipeline_config, 'class_names', []))

                # Check linked dataset config if project_classes is missing
                if not project_classes and job.linked_dataset_id:
                    ds_config_path = Path("datasets") / job.linked_dataset_id / "dataset_config.json"
                    if ds_config_path.exists():
                        try:
                            with open(ds_config_path, "r") as f:
                                ds_conf = json.load(f)
                            project_classes = ds_conf.get("classes", [])
                        except Exception:
                            pass
                            
                # Check class_map from loaded checkpoint if project_classes is missing
                if not project_classes and class_map:
                    project_classes = list(class_map.values())

                if "predictions" in result:
                    detections = result.get("predictions", [])
                    formatted_detections = []
                    for detection in detections:
                        raw_label = detection.get("label", 0)
                        raw_name = detection.get("class_name", "")
                        mapped_idx = max(0, raw_label - 1) if raw_label > 0 else 0
                        
                        actual_name = ""
                        if raw_name and not raw_name.lower().startswith("class_") and raw_name.lower() not in ("background", "bg", "dataset"):
                            actual_name = raw_name
                        elif project_classes:
                            # Filter out generic terms from project_classes
                            valid_p_classes = [c for c in project_classes if not c.lower().startswith("class_") and c.lower() not in ("background", "bg", "dataset")]
                            if valid_p_classes:
                                if len(valid_p_classes) == 1:
                                    actual_name = valid_p_classes[0]
                                elif mapped_idx < len(valid_p_classes):
                                    actual_name = valid_p_classes[mapped_idx]
                                elif raw_label < len(valid_p_classes):
                                    actual_name = valid_p_classes[raw_label]
                                else:
                                    actual_name = valid_p_classes[0]
                                    
                        if not actual_name:
                            if raw_name and raw_name.lower().startswith("class_"):
                                parts = raw_name.split("_")
                                num_str = parts[-1] if len(parts) > 1 else str(raw_label)
                                actual_name = f"Object {num_str}"
                            else:
                                actual_name = raw_name or f"Object {raw_label or 1}"

                        formatted_detections.append({
                            "box": detection["box"],
                            "class_id": mapped_idx,
                            "class_name": actual_name,
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
            
        # Delete model file/directory if exists
        job = self.jobs[job_id]
        if job.model_path:
            model_p = Path(job.model_path)
            if model_p.exists():
                if model_p.is_file():
                    model_p.unlink()
                    # Also delete parent directory if it's the job_id folder and now empty
                    parent_dir = model_p.parent
                    if parent_dir.name == job_id and parent_dir.exists():
                        try:
                            parent_dir.rmdir()
                        except OSError:
                            pass
                elif model_p.is_dir():
                    import shutil
                    shutil.rmtree(model_p)
        
        # Clean up job models directory if empty or exists
        models_base_dir = Path(os.getenv("MODELS_DIR", "logs/models"))
        job_model_dir = models_base_dir / job_id
        if job_model_dir.exists():
            import shutil
            shutil.rmtree(job_model_dir)
            
        # Delete dataset if exists
        dataset_path = Path(f"datasets/{job_id}")
        if dataset_path.exists():
            import shutil
            shutil.rmtree(dataset_path)
            
        # Delete from MinIO
        try:
            minio_utils.delete_prefix(MODELS_BUCKET, job_id)
            minio_utils.delete_prefix(DATASETS_BUCKET, job_id)
        except Exception as e:
            print(f"Warning: Failed to delete job {job_id} artifacts from MinIO: {e}")
            
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

# ==================== Path Rewriting Middleware ====================
@app.middleware("http")
async def rewrite_legacy_paths(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/projects") and not path.startswith("/api/v1/"):
        new_path = path.replace("/api/projects", "/api/v1/projects", 1)
        request.scope["path"] = new_path
    elif path.startswith("/pipelines") and not path.startswith("/api/v1/"):
        new_path = path.replace("/pipelines", "/api/v1/pipelines", 1)
        request.scope["path"] = new_path
    elif path.startswith("/upload-dataset") and not path.startswith("/api/v1/"):
        new_path = path.replace("/upload-dataset", "/api/v1/upload-dataset", 1)
        request.scope["path"] = new_path
    elif path.startswith("/upload-detection-dataset") and not path.startswith("/api/v1/"):
        new_path = path.replace("/upload-detection-dataset", "/api/v1/upload-detection-dataset", 1)
        request.scope["path"] = new_path
    elif path.startswith("/predict") and not path.startswith("/api/v1/"):
        new_path = path.replace("/predict", "/api/v1/predict", 1)
        request.scope["path"] = new_path
    elif path.startswith("/responsible-ai") and not path.startswith("/api/v1/"):
        new_path = path.replace("/responsible-ai", "/api/v1/responsible-ai", 1)
        request.scope["path"] = new_path
    elif path.startswith("/mlflow") and not path.startswith("/api/v1/"):
        new_path = path.replace("/mlflow", "/api/v1/mlflow", 1)
        request.scope["path"] = new_path
    elif path.startswith("/datasets") and not path.startswith("/api/v1/"):
        new_path = path.replace("/datasets", "/api/v1/datasets", 1)
        request.scope["path"] = new_path
    elif path.startswith("/jobs") and "mlflow" in path and not path.startswith("/api/v1/"):
        new_path = "/api/v1" + path
        request.scope["path"] = new_path
    
    response = await call_next(request)
    return response

# ==================== Access Control Helpers ====================
def check_project_access(project_id: str, current_user: User) -> Project:
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied to this project")
    return project

def check_job_access(job_id: str, current_user: User) -> TrainingJob:
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    project_id = getattr(job.pipeline_config, 'project_id', None)
    if project_id:
        check_project_access(project_id, current_user)
    elif current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied to this job")
    return job

def check_dataset_access(dataset_id: str, current_user: User):
    dataset_path = Path("datasets") / dataset_id
    config_file = dataset_path / "dataset_config.json"
    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                config = json.load(f)
            project_id = config.get("project_id")
            if project_id:
                check_project_access(project_id, current_user)
                return
        except Exception:
            pass
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied to this dataset")

# ==================== Auth & Admin API Schemas ====================
class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str

class StatusUpdateRequest(BaseModel):
    status: str

class RoleUpdateRequest(BaseModel):
    role: str

# ==================== Authentication API ====================
@app.post("/api/v1/auth/register", response_model=UserResponse, tags=["Authentication"])
async def register_user(req: RegisterRequest):
    if user_manager.get_user_by_username(req.username):
        raise HTTPException(status_code=400, detail="Username already exists")
    if user_manager.get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Email already exists")
    
    # Check if this is the first user
    is_first = len(user_manager.users) == 0
    role = "admin" if is_first else "user"
    status = "approved" if is_first else "pending"
    
    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role=role,
        status=status
    )
    user_manager.create_user(user)
    return user

@app.post("/api/v1/auth/login", tags=["Authentication"])
async def login_user(req: LoginRequest, response: Response):
    user = user_manager.get_user_by_username(req.username)
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    access_token = create_access_token(data={"sub": user.id})
    response.set_cookie(
        key="maklens_token",
        value=access_token,
        max_age=86400,
        samesite="lax",
        httponly=False
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "status": user.status,
            "created_at": user.created_at
        }
    }

@app.get("/api/v1/auth/me", response_model=UserResponse, tags=["Authentication"])
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

class UpdateProfileRequest(BaseModel):
    username: str
    email: str
    password: Optional[str] = None

@app.put("/api/v1/auth/profile", response_model=UserResponse, tags=["Authentication"])
async def update_profile(req: UpdateProfileRequest, current_user: User = Depends(get_current_user)):
    if req.username.lower() != current_user.username.lower():
        if user_manager.get_user_by_username(req.username):
            raise HTTPException(status_code=400, detail="Username already exists")
    if req.email.lower() != current_user.email.lower():
        if user_manager.get_user_by_email(req.email):
            raise HTTPException(status_code=400, detail="Email already exists")
            
    current_user.username = req.username
    current_user.email = req.email
    if req.password and req.password.strip():
        current_user.password_hash = hash_password(req.password)
        
    user_manager.save_users()
    return current_user

# ==================== Admin Operations API ====================
@app.get("/api/v1/admin/users", response_model=List[UserResponse], tags=["Admin Operations"])
async def list_users(current_user: User = Depends(get_admin_user)):
    return user_manager.list_users()

@app.put("/api/v1/admin/users/{user_id}/status", response_model=UserResponse, tags=["Admin Operations"])
async def update_user_status(user_id: str, req: StatusUpdateRequest, current_user: User = Depends(get_admin_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own status")
    if user_id not in user_manager.users:
        raise HTTPException(status_code=404, detail="User not found")
    user = user_manager.users[user_id]
    user.status = req.status
    user_manager.save_users()
    return user

@app.put("/api/v1/admin/users/{user_id}/role", response_model=UserResponse, tags=["Admin Operations"])
async def update_user_role(user_id: str, req: RoleUpdateRequest, current_user: User = Depends(get_admin_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    if user_id not in user_manager.users:
        raise HTTPException(status_code=404, detail="User not found")
    user = user_manager.users[user_id]
    user.role = req.role
    user_manager.save_users()
    return user

@app.delete("/api/v1/admin/users/{user_id}", tags=["Admin Operations"])
async def delete_user(user_id: str, current_user: User = Depends(get_admin_user)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")
    if user_id not in user_manager.users:
        raise HTTPException(status_code=404, detail="User not found")
    del user_manager.users[user_id]
    user_manager.save_users()
    return {"detail": "User deleted successfully"}

@app.get("/api/v1/admin/stats", tags=["Admin Operations"])
async def get_admin_stats(current_user: User = Depends(get_admin_user)):
    users = user_manager.list_users()
    projects = project_manager.list_projects()
    jobs = job_manager.list_jobs()
    
    pending_users = sum(1 for u in users if u.status == "pending")
    approved_users = sum(1 for u in users if u.status == "approved")
    rejected_users = sum(1 for u in users if u.status == "rejected")
    
    running_jobs = sum(1 for j in jobs if j.status == TrainingStatus.RUNNING)
    completed_jobs = sum(1 for j in jobs if j.status == TrainingStatus.COMPLETED)
    
    return {
        "users": {
            "total": len(users),
            "pending": pending_users,
            "approved": approved_users,
            "rejected": rejected_users
        },
        "projects": {
            "total": len(projects)
        },
        "jobs": {
            "total": len(jobs),
            "running": running_jobs,
            "completed": completed_jobs
        }
    }

# ==================== Project API ====================

@app.post("/api/v1/projects", tags=["Projects"])
async def create_project(project: Project, current_user: User = Depends(get_current_approved_user)):
    project.owner_id = current_user.id
    return project_manager.create_project(project)

@app.get("/api/v1/projects", tags=["Projects"])
async def list_projects(current_user: User = Depends(get_current_approved_user)):
    if current_user.role == "admin":
        return project_manager.list_projects()
    return [p for p in project_manager.list_projects() if p.owner_id == current_user.id]

@app.get("/api/v1/projects/{project_id}", tags=["Projects"])
async def get_project(project_id: str, current_user: User = Depends(get_current_approved_user)):
    return check_project_access(project_id, current_user)

# ==================== Job API ====================
# Import MLflow server utilities
from mlflow_server import (
    start_mlflow_server, stop_mlflow_server, 
    get_mlflow_ui_url, get_experiment_details
)

# Global job manager instance
job_manager = JobManager()

# ==================== API Endpoints ====================

from fastapi.responses import RedirectResponse

@app.get("/")
async def root():
    return RedirectResponse(url="/index.html")

# MLflow integration endpoints
@app.post("/api/v1/mlflow/start-server", tags=["MLflow Tracking"])
async def start_mlflow(current_user: User = Depends(get_current_approved_user)):
    """Start the MLflow UI server"""
    result = start_mlflow_server()
    return {"message": result}

@app.post("/api/v1/mlflow/stop-server", tags=["MLflow Tracking"])
async def stop_mlflow(current_user: User = Depends(get_current_approved_user)):
    """Stop the MLflow UI server"""
    result = stop_mlflow_server()
    return {"message": result}

@app.get("/api/v1/mlflow/ui-url", tags=["MLflow Tracking"])
async def get_ui_url(current_user: User = Depends(get_current_approved_user)):
    """Get the URL for the MLflow UI"""
    return {"url": get_mlflow_ui_url()}

@app.get("/api/v1/mlflow/experiments", tags=["MLflow Tracking"])
async def get_experiments(current_user: User = Depends(get_current_approved_user)):
    """Get details about MLflow experiments"""
    return get_experiment_details()

@app.get("/api/v1/jobs/{job_id}/mlflow", tags=["MLflow Tracking"])
async def get_job_mlflow_info(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Get MLflow information for a specific job"""
    check_job_access(job_id, current_user)
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

@app.post("/api/v1/pipelines", response_model=TrainingJob, tags=["Pipelines & Training"])
async def create_pipeline(config: PipelineConfig, current_user: User = Depends(get_current_approved_user)):
    """Create a new training pipeline"""
    check_project_access(config.project_id, current_user)
    try:
        job = job_manager.create_job(config)
        return job
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/pipelines/{job_id}/train", tags=["Pipelines & Training"])
async def start_training(job_id: str, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_approved_user)):
    """Start training for a specific job"""
    job = check_job_access(job_id, current_user)
    try:
        if not job.linked_dataset_id:
            raise HTTPException(status_code=400, detail="No dataset linked to this job. Please link a dataset first.")
        dataset_path = f"datasets/{job.linked_dataset_id}"
        result = await job_manager.start_job(job_id, dataset_path)
        return result  
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/v1/pipelines/{job_id}", response_model=TrainingJob, tags=["Pipelines & Training"])
async def get_pipeline_status(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Get the status of a training job"""
    return check_job_access(job_id, current_user)



@app.get("/api/v1/pipelines/{job_id}/evaluate", tags=["Pipelines & Training"])
@app.post("/api/v1/pipelines/{job_id}/evaluate", tags=["Pipelines & Training"])
async def evaluate_pipeline(job_id: str, current_user: User = Depends(get_current_approved_user)):
    check_job_access(job_id, current_user)
    """Evaluate a trained model on its test split and return detailed metrics and samples."""
    import base64
    import io
    import json
    from collections import Counter
    from pathlib import Path
    from PIL import Image
    import torch
    
    # Get the job
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
    if job.status != TrainingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Evaluation is only available for completed models")
        
    # Lazy download dataset from MinIO if missing locally
    dataset_id = job.linked_dataset_id or job_id
    dataset_path_check = Path(f"datasets/{dataset_id}")
    if not dataset_path_check.exists() or not dataset_path_check.is_dir() or not any(dataset_path_check.iterdir() if dataset_path_check.exists() else []):
        if minio_utils.exists(DATASETS_BUCKET, dataset_id):
            print(f"Dataset '{dataset_id}' not found locally for evaluation. Downloading from MinIO...")
            minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(dataset_path_check))
        
    # Handle Image Classification
    if job.pipeline_config.task_type == TaskType.IMAGE_CLASSIFICATION:
        # Resolve dataset path
        dataset_id = job.linked_dataset_id or job_id
        dataset_path = Path(f"datasets/{dataset_id}")
        if not dataset_path.exists() or not dataset_path.is_dir():
            found_dataset = False
            for d in Path("datasets").iterdir():
                if d.is_dir() and not d.name.startswith('.') and d.name != '__pycache__':
                    cfg_file = d / "dataset_config.json"
                    if cfg_file.exists():
                        try:
                            with open(cfg_file, 'r') as f:
                                cfg = json.load(f)
                            if cfg.get("task_type") == "image_classification":
                                dataset_path = d
                                dataset_id = d.name
                                found_dataset = True
                                break
                        except:
                            pass
            if not found_dataset:
                for d in Path("datasets").iterdir():
                    if d.is_dir() and not d.name.startswith('.') and d.name != '__pycache__':
                        dataset_path = d
                        dataset_id = d.name
                        break
                        
        if not dataset_path.exists() or not dataset_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Dataset path not found: {dataset_path}")
            
        # Load splits file
        splits_path = Path("dataset_splits") / job_id / "dataset_splits.json"
        if not splits_path.exists():
            splits_path = Path("models") / job_id / "splits" / "dataset_splits.json"
            
        test_indices = []
        if splits_path.exists():
            try:
                with open(splits_path, 'r') as f:
                    splits = json.load(f)
                test_indices = splits.get("test", [])
                if not test_indices:
                    test_indices = splits.get("val", [])
            except Exception as e:
                print(f"Warning: Failed to load split file: {e}")
                
        # Load dataset
        try:
            from datasets_module.classification.dataloaders import ImageClassificationDataset
            dataset = ImageClassificationDataset(dataset_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
            
        if not test_indices:
            test_indices = list(range(len(dataset)))
            
        # Safely bound-check test_indices
        test_indices = [idx for idx in test_indices if idx < len(dataset)]
        if not test_indices:
            raise HTTPException(status_code=400, detail="No valid test samples found for evaluation")
            
        # Ensure model is cached/loaded
        if job_id not in job_manager.loaded_models:
            try:
                model = job_manager._load_model(job.model_path, job.pipeline_config)
                class_map = job_manager._get_class_map(job.model_path)
                job_manager.loaded_models[job_id] = (model, class_map)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")
                
        model, class_map = job_manager.loaded_models[job_id]
        
        samples_results = []
        incorrect_pairs = []
        classes = dataset.classes
        
        for idx in test_indices:
            img_path, class_idx = dataset.samples[idx]
            filename = Path(img_path).name
            
            # Read image
            try:
                with open(img_path, 'rb') as f:
                    img = Image.open(f).convert('RGB')
            except Exception as e:
                print(f"Error opening image {img_path}: {e}")
                continue
                
            # Run prediction
            try:
                pred_result = await job_manager.predict(job_id, img)
            except Exception as e:
                print(f"Error predicting image {img_path}: {e}")
                continue
                
            predictions = pred_result.get("predictions", [])
            if not predictions:
                continue
                
            top_pred = predictions[0]
            pred_label = top_pred["class_name"]
            pred_confidence = top_pred["confidence"]
            
            # Ground truth label
            true_label = class_map.get(str(class_idx), dataset.classes[class_idx])
            correct = (pred_label == true_label)
            
            if not correct:
                incorrect_pairs.append((true_label, pred_label))
                
            # Base64 thumbnail
            try:
                thumb = img.copy()
                thumb.thumbnail((160, 160))
                buffered = io.BytesIO()
                thumb.save(buffered, format="JPEG")
                img_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
                base64_image = f"data:image/jpeg;base64,{img_base64}"
            except Exception as e:
                base64_image = ""
                print(f"Error creating thumbnail for {img_path}: {e}")
                
            # Top 3 predictions format
            top_3 = []
            for p in predictions[:3]:
                top_3.append({
                    "class_name": p["class_name"],
                    "confidence": p["confidence"]
                })
                
            samples_results.append({
                "filename": filename,
                "base64_image": base64_image,
                "true_label": true_label,
                "predicted_label": pred_label,
                "confidence": pred_confidence,
                "correct": correct,
                "top_3_predictions": top_3,
                "all_predictions": predictions
            })
            
        total_evaluated = len(samples_results)
        if total_evaluated == 0:
            raise HTTPException(status_code=400, detail="Failed to run evaluation on any of the test samples")
            
        correct_count = sum(1 for s in samples_results if s["correct"])
        incorrect_count = total_evaluated - correct_count
        accuracy = correct_count / total_evaluated
        
        # Calculate confusion matrix & precision/recall/F1 per class
        class_metrics_dict = {}
        for cls in classes:
            class_metrics_dict[cls] = {
                "class_name": cls,
                "count": 0,
                "correct": 0,
                "fp": 0,
                "fn": 0
            }
            
        for s in samples_results:
            t_lbl = s["true_label"]
            p_lbl = s["predicted_label"]
            
            if t_lbl in class_metrics_dict:
                class_metrics_dict[t_lbl]["count"] += 1
                if s["correct"]:
                    class_metrics_dict[t_lbl]["correct"] += 1
                else:
                    class_metrics_dict[t_lbl]["fn"] += 1
                    
            if not s["correct"] and p_lbl in class_metrics_dict:
                class_metrics_dict[p_lbl]["fp"] += 1
                
        class_metrics_list = []
        lowest_precision_class = "None"
        lowest_recall_class = "None"
        lowest_precision_val = 1.01
        lowest_recall_val = 1.01
        
        for cls, metrics in class_metrics_dict.items():
            cnt = metrics["count"]
            corr = metrics["correct"]
            fp = metrics["fp"]
            fn = metrics["fn"]
            
            precision = corr / (corr + fp) if (corr + fp) > 0 else 0.0
            recall = corr / (corr + fn) if (corr + fn) > 0 else 0.0
            f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
            
            class_metrics_list.append({
                "class_name": cls,
                "count": cnt,
                "correct": corr,
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1_score": round(f1, 4)
            })
            
            if cnt > 0:
                if precision < lowest_precision_val:
                    lowest_precision_val = precision
                    lowest_precision_class = cls
                if recall < lowest_recall_val:
                    lowest_recall_val = recall
                    lowest_recall_class = cls
                    
        if incorrect_pairs:
            confusion_counts = Counter(incorrect_pairs)
            (t_conf, p_conf), count_conf = confusion_counts.most_common(1)[0]
            top_confusion = f"'{t_conf}' as '{p_conf}' ({count_conf})"
        else:
            top_confusion = "None"
            
        # Generate Confusion Matrix Base64
        cm_base64 = ""
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            import seaborn as sns
            from sklearn.metrics import confusion_matrix
            
            y_true = [s["true_label"] for s in samples_results]
            y_pred = [s["predicted_label"] for s in samples_results]
            
            cm = confusion_matrix(y_true, y_pred, labels=classes)
            
            plt.figure(figsize=(8, 6))
            sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=classes, yticklabels=classes)
            plt.ylabel('Actual')
            plt.xlabel('Predicted')
            plt.title('Confusion Matrix')
            plt.tight_layout()
            
            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=100)
            plt.close()
            cm_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        except Exception as e:
            print(f"Error generating confusion matrix: {e}")

        # Generate ROC/AUC curve
        roc_auc_val = None
        roc_curve_base64 = ""
        try:
            from sklearn.metrics import roc_curve, auc
            from sklearn.preprocessing import label_binarize
            import numpy as np

            # Map class names to indices
            class_to_idx = {cls: idx for idx, cls in enumerate(classes)}
            
            y_true_indices = [class_to_idx[s["true_label"]] for s in samples_results if s["true_label"] in class_to_idx]
            
            # Extract scores matrix: shape (n_samples, n_classes)
            y_scores = []
            for s in samples_results:
                scores_dict = {p["class_name"]: p["confidence"] for p in s["all_predictions"]}
                # Ensure all classes have a score (default 0.0)
                scores_row = [scores_dict.get(cls, 0.0) for cls in classes]
                # Normalize scores to sum to 1 if they don't
                sum_scores = sum(scores_row)
                if sum_scores > 0:
                    scores_row = [score / sum_scores for score in scores_row]
                y_scores.append(scores_row)
            
            y_scores = np.array(y_scores)
            y_true_indices = np.array(y_true_indices)

            n_classes = len(classes)
            if len(y_true_indices) > 0 and len(y_scores) > 0:
                plt.figure(figsize=(8, 6))

                if n_classes == 2:
                    # Binary classification
                    # Use scores for class 1
                    y_true_binary = y_true_indices
                    y_scores_pos = y_scores[:, 1]
                    fpr, tpr, _ = roc_curve(y_true_binary, y_scores_pos)
                    roc_auc_val = auc(fpr, tpr)
                    
                    plt.plot(fpr, tpr, color='darkorange', lw=2, label=f'ROC curve (AUC = {roc_auc_val:.3f})')
                    plt.plot([0, 1], [0, 1], color='navy', lw=2, linestyle='--')
                    plt.xlim([0.0, 1.0])
                    plt.ylim([0.0, 1.05])
                    plt.xlabel('False Positive Rate')
                    plt.ylabel('True Positive Rate')
                    plt.title('Receiver Operating Characteristic (ROC) Curve')
                    plt.legend(loc="lower right")
                elif n_classes > 2:
                    # Multiclass classification: One-vs-Rest ROC
                    y_true_bin = label_binarize(y_true_indices, classes=list(range(n_classes)))
                    
                    fpr = dict()
                    tpr = dict()
                    roc_auc = dict()
                    for i in range(n_classes):
                        if i < y_true_bin.shape[1] and np.sum(y_true_bin[:, i]) > 0:  # avoid classes with no true samples in test split
                            fpr[i], tpr[i], _ = roc_curve(y_true_bin[:, i], y_scores[:, i])
                            roc_auc[i] = auc(fpr[i], tpr[i])
                            plt.plot(fpr[i], tpr[i], lw=1.5, label=f'Class {classes[i]} (AUC = {roc_auc[i]:.2f})')
                    
                    # Compute macro-average ROC
                    try:
                        valid_keys = [i for i in fpr if i in fpr]
                        if valid_keys:
                            # First aggregate all false positive rates
                            all_fpr = np.unique(np.concatenate([fpr[i] for i in valid_keys]))
                            # Then interpolate all ROC curves at these points
                            mean_tpr = np.zeros_like(all_fpr)
                            valid_classes = 0
                            for i in valid_keys:
                                mean_tpr += np.interp(all_fpr, fpr[i], tpr[i])
                                valid_classes += 1
                            if valid_classes > 0:
                                mean_tpr /= valid_classes
                                fpr["macro"] = all_fpr
                                tpr["macro"] = mean_tpr
                                roc_auc["macro"] = auc(fpr["macro"], tpr["macro"])
                                roc_auc_val = roc_auc["macro"]
                                plt.plot(fpr["macro"], tpr["macro"],
                                         label=f'macro-average ROC curve (AUC = {roc_auc["macro"]:.2f})',
                                         color='deeppink', linestyle=':', linewidth=3)
                    except Exception as agg_err:
                        print(f"Error aggregating multiclass ROC: {agg_err}")
                    
                    plt.plot([0, 1], [0, 1], 'k--', lw=2)
                    plt.xlim([0.0, 1.0])
                    plt.ylim([0.0, 1.05])
                    plt.xlabel('False Positive Rate')
                    plt.ylabel('True Positive Rate')
                    plt.title('Multi-class Receiver Operating Characteristic (ROC) Curve')
                    plt.legend(loc="lower right")
                
                plt.tight_layout()
                buf = io.BytesIO()
                plt.savefig(buf, format='png', dpi=100)
                plt.close()
                roc_curve_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            
        except Exception as e:
            print(f"Error generating ROC curve: {e}")

        return {
            "task_type": "image_classification",
            "accuracy": round(accuracy, 4),
            "correct_count": correct_count,
            "incorrect_count": incorrect_count,
            "lowest_precision_class": lowest_precision_class,
            "lowest_recall_class": lowest_recall_class,
            "top_confusion": top_confusion,
            "class_metrics": class_metrics_list,
            "samples": samples_results,
            "confusion_matrix_base64": cm_base64,
            "roc_auc": round(roc_auc_val, 4) if roc_auc_val is not None else None,
            "roc_curve_base64": roc_curve_base64
        }
        
    elif job.pipeline_config.task_type == TaskType.OBJECT_DETECTION:
        # Load splits file
        splits_path = Path("dataset_splits") / job_id / "dataset_splits.json"
        if not splits_path.exists():
            splits_path = Path("models") / job_id / "splits" / "dataset_splits.json"
            
        test_indices = []
        images_dir = None
        annotations_path = None
        
        if splits_path.exists():
            try:
                with open(splits_path, 'r') as f:
                    splits = json.load(f)
                test_indices = splits.get("test", [])
                if not test_indices:
                    test_indices = splits.get("val", [])
                
                images_dir = splits.get("dataset_path")
                annotations_path = splits.get("annotations_path")
            except Exception as e:
                print(f"Warning: Failed to load split file: {e}")
                
        # Resolve path fallback if split file has invalid paths or doesn't exist
        dataset_id = job.linked_dataset_id or job_id
        dataset_path = Path(f"datasets/{dataset_id}")
        
        # Robust dataset lookup fallback
        if not dataset_path.exists() or not list(dataset_path.glob("**/*.json")):
            found_dataset = False
            for d in Path("datasets").iterdir():
                if d.is_dir() and not d.name.startswith('.') and d.name != '__pycache__':
                    cfg_file = d / "dataset_config.json"
                    if cfg_file.exists():
                        try:
                            with open(cfg_file, 'r') as f:
                                cfg = json.load(f)
                            if cfg.get("task_type") == "object_detection":
                                dataset_path = d
                                dataset_id = d.name
                                found_dataset = True
                                break
                        except:
                            pass
            if not found_dataset:
                for d in Path("datasets").iterdir():
                    if d.is_dir() and not d.name.startswith('.') and d.name != '__pycache__':
                        json_files = list(d.glob("**/*.json"))
                        json_files = [f for f in json_files if f.name != "dataset_config.json"]
                        if json_files:
                            dataset_path = d
                            dataset_id = d.name
                            break
                            
        # Find all JSON annotation files in the dataset path (excluding config)
        annotation_candidates = list(dataset_path.glob("**/*.json"))
        annotation_candidates = [f for f in annotation_candidates if f.name != "dataset_config.json"]
        
        if not images_dir or not Path(images_dir).exists() or not annotations_path or not Path(annotations_path).exists():
            if annotation_candidates:
                def priority_score(path: Path):
                    p_name = path.parent.name.lower()
                    f_name = path.name.lower()
                    score = 0
                    if "test" in p_name or "test" in f_name:
                        score += 10
                    elif "val" in p_name or "val" in f_name:
                        score += 5
                    elif "annotations" in p_name or "annotations" in f_name:
                        score += 3
                    return score
                    
                annotation_candidates.sort(key=priority_score, reverse=True)
                annotations_path = annotation_candidates[0]
                images_dir = annotations_path.parent
                
        if not annotations_path or not Path(annotations_path).exists():
            raise HTTPException(status_code=400, detail=f"Annotations JSON file not found in {dataset_path}")
            
        if not images_dir or not Path(images_dir).exists():
            images_dir = dataset_path
            
        # Load dataset
        try:
            from datasets_module.detection.dataloaders import ObjectDetectionDataset
            dataset = ObjectDetectionDataset(images_dir, annotations_path)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
            
        if not test_indices:
            test_indices = list(range(len(dataset)))
            
        test_indices = [idx for idx in test_indices if idx < len(dataset)]
        test_indices = test_indices[:5]  # Limit to 5 images to ensure quick evaluation on CPU
        if not test_indices:
            raise HTTPException(status_code=400, detail="No valid test samples found for evaluation")
            
        # Ensure model is cached/loaded
        if job_id not in job_manager.loaded_models:
            try:
                model = job_manager._load_model(job.model_path, job.pipeline_config)
                class_map = job_manager._get_class_map(job.model_path)
                job_manager.loaded_models[job_id] = (model, class_map)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")
                
        model, class_map = job_manager.loaded_models[job_id]
        
        sorted_cat_keys = sorted(dataset.categories.keys())
        class_names = [dataset.categories[k] for k in sorted_cat_keys]
        
        samples_results = []
        detections_list = []
        targets_list = []
        
        from visualization_utils import draw_bounding_boxes
        
        for idx in test_indices:
            # Load image and annotations
            img, target = dataset[idx]
            img_info = dataset.images[dataset.image_ids[idx]]
            filename = img_info["file_name"]
            
            # Predict
            try:
                img_path = Path(dataset.images_dir / filename)
                if not img_path.exists():
                    potential_paths = list(dataset.images_dir.glob(f"**/{filename}"))
                    if potential_paths:
                        img_path = potential_paths[0]
                
                with open(img_path, 'rb') as f:
                    pil_img = Image.open(f).convert('RGB')
            except Exception as e:
                print(f"Error loading image {filename}: {e}")
                continue
                
            try:
                pred_result = await job_manager.predict(job_id, pil_img)
            except Exception as e:
                print(f"Error predicting image {filename}: {e}")
                continue
                
            formatted_detections = pred_result.get("detections", [])
            
            target_boxes = target["boxes"]
            target_labels = target["labels"]
            
            # Remap predicted labels from 1-indexed (Faster R-CNN: 0=background)
            # to 0-indexed (matching dataset labels) and fix class names
            pred_boxes = []
            pred_labels = []  # Will hold 0-indexed labels
            pred_scores = []
            for det in formatted_detections:
                pred_boxes.append(det["box"])
                raw_label = det["class_id"]
                # Faster R-CNN outputs 1-indexed labels (0=background)
                # Dataset uses 0-indexed labels, so subtract 1
                mapped_label = max(0, raw_label - 1)
                pred_labels.append(mapped_label)
                pred_scores.append(det["confidence"] / 100.0)
                # Fix class name using dataset categories
                if mapped_label < len(class_names):
                    det["class_name"] = class_names[mapped_label]
                    det["class_id"] = mapped_label
                
            if pred_boxes:
                boxes_tensor = torch.tensor(pred_boxes, dtype=torch.float32)
                labels_tensor = torch.tensor(pred_labels, dtype=torch.int64)
                scores_tensor = torch.tensor(pred_scores, dtype=torch.float32)
            else:
                boxes_tensor = torch.zeros((0, 4), dtype=torch.float32)
                labels_tensor = torch.zeros((0), dtype=torch.int64)
                scores_tensor = torch.zeros((0), dtype=torch.float32)
                
            detections_list.append({
                'boxes': boxes_tensor,
                'labels': labels_tensor,
                'scores': scores_tensor
            })
            targets_list.append({
                'boxes': target_boxes,
                'labels': target_labels
            })
            
            tp_count = 0
            fp_count = 0
            fn_count = 0
            
            if len(pred_scores) > 0:
                matched_targets = [False] * len(target_labels)
                for p_idx, (p_box, p_lbl) in enumerate(zip(pred_boxes, pred_labels)):
                    best_iou = 0
                    best_t_idx = -1
                    for t_idx, (t_box, t_lbl) in enumerate(zip(target_boxes, target_labels)):
                        if t_lbl.item() != p_lbl or matched_targets[t_idx]:
                            continue
                        bi = [max(p_box[0], t_box[0]), max(p_box[1], t_box[1]), min(p_box[2], t_box[2]), min(p_box[3], t_box[3])]
                        iw = bi[2] - bi[0]
                        ih = bi[3] - bi[1]
                        if iw > 0 and ih > 0:
                            ua = (p_box[2] - p_box[0]) * (p_box[3] - p_box[1]) + (t_box[2] - t_box[0]) * (t_box[3] - t_box[1]) - iw * ih
                            iou = (iw * ih) / ua
                            if iou > best_iou:
                                best_iou = iou
                                best_t_idx = t_idx
                    if best_iou >= 0.5:
                        tp_count += 1
                        matched_targets[best_t_idx] = True
                    else:
                        fp_count += 1
                fn_count = len(target_labels) - sum(matched_targets)
            else:
                fn_count = len(target_labels)
                
            # Define image correctness based on F1-score (harmonic mean of Precision & Recall)
            if len(target_labels) > 0:
                precision = tp_count / (tp_count + fp_count) if (tp_count + fp_count) > 0 else 0.0
                recall = tp_count / len(target_labels)
                f1_val = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
                correct = (f1_val >= 0.5)
            else:
                correct = (len(pred_labels) == 0)
                
            # Draw ground truth boxes in RED
            from PIL import ImageDraw, ImageFont
            annotated_img = pil_img.copy()
            draw_ctx = ImageDraw.Draw(annotated_img)
            img_w, img_h = annotated_img.size
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(12, int(min(img_w, img_h) * 0.025)))
            except (OSError, IOError):
                font = ImageFont.load_default()
            
            for t_box, t_lbl in zip(target_boxes, target_labels):
                bx = t_box.tolist()
                x1, y1, x2, y2 = [max(0, min(v, img_w if i % 2 == 0 else img_h)) for i, v in enumerate(bx)]
                lbl_name = class_names[t_lbl.item()] if t_lbl.item() < len(class_names) else f"class_{t_lbl.item()}"
                label_text = f"GT: {lbl_name}"
                # Draw red box
                for i in range(3):
                    draw_ctx.rectangle([x1 - i, y1 - i, x2 + i, y2 + i], outline="#FF0000", width=1)
                # Draw label background
                text_bbox = draw_ctx.textbbox((0, 0), label_text, font=font)
                tw, th = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
                ly = y1 - th - 4 if y1 - th - 4 >= 0 else y2
                draw_ctx.rectangle([x1, ly, x1 + tw + 4, ly + th + 4], fill="#FF0000")
                draw_ctx.text((x1 + 2, ly + 2), label_text, fill="white", font=font)
            
            # Draw predicted boxes in GREEN
            for det in formatted_detections:
                conf = det.get("confidence", 0)
                if conf < 50:  # 50% threshold
                    continue
                bx = det["box"]
                x1, y1, x2, y2 = [max(0, min(v, img_w if i % 2 == 0 else img_h)) for i, v in enumerate(bx)]
                cls_name = det.get("class_name", "Unknown")
                label_text = f"{cls_name}: {conf:.1f}%"
                for i in range(3):
                    draw_ctx.rectangle([x1 - i, y1 - i, x2 + i, y2 + i], outline="#00FF00", width=1)
                text_bbox = draw_ctx.textbbox((0, 0), label_text, font=font)
                tw, th = text_bbox[2] - text_bbox[0], text_bbox[3] - text_bbox[1]
                ly = y2
                draw_ctx.rectangle([x1, ly, x1 + tw + 4, ly + th + 4], fill="#00FF00")
                draw_ctx.text((x1 + 2, ly + 2), label_text, fill="black", font=font)
            
            try:
                thumb = annotated_img.copy()
                thumb.thumbnail((200, 200))
                buffered = io.BytesIO()
                thumb.save(buffered, format="JPEG")
                img_base64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
                base64_image = f"data:image/jpeg;base64,{img_base64}"
            except Exception as e:
                base64_image = ""
                print(f"Error creating thumbnail for {filename}: {e}")
                
            top_3 = []
            for p in formatted_detections[:3]:
                top_3.append({
                    "class_name": p["class_name"],
                    "confidence": p["confidence"]
                })
                
            # Descriptive summaries for UI display
            target_class_counts = Counter([class_names[lbl.item()] for lbl in target_labels])
            true_lbl_summary = ", ".join([f"{count} {cls}" for cls, count in target_class_counts.items()]) if target_class_counts else "None"
            
            pred_class_names = [det["class_name"] for det in formatted_detections if det.get("confidence", 0) >= 50]
            pred_class_counts = Counter(pred_class_names)
            pred_lbl_summary = ", ".join([f"{count} {cls}" for cls, count in pred_class_counts.items()]) if pred_class_counts else "None"
            
            # Determine dominant class names for dropdown filtering (which matches individual classes)
            true_lbl_name = target_class_counts.most_common(1)[0][0] if target_class_counts else "Background"
            pred_lbl_name = pred_class_counts.most_common(1)[0][0] if pred_class_counts else "Background"
            
            samples_results.append({
                "filename": filename,
                "base64_image": base64_image,
                "true_label": true_lbl_name,
                "predicted_label": pred_lbl_name,
                "true_label_summary": true_lbl_summary,
                "predicted_label_summary": pred_lbl_summary,
                "confidence": formatted_detections[0]["confidence"] if len(formatted_detections) > 0 else 0.0,
                "correct": correct,
                "top_3_predictions": top_3
            })
            
        from metrics.detection.metrics import calculate_detection_metrics, calculate_detection_confusion_matrix
        try:
            metrics = calculate_detection_metrics(detections_list, targets_list)
        except Exception as e:
            print(f"Error calculating metrics: {e}")
            metrics = {"mAP": 0.0, "AP50": 0.0, "AP75": 0.0}
            
        mAP = metrics.get("mAP", 0.0)
        AP50 = metrics.get("AP50", 0.0)
        AP75 = metrics.get("AP75", 0.0)

        cm_base64 = None
        try:
            cm, cm_class_names = calculate_detection_confusion_matrix(detections_list, targets_list, class_names)
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            import seaborn as sns

            fig, ax = plt.subplots(figsize=(max(6, len(cm_class_names) * 1.2), max(5, len(cm_class_names) * 1.0)))
            sns.heatmap(
                cm,
                annot=True,
                fmt='d',
                cmap='Blues',
                xticklabels=cm_class_names,
                yticklabels=cm_class_names,
                cbar=True,
                ax=ax
            )
            ax.set_title("Object Detection Confusion Matrix", fontsize=14, fontweight='bold', pad=12)
            ax.set_ylabel('True Label', fontsize=11, fontweight='bold')
            ax.set_xlabel('Predicted Label', fontsize=11, fontweight='bold')
            plt.xticks(rotation=45, ha='right')
            plt.yticks(rotation=0)
            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format='png', dpi=130)
            plt.close(fig)

            cm_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        except Exception as e:
            print(f"Error generating object detection confusion matrix heatmap: {e}")
        
        class_metrics_list = []
        top_class_name = "None"
        top_class_ap = -1.0
        
        for i, cls in enumerate(class_names):
            cnt = sum(len((t["labels"] == i).nonzero()) for t in targets_list)
            det_cnt = sum(len((d["labels"] == i).nonzero()) for d in detections_list)
            ap = metrics.get(f"AP_class_{i}", 0.0)
            
            class_metrics_list.append({
                "class_name": cls,
                "count": int(cnt),
                "correct": int(det_cnt),
                "precision": round(ap, 4),
                "recall": round(ap, 4),
                "f1_score": round(ap, 4)
            })
            
            if ap > top_class_ap:
                top_class_ap = ap
                top_class_name = cls
                
        total_targets_cnt = sum(len(t["labels"]) for t in targets_list)
        total_preds_cnt = sum(len(d["labels"]) for d in detections_list)
        
        top_confusion = f"'{top_class_name}' ({round(top_class_ap * 100)}% AP)" if top_class_ap >= 0 else "None"
        
        return {
            "task_type": "object_detection",
            "accuracy": round(mAP, 4),
            "correct_count": round(AP50 * 100),
            "incorrect_count": round(AP75 * 100),
            "lowest_precision_class": str(total_targets_cnt),
            "lowest_recall_class": str(total_preds_cnt),
            "top_confusion": top_confusion,
            "class_metrics": class_metrics_list,
            "samples": samples_results,
            "confusion_matrix_base64": cm_base64
        }
        
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported task type: {job.pipeline_config.task_type}")

@app.get("/api/v1/pipelines", response_model=List[TrainingJob], tags=["Pipelines & Training"])
async def list_pipelines(project_id: Optional[str] = None, current_user: User = Depends(get_current_approved_user)):
    """List all training jobs, optionally filtered by project"""
    jobs = job_manager.list_jobs()
    if project_id:
        check_project_access(project_id, current_user)
        jobs = [job for job in jobs if getattr(job.pipeline_config, 'project_id', None) == project_id]
    else:
        if current_user.role != "admin":
            user_project_ids = {p.id for p in project_manager.list_projects() if p.owner_id == current_user.id}
            jobs = [job for job in jobs if getattr(job.pipeline_config, 'project_id', None) in user_project_ids]
    return jobs


@app.get("/api/v1/datasets/versions", tags=["Datasets"])
async def list_dataset_versions(
    dataset_name: Optional[str] = None,
    source: Optional[str] = None,
    current_user: User = Depends(get_current_approved_user)
):
    """List all dataset versions with optional filtering"""
    try:
        from dataset_versioning import DatasetVersionManager
        version_manager = DatasetVersionManager("datasets")
        
        versions = version_manager.list_dataset_versions(dataset_name, source)
        # Filter versions that the user has access to
        accessible_versions = []
        for v in versions:
            try:
                check_dataset_access(v.dataset_id, current_user)
                accessible_versions.append(v)
            except HTTPException:
                pass
                
        return {
            "count": len(accessible_versions),
            "versions": [v.to_dict() for v in accessible_versions]
        }
    except ImportError:
        raise HTTPException(status_code=500, detail="Dataset versioning system not available")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list dataset versions: {str(e)}")

@app.get("/api/v1/datasets/versions/{job_id}", tags=["Datasets"])
async def get_dataset_version(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Get detailed information about a specific dataset version"""
    check_job_access(job_id, current_user)
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

@app.delete("/api/v1/datasets/{job_id}", tags=["Datasets"])
async def delete_dataset(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Delete a dataset and its version information"""
    check_job_access(job_id, current_user)
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

@app.post("/api/v1/upload-dataset/{job_id}/{class_name}", tags=["Datasets"])
async def create_dataset_class(job_id: str, class_name: str, current_user: User = Depends(get_current_approved_user)):
    """Create a class directory in the dataset folder"""
    check_job_access(job_id, current_user)
    try:
        # Create dataset class directory
        class_dir = Path(f"datasets/{job_id}/{class_name}")
        class_dir.mkdir(parents=True, exist_ok=True)
        return {"message": f"Created class directory {class_name} for job {job_id}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/upload-dataset/{job_id}", tags=["Datasets"])
async def upload_dataset_file(
    job_id: str,
    task_type: str = "image_classification",
    dataset_name: str = None,
    project_id: str = Form(None),
    file: UploadFile = File(...),
    class_name: str = Form(None),
    file_type: str = Form("image"),  # 'image', 'annotation', or 'zip'
    current_user: User = Depends(get_current_approved_user)
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
        if project_id:
            config["project_id"] = project_id
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
            response_data = {"message": f"Extracted {file.filename} to {dataset_dir}"}

        elif file_type == "annotation" and file.filename.lower().endswith(".json"):
            # Save annotation file to annotations/ or root
            annotations_dir = dataset_dir / "annotations"
            annotations_dir.mkdir(parents=True, exist_ok=True)
            file_path = annotations_dir / file.filename
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            response_data = {"message": f"Uploaded annotation {file.filename} to {annotations_dir}"}

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
            response_data = {"message": f"Uploaded {file.filename} to {class_name} directory"}

        # Sync the uploaded dataset folder to MinIO
        try:
            minio_utils.upload_directory(DATASETS_BUCKET, job_id, str(dataset_dir))
            print(f"Synced dataset directory {job_id} to MinIO")
        except Exception as e:
            print(f"Warning: Failed to sync dataset {job_id} to MinIO on upload: {e}")

        return response_data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/v1/predict/{job_id}", tags=["Pipelines & Training"])
async def predict(
    job_id: str,
    file: Optional[UploadFile] = File(None),
    image_url: Optional[str] = Form(None),
    confidence_threshold: float = Form(0.5),
    explain_method: Optional[str] = Form("none"),
    explain_box_index: Optional[int] = Form(-1),
    current_user: User = Depends(get_current_approved_user)
):
    check_job_access(job_id, current_user)
    """Make predictions using a trained model"""
    import time
    start_time = time.time()
    
    try:
        print(f"Prediction request for job_id: {job_id}")
        print(f"Confidence threshold received: {confidence_threshold}")
        print(f"Explain method requested: {explain_method}")
        print(f"Explain box index requested: {explain_box_index}")
        
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
        if file and file.filename:
            image_data = await file.read()
        elif image_url:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.get(image_url)
                if resp.status_code != 200:
                    raise HTTPException(status_code=400, detail="Failed to fetch image from URL")
                image_data = resp.content
        else:
            raise HTTPException(status_code=400, detail="Must provide either file or image_url")
            
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
            draw_bounding_boxes, draw_segmentation_mask, draw_instance_segmentation,
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
                # For instance segmentation
                instances = prediction_result.get("instances", [])
                if instances:
                    annotated_image = draw_instance_segmentation(image, instances)
                    prediction_result["annotated_image"] = pil_to_base64(annotated_image)
                    print(f"Created instance segmentation overlay with {len(instances)} instances")
                else:
                    prediction_result["annotated_image"] = pil_to_base64(image)
                
        elif job.pipeline_config.task_type == TaskType.IMAGE_CLASSIFICATION:
            # For classification, just return the original image
            prediction_result["annotated_image"] = pil_to_base64(image)
            
        # Generate XAI explanation if requested
        explanation_image_b64 = None
        if explain_method and explain_method != "none":
            try:
                print(f"Generating XAI explanation using method: {explain_method}...")
                import matplotlib
                matplotlib.use('Agg')
                import matplotlib.pyplot as plt
                import cv2
                
                device = "cuda" if torch.cuda.is_available() else "cpu"
                model = job_manager._load_model(job.model_path, job.pipeline_config)
                
                # Check if we should explain a specific box coordinates
                target_image = image
                title_suffix = ""
                
                if explain_box_index is not None and explain_box_index >= 0:
                    detections = prediction_result.get("detections", [])
                    if detections and explain_box_index < len(detections):
                        det = detections[explain_box_index]
                        box = det.get("box", [])
                        class_name = det.get("class_name", "Unknown")
                        conf = det.get("confidence", 0.0)
                        
                        if len(box) == 4:
                            x1, y1, x2, y2 = box
                            w, h = image.size
                            
                            # Handle scaling if box coordinates are outside image size
                            if max(x1, x2) > w * 1.5 or max(y1, y2) > h * 1.5:
                                scale_x = w / 800.0
                                scale_y = h / 800.0
                                x1, y1, x2, y2 = x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y
                                
                            x1 = max(0, min(x1, w - 1))
                            y1 = max(0, min(y1, h - 1))
                            x2 = max(0, min(x2, w - 1))
                            y2 = max(0, min(y2, h - 1))
                            
                            if x2 > x1 and y2 > y1:
                                target_image = image.crop((x1, y1, x2, y2))
                                title_suffix = f" (Box #{explain_box_index}: {class_name} [{conf:.1f}%])"
                                print(f"Cropped target image to bounding box: {x1, y1, x2, y2}")
                
                # Handle Object Detection Grad-CAM XAI
                if job.pipeline_config.task_type == TaskType.OBJECT_DETECTION:
                    try:
                        from responsible_ai.gradcam import GradCAMDetection
                        explainer = GradCAMDetection(model, device=device)
                        detections = prediction_result.get("detections", [])
                        target_box_idx = explain_box_index if (explain_box_index is not None and explain_box_index >= 0) else None
                        
                        overlay_np = explainer.explain_detection(image, detections, target_box_index=target_box_idx)
                        overlay_pil = Image.fromarray(overlay_np)
                        
                        # Draw bounding box with actual class name on overlay
                        target_dets = [detections[target_box_idx]] if (target_box_idx is not None and target_box_idx < len(detections)) else detections
                        if target_dets:
                            overlay_pil = draw_bounding_boxes(overlay_pil, target_dets)
                            
                        buf = io.BytesIO()
                        overlay_pil.save(buf, format="PNG")
                        explanation_image_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                        print("Object Detection Grad-CAM explanation generated successfully")
                    except Exception as det_xai_err:
                        print(f"Object Detection XAI failed: {det_xai_err}. Falling back to universal feature map...")

                # Handle Classification XAI algorithms
                elif is_classification:
                    try:
                        if explain_method == "gradcam":
                            from responsible_ai.gradcam import GradCAM
                            explainer = GradCAM(model, device=device)
                            transform = job_manager._get_transform(job.pipeline_config)
                            overlay_np = explainer.explain_pil_image(target_image, transform=transform)
                            overlay_pil = Image.fromarray(overlay_np)
                            
                            buf = io.BytesIO()
                            overlay_pil.save(buf, format="PNG")
                            explanation_image_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                            print("Grad-CAM generation successful (clean single-image overlay)")
                    except Exception as class_xai_err:
                        print(f"Classification specific XAI failed: {class_xai_err}. Falling back to universal saliency map...")
                
                # If not classification, or if classification explainer failed/did not run, run backbone-based feature saliency map
                if explanation_image_b64 is None:
                    print("Running backbone-based feature activation saliency map...")
                    model.to(device)
                    model.eval()
                    
                    # 1. Register forward hook on last conv layer of backbone/model
                    last_conv_layer = None
                    if hasattr(model, 'backbone'):
                        for name, module in model.backbone.named_modules():
                            if isinstance(module, nn.Conv2d):
                                last_conv_layer = module
                    if last_conv_layer is None:
                        for name, module in model.named_modules():
                            if isinstance(module, nn.Conv2d):
                                last_conv_layer = module
                    
                    if last_conv_layer is None:
                        raise ValueError("No convolutional layer found in model for feature mapping")
                    
                    print(f"Found convolutional layer for activation mapping: {last_conv_layer}")
                    
                    activations = None
                    def hook_fn(module, input, output):
                        nonlocal activations
                        activations = output
                    
                    hook_handle = last_conv_layer.register_forward_hook(hook_fn)
                    
                    # 2. Run forward pass
                    from torchvision.transforms import ToTensor
                    transform = ToTensor()
                    img_rgb = target_image.convert("RGB")
                    img_tensor = transform(img_rgb).unsqueeze(0).to(device)
                    
                    try:
                        with torch.no_grad():
                            _ = model(img_tensor)
                    finally:
                        hook_handle.remove()
                    
                    if activations is None:
                        raise ValueError("Failed to capture activations from last convolutional layer")
                    
                    # 3. Process activations to get saliency heatmap
                    # activations has shape (1, C, H_feat, W_feat)
                    saliency = torch.mean(activations, dim=1).squeeze(0)
                    saliency = torch.clamp(saliency, min=0)
                    saliency = saliency.cpu().numpy()
                    if saliency.max() > 0:
                        saliency = (saliency - saliency.min()) / (saliency.max() - saliency.min() + 1e-8)
                    else:
                        saliency = np.zeros_like(saliency)
                    
                    # Resize to match target image size
                    original_size = (target_image.width, target_image.height)
                    saliency_resized = cv2.resize(saliency, original_size)
                    saliency_resized = cv2.GaussianBlur(saliency_resized, (5, 5), 0)
                    if saliency_resized.max() > 0:
                        saliency_resized = (saliency_resized - saliency_resized.min()) / (saliency_resized.max() - saliency_resized.min() + 1e-8)
                    
                    # 4. Create overlay image
                    img_np = np.array(img_rgb)
                    heatmap_colored = cv2.applyColorMap((saliency_resized * 255).astype(np.uint8), cv2.COLORMAP_JET)
                    heatmap_colored = cv2.cvtColor(heatmap_colored, cv2.COLOR_BGR2RGB)
                    overlay = cv2.addWeighted(img_np, 0.6, heatmap_colored, 0.4, 0)
                    overlay_pil = Image.fromarray(overlay)
                    
                    # 5. Output clean single-image overlay (matching detection approach)
                    buf = io.BytesIO()
                    overlay_pil.save(buf, format="PNG")
                    explanation_image_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                    print("Universal feature activation map generation successful (clean single-image overlay)")
                    
            except Exception as e:
                print(f"XAI explanation generation failed: {e}")
                import traceback
                traceback.print_exc()

        prediction_result["explanation_image"] = explanation_image_b64
        
        print("Returning prediction result with annotations and explanations")
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
@app.delete("/api/v1/pipelines/{job_id}", tags=["Pipelines & Training"])
async def delete_pipeline(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Delete a training job and its associated resources"""
    check_job_access(job_id, current_user)
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

@app.get("/api/v1/datasets/available", tags=["Datasets"])
async def list_available_datasets(project_id: str = None, current_user: User = Depends(get_current_approved_user)):
    """List all available datasets, optionally filtered by project"""
    if project_id:
        check_project_access(project_id, current_user)
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
                
                # Check dataset access
                try:
                    check_dataset_access(d.name, current_user)
                except HTTPException:
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
                dataset_project_id = config.get("project_id", None) if 'config' in locals() else None
                if project_id and dataset_project_id != project_id:
                    continue

                datasets.append({
                    "id": d.name,
                    "name": dataset_name_from_config if dataset_name_from_config else d.name.replace('_', ' ').title(),
                    "classes": classes if classes else ["(COCO format dataset)"],
                    "task_type": task_type,
                    "item_count": item_count,
                    "is_coco_format": is_coco_dataset,
                    "project_id": dataset_project_id
                })
        
        return datasets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing datasets: {str(e)}")

from pathlib import Path

BASE_DIR = Path(__file__).parent.resolve()
DATASETS_DIR = BASE_DIR / "datasets"

@app.post("/api/v1/pipelines/{job_id}/dataset/{dataset_id}", tags=["Pipelines & Training"])
async def link_dataset_to_job(job_id: str, dataset_id: str, current_user: User = Depends(get_current_approved_user)):
    check_job_access(job_id, current_user)
    check_dataset_access(dataset_id, current_user)
    try:
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
        dataset_path = DATASETS_DIR / dataset_id
        # Lazy download dataset from MinIO if missing locally
        if not dataset_path.exists() or not dataset_path.is_dir():
            if minio_utils.exists(DATASETS_BUCKET, dataset_id):
                print(f"Dataset '{dataset_id}' not found locally for linking. Downloading from MinIO...")
                minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(dataset_path))
                
        print(f"Linking dataset: {dataset_id}")
        print(f"Dataset path: {dataset_path}")
        print(f"Dataset path exists: {dataset_path.exists()}")
        print(f"Dataset path is directory: {dataset_path.is_dir() if dataset_path.exists() else False}")
        
        all_datasets = [d.name for d in DATASETS_DIR.iterdir() if d.is_dir()]
        print(f"Available datasets: {all_datasets}")
        
        if not dataset_path.exists() or not dataset_path.is_dir():
            raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
        
        job.linked_dataset_id = dataset_id
        
        # Persist the link to disk so it survives container restarts
        try:
            models_base_dir = Path(os.getenv("MODELS_DIR", "logs/models"))
            link_file = models_base_dir / job_id / "linked_dataset.json"
            link_file.parent.mkdir(parents=True, exist_ok=True)
            with open(link_file, 'w') as f:
                json.dump({"dataset_id": dataset_id}, f)
            print(f"Persisted linked_dataset_id={dataset_id} to {link_file}")
        except Exception as e:
            print(f"Warning: Failed to persist dataset link: {e}")
        
        return {"message": f"Successfully linked dataset {dataset_id} to job {job_id}"}
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to link dataset: {str(e)}")

@app.post("/api/v1/upload-detection-dataset/{job_id}", tags=["Datasets"])
async def upload_detection_dataset(job_id: str, task_type: str = "object_detection", dataset_name: str = None, project_id: str = Form(None), file: UploadFile = File(...), current_user: User = Depends(get_current_approved_user)):
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
        if project_id:
            config["project_id"] = project_id
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
        
        # Sync the uploaded dataset folder to MinIO
        try:
            minio_utils.upload_directory(DATASETS_BUCKET, job_id, str(dataset_dir))
            print(f"Synced detection dataset directory {job_id} to MinIO")
        except Exception as e:
            print(f"Warning: Failed to sync detection dataset {job_id} to MinIO on upload: {e}")

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

@app.post("/api/v1/responsible-ai/class-balance", tags=["Responsible AI"])
async def analyze_class_balance(request: ClassBalanceRequest, current_user: User = Depends(get_current_approved_user)):
    """Analyze class balance in dataset. Accepts either a dataset_id (auto-extracts labels) or raw labels."""
    try:
        labels = None
        class_names = request.class_names

        # Clean dataset_id input
        dataset_id = request.dataset_id.strip() if request.dataset_id else None
        if dataset_id:
            check_dataset_access(dataset_id, current_user)

        if dataset_id:
            # Auto-extract labels from dataset directory structure
            dataset_path = Path(f"datasets/{dataset_id}")
            # Lazy download dataset from MinIO if missing locally
            if not dataset_path.exists() or not dataset_path.is_dir():
                if minio_utils.exists(DATASETS_BUCKET, dataset_id):
                    print(f"Dataset '{dataset_id}' not found locally for class balance analysis. Downloading from MinIO...")
                    minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(dataset_path))
                    
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

@app.post("/api/v1/responsible-ai/fairness-analysis", tags=["Responsible AI"])
async def analyze_fairness(request: FairnessAnalysisRequest, current_user: User = Depends(get_current_approved_user)):
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

def _get_dataset_details(dataset_id: str) -> Dict[str, Any]:
    """Helper to fetch dataset metadata for model cards"""
    dataset_path = Path("datasets") / dataset_id
    
    # Lazy download dataset from MinIO if missing locally
    if not dataset_path.exists():
        if minio_utils.exists(DATASETS_BUCKET, dataset_id):
            print(f"Dataset '{dataset_id}' not found locally for dataset details. Downloading from MinIO...")
            minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(dataset_path))
            
    details = {
        "name": dataset_id.replace('_', ' ').title(),
        "size": "N/A",
        "num_classes": "N/A",
        "source": "Local Upload",
        "preprocessing": "Resize to input dimensions"
    }
    
    if not dataset_path.exists():
        return details
        
    # Read config if it exists
    config_file = dataset_path / "dataset_config.json"
    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                config = json.load(f)
                if "dataset_name" in config:
                    details["name"] = config["dataset_name"]
                if "preprocessing" in config:
                    details["preprocessing"] = config["preprocessing"]
        except Exception as e:
            print(f"Error reading dataset config: {e}")
            
    # Check if COCO
    is_coco = False
    annotations_dir = dataset_path / "annotations"
    if annotations_dir.exists() and annotations_dir.is_dir():
        is_coco = True
    else:
        json_files = list(dataset_path.glob("*.json"))
        for json_file in json_files:
            try:
                with open(json_file, 'r') as f:
                    content = json.load(f)
                    if all(key in content for key in ["images", "annotations", "categories"]):
                        is_coco = True
                        break
            except:
                continue
                
    # Class lists and size
    classes = [c.name for c in dataset_path.iterdir() if c.is_dir() and not c.name == "annotations"]
    item_count = 0
    
    if is_coco:
        image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif']
        for ext in image_extensions:
            item_count += len(list(dataset_path.glob(f"**/*{ext}")))
        if item_count == 0:
            import glob
            for ext in image_extensions:
                found_images = glob.glob(str(dataset_path) + f"/**/*{ext}", recursive=True)
                item_count += len(found_images)
                
        # Fetch classes from JSON annotations
        if not classes:
            coco_jsons = list(annotations_dir.glob("*.json")) if annotations_dir.exists() else list(dataset_path.glob("*.json"))
            for json_file in coco_jsons:
                try:
                    with open(json_file, 'r') as f:
                        content = json.load(f)
                        if "categories" in content:
                            classes = [cat["name"] for cat in content["categories"]]
                            break
                except:
                    continue
    else:
        # Standard folder structure
        if classes:
            image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif']
            for cls in classes:
                class_path = dataset_path / cls
                if class_path.exists():
                    image_files = [f for f in class_path.iterdir() 
                                 if f.is_file() and any(f.name.lower().endswith(ext) for ext in image_extensions)]
                    item_count += len(image_files)
                    
    details["size"] = f"{item_count} samples" if item_count > 0 else "N/A"
    details["num_classes"] = len(classes) if classes else "N/A"
    
    return details

class ModelCardRequest(BaseModel):
    model_name: str
    model_architecture: str
    dataset_name: str
    training_metrics: Dict[str, float]
    fairness_results: Optional[Dict[str, Any]] = None

@app.post("/api/v1/responsible-ai/generate-model-card", tags=["Responsible AI"])
async def generate_model_card(request: ModelCardRequest, current_user: User = Depends(get_current_approved_user)):
    """Generate a model card with responsible AI information"""
    check_dataset_access(request.dataset_name, current_user)
    try:
        generator = ModelCardGenerator()
        generator.auto_populate_from_training(
            model_name=request.model_name,
            model_architecture=request.model_architecture,
            dataset_name=request.dataset_name,
            training_metrics=request.training_metrics,
            fairness_results=request.fairness_results
        )
        
        # Populate actual dataset details if available
        dataset_details = _get_dataset_details(request.dataset_name)
        generator.set_dataset_info(
            dataset_name=dataset_details["name"],
            dataset_size=dataset_details["size"],
            num_classes=dataset_details["num_classes"],
            data_source=dataset_details["source"],
            data_preprocessing=dataset_details["preprocessing"]
        )
        
        model_card = generator.generate_model_card()
        json_card = generator.generate_json_model_card()
        
        return {
            "model_card_markdown": model_card,
            "model_card_json": json_card
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model card generation failed: {str(e)}")

@app.get("/api/v1/pipelines/{job_id}/model-card", tags=["Responsible AI"])
@app.post("/api/v1/pipelines/{job_id}/model-card", tags=["Responsible AI"])
async def get_pipeline_model_card(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Generate and retrieve a model card for a completed training job"""
    check_job_access(job_id, current_user)
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    if job.status != TrainingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Model card can only be generated for completed jobs")
    
    # Resolve dataset name
    dataset_name = "Unknown Dataset"
    if job.linked_dataset_id:
        dataset_name = job.linked_dataset_id
    elif job.pipeline_config.name:
        dataset_name = f"Dataset for {job.pipeline_config.name}"
        
    try:
        generator = ModelCardGenerator()
        generator.auto_populate_from_training(
            model_name=job.pipeline_config.name,
            model_architecture=job.pipeline_config.architecture.value if hasattr(job.pipeline_config.architecture, 'value') else str(job.pipeline_config.architecture),
            dataset_name=dataset_name,
            training_metrics=job.metrics or {"accuracy": 0.0},
            fairness_results=None
        )
        
        # Populate actual dataset details if available
        if job.linked_dataset_id:
            dataset_details = _get_dataset_details(job.linked_dataset_id)
            generator.set_dataset_info(
                dataset_name=dataset_details["name"],
                dataset_size=dataset_details["size"],
                num_classes=dataset_details["num_classes"],
                data_source=dataset_details["source"],
                data_preprocessing=dataset_details["preprocessing"]
            )
            
        model_card = generator.generate_model_card()
        json_card = generator.generate_json_model_card()
        
        return {
            "model_card_markdown": model_card,
            "model_card_json": json_card
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Model card generation failed: {str(e)}")

@app.get("/api/v1/responsible-ai/bias-types", tags=["Responsible AI"])
async def get_bias_types(current_user: User = Depends(get_current_approved_user)):
    """Get information about different types of bias"""
    try:
        library = BiasResourceLibrary()
        return {"bias_types": library.bias_types}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve bias types: {str(e)}")

@app.get("/api/v1/responsible-ai/bias-examples", tags=["Responsible AI"])
async def get_bias_examples(domain: Optional[str] = None, current_user: User = Depends(get_current_approved_user)):
    """Get real-world bias examples"""
    try:
        library = BiasResourceLibrary()
        examples = library.get_bias_examples(domain)
        return {"bias_examples": examples}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve bias examples: {str(e)}")

@app.get("/api/v1/responsible-ai/mitigation-strategies", tags=["Responsible AI"])
async def get_mitigation_strategies(stage: Optional[str] = None, current_user: User = Depends(get_current_approved_user)):
    """Get bias mitigation strategies"""
    try:
        library = BiasResourceLibrary()
        strategies = library.get_mitigation_strategies(stage)
        return {"mitigation_strategies": strategies}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve mitigation strategies: {str(e)}")

@app.get("/api/v1/responsible-ai/checklist", tags=["Responsible AI"])
async def get_bias_checklist(category: Optional[str] = None, current_user: User = Depends(get_current_approved_user)):
    """Get bias detection and mitigation checklist"""
    try:
        library = BiasResourceLibrary()
        checklist = library.get_checklist(category)
        return {"checklist": checklist}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve checklist: {str(e)}")

@app.post("/api/v1/responsible-ai/bias-report", tags=["Responsible AI"])
async def generate_bias_report(detected_biases: List[str], current_user: User = Depends(get_current_approved_user)):
    """Generate a comprehensive bias report"""
    try:
        library = BiasResourceLibrary()
        report = library.generate_bias_report(detected_biases)
        return {"bias_report": report}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate bias report: {str(e)}")

@app.get("/api/v1/responsible-ai/search", tags=["Responsible AI"])
async def search_bias_info(query: str, current_user: User = Depends(get_current_approved_user)):
    """Search bias information by keyword"""
    try:
        library = BiasResourceLibrary()
        results = library.search_bias_info(query)
        return {"search_results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")

@app.post("/api/v1/responsible-ai/dataset-validation/{dataset_id}", tags=["Responsible AI"])
@app.post("/api/v1/datasets/{dataset_id}/data-card", tags=["Responsible AI"])
async def validate_dataset(dataset_id: str, current_user: User = Depends(get_current_approved_user)):
    """Validate dataset and generate a Data Card with visual statistics."""
    check_dataset_access(dataset_id, current_user)
    try:
        from visualization_utils import (
            create_class_distribution_plot, pil_to_base64, 
            draw_bounding_boxes, draw_instance_segmentation
        )
        dataset_path = Path(f"datasets/{dataset_id}")
        # Lazy download dataset from MinIO if missing locally
        if not dataset_path.exists() or not dataset_path.is_dir():
            if minio_utils.exists(DATASETS_BUCKET, dataset_id):
                print(f"Dataset '{dataset_id}' not found locally for validation. Downloading from MinIO...")
                minio_utils.download_directory(DATASETS_BUCKET, dataset_id, str(dataset_path))
                
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

            # Find active category IDs across all JSON annotation files in the dataset
            active_cat_ids = set()
            for jf in json_files:
                try:
                    with open(jf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if "annotations" in data:
                            for ann in data["annotations"]:
                                if "category_id" in ann:
                                    active_cat_ids.add(ann["category_id"])
                except: continue

            if target_json:
                if not active_cat_ids:
                    active_cat_ids = {cat["id"] for cat in target_json["categories"]}
                    
                cat_id_to_name = {
                    cat["id"]: cat.get("name", str(cat["id"])) 
                    for cat in target_json["categories"] 
                    if cat["id"] in active_cat_ids
                }
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
                                        det = {
                                            "box": [x, y, x+w, y+h],
                                            "class_name": c_n,
                                            "confidence": 100.0
                                        }
                                        if task_type == "instance_segmentation" and "segmentation" in a:
                                            det["polygon"] = a["segmentation"]
                                        detections.append(det)
                                if detections:
                                    if task_type == "instance_segmentation":
                                        pil_img = draw_instance_segmentation(pil_img, detections)
                                    else:
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
            "sample_images": sample_images,
            "class_distribution": class_distribution
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")


# ==================== Visual Pipeline Builder Endpoints ====================

@app.get("/api/v1/projects/{project_id}/workflow/canvas", tags=["Projects"])
async def get_workflow_canvas(project_id: str, current_user: User = Depends(get_current_approved_user)):
    """Get the currently saved visual workflow state for a project"""
    check_project_access(project_id, current_user)
    state_file = Path(__file__).resolve().parent / "logs" / "projects" / project_id / "workflow_state.json"
    if state_file.exists():
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    # Return 404 so frontend can load default workflow
    raise HTTPException(status_code=404, detail="Workflow not found")

@app.post("/api/v1/projects/{project_id}/workflow/canvas", tags=["Projects"])
async def save_workflow_canvas(project_id: str, state: dict, current_user: User = Depends(get_current_approved_user)):
    """Save the visual workflow state for a project"""
    check_project_access(project_id, current_user)
    try:
        state_file = Path(__file__).resolve().parent / "logs" / "projects" / project_id / "workflow_state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        return {"status": "success", "message": "Workflow saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save workflow: {str(e)}")

@app.get("/api/v1/workflow/trained_models", tags=["Pipelines & Training"])
async def get_trained_models(current_user: User = Depends(get_current_approved_user)):
    """Get all completed trained models grouped by task type"""
    jobs = job_manager.list_jobs()
    trained_models = {
        "image_classification": [],
        "object_detection": [],
        "image_segmentation": []
    }
    
    # Get projects owned by user to filter jobs
    user_project_ids = None
    if current_user.role != "admin":
        user_project_ids = {p.id for p in project_manager.list_projects() if p.owner_id == current_user.id}
    
    for job in jobs:
        # Check if job status is completed/success
        status_lower = str(job.status).lower()
        if "completed" in status_lower or "success" in status_lower:
            proj_id = getattr(job.pipeline_config, 'project_id', None)
            if current_user.role != "admin" and proj_id not in user_project_ids:
                continue
                
            task_type = str(job.pipeline_config.task_type)
            if task_type in trained_models:
                trained_models[task_type].append({
                    "id": job.id,
                    "name": job.pipeline_config.name,
                    "architecture": str(job.pipeline_config.architecture),
                    "created_at": job.created_at.isoformat() if hasattr(job.created_at, "isoformat") else str(job.created_at),
                    "metrics": job.metrics
                })
                
    return trained_models

@app.get("/api/v1/pipelines/{job_id}/training-metrics", tags=["Pipelines & Training"])
async def get_training_metrics(job_id: str, current_user: User = Depends(get_current_approved_user)):
    """Fetch training metrics from MLflow or local job history and generate task-specific plots."""
    import base64
    import io
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from mlflow.tracking import MlflowClient
    from mlflow_utils import EXPERIMENT_NAME
    import mlflow

    client = MlflowClient()
    train_loss_steps, t_loss = [], []
    val_loss_steps, v_loss = [], []

    sec_metric_name = "Accuracy"
    train_sec_steps, t_sec = [], []
    val_sec_steps, v_sec = [], []

    job = job_manager.get_job(job_id)
    task_type = str(getattr(job.pipeline_config, "task_type", "")).lower() if (job and hasattr(job, "pipeline_config")) else ""

    if "detection" in task_type:
        sec_metric_name = "mAP"
    elif "segmentation" in task_type:
        sec_metric_name = "mIoU"

    def get_sorted_history(history_list):
        if not history_list:
            return [], []
        step_to_val = {}
        for m in history_list:
            try:
                step_to_val[int(m.step)] = float(m.value)
            except Exception:
                pass
        sorted_steps = sorted(step_to_val.keys())
        sorted_vals = [step_to_val[s] for s in sorted_steps]
        return sorted_steps, sorted_vals

    # 1. Try fetching from MLflow
    try:
        run_id = None
        experiment = mlflow.get_experiment_by_name(EXPERIMENT_NAME)
        if experiment:
            runs = client.search_runs(
                experiment_ids=[experiment.experiment_id],
                filter_string=f"attributes.run_name = 'job_{job_id}'"
            )
            if runs:
                run_id = runs[0].info.run_id

        if run_id:
            train_loss = client.get_metric_history(run_id, "train_loss")
            val_loss = client.get_metric_history(run_id, "val_loss")

            t_sec_hist = (client.get_metric_history(run_id, "train_accuracy") or
                          client.get_metric_history(run_id, "train_acc") or
                          client.get_metric_history(run_id, "train_miou"))
            v_sec_hist = (client.get_metric_history(run_id, "val_accuracy") or
                          client.get_metric_history(run_id, "val_acc") or
                          client.get_metric_history(run_id, "mAP") or
                          client.get_metric_history(run_id, "val_mAP") or
                          client.get_metric_history(run_id, "map") or
                          client.get_metric_history(run_id, "val_miou") or
                          client.get_metric_history(run_id, "miou"))

            train_loss_steps, t_loss = get_sorted_history(train_loss)
            val_loss_steps, v_loss = get_sorted_history(val_loss)
            train_sec_steps, t_sec = get_sorted_history(t_sec_hist)
            val_sec_steps, v_sec = get_sorted_history(v_sec_hist)

            if "detection" in task_type and v_sec:
                sec_metric_name = "mAP"
            elif "segmentation" in task_type and (t_sec or v_sec):
                sec_metric_name = "mIoU"
            elif (t_sec or v_sec) and not ("detection" in task_type or "segmentation" in task_type):
                sec_metric_name = "Accuracy"
    except Exception:
        pass

    # 2. Fallback to local job history if metrics not found in MLflow
    if not train_loss_steps and not t_loss:
        if job and job.history:
            for item in job.history:
                if isinstance(item, dict):
                    ep = item.get("epoch", len(train_loss_steps) + 1)
                    if "train_loss" in item and item["train_loss"] is not None:
                        train_loss_steps.append(ep)
                        t_loss.append(float(item["train_loss"]))
                    if "val_loss" in item and item["val_loss"] is not None:
                        val_loss_steps.append(ep)
                        v_loss.append(float(item["val_loss"]))

                    # Accuracy
                    if "train_accuracy" in item and item["train_accuracy"] is not None:
                        train_sec_steps.append(ep)
                        t_sec.append(float(item["train_accuracy"]))
                    elif "train_acc" in item and item["train_acc"] is not None:
                        train_sec_steps.append(ep)
                        t_sec.append(float(item["train_acc"]))

                    if "val_accuracy" in item and item["val_accuracy"] is not None:
                        val_sec_steps.append(ep)
                        v_sec.append(float(item["val_accuracy"]))
                    elif "val_acc" in item and item["val_acc"] is not None:
                        val_sec_steps.append(ep)
                        v_sec.append(float(item["val_acc"]))

                    # mAP (Object Detection)
                    if "mAP" in item and item["mAP"] is not None:
                        val_sec_steps.append(ep)
                        v_sec.append(float(item["mAP"]))
                        sec_metric_name = "mAP"
                    elif "val_mAP" in item and item["val_mAP"] is not None:
                        val_sec_steps.append(ep)
                        v_sec.append(float(item["val_mAP"]))
                        sec_metric_name = "mAP"

                    # mIoU (Segmentation)
                    if "val_miou" in item and item["val_miou"] is not None:
                        val_sec_steps.append(ep)
                        v_sec.append(float(item["val_miou"]))
                        sec_metric_name = "mIoU"

    if not train_loss_steps and not t_loss:
        return {"error": "No training metrics found."}

    try:
        has_sec_data = bool(train_sec_steps or val_sec_steps)

        if has_sec_data:
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
        else:
            fig, ax1 = plt.subplots(1, 1, figsize=(7, 4.5))
            ax2 = None

        # Loss plot
        if train_loss_steps:
            ax1.plot(train_loss_steps, t_loss, label='Train Loss', color='#2563eb', linewidth=2, marker='o', markersize=4)
        if val_loss_steps:
            ax1.plot(val_loss_steps, v_loss, label='Val Loss', color='#f59e0b', linewidth=2, marker='s', markersize=4)
        ax1.set_title('Loss over Epochs', fontsize=13, fontweight='bold', pad=10)
        ax1.set_xlabel('Epoch', fontsize=10)
        ax1.set_ylabel('Loss', fontsize=10)
        if ax1.get_legend_handles_labels()[0]:
            ax1.legend(loc='best', frameon=True)
        ax1.grid(True, linestyle='--', alpha=0.6)

        # Secondary metric plot if available (Accuracy / mAP / mIoU)
        if has_sec_data and ax2:
            if train_sec_steps:
                ax2.plot(train_sec_steps, t_sec, label=f'Train {sec_metric_name}', color='#10b981', linewidth=2, marker='o', markersize=4)
            if val_sec_steps:
                ax2.plot(val_sec_steps, v_sec, label=f'Val {sec_metric_name}', color='#ef4444', linewidth=2, marker='s', markersize=4)
            ax2.set_title(f'{sec_metric_name} over Epochs', fontsize=13, fontweight='bold', pad=10)
            ax2.set_xlabel('Epoch', fontsize=10)
            ax2.set_ylabel(sec_metric_name, fontsize=10)
            if ax2.get_legend_handles_labels()[0]:
                ax2.legend(loc='best', frameon=True)
            ax2.grid(True, linestyle='--', alpha=0.6)

        plt.tight_layout()
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=130)
        plt.close()

        plot_base64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        return {"training_curves_base64": plot_base64}
    except Exception as e:
        return {"error": str(e)}

# ==================== Visual Dataset Annotator Endpoints ====================

class AnnItemInput(BaseModel):
    class_id: int
    shape_type: str = "bbox"          # bbox | polygon | point | classification
    x_center: float = 0.0
    y_center: float = 0.0
    width: float = 0.0
    height: float = 0.0
    points: List[List[float]] = []    # [[x1,y1],[x2,y2],...]

@app.put("/api/v1/projects/{project_id}", tags=["Projects"])
async def update_project_metadata(project_id: str, project_data: Project, current_user: User = Depends(get_current_approved_user)):
    project = check_project_access(project_id, current_user)
    project.name = project_data.name
    project.description = project_data.description
    project.classes = project_data.classes
    project_manager.projects[project_id] = project
    project_manager.save_projects()
    return project

@app.delete("/api/v1/projects/{project_id}", tags=["Projects"])
async def delete_project(project_id: str, current_user: User = Depends(get_current_approved_user)):
    import shutil
    project = check_project_access(project_id, current_user)
    
    if project_id in project_manager.projects:
        del project_manager.projects[project_id]
        project_manager.save_projects()
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    if project_dir.exists():
        try:
            shutil.rmtree(project_dir)
        except Exception as e:
            print(f"Error deleting project directory: {e}")
            
    return {"message": "Project deleted successfully"}

@app.get("/api/v1/projects/{project_id}/images", tags=["Projects"])
async def list_project_images(project_id: str, current_user: User = Depends(get_current_approved_user)):
    import os, json
    from pathlib import Path
    
    project = check_project_access(project_id, current_user)
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    
    if not metadata_file.exists():
        return []
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        return []
        
    annotations_file = project_dir / "annotations.json"
    annotations = {}
    if annotations_file.exists():
        try:
            with open(annotations_file, "r", encoding="utf-8") as f:
                annotations = json.load(f)
        except:
            pass
            
    images_list = []
    for img_id_str, img in metadata.items():
        has_anns = len(annotations.get(img_id_str, [])) > 0
        img["annotated"] = has_anns
        images_list.append(img)
    return images_list

@app.post("/api/v1/projects/{project_id}/images", tags=["Projects"])
async def upload_project_images(project_id: str, files: List[UploadFile] = File(...), current_user: User = Depends(get_current_approved_user)):
    import os, uuid, json
    from pathlib import Path
    from PIL import Image as PILImage
    
    project = check_project_access(project_id, current_user)
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    images_dir = project_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    
    metadata_file = project_dir / "images_metadata.json"
    metadata = {}
    if metadata_file.exists():
        try:
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except:
            pass
            
    existing_ids = [int(k) for k in metadata.keys()]
    next_id = max(existing_ids) + 1 if existing_ids else 1
    
    saved_images = []
    for file in files:
        ext = os.path.splitext(file.filename or "")[1].lower()
        if ext not in (".jpg", ".jpeg", ".png", ".bmp", ".webp"):
            continue
            
        unique_name = f"{uuid.uuid4().hex}{ext}"
        dest_path = images_dir / unique_name
        
        with open(dest_path, "wb") as f:
            content = await file.read()
            f.write(content)
            
        file_size = os.path.getsize(dest_path)
        width, height = 0, 0
        color_space = "RGB"
        is_corrupt = False
        
        try:
            pil_img = PILImage.open(dest_path)
            pil_img.verify()
            pil_img = PILImage.open(dest_path)
            width, height = pil_img.size
            channels = 1 if pil_img.mode in ("L", "LA") else 3
            color_space = "Grayscale" if channels == 1 else "RGB"
        except Exception:
            is_corrupt = True
            
        img_id = next_id
        next_id += 1
        
        img_metadata = {
            "id": img_id,
            "filename": unique_name,
            "original_name": file.filename or unique_name,
            "annotated": False,
            "width": width,
            "height": height,
            "color_space": color_space,
            "is_corrupt": is_corrupt,
            "file_size": file_size
        }
        
        metadata[str(img_id)] = img_metadata
        saved_images.append(img_metadata)
        
    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        
    return saved_images

@app.get("/api/v1/projects/{project_id}/images/{image_id}/file", tags=["Projects"])
async def get_project_image_file(project_id: str, image_id: str, current_user: User = Depends(get_current_approved_user)):
    from pathlib import Path
    from fastapi.responses import FileResponse
    import json
    
    check_project_access(project_id, current_user)
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Image list not found")
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load image metadata")
        
    img_info = metadata.get(image_id)
    if not img_info:
        raise HTTPException(status_code=404, detail="Image not found in metadata")
        
    img_path = project_dir / "images" / img_info["filename"]
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")
        
    return FileResponse(img_path)

@app.delete("/api/v1/projects/{project_id}/images/{image_id}", tags=["Projects"])
async def delete_project_image(project_id: str, image_id: str, current_user: User = Depends(get_current_approved_user)):
    import os, json
    from pathlib import Path
    
    check_project_access(project_id, current_user)
    
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Image list not found")
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load image metadata")
        
    img_info = metadata.get(image_id)
    if not img_info:
        raise HTTPException(status_code=404, detail="Image not found in metadata")
        
    img_path = project_dir / "images" / img_info["filename"]
    if img_path.exists():
        try:
            os.remove(img_path)
        except Exception:
            pass
            
    metadata.pop(image_id, None)
    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
        
    annotations_file = project_dir / "annotations.json"
    if annotations_file.exists():
        try:
            with open(annotations_file, "r", encoding="utf-8") as f:
                annotations = json.load(f)
            annotations.pop(image_id, None)
            with open(annotations_file, "w", encoding="utf-8") as f:
                json.dump(annotations, f, indent=2)
        except Exception:
            pass
            
    return {"ok": True}

@app.get("/api/v1/projects/{project_id}/images/{image_id}/annotations", tags=["Projects"])
async def get_project_image_annotations(project_id: str, image_id: str, current_user: User = Depends(get_current_approved_user)):
    import json
    from pathlib import Path
    
    check_project_access(project_id, current_user)
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    annotations_file = project_dir / "annotations.json"
    
    if not annotations_file.exists():
        return []
        
    try:
        with open(annotations_file, "r", encoding="utf-8") as f:
            annotations = json.load(f)
        return annotations.get(image_id, [])
    except Exception:
        return []

@app.post("/api/v1/projects/{project_id}/images/{image_id}/annotations", tags=["Projects"])
async def save_project_image_annotations(project_id: str, image_id: str, shapes: List[AnnItemInput], current_user: User = Depends(get_current_approved_user)):
    import json
    from pathlib import Path
    
    check_project_access(project_id, current_user)
    
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    annotations_file = project_dir / "annotations.json"
    
    annotations = {}
    if annotations_file.exists():
        try:
            with open(annotations_file, "r", encoding="utf-8") as f:
                annotations = json.load(f)
        except:
            pass
            
    saved_shapes = []
    for idx, shape in enumerate(shapes):
        saved_shapes.append({
            "id": idx + 1,
            "class_id": shape.class_id,
            "shape_type": shape.shape_type,
            "x_center": shape.x_center,
            "y_center": shape.y_center,
            "width": shape.width,
            "height": shape.height,
            "points": shape.points
        })
        
    annotations[image_id] = saved_shapes
    
    with open(annotations_file, "w", encoding="utf-8") as f:
        json.dump(annotations, f, indent=2)
        
    metadata_file = project_dir / "images_metadata.json"
    if metadata_file.exists():
        try:
            with open(metadata_file, "r", encoding="utf-8") as f:
                metadata = json.load(f)
            if image_id in metadata:
                metadata[image_id]["annotated"] = len(saved_shapes) > 0
                with open(metadata_file, "w", encoding="utf-8") as f:
                    json.dump(metadata, f, indent=2)
        except Exception:
            pass
            
    return saved_shapes

_sam_model = None
def _get_sam_model():
    global _sam_model
    if _sam_model is None:
        from ultralytics import SAM
        # Load mobile_sam.pt
        _sam_model = SAM("mobile_sam.pt")
    return _sam_model

class SamSegmentRequest(BaseModel):
    points: List[List[float]] = []
    labels: List[int] = []
    box: Optional[List[float]] = None

@app.post("/api/v1/projects/{project_id}/images/{image_id}/sam-segment", tags=["Projects"])
async def sam_segment(project_id: str, image_id: str, payload: SamSegmentRequest, current_user: User = Depends(get_current_approved_user)):
    import json
    from pathlib import Path
    from PIL import Image as PILImage
    import traceback
    
    check_project_access(project_id, current_user)
    
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Image list not found")
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load image metadata")
        
    img_info = metadata.get(image_id)
    if not img_info:
        raise HTTPException(status_code=404, detail="Image not found in metadata")
        
    img_path = project_dir / "images" / img_info["filename"]
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")
        
    try:
        # Load image size
        img = PILImage.open(img_path)
        w, h = img.size
        
        # Load model
        model = _get_sam_model()
        
        # Convert coords to absolute pixels
        prompts = {}
        if payload.points:
            abs_pts = [[p[0] * w, p[1] * h] for p in payload.points]
            prompts["points"] = abs_pts
            prompts["labels"] = payload.labels
            
        if payload.box:
            bx1, by1, bx2, by2 = payload.box
            prompts["bboxes"] = [[bx1 * w, by1 * h, bx2 * w, by2 * h]]
            
        if not prompts:
            return {"points": []}
            
        results = model.predict(source=img_path, device="cpu", **prompts)
        if not results or len(results) == 0:
            return {"points": []}
            
        res = results[0]
        if res.masks is None or len(res.masks.xy) == 0:
            return {"points": []}
            
        # Get the first mask's polygon vertices and normalize back to [0..1]
        poly = res.masks.xy[0]
        norm_pts = [[float(pt[0] / w), float(pt[1] / h)] for pt in poly]
        
        return {"points": norm_pts}
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/projects/{project_id}/images/{image_id}/auto-annotate", tags=["Projects"])
async def auto_annotate_project_image(
    project_id: str,
    image_id: str,
    conf: float = 0.5,
    run_id: Optional[str] = None,
    external_model_id: Optional[str] = None,
    current_user: User = Depends(get_current_approved_user)
):
    import json
    from pathlib import Path
    from PIL import Image as PILImage
    import traceback
    
    project = check_project_access(project_id, current_user)
    
    # Helper to map class name (string) to array index string (e.g. "0", "1")
    def get_class_id_str(class_name: str) -> str:
        try:
            return str(project.classes.index(class_name))
        except ValueError:
            # Fallback if class_name is already a string number or not found
            if class_name.isdigit():
                return class_name
            return "0"
            
    # 1. Resolve image filepath
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    
    if not metadata_file.exists():
        raise HTTPException(status_code=404, detail="Image list not found")
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load image metadata")
        
    img_info = metadata.get(image_id)
    if not img_info:
        raise HTTPException(status_code=404, detail="Image not found in metadata")
        
    img_path = project_dir / "images" / img_info["filename"]
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image file not found on disk")
        
    # 2. Get active job / model configuration
    job_id = run_id
    if not job_id and external_model_id:
        job_id = external_model_id
        
    if not job_id:
        raise HTTPException(status_code=400, detail="No active model run selected")
        
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        
    if job.status != TrainingStatus.COMPLETED:
        raise HTTPException(status_code=400, detail=f"Model run is not completed. Status: {job.status}")
        
    if not job.model_path or not Path(job.model_path).exists():
        raise HTTPException(status_code=400, detail="Model weights file not found on server")

    # 3. Load image & run predict
    try:
        pil_img = PILImage.open(img_path)
        img_w, img_h = pil_img.size
        
        # Make prediction
        pred_result = await job_manager.predict(job_id, pil_img)
        
        suggested_annotations = []
        task_type = job.pipeline_config.task_type
        
        # 4. Map output to normalized AnnData shapes
        if task_type == TaskType.OBJECT_DETECTION:
            detections = pred_result.get("predictions", pred_result.get("detections", []))
            for d in detections:
                confidence_score = d.get("confidence", 100.0) / 100.0
                if confidence_score < conf:
                    continue
                    
                box = d.get("box") # [x1, y1, x2, y2]
                if not box or len(box) != 4:
                    continue
                    
                x1, y1, x2, y2 = box
                
                # Normalize relative to [0..1]
                w_rel = float((x2 - x1) / img_w)
                h_rel = float((y2 - y1) / img_h)
                x_cen_rel = float((x1 + x2) / (2 * img_w))
                y_cen_rel = float((y1 + y2) / (2 * img_h))
                
                class_name = d.get("class_name", "unknown")
                suggested_annotations.append({
                    "class_id": get_class_id_str(class_name),
                    "shape_type": "bbox",
                    "x_center": x_cen_rel,
                    "y_center": y_cen_rel,
                    "width": w_rel,
                    "height": h_rel,
                    "points": []
                })
                
        elif task_type == TaskType.IMAGE_SEGMENTATION:
            if job.pipeline_config.segmentation_type == "instance":
                labels = pred_result.get("labels", [])
                scores = pred_result.get("scores", [])
                masks = pred_result.get("masks", [])
                boxes = pred_result.get("boxes", [])
                
                class_names = job.pipeline_config.classes or []
                
                for idx, score in enumerate(scores):
                    if score < conf:
                        continue
                        
                    label_idx = labels[idx]
                    class_name = class_names[label_idx] if label_idx < len(class_names) else f"class_{label_idx}"
                    
                    import numpy as np
                    import cv2
                    
                    mask = np.array(masks[idx], dtype=np.uint8)
                    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    
                    for contour in contours:
                        if len(contour) < 3:
                            continue
                            
                        epsilon = 0.005 * cv2.arcLength(contour, True)
                        approx = cv2.approxPolyDP(contour, epsilon, True)
                        
                        points = []
                        for pt in approx:
                            x_px, y_px = pt[0]
                            points.append([float(x_px / img_w), float(y_px / img_h)])
                            
                        if len(points) >= 3:
                            x_coords = [p[0] for p in points]
                            y_coords = [p[1] for p in points]
                            x_min, x_max = min(x_coords), max(x_coords)
                            y_min, y_max = min(y_coords), max(y_coords)
                            
                            suggested_annotations.append({
                                "class_id": get_class_id_str(class_name),
                                "shape_type": "polygon",
                                "x_center": (x_min + x_max) / 2,
                                "y_center": (y_min + y_max) / 2,
                                "width": x_max - x_min,
                                "height": y_max - y_min,
                                "points": points
                            })
            else:
                import numpy as np
                import cv2
                
                mask_grid = np.array(pred_result.get("segmentation_mask", []), dtype=np.uint8)
                if mask_grid.size > 0:
                    class_names = job.pipeline_config.classes or []
                    unique_labels = np.unique(mask_grid)
                    
                    for label_idx in unique_labels:
                        if label_idx == 0:
                            continue
                            
                        class_name = class_names[label_idx] if label_idx < len(class_names) else f"class_{label_idx}"
                        label_mask = (mask_grid == label_idx).astype(np.uint8)
                        
                        contours, _ = cv2.findContours(label_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                        for contour in contours:
                            if len(contour) < 3:
                                continue
                                
                            epsilon = 0.005 * cv2.arcLength(contour, True)
                            approx = cv2.approxPolyDP(contour, epsilon, True)
                            
                            points = []
                            for pt in approx:
                                x_px, y_px = pt[0]
                                points.append([float(x_px / img_w), float(y_px / img_h)])
                                
                            if len(points) >= 3:
                                x_coords = [p[0] for p in points]
                                y_coords = [p[1] for p in points]
                                x_min, x_max = min(x_coords), max(x_coords)
                                y_min, y_max = min(y_coords), max(y_coords)
                                
                                suggested_annotations.append({
                                    "class_id": get_class_id_str(class_name),
                                    "shape_type": "polygon",
                                    "x_center": (x_min + x_max) / 2,
                                    "y_center": (y_min + y_max) / 2,
                                    "width": x_max - x_min,
                                    "height": y_max - y_min,
                                    "points": points
                                })
                                
        elif task_type == TaskType.IMAGE_CLASSIFICATION:
            predictions = pred_result.get("predictions", [])
            if predictions:
                best_pred = max(predictions, key=lambda x: x.get("confidence", 0.0))
                best_conf = best_pred.get("confidence", 0.0) / 100.0
                if best_conf >= conf:
                    class_name = best_pred.get("class_name", "unknown")
                    suggested_annotations.append({
                        "class_id": get_class_id_str(class_name),
                        "shape_type": "bbox",
                        "x_center": 0.5,
                        "y_center": 0.5,
                        "width": 1.0,
                        "height": 1.0,
                        "points": []
                    })
                    
        return {"annotations": suggested_annotations}
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Auto-annotate execution failed: {str(e)}")


@app.post("/api/v1/projects/{project_id}/import-zip-dataset", tags=["Projects"])
async def import_project_zip_dataset(
    project_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_approved_user)
):
    import json
    import zipfile
    import shutil
    import tempfile
    from pathlib import Path
    from PIL import Image as PILImage
    import uuid
    import traceback
    
    project = check_project_access(project_id, current_user)
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    images_dir = project_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Create temporary directory to unpack zip
    temp_dir = Path(tempfile.mkdtemp())
    try:
        zip_path = temp_dir / "dataset.zip"
        with open(zip_path, "wb") as f:
            f.write(await file.read())
            
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(temp_dir)
            
        # 2. Look for COCO JSON files
        coco_json_path = None
        for p in temp_dir.rglob("*.json"):
            if p.name == "dataset_config.json":
                continue
            try:
                with open(p, "r", encoding="utf-8") as f:
                    sample = f.read(2000)
                    if '"images"' in sample and '"categories"' in sample:
                        coco_json_path = p
                        break
            except:
                pass
                
        metadata_file = project_dir / "images_metadata.json"
        annotations_file = project_dir / "annotations.json"
        
        metadata = {}
        if metadata_file.exists():
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
            except: pass
            
        annotations = {}
        if annotations_file.exists():
            try:
                with open(annotations_file, "r", encoding="utf-8") as f:
                    annotations = json.load(f)
            except: pass
            
        new_classes = list(project.classes)
        
        # 3. Check if we found a COCO dataset zip (Detection/Segmentation)
        if coco_json_path:
            with open(coco_json_path, "r", encoding="utf-8") as f:
                coco_data = json.load(f)
                
            coco_categories = coco_data.get("categories", [])
            cat_id_to_name = {}
            for cat in coco_categories:
                cat_name = cat.get("name")
                cat_id = cat.get("id")
                cat_id_to_name[cat_id] = cat_name
                if cat_name not in new_classes:
                    new_classes.append(cat_name)
                    
            if len(new_classes) > len(project.classes):
                project.classes = new_classes
                project_manager.projects[project_id] = project
                project_manager.save_projects()
                
            coco_images = coco_data.get("images", [])
            filename_to_coco_id = {}
            coco_id_to_info = {}
            for img in coco_images:
                img_id = img.get("id")
                file_name = Path(img.get("file_name")).name
                filename_to_coco_id[file_name] = img_id
                coco_id_to_info[img_id] = {
                    "filename": file_name,
                    "width": img.get("width"),
                    "height": img.get("height")
                }
                
            coco_id_to_local_id = {}
            for p in temp_dir.rglob("*"):
                if p.is_file() and p.suffix.lower() in [".jpg", ".jpeg", ".png", ".bmp"]:
                    base_name = p.name
                    if base_name in filename_to_coco_id:
                        coco_id = filename_to_coco_id[base_name]
                        local_id = str(uuid.uuid4()).replace("-", "")[:24]
                        coco_id_to_local_id[coco_id] = local_id
                        
                        dest_path = images_dir / base_name
                        shutil.copy2(p, dest_path)
                        
                        img_info = coco_id_to_info[coco_id]
                        metadata[local_id] = {
                            "id": local_id,
                            "filename": base_name,
                            "width": img_info["width"],
                            "height": img_info["height"],
                            "annotated": False,
                            "color_space": "RGB"
                        }
                        annotations[local_id] = []
                        
            coco_anns = coco_data.get("annotations", [])
            for ann in coco_anns:
                img_id = ann.get("image_id")
                if img_id not in coco_id_to_local_id:
                    continue
                    
                local_id = coco_id_to_local_id[img_id]
                cat_id = ann.get("category_id")
                class_name = cat_id_to_name.get(cat_id, "unknown")
                try:
                    class_idx = project.classes.index(class_name)
                except ValueError:
                    class_idx = 0
                    
                img_info = coco_id_to_info[img_id]
                img_w = img_info["width"] or 1
                img_h = img_info["height"] or 1
                
                segmentation = ann.get("segmentation", [])
                bbox = ann.get("bbox")
                
                if segmentation and isinstance(segmentation, list) and len(segmentation) > 0 and len(segmentation[0]) >= 6:
                    poly_pts_px = segmentation[0]
                    pts_rel = []
                    for i in range(0, len(poly_pts_px), 2):
                        px = poly_pts_px[i]
                        py = poly_pts_px[i+1]
                        pts_rel.append([float(px / img_w), float(py / img_h)])
                        
                    xs = [p[0] for p in pts_rel]
                    ys = [p[1] for p in pts_rel]
                    x_min, x_max = min(xs), max(xs)
                    y_min, y_max = min(ys), max(ys)
                    
                    annotations[local_id].append({
                        "id": len(annotations[local_id]) + 1,
                        "class_id": str(class_idx),
                        "shape_type": "polygon",
                        "x_center": (x_min + x_max) / 2,
                        "y_center": (y_min + y_max) / 2,
                        "width": x_max - x_min,
                        "height": y_max - y_min,
                        "points": pts_rel
                    })
                    metadata[local_id]["annotated"] = True
                    
                elif bbox and len(bbox) == 4:
                    x_min, y_min, w, h = bbox
                    w_rel = float(w / img_w)
                    h_rel = float(h / img_h)
                    x_cen_rel = float((x_min + w/2) / img_w)
                    y_cen_rel = float((y_min + h/2) / img_h)
                    
                    annotations[local_id].append({
                        "id": len(annotations[local_id]) + 1,
                        "class_id": str(class_idx),
                        "shape_type": "bbox",
                        "x_center": x_cen_rel,
                        "y_center": y_cen_rel,
                        "width": w_rel,
                        "height": h_rel,
                        "points": []
                    })
                    metadata[local_id]["annotated"] = True
                    
        else:
            subdirs = [d for d in temp_dir.rglob("*") if d.is_dir() and d != temp_dir]
            images_in_root = [p for p in temp_dir.glob("*") if p.is_file() and p.suffix.lower() in [".jpg", ".jpeg", ".png", ".bmp"]]
            
            if images_in_root and not subdirs:
                subdirs = [temp_dir]
                
            for d in subdirs:
                class_name = d.name if d != temp_dir else "unclassified"
                img_files = [p for p in d.glob("*") if p.is_file() and p.suffix.lower() in [".jpg", ".jpeg", ".png", ".bmp"]]
                if not img_files:
                    continue
                    
                if class_name not in new_classes:
                    new_classes.append(class_name)
                    
                if len(new_classes) > len(project.classes):
                    project.classes = new_classes
                    project_manager.projects[project_id] = project
                    project_manager.save_projects()
                    
                class_idx = project.classes.index(class_name)
                
                for p in img_files:
                    local_id = str(uuid.uuid4()).replace("-", "")[:24]
                    base_name = p.name
                    
                    dest_path = images_dir / base_name
                    shutil.copy2(p, dest_path)
                    
                    try:
                        img = PILImage.open(dest_path)
                        img_w, img_h = img.size
                    except:
                        img_w, img_h = 224, 224
                        
                    metadata[local_id] = {
                        "id": local_id,
                        "filename": base_name,
                        "width": img_w,
                        "height": img_h,
                        "annotated": True,
                        "color_space": "RGB"
                    }
                    
                    annotations[local_id] = [{
                        "id": 1,
                        "class_id": str(class_idx),
                        "shape_type": "bbox",
                        "x_center": 0.5,
                        "y_center": 0.5,
                        "width": 1.0,
                        "height": 1.0,
                        "points": []
                    }]
                    
        with open(metadata_file, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)
            
        with open(annotations_file, "w", encoding="utf-8") as f:
            json.dump(annotations, f, indent=2)
            
        return {
            "message": f"Successfully imported dataset zip: {len(metadata)} total images registered in workspace.",
            "imported_count": len(metadata)
        }
        
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=f"Failed to process and import dataset zip: {str(e)}")
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/api/v1/projects/{project_id}/analytics", tags=["Projects"])
async def get_project_analytics(project_id: str, current_user: User = Depends(get_current_approved_user)):
    import json
    from pathlib import Path
    from collections import defaultdict
    import numpy as np
    from PIL import Image as PILImage
    
    project = check_project_access(project_id, current_user)
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    metadata_file = project_dir / "images_metadata.json"
    annotations_file = project_dir / "annotations.json"
    
    if not metadata_file.exists():
        return {
            "total_images": 0,
            "annotated_images": 0,
            "total_annotations": 0,
            "corrupt_images": 0,
            "class_distribution": {},
            "shape_breakdown": {"bbox": 0, "polygon": 0, "point": 0},
            "ann_histogram": {"0": 0, "1-5": 0, "6-10": 0, "11-20": 0, "21+": 0},
            "size_samples": [],
            "aspect_buckets": {"portrait (<0.9)": 0, "square (0.9-1.1)": 0, "landscape (>1.1)": 0},
            "color_space_counts": {},
            "channel_stats": None
        }
        
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load image metadata")
        
    annotations = {}
    if annotations_file.exists():
        try:
            with open(annotations_file, "r", encoding="utf-8") as f:
                annotations = json.load(f)
        except Exception:
            pass
            
    classes = project.classes
    images_list = list(metadata.values())
    total_images = len(images_list)
    
    # Extract annotations list and calculate counts
    all_anns = []
    ann_per_image = {}
    for img_id_str, shapes in annotations.items():
        if shapes:
            ann_per_image[img_id_str] = len(shapes)
            all_anns.extend(shapes)
            
    # Class distribution
    class_counts = defaultdict(int)
    for a in all_anns:
        c_id = a.get("class_id", 0)
        name = classes[c_id] if c_id < len(classes) else f"class{c_id}"
        class_counts[name] += 1
    class_distribution = dict(class_counts)
    
    # Shape breakdown
    shape_breakdown = {"bbox": 0, "polygon": 0, "point": 0}
    for a in all_anns:
        shape_type = a.get("shape_type", "bbox")
        if shape_type in shape_breakdown:
            shape_breakdown[shape_type] += 1
            
    # Annotations per image histogram
    ann_counts = list(ann_per_image.values())
    unannotated = total_images - len(ann_per_image)
    ann_histogram = {
        "0": unannotated,
        "1-5": sum(1 for c in ann_counts if 1 <= c <= 5),
        "6-10": sum(1 for c in ann_counts if 6 <= c <= 10),
        "11-20": sum(1 for c in ann_counts if 11 <= c <= 20),
        "21+": sum(1 for c in ann_counts if c > 20),
    }
    
    # Image dimensions & aspect ratios
    sized = [img for img in images_list if img.get("width", 0) > 0 and img.get("height", 0) > 0]
    size_samples = [{"w": img["width"], "h": img["height"]} for img in sized[:500]]
    
    aspect_buckets = {"portrait (<0.9)": 0, "square (0.9-1.1)": 0, "landscape (>1.1)": 0}
    for img in sized:
        ratio = img["width"] / img["height"]
        if ratio < 0.9:
            aspect_buckets["portrait (<0.9)"] += 1
        elif ratio <= 1.1:
            aspect_buckets["square (0.9-1.1)"] += 1
        else:
            aspect_buckets["landscape (>1.1)"] += 1
            
    # Color space counts
    color_counts = defaultdict(int)
    for img in images_list:
        color_space = img.get("color_space") or "RGB"
        color_counts[color_space] += 1
        
    # Corrupt images
    corrupt_count = sum(1 for img in images_list if img.get("is_corrupt", False))
    
    # Channel stats (sample up to 100 images)
    channel_stats = None
    sample_imgs = [img for img in images_list if not img.get("is_corrupt", False) and img.get("color_space") == "RGB"][:100]
    if sample_imgs:
        means, stds = [], []
        images_dir = project_dir / "images"
        for img in sample_imgs:
            path = images_dir / img["filename"]
            if not path.exists():
                continue
            try:
                # Local check or PIL read
                arr = np.array(PILImage.open(path).convert("RGB")).astype(np.float32) / 255.0
                means.append(arr.reshape(-1, 3).mean(axis=0).tolist())
                stds.append(arr.reshape(-1, 3).std(axis=0).tolist())
            except Exception:
                pass
        if means:
            mean_arr = np.mean(means, axis=0)
            std_arr = np.mean(stds, axis=0)
            channel_stats = {
                "mean": {"R": round(float(mean_arr[0]), 4), "G": round(float(mean_arr[1]), 4), "B": round(float(mean_arr[2]), 4)},
                "std":  {"R": round(float(std_arr[0]),  4), "G": round(float(std_arr[1]),  4), "B": round(float(std_arr[2]),  4)},
            }
            
    return {
        "total_images": total_images,
        "annotated_images": len(ann_per_image),
        "total_annotations": len(all_anns),
        "corrupt_images": corrupt_count,
        "class_distribution": class_distribution,
        "shape_breakdown": shape_breakdown,
        "ann_histogram": ann_histogram,
        "size_samples": size_samples,
        "aspect_buckets": aspect_buckets,
        "color_space_counts": dict(color_counts),
        "channel_stats": channel_stats
    }

@app.post("/api/v1/projects/{project_id}/save-dataset", tags=["Projects"])
async def save_project_as_dataset(
    project_id: str, 
    dataset_name: str, 
    version: str,
    current_user: User = Depends(get_current_approved_user)
):
    import json
    import shutil
    from pathlib import Path
    
    # 1. Get project
    project = check_project_access(project_id, current_user)
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    images_metadata_file = project_dir / "images_metadata.json"
    annotations_file = project_dir / "annotations.json"
    
    if not images_metadata_file.exists():
        raise HTTPException(status_code=400, detail="No images in project to export")
        
    with open(images_metadata_file, "r", encoding="utf-8") as f:
        images_metadata = json.load(f)
        
    annotations = {}
    if annotations_file.exists():
        with open(annotations_file, "r", encoding="utf-8") as f:
            annotations = json.load(f)
            
    # Normalize folder name to avoid invalid characters
    safe_name = "".join(c for c in dataset_name if c.isalnum() or c in ("-", "_", " ")).strip()
    safe_version = "".join(c for c in version if c.isalnum() or c in (".", "-", "_")).strip()
    folder_name = f"{safe_name}_v{safe_version}"
    
    dataset_dest = Path(__file__).resolve().parent / "datasets" / folder_name
    if dataset_dest.exists():
        shutil.rmtree(dataset_dest)
    dataset_dest.mkdir(parents=True, exist_ok=True)
    
    task_type = project.task_type
    
    # Save default config file
    config_data = {
        "dataset_id": folder_name,
        "dataset_name": f"{dataset_name} (v{version})",
        "version": version,
        "task_type": task_type,
        "item_count": len(images_metadata),
        "classes": project.classes or ["class0"],
        "project_id": project_id  # Link dataset back to project for authentication
    }
    
    # Export based on task type
    if task_type == "image_classification":
        # Classification format: directory structure
        for img_id, img_info in images_metadata.items():
            # Get class ID
            img_anns = annotations.get(img_id, [])
            class_name = "unlabeled"
            if img_anns:
                class_id = img_anns[0].get("class_id", 0)
                if project.classes and class_id < len(project.classes):
                    class_name = project.classes[class_id]
                    
            class_dir = dataset_dest / class_name
            class_dir.mkdir(parents=True, exist_ok=True)
            
            src_img = project_dir / "images" / img_info["filename"]
            if src_img.exists():
                shutil.copy2(src_img, class_dir / img_info["filename"])
                
    else:
        # Detection / Segmentation: COCO format
        images_dir = dataset_dest / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        
        ann_dir = dataset_dest / "annotations"
        ann_dir.mkdir(parents=True, exist_ok=True)
        
        coco_images = []
        coco_annotations = []
        coco_categories = []
        
        # Add categories
        classes_list = project.classes or ["class0"]
        for idx, cat_name in enumerate(classes_list):
            coco_categories.append({
                "id": idx,
                "name": cat_name,
                "supercategory": "none"
            })
            
        ann_id_counter = 1
        for idx, (img_id, img_info) in enumerate(images_metadata.items()):
            src_img = project_dir / "images" / img_info["filename"]
            if not src_img.exists():
                continue
                
            shutil.copy2(src_img, images_dir / img_info["filename"])
            
            # Simple integer ID for image
            coco_img_id = idx + 1
            coco_images.append({
                "id": coco_img_id,
                "file_name": img_info["filename"],
                "width": img_info["width"],
                "height": img_info["height"]
            })
            
            img_anns = annotations.get(img_id, [])
            for shape in img_anns:
                segmentations = []
                if shape["shape_type"] == "point" and shape.get("points"):
                    px, py = shape["points"][0]
                    bx_w = 4.0
                    bx_h = 4.0
                    bbox = [
                        px * img_info["width"] - bx_w / 2,
                        py * img_info["height"] - bx_h / 2,
                        bx_w,
                        bx_h
                    ]
                    area = bx_w * bx_h
                    segmentations = [[px * img_info["width"], py * img_info["height"]]]
                else:
                    bbox = [
                        (shape["x_center"] - shape["width"] / 2) * img_info["width"],
                        (shape["y_center"] - shape["height"] / 2) * img_info["height"],
                        shape["width"] * img_info["width"],
                        shape["height"] * img_info["height"]
                    ]
                    area = bbox[2] * bbox[3]
                    if shape["shape_type"] == "polygon" and shape.get("points"):
                        # COCO format: flat list of x,y coordinates
                        flat_pts = []
                        for pt in shape["points"]:
                            flat_pts.append(pt[0] * img_info["width"])
                            flat_pts.append(pt[1] * img_info["height"])
                        segmentations = [flat_pts]
                    
                coco_annotations.append({
                    "id": ann_id_counter,
                    "image_id": coco_img_id,
                    "category_id": shape["class_id"],
                    "bbox": bbox,
                    "segmentation": segmentations,
                    "area": area,
                    "iscrowd": 0 
                })
                ann_id_counter += 1
                
        coco_output = {
            "images": coco_images,
            "annotations": coco_annotations,
            "categories": coco_categories
        }
        
        with open(ann_dir / "instances_default.json", "w", encoding="utf-8") as f:
            json.dump(coco_output, f, indent=2)
            
    with open(dataset_dest / "dataset_config.json", "w", encoding="utf-8") as f:
        json.dump(config_data, f, indent=2)
        
    return {"message": "Dataset exported successfully", "dataset_id": folder_name}

@app.get("/api/v1/projects/{project_id}/export-zip", tags=["Projects"])
async def export_project_dataset_zip(project_id: str, current_user: User = Depends(get_current_approved_user)):
    import tempfile
    import zipfile
    from fastapi.responses import FileResponse
    from pathlib import Path
    import json
    
    project = check_project_access(project_id, current_user)
        
    project_dir = Path(__file__).resolve().parent / "logs" / "projects" / project_id
    images_metadata_file = project_dir / "images_metadata.json"
    annotations_file = project_dir / "annotations.json"
    
    if not images_metadata_file.exists():
        raise HTTPException(status_code=400, detail="No images in project to export")
         
    with open(images_metadata_file, "r", encoding="utf-8") as f:
        images_metadata = json.load(f)
        
    annotations = {}
    if annotations_file.exists():
        with open(annotations_file, "r", encoding="utf-8") as f:
            annotations = json.load(f)
            
    # Write to a temporary zip file
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_zip.close()
    
    task_type = project.task_type
    
    with zipfile.ZipFile(temp_zip.name, 'w', zipfile.ZIP_DEFLATED) as zipf:
        if task_type == "image_classification":
            for img_id, img_info in images_metadata.items():
                img_anns = annotations.get(img_id, [])
                class_name = "unlabeled"
                if img_anns:
                    class_id = img_anns[0].get("class_id", 0)
                    if project.classes and class_id < len(project.classes):
                        class_name = project.classes[class_id]
                
                src_img = project_dir / "images" / img_info["filename"]
                if src_img.exists():
                    zipf.write(src_img, arcname=f"{class_name}/{img_info['filename']}")
        else:
            # COCO JSON construction
            coco_images = []
            coco_annotations = []
            coco_categories = []
            
            classes_list = project.classes or ["class0"]
            for idx, cat_name in enumerate(classes_list):
                coco_categories.append({
                    "id": idx,
                    "name": cat_name,
                    "supercategory": "none"
                })
                
            ann_id_counter = 1
            for idx, (img_id, img_info) in enumerate(images_metadata.items()):
                src_img = project_dir / "images" / img_info["filename"]
                if not src_img.exists():
                    continue
                    
                zipf.write(src_img, arcname=f"images/{img_info['filename']}")
                
                coco_img_id = idx + 1
                coco_images.append({
                    "id": coco_img_id,
                    "file_name": img_info["filename"],
                    "width": img_info["width"],
                    "height": img_info["height"]
                })
                
                img_anns = annotations.get(img_id, [])
                for shape in img_anns:
                    segmentations = []
                    if shape["shape_type"] == "point" and shape.get("points"):
                        px, py = shape["points"][0]
                        bx_w = 4.0
                        bx_h = 4.0
                        bbox = [
                            px * img_info["width"] - bx_w / 2,
                            py * img_info["height"] - bx_h / 2,
                            bx_w,
                            bx_h
                        ]
                        area = bx_w * bx_h
                        segmentations = [[px * img_info["width"], py * img_info["height"]]]
                    else:
                        bbox = [
                            (shape["x_center"] - shape["width"] / 2) * img_info["width"],
                            (shape["y_center"] - shape["height"] / 2) * img_info["height"],
                            shape["width"] * img_info["width"],
                            shape["height"] * img_info["height"]
                        ]
                        area = bbox[2] * bbox[3]
                        if shape["shape_type"] == "polygon" and shape.get("points"):
                            flat_pts = []
                            for pt in shape["points"]:
                                flat_pts.append(pt[0] * img_info["width"])
                                flat_pts.append(pt[1] * img_info["height"])
                            segmentations = [flat_pts]
                        
                    coco_annotations.append({
                        "id": ann_id_counter,
                        "image_id": coco_img_id,
                        "category_id": shape["class_id"],
                        "bbox": bbox,
                        "segmentation": segmentations,
                        "area": area,
                        "iscrowd": 0
                    })
                    ann_id_counter += 1
            
            coco_output = {
                "images": coco_images,
                "annotations": coco_annotations,
                "categories": coco_categories
            }
            
            zipf.writestr("annotations/instances_default.json", json.dumps(coco_output, indent=2))
            
    return FileResponse(
        path=temp_zip.name,
        filename=f"{project.name.replace(' ', '_')}_dataset.zip",
        media_type="application/zip"
    )


# Expose Visual Pipeline Builder client assets as static folder
from fastapi.staticfiles import StaticFiles
workflow_web_dir = Path(__file__).resolve().parent / "workflow_web"
if workflow_web_dir.exists():
    app.mount("/workflow", StaticFiles(directory=str(workflow_web_dir), html=True), name="workflow")

# Expose Dataset Annotator client assets as static folder
annotator_dir = Path(__file__).resolve().parent / "annotator"
if annotator_dir.exists():
    app.mount("/annotator", StaticFiles(directory=str(annotator_dir), html=True), name="annotator")

# Expose Unified Dashboard client assets as static folder at root
react_dist_dir = Path(__file__).resolve().parent / "frontend" / "dist"
dashboard_dir = Path(__file__).resolve().parent / "dashboard_web"

if react_dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(react_dist_dir), html=True), name="frontend")
elif dashboard_dir.exists():
    app.mount("/", StaticFiles(directory=str(dashboard_dir), html=True), name="dashboard")



