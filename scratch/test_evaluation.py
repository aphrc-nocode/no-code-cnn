import os
import json
import torch
import torch.nn as nn
from pathlib import Path
import asyncio

# Setup environment
os.environ["API_URL"] = "http://localhost:8090"

async def test_flow():
    from main import job_manager, TrainingJob, PipelineConfig, TaskType, ModelArchitecture, TrainingStatus
    from datasets_module.classification.dataloaders import ImageClassificationDataset
    
    # 1. Create a dummy classification job ID
    job_id = "dummy_classification_job_1"
    
    # 2. Check if a dummy dataset is needed or use the existing classification dataset
    dataset_id = "eaea2e9d-037f-4f3f-a644-6eb6d6dd3a84"
    dataset_path = Path(f"datasets/{dataset_id}")
    if not dataset_path.exists():
        print(f"Dataset {dataset_id} not found!")
        return
        
    print(f"Dataset path exists: {dataset_path}")
    
    # Create dataset splits
    splits_dir = Path("dataset_splits") / job_id
    splits_dir.mkdir(exist_ok=True, parents=True)
    
    # Let's save a splits file with a few indices
    dataset = ImageClassificationDataset(dataset_path)
    num_samples = len(dataset)
    print(f"Total samples in dataset: {num_samples}")
    
    # Create dummy splits
    train_indices = list(range(0, int(num_samples * 0.7)))
    val_indices = list(range(int(num_samples * 0.7), int(num_samples * 0.85)))
    test_indices = list(range(int(num_samples * 0.85), num_samples))
    
    splits = {
        "train": train_indices,
        "val": val_indices,
        "test": test_indices,
        "dataset_path": str(dataset_path)
    }
    
    with open(splits_dir / "dataset_splits.json", "w") as f:
        json.dump(splits, f)
    print("Saved dataset splits.")
    
    # Create the model directory
    model_dir = Path(f"logs/models/{job_id}")
    model_dir.mkdir(exist_ok=True, parents=True)
    
    # Instantiate a pipeline to get a model
    config = PipelineConfig(
        name="Test Classify Pipeline",
        task_type=TaskType.IMAGE_CLASSIFICATION,
        architecture=ModelArchitecture.RESNET18,
        num_classes=len(dataset.classes)
    )
    
    from pipelines.image_classification_pipeline import ImageClassificationPipeline
    pipeline = ImageClassificationPipeline(config)
    model = pipeline.create_model()
    
    # Save the checkpoint
    checkpoint = {
        "model_state_dict": model.state_dict(),
        "class_to_idx": dataset.class_to_idx,
        "config": {
            "name": config.name,
            "task_type": config.task_type.value,
            "architecture": config.architecture.value,
            "num_classes": config.num_classes,
            "class_names": dataset.classes
        }
    }
    
    torch.save(checkpoint, model_dir / "model_final.pth")
    print("Saved model checkpoint.")
    
    # Create the training job entry in job_manager
    job = TrainingJob(
        id=job_id,
        pipeline_config=config,
        status=TrainingStatus.COMPLETED,
        model_path=str(model_dir / "model_final.pth"),
        linked_dataset_id=dataset_id
    )
    job_manager.jobs[job_id] = job
    print("Added dummy job to job manager.")
    
    # Now call the evaluation endpoint locally!
    from main import evaluate_pipeline
    print("Running evaluate_pipeline...")
    try:
        res = await evaluate_pipeline(job_id)
        print("Evaluation result keys:", list(res.keys()))
        print("Accuracy:", res["accuracy"])
        print("Correct/Incorrect:", res["correct_count"], "/", res["incorrect_count"])
        print("Class Metrics:", len(res["class_metrics"]))
        print("Samples evaluated:", len(res["samples"]))
        if res["samples"]:
            print("First sample prediction:", res["samples"][0]["predicted_label"], "True label:", res["samples"][0]["true_label"])
    except Exception as e:
        print(f"Error running evaluate_pipeline: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_flow())
