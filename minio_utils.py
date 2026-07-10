"""
MinIO Storage Utility Module for No-Code AI Platform.
Provides helper functions to upload, download, check, and delete datasets and models.
"""
import os
import logging
from pathlib import Path
from typing import Optional
from minio import Minio
from minio.error import S3Error

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cache the client instance
_minio_client: Optional[Minio] = None

def get_minio_client() -> Minio:
    """
    Initialize and return the MinIO client.
    Automatically resolves localhost vs docker network routing based on DOCKER_MODE.
    """
    global _minio_client
    if _minio_client is not None:
        return _minio_client

    endpoint = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    # Resolve routing within docker if running in docker mode
    if os.getenv("DOCKER_MODE") == "true" and "localhost" in endpoint:
        endpoint = endpoint.replace("localhost", "minio")
        # If the port was mapped to a custom host port, replace it with internal container port 9000
        if ":" in endpoint:
            parts = endpoint.split(":")
            endpoint = f"{parts[0]}:9000"
        
    access_key = os.getenv("MINIO_ACCESS_KEY", "minioadmin")
    secret_key = os.getenv("MINIO_SECRET_KEY", "minioadmin")
    secure_str = os.getenv("MINIO_SECURE", "false").lower()
    secure = secure_str in ("true", "1", "yes")

    logger.info(f"Connecting to MinIO at {endpoint} (secure={secure})")
    
    try:
        _minio_client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure
        )
        return _minio_client
    except Exception as e:
        logger.error(f"Failed to initialize MinIO client: {e}")
        raise e

def ensure_bucket_exists(bucket_name: str) -> None:
    """Check if bucket exists; if not, create it."""
    client = get_minio_client()
    try:
        if not client.bucket_exists(bucket_name):
            client.make_bucket(bucket_name)
            logger.info(f"Created MinIO bucket: '{bucket_name}'")
    except S3Error as e:
        logger.error(f"Error checking/creating bucket '{bucket_name}': {e}")
        raise e

def upload_file(bucket_name: str, object_name: str, file_path: str) -> bool:
    """Upload a single file to MinIO."""
    try:
        client = get_minio_client()
        ensure_bucket_exists(bucket_name)
        
        logger.info(f"Uploading file '{file_path}' to MinIO as '{object_name}' in bucket '{bucket_name}'")
        client.fput_object(bucket_name, object_name, file_path)
        return True
    except Exception as e:
        logger.error(f"Error uploading file '{file_path}' to MinIO: {e}")
        return False

def download_file(bucket_name: str, object_name: str, file_path: str) -> bool:
    """Download a single file from MinIO."""
    try:
        client = get_minio_client()
        # Ensure parent folder exists
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Downloading '{object_name}' from bucket '{bucket_name}' to '{file_path}'")
        client.fget_object(bucket_name, object_name, file_path)
        return True
    except Exception as e:
        logger.error(f"Error downloading '{object_name}' from MinIO: {e}")
        return False

def upload_directory(bucket_name: str, prefix: str, local_dir_path: str) -> bool:
    """Upload an entire directory recursively to MinIO under the specified prefix."""
    try:
        client = get_minio_client()
        ensure_bucket_exists(bucket_name)
        
        local_dir = Path(local_dir_path)
        if not local_dir.exists() or not local_dir.is_dir():
            logger.error(f"Local directory does not exist or is not a directory: {local_dir_path}")
            return False

        logger.info(f"Uploading directory '{local_dir_path}' to MinIO under prefix '{prefix}'")
        
        # Walk and upload each file
        for file_path in local_dir.rglob("*"):
            if file_path.is_file():
                # Avoid uploading hidden files/folders
                if any(part.startswith('.') for part in file_path.parts):
                    continue
                
                rel_path = file_path.relative_to(local_dir)
                object_name = f"{prefix}/{rel_path.as_posix()}" if prefix else rel_path.as_posix()
                
                client.fput_object(bucket_name, object_name, str(file_path))
                
        logger.info(f"Successfully uploaded directory '{local_dir_path}' to prefix '{prefix}'")
        return True
    except Exception as e:
        logger.error(f"Error uploading directory '{local_dir_path}' to MinIO: {e}")
        return False

def download_directory(bucket_name: str, prefix: str, local_dir_path: str) -> bool:
    """Download all objects in a bucket prefix recursively to a local directory."""
    try:
        client = get_minio_client()
        local_dir = Path(local_dir_path)
        local_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Downloading MinIO prefix '{prefix}' from bucket '{bucket_name}' to '{local_dir_path}'")
        
        # List all objects with prefix
        objects = client.list_objects(bucket_name, prefix=prefix, recursive=True)
        downloaded_any = False
        
        for obj in objects:
            object_name = obj.object_name
            # Compute relative path by stripping the prefix
            if prefix:
                rel_path_str = object_name[len(prefix):].lstrip("/")
            else:
                rel_path_str = object_name
                
            if not rel_path_str:
                continue
                
            local_file_path = local_dir / rel_path_str
            local_file_path.parent.mkdir(parents=True, exist_ok=True)
            
            client.fget_object(bucket_name, object_name, str(local_file_path))
            downloaded_any = True
            
        if not downloaded_any:
            logger.warning(f"No objects found in bucket '{bucket_name}' under prefix '{prefix}'")
            return False
            
        logger.info(f"Successfully downloaded prefix '{prefix}' to '{local_dir_path}'")
        return True
    except Exception as e:
        logger.error(f"Error downloading prefix '{prefix}' from MinIO: {e}")
        return False

def delete_prefix(bucket_name: str, prefix: str) -> bool:
    """Delete all objects under a prefix from MinIO."""
    try:
        client = get_minio_client()
        if not client.bucket_exists(bucket_name):
            return True
            
        logger.info(f"Deleting prefix '{prefix}' from bucket '{bucket_name}'")
        
        # List all objects in prefix
        objects = client.list_objects(bucket_name, prefix=prefix, recursive=True)
        
        # MinIO delete_objects accepts a generator/list of DeleteObject elements
        from minio.deleteobjects import DeleteObject
        delete_list = [DeleteObject(obj.object_name) for obj in objects]
        
        if delete_list:
            errors = client.remove_objects(bucket_name, delete_list)
            for err in errors:
                logger.error(f"Error deleting object '{err.object_name}': {err.message}")
                
        logger.info(f"Successfully deleted prefix '{prefix}' from bucket '{bucket_name}'")
        return True
    except Exception as e:
        logger.error(f"Error deleting prefix '{prefix}' from MinIO: {e}")
        return False

def exists(bucket_name: str, path_or_prefix: str) -> bool:
    """Check if an object or directory prefix exists in the specified bucket."""
    try:
        client = get_minio_client()
        if not client.bucket_exists(bucket_name):
            return False
            
        # Try checking if it's an exact file/object
        try:
            client.stat_object(bucket_name, path_or_prefix)
            return True
        except Exception:
            pass
            
        # Try checking if it is a directory prefix
        prefix = path_or_prefix.rstrip("/") + "/"
        objects = client.list_objects(bucket_name, prefix=prefix, recursive=False)
        for _ in objects:
            return True
            
        return False
    except Exception as e:
        logger.error(f"Error checking existence for '{path_or_prefix}' in bucket '{bucket_name}': {e}")
        return False
