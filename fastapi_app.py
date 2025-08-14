# fastapi_app.py

import sys
import subprocess
import uuid
import asyncio
import re
import json
import os
import shutil
import zipfile
from pydantic import BaseModel, Field
from fastapi import FastAPI, BackgroundTasks, Form, File, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from typing import Dict, Any, List, Optional

# --- Setup ---
LOG_DIR = "/tmp/training_logs"
UPLOAD_DIR = "/tmp/training_uploads" 
OUTPUT_DIR = "/tmp/inference_outputs"
MODEL_OUTPUT_ROOT = "model_outputs" 

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(MODEL_OUTPUT_ROOT, exist_ok=True)

app = FastAPI(
    title="Multi-Task Training & Inference API",
    description="An API to run training jobs and perform inference for ASR and Object Detection.",
    version="10.0.0",
)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs: Dict[str, Dict[str, Any]] = {}

# --- Background & Helper Functions ---
async def run_training_script(job_id: str, cmd: list):
    jobs[job_id]["status"] = "running"
    log_file_path = jobs[job_id]["log_file"]
    
    with open(log_file_path, "w") as log_file:
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=log_file, stderr=subprocess.STDOUT
        )
    
    await process.wait()
    jobs[job_id]["status"] = "completed" if process.returncode == 0 else "failed"

def start_job_internal(job_id: str, task_name: str, script_name: str, args: list, output_dir: str, metrics_filename: str, background_tasks: BackgroundTasks):
    log_file = os.path.join(LOG_DIR, f"{job_id}.log")
    jobs[job_id] = {
        "status": "queued", 
        "log_file": log_file, 
        "task": task_name, 
        "output_dir": output_dir,
        "metrics_filename": metrics_filename
    }
    
    cmd = [sys.executable, script_name] + args
    background_tasks.add_task(run_training_script, job_id, cmd)
    return {"job_id": job_id, "status": "queued"}

# --- API Endpoints ---
@app.post("/train/object-detection", status_code=202)
async def start_object_detection_training(
    background_tasks: BackgroundTasks,
    data_zip: UploadFile = File(...),
    model_checkpoint: str = Form("facebook/detr-resnet-50"),
    run_name: str = Form("shiny-obj-run"),
    version: str = Form("1.0.0"),
    epochs: int = Form(5),
    learning_rate: float = Form(5e-5),
    weight_decay: float = Form(1e-4),
    train_batch_size: int = Form(8),
    eval_batch_size: int = Form(8),
    gradient_accumulation_steps: int = Form(1),
    gradient_checkpointing: bool = Form(False),
    max_image_size: int = Form(600),
    seed: int = Form(42),
    num_proc: int = Form(4),
    fp16: bool = Form(True),
    push_to_hub: bool = Form(False),
    hub_user_id: Optional[str] = Form(None),
    log_to_wandb: bool = Form(False),
    wandb_project: Optional[str] = Form(None),
    wandb_entity: Optional[str] = Form(None),
    early_stopping_patience: int = Form(5),
    early_stopping_threshold: float = Form(0.0)
):
    job_id = str(uuid.uuid4())

    # Handle file upload and create paths
    raw_data_dir = os.path.join(UPLOAD_DIR, f"raw_{job_id}")
    processed_data_dir = os.path.join(UPLOAD_DIR, f"processed_{job_id}")
    os.makedirs(raw_data_dir, exist_ok=True)
    
    zip_path = os.path.join(raw_data_dir, data_zip.filename)
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(data_zip.file, buffer)
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(raw_data_dir)
    
    output_dir = os.path.join(MODEL_OUTPUT_ROOT, f"{model_checkpoint.split('/')[-1]}-{run_name}-{version}")
    metrics_filename = f"metrics_{job_id}.json"
    
    args = [
        "--data_dir", raw_data_dir,
        "--processed_data_dir", processed_data_dir,
        "--model_checkpoint", model_checkpoint,
        "--run_name", run_name,
        "--version", version,
        "--epochs", str(epochs),
        "--learning_rate", str(learning_rate),
        "--weight_decay", str(weight_decay),
        "--train_batch_size", str(train_batch_size),
        "--eval_batch_size", str(eval_batch_size),
        "--gradient_accumulation_steps", str(gradient_accumulation_steps),
        "--max_image_size", str(max_image_size),
        "--seed", str(seed),
        "--num_proc", str(num_proc),
        "--early_stopping_patience", str(early_stopping_patience),
        "--early_stopping_threshold", str(early_stopping_threshold),
        "--metrics_filename", metrics_filename,
        "--model_output_root", MODEL_OUTPUT_ROOT
    ]
    if fp16: args.append("--fp16")
    if push_to_hub: args.append("--push_to_hub")
    if hub_user_id: args.extend(["--hub_user_id", hub_user_id])
    if log_to_wandb: args.append("--log_to_wandb")
    if wandb_project: args.extend(["--wandb_project", wandb_project])
    if wandb_entity: args.extend(["--wandb_entity", wandb_entity])
    if gradient_checkpointing: args.append("--gradient_checkpointing")
        
    return start_job_internal(job_id, "Object Detection", "object_detection_train.py", args, output_dir, metrics_filename, background_tasks)

@app.post("/train/asr", status_code=202)
async def start_asr_training(
    background_tasks: BackgroundTasks,
    data_zip: UploadFile = File(...),
    run_name: str = Form("shiny-asr-run"),
    version: str = Form("1.0.0"),
    model_checkpoint: str = Form("openai/whisper-base"),
    language: str = Form("english"),
    language_code: str = Form("en"),
    speaker_id_column: Optional[str] = Form(None),
    text_column: str = Form("sentence"),
    target_sampling_rate: int = Form(16000),
    min_duration_s: float = Form(1.0),
    max_duration_s: float = Form(30.0),
    min_transcript_len: int = Form(10),
    max_transcript_len: int = Form(300),
    apply_outlier_filtering: bool = Form(False),
    outlier_std_devs: float = Form(2.0),
    is_presplit: bool = Form(True),
    speaker_disjointness: bool = Form(True),
    train_ratio: float = Form(0.8),
    dev_ratio: float = Form(0.1),
    test_ratio: float = Form(0.1),
    epochs: float = Form(5.0),
    learning_rate: float = Form(3e-4),
    lr_scheduler_type: str = Form("linear"),
    warmup_ratio: float = Form(0.1),
    train_batch_size: int = Form(16),
    eval_batch_size: int = Form(16),
    gradient_accumulation_steps: int = Form(1),
    gradient_checkpointing: bool = Form(False),
    optimizer: str = Form("adamw_torch"),
    early_stopping_patience: int = Form(5),
    early_stopping_threshold: float = Form(1e-3),
    push_to_hub: bool = Form(False),
    hub_user_id: Optional[str] = Form(None),
    hub_private_repo: bool = Form(True),
    log_to_wandb: bool = Form(False),
    wandb_project: Optional[str] = Form(None),
    wandb_entity: Optional[str] = Form(None),
    seed: int = Form(42),
    num_proc: int = Form(4)
):
    job_id = str(uuid.uuid4())

    unzip_dir = os.path.join(UPLOAD_DIR, job_id)
    os.makedirs(unzip_dir, exist_ok=True)
    zip_path = os.path.join(unzip_dir, data_zip.filename)
    with open(zip_path, "wb") as buffer:
        shutil.copyfileobj(data_zip.file, buffer)
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(unzip_dir)

    output_dir = os.path.join(MODEL_OUTPUT_ROOT, f"{model_checkpoint.split('/')[-1].replace('/','-')}-{run_name}-{version}")
    metrics_filename = f"metrics_{job_id}.json"
    
    args = [
        "--data_dir", unzip_dir, "--run_name", run_name, "--version", version,
        "--model_checkpoint", model_checkpoint, "--language", language,
        "--language_code", language_code, "--text_column", text_column,
        "--target_sampling_rate", str(target_sampling_rate), "--min_duration_s", str(min_duration_s),
        "--max_duration_s", str(max_duration_s), "--min_transcript_len", str(min_transcript_len),
        "--max_transcript_len", str(max_transcript_len), "--outlier_std_devs", str(outlier_std_devs),
        "--train_ratio", str(train_ratio), "--dev_ratio", str(dev_ratio), "--test_ratio", str(test_ratio),
        "--epochs", str(epochs), "--learning_rate", str(learning_rate),
        "--lr_scheduler_type", lr_scheduler_type, "--warmup_ratio", str(warmup_ratio),
        "--train_batch_size", str(train_batch_size), "--eval_batch_size", str(eval_batch_size),
        "--gradient_accumulation_steps", str(gradient_accumulation_steps),
        "--optimizer", optimizer, "--early_stopping_patience", str(early_stopping_patience),
        "--early_stopping_threshold", str(early_stopping_threshold),
        "--seed", str(seed), "--num_proc", str(num_proc),
        "--metrics_filename", metrics_filename, "--model_output_root", MODEL_OUTPUT_ROOT
    ]
    if speaker_id_column: args.extend(["--speaker_id_column", speaker_id_column])
    if apply_outlier_filtering: args.append("--apply_outlier_filtering")
    if is_presplit: args.append("--is_presplit")
    if speaker_disjointness: args.append("--speaker_disjointness")
    if gradient_checkpointing: args.append("--gradient_checkpointing")
    if push_to_hub: args.append("--push_to_hub")
    if hub_user_id: args.extend(["--hub_user_id", hub_user_id])
    if hub_private_repo: args.append("--hub_private_repo")
    if log_to_wandb: args.append("--log_to_wandb")
    if wandb_project: args.extend(["--wandb_project", wandb_project])
    if wandb_entity: args.extend(["--wandb_entity", wandb_entity])

    return start_job_internal(job_id, "ASR", "asr_train.py", args, output_dir, metrics_filename, background_tasks)

@app.get("/status/{job_id}")
async def get_job_status(job_id: str):
    job = jobs.get(job_id)
    if not job: return JSONResponse(status_code=404, content={"error": "Job not found"})
    log_content = ""
    progress = {"percentage": 0, "text": "Starting..."}
    try:
        with open(job["log_file"], "r") as f:
            log_content = f.read()
        lines = log_content.splitlines()
        progress_regex = re.compile(r"(\d+)\s*%")
        for line in reversed(lines):
            progress_match = progress_regex.search(line)
            if progress_match:
                progress["percentage"] = int(progress_match.group(1))
                progress["text"] = line.strip()
                break
    except FileNotFoundError: pass
    return {"status": job["status"], "task": job.get("task", "N/A"), "log": log_content, "progress": progress}

@app.get("/metrics/{job_id}", response_model=List[Dict[str, Any]])
async def get_job_metrics(job_id: str):
    job = jobs.get(job_id)
    if not job or "output_dir" not in job or "metrics_filename" not in job: return []
    metrics_file_path = os.path.join(job["output_dir"], job["metrics_filename"])
    if not os.path.exists(metrics_file_path): return []
    metrics_data = []
    with open(metrics_file_path, "r") as f:
        for line in f:
            try:
                metrics_data.append(json.loads(line.strip()))
            except json.JSONDecodeError: continue
    return metrics_data

@app.get("/checkpoints", response_model=List[str])
async def find_checkpoints(run_name: str = Query(..., min_length=1)):
    if not os.path.isdir(MODEL_OUTPUT_ROOT): return []
    found_checkpoints = []
    for root_dir in os.listdir(MODEL_OUTPUT_ROOT):
        if run_name in root_dir:
            full_path = os.path.join(MODEL_OUTPUT_ROOT, root_dir)
            if os.path.isdir(full_path):
                for sub_dir in os.listdir(full_path):
                    if sub_dir.startswith("checkpoint-"):
                        checkpoint_path = os.path.join(full_path, sub_dir)
                        if os.path.isdir(checkpoint_path):
                            found_checkpoints.append(checkpoint_path)
    return found_checkpoints

@app.post("/inference/object-detection")
async def run_object_detection_inference(
    model_checkpoint: str = Form(...),
    image: UploadFile = File(...),
    threshold: float = Form(0.5)
):
    try:
        input_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}_{image.filename}")
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)

        output_filename = f"output_{os.path.basename(input_path)}"
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        cmd = [
            sys.executable, "object_detection_inference.py",
            "--model_checkpoint", model_checkpoint,
            "--image_path", input_path,
            "--output_path", output_path,
            "--threshold", str(threshold)
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return {"output_url": f"/outputs/{output_filename}"}

    except subprocess.CalledProcessError as e:
        print(f"Inference script failed. Stderr:\n{e.stderr}", file=sys.stderr)
        return JSONResponse(status_code=500, content={"error": "Inference script failed", "details": e.stderr})
    except Exception as e:
        print(f"An unexpected error occurred in inference endpoint: {e}", file=sys.stderr)
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/inference/asr")
async def run_asr_inference_endpoint(model_checkpoint: str = Form(...), audio: UploadFile = File(...)):
    try:
        input_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}_{audio.filename}")
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)

        cmd = [
            sys.executable, "asr_inference.py",
            "--model_checkpoint", model_checkpoint,
            "--audio_path", input_path,
        ]
        
        process = subprocess.run(cmd, capture_output=True, text=True, check=True)
        transcription = process.stdout.strip()
        
        return {"transcription": transcription}

    except subprocess.CalledProcessError as e:
        print(f"ASR inference script failed. Stderr:\n{e.stderr}", file=sys.stderr)
        return JSONResponse(status_code=500, content={"error": "ASR inference script failed", "details": e.stderr})
    except Exception as e:
        print(f"An unexpected error occurred in ASR inference endpoint: {e}", file=sys.stderr)
        return JSONResponse(status_code=500, content={"error": str(e)})