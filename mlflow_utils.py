"""
MLflow integration utilities for the no-code backend.
This module provides functions to track experiments, log metrics, and manage model artifacts.
"""

import mlflow
from mlflow.tracking import MlflowClient
import os
from pathlib import Path
from typing import Dict, Any, Optional, List
import torch
from pydantic import BaseModel
import json
import numpy as np

# Import visualization utilities
from visualization_utils import (
    log_all_visualizations_to_mlflow,
    create_confusion_matrix,
    create_loss_curve,
    create_accuracy_curve,
    cleanup_temp_files
)

# Configure MLflow
MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", "file:./logs/mlflow")
EXPERIMENT_NAME = os.environ.get("MLFLOW_EXPERIMENT_NAME", "no-code-ml-experiments")

def setup_mlflow():
    """Initialize MLflow tracking"""
    try:
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        Path("logs/mlflow").mkdir(parents=True, exist_ok=True)
        
        experiment = mlflow.get_experiment_by_name(EXPERIMENT_NAME)
        if experiment is None:
            try:
                mlflow.create_experiment(EXPERIMENT_NAME)
            except Exception:
                pass
        mlflow.set_experiment(EXPERIMENT_NAME)
    except Exception as e:
        print(f"Warning: MLflow setup encountered issue: {e}")

def start_run(job_id: str, config: Dict[str, Any]) -> str:
    """Start an MLflow run safely, ending any active runs first"""
    # Safely close active runs on the current thread/context
    while mlflow.active_run():
        try:
            mlflow.end_run()
        except Exception:
            break

    run_id = None
    try:
        run = mlflow.start_run(run_name=f"job_{job_id}")
        run_id = run.info.run_id
    except Exception as e:
        print(f"Warning: mlflow.start_run failed ({e}), creating run via MlflowClient")
        try:
            client = MlflowClient()
            exp = mlflow.get_experiment_by_name(EXPERIMENT_NAME)
            exp_id = exp.experiment_id if exp else "0"
            run = client.create_run(experiment_id=exp_id, run_name=f"job_{job_id}")
            run_id = run.info.run_id
        except Exception as e2:
            print(f"Warning: MlflowClient create_run failed: {e2}")
            run_id = job_id

    if run_id:
        try:
            client = MlflowClient()
            for key, value in config.items():
                try:
                    val_str = str(value) if not isinstance(value, (int, float, str, bool)) else value
                    client.log_param(run_id, key, val_str)
                except Exception:                                                                                                                                                                                                                                                                         
                    pass
        except Exception as e:
            print(f"Warning: Failed to log parameters: {e}")

    return run_id

def log_metrics(metrics: Dict[str, Any], step: Optional[int] = None, run_id: Optional[str] = None):
    """Log metrics to the specified or active MLflow run"""
    target_run_id = run_id
    if not target_run_id:
        active = mlflow.active_run()
        if active:
            target_run_id = active.info.run_id

    if not target_run_id:
        return

    try:
        client = MlflowClient()
        import time
        timestamp = int(time.time() * 1000)
        for name, value in metrics.items():
            if value is not None and not np.isnan(value) and isinstance(value, (int, float)):
                try:
                    client.log_metric(target_run_id, name, float(value), timestamp=timestamp, step=step or 0)
                except Exception:
                    try:
                        if mlflow.active_run():
                            mlflow.log_metric(name, float(value), step=step)
                    except Exception:
                        pass
    except Exception as e:
        print(f"Warning: Failed to log metrics: {e}")

def log_batch_metrics(metrics: Dict[str, Any], step: int, run_id: Optional[str] = None):
    """Log batch metrics to the MLflow run"""
    log_metrics(metrics, step=step, run_id=run_id)

def log_model(model, artifact_path: str = "model", class_to_idx: Dict = None, config: Dict = None, **kwargs):
    """Log model and associated metadata to MLflow"""
    if "model_path" in kwargs and not artifact_path:
        artifact_path = str(kwargs["model_path"])
    try:
        if mlflow.active_run():
            mlflow.pytorch.log_model(model, artifact_path)
    except Exception as e:
        print(f"Warning: Failed to log PyTorch model to MLflow: {e}")
    
    if class_to_idx:
        try:
            class_mapping_path = Path("class_mapping.json")
            with open(class_mapping_path, "w") as f:
                json.dump(class_to_idx, f)
            if mlflow.active_run():
                mlflow.log_artifact(str(class_mapping_path), "metadata")
            if class_mapping_path.exists():
                class_mapping_path.unlink()
        except Exception as e:
            print(f"Warning: Failed to log class mapping: {e}")
    
    if config:
        try:
            config_path = Path("model_config.json")
            with open(config_path, "w") as f:
                json.dump({k: str(v) if not isinstance(v, (int, float, str, bool)) else v 
                          for k, v in config.items()}, f)
            if mlflow.active_run():
                mlflow.log_artifact(str(config_path), "metadata")
            if config_path.exists():
                config_path.unlink()
        except Exception as e:
            print(f"Warning: Failed to log model config: {e}")

def log_training_visualizations(
    train_losses: List[float], 
    train_accuracies: List[float], 
    val_losses: List[float] = None, 
    val_accuracies: List[float] = None
):
    """Create and log training curve visualizations to MLflow"""
    try:
        loss_curve_path = create_loss_curve(train_losses, val_losses)
        if mlflow.active_run():
            mlflow.log_artifact(loss_curve_path, "visualizations")
        acc_curve_path = create_accuracy_curve(train_accuracies, val_accuracies)
        if mlflow.active_run():
            mlflow.log_artifact(acc_curve_path, "visualizations")
        cleanup_temp_files([loss_curve_path, acc_curve_path])
    except Exception as e:
        print(f"Warning: Failed to log training visualizations: {e}")

def log_evaluation_visualizations(
    y_true, 
    y_pred, 
    y_scores, 
    class_names=None, 
    class_counts=None
):
    """Create and log model evaluation visualizations to MLflow"""
    try:
        plots = log_all_visualizations_to_mlflow(
            train_losses=None,
            train_accuracies=None,
            y_true=y_true,
            y_pred=y_pred,
            y_scores=y_scores,
            class_names=class_names,
            class_counts=class_counts
        )
        cleanup_temp_files(plots)
    except Exception as e:
        print(f"Warning: Failed to log evaluation visualizations: {e}")

def log_image(image_path: str, image_name: str):
    """Log an image artifact to MLflow"""
    try:
        if mlflow.active_run():
            mlflow.log_artifact(image_path, f"images/{image_name}")
    except Exception as e:
        print(f"Warning: Failed to log image: {e}")

def end_run(run_id: Optional[str] = None, status: str = "FINISHED"):
    """End the current MLflow run safely"""
    try:
        while mlflow.active_run():
            mlflow.end_run(status=status)
    except Exception as e:
        print(f"Warning: Failed ending MLflow active run: {e}")

    if run_id:
        try:
            client = MlflowClient()
            client.set_terminated(run_id, status=status)
        except Exception:
            pass

def get_run_info(run_id: str) -> Dict[str, Any]:
    """Get information about a specific MLflow run safely"""
    try:
        client = MlflowClient()
        run = client.get_run(run_id)
        return {
            "run_id": run.info.run_id,
            "status": run.info.status,
            "start_time": run.info.start_time,
            "end_time": run.info.end_time,
            "artifact_uri": run.info.artifact_uri,
            "metrics": run.data.metrics,
            "params": run.data.params
        }
    except Exception:
        return {}

