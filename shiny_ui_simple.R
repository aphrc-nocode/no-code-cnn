# Enhanced No-Code AI Platform - R Shiny UI
# Unified plain HTML iframe wrapper

library(shiny)

# Configuration
API_URL <- Sys.getenv("API_URL", "http://host.docker.internal:8090")  # FastAPI backend URL
CLIENT_API_URL <- Sys.getenv("CLIENT_API_URL", "http://localhost:8090")  # Host-resolvable FastAPI URL

# UI
ui <- fluidPage(
  title = "No-Code Computer Vision Dashboard",
  tags$head(
    tags$style(HTML("
      body, html {
        margin: 0;
        padding: 0;
        height: 100vh;
        overflow: hidden;
        background: #f5f5f7;
      }
      iframe {
        width: 100%;
        height: 100vh;
        border: none;
        display: block;
      }
    "))
  ),
  htmlOutput("iframe_ui")
)

# Server
server <- function(input, output, session) {
  output$iframe_ui <- renderUI({
    # Use client-resolvable address so the host browser loads the iframe correctly
    timestamp <- as.numeric(Sys.time())
    iframe_url <- paste0(CLIENT_API_URL, "/?t=", timestamp)
    tags$iframe(src = iframe_url)
  })
}

# Run the application
shinyApp(ui = ui, server = server)
