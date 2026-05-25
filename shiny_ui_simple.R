# Enhanced No-Code AI Platform - R Shiny UI
# Full feature parity with Gradio interface

library(shiny)
library(shinydashboard)
library(DT)
library(jsonlite)
library(httr)
library(base64enc)

# Configuration
API_URL <- Sys.getenv("API_URL", "http://host.docker.internal:8090")  # FastAPI backend URL  # FastAPI backend URL

# Increase maximum file upload size to 500MB (default is 5MB)
options(shiny.maxRequestSize = 500*1024^2)

# Define the %||% operator for default values (like || in JavaScript)
`%||%` <- function(a, b) {
  if (is.null(a) || length(a) == 0 || (is.character(a) && a == "")) b else a
}

# Helper Functions using httr
make_request <- function(url, method = "GET", body = NULL, files = NULL) {
  tryCatch({
    if (method == "GET") {
      response <- GET(url)
      return(list(
        status = status_code(response),
        content = content(response, "text", encoding = "UTF-8")
      ))
    } else if (method == "POST") {
      if (!is.null(body) && is.null(files)) {
        # POST request with JSON body
        response <- POST(
          url,
          body = body,
          add_headers("Content-Type" = "application/json"),
          encode = "raw"
        )
        return(list(
          status = status_code(response),
          content = content(response, "text", encoding = "UTF-8")
        ))
      } else if (!is.null(files)) {
        # POST request with file upload
        response <- POST(
          url,
          body = files,
          encode = "multipart"
        )
        return(list(
          status = status_code(response),
          content = content(response, "text", encoding = "UTF-8")
        ))
      } else {
        # Simple POST without body
        response <- POST(url)
        return(list(
          status = status_code(response),
          content = content(response, "text", encoding = "UTF-8")
        ))
      }
    } else if (method == "DELETE") {
      response <- DELETE(url)
      return(list(
        status = status_code(response),
        content = content(response, "text", encoding = "UTF-8")
      ))
    } else if (method == "PUT") {
      if (!is.null(body)) {
        response <- PUT(
          url,
          body = body,
          add_headers("Content-Type" = "application/json"),
          encode = "raw"
        )
      } else {
        response <- PUT(url)
      }
      return(list(
        status = status_code(response),
        content = content(response, "text", encoding = "UTF-8")
      ))
    }
  }, error = function(e) {
    return(list(status = 500, content = paste("Error:", e$message)))
  })
}

# File upload helper function
upload_dataset_file <- function(url, file_path, field_name = "file") {
  tryCatch({
    if (!file.exists(file_path)) {
      return(list(status = 404, content = "File not found"))
    }
    
    response <- POST(
      url,
      body = list(file = httr::upload_file(file_path)),
      encode = "multipart"
    )
    
    return(list(
      status = status_code(response),
      content = content(response, "text", encoding = "UTF-8")
    ))
  }, error = function(e) {
    return(list(status = 500, content = paste("Upload error:", e$message)))
  })
}

get_api_status <- function() {
  tryCatch({
    response <- make_request(paste0(API_URL, "/health"))
    if (response$status == 200) {
      data <- fromJSON(response$content)
      paste("API Status: Healthy. Active jobs:", data$active_jobs)
    } else {
      paste("API Status: Error (", response$status, ")")
    }
  }, error = function(e) {
    paste("API Status: Error -", e$message)
  })
}

start_mlflow <- function() {
  tryCatch({
    response <- make_request(paste0(API_URL, "/mlflow/start-server"), method = "POST")
    if (response$status == 200) {
      # Try to get MLflow URL
      mlflow_response <- make_request(paste0(API_URL, "/mlflow/ui-url"))
      if (mlflow_response$status == 200) {
        mlflow_data <- fromJSON(mlflow_response$content)
        mlflow_url <- mlflow_data$url
        paste("MLflow started successfully. UI available at:", mlflow_url)
      } else {
        "MLflow started successfully"
      }
    } else {
      paste("Error starting MLflow:", response$status)
    }
  }, error = function(e) {
    paste("Error starting MLflow:", e$message)
  })
}

list_all_jobs <- function() {
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines"))
    if (response$status == 200) {
      jobs <- fromJSON(response$content, simplifyVector = FALSE)
      
      # Handle different response structures
      if (is.list(jobs) && !is.null(names(jobs))) {
        # Single job returned as named list
        jobs <- list(jobs)
      } else if (!is.list(jobs)) {
        # Invalid response
        return(data.frame(Error = "Invalid response format"))
      }
      
      if (length(jobs) == 0) {
        return(data.frame(Message = "No jobs found"))
      }
      
      # Safely extract job information
      job_data <- lapply(jobs, function(job) {
        if (!is.list(job)) {
          return(list(ID = "N/A", Name = "N/A", Status = "N/A", Created = "N/A", Architecture = "N/A", Task = "N/A"))
        }
        
        id <- if (is.null(job$id)) "N/A" else as.character(job$id)
        status <- if (is.null(job$status)) "N/A" else as.character(job$status)
        created <- if (is.null(job$created_at)) "N/A" else substr(as.character(job$created_at), 1, 10)
        
        # Safely extract pipeline config
        config <- job$pipeline_config
        if (is.list(config)) {
          name <- if (is.null(config$name)) "N/A" else as.character(config$name)
          arch <- if (is.null(config$architecture)) "N/A" else as.character(config$architecture)
          task <- if (is.null(config$task_type)) "N/A" else as.character(config$task_type)
        } else {
          name <- arch <- task <- "N/A"
        }
        
        return(list(ID = id, Name = name, Status = status, Created = created, Architecture = arch, Task = task))
      })
      
      # Convert to data frame
      jobs_df <- data.frame(
        ID = sapply(job_data, function(x) x$ID),
        Name = sapply(job_data, function(x) x$Name),
        Status = sapply(job_data, function(x) x$Status),
        Created = sapply(job_data, function(x) x$Created),
        Architecture = sapply(job_data, function(x) x$Architecture),
        Task = sapply(job_data, function(x) x$Task),
        stringsAsFactors = FALSE
      )
      return(jobs_df)
    } else {
      return(data.frame(Error = paste("Error fetching jobs:", response$status)))
    }
  }, error = function(e) {
    return(data.frame(Error = paste("Error:", e$message)))
  })
}

list_available_datasets <- function() {
  tryCatch({
    # Debug: Show the API URL being called
    api_endpoint <- paste0(API_URL, "/datasets/available")
    cat("DEBUG: Calling API endpoint:", api_endpoint, "\n")
    
    response <- make_request(api_endpoint)
    cat("DEBUG: API response status:", response$status, "\n")
    cat("DEBUG: API response content:", substr(response$content, 1, 200), "...\n")
    
    if (response$status == 200) {
      # Parse JSON with more robust handling
      datasets <- fromJSON(response$content, simplifyVector = FALSE)
      cat("DEBUG: Parsed datasets class:", class(datasets), "\n")
      cat("DEBUG: Parsed datasets length:", length(datasets), "\n")
      
      # Handle different response structures
      if (is.null(datasets) || length(datasets) == 0) {
        return(data.frame(Message = "No datasets found in the system. Upload a dataset first."))
      }
      
      # Ensure datasets is a list
      if (!is.list(datasets)) {
        cat("DEBUG: Converting datasets to list format\n")
        return(data.frame(Message = paste("Unexpected data format received:", class(datasets))))
      }
      
      # Safely extract dataset information
      dataset_data <- lapply(datasets, function(dataset) {
        if (!is.list(dataset)) {
          return(list(ID = "N/A", Name = "N/A", Classes = 0, Task_Type = "Unknown", Items = 0, Format = "Unknown"))
        }
        
        id <- if (is.null(dataset$id)) "N/A" else as.character(dataset$id)
        name <- if (is.null(dataset$name)) id else as.character(dataset$name)
        classes <- if (is.null(dataset$classes)) 0 else length(dataset$classes)
        task_type <- if (is.null(dataset$task_type)) "Unknown" else as.character(dataset$task_type)
        items <- if (is.null(dataset$item_count)) 0 else as.numeric(dataset$item_count)
        format <- if (is.null(dataset$is_coco_format) || !dataset$is_coco_format) "Standard" else "COCO"
        
        return(list(ID = id, Name = name, Classes = classes, Task_Type = task_type, Items = items, Format = format))
      })
      
      # Convert to data frame
      datasets_df <- data.frame(
        ID = sapply(dataset_data, function(x) x$ID),
        Name = sapply(dataset_data, function(x) x$Name),
        Classes = sapply(dataset_data, function(x) x$Classes),
        Task_Type = sapply(dataset_data, function(x) x$Task_Type),
        Items = sapply(dataset_data, function(x) x$Items),
        Format = sapply(dataset_data, function(x) x$Format),
        stringsAsFactors = FALSE
      )
      return(datasets_df)
    } else {
      return(data.frame(Error = paste("API Error:", response$status, "-", response$content)))
    }
  }, error = function(e) {
    return(data.frame(Error = paste("Connection Error:", e$message, "- Check if API server is running at", API_URL)))
  })
}

create_pipeline <- function(name, task_type, architecture, num_classes, batch_size, epochs, learning_rate, image_size_input, augmentation_enabled, early_stopping) {
  tryCatch({
    # Validate and convert inputs with proper defaults
    num_classes_int <- if(is.null(num_classes) || is.na(num_classes) || num_classes == "") 2 else as.integer(num_classes)
    batch_size_int <- if(is.null(batch_size) || is.na(batch_size) || batch_size == "") 8 else as.integer(batch_size)
    epochs_int <- if(is.null(epochs) || is.na(epochs) || epochs == "") 5 else as.integer(epochs)
    learning_rate_num <- if(is.null(learning_rate) || is.na(learning_rate) || learning_rate == "") 0.001 else as.numeric(learning_rate)
    
    # Parse image size with validation
    image_size_parts <- strsplit(gsub(" ", "", image_size_input), ",")[[1]]
    image_size <- as.numeric(image_size_parts)
    if(any(is.na(image_size)) || length(image_size) != 2) {
      image_size <- c(224, 224)  # Default image size
    }
    
    # Ensure boolean values are properly handled
    augmentation_bool <- if(is.null(augmentation_enabled)) TRUE else as.logical(augmentation_enabled)
    early_stopping_bool <- if(is.null(early_stopping)) TRUE else as.logical(early_stopping)
    
    pipeline_config <- list(
      name = as.character(name %||% "My Pipeline"),
      task_type = as.character(task_type %||% "image_classification"),
      architecture = as.character(architecture %||% "resnet18"),
      batch_size = batch_size_int,
      epochs = epochs_int,
      learning_rate = learning_rate_num,
      early_stopping = early_stopping_bool,
      feature_extraction_only = FALSE,
      patience = 3L,
      num_classes = num_classes_int,
      image_size = image_size,
      augmentation_enabled = augmentation_bool
    )
    
    # Convert to JSON and make request
    json_body <- toJSON(pipeline_config, auto_unbox = TRUE)
    
    # Note: This is a simplified POST - in production use httr for proper JSON posting
    response <- make_request(paste0(API_URL, "/pipelines"), method = "POST", body = json_body)
    
    if (response$status == 200) {
      # Debug: Show raw response content
      raw_content <- response$content
      
      tryCatch({
        job <- fromJSON(raw_content)
        
        # Try different possible field names for the job ID
        job_id <- job$id %||% job$job_id %||% job$pipeline_id %||% "Unknown"
        
        # If still unknown, show the structure for debugging
        if (job_id == "Unknown") {
          return(paste("Pipeline created successfully! Raw response:", raw_content, "\nParsed structure:", paste(names(job), collapse = ", ")))
        }
        
        paste("Pipeline created successfully! Job ID:", job_id)
      }, error = function(parse_error) {
        paste("Pipeline created but couldn't parse response. Raw content:", raw_content, "\nParse error:", parse_error$message)
      })
    } else {
      paste("Error creating pipeline:", response$status, response$content)
    }
  }, error = function(e) {
    paste("Error creating pipeline:", e$message)
  })
}

get_job_status <- function(job_id) {
  if (is.null(job_id) || job_id == "") {
    return("Error: Please provide a Job ID")
  }
  
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines/", job_id))
    if (response$status == 200) {
      job <- fromJSON(response$content)
      config <- job$pipeline_config %||% list()
      
      result <- paste0(
        "Job: ", job_id, "\n",
        "Name: ", config$name %||% "N/A", "\n",
        "Status: ", job$status %||% "N/A", "\n",
        "Task: ", config$task_type %||% "N/A", "\n",
        "Model: ", config$architecture %||% "N/A", "\n",
        "Created: ", job$created_at %||% "N/A", "\n"
      )
      
      if (!is.null(job$started_at)) {
        result <- paste0(result, "Started: ", job$started_at, "\n")
      }
      
      if (!is.null(job$completed_at)) {
        result <- paste0(result, "Completed: ", job$completed_at, "\n")
      }
      
      if (!is.null(job$metrics) && length(job$metrics) > 0) {
        result <- paste0(result, "\nMetrics:\n")
        for (metric in names(job$metrics)) {
          result <- paste0(result, "- ", metric, ": ", job$metrics[[metric]], "\n")
        }
      }
      
      if (!is.null(job$model_path)) {
        result <- paste0(result, "\nModel Path: ", job$model_path)
      }
      
      return(result)
    } else {
      return(paste("Error fetching job:", response$status))
    }
  }, error = function(e) {
    return(paste("Error:", e$message))
  })
}

start_training <- function(job_id) {
  if (is.null(job_id) || job_id == "") {
    return("Error: Please provide a Job ID")
  }
  
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines/", job_id, "/train"), method = "POST")
    if (response$status == 200) {
      paste("Training started for job:", job_id)
    } else {
      paste("Error starting training:", response$status, response$content)
    }
  }, error = function(e) {
    paste("Error:", e$message)
  })
}

delete_job <- function(job_id) {
  if (is.null(job_id) || job_id == "") {
    return("Error: Please provide a Job ID")
  }
  
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines/", job_id), method = "DELETE")
    if (response$status == 200) {
      paste("Job", job_id, "deleted successfully")
    } else {
      paste("Error deleting job:", response$status, response$content)
    }
  }, error = function(e) {
    paste("Error:", e$message)
  })
}

get_jobs_for_dropdown <- function(status_filter = NULL) {
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines"))
    if (response$status == 200) {
      jobs <- fromJSON(response$content, simplifyVector = FALSE)
      
      # Handle different response structures
      if (is.list(jobs) && !is.null(names(jobs))) {
        # Single job returned as named list
        jobs <- list(jobs)
      } else if (!is.list(jobs)) {
        # Invalid response
        return(list())
      }
      
      if (length(jobs) == 0) {
        return(list())
      }
      
      choices <- list()
      for (i in seq_along(jobs)) {
        job <- jobs[[i]]
        
        # Skip if not a proper job object
        if (!is.list(job)) {
          next
        }
        
        job_status <- if (is.null(job$status)) "N/A" else as.character(job$status)
        
        # Apply status filter if provided
        if (!is.null(status_filter)) {
          if (status_filter == "pending" && !job_status %in% c("pending", "created", "ready", "initialized")) {
            next
          } else if (status_filter == "trainable" && job_status %in% c("completed", "training", "failed")) {
            next
          } else if (status_filter == "completed" && job_status != "completed") {
            next
          }
        }
        
        job_id <- if (is.null(job$id)) "N/A" else as.character(job$id)
        
        # Safely extract pipeline config
        config <- job$pipeline_config
        if (is.list(config)) {
          name <- if (is.null(config$name)) "N/A" else as.character(config$name)
          task <- if (is.null(config$task_type)) "N/A" else as.character(config$task_type)
          arch <- if (is.null(config$architecture)) "N/A" else as.character(config$architecture)
        } else {
          name <- task <- arch <- "N/A"
        }
        
        # Create display text
        display_text <- paste0(name, " - ", job_id, " (", task, ", ", arch, ", ", job_status, ")")
        choices[[display_text]] <- job_id
      }
      
      return(choices)
    } else {
      return(list())
    }
  }, error = function(e) {
    return(list())
  })
}

get_datasets_for_dropdown <- function() {
  tryCatch({
    response <- make_request(paste0(API_URL, "/datasets/available"))
    cat("DEBUG: Dropdown API response status:", response$status, "\n")
    
    if (response$status == 200) {
      # Parse JSON with more robust handling
      datasets <- fromJSON(response$content, simplifyVector = FALSE)
      cat("DEBUG: Dropdown datasets class:", class(datasets), "\n")
      cat("DEBUG: Dropdown datasets length:", length(datasets), "\n")
      
      if (is.null(datasets) || length(datasets) == 0) {
        cat("DEBUG: No datasets found for dropdown\n")
        return(list("No datasets available - Upload a dataset first" = ""))
      }
      
      # Ensure datasets is a list
      if (!is.list(datasets)) {
        cat("DEBUG: Unexpected dropdown data format:", class(datasets), "\n")
        return(list("Data format error - Check API response" = ""))
      }
      
      choices <- list()
      for (i in seq_along(datasets)) {
        dataset <- datasets[[i]]
        
        # Skip if not a proper dataset object
        if (!is.list(dataset)) {
          cat("DEBUG: Skipping non-list dataset at index", i, "\n")
          next
        }
        
        dataset_id <- if (is.null(dataset$id)) "N/A" else as.character(dataset$id)
        name <- if (is.null(dataset$name)) dataset_id else as.character(dataset$name)
        task <- if (is.null(dataset$task_type)) "Unknown" else as.character(dataset$task_type)
        format <- if (is.null(dataset$is_coco_format) || !dataset$is_coco_format) "Standard" else "COCO"
        
        display_text <- paste0(name, " - ", dataset_id, " (", task, ", ", format, ")")
        choices[[display_text]] <- dataset_id
        cat("DEBUG: Added dataset to dropdown:", display_text, "\n")
      }
      
      if (length(choices) == 0) {
        return(list("No valid datasets found" = ""))
      }
      
      return(choices)
    } else {
      cat("DEBUG: API error for dropdown:", response$status, response$content, "\n")
      return(list("API Error - Check server connection" = ""))
    }
  }, error = function(e) {
    cat("DEBUG: Exception in dropdown function:", e$message, "\n")
    return(list("Connection Error - Check API server" = ""))
  })
}

link_dataset_to_job <- function(job_id, dataset_id) {
  if (is.null(job_id) || job_id == "" || is.null(dataset_id) || dataset_id == "") {
    return("Error: Please provide both Job ID and Dataset ID")
  }
  
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines/", job_id, "/dataset/", dataset_id), method = "POST")
    if (response$status == 200) {
      paste("Successfully linked dataset", dataset_id, "to job", job_id)
    } else {
      paste("Error linking dataset:", response$status, response$content)
    }
  }, error = function(e) {
    paste("Error:", e$message)
  })
}

check_class_balance <- function(dataset_id) {
  tryCatch({
    response <- make_request(paste0(API_URL, "/responsible-ai/class-balance"), method = "POST", body = toJSON(list(dataset_id = dataset_id), auto_unbox = TRUE))
    if (response$status == 200) {
      return(response$content)
    } else {
      return(paste("Error:", response$status, response$content))
    }
  }, error = function(e) {
    return(paste("Error:", e$message))
  })
}

check_fairness <- function(job_id, dataset_id, sensitive_attributes) {
  tryCatch({
    response <- make_request(paste0(API_URL, "/responsible-ai/fairness-analysis"), method = "POST", body = toJSON(list(job_id = job_id, dataset_id = dataset_id, sensitive_attributes = sensitive_attributes), auto_unbox = TRUE))
    if (response$status == 200) {
      return(response$content)
    } else {
      return(paste("Error:", response$status, response$content))
    }
  }, error = function(e) {
    return(paste("Error:", e$message))
  })
}

generate_model_card <- function(job_id) {
  tryCatch({
    response <- make_request(paste0(API_URL, "/responsible-ai/generate-model-card"), method = "POST", body = toJSON(list(job_id = job_id), auto_unbox = TRUE))
    if (response$status == 200) {
      return(response$content)
    } else {
      return(paste("Error:", response$status, response$content))
    }
  }, error = function(e) {
    return(paste("Error:", e$message))
  })
}

# UI
ui <- dashboardPage(
  dashboardHeader(title = "No-Code AI Platform"),
  
  dashboardSidebar(
    sidebarMenu(
      menuItem("Dashboard", tabName = "dashboard", icon = icon("dashboard")),
      menuItem("Create Pipeline", tabName = "create", icon = icon("plus-circle")),
      menuItem("Train Model", tabName = "train", icon = icon("cog")),
      menuItem("Make Predictions", tabName = "predict", icon = icon("eye")),
      menuItem("View Jobs", tabName = "jobs", icon = icon("list")),
      menuItem("View Datasets", tabName = "datasets", icon = icon("database")),
      menuItem("Delete Job", tabName = "delete", icon = icon("trash")),
      menuItem("Responsible AI", tabName = "responsible_ai", icon = icon("balance-scale"))
    )
  ),
  
  dashboardBody(
    tags$head(
      tags$style(HTML("
        .content-wrapper, .right-side {
          background-color: #f4f4f4;
        }
        .box {
          border-radius: 5px;
        }
        .btn {
          border-radius: 3px;
        }
        .warning-box {
          background-color: #fcf8e3;
          border: 1px solid #faebcc;
          color: #8a6d3b;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }
        .success-box {
          background-color: #dff0d8;
          border: 1px solid #d6e9c6;
          color: #3c763d;
          padding: 15px;
          border-radius: 4px;
          margin-bottom: 20px;
        }
      "))
    ),
    
    tabItems(
      # Dashboard Tab
      tabItem(tabName = "dashboard",
        fluidRow(
          box(
            title = "API Status", status = "primary", solidHeader = TRUE, width = 6,
            actionButton("check_status", "Check API Status", class = "btn-primary"),
            br(), br(),
            verbatimTextOutput("api_status")
          ),
          box(
            title = "MLflow Server", status = "info", solidHeader = TRUE, width = 6,
            actionButton("start_mlflow", "Start MLflow Server", class = "btn-info"),
            br(), br(),
            verbatimTextOutput("mlflow_output")
          )
        ),
        fluidRow(
          box(
            title = "All Jobs Overview", status = "success", solidHeader = TRUE, width = 12,
            actionButton("refresh_dashboard_jobs", "Refresh Jobs List", class = "btn-success"),
            br(), br(),
            DT::dataTableOutput("dashboard_jobs_table")
          )
        ),
        fluidRow(
          box(
            title = "Quick Info", status = "warning", solidHeader = TRUE, width = 12,
            h4("Welcome to the No-Code AI Platform"),
            p("This R Shiny interface provides full functionality for the FastAPI backend."),
            p("Available features:"),
            tags$ul(
              tags$li("Dashboard: Check API status and view all jobs"),
              tags$li("Create Pipeline: Set up new ML training pipelines"),
              tags$li("Train Model: Upload datasets and start training"),
              tags$li("Make Predictions: Use trained models for inference"),
              tags$li("View Jobs: Monitor all training jobs"),
              tags$li("View Datasets: Browse available datasets"),
              tags$li("Delete Job: Remove unwanted jobs")
            ),
            div(class = "success-box",
                strong("Ready: "), 
                "Full functionality available with proper HTTP requests using the 'httr' package. ",
                "All features including file uploads, training, and predictions are supported."
            )
          )
        )
      ),
      
      # Create Pipeline Tab
      tabItem(tabName = "create",
        fluidRow(
          box(
            title = "Create New Pipeline", status = "primary", solidHeader = TRUE, width = 12,
            fluidRow(
              column(6,
                textInput("pipeline_name", "Pipeline Name", value = "My Image Classifier"),
                selectInput("task_type", "Task Type", 
                           choices = list("Image Classification" = "image_classification",
                                        "Object Detection" = "object_detection"),
                           selected = "image_classification"),
                selectInput("architecture", "Model Architecture",
                           choices = list("ResNet-18" = "resnet18",
                                        "ResNet-50" = "resnet50",
                                        "VGG-16" = "vgg16",
                                        "MobileNet" = "mobilenet",
                                        "EfficientNet" = "efficientnet"),
                           selected = "resnet18"),
                numericInput("num_classes", "Number of Classes", value = 2, min = 2, max = 1000)
              ),
              column(6,
                numericInput("batch_size", "Batch Size", value = 8, min = 1, max = 128),
                numericInput("epochs", "Epochs", value = 5, min = 1, max = 1000),
                numericInput("learning_rate", "Learning Rate", value = 0.001, min = 0.0001, max = 1, step = 0.0001),
                textInput("image_size", "Image Size (width, height)", value = "224, 224")
              )
            ),
            fluidRow(
              column(6,
                checkboxInput("augmentation", "Enable Data Augmentation", value = TRUE)
              ),
              column(6,
                checkboxInput("early_stopping", "Enable Early Stopping", value = TRUE)
              )
            ),
            br(),
            actionButton("create_pipeline", "Create Pipeline", class = "btn-primary btn-lg"),
            br(), br(),
            verbatimTextOutput("create_output")
          )
        )
      ),
      
      # Train Model Tab
      tabItem(tabName = "train",
        fluidRow(
          box(
            title = "Current Job Status", status = "info", solidHeader = TRUE, width = 12,
            p("Shows the most recently created job ready for training"),
            actionButton("refresh_current_job", "Refresh Current Job", class = "btn-info"),
            br(), br(),
            verbatimTextOutput("current_job_status")
          )
        ),
        fluidRow(
          box(
            title = "Upload Dataset to Job", status = "success", solidHeader = TRUE, width = 12,
            div(class = "success-box",
                strong("File Upload Ready: "),
                "Upload dataset files directly to a specific job. Maximum file size: 500MB. ",
                "Select a job first, then upload your dataset ZIP file."
            ),
            fluidRow(
              column(6,
                h4("Job Selection"),
                selectInput("upload_job_dropdown", "Select Job for Dataset Upload", choices = list()),
                actionButton("refresh_upload_jobs", "Refresh Jobs", class = "btn-info"),
                br(), br(),
                textInput("dataset_name", "Dataset Name (Important for Data Cards)", placeholder="e.g., Medical Scans v1"),
                selectInput("dataset_task_type", "Dataset Task Type", 
                           choices = list(
                             "Image Classification" = "image_classification",
                             "Object Detection (COCO format)" = "object_detection",
                             "Instance Segmentation (COCO format)" = "instance_segmentation",
                             "Semantic Segmentation" = "semantic_segmentation"
                           ))
              ),
              column(6,
                h4("File Upload"),
                fileInput("dataset_file", "Choose Dataset ZIP File",
                         accept = c(".zip"),
                         multiple = FALSE),
                p("Supported formats (Max 500MB):"),
                tags$ul(
                  tags$li("ZIP files with image folders"),
                  tags$li("For Classification: folders with class subfolders"),
                  tags$li("For Object/Instance: COCO format structure")
                )
              )
            ),
            br(),
            actionButton("upload_dataset", "Upload Dataset to Job", class = "btn-success btn-lg"),
            br(), br(),
            verbatimTextOutput("upload_dataset_output")
          )
        ),
        fluidRow(
          box(
            title = "Link Dataset to Job", status = "primary", solidHeader = TRUE, width = 12,
            p("Connect a pending job to a dataset (either newly uploaded or existing)"),
            fluidRow(
              column(6,
                selectInput("pending_job_dropdown", "Select Pending Job", choices = list()),
                actionButton("refresh_pending_jobs", "Refresh Pending Jobs", class = "btn-info")
              ),
              column(6,
                selectInput("dataset_dropdown", "Select Dataset", choices = list()),
                actionButton("refresh_datasets_dropdown", "Refresh Datasets", class = "btn-success")
              )
            ),
            actionButton("link_dataset", "Link Dataset to Job", class = "btn-primary"),
            br(), br(),
            verbatimTextOutput("link_output")
          )
        ),
        fluidRow(
          box(
            title = "Start Training", status = "warning", solidHeader = TRUE, width = 12,
            p("Start training jobs that have datasets linked"),
            selectInput("trainable_job_dropdown", "Select Job Ready for Training", choices = list()),
            actionButton("refresh_trainable_jobs", "Refresh Trainable Jobs", class = "btn-info"),
            br(), br(),
            actionButton("start_training_btn", "Start Training", class = "btn-warning btn-lg"),
            br(), br(),
            verbatimTextOutput("training_output")
          )
        )
      ),
      
      # Make Predictions Tab
      tabItem(tabName = "predict",
        fluidRow(
          box(
            title = "Model Selection", status = "primary", solidHeader = TRUE, width = 12,
            selectInput("predict_job_dropdown", "Select Trained Model", choices = list()),
            actionButton("refresh_prediction_models", "Refresh Available Models", class = "btn-info"),
            br(), br(),
            verbatimTextOutput("prediction_models_status")
          )
        ),
        fluidRow(
          box(
            title = "Image Upload & Prediction", status = "success", solidHeader = TRUE, width = 12,
            fluidRow(
              column(6,
                h4("Upload Image"),
                fileInput("prediction_image", "Choose Image File",
                         accept = c(".jpg", ".jpeg", ".png", ".bmp", ".tiff"),
                         multiple = FALSE),
                p("Supported formats: JPG, PNG, BMP, TIFF")
              ),
              column(6,
                h4("Prediction Settings"),
                sliderInput("confidence_threshold", 
                           "Confidence Threshold", 
                           value = 0.5, min = 0.1, max = 0.95, step = 0.05,
                           post = "%"),
                p(class = "help-text", style = "font-size: 12px; color: #666;",
                  "Higher values show fewer, more confident detections. Lower values show more detections but may include false positives."),
                checkboxInput("show_probabilities", "Show All Class Probabilities", value = TRUE)
              )
            ),
            br(),
            actionButton("make_prediction", "Make Prediction", class = "btn-primary btn-lg"),
            br(), br(),
            fluidRow(
              column(6,
                h4("Prediction Results"),
                verbatimTextOutput("prediction_output")
              ),
              column(6,
                h4("Uploaded Image"),
                imageOutput("prediction_image_display", height = "400px"),
                br(),
                textOutput("image_info")
              )
            )
          )
        )
      ),
      
      # Jobs Tab
      tabItem(tabName = "jobs",
        fluidRow(
          box(
            title = "All Jobs", status = "info", solidHeader = TRUE, width = 12,
            actionButton("refresh_jobs", "Refresh Jobs List", class = "btn-info"),
            br(), br(),
            DT::dataTableOutput("jobs_table")
          )
        ),
        fluidRow(
          box(
            title = "Job Details", status = "success", solidHeader = TRUE, width = 12,
            textInput("job_status_id", "Job ID", placeholder = "Enter Job ID to view details"),
            actionButton("get_job_details", "Get Job Status", class = "btn-success"),
            br(), br(),
            verbatimTextOutput("job_details_output")
          )
        )
      ),
      
      # Datasets Tab
      tabItem(tabName = "datasets",
        fluidRow(
          box(
            title = "Available Datasets", status = "success", solidHeader = TRUE, width = 12,
            actionButton("refresh_datasets", "Refresh Datasets", class = "btn-success"),
            p(style = "margin-top: 8px; color: #888;", "Click a row to view its Data Card & validation report."),
            br(),
            DT::dataTableOutput("datasets_table")
          )
        ),
        fluidRow(
          box(
            title = uiOutput("datacard_box_title"), status = "info", solidHeader = TRUE, width = 12,
            id = "datacard_box",
            conditionalPanel(
              condition = "output.datacard_visible == true",
              tabsetPanel(id = "datacard_tabs",
                tabPanel("Data Card",
                  div(style = "padding: 15px;",
                    uiOutput("datacard_markdown")
                  )
                ),
                tabPanel("Class Distribution",
                  div(style = "padding: 15px; text-align: center;",
                    uiOutput("datacard_distribution_plot_ui")
                  )
                ),
                tabPanel("Sample Images",
                  div(style = "padding: 15px;",
                    uiOutput("datacard_sample_images")
                  )
                )
              )
            ),
            conditionalPanel(
              condition = "output.datacard_visible != true",
              div(style = "padding: 20px; text-align: center; color: #999;",
                tags$i(class = "fa fa-mouse-pointer", style = "font-size: 24px;"),
                br(), br(),
                p("Click on a dataset row above to generate its Data Card and validation report.")
              )
            )
          )
        )
      ),
      
      # Delete Job Tab
      tabItem(tabName = "delete",
        fluidRow(
          box(
            title = "Delete Job", status = "danger", solidHeader = TRUE, width = 12,
            div(class = "warning-box",
                strong("Warning: "),
                "Deleting a job will permanently remove all associated data including trained models, datasets, and logs. This action cannot be undone."
            ),
            selectInput("delete_job_dropdown", "Select Job to Delete", choices = list()),
            actionButton("refresh_delete_jobs", "Refresh Jobs List", class = "btn-info"),
            br(), br(),
            actionButton("delete_job_btn", "Delete Selected Job", class = "btn-danger btn-lg"),
            br(), br(),
            verbatimTextOutput("delete_output")
          )
        )
      ),
      
      # Responsible AI Tab
      tabItem(tabName = "responsible_ai",
        fluidRow(
          box(
            title = "Class Balance Analysis", status = "primary", solidHeader = TRUE, width = 12,
            textInput("rai_dataset_id", "Dataset ID", placeholder = "Enter Dataset ID"),
            actionButton("check_class_balance_btn", "Analyze Class Balance", class = "btn-primary"),
            br(), br(),
            verbatimTextOutput("class_balance_output")
          )
        ),
        fluidRow(
          box(
            title = "Fairness Analysis", status = "warning", solidHeader = TRUE, width = 12,
            textInput("rai_fairness_job_id", "Job ID", placeholder = "Enter trained Job ID"),
            textInput("rai_fairness_dataset_id", "Dataset ID", placeholder = "Enter evaluation Dataset ID"),
            textInput("rai_sensitive_attrs", "Sensitive Attributes (comma separated)", placeholder = "e.g., gender, race"),
            actionButton("check_fairness_btn", "Analyze Fairness", class = "btn-warning"),
            br(), br(),
            verbatimTextOutput("fairness_output")
          )
        ),
        fluidRow(
          box(
            title = "Generate Model Card", status = "success", solidHeader = TRUE, width = 12,
            textInput("rai_mc_job_id", "Job ID", placeholder = "Enter trained Job ID"),
            actionButton("generate_mc_btn", "Generate Model Card", class = "btn-success"),
            br(), br(),
            verbatimTextOutput("model_card_output")
          )
        )
      )
    )
  )
)

# Server
server <- function(input, output, session) {
  
  # Dashboard Tab Functions
  observeEvent(input$check_status, {
    output$api_status <- renderText({
      get_api_status()
    })
  })
  
  observeEvent(input$start_mlflow, {
    output$mlflow_output <- renderText({
      start_mlflow()
    })
  })
  
  observeEvent(input$refresh_dashboard_jobs, {
    output$dashboard_jobs_table <- DT::renderDataTable({
      list_all_jobs()
    }, options = list(scrollX = TRUE))
  })
  
  # Create Pipeline Tab Functions
  observeEvent(input$create_pipeline, {
    output$create_output <- renderText({
      create_pipeline(
        input$pipeline_name,
        input$task_type,
        input$architecture,
        input$num_classes,
        input$batch_size,
        input$epochs,
        input$learning_rate,
        input$image_size,
        input$augmentation,
        input$early_stopping
      )
    })
  })
  
  # Update architecture choices based on task type
  observe({
    if (input$task_type == "image_classification") {
      updateSelectInput(session, "architecture",
                       choices = list("ResNet-18" = "resnet18",
                                    "ResNet-50" = "resnet50",
                                    "VGG-16" = "vgg16",
                                    "MobileNet" = "mobilenet",
                                    "EfficientNet" = "efficientnet"),
                       selected = "resnet18")
    } else if (input$task_type == "object_detection") {
      updateSelectInput(session, "architecture",
                       choices = list("Faster R-CNN" = "faster_rcnn"),
                       selected = "faster_rcnn")
    }
  })
  
  # Train Model Tab Functions
  observeEvent(input$refresh_current_job, {
    output$current_job_status <- renderText({
      # Get most recent job ready for training
      jobs <- tryCatch({
        response <- make_request(paste0(API_URL, "/pipelines"))
        if (response$status == 200) {
          jobs_data <- fromJSON(response$content, simplifyVector = FALSE)
          # Ensure we have a list of jobs
          if (is.list(jobs_data) && !is.null(names(jobs_data))) {
            # If it's a named list (single job), convert to list of jobs
            list(jobs_data)
          } else if (is.list(jobs_data)) {
            # It's already a list of jobs
            jobs_data
          } else {
            list()
          }
        } else {
          list()
        }
      }, error = function(e) {
        return(paste("Error fetching jobs:", e$message))
      })
      
      if (is.character(jobs)) {
        return(jobs)  # Return error message
      }
      
      if (length(jobs) == 0) {
        return("No jobs found. Create a pipeline first.")
      }
      
      # Find most recent job ready for training
      for (i in seq_along(jobs)) {
        job <- jobs[[i]]
        
        # Safely extract values with proper checks
        if (!is.list(job)) {
          next  # Skip if not a proper job object
        }
        
        status <- if (is.null(job$status)) "" else as.character(job$status)
        
        if (status %in% c("pending", "created", "ready", "initialized")) {
          job_id <- if (is.null(job$id)) "N/A" else as.character(job$id)
          
          # Safely extract pipeline config
          pipeline_config <- job$pipeline_config
          if (is.list(pipeline_config)) {
            name <- if (is.null(pipeline_config$name)) "N/A" else as.character(pipeline_config$name)
            task <- if (is.null(pipeline_config$task_type)) "N/A" else as.character(pipeline_config$task_type)
            arch <- if (is.null(pipeline_config$architecture)) "N/A" else as.character(pipeline_config$architecture)
          } else {
            name <- task <- arch <- "N/A"
          }
          
          return(paste0(
            "Current Job: ", name, "\n",
            "ID: ", job_id, "\n",
            "Status: Ready for training\n",
            "Task: ", task, "\n",
            "Architecture: ", arch, "\n",
            "\nThis job is ready for dataset upload and training."
          ))
        }
      }
      
      return("No new jobs found ready for training. Most recent jobs may already be trained. Please create a new pipeline to start fresh training.")
    })
  })
  
  observeEvent(input$refresh_pending_jobs, {
    choices <- get_jobs_for_dropdown("pending")
    updateSelectInput(session, "pending_job_dropdown", choices = choices)
  })
  
  # Reactive to store the current datasets dataframe (must be declared before observers)
  datasets_df_store <- reactiveVal(NULL)
  
  # ---- Data Card: initialize visibility as FALSE ----
  output$datacard_visible <- reactive({ FALSE })
  outputOptions(output, "datacard_visible", suspendWhenHidden = FALSE)
  
  output$datacard_box_title <- renderUI({ "Data Card & Validation Report" })
  
  observeEvent(input$refresh_datasets_dropdown, {
    # Update both the datasets table and the dropdown (similar to Gradio implementation)
    output$datasets_table <- DT::renderDataTable({
      df <- list_available_datasets()
      datasets_df_store(df)
      df
    }, selection = 'single', options = list(scrollX = TRUE))
    
    choices <- get_datasets_for_dropdown()
    updateSelectInput(session, "dataset_dropdown", choices = choices)
  })
  
  # ---- Data Card: triggered by clicking a row in the datasets table ----
  observeEvent(input$datasets_table_rows_selected, {
    row_idx <- input$datasets_table_rows_selected
    if (is.null(row_idx) || length(row_idx) == 0) return()
    
    # Get the current datasets dataframe
    df <- datasets_df_store()
    if (is.null(df) || nrow(df) == 0) return()
    if (row_idx > nrow(df)) return()
    
    dataset_id <- df$ID[row_idx]
    dataset_name <- df$Name[row_idx]
    
    output$datacard_box_title <- renderUI({
      paste0("Data Card: ", dataset_name)
    })
    
    showNotification(
      paste0("Generating Data Card for '", dataset_name, "'..."),
      type = "message", duration = 5
    )
    
    tryCatch({
      url <- paste0(API_URL, "/responsible-ai/dataset-validation/", dataset_id)
      response <- POST(url)
      
      if (status_code(response) == 200) {
        result <- content(response, "parsed")
        
        output$datacard_visible <- reactive({ TRUE })
        outputOptions(output, "datacard_visible", suspendWhenHidden = FALSE)
        
        # Render Markdown using commonmark (ships with R, no extra package needed)
        output$datacard_markdown <- renderUI({
          md_text <- result$data_card_markdown
          if (is.null(md_text) || md_text == "") {
            return(tags$p("No data card content returned."))
          }
          html_text <- tryCatch({
            commonmark::markdown_html(md_text)
          }, error = function(e) {
            paste0("<pre>", md_text, "</pre>")
          })
          HTML(html_text)
        })
        
        # Render Distribution Plot as base64 img tag (no temp files needed)
        output$datacard_distribution_plot_ui <- renderUI({
          if (!is.null(result$distribution_plot_base64) && result$distribution_plot_base64 != "") {
            tags$img(
              src = paste0("data:image/png;base64,", result$distribution_plot_base64),
              style = "max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px;"
            )
          } else {
            tags$p("No distribution plot available.", style = "color: #999;")
          }
        })
        
        # Render Sample Images
        output$datacard_sample_images <- renderUI({
          imgs <- result$sample_images
          if (is.null(imgs) || length(imgs) == 0) {
            return(tags$p("No sample images available.", style = "color: #999;"))
          }
          
          img_tags <- lapply(imgs, function(img) {
            tags$div(
              class = "col-md-4",
              style = "margin-bottom: 20px;",
              tags$div(
                style = "border: 1px solid #ddd; border-radius: 6px; padding: 8px; text-align: center; background: #fafafa;",
                tags$img(
                  src = paste0("data:image/jpeg;base64,", img$image_base64),
                  style = "max-width: 100%; height: auto; border-radius: 4px;"
                ),
                tags$h4(img$class_name, style = "margin-top: 8px; color: #333;")
              )
            )
          })
          
          tags$div(class = "row", img_tags)
        })
        
        showNotification("Data Card generated successfully!", type = "message")
      } else {
        err <- content(response, "parsed")
        detail <- if (!is.null(err$detail)) err$detail else "Unknown error"
        showNotification(paste("Error:", detail), type = "error")
      }
    }, error = function(e) {
      showNotification(paste("Connection error:", e$message), type = "error")
    })
  })
  
  observeEvent(input$refresh_trainable_jobs, {
    choices <- get_jobs_for_dropdown("trainable")
    updateSelectInput(session, "trainable_job_dropdown", choices = choices)
  })
  
  observeEvent(input$link_dataset, {
    output$link_output <- renderText({
      link_dataset_to_job(input$pending_job_dropdown, input$dataset_dropdown)
    })
  })
  
  observeEvent(input$start_training_btn, {
    output$training_output <- renderText({
      start_training(input$trainable_job_dropdown)
    })
  })
  
  # Refresh upload jobs dropdown
  observeEvent(input$refresh_upload_jobs, {
    choices <- get_jobs_for_dropdown("pending")
    updateSelectInput(session, "upload_job_dropdown", choices = choices)
  })
  
  # Dataset Upload Function
  observeEvent(input$upload_dataset, {
    output$upload_dataset_output <- renderText({
      if (is.null(input$upload_job_dropdown) || input$upload_job_dropdown == "") {
        return("Please select a job first.")
      }
      
      if (is.null(input$dataset_file)) {
        return("Please select a dataset file to upload.")
      }
      
      file_path <- input$dataset_file$datapath
      file_name <- input$dataset_file$name
      file_size <- file.info(file_path)$size
      
      if (!file.exists(file_path)) {
        return("Error: Selected file does not exist.")
      }
      
      # Show file size info
      file_size_mb <- round(file_size / (1024^2), 2)
      if (file_size_mb > 500) {
        return(paste("Error: File size (", file_size_mb, "MB) exceeds maximum limit of 500MB. Please compress your dataset or split it into smaller files."))
      }
      
      # Show upload progress message
      paste0("Uploading ", file_name, " (", file_size_mb, "MB) to job ", input$upload_job_dropdown, "...\nThis may take several minutes for large files.\n\n")
      
      tryCatch({
        task_type <- input$dataset_task_type
        # Add dataset_name to URL
        dataset_name_param <- if(!is.null(input$dataset_name) && input$dataset_name != "") {
          paste0("&dataset_name=", URLencode(input$dataset_name))
        } else {
          ""
        }
        
        # Choose the correct endpoint based on dataset type
        if (task_type %in% c("object_detection", "instance_segmentation")) {
          # COCO format dataset
          upload_url <- paste0(API_URL, "/upload-detection-dataset/", input$upload_job_dropdown, "?task_type=", task_type, dataset_name_param)
        } else {
          # Regular classification or semantic segmentation
          upload_url <- paste0(API_URL, "/upload-dataset/", input$upload_job_dropdown, "?task_type=", task_type, dataset_name_param)
        }
        
        # Create multipart form data with timeout for large files
        if (task_type %in% c("object_detection", "instance_segmentation")) {
          # For COCO format, use the detection endpoint (no additional parameters needed)
          response <- POST(
            upload_url,
            body = list(
              file = upload_file(file_path, type = "application/zip")
            ),
            encode = "multipart",
            timeout(300)  # 5 minute timeout for large uploads
          )
        } else {
          # For classification datasets, specify file_type = "zip"
          response <- POST(
            upload_url,
            body = list(
              file = upload_file(file_path, type = "application/zip"),
              file_type = "zip"
            ),
            encode = "multipart",
            timeout(300)  # 5 minute timeout for large uploads
          )
        }
        
        if (status_code(response) == 200) {
          result <- content(response, "parsed")
          message <- result$message %||% "Upload completed"
          
          # After successful upload, we need to link the dataset to the job
          # The dataset ID is the same as the job ID when uploaded directly
          job_id <- input$upload_job_dropdown
          dataset_id <- job_id  # When uploading directly, dataset_id = job_id
          
          # Link the dataset to the job
          link_response <- tryCatch({
            link_url <- paste0(API_URL, "/pipelines/", job_id, "/dataset/", dataset_id)
            POST(link_url)
          }, error = function(e) {
            list(status_code = 500, content = paste("Link error:", e$message))
          })
          
          if (is.list(link_response) && link_response$status_code == 500) {
            # Handle link error
            paste0(
              "⚠️ Dataset uploaded but linking failed!\n",
              "Job ID: ", job_id, "\n",
              "File: ", file_name, " (", file_size_mb, "MB)\n",
              "Upload Message: ", message, "\n",
              "Link Error: ", link_response$content, "\n",
              "\n🔗 Please try linking manually in the 'Link Dataset to Job' section below."
            )
          } else if (status_code(link_response) == 200) {
            # Success - both upload and link worked
            paste0(
              "✅ Dataset uploaded and linked successfully!\n",
              "Job ID: ", job_id, "\n",
              "File: ", file_name, " (", file_size_mb, "MB)\n",
              "Format: ", task_type, "\n",
              "Upload Message: ", message, "\n",
              "\n🚀 Your dataset is now ready for training! Go to the 'Start Training' section below."
            )
          } else {
            # Link failed
            link_error <- content(link_response, "text")
            paste0(
              "⚠️ Dataset uploaded but linking failed!\n",
              "Job ID: ", job_id, "\n",
              "File: ", file_name, " (", file_size_mb, "MB)\n",
              "Upload Message: ", message, "\n",
              "Link Error: ", status_code(link_response), " - ", link_error, "\n",
              "\n🔗 Please try linking manually in the 'Link Dataset to Job' section below."
            )
          }
        } else {
          error_content <- content(response, "text")
          paste("❌ Upload failed:", status_code(response), "-", error_content)
        }
      }, error = function(e) {
        if (grepl("timeout", e$message, ignore.case = TRUE)) {
          paste("⏱️ Upload timeout: The file is too large or the connection is slow. Try with a smaller file or check your internet connection.")
        } else {
          paste("❌ Upload error:", e$message)
        }
      })
    })
  })
  
  # Make Predictions Tab Functions
  observeEvent(input$refresh_prediction_models, {
    choices <- get_jobs_for_dropdown("completed")
    updateSelectInput(session, "predict_job_dropdown", choices = choices)
    
    output$prediction_models_status <- renderText({
      if (length(choices) == 0) {
        "No trained models available. Please complete training for at least one job first."
      } else {
        paste("Found", length(choices), "trained models available for prediction.")
      }
    })
  })
  
  # Display uploaded image when file is selected
  observeEvent(input$prediction_image, {
    if (!is.null(input$prediction_image)) {
      file_path <- input$prediction_image$datapath
      file_name <- input$prediction_image$name
      file_size <- file.info(file_path)$size
      
      if (file.exists(file_path)) {
        # Display the image
        output$prediction_image_display <- renderImage({
          list(src = file_path,
               contentType = 'image/jpeg',
               width = "100%",
               height = "400px",
               alt = "Uploaded image for prediction")
        }, deleteFile = FALSE)
        
        # Display image information
        output$image_info <- renderText({
          paste0("File: ", file_name, "\n",
                "Size: ", round(file_size / 1024, 2), " KB")
        })
      }
    }
  })
  
  # Image Prediction Function
  observeEvent(input$make_prediction, {
    output$prediction_output <- renderText({
      if (is.null(input$predict_job_dropdown) || input$predict_job_dropdown == "") {
        return("Please select a trained model first.")
      }
      
      if (is.null(input$prediction_image)) {
        return("Please select an image file to predict.")
      }
      
      file_path <- input$prediction_image$datapath
      file_name <- input$prediction_image$name
      
      if (!file.exists(file_path)) {
        return("Error: Selected image file does not exist.")
      }
      
      tryCatch({
        # Prepare the prediction request
        predict_url <- paste0(API_URL, "/predict/", input$predict_job_dropdown)
        
        # Debug: Show confidence threshold being sent
        cat("DEBUG: Sending confidence threshold:", input$confidence_threshold, "\n")
        cat("DEBUG: Confidence threshold type:", class(input$confidence_threshold), "\n")
        cat("DEBUG: Prediction URL:", predict_url, "\n")
        
        # Try sending confidence threshold as URL parameter instead of form data
        predict_url_with_params <- paste0(predict_url, "?confidence_threshold=", input$confidence_threshold)
        cat("DEBUG: URL with confidence parameter:", predict_url_with_params, "\n")
        
        # Upload image for prediction (try both methods)
        response <- POST(
          predict_url_with_params,
          body = list(
            file = upload_file(file_path, type = "image/jpeg"),
            confidence_threshold = as.numeric(input$confidence_threshold)
          ),
          encode = "multipart"
        )
        
        cat("DEBUG: Response status code:", status_code(response), "\n")
        
        if (status_code(response) == 200) {
          result <- content(response, "parsed")
          
          # Debug: Print the raw response structure
          cat("DEBUG: Prediction response structure:\n")
          cat("DEBUG: Result names:", names(result), "\n")
          if (!is.null(result$predictions)) {
            cat("DEBUG: First prediction structure:", names(result$predictions[[1]]), "\n")
          }
          
          # Format prediction results
          output_text <- paste0(
            "Prediction Results for: ", file_name, "\n",
            "Model: ", input$predict_job_dropdown, "\n",
            "Confidence Threshold: ", input$confidence_threshold, "\n\n"
          )
          
          # Determine task type and handle accordingly
          task_type <- result$task_type %||% "unknown"
          processing_time <- result$processing_time %||% 0
          
          cat("DEBUG: Task type:", task_type, "\n")
          cat("DEBUG: Processing time:", processing_time, "\n")
          
          if (grepl("image_classification", task_type, ignore.case = TRUE)) {
            # Handle Image Classification
            cat("DEBUG: Handling image classification\n")
            
            if (!is.null(result$predictions)) {
              predictions <- result$predictions
              if (is.list(predictions) && length(predictions) > 0) {
                output_text <- paste0(output_text, "Classification Results:\n")
                output_text <- paste0(output_text, sprintf("Processing Time: %.3fs\n\n", processing_time))
                
                for (i in seq_along(predictions)) {
                  pred <- predictions[[i]]
                  
                  # Try different possible field names for class
                  class_name <- pred$class_name %||% pred$class %||% pred$label %||% "Unknown"
                  
                  # Try different possible field names for confidence
                  confidence <- pred$confidence %||% pred$score %||% pred$probability %||% 0
                  
                  # Debug: Show what we found
                  cat("DEBUG: Prediction", i, "- class_name:", class_name, "confidence:", confidence, "\n")
                  
                  # Check if confidence is already in percentage format (>1) or decimal format (0-1)
                  if (confidence > 1) {
                    # Already in percentage format, don't multiply by 100
                    confidence_display <- confidence
                  } else {
                    # In decimal format, convert to percentage
                    confidence_display <- confidence * 100
                  }
                  
                  output_text <- paste0(
                    output_text,
                    sprintf("- %s: %.2f%% confidence\n", class_name, confidence_display)
                  )
                }
              } else {
                output_text <- paste0(output_text, "No predictions above confidence threshold.")
              }
            } else {
              output_text <- paste0(output_text, "No prediction data returned.")
            }
            
          } else if (grepl("object_detection", task_type, ignore.case = TRUE)) {
            # Handle Object Detection
            cat("DEBUG: Handling object detection\n")
            
            # Handle annotated image if available
            if (!is.null(result$annotated_image) && result$annotated_image != "") {
              tryCatch({
                # Decode base64 image and save it temporarily
                img_data <- base64enc::base64decode(result$annotated_image)
                temp_file <- tempfile(fileext = ".jpg")
                writeBin(img_data, temp_file)
                
                # Display the annotated image
                output$prediction_image_display <- renderImage({
                  list(src = temp_file,
                       contentType = 'image/jpeg',
                       width = "100%",
                       height = "400px",
                       alt = "Annotated image with detections")
                }, deleteFile = TRUE)
                
                cat("DEBUG: Annotated image displayed\n")
              }, error = function(e) {
                cat("DEBUG: Error displaying annotated image:", e$message, "\n")
              })
            }
            
            if (!is.null(result$detections)) {
              detections <- result$detections
              num_detections <- length(detections)
              
              cat("DEBUG: Number of detections received from backend:", num_detections, "\n")
              cat("DEBUG: Confidence threshold that was sent:", input$confidence_threshold, "\n")
              
              output_text <- paste0(output_text, "Object Detection Results:\n")
              output_text <- paste0(output_text, sprintf("Objects Found: %d\n", num_detections))
              output_text <- paste0(output_text, sprintf("Processing Time: %.3fs\n\n", processing_time))
              
              if (num_detections > 0) {
                output_text <- paste0(output_text, "Detected Objects:\n")
                
                # Group detections by class and show summary
                class_counts <- table(sapply(detections, function(d) d$class_name %||% d$class %||% "Unknown"))
                
                for (class_name in names(class_counts)) {
                  count <- class_counts[[class_name]]
                  # Get highest confidence for this class
                  class_detections <- detections[sapply(detections, function(d) (d$class_name %||% d$class %||% "Unknown") == class_name)]
                  max_conf <- max(sapply(class_detections, function(d) d$confidence %||% 0))
                  
                  if (max_conf > 1) {
                    conf_display <- max_conf
                  } else {
                    conf_display <- max_conf * 100
                  }
                  
                  output_text <- paste0(
                    output_text,
                    sprintf("• %s: %d object%s detected (max confidence: %.1f%%)\n", 
                           class_name, count, ifelse(count > 1, "s", ""), conf_display)
                  )
                }
                
                output_text <- paste0(output_text, "\nSee the annotated image on the right for bounding box locations.")
              } else {
                output_text <- paste0(output_text, "No objects detected above confidence threshold.")
              }
            } else {
              output_text <- paste0(output_text, "No detection data returned.")
            }
            
          } else {
            # Generic handling for unknown task types
            cat("DEBUG: Handling generic/unknown task type\n")
            
            # Try both predictions and detections
            if (!is.null(result$predictions)) {
              predictions <- result$predictions
              if (is.list(predictions) && length(predictions) > 0) {
                output_text <- paste0(output_text, "Predictions:\n")
                
                for (i in seq_along(predictions)) {
                  pred <- predictions[[i]]
                  class_name <- pred$class_name %||% pred$class %||% pred$label %||% "Unknown"
                  confidence <- pred$confidence %||% pred$score %||% pred$probability %||% 0
                  
                  if (confidence > 1) {
                    confidence_display <- confidence
                  } else {
                    confidence_display <- confidence * 100
                  }
                  
                  output_text <- paste0(
                    output_text,
                    sprintf("- %s: %.2f%% confidence\n", class_name, confidence_display)
                  )
                }
              }
            } else if (!is.null(result$detections)) {
              detections <- result$detections
              output_text <- paste0(output_text, sprintf("Detections found: %d\n", length(detections)))
            } else {
              output_text <- paste0(output_text, "No prediction or detection data returned.")
            }
          }
          
          return(output_text)
        } else {
          error_content <- content(response, "text")
          paste("Prediction failed:", status_code(response), "-", error_content)
        }
      }, error = function(e) {
        paste("Prediction error:", e$message)
      })
    })
  })
  
  # Jobs Tab Functions
  observeEvent(input$refresh_jobs, {
    output$jobs_table <- DT::renderDataTable({
      list_all_jobs()
    }, options = list(scrollX = TRUE))
  })
  
  observeEvent(input$get_job_details, {
    output$job_details_output <- renderText({
      get_job_status(input$job_status_id)
    })
  })
  
  # Datasets Tab Functions
  observeEvent(input$refresh_datasets, {
    # Update the datasets table in the datasets tab
    output$datasets_table <- DT::renderDataTable({
      df <- list_available_datasets()
      datasets_df_store(df)
      df
    }, selection = 'single', options = list(scrollX = TRUE))
    
    # Also update the dataset dropdown in the train model tab (cross-tab functionality)
    choices <- get_datasets_for_dropdown()
    updateSelectInput(session, "dataset_dropdown", choices = choices)
  })
  
  # Delete Job Tab Functions
  observeEvent(input$refresh_delete_jobs, {
    choices <- get_jobs_for_dropdown()
    updateSelectInput(session, "delete_job_dropdown", choices = choices)
  })
  
  observeEvent(input$delete_job_btn, {
    output$delete_output <- renderText({
      delete_job(input$delete_job_dropdown)
    })
  })
  
  # Responsible AI Handlers
  observeEvent(input$check_class_balance_btn, {
    output$class_balance_output <- renderText({
      check_class_balance(input$rai_dataset_id)
    })
  })
  
  observeEvent(input$check_fairness_btn, {
    output$fairness_output <- renderText({
      check_fairness(input$rai_fairness_job_id, input$rai_fairness_dataset_id, as.list(strsplit(input$rai_sensitive_attrs, ",\\s*")[[1]]))
    })
  })
  
  observeEvent(input$generate_mc_btn, {
    output$model_card_output <- renderText({
      generate_model_card(input$rai_mc_job_id)
    })
  })

  # Initialize data on startup
  observe({
    output$api_status <- renderText(get_api_status())
    output$dashboard_jobs_table <- DT::renderDataTable(list_all_jobs(), options = list(scrollX = TRUE))
    output$jobs_table <- DT::renderDataTable(list_all_jobs(), options = list(scrollX = TRUE))
    output$datasets_table <- DT::renderDataTable({
      df <- list_available_datasets()
      datasets_df_store(df)
      df
    }, selection = 'single', options = list(scrollX = TRUE))
    
    # Initialize dropdowns
    updateSelectInput(session, "pending_job_dropdown", choices = get_jobs_for_dropdown("pending"))
    updateSelectInput(session, "dataset_dropdown", choices = get_datasets_for_dropdown())
    updateSelectInput(session, "trainable_job_dropdown", choices = get_jobs_for_dropdown("trainable"))
    updateSelectInput(session, "predict_job_dropdown", choices = get_jobs_for_dropdown("completed"))
    updateSelectInput(session, "delete_job_dropdown", choices = get_jobs_for_dropdown())
  })
}

# Run the application
shinyApp(ui = ui, server = server)