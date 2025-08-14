# Multi-Task Training Pipeline for Object Detection and ASR

This project provides a configurable and modular pipeline for fine-tuning models for two distinct tasks: Object Detection and Automatic Speech Recognition (ASR). The code is structured to be easily extensible and reusable for different datasets and models.

## Project Structure

The project is organized into separate packages for each task to improve maintainability and clarity.

  * **`fastapi_app.py`**: A REST API built with FastAPI to programmatically start and monitor training jobs for both tasks.
  * **`ui.R` & `server.R`**: A web-based UI built with R Shiny that acts as a client to the FastAPI server, allowing for easy configuration of training and inference tasks.
  * **`object_detection_train.py`**: The main script for executing the Object Detection training and evaluation pipeline.
  * **`object_detection_utils/`**: A package containing all modules specific to the Object Detection task.
      * `data_utils.py`: Functions for loading and processing image data.
      * `augmentations.py`: Image augmentation pipelines.
      * `model_utils.py`: Helpers for loading object detection models.
      * `metrics.py`: Metrics calculation for object detection (mAP).
      * `detection_dataset_builder.py`: The dataset builder script for COCO-style data.
  * **`asr_train.py`**: The main script for executing the ASR training and evaluation pipeline.
  * **`asr_utils/`**: A package containing all modules specific to the ASR task.
      * `data_processing.py`: Functions for cleaning and filtering audio data.
      * `models/`: A directory containing model-specific handlers (`_whisper.py`, `_xlsr.py`, etc.).
      * `factory.py`: A factory to get the correct ASR model handler.
      * `utils.py`: General helper functions for the ASR pipeline.
  * **`requirements.txt`**: A list of all Python packages required to run all pipelines.

-----

## Setup and Installation

### 1\. Create a Virtual Environment

It is highly recommended to use a virtual environment to manage project dependencies.

```bash
python -m venv venv
# On Windows: venv\Scripts\activate
# On macOS/Linux: source venv/bin/activate
```

### 2\. Install Python Dependencies

Install all the required Python packages using the `requirements.txt` file.

```bash
pip install -r requirements.txt
```

### 3\. R and RStudio Setup

Ensure you have R and RStudio (or another R environment) installed. You will also need to install the R packages listed in `server.R` (e.g., `shiny`, `httr2`, `jsonlite`, `DT`, `dplyr`, `tidyr `, `shinyjs`). You can typically install them from the R console:

```r
install.packages(c("shiny", "httr2", "jsonlite", "DT", "dplyr", "shinyjs"))
```

-----

## Data Preparation

### For Object Detection

The pipeline expects your dataset to be in a COCO-like format. The base directory you provide should have the following structure:

```
<base_dir>/
├── train/
│   ├── _annotations.coco.json
│   └── image1.jpg, ...
├── validation/
│   ├── _annotations.coco.json
│   └── image3.jpg, ...
└── test/
    ├── _annotations.coco.json
    └── image5.jpg, ...
```

### For ASR (Automatic Speech Recognition)

The ASR pipeline expects your dataset to be in a directory containing audio files, organized by split. It uses the `audiofolder` dataset loader.

```
<data_dir>/
├── train/
│   ├── metadata.csv  (Optional, but helps)
│   └── audio1.wav, ...
├── validation/
│   ├── metadata.csv
│   └── audio2.wav, ...
└── test/
    ├── metadata.csv
    └── audio3.wav, ...
```

The `metadata.csv` should contain at least a `file_name` column and a `sentence` column for the transcripts.

-----

## How to Run the Pipelines

You have three ways to run the training pipelines: an interactive web UI, a REST API, or directly from the command line.

### Method 1: Interactive Web UI (R Shiny)

Recommended for ease of use and visual feedback.

**1. Launch the FastAPI Backend:**
First, start the Python backend server.

```bash
uvicorn fastapi_app:app --reload
```

**2. Run the Shiny App:**
Open the `ui.R` or `server.R` file in RStudio and click "Run App". The R Shiny interface will open in a new window or your browser, allowing you to interact with the backend.

### Method 2: REST API (FastAPI)

Ideal for programmatic integration and MLOps workflows.

**1. Launch the API Server:**

```bash
uvicorn fastapi_app:app --reload
```

The API will be available at `http://127.0.0.1:8000`. You can interact with it using tools like `curl`.

**2. Start a Training Job (Example using `curl`):**

  * **Object Detection:**

    ```bash
    curl -X POST 'http://127.0.0.1:8000/train/object-detection' \
    -H 'Content-Type: application/json' \
    -d '{ "base_dir": "/path/to/your/obj_dataset" }'
    ```

  * **ASR:**

    ```bash
    curl -X POST 'http://127.0.0.1:8000/train/asr' \
    -H 'Content-Type: application/json' \
    -d '{ "data_dir": "/path/to/your/asr_dataset", "model_checkpoint": "facebook/wav2vec2-base-960h" }'
    ```

**3. Check Job Status:**

```bash
# Replace {YOUR_JOB_ID} with the ID from the previous step
curl -X GET 'http://127.0.0.1:8000/status/{YOUR_JOB_ID}'
```

### Method 3: Command Line

For direct execution and scripting. You must now call the specific training script for each task.

  * **Object Detection:**

    ```bash
    python object_detection_train.py --base_dir /path/to/your/obj_dataset
    ```

  * **ASR:**

    ```bash
    python asr_train.py --data_dir /path/to/your/asr_dataset --model_checkpoint "facebook/wav2vec2-base-960h"
    ```

See all available options for each script by running it with the `--help` flag.