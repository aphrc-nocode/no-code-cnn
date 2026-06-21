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

format_jobs_for_dt <- function(jobs_df) {
  if (is.data.frame(jobs_df) && "Status" %in% names(jobs_df) && nrow(jobs_df) > 0) {
    # Check if there is an Error or Message column and return as-is
    if ("Error" %in% names(jobs_df) || "Message" %in% names(jobs_df)) {
      return(jobs_df)
    }
    jobs_df$Status <- sapply(jobs_df$Status, function(status) {
      status_lower <- tolower(as.character(status))
      badge_class <- paste0("status-badge status-badge-", status_lower)
      if (!(status_lower %in% c("completed", "failed", "training", "pending"))) {
        if (status_lower == "success") {
          badge_class <- "status-badge status-badge-completed"
        } else if (status_lower == "error") {
          badge_class <- "status-badge status-badge-failed"
        } else if (status_lower == "running") {
          badge_class <- "status-badge status-badge-training"
        } else {
          badge_class <- "status-badge status-badge-pending"
        }
      }
      paste0("<span class='", badge_class, "'>", status, "</span>")
    })
  }
  return(jobs_df)
}

list_trained_models <- function() {
  tryCatch({
    response <- make_request(paste0(API_URL, "/pipelines"))
    if (response$status == 200) {
      jobs <- fromJSON(response$content, simplifyVector = FALSE)
      
      # Handle different response structures
      if (is.list(jobs) && !is.null(names(jobs))) {
        jobs <- list(jobs)
      } else if (!is.list(jobs)) {
        return(data.frame(Error = "Invalid response format"))
      }
      
      if (length(jobs) == 0) {
        return(data.frame(Message = "No trained models found"))
      }
      
      # Filter for completed / success status
      completed_jobs <- Filter(function(job) {
        if (!is.list(job)) return(FALSE)
        status_lower <- tolower(if (is.null(job$status)) "" else as.character(job$status))
        return(status_lower == "completed" || status_lower == "success")
      }, jobs)
      
      if (length(completed_jobs) == 0) {
        return(data.frame(Message = "No completed models found"))
      }
      
      model_data <- lapply(completed_jobs, function(job) {
        id <- if (is.null(job$id)) "N/A" else as.character(job$id)
        
        config <- job$pipeline_config
        if (is.list(config)) {
          name <- if (is.null(config$name)) "N/A" else as.character(config$name)
          arch <- if (is.null(config$architecture)) "N/A" else as.character(config$architecture)
          task <- if (is.null(config$task_type)) "N/A" else as.character(config$task_type)
          epochs <- if (is.null(config$epochs)) "N/A" else as.character(config$epochs)
        } else {
          name <- arch <- task <- epochs <- "N/A"
        }
        
        # Safely extract metrics
        metrics <- job$metrics
        accuracy <- "N/A"
        loss <- "N/A"
        if (is.list(metrics)) {
          acc_val <- metrics$accuracy %||% metrics$val_acc %||% metrics$val_accuracy %||% metrics$train_acc %||% metrics$map_50
          loss_val <- metrics$loss %||% metrics$val_loss %||% metrics$train_loss
          
          if (!is.null(acc_val)) accuracy <- sprintf("%.4f", as.numeric(acc_val))
          if (!is.null(loss_val)) loss <- sprintf("%.4f", as.numeric(loss_val))
        }

        
        # Add Actions buttons
        actions_html <- paste0(
          "<button class='btn btn-primary btn-xs' onclick=\"Shiny.setInputValue('view_model_card_id', '", id, "', {priority: 'event'})\">",
          "<i class='fa fa-file-text'></i> Model Card</button> ",
          "<button class='btn btn-info btn-xs' onclick=\"Shiny.setInputValue('view_curves_id', '", id, "', {priority: 'event'})\">",
          "<i class='fa fa-chart-line'></i> Curves</button> ",
          "<button class='btn btn-success btn-xs' onclick=\"Shiny.setInputValue('eval_model_id', '", id, "', {priority: 'event'})\">",
          "<i class='fa fa-check-double'></i> Evaluate</button>"
        )
        
        return(list(ID = id, Name = name, Architecture = arch, Task = task, Epochs = epochs, Accuracy = accuracy, Loss = loss, Actions = actions_html))
      })
      
      models_df <- data.frame(
        ID = sapply(model_data, function(x) x$ID),
        Name = sapply(model_data, function(x) x$Name),
        Architecture = sapply(model_data, function(x) x$Architecture),
        Task = sapply(model_data, function(x) x$Task),
        Epochs = sapply(model_data, function(x) x$Epochs),
        Accuracy = sapply(model_data, function(x) x$Accuracy),
        Loss = sapply(model_data, function(x) x$Loss),
        Actions = sapply(model_data, function(x) x$Actions),
        stringsAsFactors = FALSE
      )
      return(models_df)
    } else {
      return(data.frame(Error = paste("Error fetching models:", response$status)))
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
    sidebarMenu(id = "sidebarMenu",
      menuItem("Analytics", tabName = "dashboard", icon = icon("chart-line"), selected = TRUE),
      menuItem("Visual Pipeline Builder", tabName = "workflow", icon = icon("project-diagram")),
      menuItem("Datasets", tabName = "datasets", icon = icon("database")),
      menuItem("Train Model", tabName = "train", icon = icon("cog")),
      menuItem("Trained Models", tabName = "models", icon = icon("brain")),
      menuItem("Model Evaluation", tabName = "evaluation", icon = icon("chart-bar")),
      menuItem("Make Predictions", tabName = "predict", icon = icon("eye")),
      menuItem("View Jobs", tabName = "jobs", icon = icon("list")),
      menuItem("Delete Job", tabName = "delete", icon = icon("trash"))
    )
  ),
  
  dashboardBody(
    tags$head(
      tags$style(HTML("
        .content-wrapper, .right-side {
          background-color: #f4f4f4;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 10px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .status-badge-training {
          background-color: #ffecc7;
          color: #b25e00;
        }
        .status-badge-completed {
          background-color: #d1f7c4;
          color: #1e7e34;
        }
        .status-badge-failed {
          background-color: #fddcdc;
          color: #bd2130;
        }
        .status-badge-pending {
          background-color: #e2f0fd;
          color: #004085;
        }
        
        /* Premium Markdown Document Styling (Model & Data Cards) */
        .markdown-card-container {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: #1d1d1f;
          line-height: 1.65;
          font-size: 15px;
          padding: 24px;
          background: #ffffff;
          border: 1px solid #d2d2d7;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.03);
          margin-bottom: 25px;
        }
        .markdown-card-container h1 {
          font-size: 26px;
          font-weight: 700;
          color: #1d1d1f;
          border-bottom: 1px solid #e8e8ed;
          padding-bottom: 10px;
          margin-top: 0;
          margin-bottom: 20px;
        }
        .markdown-card-container h2 {
          font-size: 20px;
          font-weight: 600;
          color: #0071e3;
          margin-top: 30px;
          margin-bottom: 15px;
          border-bottom: 1px solid #f5f5f7;
          padding-bottom: 6px;
        }
        .markdown-card-container h3 {
          font-size: 16px;
          font-weight: 600;
          color: #1d1d1f;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        .markdown-card-container p {
          margin-bottom: 15px;
          color: #333336;
        }
        .markdown-card-container ul, .markdown-card-container ol {
          padding-left: 20px;
          margin-bottom: 15px;
        }
        .markdown-card-container li {
          margin-bottom: 6px;
          color: #333336;
        }
        .markdown-card-container strong {
          color: #1d1d1f;
          font-weight: 600;
        }
        .markdown-card-container table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 14px;
          text-align: left;
        }
        .markdown-card-container th {
          background-color: #f5f5f7;
          color: #1d1d1f;
          font-weight: 600;
          padding: 10px 12px;
          border-bottom: 2px solid #d2d2d7;
        }
        .markdown-card-container td {
          padding: 10px 12px;
          border-bottom: 1px solid #e8e8ed;
          color: #333336;
        }
        .markdown-card-container tr:hover td {
          background-color: #fafdff;
        }
        .markdown-card-container blockquote {
          margin: 15px 0;
          padding: 10px 20px;
          background-color: #f5f5f7;
          border-left: 4px solid #0071e3;
          color: #515154;
          font-style: italic;
          border-radius: 0 8px 8px 0;
        }
        .markdown-card-container pre, .markdown-card-container code {
          background-color: #f5f5f7;
          font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
          font-size: 13px;
          border-radius: 4px;
        }
        .markdown-card-container code {
          padding: 2px 6px;
          color: #d81b60;
        }
        .markdown-card-container pre {
          padding: 15px;
          overflow-x: auto;
          border: 1px solid #e8e8ed;
        }
        .markdown-card-container pre code {
          padding: 0;
          background-color: transparent;
          color: inherit;
          font-size: inherit;
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
        .eval-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 15px;
          margin-top: 15px;
        }
        .eval-card {
          background: white;
          border: 1px solid #ddd;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .eval-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }
        .eval-card-img-container {
          width: 100%;
          padding-top: 100%;
          position: relative;
          background-color: #f9f9f9;
        }
        .eval-card-img-container img {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .eval-card-content {
          padding: 10px;
          font-size: 12px;
        }
        .eval-card-title {
          font-weight: bold;
          margin-bottom: 5px;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }
        .eval-pred-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }
        .eval-indicator {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 5px;
        }
        .eval-indicator-correct {
          background-color: #2ca02c;
        }
        .eval-indicator-incorrect {
          background-color: #d62728;
        }
        .eval-indicator-neutral {
          background-color: #7f7f7f;
        }
        .eval-metric-cards-container {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
          margin-bottom: 20px;
        }
        .eval-metric-card {
          flex: 1;
          min-width: 180px;
          background: white;
          border: 1px solid #e1e4e8;
          border-radius: 6px;
          padding: 15px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .eval-metric-card-title {
          font-size: 12px;
          color: #586069;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 5px;
        }
        .eval-metric-card-value {
          font-size: 20px;
          font-weight: bold;
          color: #24292e;
        }
        
        /* Create ML Style Dataset split cards */
        .createml-data-cards {
          display: flex;
          gap: 20px;
          margin-bottom: 25px;
          flex-wrap: wrap;
        }
        .createml-card {
          flex: 1;
          min-width: 250px;
          background: white;
          border: 1px solid #d2d2d7;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 190px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .createml-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .createml-card-title {
          font-size: 13px;
          color: #86868b;
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.5px;
        }
        .createml-card-body {
          margin: 15px 0;
          flex-grow: 1;
        }
        .createml-card-main-val {
          font-size: 26px;
          font-weight: 700;
          color: #1d1d1f;
        }
        .createml-card-sub-val {
          font-size: 14px;
          color: #86868b;
          margin-top: 5px;
        }
        .createml-card-selector {
          margin-top: auto;
        }
        .createml-card-selector select {
          width: 100%;
          border: 1px solid #d2d2d7;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          color: #1d1d1f;
          background-color: #f5f5f7;
        }
        .createml-params-box {
          background: white;
          border: 1px solid #d2d2d7;
          border-radius: 12px;
          padding: 25px;
          margin-bottom: 25px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        .createml-train-btn-container {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 20px;
          background: #f5f5f7;
          padding: 15px 20px;
          border-radius: 10px;
          border: 1px solid #d2d2d7;
        }
        .createml-play-btn {
          background-color: #0071e3;
          color: white;
          border: none;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          font-size: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          box-shadow: 0 4px 10px rgba(0, 113, 227, 0.3);
          transition: background-color 0.2s, transform 0.1s;
        }
        .createml-play-btn:hover {
          background-color: #0077ed;
          transform: scale(1.05);
        }
        .createml-play-btn:active {
          transform: scale(0.95);
        }
        .createml-play-btn:disabled {
          background-color: #d2d2d7;
          color: #86868b;
          cursor: not-allowed;
          box-shadow: none;
        }
        
        /* HTML/CSS Class Distribution Horizontal Bars */
        .class-dist-table {
          width: 100%;
          max-width: 800px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          text-align: left;
          padding: 15px;
        }
        .class-dist-header {
          display: flex;
          font-weight: 600;
          color: #86868b;
          border-bottom: 1px solid #d2d2d7;
          padding-bottom: 8px;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .class-dist-row {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
          font-size: 14px;
        }
        .class-dist-col-label {
          width: 150px;
          font-weight: 500;
          color: #1d1d1f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .class-dist-col-count {
          width: 80px;
          color: #86868b;
          text-align: left;
          font-weight: 500;
        }
        .class-dist-col-bar {
          flex-grow: 1;
          background-color: #f5f5f7;
          border-radius: 6px;
          height: 18px;
          overflow: hidden;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
        }
        .class-dist-bar-fill {
          background-color: #0071e3; /* Apple SF Blue */
          height: 100%;
          border-radius: 6px;
          transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        /* Interactive Popup Modal */
        .eval-modal-dialog .modal-content {
          border-radius: 12px;
          overflow: hidden;
          border: none;
          box-shadow: 0 15px 40px rgba(0,0,0,0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .eval-modal-dialog .modal-header {
          display: none; /* Hide default header */
        }
        .eval-modal-body {
          padding: 0;
          display: flex;
          height: 75vh;
          min-height: 520px;
        }
        .eval-modal-left {
          flex: 65;
          background-color: #f5f5f7;
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 20px;
          border-right: 1px solid #d2d2d7;
        }
        .eval-modal-right {
          flex: 35;
          background-color: white;
          padding: 25px;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          position: relative;
        }
        .eval-modal-close-btn {
          position: absolute;
          top: 15px;
          right: 15px;
          background: none;
          border: none;
          font-size: 20px;
          color: #86868b;
          cursor: pointer;
          z-index: 10;
          transition: color 0.15s;
        }
        .eval-modal-close-btn:hover {
          color: #1d1d1f;
        }
        .eval-modal-img {
          max-width: 100%;
          max-height: calc(75vh - 80px);
          object-fit: contain;
          border-radius: 6px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.08);
        }
        .eval-modal-nav-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          background-color: rgba(29, 29, 31, 0.5);
          color: white;
          border: none;
          width: 45px;
          height: 45px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color 0.2s, transform 0.1s;
          font-size: 16px;
        }
        .eval-modal-nav-btn:hover {
          background-color: rgba(29, 29, 31, 0.85);
          transform: translateY(-50%) scale(1.05);
        }
        .eval-modal-nav-btn:active {
          transform: translateY(-50%) scale(0.95);
        }
        .eval-modal-prev-btn {
          left: 20px;
        }
        .eval-modal-next-btn {
          right: 20px;
        }
        .eval-modal-counter {
          margin-top: 15px;
          font-size: 13px;
          color: #86868b;
          font-weight: 600;
        }
        
        .eval-class-row {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
          font-size: 13px;
        }
        .eval-class-label {
          width: 120px;
          font-weight: 500;
          color: #1d1d1f;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .eval-class-pct {
          width: 45px;
          color: #86868b;
          text-align: right;
          margin-right: 10px;
          font-weight: 500;
        }
        .eval-progress-container {
          flex-grow: 1;
          background-color: #f5f5f7;
          border-radius: 4px;
          height: 10px;
          overflow: hidden;
        }
        .eval-progress-bar {
          background-color: #0071e3;
          height: 100%;
          border-radius: 4px;
        }
        .eval-progress-bar-incorrect {
          background-color: #ff3b30;
        }
        .eval-progress-bar-correct {
          background-color: #34c759;
        }
      "))
    ),
    
    tabItems(
      # Visual Pipeline Builder Tab
      tabItem(tabName = "workflow",
        div(style = "padding: 10px;",
          h2("Visual Pipeline Builder", style = "margin-top: 0; margin-bottom: 20px; font-weight: bold; color: #1d1d1f;"),
          p("Design, configure, train, and test your deep learning pipelines visually.", style = "color: #555; margin-bottom: 15px;"),
          uiOutput("workflow_iframe_ui")
        )
      ),
      
      # Dashboard Tab (Analytics)
      tabItem(tabName = "dashboard",
        div(style = "padding: 10px;",
          h2("Platform Analytics", style = "margin-top: 0; margin-bottom: 20px; font-weight: bold; color: #1d1d1f;"),
          fluidRow(
            valueBoxOutput("stat_total_datasets", width = 3),
            valueBoxOutput("stat_trained_models", width = 3),
            valueBoxOutput("stat_active_jobs", width = 3),
            valueBoxOutput("stat_failed_jobs", width = 3)
          ),
          br(),
          fluidRow(
            box(
              title = "Model Distributions", status = "primary", solidHeader = TRUE, width = 6,
              plotOutput("stat_arch_plot", height = "300px")
            ),
            box(
              title = "System Controls", status = "info", solidHeader = TRUE, width = 6,
              actionButton("check_status", "Check API Status", class = "btn-primary"),
              actionButton("start_mlflow", "Start MLflow Server", class = "btn-info"),
              br(), br(),
              verbatimTextOutput("api_status"),
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
      
      # Train Model Tab (Create ML Style Unified Page)
      tabItem(tabName = "train",
        # Top toolbar
        fluidRow(
          column(12,
            div(class = "createml-train-btn-container",
              div(style = "display: flex; align-items: center; gap: 15px; flex-grow: 1;",
                selectInput("train_selected_job", "Selected Pipeline / Job:", choices = list(), width = "350px"),
                actionButton("refresh_train_jobs", "", icon = icon("sync"), class = "btn-default", style = "margin-top: 5px; height: 34px;"),
                actionButton("train_create_new_btn", "+ New Pipeline", class = "btn-info", style = "margin-top: 5px; height: 34px;")
              ),
              div(style = "display: flex; align-items: center; gap: 10px;",
                span(style = "font-weight: bold; color: #1d1d1f;", "Train"),
                uiOutput("train_play_button_ui")
              )
            )
          )
        ),
        
        # Data Cards Split Pane
        fluidRow(
          column(12,
            h3("Data", style = "margin-top: 0; font-family: -apple-system, sans-serif; font-weight: 600; color: #1d1d1f; margin-bottom: 15px;"),
            div(class = "createml-data-cards",
              # Training Card
              div(class = "createml-card",
                div(class = "createml-card-title", "Training Data"),
                div(class = "createml-card-body",
                  div(class = "createml-card-main-val", textOutput("train_dataset_classes_text", inline = TRUE)),
                  div(class = "createml-card-sub-val", textOutput("train_dataset_items_text", inline = TRUE))
                ),
                div(class = "createml-card-selector",
                  selectInput("train_dataset_select", NULL, choices = list())
                )
              ),
              # Validation Card
              div(class = "createml-card",
                div(class = "createml-card-title", "Validation Data"),
                div(class = "createml-card-body",
                  div(class = "createml-card-main-val", "Auto"),
                  div(class = "createml-card-sub-val", "Split from Training Data")
                ),
                div(class = "createml-card-selector",
                  selectInput("train_val_select", NULL, choices = c("Automatic Split (10%)" = "auto_10", "Automatic Split (20%)" = "auto_20", "No Validation split" = "none"))
                )
              ),
              # Testing Card
              div(class = "createml-card",
                div(class = "createml-card-title", "Testing Data"),
                div(class = "createml-card-body",
                  div(class = "createml-card-main-val", "Auto"),
                  div(class = "createml-card-sub-val", "10% held out split")
                ),
                div(class = "createml-card-selector",
                  selectInput("train_test_select", NULL, choices = c("Automatic Split (10%)" = "auto_10", "Automatic Split (20%)" = "auto_20", "No Testing split" = "none"))
                )
              )
            )
          )
        ),
        
        # Parameters Section
        fluidRow(
          column(12,
            div(class = "createml-params-box",
              h3("Parameters", style = "margin-top: 0; font-family: -apple-system, sans-serif; font-weight: 600; color: #1d1d1f; margin-bottom: 20px;"),
              fluidRow(
                column(4,
                  selectInput("train_arch_select", "Algorithm", 
                              choices = list("ResNet-18" = "resnet18",
                                           "ResNet-50" = "resnet50",
                                           "VGG-16" = "vgg16",
                                           "MobileNet" = "mobilenet",
                                           "EfficientNet" = "efficientnet",
                                           "Faster R-CNN" = "faster_rcnn"),
                              selected = "resnet18")
                ),
                column(8,
                  fluidRow(
                    column(3, numericInput("train_epochs_input", "Epochs (Iterations)", value = 5, min = 1, max = 1000)),
                    column(3, numericInput("train_batch_size_input", "Batch Size", value = 8, min = 1, max = 128)),
                    column(3, numericInput("train_lr_input", "Learning Rate", value = 0.001, min = 0.0001, max = 1, step = 0.0001)),
                    column(3, textInput("train_img_size_input", "Image Size", value = "224, 224"))
                  )
                )
              ),
              fluidRow(
                column(4,
                  checkboxInput("train_augmentation_checkbox", "Enable Data Augmentation", value = TRUE)
                ),
                column(4,
                  checkboxInput("train_early_stopping_checkbox", "Enable Early Stopping", value = TRUE)
                ),
                column(4,
                  actionButton("train_save_params_btn", "Save Parameters", class = "btn-default", style = "float: right; margin-top: 15px;")
                )
              )
            )
          )
        ),
        
        # Training metrics & curves section
        conditionalPanel(
          condition = "output.train_show_progress_section == true",
          fluidRow(
            column(12,
              box(
                title = uiOutput("train_progress_box_title_ui"), status = "primary", solidHeader = TRUE, width = 12,
                tabsetPanel(id = "train_progress_tabs",
                  tabPanel("Training Curves",
                    br(),
                    div(style = "display: flex; justify-content: flex-end; margin-bottom: 10px;",
                      radioButtons("train_curve_metric_select", NULL, choices = c("Accuracy" = "accuracy", "Loss" = "loss"), inline = TRUE)
                    ),
                    plotOutput("train_curves_plot", height = "380px")
                  ),
                  tabPanel("Logs",
                    br(),
                    verbatimTextOutput("train_logs_display")
                  ),
                  tabPanel("Model Card",
                    br(),
                    uiOutput("train_model_card_display_unified")
                  )
                )
              )
            )
          )
        )
      ),
      
      # Trained Models Tab
      tabItem(tabName = "models",
        div(style = "padding: 10px;",
          h2("Trained Models Repository", style = "margin-top: 0; margin-bottom: 20px; font-weight: bold; color: #1d1d1f;"),
          fluidRow(
            box(
              title = "Completed Models", status = "primary", solidHeader = TRUE, width = 12,
              p("Explore all completed CNN models and image classifiers. Retrieve training metrics, inspect model cards, visualize training curves, or run interactive evaluations.", style = "color: #555; margin-bottom: 15px;"),
              actionButton("refresh_models_table", "Refresh Models List", class = "btn-success"),
              br(), br(),
              DT::dataTableOutput("trained_models_table")
            )
          )
        )
      ),
      
      # Model Evaluation Tab
      tabItem(tabName = "evaluation",
        fluidRow(
          box(
            title = "Model Evaluation Controls", status = "primary", solidHeader = TRUE, width = 12,
            fluidRow(
              column(6,
                selectInput("eval_job_dropdown", "Select Trained Model", choices = list()),
                actionButton("refresh_eval_models", "Refresh Available Models", class = "btn-info")
              ),
              column(6,
                br(),
                actionButton("run_evaluation", "Run Evaluation", class = "btn-success btn-lg", style = "margin-top: 5px;")
              )
            )
          )
        ),
        
        conditionalPanel(
          condition = "output.eval_data_available == true",
          fluidRow(
            box(
              title = uiOutput("eval_summary_title"), status = "info", solidHeader = TRUE, width = 12,
              
              # Info Cards Container
              div(class = "eval-metric-cards-container",
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card1_title")),
                  div(class = "eval-metric-card-value", textOutput("eval_accuracy_val"))
                ),
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card2_title")),
                  div(class = "eval-metric-card-value", style = "color: #2ca02c;", actionLink("click_correct", textOutput("eval_correct_val"), style = "color: inherit; text-decoration: none; font-weight: bold;"))
                ),
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card3_title")),
                  div(class = "eval-metric-card-value", style = "color: #d62728;", actionLink("click_incorrect", textOutput("eval_incorrect_val"), style = "color: inherit; text-decoration: none; font-weight: bold;"))
                ),
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card4_title")),
                  div(class = "eval-metric-card-value", style = "font-size: 14px; min-height: 28px; display: flex; align-items: center;", textOutput("eval_top_confusion_val"))
                ),
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card5_title")),
                  div(class = "eval-metric-card-value", style = "font-size: 16px; min-height: 28px; display: flex; align-items: center;", textOutput("eval_lowest_precision_val"))
                ),
                div(class = "eval-metric-card",
                  div(class = "eval-metric-card-title", textOutput("eval_card6_title")),
                  div(class = "eval-metric-card-value", style = "font-size: 16px; min-height: 28px; display: flex; align-items: center;", textOutput("eval_lowest_recall_val"))
                )
              ),
              
              # Sub-tabs/Pills
              tabsetPanel(type = "pills", id = "eval_pills",
                tabPanel("Metrics",
                  br(),
                  conditionalPanel(
                    condition = "output.eval_is_classification == true",
                    fluidRow(
                      column(12,
                        checkboxGroupInput("eval_table_cols", "Columns to Display:",
                                           choices = c("Count" = "count",
                                                       "Correct" = "correct",
                                                       "Precision" = "precision",
                                                       "Recall" = "recall",
                                                       "F1 Score" = "f1_score"),
                                           selected = c("count", "correct", "precision", "recall", "f1_score"),
                                           inline = TRUE)
                      )
                    )
                  ),
                  DT::dataTableOutput("eval_metrics_table")
                ),
                tabPanel("Explore",
                  br(),
                  fluidRow(
                    conditionalPanel(
                      condition = "output.eval_is_classification == true",
                      column(4,
                        selectInput("explore_result_filter", "Result:", 
                                    choices = c("All" = "all", "Correct" = "correct", "Incorrect" = "incorrect"), 
                                    selected = "all")
                      )
                    ),
                    column(4,
                      selectInput("explore_label_filter", "Label:", choices = c("Any" = "any"))
                    ),
                    column(4,
                      selectInput("explore_pred_filter", "Prediction:", choices = c("Any" = "any"))
                    )
                  ),
                  hr(),
                  h4(textOutput("explore_summary_text")),
                  uiOutput("explore_grid_display")
                )
              )
            )
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
                checkboxInput("show_probabilities", "Show All Class Probabilities", value = TRUE),
                selectInput("explain_method", "Explain Prediction (XAI)", 
                            choices = list("None" = "none", "Grad-CAM" = "gradcam", "LIME" = "lime", "SHAP" = "shap"), 
                            selected = "gradcam"),
                conditionalPanel(
                  condition = "input.explain_method != 'none'",
                  uiOutput("explain_box_selector_ui")
                )
              )
            ),
            br(),
            actionButton("make_prediction", "Make Prediction", class = "btn-primary btn-lg"),
            br(), br(),
            fluidRow(
              column(4,
                h4("Prediction Results"),
                verbatimTextOutput("prediction_output")
              ),
              column(4,
                h4("Uploaded Image"),
                imageOutput("prediction_image_display", height = "400px"),
                br(),
                textOutput("image_info")
              ),
              column(4,
                conditionalPanel(
                  condition = "output.prediction_has_explanation == true",
                  h4("Prediction Explanation (XAI)"),
                  uiOutput("prediction_explanation_display")
                )
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
          column(4,
            box(
              title = "Upload New Dataset", status = "primary", solidHeader = TRUE, width = 12,
              textInput("dataset_upload_name", "Dataset Name", value = "My Custom Dataset"),
              selectInput("dataset_upload_task", "Task Type",
                          choices = list("Image Classification" = "image_classification",
                                       "Object Detection" = "object_detection"),
                          selected = "image_classification"),
              fileInput("dataset_upload_file", "Select ZIP file (.zip)", accept = ".zip"),
              br(),
              actionButton("dataset_upload_submit", "Upload Dataset", class = "btn-primary btn-block"),
              br(),
              verbatimTextOutput("dataset_upload_output")
            )
          ),
          column(8,
            box(
              title = "Available Datasets", status = "success", solidHeader = TRUE, width = 12,
              actionButton("refresh_datasets", "Refresh Datasets", class = "btn-success"),
              p(style = "margin-top: 8px; color: #888;", "Click a row to view its Data Card & validation report."),
              br(),
              DT::dataTableOutput("datasets_table")
            )
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
                  div(style = "padding: 15px;",
                    plotOutput("datacard_distribution_plot", height = "400px")
                  )
                ),

                tabPanel("Sample Images",
                  div(style = "padding: 15px; text-align: center;",
                    div(style = "margin-bottom: 15px;",
                      actionButton("prev_sample_image", "Previous", icon = icon("chevron-left"), class = "btn-primary"),
                      span(textOutput("sample_image_counter", inline = TRUE), style = "margin: 0 15px; font-weight: bold; font-size: 16px;"),
                      actionButton("next_sample_image", "Next", icon = icon("chevron-right"), class = "btn-primary")
                    ),
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
      )
    )
  )
)

# Server
server <- function(input, output, session) {
  
  # Visual Workflow Iframe Render
  output$workflow_iframe_ui <- renderUI({
    api_host <- API_URL
    if (grepl("host.docker.internal", api_host)) {
      api_host <- gsub("host.docker.internal", "localhost", api_host)
    }
    iframe_url <- paste0(api_host, "/workflow/")
    tags$iframe(
      src = iframe_url, 
      style = "width: 100%; height: 85vh; border: none; overflow: hidden; background: transparent;", 
      scrolling = "no"
    )
  })
  
  # Interactive XAI Bounding Box Reactive Variables
  prediction_task_type <- reactiveVal(NULL)
  prediction_detections <- reactiveVal(NULL)
  active_explain_box <- reactiveVal(-1)
  eval_data <- reactiveVal(NULL)
  
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
      format_jobs_for_dt(list_all_jobs())
    }, escape = FALSE, options = list(scrollX = TRUE))
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
  sample_images_store <- reactiveVal(list())
  current_image_idx <- reactiveVal(1)
  
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
            commonmark::markdown_html(md_text, extensions = TRUE)
          }, error = function(e) {
            paste0("<pre>", md_text, "</pre>")
          })
          div(class = "markdown-card-container", HTML(html_text))
        })
        
        # Render Class Distribution as a barplot (same style as architecture distribution)
        output$datacard_distribution_plot <- renderPlot({
          dist <- result$class_distribution
          if (is.null(dist) || length(dist) == 0) {
            plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
            text(0.5, 0.5, "No class distribution data available.", col="#86868b", font=2, cex=1.2)
            return()
          }
          
          class_names <- names(dist)
          counts <- as.numeric(unlist(dist))
          names(counts) <- class_names
          counts <- sort(counts)
          
          par(mar = c(5, 12, 3, 2), bg = "white")
          barplot(counts, horiz = TRUE, las = 1, col = "#0071e3", border = NA,
                  main = "Class Distribution", col.main = "#1d1d1f",
                  xlab = "Number of Images", col.lab = "#1d1d1f", font.lab = 2,
                  cex.names = 0.9, cex.main = 1.2)
        })

        
        # Store Sample Images for slideshow
        imgs <- result$sample_images
        if (!is.null(imgs) && length(imgs) > 0) {
          sample_images_store(imgs)
          current_image_idx(1)
        } else {
          sample_images_store(list())
          current_image_idx(0)
        }
        
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
  
  # Slideshow Navigation Logic
  observeEvent(input$prev_sample_image, {
    idx <- current_image_idx()
    if (idx > 1) current_image_idx(idx - 1)
  })
  
  observeEvent(input$next_sample_image, {
    idx <- current_image_idx()
    imgs <- sample_images_store()
    if (idx < length(imgs)) current_image_idx(idx + 1)
  })
  
  output$sample_image_counter <- renderText({
    imgs <- sample_images_store()
    idx <- current_image_idx()
    if (length(imgs) == 0) return("0 / 0")
    return(paste(idx, "/", length(imgs)))
  })
  
  output$datacard_sample_images <- renderUI({
    imgs <- sample_images_store()
    idx <- current_image_idx()
    
    if (length(imgs) == 0 || idx == 0) {
      return(tags$p("No sample images available.", style = "color: #999;"))
    }
    
    img <- imgs[[idx]]
    tags$div(
      class = "col-md-12",
      style = "margin-bottom: 30px;",
      tags$div(
        style = "border: 1px solid #ddd; border-radius: 6px; padding: 15px; text-align: center; background: #fafafa;",
        tags$img(
          src = paste0("data:image/jpeg;base64,", img$image_base64),
          style = "max-width: 100%; max-height: 80vh; height: auto; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"
        ),
        tags$h3(img$class_name, style = "margin-top: 20px; color: #222; font-weight: bold;")
      )
    )
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
  
  # Model Evaluation Tab Functions
  output$eval_data_available <- reactive({
    !is.null(eval_data())
  })
  outputOptions(output, "eval_data_available", suspendWhenHidden = FALSE)
  
  observeEvent(input$refresh_eval_models, {
    choices <- get_jobs_for_dropdown("completed")
    updateSelectInput(session, "eval_job_dropdown", choices = choices)
  })
  
  observeEvent(input$run_evaluation, {
    if (is.null(input$eval_job_dropdown) || input$eval_job_dropdown == "") {
      showNotification("Please select a trained model first.", type = "error")
      return()
    }
    
    showModal(modalDialog(
      title = "Evaluating Model",
      "Running predictions and calculating performance metrics on test/validation set... Please wait.",
      footer = NULL,
      easyClose = FALSE
    ))
    
    tryCatch({
      url <- paste0(API_URL, "/pipelines/", input$eval_job_dropdown, "/evaluate")
      response <- GET(url)
      
      if (status_code(response) == 200) {
        result <- content(response, "parsed")
        eval_data(result)
        
        # Update label/prediction filters
        classes <- sapply(result$class_metrics, function(c) c$class_name)
        updateSelectInput(session, "explore_label_filter", choices = c("Any" = "any", classes), selected = "any")
        updateSelectInput(session, "explore_pred_filter", choices = c("Any" = "any", classes), selected = "any")
        
        showNotification("Evaluation completed successfully!", type = "message")
      } else {
        error_msg <- content(response, "text")
        showNotification(paste("Evaluation failed:", error_msg), type = "error")
      }
    }, error = function(e) {
      showNotification(paste("Error calling evaluation endpoint:", e$message), type = "error")
    })
    
    removeModal()
  })
  
  # KPI Clicking Navigation helpers
  observeEvent(input$click_correct, {
    updateTabsetPanel(session, "eval_pills", selected = "Explore")
    updateSelectInput(session, "explore_result_filter", selected = "correct")
  })
  
  observeEvent(input$click_incorrect, {
    updateTabsetPanel(session, "eval_pills", selected = "Explore")
    updateSelectInput(session, "explore_result_filter", selected = "incorrect")
  })
  
  # Dynamic evaluation properties
  output$eval_is_classification <- reactive({
    data <- eval_data()
    !is.null(data) && data$task_type == "image_classification"
  })
  outputOptions(output, "eval_is_classification", suspendWhenHidden = FALSE)
  
  output$eval_card1_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Test Accuracy")
    if (data$task_type == "object_detection") "mAP" else "Test Accuracy"
  })
  output$eval_card2_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Correct")
    if (data$task_type == "object_detection") "AP50" else "Correct"
  })
  output$eval_card3_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Incorrect")
    if (data$task_type == "object_detection") "AP75" else "Incorrect"
  })
  output$eval_card4_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Top Confusion")
    if (data$task_type == "object_detection") "Top Class" else "Top Confusion"
  })
  output$eval_card5_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Lowest Precision")
    if (data$task_type == "object_detection") "Target Objects" else "Lowest Precision"
  })
  output$eval_card6_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Lowest Recall")
    if (data$task_type == "object_detection") "Detected Objects" else "Lowest Recall"
  })
  
  output$eval_summary_title <- renderUI({
    data <- eval_data()
    if (is.null(data)) return("Test")
    
    model_name <- input$eval_job_dropdown
    
    if (data$task_type == "object_detection") {
      total_items <- length(data$samples)
      num_classes <- length(data$class_metrics)
      date_str <- format(Sys.time(), "%b %d, %Y at %I:%M %p")
      HTML(paste0(
        "<b>Test</b> <span style='font-size: 14px; font-weight: normal; color: #888;'>&#9432;</span><br>",
        "<span style='font-size: 12px; font-weight: normal; color: #666;'>", date_str, "</span><br>",
        "<span style='font-size: 13px; font-weight: normal; color: #333;'>", num_classes, " classes with ", total_items, " test images</span>"
      ))
    } else {
      total_items <- data$correct_count + data$incorrect_count
      num_classes <- length(data$class_metrics)
      date_str <- format(Sys.time(), "%b %d, %Y at %I:%M %p")
      HTML(paste0(
        "<b>Test</b> <span style='font-size: 14px; font-weight: normal; color: #888;'>&#9432;</span><br>",
        "<span style='font-size: 12px; font-weight: normal; color: #666;'>", date_str, "</span><br>",
        "<span style='font-size: 13px; font-weight: normal; color: #333;'>", num_classes, " classes with ", total_items, " items</span>"
      ))
    }
  })
  
  output$eval_accuracy_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0%")
    paste0(round(data$accuracy * 100), "%")
  })
  
  output$eval_correct_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0")
    if (data$task_type == "object_detection") {
      paste0(data$correct_count, "%")
    } else {
      as.character(data$correct_count)
    }
  })
  
  output$eval_incorrect_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0")
    if (data$task_type == "object_detection") {
      paste0(data$incorrect_count, "%")
    } else {
      as.character(data$incorrect_count)
    }
  })
  
  output$eval_top_confusion_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$top_confusion
  })
  
  output$eval_lowest_precision_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$lowest_precision_class
  })
  
  output$eval_lowest_recall_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$lowest_recall_class
  })
  
  output$eval_metrics_table <- DT::renderDataTable({
    data <- eval_data()
    if (is.null(data) || is.null(data$class_metrics)) return(NULL)
    
    metrics_list <- data$class_metrics
    is_det <- (data$task_type == "object_detection")
    
    if (is_det) {
      df <- data.frame(
        Class = sapply(metrics_list, function(x) x$class_name),
        `Target Objects` = sapply(metrics_list, function(x) x$count),
        `Detected Objects` = sapply(metrics_list, function(x) x$correct),
        `Average Precision` = sapply(metrics_list, function(x) paste0(round(x$precision * 100), "%")),
        check.names = FALSE,
        stringsAsFactors = FALSE
      )
      cols_to_keep <- colnames(df)
      df[, cols_to_keep, drop = FALSE]
    } else {
      df <- data.frame(
        Class = sapply(metrics_list, function(x) x$class_name),
        Count = sapply(metrics_list, function(x) x$count),
        Correct = sapply(metrics_list, function(x) x$correct),
        Precision = sapply(metrics_list, function(x) paste0(round(x$precision * 100), "%")),
        Recall = sapply(metrics_list, function(x) paste0(round(x$recall * 100), "%")),
        F1_Score = sapply(metrics_list, function(x) round(x$f1_score, 2)),
        stringsAsFactors = FALSE
      )
      
      colnames(df) <- c("Class", "Count", "Correct", "Precision", "Recall", "F1 Score")
      
      cols_to_keep <- c("Class")
      selected_cols <- input$eval_table_cols
      
      if ("count" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Count")
      if ("correct" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Correct")
      if ("precision" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Precision")
      if ("recall" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Recall")
      if ("f1_score" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "F1 Score")
      
      df[, cols_to_keep, drop = FALSE]
    }
  }, options = list(pageLength = 10, scrollX = TRUE))
  
  output$explore_summary_text <- renderText({
    data <- eval_data()
    if (is.null(data)) return("")
    
    samples <- data$samples
    res_f <- input$explore_result_filter
    lbl_f <- input$explore_label_filter
    pred_f <- input$explore_pred_filter
    
    filtered_samples <- list()
    for (s in samples) {
      if (res_f == "correct" && !s$correct) next
      if (res_f == "incorrect" && s$correct) next
      if (lbl_f != "any" && s$true_label != lbl_f) next
      if (pred_f != "any" && s$predicted_label != pred_f) next
      filtered_samples[[length(filtered_samples) + 1]] <- s
    }
    
    count <- length(filtered_samples)
    
    if (res_f == "incorrect") {
      if (pred_f != "any") {
        return(paste(count, "images were incorrectly classified as", paste0("'", pred_f, "'")))
      } else {
        return(paste(count, "images were incorrectly classified"))
      }
    } else if (res_f == "correct") {
      return(paste(count, "images were correctly classified"))
    } else {
      return(paste(count, "images in total"))
    }
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
  
  # Datasets reactive variables and tab functions
  datasets_df_store <- reactiveVal(NULL)
  sample_images_store <- reactiveVal(list())
  current_image_idx <- reactiveVal(1)
  
  output$datacard_visible <- reactive({ FALSE })
  outputOptions(output, "datacard_visible", suspendWhenHidden = FALSE)
  
  output$datacard_box_title <- renderUI({ "Data Card & Validation Report" })
  
  observeEvent(input$refresh_datasets, {
    output$datasets_table <- DT::renderDataTable({
      df <- list_available_datasets()
      datasets_df_store(df)
      df
    }, selection = 'single', options = list(scrollX = TRUE))
    
    choices <- get_datasets_for_dropdown()
    updateSelectInput(session, "dataset_dropdown", choices = choices)
    updateSelectInput(session, "train_dataset_select", choices = choices)
  })
  
  # Triggered by selecting a row in datasets table
  observeEvent(input$datasets_table_rows_selected, {
    row_idx <- input$datasets_table_rows_selected
    if (is.null(row_idx) || length(row_idx) == 0) return()
    
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
        
        output$datacard_markdown <- renderUI({
          md_text <- result$data_card_markdown
          if (is.null(md_text) || md_text == "") {
            return(tags$p("No data card content returned."))
          }
          html_text <- tryCatch({
            commonmark::markdown_html(md_text, extensions = TRUE)
          }, error = function(e) {
            paste0("<pre>", md_text, "</pre>")
          })
          div(class = "markdown-card-container", HTML(html_text))
        })
        
        # Render Class Distribution as a barplot (same style as architecture distribution)
        output$datacard_distribution_plot <- renderPlot({
          dist <- result$class_distribution
          if (is.null(dist) || length(dist) == 0) {
            plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
            text(0.5, 0.5, "No class distribution data available.", col="#86868b", font=2, cex=1.2)
            return()
          }
          
          class_names <- names(dist)
          counts <- as.numeric(unlist(dist))
          names(counts) <- class_names
          counts <- sort(counts)
          
          par(mar = c(5, 12, 3, 2), bg = "white")
          barplot(counts, horiz = TRUE, las = 1, col = "#0071e3", border = NA,
                  main = "Class Distribution", col.main = "#1d1d1f",
                  xlab = "Number of Images", col.lab = "#1d1d1f", font.lab = 2,
                  cex.names = 0.9, cex.main = 1.2)
        })

        
        # Store Sample Images for slideshow
        imgs <- result$sample_images
        if (!is.null(imgs) && length(imgs) > 0) {
          sample_images_store(imgs)
          current_image_idx(1)
        } else {
          sample_images_store(list())
          current_image_idx(0)
        }
        
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
  
  observeEvent(input$prev_sample_image, {
    idx <- current_image_idx()
    if (idx > 1) current_image_idx(idx - 1)
  })
  
  observeEvent(input$next_sample_image, {
    idx <- current_image_idx()
    imgs <- sample_images_store()
    if (idx < length(imgs)) current_image_idx(idx + 1)
  })
  
  output$sample_image_counter <- renderText({
    imgs <- sample_images_store()
    idx <- current_image_idx()
    if (length(imgs) == 0) return("0 / 0")
    return(paste(idx, "/", length(imgs)))
  })
  
  output$datacard_sample_images <- renderUI({
    imgs <- sample_images_store()
    idx <- current_image_idx()
    
    if (length(imgs) == 0 || idx == 0) {
      return(tags$p("No sample images available.", style = "color: #999;"))
    }
    
    img <- imgs[[idx]]
    tags$div(
      class = "col-md-12",
      style = "margin-bottom: 30px;",
      tags$div(
        style = "border: 1px solid #ddd; border-radius: 6px; padding: 15px; text-align: center; background: #fafafa;",
        tags$img(
          src = paste0("data:image/jpeg;base64,", img$image_base64),
          style = "max-width: 100%; max-height: 80vh; height: auto; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"
        ),
        tags$h3(img$class_name, style = "margin-top: 20px; color: #222; font-weight: bold;")
      )
    )
  })

  # --- Train Model Tab (Create ML style UI logic) ---
  
  # Reactive timer for polling job progress (every 2 seconds)
  poll_timer <- reactiveTimer(2000)
  polling_job_id <- reactiveVal(NULL)
  selected_job_data <- reactiveVal(NULL)
  
  # Helper to update train dropdown choices
  update_train_dropdowns <- function() {
    choices_jobs <- get_jobs_for_dropdown()
    updateSelectInput(session, "train_selected_job", choices = choices_jobs)
    
    choices_datasets <- get_datasets_for_dropdown()
    updateSelectInput(session, "train_dataset_select", choices = choices_datasets)
  }
  
  # Update form when selected job changes
  observeEvent(input$train_selected_job, {
    job_id <- input$train_selected_job
    req(job_id)
    if (job_id == "") return()
    
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", job_id))
      if (response$status == 200) {
        job <- fromJSON(response$content, simplifyVector = FALSE)
        selected_job_data(job)
        
        cfg <- job$pipeline_config
        if (!is.null(cfg)) {
          # Update parameters UI
          updateSelectInput(session, "train_arch_select", selected = cfg$architecture)
          updateNumericInput(session, "train_epochs_input", value = cfg$epochs)
          updateNumericInput(session, "train_batch_size_input", value = cfg$batch_size)
          updateNumericInput(session, "train_lr_input", value = cfg$learning_rate)
          
          img_size_str <- paste(cfg$image_size, collapse = ", ")
          updateTextInput(session, "train_img_size_input", value = img_size_str)
          
          updateCheckboxInput(session, "train_augmentation_checkbox", value = cfg$augmentation_enabled %||% TRUE)
          updateCheckboxInput(session, "train_early_stopping_checkbox", value = cfg$early_stopping %||% TRUE)
          
          # Selected dataset
          if (!is.null(job$linked_dataset_id) && job$linked_dataset_id != "") {
            updateSelectInput(session, "train_dataset_select", selected = job$linked_dataset_id)
          }
        }
        
        # Enable polling if active
        if (job$status == "running" || job$status == "training") {
          polling_job_id(job_id)
        } else {
          polling_job_id(NULL)
        }
      }
    }, error = function(e) {
      cat("Error loading job details in Train tab:", e$message, "\n")
    })
  })
  
  # Update dataset info when selected dataset changes
  observeEvent(input$train_dataset_select, {
    dataset_id <- input$train_dataset_select
    req(dataset_id)
    if (dataset_id == "") {
      output$train_dataset_classes_text <- renderText("N/A")
      output$train_dataset_items_text <- renderText("Select a dataset first")
      return()
    }
    
    df <- datasets_df_store()
    if (!is.null(df) && nrow(df) > 0) {
      row_idx <- which(df$ID == dataset_id)
      if (length(row_idx) > 0) {
        num_classes <- df$Classes[row_idx[1]]
        num_items <- df$Items[row_idx[1]]
        task_type <- df$Task_Type[row_idx[1]]
        
        output$train_dataset_classes_text <- renderText(as.character(num_classes))
        output$train_dataset_items_text <- renderText(paste(num_items, "items (", task_type, ")"))
        return()
      }
    }
    
    output$train_dataset_classes_text <- renderText("...")
    output$train_dataset_items_text <- renderText("Loading info...")
  })
  
  # Refresh button
  observeEvent(input$refresh_train_jobs, {
    update_train_dropdowns()
    df <- list_available_datasets()
    datasets_df_store(df)
  })
  
  # "New Pipeline" button modal
  observeEvent(input$train_create_new_btn, {
    showModal(modalDialog(
      title = "Create New Pipeline",
      easyClose = TRUE,
      footer = tagList(
        modalButton("Cancel"),
        actionButton("train_modal_create_submit", "Create", class = "btn-primary")
      ),
      fluidRow(
        column(12,
          textInput("train_modal_name", "Pipeline Name", value = "My Image Classifier"),
          selectInput("train_modal_task", "Task Type", 
                     choices = list("Image Classification" = "image_classification",
                                  "Object Detection" = "object_detection"),
                     selected = "image_classification"),
          selectInput("train_modal_arch", "Model Architecture",
                     choices = list("ResNet-18" = "resnet18",
                                  "ResNet-50" = "resnet50",
                                  "VGG-16" = "vgg16",
                                  "MobileNet" = "mobilenet",
                                  "EfficientNet" = "efficientnet"),
                     selected = "resnet18"),
          numericInput("train_modal_classes", "Number of Classes", value = 2, min = 2, max = 1000)
        )
      )
    ))
  })
  
  observeEvent(input$train_modal_task, {
    if (input$train_modal_task == "image_classification") {
      updateSelectInput(session, "train_modal_arch",
                       choices = list("ResNet-18" = "resnet18",
                                    "ResNet-50" = "resnet50",
                                    "VGG-16" = "vgg16",
                                    "MobileNet" = "mobilenet",
                                    "EfficientNet" = "efficientnet"),
                       selected = "resnet18")
    } else {
      updateSelectInput(session, "train_modal_arch",
                       choices = list("Faster R-CNN" = "faster_rcnn"),
                       selected = "faster_rcnn")
    }
  })
  
  observeEvent(input$train_modal_create_submit, {
    removeModal()
    showNotification("Creating pipeline...", type = "message")
    
    job_id <- create_pipeline_and_get_id(
      input$train_modal_name,
      input$train_modal_task,
      input$train_modal_arch,
      input$train_modal_classes,
      8, 5, 0.001, "224, 224", TRUE, TRUE
    )
    
    if (!is.null(job_id)) {
      showNotification(paste("Pipeline created! Job ID:", job_id), type = "message")
      choices_jobs <- get_jobs_for_dropdown()
      updateSelectInput(session, "train_selected_job", choices = choices_jobs, selected = job_id)
      
      updateSelectInput(session, "pending_job_dropdown", choices = get_jobs_for_dropdown("pending"))
      updateSelectInput(session, "trainable_job_dropdown", choices = get_jobs_for_dropdown("trainable"))
      updateSelectInput(session, "delete_job_dropdown", choices = get_jobs_for_dropdown())
    } else {
      showNotification("Failed to create pipeline.", type = "error")
    }
  })
  
  # "Upload Dataset" link modal
  observeEvent(input$train_upload_dataset_link, {
    showModal(modalDialog(
      title = "Upload Dataset (.zip)",
      easyClose = TRUE,
      footer = tagList(
        modalButton("Cancel"),
        actionButton("train_modal_upload_submit", "Upload", class = "btn-primary")
      ),
      fluidRow(
        column(12,
          textInput("train_upload_name", "Dataset Name", value = "my_dataset"),
          selectInput("train_upload_task", "Task Type",
                      choices = list("Image Classification" = "image_classification",
                                   "Object Detection" = "object_detection"),
                      selected = "image_classification"),
          fileInput("train_upload_file", "Select ZIP file", accept = ".zip")
        )
      )
    ))
  })
  
  observeEvent(input$train_modal_upload_submit, {
    job_id <- input$train_selected_job
    if (is.null(job_id) || job_id == "") {
      showNotification("Please select a pipeline first.", type = "error")
      return()
    }
    
    file_info <- input$train_upload_file
    if (is.null(file_info)) {
      showNotification("Please select a ZIP file first.", type = "error")
      return()
    }
    
    removeModal()
    showNotification("Uploading dataset... This may take several minutes.", type = "message", duration = 30)
    
    file_path <- file_info$datapath
    file_name <- file_info$name
    
    tryCatch({
      task_type <- input$train_upload_task
      dataset_name <- input$train_upload_name %||% "dataset"
      dataset_name_param <- paste0("&dataset_name=", URLencode(dataset_name))
      
      if (task_type == "object_detection") {
        upload_url <- paste0(API_URL, "/upload-detection-dataset/", job_id, "?task_type=", task_type, dataset_name_param)
      } else {
        upload_url <- paste0(API_URL, "/upload-dataset/", job_id, "?task_type=", task_type, dataset_name_param)
      }
      
      if (task_type == "object_detection") {
        response <- POST(
          upload_url,
          body = list(file = upload_file(file_path, type = "application/zip")),
          encode = "multipart",
          timeout(300)
        )
      } else {
        response <- POST(
          upload_url,
          body = list(
            file = upload_file(file_path, type = "application/zip"),
            file_type = "zip"
          ),
          encode = "multipart",
          timeout(300)
        )
      }
      
      if (status_code(response) == 200) {
        link_res <- link_dataset_to_job(job_id, job_id)
        showNotification("Dataset uploaded and linked successfully!", type = "message")
        
        df <- list_available_datasets()
        datasets_df_store(df)
        update_train_dropdowns()
        updateSelectInput(session, "train_selected_job", selected = job_id)
        updateSelectInput(session, "train_dataset_select", selected = job_id)
      } else {
        error_content <- content(response, "text")
        showNotification(paste("Upload failed:", status_code(response), "-", error_content), type = "error")
      }
    }, error = function(e) {
      showNotification(paste("Upload error:", e$message), type = "error")
    })
  })
  
  # Helper to create pipeline and return ID
  create_pipeline_and_get_id <- function(name, task_type, architecture, num_classes, batch_size, epochs, learning_rate, image_size_input, augmentation_enabled, early_stopping) {
    tryCatch({
      num_classes_int <- if(is.null(num_classes) || is.na(num_classes) || num_classes == "") 2 else as.integer(num_classes)
      batch_size_int <- if(is.null(batch_size) || is.na(batch_size) || batch_size == "") 8 else as.integer(batch_size)
      epochs_int <- if(is.null(epochs) || is.na(epochs) || epochs == "") 5 else as.integer(epochs)
      learning_rate_num <- if(is.null(learning_rate) || is.na(learning_rate) || learning_rate == "") 0.001 else as.numeric(learning_rate)
      
      image_size_parts <- strsplit(gsub(" ", "", image_size_input), ",")[[1]]
      image_size <- as.numeric(image_size_parts)
      if(any(is.na(image_size)) || length(image_size) != 2) {
        image_size <- c(224, 224)
      }
      
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
      
      json_body <- toJSON(pipeline_config, auto_unbox = TRUE)
      response <- make_request(paste0(API_URL, "/pipelines"), method = "POST", body = json_body)
      
      if (response$status == 200) {
        job <- fromJSON(response$content)
        return(job$id %||% job$job_id %||% job$pipeline_id)
      }
    }, error = function(e) {
      cat("Error in create_pipeline_and_get_id:", e$message, "\n")
    })
    return(NULL)
  }
  
  # "Save Parameters" button
  observeEvent(input$train_save_params_btn, {
    job_id <- input$train_selected_job
    req(job_id)
    if (job_id == "") return()
    
    job <- selected_job_data()
    req(job)
    cfg <- job$pipeline_config
    
    arch <- input$train_arch_select
    epochs <- input$train_epochs_input
    batch_size <- input$train_batch_size_input
    lr <- input$train_lr_input
    img_size <- input$train_img_size_input
    aug <- input$train_augmentation_checkbox
    es <- input$train_early_stopping_checkbox
    
    changed <- FALSE
    if (arch != cfg$architecture) changed <- TRUE
    if (epochs != cfg$epochs) changed <- TRUE
    if (batch_size != cfg$batch_size) changed <- TRUE
    if (lr != cfg$learning_rate) changed <- TRUE
    if (aug != (cfg$augmentation_enabled %||% TRUE)) changed <- TRUE
    if (es != (cfg$early_stopping %||% TRUE)) changed <- TRUE
    
    img_size_str <- paste(cfg$image_size, collapse = ", ")
    if (img_size != img_size_str) changed <- TRUE
    
    if (changed) {
      showNotification("Creating new pipeline configuration with updated parameters...", type = "message")
      task_type <- if (arch == "faster_rcnn") "object_detection" else "image_classification"
      num_classes <- cfg$num_classes
      
      new_job_id <- create_pipeline_and_get_id(
        name = paste0(cfg$name, " (Custom Settings)"),
        task_type = task_type,
        architecture = arch,
        num_classes = num_classes,
        batch_size = batch_size,
        epochs = epochs,
        learning_rate = lr,
        image_size_input = img_size,
        augmentation_enabled = aug,
        early_stopping = es
      )
      
      if (!is.null(new_job_id)) {
        showNotification(paste("New pipeline configuration created:", new_job_id), type = "message")
        
        # Link dataset if selected
        dataset_id <- input$train_dataset_select
        if (!is.null(dataset_id) && dataset_id != "") {
          link_dataset_to_job(new_job_id, dataset_id)
        }
        
        choices_jobs <- get_jobs_for_dropdown()
        updateSelectInput(session, "train_selected_job", choices = choices_jobs, selected = new_job_id)
      } else {
        showNotification("Failed to save updated parameters.", type = "error")
      }
    } else {
      showNotification("Parameters already match pipeline configuration.", type = "message")
    }
  })
  
  # "Train" play button action
  observeEvent(input$train_play_btn, {
    job_id <- input$train_selected_job
    dataset_id <- input$train_dataset_select
    
    if (is.null(job_id) || job_id == "") {
      showNotification("Please select a pipeline first.", type = "error")
      return()
    }
    if (is.null(dataset_id) || dataset_id == "") {
      showNotification("Please select a dataset to link and train.", type = "error")
      return()
    }
    
    job <- selected_job_data()
    req(job)
    cfg <- job$pipeline_config
    
    arch <- input$train_arch_select
    epochs <- input$train_epochs_input
    batch_size <- input$train_batch_size_input
    lr <- input$train_lr_input
    img_size <- input$train_img_size_input
    aug <- input$train_augmentation_checkbox
    es <- input$train_early_stopping_checkbox
    
    changed <- FALSE
    if (arch != cfg$architecture) changed <- TRUE
    if (epochs != cfg$epochs) changed <- TRUE
    if (batch_size != cfg$batch_size) changed <- TRUE
    if (lr != cfg$learning_rate) changed <- TRUE
    if (aug != (cfg$augmentation_enabled %||% TRUE)) changed <- TRUE
    if (es != (cfg$early_stopping %||% TRUE)) changed <- TRUE
    img_size_str <- paste(cfg$image_size, collapse = ", ")
    if (img_size != img_size_str) changed <- TRUE
    
    target_job_id <- job_id
    
    if (changed) {
      showNotification("Creating new pipeline configuration with updated parameters...", type = "message")
      task_type <- if (arch == "faster_rcnn") "object_detection" else "image_classification"
      num_classes <- cfg$num_classes
      
      new_job_id <- create_pipeline_and_get_id(
        name = paste0(cfg$name, " (Custom Settings)"),
        task_type = task_type,
        architecture = arch,
        num_classes = num_classes,
        batch_size = batch_size,
        epochs = epochs,
        learning_rate = lr,
        image_size_input = img_size,
        augmentation_enabled = aug,
        early_stopping = es
      )
      
      if (!is.null(new_job_id)) {
        target_job_id <- new_job_id
      }
    }
    
    showNotification("Linking dataset to job...", type = "message")
    link_dataset_to_job(target_job_id, dataset_id)
    
    showNotification("Starting training...", type = "message")
    train_res <- start_training(target_job_id)
    
    # Query backend immediately to get the updated running job state and set it to selected_job_data
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", target_job_id))
      if (response$status == 200) {
        job <- fromJSON(response$content, simplifyVector = FALSE)
        selected_job_data(job)
      }
    }, error = function(e) {})
    
    polling_job_id(target_job_id)
    
    choices_jobs <- get_jobs_for_dropdown()
    updateSelectInput(session, "train_selected_job", choices = choices_jobs, selected = target_job_id)
  })
  
  # Play button rendering
  output$train_play_button_ui <- renderUI({
    job <- selected_job_data()
    is_running <- FALSE
    if (!is.null(job)) {
      if (job$status == "running" || job$status == "training") {
        is_running <- TRUE
      }
    }
    
    if (is_running) {
      tags$button(
        id = "train_play_btn",
        class = "createml-play-btn btn btn-default",
        disabled = "disabled",
        tags$i(class = "fa fa-spinner fa-spin")
      )
    } else {
      tags$button(
        id = "train_play_btn",
        class = "createml-play-btn btn btn-default action-button",
        tags$i(class = "fa fa-play")
      )
    }
  })
  
  # Polling observer
  observe({
    job_id <- polling_job_id()
    req(job_id)
    poll_timer() # Dependency
    
    isolate({
      tryCatch({
        response <- make_request(paste0(API_URL, "/pipelines/", job_id))
        if (response$status == 200) {
          job <- fromJSON(response$content, simplifyVector = FALSE)
          selected_job_data(job)
          
          if (job$status != "running" && job$status != "training") {
            polling_job_id(NULL)
            showNotification(paste("Training job", job_id, "has", job$status), type = if(job$status == "completed") "message" else "error")
            
            choices <- get_jobs_for_dropdown()
            updateSelectInput(session, "train_selected_job", choices = choices, selected = job_id)
            updateSelectInput(session, "eval_job_dropdown", choices = get_jobs_for_dropdown("completed"))
            updateSelectInput(session, "predict_job_dropdown", choices = get_jobs_for_dropdown("completed"))
            output$dashboard_jobs_table <- DT::renderDataTable(format_jobs_for_dt(list_all_jobs()), escape = FALSE, options = list(scrollX = TRUE))
          }
        }
      }, error = function(e) {
        cat("Error polling job progress:", e$message, "\n")
      })
    })
  })
  
  # Show progress section condition
  output$train_show_progress_section <- reactive({
    job <- selected_job_data()
    !is.null(job) && (job$status == "running" || job$status == "training" || job$status == "completed" || job$status == "failed")
  })
  outputOptions(output, "train_show_progress_section", suspendWhenHidden = FALSE)
  
  output$train_progress_box_title_ui <- renderUI({
    job <- selected_job_data()
    if (is.null(job)) return(tags$span("Training Status"))
    
    status <- tolower(job$status)
    badge_class <- "status-badge-pending"
    if (status == "completed" || status == "success") {
      badge_class <- "status-badge-completed"
    } else if (status == "failed" || status == "error") {
      badge_class <- "status-badge-failed"
    } else if (status == "running" || status == "training") {
      badge_class <- "status-badge-training"
    }
    
    tagList(
      "Training Progress: ",
      span(class = paste("status-badge", badge_class), style = "margin-left: 10px;", toupper(job$status))
    )
  })
  
  output$train_logs_display <- renderText({
    job <- selected_job_data()
    if (is.null(job) || is.null(job$logs)) return("No logs available.")
    paste(job$logs, collapse = "\n")
  })
  
  output$train_model_card_display_unified <- renderUI({
    job <- selected_job_data()
    if (is.null(job)) return(tags$p("No model card available."))
    if (job$status != "completed") return(tags$p("Model card will be generated after successful training."))
    
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", job$id, "/model-card"), method = "GET")
      if (response$status == 200) {
        result <- fromJSON(response$content)
        md_text <- result$model_card_markdown
        html_text <- tryCatch({
          commonmark::markdown_html(md_text, extensions = TRUE)
        }, error = function(e) {
          paste0("<pre>", md_text, "</pre>")
        })
        div(class = "markdown-card-container", HTML(html_text))
      } else {
        tags$p("Model card generation in progress or not available.")
      }
    }, error = function(e) {
      tags$p(paste("Error fetching model card:", e$message))
    })
  })
  
  # Base R curves plotting
  output$train_curves_plot <- renderPlot({
    job <- selected_job_data()
    if (is.null(job)) return(NULL)
    
    history <- job$history
    if (is.null(history) || length(history) == 0) {
      plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
      text(0.5, 0.5, "No training history metrics available yet.\nStart training to view real-time curves.", col="#86868b", font=2, cex=1.2)
      return()
    }
    
    epochs <- sapply(history, function(h) {
      val <- h$epoch
      if (is.null(val)) val <- h$iter
      if (is.null(val)) val <- 1
      as.numeric(val)
    })
    
    # Enforce non-degenerate x range limits based on current epochs and pipeline config limits
    max_epochs_limit <- 2
    if (!is.null(job$pipeline_config) && !is.null(job$pipeline_config$epochs)) {
      max_epochs_limit <- max(max_epochs_limit, as.numeric(job$pipeline_config$epochs), na.rm = TRUE)
    }
    max_epoch_val <- max(c(epochs, max_epochs_limit), na.rm = TRUE)
    xlim_val <- c(1, max_epoch_val)
    
    # Generate clean x axis ticks
    x_ticks <- seq(1, max_epoch_val, by = max(1, floor(max_epoch_val / 10)))
    if (! (max_epoch_val %in% x_ticks)) {
      x_ticks <- c(x_ticks, max_epoch_val)
    }
    x_ticks <- unique(x_ticks)
    
    metric_type <- input$train_curve_metric_select %||% "accuracy"
    par(mar = c(5, 5, 4, 2) + 0.1, bg = "white")
    
    if (metric_type == "accuracy") {
      train_acc <- sapply(history, function(h) {
        val <- h$train_acc
        if (is.null(val)) val <- h$accuracy
        if (is.null(val)) val <- h$train_accuracy
        if (is.null(val)) val <- h$acc
        if (is.null(val)) val <- 0
        val <- as.numeric(val)
        if (val > 1) val <- val / 100
        val
      })
      val_acc <- sapply(history, function(h) {
        val <- h$val_acc
        if (is.null(val)) val <- h$val_accuracy
        if (is.null(val)) val <- 0
        val <- as.numeric(val)
        if (val > 1) val <- val / 100
        val
      })
      
      plot(epochs, train_acc, type = "o", col = "#0071e3", lwd = 3, pch = 16,
           xlab = "Epoch", ylab = "Accuracy", ylim = c(0, 1), xlim = xlim_val,
           main = "Training & Validation Accuracy",
           col.main = "#1d1d1f", col.lab = "#1d1d1f", font.lab = 2,
           cex.main = 1.4, cex.lab = 1.1, axes = FALSE)
      
      grid(nx = NULL, ny = NULL, col = "#d2d2d7", lty = "dotted", lwd = 1)
      axis(1, at = x_ticks, col = "#d2d2d7", col.axis = "#86868b")
      axis(2, at = seq(0, 1, by = 0.1), labels = paste0(seq(0, 100, by = 10), "%"), col = "#d2d2d7", col.axis = "#86868b")
      
      if (any(val_acc > 0)) {
        lines(epochs, val_acc, type = "o", col = "#ff9500", lwd = 3, pch = 17)
        legend("bottomright", legend = c("Training", "Validation"),
               col = c("#0071e3", "#ff9500"), lty = 1, lwd = 3, pch = c(16, 17),
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      } else {
        legend("bottomright", legend = c("Training"),
               col = c("#0071e3"), lty = 1, lwd = 3, pch = 16,
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      }
    } else {
      train_loss <- sapply(history, function(h) {
        val <- h$train_loss
        if (is.null(val)) val <- h$loss
        if (is.null(val)) val <- 0
        as.numeric(val)
      })
      val_loss <- sapply(history, function(h) {
        val <- h$val_loss
        if (is.null(val)) val <- 0
        as.numeric(val)
      })
      
      max_loss <- max(c(train_loss, val_loss), na.rm = TRUE)
      if (max_loss == 0) max_loss <- 1
      ylim_val <- c(0, max_loss * 1.1)
      
      plot(epochs, train_loss, type = "o", col = "#ff3b30", lwd = 3, pch = 16,
           xlab = "Epoch", ylab = "Loss", ylim = ylim_val, xlim = xlim_val,
           main = "Training & Validation Loss",
           col.main = "#1d1d1f", col.lab = "#1d1d1f", font.lab = 2,
           cex.main = 1.4, cex.lab = 1.1, axes = FALSE)
      
      grid(nx = NULL, ny = NULL, col = "#d2d2d7", lty = "dotted", lwd = 1)
      axis(1, at = x_ticks, col = "#d2d2d7", col.axis = "#86868b")
      axis(2, col = "#d2d2d7", col.axis = "#86868b")
      
      if (any(val_loss > 0)) {
        lines(epochs, val_loss, type = "o", col = "#89898f", lwd = 3, pch = 17)
        legend("topright", legend = c("Training", "Validation"),
               col = c("#ff3b30", "#89898f"), lty = 1, lwd = 3, pch = c(16, 17),
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      } else {
        legend("topright", legend = c("Training"),
               col = c("#ff3b30"), lty = 1, lwd = 3, pch = 16,
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      }
    }
  })
  
  # --- Model Evaluation Tab Functions ---
  
  output$eval_data_available <- reactive({
    !is.null(eval_data())
  })
  outputOptions(output, "eval_data_available", suspendWhenHidden = FALSE)
  
  observeEvent(input$refresh_eval_models, {
    choices <- get_jobs_for_dropdown("completed")
    updateSelectInput(session, "eval_job_dropdown", choices = choices)
  })
  
  observeEvent(input$run_evaluation, {
    if (is.null(input$eval_job_dropdown) || input$eval_job_dropdown == "") {
      showNotification("Please select a trained model first.", type = "error")
      return()
    }
    
    showModal(modalDialog(
      title = "Evaluating Model",
      "Running predictions and calculating performance metrics on test/validation set... Please wait.",
      footer = NULL,
      easyClose = FALSE
    ))
    
    tryCatch({
      url <- paste0(API_URL, "/pipelines/", input$eval_job_dropdown, "/evaluate")
      response <- GET(url)
      
      if (status_code(response) == 200) {
        result <- content(response, "parsed")
        eval_data(result)
        
        # Update label/prediction filters dropdowns
        classes <- sapply(result$class_metrics, function(c) c$class_name)
        updateSelectInput(session, "explore_label_filter", choices = c("Any" = "any", classes), selected = "any")
        updateSelectInput(session, "explore_pred_filter", choices = c("Any" = "any", classes), selected = "any")
        
        showNotification("Evaluation completed successfully!", type = "message")
      } else {
        error_msg <- content(response, "text")
        showNotification(paste("Evaluation failed:", error_msg), type = "error")
      }
    }, error = function(e) {
      showNotification(paste("Error calling evaluation endpoint:", e$message), type = "error")
    })
    
    removeModal()
  })
  
  # KPI Clicking Navigation helpers
  observeEvent(input$click_correct, {
    data <- eval_data()
    if (!is.null(data) && data$task_type == "object_detection") return()
    
    updateTabsetPanel(session, "eval_pills", selected = "Explore")
    updateSelectInput(session, "explore_result_filter", selected = "correct")
  })
  
  observeEvent(input$click_incorrect, {
    data <- eval_data()
    if (!is.null(data) && data$task_type == "object_detection") return()
    
    updateTabsetPanel(session, "eval_pills", selected = "Explore")
    updateSelectInput(session, "explore_result_filter", selected = "incorrect")
  })
  
  # Dynamic evaluation properties
  output$eval_is_classification <- reactive({
    data <- eval_data()
    !is.null(data) && data$task_type == "image_classification"
  })
  outputOptions(output, "eval_is_classification", suspendWhenHidden = FALSE)
  
  output$eval_card1_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Test Accuracy")
    if (data$task_type == "object_detection") "mAP" else "Test Accuracy"
  })
  output$eval_card2_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Correct")
    if (data$task_type == "object_detection") "AP50" else "Correct"
  })
  output$eval_card3_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Incorrect")
    if (data$task_type == "object_detection") "AP75" else "Incorrect"
  })
  output$eval_card4_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Top Confusion")
    if (data$task_type == "object_detection") "Top Class" else "Top Confusion"
  })
  output$eval_card5_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Lowest Precision")
    if (data$task_type == "object_detection") "Target Objects" else "Lowest Precision"
  })
  output$eval_card6_title <- renderText({
    data <- eval_data()
    if (is.null(data)) return("Lowest Recall")
    if (data$task_type == "object_detection") "Detected Objects" else "Lowest Recall"
  })
  
  output$eval_summary_title <- renderUI({
    data <- eval_data()
    if (is.null(data)) return("Test")
    
    if (data$task_type == "object_detection") {
      total_items <- length(data$samples)
      num_classes <- length(data$class_metrics)
      date_str <- format(Sys.time(), "%b %d, %Y at %I:%M %p")
      HTML(paste0(
        "<b>Test</b> <span style='font-size: 14px; font-weight: normal; color: #888;'>&#9432;</span><br>",
        "<span style='font-size: 12px; font-weight: normal; color: #666;'>", date_str, "</span><br>",
        "<span style='font-size: 13px; font-weight: normal; color: #333;'>", num_classes, " classes with ", total_items, " test images</span>"
      ))
    } else {
      total_items <- data$correct_count + data$incorrect_count
      num_classes <- length(data$class_metrics)
      date_str <- format(Sys.time(), "%b %d, %Y at %I:%M %p")
      HTML(paste0(
        "<b>Test</b> <span style='font-size: 14px; font-weight: normal; color: #888;'>&#9432;</span><br>",
        "<span style='font-size: 12px; font-weight: normal; color: #666;'>", date_str, "</span><br>",
        "<span style='font-size: 13px; font-weight: normal; color: #333;'>", num_classes, " classes with ", total_items, " items</span>"
      ))
    }
  })
  
  output$eval_accuracy_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0%")
    paste0(round(data$accuracy * 100), "%")
  })
  
  output$eval_correct_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0")
    if (data$task_type == "object_detection") {
      paste0(data$correct_count, "%")
    } else {
      as.character(data$correct_count)
    }
  })
  
  output$eval_incorrect_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("0")
    if (data$task_type == "object_detection") {
      paste0(data$incorrect_count, "%")
    } else {
      as.character(data$incorrect_count)
    }
  })
  
  output$eval_top_confusion_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$top_confusion
  })
  
  output$eval_lowest_precision_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$lowest_precision_class
  })
  
  output$eval_lowest_recall_val <- renderText({
    data <- eval_data()
    if (is.null(data)) return("None")
    data$lowest_recall_class
  })
  
  output$eval_metrics_table <- DT::renderDataTable({
    data <- eval_data()
    if (is.null(data) || is.null(data$class_metrics)) return(NULL)
    
    metrics_list <- data$class_metrics
    is_det <- (data$task_type == "object_detection")
    
    if (is_det) {
      df <- data.frame(
        Class = sapply(metrics_list, function(x) x$class_name),
        `Target Objects` = sapply(metrics_list, function(x) x$count),
        `Detected Objects` = sapply(metrics_list, function(x) x$correct),
        `Average Precision` = sapply(metrics_list, function(x) paste0(round(x$precision * 100), "%")),
        check.names = FALSE,
        stringsAsFactors = FALSE
      )
      cols_to_keep <- colnames(df)
      df[, cols_to_keep, drop = FALSE]
    } else {
      df <- data.frame(
        Class = sapply(metrics_list, function(x) x$class_name),
        Count = sapply(metrics_list, function(x) x$count),
        Correct = sapply(metrics_list, function(x) x$correct),
        Precision = sapply(metrics_list, function(x) paste0(round(x$precision * 100), "%")),
        Recall = sapply(metrics_list, function(x) paste0(round(x$recall * 100), "%")),
        F1_Score = sapply(metrics_list, function(x) round(x$f1_score, 2)),
        stringsAsFactors = FALSE
      )
      
      colnames(df) <- c("Class", "Count", "Correct", "Precision", "Recall", "F1 Score")
      
      cols_to_keep <- c("Class")
      selected_cols <- input$eval_table_cols
      
      if ("count" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Count")
      if ("correct" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Correct")
      if ("precision" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Precision")
      if ("recall" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "Recall")
      if ("f1_score" %in% selected_cols) cols_to_keep <- c(cols_to_keep, "F1 Score")
      
      df[, cols_to_keep, drop = FALSE]
    }
  }, options = list(pageLength = 10, scrollX = TRUE))
  
  # Modal view state & reactive variables
  modal_image_idx <- reactiveVal(1)
  
  filtered_samples_reactive <- reactive({
    data <- eval_data()
    if (is.null(data)) return(list())
    
    samples <- data$samples
    res_f <- input$explore_result_filter
    lbl_f <- input$explore_label_filter
    pred_f <- input$explore_pred_filter
    is_det <- (data$task_type == "object_detection")
    
    filtered_samples <- list()
    for (s in samples) {
      if (!is_det) {
        if (res_f == "correct" && !s$correct) next
        if (res_f == "incorrect" && s$correct) next
        if (lbl_f != "any" && s$true_label != lbl_f) next
        if (pred_f != "any" && s$predicted_label != pred_f) next
      } else {
        # Detection specific filters
        if (lbl_f != "any") {
          gt_val <- s$true_label
          if (!is.null(s$true_label_summary)) {
            if (!grepl(lbl_f, s$true_label_summary, fixed = TRUE)) next
          } else if (gt_val != lbl_f) {
            next
          }
        }
        if (pred_f != "any") {
          if (!is.null(s$predicted_label_summary)) {
            if (!grepl(pred_f, s$predicted_label_summary, fixed = TRUE)) next
          } else if (s$predicted_label != pred_f) {
            next
          }
        }
      }
      filtered_samples[[length(filtered_samples) + 1]] <- s
    }
    filtered_samples
  })
  
  output$explore_summary_text <- renderText({
    data <- eval_data()
    if (is.null(data)) return("")
    
    filtered <- filtered_samples_reactive()
    count <- length(filtered)
    res_f <- input$explore_result_filter
    pred_f <- input$explore_pred_filter
    is_det <- (data$task_type == "object_detection")
    
    if (is_det) {
      return(paste(count, "test images in total"))
    }
    
    if (res_f == "incorrect") {
      if (pred_f != "any") {
        return(paste(count, "images were incorrectly classified as", paste0("'", pred_f, "'")))
      } else {
        return(paste(count, "images were incorrectly classified"))
      }
    } else if (res_f == "correct") {
      return(paste(count, "images were correctly classified"))
    } else {
      return(paste(count, "images in total"))
    }
  })
  
  output$explore_grid_display <- renderUI({
    data <- eval_data()
    if (is.null(data)) return(NULL)
    
    filtered <- filtered_samples_reactive()
    if (length(filtered) == 0) {
      return(div(style = "text-align: center; padding: 40px; color: #888;", "No images match the current filters."))
    }
    
    is_det <- (!is.null(data$task_type) && data$task_type == "object_detection")
    
    cards <- lapply(filtered, function(s) {
      if (is_det) {
        card_content <- div(class = "eval-det-summary",
          style = "font-size: 13px; color: #555; margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;",
          div(style = "display: flex; justify-content: space-between; margin-bottom: 4px; align-items: center;",
            span("Status:"),
            span(
              class = if (s$correct) "label label-success" else "label label-danger",
              style = if (s$correct) "background-color: #2ca02c; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 11px;" 
                      else "background-color: #d62728; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 11px;",
              if (s$correct) "Correct" else "Incorrect"
            )
          ),
          div(style = "display: flex; justify-content: space-between; margin-bottom: 4px;",
            span("Ground Truth:"),
            span(style = "font-weight: bold; color: #d62728;", if (!is.null(s$true_label_summary)) s$true_label_summary else s$true_label)
          ),
          div(style = "display: flex; justify-content: space-between;",
            span("Detected:"),
            span(style = "font-weight: bold; color: #2ca02c;", if (!is.null(s$predicted_label_summary)) s$predicted_label_summary else s$predicted_label)
          )
        )
      } else {
        top_preds_html <- lapply(s$top_3_predictions, function(p) {
          is_true_class <- (p$class_name == s$true_label)
          is_pred_class <- (p$class_name == s$predicted_label)
          
          indicator_class <- "eval-indicator-neutral"
          if (s$correct) {
            if (is_true_class) indicator_class <- "eval-indicator-correct"
          } else {
            if (is_true_class) indicator_class <- "eval-indicator-correct"
            if (is_pred_class) indicator_class <- "eval-indicator-incorrect"
          }
          
          div(class = "eval-pred-row",
            span(
              span(class = paste("eval-indicator", indicator_class)),
              p$class_name
            ),
            span(paste0(round(p$confidence), "%"))
          )
        })
        card_content <- top_preds_html
      }
      
      div(class = "eval-card",
        style = "cursor: pointer;",
        onclick = sprintf("Shiny.setInputValue('explore_card_click', '%s', {priority: 'event'})", s$filename),
        div(class = "eval-card-img-container",
          tags$img(src = s$base64_image, alt = s$filename)
        ),
        div(class = "eval-card-content",
          div(class = "eval-card-title", s$filename),
          card_content
        )
      )
    })
    
    div(class = "eval-grid", cards)
  })
  
  # Explore Card Click Observer -> Split Pane modal
  observeEvent(input$explore_card_click, {
    req(input$explore_card_click)
    filename <- input$explore_card_click
    
    filtered <- filtered_samples_reactive()
    filenames <- sapply(filtered, function(s) s$filename)
    idx <- which(filenames == filename)
    
    if (length(idx) > 0) {
      modal_image_idx(idx[1])
      
      showModal(modalDialog(
        title = NULL,
        footer = NULL,
        easyClose = TRUE,
        size = "l",
        fade = TRUE,
        windowClass = "eval-modal-dialog",
        tags$div(
          class = "eval-modal-body",
          # Left Pane
          tags$div(
            class = "eval-modal-left",
            tags$button(
              class = "eval-modal-close-btn",
              HTML("&times;"),
              onclick = "Shiny.setInputValue('close_eval_modal_click', Math.random())"
            ),
            uiOutput("eval_modal_image_ui"),
            actionButton("eval_modal_prev", HTML("&#10094;"), class = "eval-modal-nav-btn eval-modal-prev-btn"),
            actionButton("eval_modal_next", HTML("&#10095;"), class = "eval-modal-nav-btn eval-modal-next-btn"),
            div(class = "eval-modal-counter", textOutput("eval_modal_counter_text"))
          ),
          # Right Pane
          tags$div(
            class = "eval-modal-right",
            uiOutput("eval_modal_details_ui")
          )
        )
      ))
    }
  })
  
  observeEvent(input$close_eval_modal_click, {
    removeModal()
  })
  
  observeEvent(input$eval_modal_prev, {
    idx <- modal_image_idx()
    if (idx > 1) modal_image_idx(idx - 1)
  })
  
  observeEvent(input$eval_modal_next, {
    idx <- modal_image_idx()
    filtered <- filtered_samples_reactive()
    if (idx < length(filtered)) modal_image_idx(idx + 1)
  })
  
  output$eval_modal_counter_text <- renderText({
    idx <- modal_image_idx()
    filtered <- filtered_samples_reactive()
    paste(idx, "/", length(filtered))
  })
  
  output$eval_modal_image_ui <- renderUI({
    filtered <- filtered_samples_reactive()
    idx <- modal_image_idx()
    if (length(filtered) == 0 || idx < 1 || idx > length(filtered)) {
      return(tags$p("No image loaded"))
    }
    s <- filtered[[idx]]
    tags$img(src = s$base64_image, class = "eval-modal-img")
  })
  
  output$eval_modal_details_ui <- renderUI({
    filtered <- filtered_samples_reactive()
    idx <- modal_image_idx()
    if (length(filtered) == 0 || idx < 1 || idx > length(filtered)) {
      return(tags$p("No details available"))
    }
    s <- filtered[[idx]]
    data <- eval_data()
    is_det <- (!is.null(data$task_type) && data$task_type == "object_detection")
    
    if (is_det) {
      status_label <- if (s$correct) {
        span(class = "label label-success", style = "background-color: #34c759; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;", "Correct")
      } else {
        span(class = "label label-danger", style = "background-color: #ff3b30; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;", "Incorrect")
      }
      
      # Handle operator precedence/R operator mapping
      gt_summary <- if (is.null(s$true_label_summary)) s$true_label else s$true_label_summary
      dt_summary <- if (is.null(s$predicted_label_summary)) s$predicted_label else s$predicted_label_summary
      
      tagList(
        h3(s$filename, style = "margin-top: 0; font-weight: 700; color: #1d1d1f;"),
        hr(),
        div(style = "margin-bottom: 15px;",
          span(style = "font-weight: 600; color: #86868b; margin-right: 10px;", "Evaluation:"),
          status_label
        ),
        div(style = "margin-bottom: 15px;",
          h4("Ground Truth Objects", style = "font-weight: 600; color: #1d1d1f; margin-bottom: 5px;"),
          p(gt_summary, style = "font-size: 14px; color: #333; background: #f5f5f7; padding: 10px; border-radius: 6px;")
        ),
        div(style = "margin-bottom: 15px;",
          h4("Detected Objects", style = "font-weight: 600; color: #1d1d1f; margin-bottom: 5px;"),
          p(dt_summary, style = "font-size: 14px; color: #333; background: #f5f5f7; padding: 10px; border-radius: 6px;")
        )
      )
    } else {
      status_label <- if (s$correct) {
        span(class = "label label-success", style = "background-color: #34c759; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;", "Correct")
      } else {
        span(class = "label label-danger", style = "background-color: #ff3b30; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;", "Incorrect")
      }
      
      preds <- s$all_predictions
      if (is.null(preds) || length(preds) == 0) {
        preds <- s$top_3_predictions
      }
      
      confidences <- sapply(preds, function(p) p$confidence)
      preds <- preds[order(-confidences)]
      
      pred_rows <- lapply(preds, function(p) {
        cls <- p$class_name
        conf <- p$confidence
        
        is_true <- (cls == s$true_label)
        is_pred <- (cls == s$predicted_label)
        
        bar_class <- "eval-progress-bar"
        if (s$correct && is_true) {
          bar_class <- "eval-progress-bar eval-progress-bar-correct"
        } else if (!s$correct && is_pred) {
          bar_class <- "eval-progress-bar eval-progress-bar-incorrect"
        } else if (!s$correct && is_true) {
          bar_class <- "eval-progress-bar eval-progress-bar-correct"
        }
        
        label_style <- if (is_true || is_pred) "font-weight: bold; color: #1d1d1f;" else "color: #1d1d1f;"
        
        div(class = "eval-class-row",
          div(class = "eval-class-label", style = label_style, cls),
          div(class = "eval-class-pct", sprintf("%.1f%%", conf)),
          div(class = "eval-progress-container",
            div(class = bar_class, style = sprintf("width: %f%%;", conf))
          )
        )
      })
      
      tagList(
        h3(s$filename, style = "margin-top: 0; font-weight: 700; color: #1d1d1f;"),
        hr(),
        div(style = "margin-bottom: 20px;",
          div(style = "margin-bottom: 8px;",
            span(style = "font-weight: 600; color: #86868b; margin-right: 10px;", "Status:"),
            status_label
          ),
          div(style = "margin-bottom: 8px;",
            span(style = "font-weight: 600; color: #86868b; margin-right: 10px;", "Ground Truth:"),
            span(style = "font-weight: bold; color: #1d1d1f;", s$true_label)
          ),
          div(style = "margin-bottom: 8px;",
            span(style = "font-weight: 600; color: #86868b; margin-right: 10px;", "Prediction:"),
            span(style = "font-weight: bold; color: #1d1d1f;", s$predicted_label)
          )
        ),
        h4("Confidence Scores", style = "font-weight: 600; color: #1d1d1f; margin-bottom: 12px;"),
        div(style = "background: #f5f5f7; padding: 15px; border-radius: 8px;",
          pred_rows
        )
      )
    }
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
    # Reset explanation display and reactive values
    prediction_task_type(NULL)
    prediction_detections(NULL)
    active_explain_box(-1)
    
    output$prediction_explanation_display <- renderUI({ NULL })
    output$prediction_has_explanation <- reactive({ FALSE })
    outputOptions(output, "prediction_has_explanation", suspendWhenHidden = FALSE)
    
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
            confidence_threshold = as.numeric(input$confidence_threshold),
            explain_method = input$explain_method
          ),
          encode = "multipart"
        )
        
        cat("DEBUG: Response status code:", status_code(response), "\n")
        
        if (status_code(response) == 200) {
          result <- content(response, "parsed")
          
          # Save task type and detections for interactive XAI
          task_type <- result$task_type %||% "unknown"
          prediction_task_type(task_type)
          prediction_detections(result$detections)
          
          # Render explanation image if returned from backend
          if (!is.null(result$explanation_image) && result$explanation_image != "") {
            output$prediction_has_explanation <- reactive({ TRUE })
            outputOptions(output, "prediction_has_explanation", suspendWhenHidden = FALSE)
            
            output$prediction_explanation_display <- renderUI({
              tags$img(src = paste0("data:image/png;base64,", result$explanation_image),
                       style = "max-width: 100%; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);")
            })
          }
          
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
  
  # Dynamically update XAI choices and default when a model is selected
  observeEvent(input$predict_job_dropdown, {
    req(input$predict_job_dropdown)
    if (input$predict_job_dropdown == "") return()
    
    tryCatch({
      # Fetch job details to get its task type
      response <- make_request(paste0(API_URL, "/pipelines/", input$predict_job_dropdown))
      if (response$status == 200) {
        job <- fromJSON(response$content, simplifyVector = FALSE)
        task_type <- job$pipeline_config$task_type
        
        if (!is.null(task_type)) {
          if (task_type == "image_classification") {
            # For classification, show LIME and SHAP
            updateSelectInput(session, "explain_method", 
                              label = "Explain Prediction (XAI)",
                              choices = list("None" = "none", "Grad-CAM" = "gradcam", "LIME" = "lime", "SHAP" = "shap"),
                              selected = "gradcam")
          } else {
            # For detection/segmentation, only show Grad-CAM (Feature Activation Map)
            updateSelectInput(session, "explain_method", 
                              label = "Explain Prediction (XAI)",
                              choices = list("None" = "none", "Saliency Map (XAI)" = "gradcam"),
                              selected = "gradcam")
          }
        }
      }
    }, error = function(e) {
      cat("Error fetching task type for XAI dropdown:", e$message, "\n")
    })
  })

  # Dynamic Bounding Box Selector UI
  output$explain_box_selector_ui <- renderUI({
    task_type <- prediction_task_type()
    detections <- prediction_detections()
    
    if (is.null(task_type) || !grepl("object_detection", task_type, ignore.case = TRUE) || is.null(detections) || length(detections) == 0) {
      return(NULL)
    }
    
    choices <- list("Full Image" = -1)
    for (i in seq_along(detections)) {
      det <- detections[[i]]
      label <- paste0("Box ", i, ": ", det$class_name, " (", round(det$confidence, 1), "%)")
      choices[[label]] <- i - 1  # 0-based index for backend
    }
    
    selectInput("explain_box_index", "Select Box to Explain (Interactive XAI)", 
                choices = choices, selected = -1)
  })

  # Observe changes to explain_box_index for interactive explainability
  observeEvent(input$explain_box_index, {
    req(input$explain_box_index)
    req(input$prediction_image)
    req(input$predict_job_dropdown)
    
    if (input$explain_method == "none") return()
    
    box_idx <- as.numeric(input$explain_box_index)
    
    # Avoid duplicate calls
    if (!is.null(active_explain_box()) && active_explain_box() == box_idx) {
      return()
    }
    active_explain_box(box_idx)
    
    file_path <- input$prediction_image$datapath
    predict_url <- paste0(API_URL, "/predict/", input$predict_job_dropdown)
    
    withProgress(message = 'Generating interactive box explanation...', value = 0, {
      tryCatch({
        predict_url_with_params <- paste0(predict_url, 
                                          "?confidence_threshold=", input$confidence_threshold,
                                          "&explain_box_index=", box_idx)
        
        response <- POST(
          predict_url_with_params,
          body = list(
            file = upload_file(file_path, type = "image/jpeg"),
            confidence_threshold = as.numeric(input$confidence_threshold),
            explain_method = input$explain_method,
            explain_box_index = as.integer(box_idx)
          ),
          encode = "multipart"
        )
        
        if (status_code(response) == 200) {
          result <- content(response, "parsed")
          if (!is.null(result$explanation_image) && result$explanation_image != "") {
            output$prediction_has_explanation <- reactive({ TRUE })
            outputOptions(output, "prediction_has_explanation", suspendWhenHidden = FALSE)
            
            output$prediction_explanation_display <- renderUI({
              tags$img(src = paste0("data:image/png;base64,", result$explanation_image),
                       style = "max-width: 100%; border: 1px solid #ddd; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);")
            })
          }
        }
      }, error = function(e) {
        cat("Error in interactive explanation:", e$message, "\n")
      })
    })
  })
  
  # Jobs Tab Functions
  observeEvent(input$refresh_jobs, {
    output$jobs_table <- DT::renderDataTable({
      format_jobs_for_dt(list_all_jobs())
    }, escape = FALSE, options = list(scrollX = TRUE))
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
  
  # Model Card Generator Handlers
  observeEvent(input$refresh_train_mc_jobs, {
    choices <- get_jobs_for_dropdown("completed")
    updateSelectInput(session, "train_mc_job_dropdown", choices = choices)
  })
  
  observeEvent(input$train_generate_mc_btn, {
    output$train_model_card_visible <- reactive({ FALSE })
    outputOptions(output, "train_model_card_visible", suspendWhenHidden = FALSE)
    
    if (is.null(input$train_mc_job_dropdown) || input$train_mc_job_dropdown == "") {
      output$train_model_card_display <- renderUI({
        tags$p("Please select a completed job first.")
      })
      output$train_model_card_visible <- reactive({ TRUE })
      outputOptions(output, "train_model_card_visible", suspendWhenHidden = FALSE)
      return()
    }
    
    output$train_model_card_display <- renderUI({
      tags$p("Generating Model Card... Please wait...")
    })
    output$train_model_card_visible <- reactive({ TRUE })
    outputOptions(output, "train_model_card_visible", suspendWhenHidden = FALSE)
    
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", input$train_mc_job_dropdown, "/model-card"), method = "GET")
      if (response$status == 200) {
        result <- fromJSON(response$content)
        md_text <- result$model_card_markdown
        
        output$train_model_card_display <- renderUI({
          html_text <- tryCatch({
            commonmark::markdown_html(md_text, extensions = TRUE)
          }, error = function(e) {
            paste0("<pre>", md_text, "</pre>")
          })
          div(class = "markdown-card-container", HTML(html_text))
        })
      } else {
        output$train_model_card_display <- renderUI({
          tags$p(paste("Error generating model card:", response$status, response$content))
        })
      }
    }, error = function(e) {
      output$train_model_card_display <- renderUI({
        tags$p(paste("Error:", e$message))
      })
    })
  })

  # Initialize data on startup
  observe({
    output$api_status <- renderText(get_api_status())
    output$dashboard_jobs_table <- DT::renderDataTable(format_jobs_for_dt(list_all_jobs()), escape = FALSE, options = list(scrollX = TRUE))
    output$jobs_table <- DT::renderDataTable(format_jobs_for_dt(list_all_jobs()), escape = FALSE, options = list(scrollX = TRUE))
    output$trained_models_table <- DT::renderDataTable(list_trained_models(), escape = FALSE, options = list(scrollX = TRUE))
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
    updateSelectInput(session, "eval_job_dropdown", choices = get_jobs_for_dropdown("completed"))
    updateSelectInput(session, "train_mc_job_dropdown", choices = get_jobs_for_dropdown("completed"))
    updateSelectInput(session, "delete_job_dropdown", choices = get_jobs_for_dropdown())
    
    # Initialize unified train dropdowns
    updateSelectInput(session, "train_selected_job", choices = get_jobs_for_dropdown())
    updateSelectInput(session, "train_dataset_select", choices = get_datasets_for_dropdown())
  })

  # Analytics Value Boxes
  output$stat_total_datasets <- renderValueBox({
    datasets <- list_available_datasets()
    count <- 0
    if (is.data.frame(datasets) && !("Error" %in% names(datasets)) && !("Message" %in% names(datasets))) {
      count <- nrow(datasets)
    }
    valueBox(
      count, "Total Datasets", icon = icon("database"),
      color = "blue"
    )
  })
  
  output$stat_trained_models <- renderValueBox({
    jobs <- list_all_jobs()
    count <- 0
    if (is.data.frame(jobs) && !("Error" %in% names(jobs)) && !("Message" %in% names(jobs))) {
      count <- sum(jobs$Status == "completed" | jobs$Status == "success", na.rm = TRUE)
    }
    valueBox(
      count, "Trained Models", icon = icon("check-circle"),
      color = "green"
    )
  })
  
  output$stat_active_jobs <- renderValueBox({
    jobs <- list_all_jobs()
    count <- 0
    if (is.data.frame(jobs) && !("Error" %in% names(jobs)) && !("Message" %in% names(jobs))) {
      count <- sum(jobs$Status == "running" | jobs$Status == "training", na.rm = TRUE)
    }
    valueBox(
      count, "Active Jobs", icon = icon("cog", class = if(count > 0) "fa-spin" else ""),
      color = "yellow"
    )
  })
  
  output$stat_failed_jobs <- renderValueBox({
    jobs <- list_all_jobs()
    count <- 0
    if (is.data.frame(jobs) && !("Error" %in% names(jobs)) && !("Message" %in% names(jobs))) {
      count <- sum(jobs$Status == "failed" | jobs$Status == "error", na.rm = TRUE)
    }
    valueBox(
      count, "Failed Jobs", icon = icon("exclamation-triangle"),
      color = "red"
    )
  })

  output$stat_arch_plot <- renderPlot({
    jobs <- list_all_jobs()
    if (!is.data.frame(jobs) || nrow(jobs) == 0 || "Error" %in% names(jobs) || "Message" %in% names(jobs)) {
      plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
      text(0.5, 0.5, "No model architecture statistics available.", col="#86868b", font=2, cex=1.2)
      return()
    }
    
    # Filter out N/A values
    archs <- jobs$Architecture[jobs$Architecture != "N/A"]
    if (length(archs) == 0) {
      plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
      text(0.5, 0.5, "No model architecture statistics available.", col="#86868b", font=2, cex=1.2)
      return()
    }
    
    arch_counts <- table(archs)
    arch_counts <- sort(arch_counts)
    
    par(mar = c(5, 12, 3, 2), bg = "white")
    barplot(arch_counts, horiz = TRUE, las = 1, col = "#0071e3", border = NA,
            main = "Trained Models by Architecture", col.main = "#1d1d1f",
            xlab = "Number of Models", col.lab = "#1d1d1f", font.lab = 2,
            cex.names = 0.9, cex.main = 1.2)
  })

  # Decoupled Dataset Upload Function (Datasets Tab)
  observeEvent(input$dataset_upload_submit, {
    file_info <- input$dataset_upload_file
    if (is.null(file_info)) {
      showNotification("Please select a ZIP file first.", type = "error")
      return()
    }
    
    # Generate clean slug for dataset_id
    raw_name <- input$dataset_upload_name %||% "dataset"
    dataset_id <- tolower(gsub("[^a-zA-Z0-9_]", "_", raw_name))
    if (dataset_id == "") dataset_id <- paste0("dataset_", format(Sys.time(), "%Y%m%d_%H%M%S"))
    
    output$dataset_upload_output <- renderPrint({
      cat("Uploading and processing dataset... Please wait.\n")
    })
    
    showNotification("Uploading dataset... This may take several minutes.", type = "message", duration = 30)
    
    file_path <- file_info$datapath
    file_name <- file_info$name
    
    tryCatch({
      task_type <- input$dataset_upload_task
      dataset_name_param <- paste0("&dataset_name=", URLencode(raw_name))
      
      if (task_type == "object_detection") {
        upload_url <- paste0(API_URL, "/upload-detection-dataset/", dataset_id, "?task_type=", task_type, dataset_name_param)
        response <- POST(
          upload_url,
          body = list(file = upload_file(file_path, type = "application/zip")),
          encode = "multipart",
          timeout(300)
        )
      } else {
        upload_url <- paste0(API_URL, "/upload-dataset/", dataset_id, "?task_type=", task_type, dataset_name_param)
        response <- POST(
          upload_url,
          body = list(
            file = upload_file(file_path, type = "application/zip"),
            file_type = "zip"
          ),
          encode = "multipart",
          timeout(300)
        )
      }


      
      if (status_code(response) == 200) {
        showNotification("Dataset uploaded and processed successfully!", type = "message")
        output$dataset_upload_output <- renderPrint({
          cat("✅ Upload completed successfully!\n")
          cat("Dataset ID:", dataset_id, "\n")
          cat("Task Type:", task_type, "\n")
        })
        
        # Trigger immediate refresh of dropdowns and datasets table
        update_train_dropdowns()
        output$datasets_table <- DT::renderDataTable({
          list_available_datasets()
        }, selection = "single", options = list(scrollX = TRUE))
        
      } else {
        error_content <- tryCatch({
          fromJSON(content(response, "text", encoding = "UTF-8"))$detail
        }, error = function(e) {
          content(response, "text", encoding = "UTF-8")
        })
        showNotification(paste("Upload failed:", error_content), type = "error")
        output$dataset_upload_output <- renderPrint({
          cat("❌ Upload failed:\n", error_content, "\n")
        })
      }
    }, error = function(e) {
      showNotification(paste("Upload error:", e$message), type = "error")
      output$dataset_upload_output <- renderPrint({
        cat("❌ Upload error:\n", e$message, "\n")
      })
    })
  })
  
  # Trained Models Tab Functions
  observeEvent(input$refresh_models_table, {
    output$trained_models_table <- DT::renderDataTable({
      list_trained_models()
    }, escape = FALSE, options = list(scrollX = TRUE))
  })
  
  # Modal job data reactive variable for training curves modal
  modal_job_data <- reactiveVal(NULL)
  
  # Observer for viewing model card
  observeEvent(input$view_model_card_id, {
    job_id <- input$view_model_card_id
    showNotification(paste("Fetching model card for", job_id), type = "message")
    
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", job_id, "/model-card"), method = "GET")
      if (response$status == 200) {
        result <- fromJSON(response$content)
        md_text <- result$model_card_markdown
        html_text <- tryCatch({
          commonmark::markdown_html(md_text, extensions = TRUE)
        }, error = function(e) {
          paste0("<pre>", md_text, "</pre>")
        })
        
        showModal(modalDialog(
          title = paste("Model Card -", job_id),
          size = "l",
          easyClose = TRUE,
          fade = TRUE,
          div(class = "markdown-card-container", HTML(html_text)),
          footer = modalButton("Close")
        ))
      } else {
        showModal(modalDialog(
          title = "Error",
          p("Model card is not available for this model yet. If training completed, it may still be generating."),
          easyClose = TRUE,
          footer = modalButton("Close")
        ))
      }
    }, error = function(e) {
      showNotification(paste("Error:", e$message), type = "error")
    })
  })
  
  # Observer for viewing curves
  observeEvent(input$view_curves_id, {
    job_id <- input$view_curves_id
    
    tryCatch({
      response <- make_request(paste0(API_URL, "/pipelines/", job_id), method = "GET")
      if (response$status == 200) {
        job <- fromJSON(response$content, simplifyVector = FALSE)
        modal_job_data(job)
        
        showModal(modalDialog(
          title = paste("Training & Validation Curves -", job$pipeline_config$name %||% job_id),
          size = "l",
          easyClose = TRUE,
          fade = TRUE,
          fluidRow(
            column(12,
              div(style = "display: flex; justify-content: flex-end; margin-bottom: 10px;",
                radioButtons("modal_curve_metric_select", "Select Metric:", choices = c("Accuracy" = "accuracy", "Loss" = "loss"), inline = TRUE)
              ),
              plotOutput("modal_curves_plot", height = "400px")
            )
          ),
          footer = modalButton("Close")
        ))
      } else {
        showNotification(paste("Error retrieving job details:", response$status), type = "error")
      }
    }, error = function(e) {
      showNotification(paste("Error:", e$message), type = "error")
    })
  })
  
  # Plot renderer for modal curves
  output$modal_curves_plot <- renderPlot({
    job <- modal_job_data()
    if (is.null(job)) return(NULL)
    
    history <- job$history
    if (is.null(history) || length(history) == 0) {
      plot(1, type="n", xlab="", ylab="", xlim=c(0, 1), ylim=c(0, 1), xaxt="n", yaxt="n", bty="n")
      text(0.5, 0.5, "No training history metrics available for this job.", col="#86868b", font=2, cex=1.2)
      return()
    }
    
    epochs <- sapply(history, function(h) {
      val <- h$epoch
      if (is.null(val)) val <- h$iter
      if (is.null(val)) val <- 1
      as.numeric(val)
    })
    
    max_epochs_limit <- 2
    if (!is.null(job$pipeline_config) && !is.null(job$pipeline_config$epochs)) {
      max_epochs_limit <- max(max_epochs_limit, as.numeric(job$pipeline_config$epochs), na.rm = TRUE)
    }
    max_epoch_val <- max(c(epochs, max_epochs_limit), na.rm = TRUE)
    xlim_val <- c(1, max_epoch_val)
    
    x_ticks <- seq(1, max_epoch_val, by = max(1, floor(max_epoch_val / 10)))
    if (! (max_epoch_val %in% x_ticks)) {
      x_ticks <- c(x_ticks, max_epoch_val)
    }
    x_ticks <- unique(x_ticks)
    
    metric_type <- input$modal_curve_metric_select %||% "accuracy"
    par(mar = c(5, 5, 4, 2) + 0.1, bg = "white")
    
    if (metric_type == "accuracy") {
      train_acc <- sapply(history, function(h) {
        val <- h$train_acc
        if (is.null(val)) val <- h$accuracy
        if (is.null(val)) val <- h$train_accuracy
        if (is.null(val)) val <- h$acc
        if (is.null(val)) val <- 0
        val <- as.numeric(val)
        if (val > 1) val <- val / 100
        val
      })
      val_acc <- sapply(history, function(h) {
        val <- h$val_acc
        if (is.null(val)) val <- h$val_accuracy
        if (is.null(val)) val <- 0
        val <- as.numeric(val)
        if (val > 1) val <- val / 100
        val
      })
      
      plot(epochs, train_acc, type = "o", col = "#0071e3", lwd = 3, pch = 16,
           xlab = "Epoch", ylab = "Accuracy", ylim = c(0, 1), xlim = xlim_val,
           main = "Training & Validation Accuracy",
           col.main = "#1d1d1f", col.lab = "#1d1d1f", font.lab = 2,
           cex.main = 1.4, cex.lab = 1.1, axes = FALSE)
      
      grid(nx = NULL, ny = NULL, col = "#d2d2d7", lty = "dotted", lwd = 1)
      axis(1, at = x_ticks, col = "#d2d2d7", col.axis = "#86868b")
      axis(2, at = seq(0, 1, by = 0.1), labels = paste0(seq(0, 100, by = 10), "%"), col = "#d2d2d7", col.axis = "#86868b")
      
      if (any(val_acc > 0)) {
        lines(epochs, val_acc, type = "o", col = "#ff9500", lwd = 3, pch = 17)
        legend("bottomright", legend = c("Training", "Validation"),
               col = c("#0071e3", "#ff9500"), lty = 1, lwd = 3, pch = c(16, 17),
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      } else {
        legend("bottomright", legend = c("Training"),
               col = c("#0071e3"), lty = 1, lwd = 3, pch = 16,
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      }
    } else {
      train_loss <- sapply(history, function(h) {
        val <- h$train_loss
        if (is.null(val)) val <- h$loss
        if (is.null(val)) val <- 0
        as.numeric(val)
      })
      val_loss <- sapply(history, function(h) {
        val <- h$val_loss
        if (is.null(val)) val <- 0
        as.numeric(val)
      })
      
      max_loss <- max(c(train_loss, val_loss), na.rm = TRUE)
      if (max_loss == 0) max_loss <- 1
      ylim_val <- c(0, max_loss * 1.1)
      
      plot(epochs, train_loss, type = "o", col = "#ff3b30", lwd = 3, pch = 16,
           xlab = "Epoch", ylab = "Loss", ylim = ylim_val, xlim = xlim_val,
           main = "Training & Validation Loss",
           col.main = "#1d1d1f", col.lab = "#1d1d1f", font.lab = 2,
           cex.main = 1.4, cex.lab = 1.1, axes = FALSE)
      
      grid(nx = NULL, ny = NULL, col = "#d2d2d7", lty = "dotted", lwd = 1)
      axis(1, at = x_ticks, col = "#d2d2d7", col.axis = "#86868b")
      axis(2, col = "#d2d2d7", col.axis = "#86868b")
      
      if (any(val_loss > 0)) {
        lines(epochs, val_loss, type = "o", col = "#ff9500", lwd = 3, pch = 17)
        legend("topright", legend = c("Training", "Validation"),
               col = c("#ff3b30", "#ff9500"), lty = 1, lwd = 3, pch = c(16, 17),
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      } else {
        legend("topright", legend = c("Training"),
               col = c("#ff3b30"), lty = 1, lwd = 3, pch = 16,
               bty = "n", text.col = "#1d1d1f", text.font = 2)
      }
    }
  })
  
  # Observer for evaluating model and tab routing
  observeEvent(input$eval_model_id, {
    job_id <- input$eval_model_id
    
    updateSelectInput(session, "eval_job_dropdown", choices = get_jobs_for_dropdown("completed"), selected = job_id)
    updateTabItems(session, "sidebarMenu", "evaluation")
    showNotification(paste("Selected model", job_id, "for evaluation. Click 'Run Evaluation' to see metrics."), type = "message")
  })
}

# Run the application
shinyApp(ui = ui, server = server)