# ui.R

library(shiny)
library(DT)
library(shinyjs)

# Helper function to create a collapsible section
collapsible_panel <- function(title, ..., open = FALSE) {
  tags$details(
    open = if (open) NA else NULL,
    tags$summary(title, style = "font-weight: bold; cursor: pointer; margin-top: 15px;"),
    div(style = "padding: 10px; border: 1px solid #ddd; border-radius: 5px; margin-top: 5px;", ...
    )
  )
}

fluidPage(
    titlePanel("Multi-Task Training & Inference API Client"),
    useShinyjs(),
    
    sidebarLayout(
        sidebarPanel(
            width = 4,
            h4("Task Configuration"),
            selectInput("task_selector", "Select Task:",
                        choices = c("Object Detection", "ASR")),
            
            # --- Object Detection Training UI ---
            hidden(
                div(
                    id = "obj_panel",
                    h5("Object Detection Training", style="font-weight:bold; margin-top:20px; border-bottom: 1px solid #ddd; padding-bottom: 5px;"),
                    collapsible_panel("Paths & Naming", open = TRUE,
                        fileInput("obj_data_zip", "Upload Data (zip file)", accept = ".zip"),
                        textInput("obj_model_checkpoint", "Model Checkpoint", "facebook/detr-resnet-50"),
                        textInput("obj_run_name", "Run Name", "shiny-obj-run"),
                        textInput("obj_version", "Version", "1.0.0")
                    ),
                    collapsible_panel("Training Parameters",
                        numericInput("obj_epochs", "Epochs", 5, min = 1),
                        numericInput("obj_learning_rate", "Learning Rate", 5e-5, step = 1e-6),
                        numericInput("obj_weight_decay", "Weight Decay", 1e-4, step = 1e-5),
                        numericInput("obj_train_batch_size", "Train Batch Size", 8, min = 1),
                        numericInput("obj_eval_batch_size", "Eval Batch Size", 8, min = 1),
                        numericInput("obj_gradient_accumulation_steps", "Gradient Accumulation", 1, min = 1),
                        numericInput("obj_max_image_size", "Max Image Size", 600, min = 128)
                    ),
                    collapsible_panel("Saving & Early Stopping",
                        numericInput("obj_early_stopping_patience", "Early Stopping Patience", 5),
                        numericInput("obj_early_stopping_threshold", "Early Stopping Threshold", 0.0, step = 1e-4)
                    ),
                    collapsible_panel("Execution & Reproducibility",
                        numericInput("obj_seed", "Seed", 42),
                        numericInput("obj_num_proc", "Number of Processes", 4, min = 0),
                        checkboxInput("obj_gradient_checkpointing", "Enable Gradient Checkpointing (Saves Memory)", value = FALSE)
                    ),
                    collapsible_panel("Hub & Logging",
                        checkboxInput("obj_push_to_hub", "Push to Hub", FALSE),
                        # --- ADDED: Hub User/Org Name input ---
                        textInput("obj_hub_user_id", "Hub User/Org Name", ""),
                        checkboxInput("obj_log_to_wandb", "Log to W&B", FALSE),
                        textInput("obj_wandb_project", "W&B Project", ""),
                        textInput("obj_wandb_entity", "W&B Entity", "")
                    ),
                    actionButton("start_obj_job", "Start Object Detection Job", class = "btn-primary", style="margin-top: 15px; width: 100%;")
                )
            ),
            
            # --- ASR Training UI ---
            hidden(
                div(
                    id = "asr_panel",
                    h5("ASR Training", style="font-weight:bold; margin-top:20px; border-bottom: 1px solid #ddd; padding-bottom: 5px;"),
                    collapsible_panel("Paths & Naming", open = TRUE,
                        fileInput("asr_data_zip", "Upload Data (zip file)", accept = ".zip"),
                        selectInput("asr_model_arch", "Model Architecture", 
                                    choices = c("Whisper", "XLS-R", "Wav2Vec2-BERT")),
                        selectInput("asr_model_checkpoint", "Model Checkpoint", choices = NULL),
                        textInput("asr_run_name", "Run Name", "shiny-asr-run"),
                        textInput("asr_version", "Version", "1.0.0")
                    ),
                    collapsible_panel("Dataset & Language",
                        textInput("asr_language", "Language", "english"),
                        textInput("asr_language_code", "Language Code", "en"),
                        textInput("asr_speaker_id_column", "Speaker ID Column (Optional)", "speaker_id"),
                        textInput("asr_text_column", "Text Column", "sentence")
                    ),
                    collapsible_panel("Preprocessing & Filtering",
                        numericInput("asr_target_sampling_rate", "Target Sampling Rate", 16000),
                        numericInput("asr_min_duration_s", "Min Duration (s)", 1.0),
                        numericInput("asr_max_duration_s", "Max Duration (s)", 30.0),
                        numericInput("asr_min_transcript_len", "Min Transcript Length", 10),
                        numericInput("asr_max_transcript_len", "Max Transcript Length", 300),
                        checkboxInput("asr_apply_outlier_filtering", "Apply Outlier Filtering", FALSE),
                        numericInput("asr_outlier_std_devs", "Outlier Std Devs", 2.0)
                    ),
                    collapsible_panel("Data Splitting",
                        checkboxInput("asr_is_presplit", "Is Presplit?", TRUE),
                        checkboxInput("asr_speaker_disjointness", "Speaker Disjoint Split", TRUE),
                        numericInput("asr_train_ratio", "Train Ratio", 0.8, min = 0, max = 1),
                        numericInput("asr_dev_ratio", "Dev Ratio", 0.1, min = 0, max = 1),
                        numericInput("asr_test_ratio", "Test Ratio", 0.1, min = 0, max = 1)
                    ),
                    collapsible_panel("Training Parameters",
                        numericInput("asr_epochs", "Epochs", 5, min = 1),
                        numericInput("asr_learning_rate", "Learning Rate", 3e-4, step = 1e-5),
                        selectInput("asr_lr_scheduler_type", "LR Scheduler", choices = c("linear", "cosine", "constant")),
                        numericInput("asr_warmup_ratio", "Warmup Ratio", 0.1),
                        numericInput("asr_train_batch_size", "Train Batch Size", 16),
                        numericInput("asr_eval_batch_size", "Eval Batch Size", 16),
                        numericInput("asr_gradient_accumulation_steps", "Gradient Accumulation", 1),
                        selectInput("asr_optimizer", "Optimizer", choices = c("adamw_torch", "adamw_hf", "adafactor"))
                    ),
                    collapsible_panel("Saving & Early Stopping",
                        numericInput("asr_early_stopping_patience", "Early Stopping Patience", 5),
                        numericInput("asr_early_stopping_threshold", "Early Stopping Threshold", 1e-3)
                    ),
                    collapsible_panel("Hub & Logging",
                        checkboxInput("asr_push_to_hub", "Push to Hub", FALSE),
                        textInput("asr_hub_user_id", "Hub User/Org Name", ""),
                        checkboxInput("asr_hub_private_repo", "Private Hub Repo", TRUE),
                        checkboxInput("asr_log_to_wandb", "Log to W&B", FALSE),
                        textInput("asr_wandb_project", "W&B Project", ""),
                        textInput("asr_wandb_entity", "W&B Entity", "")
                    ),
                    collapsible_panel("Execution & Advanced",
                        numericInput("asr_seed", "Seed", 42),
                        numericInput("asr_num_proc", "Number of Processes", 4),
                        checkboxInput("asr_gradient_checkpointing", "Enable Gradient Checkpointing (Saves Memory)", value = FALSE)
                    ),
                    actionButton("start_asr_job", "Start ASR Job", class = "btn-success", style="margin-top: 15px; width: 100%;")
                )
            )
        ),
        
        mainPanel(
            width = 8,
            tabsetPanel(
                id = "main_tabs",
                type = "tabs",
                tabPanel("Training Status", 
                    h4("Job Status", style="margin-top:20px;"),
                    wellPanel(
                        strong("Task:"), textOutput("job_task_display", inline = TRUE), br(),
                        strong("Job ID:"), textOutput("job_id_display", inline = TRUE), br(),
                        strong("Status:"), textOutput("job_status_display", inline = TRUE)
                    ),
                    h4("Training Progress"),
                    div(
                        style = "background-color: #e9ecef; border-radius: .25rem; height: 20px; margin-bottom: 1rem;",
                        div(id = "progress-bar", style = "background-color: #007bff; height: 100%; width: 0%; border-radius: .25rem; transition: width .6s ease;")
                    ),
                    textOutput("progress_text"),
                    hr(),
                    h4("Evaluation Results"),
                    DTOutput("eval_table"),
                    hr(),
                    tags$details(
                        style = "margin-top: 15px;",
                        tags$summary("View Full Log", style = "cursor: pointer; font-weight: bold;"),
                        div(
                           style = "background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 10px; margin-top: 5px; max-height: 400px; overflow-y: auto; font-family: monospace; white-space: pre-wrap;",
                           verbatimTextOutput("log_output")
                        )
                    )
                ),
                
                tabPanel("Inference",
                    conditionalPanel(
                        condition = "input.task_selector == 'Object Detection'",
                        h4("Object Detection Inference", style="margin-top:20px;"),
                        wellPanel(
                            textInput("infer_run_name", "Enter Run Name to Find Checkpoints", ""),
                            selectInput("infer_checkpoint_dropdown", "Select Checkpoint", choices = NULL),
                            fileInput("infer_obj_image_upload", "Upload Image for Detection", accept = c('image/png', 'image/jpeg', 'image/jpg')),
                            sliderInput("infer_obj_threshold", "Confidence Threshold", min = 0.1, max = 1.0, value = 0.5, step = 0.05),
                            actionButton("start_obj_inference", "Run Inference", class = "btn-info", style="margin-top: 10px;")
                        ),
                        hr(),
                        h5("Inference Result"),
                        uiOutput("inference_status_ui"),
                        imageOutput("inference_image_output", height = "auto")
                    ),
                    conditionalPanel(
                        condition = "input.task_selector == 'ASR'",
                        h4("ASR Inference", style="margin-top:20px;"),
                        wellPanel(
                            textInput("infer_asr_run_name", "Enter Run Name to Find Checkpoints", ""),
                            selectInput("infer_asr_checkpoint_dropdown", "Select Checkpoint", choices = NULL),
                            fileInput("infer_asr_audio_upload", "Upload Audio File", accept = c('audio/wav', 'audio/mp3', 'audio/flac')),
                            actionButton("start_asr_inference", "Run Inference", class = "btn-info", style="margin-top: 10px;")
                        ),
                        hr(),
                        h5("Transcription Result"),
                        uiOutput("asr_inference_status_ui"),
                        div(
                           style = "background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin-top: 5px; min-height: 100px; font-size: 1.1em;",
                           textOutput("asr_transcription_output")
                        )
                    )
                )
            )
        )
    )
)