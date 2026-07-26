"""
Dataset Versioning and Caching System for No-Code AI Platform

This module provides functionality to:
1. Version datasets by storing metadata and checksums
2. Cache datasets to prevent redundant downloads
3. Track dataset lineage for reproducibility
"""

import os
import json
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Union, Any
import logging
import shutil

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import minio_utils

DATASETS_BUCKET = os.getenv("MINIO_DATASETS_BUCKET", "datasets")


class DatasetVersion:
    """Represents a single version of a dataset"""
    
    def __init__(
        self, 
        version_id: str,
        dataset_name: str,
        source: str,
        creation_timestamp: float,
        parameters: Dict[str, Any],
        sample_count: int,
        size_bytes: int,
        checksum: str
    ):
        self.version_id = version_id
        self.dataset_name = dataset_name
        self.source = source
        self.creation_timestamp = creation_timestamp
        self.parameters = parameters
        self.sample_count = sample_count
        self.size_bytes = size_bytes
        self.checksum = checksum
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'DatasetVersion':
        """Create a DatasetVersion instance from a dictionary"""
        return cls(
            version_id=data["version_id"],
            dataset_name=data["dataset_name"],
            source=data["source"],
            creation_timestamp=data["creation_timestamp"],
            parameters=data["parameters"],
            sample_count=data["sample_count"],
            size_bytes=data["size_bytes"],
            checksum=data["checksum"]
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation"""
        return {
            "version_id": self.version_id,
            "dataset_name": self.dataset_name,
            "source": self.source,
            "creation_timestamp": self.creation_timestamp,
            "parameters": self.parameters,
            "sample_count": self.sample_count,
            "size_bytes": self.size_bytes,
            "checksum": self.checksum
        }
    
    @property
    def creation_date(self) -> str:
        """Return a human-readable creation date"""
        return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(self.creation_timestamp))
    
    @property
    def size_readable(self) -> str:
        """Return a human-readable size"""
        for unit in ["B", "KB", "MB", "GB"]:
            if self.size_bytes < 1024:
                return f"{self.size_bytes:.2f} {unit}"
            self.size_bytes /= 1024
        return f"{self.size_bytes:.2f} TB"


class DatasetVersionManager:
    """Manages dataset versions and caching with MinIO persistence"""
    
    def __init__(self, base_dir: str = "datasets"):
        self.base_dir = Path(base_dir)
        self.versions_file = self.base_dir / "versions.json"
        self.cache_dir = self.base_dir / "cache"
        
        # Create required directories if they don't exist
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        
        # Load or initialize versions registry
        self.versions = self._load_versions()
    
    def _load_versions(self) -> Dict[str, Dict[str, Any]]:
        """Load versions registry from file or initialize if it doesn't exist"""
        # Proactively download versions.json from MinIO if it exists
        try:
            if minio_utils.exists(DATASETS_BUCKET, "versions.json"):
                minio_utils.download_file(DATASETS_BUCKET, "versions.json", str(self.versions_file))
                logger.info("Successfully synced versions.json from MinIO")
        except Exception as e:
            logger.warning(f"Could not download versions.json from MinIO, using local cache: {e}")

        if self.versions_file.exists():
            try:
                with open(self.versions_file, "r") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading versions file: {str(e)}")
                return {}
        return {}
    
    def _save_versions(self) -> None:
        """Save versions registry to file and upload to MinIO"""
        try:
            with open(self.versions_file, "w") as f:
                json.dump(self.versions, f, indent=2)
            
            # Upload to MinIO
            minio_utils.upload_file(DATASETS_BUCKET, "versions.json", str(self.versions_file))
            logger.info("Successfully uploaded versions.json to MinIO")
        except Exception as e:
            logger.error(f"Error saving versions registry: {e}")
    
    def _calculate_checksum(self, dataset_path: Union[str, Path]) -> str:
        """Calculate a checksum for a dataset directory"""
        dataset_path = Path(dataset_path)
        if not dataset_path.exists():
            raise ValueError(f"Dataset path does not exist: {dataset_path}")
        
        # Calculate checksum based on dataset_config.json and class_mapping.json if they exist
        files_to_hash = []
        
        config_file = dataset_path / "dataset_config.json"
        if config_file.exists():
            files_to_hash.append(config_file)
        
        mapping_file = dataset_path / "class_mapping.json"
        if mapping_file.exists():
            files_to_hash.append(mapping_file)
        
        # If no config files found, use some samples
        if not files_to_hash:
            # Find image files for sampling
            image_files = []
            for ext in [".jpg", ".jpeg", ".png"]:
                image_files.extend(dataset_path.glob(f"**/*{ext}"))
            
            # Take a sample of images (max 10)
            if image_files:
                files_to_hash = sorted(image_files)[:10]
        
        # Calculate checksum
        hasher = hashlib.sha256()
        
        for file_path in files_to_hash:
            try:
                with open(file_path, "rb") as f:
                    # Read in chunks to handle large files
                    for chunk in iter(lambda: f.read(4096), b""):
                        hasher.update(chunk)
            except Exception as e:
                logger.warning(f"Error hashing file {file_path}: {str(e)}")
        
        return hasher.hexdigest()
    
    def _calculate_size(self, path: Union[str, Path]) -> int:
        """Calculate the total size of a directory in bytes"""
        path = Path(path)
        if not path.exists():
            return 0
        
        total_size = 0
        if path.is_file():
            return path.stat().st_size
        
        for item in path.glob("**/*"):
            if item.is_file():
                total_size += item.stat().st_size
        
        return total_size
    
    def _count_samples(self, dataset_path: Union[str, Path]) -> int:
        """Count the number of samples (images) in a dataset"""
        dataset_path = Path(dataset_path)
        if not dataset_path.exists():
            return 0
        
        image_count = 0
        # Count all image files
        for ext in [".jpg", ".jpeg", ".png"]:
            image_count += len(list(dataset_path.glob(f"**/*{ext}")))
        
        return image_count
    
    def register_dataset(
        self,
        job_id: str,
        dataset_name: str,
        source: str,
        parameters: Dict[str, Any]
    ) -> DatasetVersion:
        """
        Register a dataset version and calculate its metadata
        
        Args:
            job_id: The job ID used as directory name
            dataset_name: Name of the dataset
            source: Source of the dataset (e.g., "huggingface", "upload")
            parameters: Parameters used to create the dataset
            
        Returns:
            DatasetVersion object
        """
        dataset_path = self.base_dir / job_id
        
        if not dataset_path.exists():
            raise ValueError(f"Dataset path does not exist: {dataset_path}")
        
        # Calculate metadata
        checksum = self._calculate_checksum(dataset_path)
        size_bytes = self._calculate_size(dataset_path)
        sample_count = self._count_samples(dataset_path)
        
        # Create version object
        version = DatasetVersion(
            version_id=job_id,
            dataset_name=dataset_name,
            source=source,
            creation_timestamp=time.time(),
            parameters=parameters,
            sample_count=sample_count,
            size_bytes=size_bytes,
            checksum=checksum
        )
        
        # Store in registry
        self.versions[job_id] = version.to_dict()
        self._save_versions()
        
        # Sync directory to MinIO
        try:
            minio_utils.upload_directory(DATASETS_BUCKET, job_id, str(dataset_path))
            logger.info(f"Successfully uploaded dataset '{job_id}' to MinIO")
        except Exception as e:
            logger.error(f"Failed to sync dataset '{job_id}' to MinIO: {e}")
        
        return version
    
    def find_similar_dataset(
        self, 
        dataset_name: str,
        parameters: Dict[str, Any]
    ) -> Optional[str]:
        """
        Find a similar dataset in the cache based on name and parameters
        
        Args:
            dataset_name: Name of the dataset to find
            parameters: Parameters used to create the dataset
            
        Returns:
            Job ID of a similar dataset if found, None otherwise
        """
        # Filter versions by dataset name
        candidates = [
            (job_id, data) for job_id, data in self.versions.items()
            if data["dataset_name"] == dataset_name
        ]
        
        if not candidates:
            return None
        
        # Check for parameter match
        for job_id, data in candidates:
            # Check for key parameter matches
            param_match = True
            for key in ["subset", "split", "task_type", "max_samples"]:
                if (key in parameters and key in data["parameters"] and 
                    parameters[key] != data["parameters"][key]):
                    param_match = False
                    break
            
            if param_match:
                # Check if the dataset directory still exists locally or in MinIO
                if (self.base_dir / job_id).exists() or minio_utils.exists(DATASETS_BUCKET, job_id):
                    return job_id
        
        return None
    
    def get_dataset_version(self, job_id: str) -> Optional[DatasetVersion]:
        """Get dataset version information by job ID"""
        if job_id in self.versions:
            return DatasetVersion.from_dict(self.versions[job_id])
        return None
    
    def list_dataset_versions(
        self, 
        dataset_name: Optional[str] = None,
        source: Optional[str] = None
    ) -> List[DatasetVersion]:
        """
        List all dataset versions, optionally filtered
        
        Args:
            dataset_name: Filter by dataset name
            source: Filter by source
            
        Returns:
            List of DatasetVersion objects
        """
        versions = []
        
        for job_id, data in self.versions.items():
            if dataset_name and data["dataset_name"] != dataset_name:
                continue
            
            if source and data["source"] != source:
                continue
            
            # Check if directory exists locally or in MinIO
            if (self.base_dir / job_id).exists() or minio_utils.exists(DATASETS_BUCKET, job_id):
                versions.append(DatasetVersion.from_dict(data))
        
        # Sort by creation timestamp (newest first)
        return sorted(versions, key=lambda v: v.creation_timestamp, reverse=True)
    
    def copy_dataset(self, job_id: str, new_job_id: str) -> Optional[str]:
        """
        Create a copy of a dataset with a new job ID
        
        Args:
            job_id: Source job ID
            new_job_id: New job ID
            
        Returns:
            New job ID if successful, None otherwise
        """
        source_path = self.base_dir / job_id
        target_path = self.base_dir / new_job_id
        
        # Ensure source dataset is local. If not, download it from MinIO.
        if not source_path.exists():
            if minio_utils.exists(DATASETS_BUCKET, job_id):
                logger.info(f"Downloading source dataset '{job_id}' from MinIO to local cache for copying...")
                minio_utils.download_directory(DATASETS_BUCKET, job_id, str(source_path))
            else:
                logger.error(f"Source dataset does not exist locally or in MinIO: {source_path}")
                return None
        
        if target_path.exists():
            logger.error(f"Target path already exists: {target_path}")
            return None
        
        try:
            shutil.copytree(source_path, target_path)
            
            # If source is in registry, copy its entry with the new ID
            if job_id in self.versions:
                version_data = self.versions[job_id].copy()
                version_data["version_id"] = new_job_id
                version_data["creation_timestamp"] = time.time()
                self.versions[new_job_id] = version_data
                self._save_versions()
            
            # Upload the new copied dataset to MinIO
            try:
                minio_utils.upload_directory(DATASETS_BUCKET, new_job_id, str(target_path))
            except Exception as e:
                logger.error(f"Failed to upload copied dataset '{new_job_id}' to MinIO: {e}")
                
            return new_job_id
        except Exception as e:
            logger.error(f"Error copying dataset: {str(e)}")
            return None
    
    def delete_dataset(self, job_id: str) -> bool:
        """
        Delete a dataset and its version information
        
        Args:
            job_id: Job ID of the dataset to delete
            
        Returns:
            True if successful, False otherwise
        """
        dataset_path = self.base_dir / job_id
        
        # Delete from MinIO first
        try:
            minio_utils.delete_prefix(DATASETS_BUCKET, job_id)
        except Exception as e:
            logger.error(f"Failed to delete dataset '{job_id}' from MinIO: {e}")

        # Delete locally if exists
        if dataset_path.exists():
            try:
                shutil.rmtree(dataset_path)
            except Exception as e:
                logger.error(f"Error deleting local dataset folder: {str(e)}")
        
        # Remove from registry
        if job_id in self.versions:
            del self.versions[job_id]
            self._save_versions()
            
        return True


class UnifiedDatasetManager:
    """
    Manages Intel Geti-style Unified Project Datasets.
    Features:
    1. Single master dataset pool per project (projects/{project_id}/dataset/)
    2. Import & append ZIP archives (COCO, YOLO, VOC, Classification) with label remapping
    3. MD5/SHA256 image checksum deduplication
    4. Media status tracking (Annotated vs Unannotated)
    5. Dataset version snapshots (v1.0, v2.0) with train/val splits
    6. Dataset export (COCO JSON or YOLO format ZIP downloads)
    """

    def __init__(self, base_dir: str = "datasets"):
        self.base_dir = Path(base_dir) / "projects"
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def get_project_dir(self, project_id: str) -> Path:
        p_dir = self.base_dir / project_id
        (p_dir / "images").mkdir(parents=True, exist_ok=True)
        (p_dir / "versions").mkdir(parents=True, exist_ok=True)
        return p_dir

    def _get_master_file(self, project_id: str) -> Path:
        return self.get_project_dir(project_id) / "annotations.json"

    def load_master_dataset(self, project_id: str) -> Dict[str, Any]:
        master_file = self._get_master_file(project_id)
        if master_file.exists():
            try:
                with open(master_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Error loading master dataset for project {project_id}: {e}")
        return {
            "project_id": project_id,
            "task_type": "object_detection",
            "classes": [],
            "items": {}
        }

    def save_master_dataset(self, project_id: str, data: Dict[str, Any]) -> None:
        master_file = self._get_master_file(project_id)
        with open(master_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def preview_zip_import(self, zip_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Analyze a dataset ZIP archive without ingesting it.
        Detects dataset format (COCO, YOLO, classification folders) and unique labels.
        """
        import zipfile
        zip_path = Path(zip_path)
        if not zip_path.exists():
            raise ValueError(f"Zip file does not exist: {zip_path}")

        detected_format = "images_only"
        detected_classes = set()
        image_count = 0
        coco_json_name = None

        with zipfile.ZipFile(zip_path, "r") as z:
            namelist = z.namelist()
            for name in namelist:
                lower = name.lower()
                if lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
                    image_count += 1
                if lower.endswith(".json") and ("coco" in lower or lower.endswith("annotations.json") or lower.endswith("_annotations.coco.json")):
                    detected_format = "coco"
                    coco_json_name = name

            if detected_format == "coco" and coco_json_name:
                try:
                    with z.open(coco_json_name) as jf:
                        coco_data = json.load(jf)
                        for cat in coco_data.get("categories", []):
                            if "name" in cat:
                                detected_classes.add(cat["name"])
                except Exception as e:
                    logger.warning(f"Could not parse COCO json in zip preview: {e}")

            if detected_format == "images_only":
                # Check for YOLO data.yaml, obj.names, classes.txt, or *.txt files
                yaml_files = [n for n in namelist if n.lower().endswith("data.yaml")]
                classes_txt = [n for n in namelist if n.lower().endswith("classes.txt") or n.lower().endswith("obj.names")]
                txt_files = [n for n in namelist if n.lower().endswith(".txt") and not n.lower().endswith("classes.txt") and not n.lower().endswith("readme.txt")]
                
                if yaml_files or classes_txt or txt_files:
                    detected_format = "yolo"
                    if yaml_files:
                        try:
                            with z.open(yaml_files[0]) as yf:
                                content = yf.read().decode("utf-8")
                                for line in content.splitlines():
                                    if "names:" in line or "names :" in line:
                                        # Simple extraction of list or inline names
                                        idx = line.find("[")
                                        if idx != -1:
                                            names_str = line[idx+1:line.find("]", idx)].replace("'", "").replace('"', "")
                                            for n in names_str.split(","):
                                                if n.strip():
                                                    detected_classes.add(n.strip())
                        except Exception as e:
                            logger.warning(f"Could not parse data.yaml in yolo preview: {e}")

                    if not detected_classes and classes_txt:
                        try:
                            with z.open(classes_txt[0]) as cf:
                                for line in cf.read().decode("utf-8").splitlines():
                                    c_name = line.strip()
                                    if c_name:
                                        detected_classes.add(c_name)
                        except Exception:
                            pass

            if not detected_classes and detected_format == "images_only":
                # Check for folder-based classification classes
                for name in namelist:
                    parts = [p for p in name.split("/") if p]
                    if len(parts) >= 2 and any(parts[-1].lower().endswith(ext) for ext in [".jpg", ".png", ".jpeg"]):
                        detected_classes.add(parts[0])

        return {
            "format": detected_format,
            "detected_classes": sorted(list(detected_classes)),
            "image_count": image_count,
            "filename": zip_path.name
        }

    def ingest_zip_import(
        self,
        project_id: str,
        zip_path: Union[str, Path],
        label_mapping: Optional[Dict[str, str]] = None,
        task_type: str = "object_detection"
    ) -> Dict[str, Any]:
        """
        Unpacks and ingests a ZIP dataset into the project's unified dataset pool.
        Applies label remapping, image checksum deduplication, and master annotation update.
        Supports COCO, YOLO, and Classification ZIP formats natively.
        """
        import zipfile
        from PIL import Image

        zip_path = Path(zip_path)
        p_dir = self.get_project_dir(project_id)
        img_dir = p_dir / "images"
        master = self.load_master_dataset(project_id)
        master["task_type"] = task_type

        label_mapping = label_mapping or {}
        added_count = 0
        skipped_count = 0
        new_annotations_count = 0

        # Existing checksum map
        existing_checksums = {item.get("checksum"): item_id for item_id, item in master["items"].items() if item.get("checksum")}

        with zipfile.ZipFile(zip_path, "r") as z:
            namelist = z.namelist()
            # 1. Check for COCO JSON
            coco_json_name = next((n for n in namelist if n.lower().endswith("annotations.json") or "_annotations.coco.json" in n.lower() or "instances_" in n.lower()), None)
            
            coco_data = None
            coco_categories = {}
            if coco_json_name:
                try:
                    with z.open(coco_json_name) as jf:
                        coco_data = json.load(jf)
                        for cat in coco_data.get("categories", []):
                            cat_id = cat.get("id")
                            cat_name = cat.get("name", str(cat_id))
                            mapped_name = label_mapping.get(cat_name, cat_name)
                            coco_categories[cat_id] = mapped_name
                except Exception as e:
                    logger.warning(f"Failed to read COCO json during ingestion: {e}")

            # Map COCO images & annotations
            coco_image_map = {}
            if coco_data and "images" in coco_data:
                for c_img in coco_data["images"]:
                    coco_image_map[c_img["id"]] = {
                        "filename": Path(c_img.get("file_name", "")).name,
                        "width": c_img.get("width"),
                        "height": c_img.get("height"),
                        "annotations": []
                    }

            if coco_data and "annotations" in coco_data:
                for ann in coco_data["annotations"]:
                    img_id = ann.get("image_id")
                    cat_id = ann.get("category_id")
                    bbox = ann.get("bbox", []) # [x, y, w, h]
                    if img_id in coco_image_map and cat_id in coco_categories and len(bbox) == 4:
                        x, y, w, h = bbox
                        cls_name = coco_categories[cat_id]
                        coco_image_map[img_id]["annotations"].append({
                            "box": [x, y, x + w, y + h],
                            "class_name": cls_name,
                            "label": cls_name,
                            "confidence": 1.0
                        })
                        new_annotations_count += 1
                        if cls_name not in master["classes"]:
                            master["classes"].append(cls_name)

            # 2. Check for YOLO classes in data.yaml, classes.txt, or obj.names
            yolo_classes = []
            yaml_file = next((n for n in namelist if n.lower().endswith("data.yaml")), None)
            if yaml_file:
                try:
                    with z.open(yaml_file) as yf:
                        content = yf.read().decode("utf-8")
                        names_section = False
                        for line in content.splitlines():
                            line_str = line.strip()
                            if "names:" in line_str or "names :" in line_str:
                                idx = line_str.find("[")
                                if idx != -1:
                                    end_idx = line_str.find("]", idx)
                                    names_str = line_str[idx+1:end_idx].replace("'", "").replace('"', "")
                                    for item in names_str.split(","):
                                        if item.strip():
                                            c_m = label_mapping.get(item.strip(), item.strip())
                                            yolo_classes.append(c_m)
                                    break
                                else:
                                    names_section = True
                                    continue
                            if names_section:
                                if line_str.startswith("-"):
                                    c_name = line_str.lstrip("-").strip().replace("'", "").replace('"', "")
                                    if c_name:
                                        c_m = label_mapping.get(c_name, c_name)
                                        yolo_classes.append(c_m)
                                elif ":" in line_str and not line_str.startswith("#"):
                                    parts = line_str.split(":", 1)
                                    if parts[0].strip().isdigit():
                                        c_name = parts[1].strip().replace("'", "").replace('"', "")
                                        if c_name:
                                            c_m = label_mapping.get(c_name, c_name)
                                            yolo_classes.append(c_m)
                                else:
                                    if yolo_classes:
                                        break
                except Exception as ye:
                    logger.warning(f"Failed to parse data.yaml during YOLO ingestion: {ye}")

            if not yolo_classes:
                classes_txt = next((n for n in namelist if n.lower().endswith("classes.txt") or n.lower().endswith("obj.names")), None)
                if classes_txt:
                    try:
                        with z.open(classes_txt) as cf:
                            for line in cf.read().decode("utf-8").splitlines():
                                if line.strip():
                                    mapped = label_mapping.get(line.strip(), line.strip())
                                    yolo_classes.append(mapped)
                    except Exception:
                        pass

            yolo_label_map = {} # filename_stem -> list of normalized bounding boxes
            for member in namelist:
                if member.lower().endswith(".txt") and not member.lower().endswith("classes.txt") and not member.lower().endswith("data.yaml") and not member.lower().endswith("readme.dataset.txt") and not member.lower().endswith("readme.roboflow.txt"):
                    stem = Path(member).stem
                    try:
                        with z.open(member) as tf:
                            lines = tf.read().decode("utf-8").splitlines()
                            boxes = []
                            for line in lines:
                                parts = line.strip().split()
                                if len(parts) >= 5:
                                    c_id = int(parts[0])
                                    cx, cy, w, h = [float(v) for v in parts[1:5]]
                                    if c_id < len(yolo_classes):
                                        c_name = yolo_classes[c_id]
                                    elif master["classes"] and c_id < len(master["classes"]):
                                        c_name = master["classes"][c_id]
                                    elif label_mapping:
                                        c_name = list(label_mapping.values())[0]
                                    else:
                                        c_name = "slice"
                                    mapped_c_name = label_mapping.get(c_name, c_name)
                                    boxes.append((mapped_c_name, cx, cy, w, h))
                            if boxes:
                                yolo_label_map[stem] = boxes
                    except Exception as ye:
                        logger.warning(f"Error parsing YOLO txt file {member}: {ye}")

            # Ingest image files
            for member in namelist:
                lower = member.lower()
                if not lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
                    continue

                filename = Path(member).name
                if not filename:
                    continue

                # Read bytes and calculate SHA256 checksum
                data_bytes = z.read(member)
                hasher = hashlib.sha256()
                hasher.update(data_bytes)
                checksum = hasher.hexdigest()

                if checksum in existing_checksums:
                    skipped_count += 1
                    continue

                # Save image file
                dest_file = img_dir / filename
                if dest_file.exists():
                    dest_file = img_dir / f"{checksum[:8]}_{filename}"

                with open(dest_file, "wb") as f:
                    f.write(data_bytes)

                # Get dimensions
                width, height = 800, 600
                try:
                    with Image.open(dest_file) as pimg:
                        width, height = pimg.size
                except Exception:
                    pass

                # Check if we have parsed annotations for this file
                item_anns = []
                # Check COCO map
                for c_info in coco_image_map.values():
                    if c_info["filename"] == filename:
                        item_anns = c_info["annotations"]
                        break

                # Check YOLO map (flexible stem matching)
                if not item_anns:
                    stem = Path(filename).stem
                    matched_boxes = yolo_label_map.get(stem)
                    if not matched_boxes:
                        clean_stem = stem.replace("_jpg", "").replace("_png", "").replace("_jpeg", "")
                        for k, v in yolo_label_map.items():
                            clean_k = k.replace("_jpg", "").replace("_png", "").replace("_jpeg", "")
                            if clean_k.lower() == clean_stem.lower():
                                matched_boxes = v
                                break

                    if matched_boxes:
                        for (c_name, cx, cy, w, h) in matched_boxes:
                            x1 = max(0, min(int((cx - w/2) * width), width - 1))
                            y1 = max(0, min(int((cy - h/2) * height), height - 1))
                            x2 = max(0, min(int((cx + w/2) * width), width - 1))
                            y2 = max(0, min(int((cy + h/2) * height), height - 1))
                            if x2 > x1 and y2 > y1:
                                item_anns.append({
                                    "box": [x1, y1, x2, y2],
                                    "class_name": c_name,
                                    "label": c_name,
                                    "confidence": 1.0
                                })
                                new_annotations_count += 1
                                if c_name not in master["classes"]:
                                    master["classes"].append(c_name)

                item_id = dest_file.name
                status = "annotated" if item_anns else "unannotated"

                master["items"][item_id] = {
                    "id": item_id,
                    "filename": item_id,
                    "path": f"images/{item_id}",
                    "status": status,
                    "checksum": checksum,
                    "width": width,
                    "height": height,
                    "annotations": item_anns,
                    "added_at": time.time(),
                    "source_zip": zip_path.name
                }
                existing_checksums[checksum] = item_id
                added_count += 1

        self.save_master_dataset(project_id, master)

        return {
            "project_id": project_id,
            "added_count": added_count,
            "skipped_count": skipped_count,
            "annotations_count": new_annotations_count,
            "total_items": len(master["items"]),
            "classes": master["classes"]
        }

    def get_project_items(
        self,
        project_id: str,
        status_filter: Optional[str] = None,
        class_filter: Optional[str] = None,
        search: Optional[str] = None
    ) -> Dict[str, Any]:
        master = self.load_master_dataset(project_id)
        items_list = []

        for item_id, item in master["items"].items():
            if status_filter and status_filter.lower() != "all":
                if item.get("status", "").lower() != status_filter.lower():
                    continue

            if class_filter and class_filter.lower() != "all":
                anns = item.get("annotations", [])
                item_classes = [a.get("class_name", "") for a in anns]
                if class_filter not in item_classes:
                    continue

            if search:
                if search.lower() not in item_id.lower():
                    continue

            items_list.append(item)

        items_list.sort(key=lambda x: x.get("added_at", 0), reverse=True)

        return {
            "project_id": project_id,
            "total_count": len(master["items"]),
            "filtered_count": len(items_list),
            "classes": master["classes"],
            "items": items_list
        }

    def save_item_annotations(self, project_id: str, item_id: str, annotations: List[Dict[str, Any]]) -> bool:
        master = self.load_master_dataset(project_id)
        if item_id in master["items"]:
            master["items"][item_id]["annotations"] = annotations
            master["items"][item_id]["status"] = "annotated" if annotations else "unannotated"
            
            # Sync any new class names to master classes
            for ann in annotations:
                c_name = ann.get("class_name")
                if c_name and c_name not in master["classes"]:
                    master["classes"].append(c_name)

            self.save_master_dataset(project_id, master)
            return True
        return False

    def create_version_snapshot(
        self,
        project_id: str,
        version_name: str,
        train_ratio: float = 0.8,
        val_ratio: float = 0.2
    ) -> Dict[str, Any]:
        """
        Takes an immutable snapshot of the project dataset at the current moment (v1.0, v2.0).
        Assigns train/val splits and freezes items & annotations.
        """
        import random
        master = self.load_master_dataset(project_id)
        v_dir = self.get_project_dir(project_id) / "versions"
        version_id = version_name.lower().replace(" ", "_").replace("/", "_") or f"v_{int(time.time())}"

        items_dict = {}
        items_keys = sorted(list(master["items"].keys()))
        random.seed(42)
        random.shuffle(items_keys)

        num_train = int(len(items_keys) * train_ratio)
        for idx, key in enumerate(items_keys):
            split = "train" if idx < num_train else "val"
            item_copy = master["items"][key].copy()
            item_copy["split"] = split
            items_dict[key] = item_copy

        snapshot = {
            "version_id": version_id,
            "version_name": version_name,
            "project_id": project_id,
            "created_at": time.time(),
            "sample_count": len(items_dict),
            "classes": master["classes"],
            "split_ratios": {"train": train_ratio, "val": val_ratio},
            "items": items_dict
        }

        with open(v_dir / f"{version_id}.json", "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)

        logger.info(f"Created dataset version snapshot '{version_id}' for project '{project_id}'")
        return snapshot

    def list_version_snapshots(self, project_id: str) -> List[Dict[str, Any]]:
        v_dir = self.get_project_dir(project_id) / "versions"
        snapshots = []
        if v_dir.exists():
            for v_file in v_dir.glob("*.json"):
                try:
                    with open(v_file, "r", encoding="utf-8") as f:
                        snapshots.append(json.load(f))
                except Exception as e:
                    logger.warning(f"Error loading version file {v_file}: {e}")

        snapshots.sort(key=lambda s: s.get("created_at", 0), reverse=True)
        return snapshots

    def export_dataset_zip(
        self,
        project_id: str,
        version_id: Optional[str] = None,
        export_format: str = "coco"
    ) -> Path:
        """
        Exports master dataset or specific snapshot as a downloadable ZIP package in COCO JSON or YOLO format.
        """
        import zipfile
        p_dir = self.get_project_dir(project_id)
        
        if version_id:
            v_file = p_dir / "versions" / f"{version_id}.json"
            if v_file.exists():
                with open(v_file, "r", encoding="utf-8") as f:
                    ds_data = json.load(f)
            else:
                ds_data = self.load_master_dataset(project_id)
        else:
            ds_data = self.load_master_dataset(project_id)

        export_zip_path = p_dir / f"export_{project_id}_{version_id or 'master'}_{export_format}.zip"
        classes_list = ds_data.get("classes", [])
        class_to_idx = {c: i for i, c in enumerate(classes_list)}
        
        with zipfile.ZipFile(export_zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            if export_format == "yolo":
                # Write YOLO classes.txt
                z.writestr("classes.txt", "\n".join(classes_list))
                # Write YOLO data.yaml
                yaml_content = f"names:\n" + "\n".join([f"  {i}: {c}" for i, c in enumerate(classes_list)]) + f"\nnc: {len(classes_list)}\n"
                z.writestr("data.yaml", yaml_content)

                for item_id, item in ds_data.get("items", {}).items():
                    src_path = p_dir / item.get("path", f"images/{item_id}")
                    if not src_path.exists():
                        continue

                    # Write image file
                    z.write(src_path, arcname=f"images/{item_id}")

                    # Write YOLO label txt file
                    img_w = item.get("width", 800)
                    img_h = item.get("height", 600)
                    yolo_lines = []
                    for ann in item.get("annotations", []):
                        box = ann.get("box", [0, 0, 0, 0])
                        c_name = ann.get("class_name", "Unknown")
                        if len(box) == 4 and c_name in class_to_idx:
                            x1, y1, x2, y2 = box
                            cx_norm = ((x1 + x2) / 2.0) / img_w
                            cy_norm = ((y1 + y2) / 2.0) / img_h
                            w_norm = (x2 - x1) / img_w
                            h_norm = (y2 - y1) / img_h
                            c_id = class_to_idx[c_name]
                            yolo_lines.append(f"{c_id} {cx_norm:.6f} {cy_norm:.6f} {w_norm:.6f} {h_norm:.6f}")

                    stem = Path(item_id).stem
                    z.writestr(f"labels/{stem}.txt", "\n".join(yolo_lines))
            else:
                # COCO format
                categories = [{"id": i + 1, "name": c} for i, c in enumerate(classes_list)]
                cat_name_to_id = {c["name"]: c["id"] for c in categories}
                
                coco_images = []
                coco_annotations = []
                ann_id = 1

                for img_idx, (item_id, item) in enumerate(ds_data.get("items", {}).items()):
                    src_path = p_dir / item.get("path", f"images/{item_id}")
                    if not src_path.exists():
                        continue

                    z.write(src_path, arcname=f"images/{item_id}")

                    image_entry_id = img_idx + 1
                    coco_images.append({
                        "id": image_entry_id,
                        "file_name": f"images/{item_id}",
                        "width": item.get("width", 800),
                        "height": item.get("height", 600)
                    })

                    for ann in item.get("annotations", []):
                        box = ann.get("box", [0, 0, 0, 0])
                        c_name = ann.get("class_name", "Unknown")
                        if len(box) == 4 and c_name in cat_name_to_id:
                            x1, y1, x2, y2 = box
                            w = max(0, x2 - x1)
                            h = max(0, y2 - y1)
                            coco_annotations.append({
                                "id": ann_id,
                                "image_id": image_entry_id,
                                "category_id": cat_name_to_id[c_name],
                                "bbox": [x1, y1, w, h],
                                "area": w * h,
                                "iscrowd": 0
                            })
                            ann_id += 1

                coco_manifest = {
                    "categories": categories,
                    "images": coco_images,
                    "annotations": coco_annotations
                }
                z.writestr("annotations.json", json.dumps(coco_manifest, indent=2))

        return export_zip_path


