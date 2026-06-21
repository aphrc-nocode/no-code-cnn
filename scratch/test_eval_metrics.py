import asyncio
import os
import json
from pathlib import Path

async def inspect_metrics():
    # Load the job directly
    from main import job_manager
    job_id = "837c6ee1-0ca6-4f5d-ba28-77281af407fa"
    job = job_manager.get_job(job_id)
    if not job:
        print("Job not found!")
        return
        
    print(f"Job found: {job_id}")
    print(f"Task type: {job.pipeline_config.task_type}")
    print(f"Dataset ID: {job.linked_dataset_id}")
    
    # Resolve paths
    dataset_id = job.linked_dataset_id or job_id
    dataset_path = Path(f"datasets/{dataset_id}")
    
    # Find all JSON annotation files in the dataset path (excluding config)
    annotation_candidates = list(dataset_path.glob("**/*.json"))
    annotation_candidates = [f for f in annotation_candidates if f.name != "dataset_config.json"]
    
    # Find splits file if any
    splits_path = Path("dataset_splits") / job_id / "dataset_splits.json"
    if not splits_path.exists():
        splits_path = Path("logs/models") / job_id / "splits" / "dataset_splits.json"
        
    test_indices = []
    images_dir = None
    annotations_path = None
    
    if splits_path.exists():
        try:
            with open(splits_path, 'r') as f:
                splits = json.load(f)
            test_indices = splits.get("test", [])
            images_dir = splits.get("dataset_path")
            annotations_path = splits.get("annotations_path")
        except:
            pass
            
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
            
    from datasets_module.detection.dataloaders import ObjectDetectionDataset
    dataset = ObjectDetectionDataset(images_dir, annotations_path)
    
    if not test_indices:
        test_indices = list(range(len(dataset)))
        
    test_indices = [idx for idx in test_indices if idx < len(dataset)]
    test_indices = test_indices[:5]
    
    import torch
    
    # Ensure model is cached/loaded
    if job_id not in job_manager.loaded_models:
        model = job_manager._load_model(job.model_path, job.pipeline_config)
        class_map = job_manager._get_class_map(job.model_path)
        job_manager.loaded_models[job_id] = (model, class_map)
        
    model, class_map = job_manager.loaded_models[job_id]
    sorted_cat_keys = sorted(dataset.categories.keys())
    class_names = [dataset.categories[k] for k in sorted_cat_keys]
    
    for idx in test_indices:
        img, target = dataset[idx]
        img_info = dataset.images[dataset.image_ids[idx]]
        filename = img_info["file_name"]
        
        # Predict
        from PIL import Image
        img_path = Path(dataset.images_dir / filename)
        if not img_path.exists():
            img_path = list(dataset.images_dir.glob(f"**/{filename}"))[0]
            
        with open(img_path, 'rb') as f:
            pil_img = Image.open(f).convert('RGB')
            
        pred_result = await job_manager.predict(job_id, pil_img)
        formatted_detections = pred_result.get("detections", [])
        
        target_boxes = target["boxes"]
        target_labels = target["labels"]
        
        pred_boxes = [det["box"] for det in formatted_detections]
        pred_labels = []
        pred_scores = []
        for det in formatted_detections:
            raw_label = det["class_id"]
            mapped_label = max(0, raw_label - 1)
            pred_labels.append(mapped_label)
            pred_scores.append(det["confidence"] / 100.0)
            
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
            
        print(f"Sample: {filename}")
        print(f"  Target count: {len(target_labels)}")
        print(f"  Predicted count (raw): {len(formatted_detections)}")
        print(f"  TP: {tp_count}, FP: {fp_count}, FN: {fn_count}")
        precision = tp_count / (tp_count + fp_count) if (tp_count + fp_count) > 0 else 0.0
        recall = tp_count / len(target_labels) if len(target_labels) > 0 else 1.0
        print(f"  Precision: {precision:.4f}, Recall: {recall:.4f}")
        print("-" * 30)

if __name__ == "__main__":
    asyncio.run(inspect_metrics())
