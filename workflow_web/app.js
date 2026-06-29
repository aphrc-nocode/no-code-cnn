const NODE_WIDTH = 210;
const NODE_HEIGHT = 88;
const NODE_PORT_Y = 44;
const CANVAS_PADDING = 16;

const urlParams = new URLSearchParams(window.location.search);
const PROJECT_ID = urlParams.get('project_id');

const NODE_ICONS = {
  dataset: "database",
  model_config: "sliders",
  trainer: "cpu",
  predictor: "eye",
  evaluator: "bar-chart-2",
  responsible_ai: "shield",
};

const NODE_BLUEPRINTS = {
  dataset: {
    title: "Dataset",
    subtitle: "Select dataset source",
    x: 60,
    y: 80,
    config: {
      datasetId: "",
    },
  },
  model_config: {
    title: "Model Config",
    subtitle: "Hyperparameters",
    x: 60,
    y: 280,
    config: {
      name: "Visual Pipeline",
      task_type: "image_classification",
      architecture: "resnet18",
      epochs: 5,
      batch_size: 8,
      learning_rate: 0.001,
      image_size: "224, 224",
      augmentation_enabled: true,
      early_stopping: true,
    },
  },
  trainer: {
    title: "Trainer",
    subtitle: "Run pipeline training",
    x: 360,
    y: 180,
    config: {
      jobId: "",
      status: "idle",
      logs: [],
      metrics: {},
    },
  },
  predictor: {
    title: "Predictor",
    subtitle: "Run predictions",
    x: 660,
    y: 180,
    config: {
      predictions: null,
      annotatedImage: "",
      explain_method: "none",
      explanationImage: "",
      confidence_threshold: 0.5,
    },
  },
  evaluator: {
    title: "Evaluator",
    subtitle: "Evaluate model performance",
    x: 660,
    y: 300,
    config: {
      status: "idle",
      results: null,
      error: null,
    },
  },
  responsible_ai: {
    title: "Responsible AI",
    subtitle: "Dataset & Model cards",
    x: 360,
    y: 320,
    config: {
      status: "idle",
      cardType: "", // "dataset" or "model"
      reportMarkdown: "",
      classDistributionPlot: "",
      error: null,
    },
  },
};

const DEFAULT_WORKFLOW = {
  nodes: [
    makeNode("dataset", { id: "dataset_1", x: 60, y: 80 }),
    makeNode("model_config", { id: "model_config_1", x: 60, y: 280 }),
    makeNode("trainer", { id: "trainer_1", x: 360, y: 180 }),
    makeNode("predictor", { id: "predictor_1", x: 660, y: 180 }),
  ],
  edges: [
    ["dataset_1", "trainer_1"],
    ["model_config_1", "trainer_1"],
    ["trainer_1", "predictor_1"],
  ],
};

const state = {
  workflow: null,
  selectedNodeId: "trainer_1",
  availableDatasets: [],
  pollingTimers: {},
  dragging: null,
  connecting: null,
  contextMenuNodeId: null,
  edgeRenderFrame: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  bindEvents();
  
  // Load workflow from server or fallback
  await loadWorkflowFromServer();
  
  // Fetch available datasets
  await fetchAvailableDatasets();
  
  // Redraw
  renderWorkflow();
  renderEdges();
  renderInspector();
  
  // Start polling any active training jobs
  resumeActiveTrainerPolling();
  
  // Initialize
  init();

  logEvent("Visual Builder Ready", "Canvas initialized. Select a node to configure it.");
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
});

function makeNode(type, overrides = {}) {
  const blueprint = NODE_BLUEPRINTS[type];
  return {
    id: overrides.id || `${type}_${Date.now()}`,
    type,
    title: blueprint.title,
    subtitle: blueprint.subtitle,
    x: overrides.x ?? blueprint.x,
    y: overrides.y ?? blueprint.y,
    enabled: true,
    config: {
      ...blueprint.config,
      ...(overrides.config || {}),
    },
  };
}

function cacheElements() {
  els.workflowCanvas = document.getElementById("workflowCanvas");
  els.nodeLayer = document.getElementById("nodeLayer");
  els.edgeLayer = document.getElementById("edgeLayer");
  els.nodeForm = document.getElementById("nodeForm");
  els.selectedNodeLabel = document.getElementById("selectedNodeLabel");
  els.workflowStatus = document.getElementById("workflowStatus");
  els.eventLog = document.getElementById("eventLog");
  els.contextMenu = document.getElementById("nodeContextMenu");
}

function bindEvents() {
  document.getElementById("saveWorkflow").addEventListener("click", saveWorkflow);
  document.getElementById("resetWorkflow").addEventListener("click", resetWorkflow);
  
  // Wire up the new Add Node buttons
  document.querySelectorAll(".add-node-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.type;
      const rect = els.workflowCanvas.getBoundingClientRect();
      // Spawn at center of canvas with a small offset
      const x = rect.width / 2 - NODE_WIDTH / 2 + (Math.random() * 40 - 20);
      const y = rect.height / 2 - NODE_HEIGHT / 2 + (Math.random() * 40 - 20);
      addNodeToCanvas(type, x, y);
    });
  });

  els.workflowCanvas.addEventListener("dragover", (event) => {
    event.preventDefault();
  });

  window.addEventListener("resize", renderEdges);
  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointermove", onConnectionMove);
  document.addEventListener("pointerup", stopPointerAction);
  
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideContextMenu();
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    const active = document.activeElement;
    if (active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName)) return;
    if (state.selectedNodeId) removeNode(state.selectedNodeId);
  });

  els.contextMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const nodeId = state.contextMenuNodeId;
    hideContextMenu();
    if (!nodeId) return;
    if (action === "delete") removeNode(nodeId);
    else if (action === "rename") renameNode(nodeId);
  });
  
  document.addEventListener("pointerdown", (event) => {
    if (!els.contextMenu.contains(event.target)) hideContextMenu();
  });
  window.addEventListener("blur", hideContextMenu);
  window.addEventListener("resize", hideContextMenu);
}

async function loadWorkflowFromServer() {
  if (!PROJECT_ID) return; // Wait for project_id
  try {
    const response = await fetch(`/api/projects/${PROJECT_ID}/workflow/canvas`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
        state.workflow = data;
        if (state.workflow.nodes.length > 0) {
          state.selectedNodeId = state.workflow.nodes[0].id;
        }
        return;
      }
    }
  } catch (error) {
    console.warn("Failed to load workflow from server:", error);
  }
  state.workflow = structuredClone(DEFAULT_WORKFLOW);
}

async function saveWorkflow() {
  if (!PROJECT_ID) return;
  try {
    const response = await fetch(`/api/projects/${PROJECT_ID}/workflow/canvas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.workflow),
    });
    if (response.ok) {
      logEvent("Workflow saved", "Successfully saved workflow state to backend server.");
    } else {
      throw new Error("Failed to save workflow");
    }
  } catch (error) {
    logEvent("Save failed", error.message || "Failed to save workflow.");
  }
}

function resetWorkflow() {
  Object.values(state.pollingTimers).forEach(timer => clearInterval(timer));
  state.pollingTimers = {};
  
  state.workflow = structuredClone(DEFAULT_WORKFLOW);
  state.selectedNodeId = "trainer_1";
  saveWorkflow();
  renderWorkflow();
  renderEdges();
  renderInspector();
}

function renderWorkflow() {
  els.nodeLayer.innerHTML = "";
  for (const node of state.workflow.nodes) {
    const element = document.createElement("article");
    const isSelected = node.id === state.selectedNodeId;
    element.className = `workflow-node ${isSelected ? "selected" : ""}`;
    element.style.transform = `translate(${node.x}px, ${node.y}px)`;
    element.dataset.nodeId = node.id;
    element.dataset.type = node.type;
    
    let statusLabel = "ready";
    let statusKey = "ready";
    if (node.type === "trainer" || node.type === "evaluator" || node.type === "responsible_ai") {
      statusLabel = node.config.status || "idle";
      statusKey = statusLabel;
    }
    
    const hasIn = ["trainer", "predictor", "evaluator", "responsible_ai"].includes(node.type);
    const hasOut = ["dataset", "model_config", "trainer", "predictor"].includes(node.type);

    element.innerHTML = `
      ${hasIn ? '<span class="node-port in" data-port="in" title="Connect input"></span>' : ''}
      <div class="node-toolbar">
        <button class="mini-button danger" data-action="remove" title="Remove node"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="node-icon"><i data-lucide="${NODE_ICONS[node.type] || "box"}"></i></div>
      <div class="node-body">
        <div class="node-title-row">
          <span class="node-title">${escapeHtml(node.title)}</span>
          ${["trainer", "evaluator", "responsible_ai"].includes(node.type) ? `<span class="status-pill" data-status="${escapeHtml(statusKey)}">${escapeHtml(statusLabel)}</span>` : ''}
        </div>
        <div class="node-subtitle">${escapeHtml(node.subtitle)}</div>
      </div>
      ${hasOut ? '<span class="node-port out" data-port="out" title="Drag to connect"></span>' : ''}
    `;
    
    element.addEventListener("pointerdown", (event) => startDrag(event, node.id));
    if (hasOut) {
      element.querySelector('[data-port="out"]').addEventListener("pointerdown", (event) => {
        startConnection(event, node.id);
      });
    }
    element.querySelector('[data-action="remove"]').addEventListener("click", (event) => {
      event.stopPropagation();
      removeNode(node.id);
    });
    element.addEventListener("click", () => selectNode(node.id));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      selectNode(node.id);
      showContextMenu(event.clientX, event.clientY, node.id);
    });
    els.nodeLayer.appendChild(element);
  }
  if (window.lucide) window.lucide.createIcons();
  scheduleEdgeRender();
}

function renderEdges() {
  state.edgeRenderFrame = null;
  const rect = els.workflowCanvas.getBoundingClientRect();
  els.edgeLayer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  els.edgeLayer.innerHTML = "";
  state.workflow.edges.forEach(([fromId, toId], index) => {
    const from = getNode(fromId);
    const to = getNode(toId);
    if (!from || !to) return;
    const start = portPoint(fromId, "out");
    const end = portPoint(toId, "in");
    
    const d = connectionPath(start.x, start.y, end.x, end.y);
    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("d", d);
    hitPath.setAttribute("fill", "none");
    hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "16");
    hitPath.setAttribute("stroke-linecap", "round");
    hitPath.dataset.edgeIndex = String(index);
    hitPath.classList.add("edge-hit-path");
    hitPath.addEventListener("click", () => removeEdge(index));
    els.edgeLayer.appendChild(hitPath);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#5b6275");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.classList.add("edge-path");
    els.edgeLayer.appendChild(path);
  });

  if (state.connecting) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", connectionPath(
      state.connecting.startX,
      state.connecting.startY,
      state.connecting.currentX,
      state.connecting.currentY
    ));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#3c8dbc");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-dasharray", "6 6");
    path.classList.add("edge-path", "preview");
    els.edgeLayer.appendChild(path);
  }
}

function scheduleEdgeRender() {
  if (state.edgeRenderFrame) return;
  state.edgeRenderFrame = window.requestAnimationFrame(renderEdges);
}

function renderInspector() {
  const node = selectedNode();
  if (!node) {
    els.selectedNodeLabel.textContent = "No node selected";
    els.nodeForm.innerHTML = '<div class="empty-inspector">Select a node to inspect properties.</div>';
    return;
  }
  els.selectedNodeLabel.textContent = node.title;
  els.nodeForm.innerHTML = "";

  if (node.type === "dataset") {
    // Dataset Select list using LOWERCASE fields from FastAPI
    const choices = [["", "Select a dataset..."]];
    for (const dataset of state.availableDatasets) {
      choices.push([dataset.id, `${dataset.name} (${dataset.task_type}, ${dataset.item_count} items)`]);
    }
    
    els.nodeForm.appendChild(makeSelectField("datasetId", "Select Dataset", node.config.datasetId, choices, (value) => {
      node.config.datasetId = value;
      const d = state.availableDatasets.find(x => x.id === value);
      if (d) {
        node.subtitle = `${d.name} (${d.is_coco_format ? 'COCO' : 'Standard'})`;
      } else {
        node.subtitle = "Select dataset source";
      }
      renderWorkflow();
      saveWorkflow();
    }));
    
    // Details
    const d = state.availableDatasets.find(x => x.id === node.config.datasetId);
    if (d) {
      const details = document.createElement("div");
      details.className = "sample-card";
      details.innerHTML = `
        <strong>Dataset Properties</strong>
        <p><b>Task Type:</b> ${d.task_type}</p>
        <p><b>Total Items:</b> ${d.item_count}</p>
        <p><b>Classes count:</b> ${d.classes ? d.classes.length : 0}</p>
        <p><b>Format:</b> ${d.is_coco_format ? 'COCO' : 'Standard'}</p>
      `;
      els.nodeForm.appendChild(details);
    }
  }

  if (node.type === "model_config") {
    els.nodeForm.appendChild(makeSelectField("task_type", "Task Type", node.config.task_type, [
      ["image_classification", "Image Classification"],
      ["object_detection", "Object Detection"],
      ["image_segmentation", "Image Segmentation"],
    ], (value) => {
      node.config.task_type = value;
      if (value === "image_classification") node.config.architecture = "resnet18";
      else if (value === "object_detection") node.config.architecture = "faster_rcnn";
      else if (value === "image_segmentation") node.config.architecture = "fcn";
      saveWorkflow();
      renderInspector();
    }));

    let archs = [];
    if (node.config.task_type === "image_classification") {
      archs = [
        ["resnet18", "ResNet-18"],
        ["resnet50", "ResNet-50"],
        ["vgg16", "VGG-16"],
        ["mobilenet", "MobileNet"],
        ["efficientnet", "EfficientNet"]
      ];
    } else if (node.config.task_type === "object_detection") {
      archs = [
        ["faster_rcnn", "Faster R-CNN"],
        ["ssd", "SSD"],
        ["yolo", "YOLO"],
        ["detr_resnet50", "DETR ResNet-50"],
        ["yolos_small", "YOLOS Small"]
      ];
    } else if (node.config.task_type === "image_segmentation") {
      archs = [
        ["fcn", "FCN"],
        ["deeplabv3", "DeepLabV3"],
        ["unet", "U-Net"]
      ];
    }
    
    els.nodeForm.appendChild(makeSelectField("architecture", "Architecture", node.config.architecture, archs, (value) => {
      node.config.architecture = value;
      saveWorkflow();
    }));

    els.nodeForm.appendChild(makeNumberField("epochs", "Epochs", node.config.epochs, 1, 100, (value) => {
      node.config.epochs = value;
      saveWorkflow();
    }));
    
    els.nodeForm.appendChild(makeNumberField("batch_size", "Batch Size", node.config.batch_size, 1, 128, (value) => {
      node.config.batch_size = value;
      saveWorkflow();
    }));
    
    els.nodeForm.appendChild(makeNumberField("learning_rate", "Learning Rate", node.config.learning_rate, 0.0001, 1, (value) => {
      node.config.learning_rate = value;
      saveWorkflow();
    }, 0.0001));

    els.nodeForm.appendChild(makeTextField("image_size", "Image Size (width, height)", node.config.image_size, (value) => {
      node.config.image_size = value;
      saveWorkflow();
    }));

    els.nodeForm.appendChild(makeToggleField("augmentation_enabled", "Data Augmentation", node.config.augmentation_enabled, (checked) => {
      node.config.augmentation_enabled = checked;
      saveWorkflow();
    }));

    els.nodeForm.appendChild(makeToggleField("early_stopping", "Early Stopping", node.config.early_stopping, (checked) => {
      node.config.early_stopping = checked;
      saveWorkflow();
    }));
  }

  if (node.type === "trainer") {
    const inputs = getTrainerInputs(node.id);
    if (!inputs.datasetNode || !inputs.configNode) {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = "Please connect both a Dataset node and a Model Config node to this Trainer.";
      els.nodeForm.appendChild(msg);
      return;
    }

    const dsId = inputs.datasetNode.config.datasetId;
    const datasetObj = state.availableDatasets.find(x => x.id === dsId);
    
    if (!datasetObj) {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = "Please select a valid dataset inside the connected Dataset node.";
      els.nodeForm.appendChild(msg);
      return;
    }

    const cfg = inputs.configNode.config;
    
    const details = document.createElement("div");
    details.className = "sample-card";
    details.innerHTML = `
      <strong>Training Pipeline setup</strong>
      <p><b>Dataset:</b> ${datasetObj.name}</p>
      <p><b>Task:</b> ${cfg.task_type}</p>
      <p><b>Model:</b> ${cfg.architecture}</p>
      <p><b>Epochs:</b> ${cfg.epochs} | <b>Batch:</b> ${cfg.batch_size}</p>
    `;
    els.nodeForm.appendChild(details);

    const statusDiv = document.createElement("div");
    statusDiv.style.display = "flex";
    statusDiv.style.alignItems = "center";
    statusDiv.style.justifyContent = "space-between";
    statusDiv.style.margin = "8px 0";
    statusDiv.innerHTML = `
      <span><b>Status:</b> <span class="status-pill" data-status="${escapeHtml(node.config.status || 'idle')}">${escapeHtml(node.config.status || 'idle')}</span></span>
      <span>${node.config.jobId ? `Job ID: <code>${node.config.jobId.slice(0, 8)}</code>` : ""}</span>
    `;
    els.nodeForm.appendChild(statusDiv);

    const trainBtn = document.createElement("button");
    trainBtn.type = "button";
    trainBtn.className = "button primary";
    trainBtn.style.width = "100%";
    trainBtn.innerHTML = '<i data-lucide="play"></i> Start Pipeline Training';
    
    const isRunning = ["pending", "running"].includes(node.config.status);
    if (isRunning) {
      trainBtn.disabled = true;
      trainBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Training Running...';
    }
    
    trainBtn.addEventListener("click", async () => {
      trainBtn.disabled = true;
      trainBtn.innerHTML = 'Starting...';
      await startPipelineTraining(node.id, datasetObj, cfg);
    });
    els.nodeForm.appendChild(trainBtn);

    if (node.config.status === "completed") {
      const curvesBtn = document.createElement("button");
      curvesBtn.type = "button";
      curvesBtn.className = "button secondary";
      curvesBtn.style.width = "100%";
      curvesBtn.style.marginTop = "10px";
      curvesBtn.innerHTML = '<i data-lucide="line-chart"></i> View Training Curves';
      curvesBtn.onclick = () => window.fetchTrainingCurves(node.config.jobId, curvesBtn);
      els.nodeForm.appendChild(curvesBtn);
    }

    if (node.config.logs && node.config.logs.length > 0) {
      const logsLabel = document.createElement("label");
      logsLabel.innerHTML = "<span>Training Logs</span>";
      const logsPre = document.createElement("pre");
      logsPre.style.background = "#222";
      logsPre.style.color = "#a8ffb2";
      logsPre.style.padding = "10px";
      logsPre.style.borderRadius = "3px";
      logsPre.style.maxHeight = "180px";
      logsPre.style.overflowY = "auto";
      logsPre.style.fontSize = "11px";
      logsPre.style.whiteSpace = "pre-wrap";
      logsPre.textContent = node.config.logs.join("\n");
      logsLabel.appendChild(logsPre);
      els.nodeForm.appendChild(logsLabel);
      
      setTimeout(() => { logsPre.scrollTop = logsPre.scrollHeight; }, 10);
    }
    
    if (node.config.metrics && Object.keys(node.config.metrics).length > 0) {
      const metricsDiv = document.createElement("div");
      metricsDiv.className = "sample-card";
      let metricsHtml = "<strong>Validation Metrics</strong>";
      for (const [k, v] of Object.entries(node.config.metrics)) {
        metricsHtml += `<p><b>${k}:</b> ${typeof v === "number" ? v.toFixed(4) : v}</p>`;
      }
      metricsDiv.innerHTML = metricsHtml;
      els.nodeForm.appendChild(metricsDiv);
    }
  }

  if (node.type === "predictor") {
    const trainerNode = getPredictorInput(node.id);
    if (!trainerNode) {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = "Please connect a Trainer node to this Predictor.";
      els.nodeForm.appendChild(msg);
      return;
    }

    if (trainerNode.config.status !== "completed") {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = `Model training status is ${trainerNode.config.status || "idle"}. Please wait for it to complete.`;
      els.nodeForm.appendChild(msg);
      return;
    }

    const details = document.createElement("div");
    details.innerHTML = `<span>Active Model: <code>${trainerNode.config.jobId.slice(0, 8)}</code></span>`;
    els.nodeForm.appendChild(details);

    els.nodeForm.appendChild(makeSelectField("explain_method", "xAI Explanation Method", node.config.explain_method || "none", [
      ["none", "None"],
      ["gradcam", "Grad-CAM (Heatmap)"],
      ["lime", "LIME Explainer"],
      ["shap", "SHAP Explainer"]
    ], (value) => {
      node.config.explain_method = value;
      saveWorkflow();
    }));

    els.nodeForm.appendChild(makeSliderField(
      "confidence_threshold",
      "Confidence Threshold",
      node.config.confidence_threshold ?? 0.5,
      0.05, 0.95, 0.05,
      (value) => {
        node.config.confidence_threshold = value;
        saveWorkflow();
      }
    ));

    const fileLabel = document.createElement("label");
    fileLabel.innerHTML = "<span>Upload Test Image</span>";
    
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileLabel.appendChild(fileInput);
    els.nodeForm.appendChild(fileLabel);

    const urlLabel = document.createElement("label");
    urlLabel.innerHTML = "<span>Or Provide Image URL</span>";
    
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "https://example.com/image.jpg";
    urlLabel.appendChild(urlInput);
    els.nodeForm.appendChild(urlLabel);

    const predictBtn = document.createElement("button");
    predictBtn.type = "button";
    predictBtn.className = "primary-button";
    predictBtn.textContent = "Run Prediction";
    predictBtn.style.marginTop = "10px";
    predictBtn.style.width = "100%";

    predictBtn.addEventListener("click", async () => {
      const file = fileInput.files[0];
      const imageUrl = urlInput.value.trim();
      
      if (!file && !imageUrl) {
        alert("Please upload a file or enter an image URL.");
        return;
      }
      
      const spinner = document.createElement("div");
      spinner.className = "empty-inspector spinner-container";
      spinner.innerHTML = '<i data-lucide="loader-2" class="spin" style="margin-right:8px;"></i> Running prediction...';
      
      const existingSpinner = els.nodeForm.querySelector('.spinner-container');
      if (existingSpinner) existingSpinner.remove();
      
      els.nodeForm.appendChild(spinner);
      lucide.createIcons();
      
      try {
        await runPipelinePrediction(node.id, trainerNode.config.jobId, file, imageUrl);
      } catch (err) {
        logEvent("Prediction error", err.message || "Failed to run prediction");
      }
      renderInspector();
    });

    els.nodeForm.appendChild(predictBtn);

    if (node.config.annotatedImage) {
      const imgLabel = document.createElement("label");
      imgLabel.innerHTML = "<span>Prediction Overlay</span>";
      
      const img = document.createElement("img");
      img.src = node.config.annotatedImage;
      img.style.width = "100%";
      img.style.borderRadius = "3px";
      img.style.border = "1px solid var(--line-strong)";
      img.className = "clickable-image";
      img.onclick = () => window.openLightbox(img.src);
      imgLabel.appendChild(img);
      els.nodeForm.appendChild(imgLabel);
    }

    if (node.config.explanationImage) {
      const xaiLabel = document.createElement("label");
      xaiLabel.style.marginTop = "10px";
      xaiLabel.innerHTML = "<span>xAI Explanation (Heatmap)</span>";
      
      const xaiImg = document.createElement("img");
      xaiImg.src = node.config.explanationImage;
      xaiImg.style.width = "100%";
      xaiImg.style.borderRadius = "3px";
      xaiImg.style.border = "1px solid var(--line-strong)";
      xaiImg.className = "clickable-image";
      xaiImg.onclick = () => window.openLightbox(xaiImg.src);
      xaiLabel.appendChild(xaiImg);
      els.nodeForm.appendChild(xaiLabel);
    }

    if (node.config.predictions) {
      const resultsDiv = document.createElement("div");
      resultsDiv.className = "sample-card";
      resultsDiv.style.marginTop = "10px";
      
      let html = "<strong>Prediction Results Log</strong>";
      const predData = node.config.predictions;
      
      if (predData.predictions && Array.isArray(predData.predictions)) {
        // Classification
        html += '<ul style="margin: 5px 0; padding-left: 15px; font-size: 11.5px;">';
        predData.predictions.forEach(p => {
          html += `<li><b>${escapeHtml(p.class_name)}</b>: ${p.confidence.toFixed(1)}%</li>`;
        });
        html += '</ul>';
      } else if (predData.detections && Array.isArray(predData.detections)) {
        // Object Detection
        html += `<p style="margin: 3px 0;"><b>Objects Detected:</b> ${predData.detections.length}</p>`;
        if (predData.detections.length > 0) {
          html += '<ul style="margin: 5px 0; padding-left: 15px; font-size: 11.5px;">';
          predData.detections.forEach(d => {
            const conf = typeof d.confidence === 'number' ? d.confidence.toFixed(1) : d.confidence;
            html += `<li><b>${escapeHtml(d.class_name)}</b>: ${conf}% [Box: ${d.box.map(b => Math.round(b)).join(', ')}]</li>`;
          });
          html += '</ul>';
        }
      } else if (predData.instances && Array.isArray(predData.instances)) {
        // Instance Segmentation
        html += `<p style="margin: 3px 0;"><b>Instances Detected:</b> ${predData.instances.length}</p>`;
        if (predData.instances.length > 0) {
          html += '<ul style="margin: 5px 0; padding-left: 15px; font-size: 11.5px;">';
          predData.instances.forEach(ins => {
            const conf = typeof ins.confidence === 'number' ? (ins.confidence * 100).toFixed(1) : ins.confidence;
            html += `<li><b>${escapeHtml(ins.class_name || ins.class_id)}</b>: ${conf}%</li>`;
          });
          html += '</ul>';
        }
      } else if (predData.class_mapping) {
        // Semantic Segmentation
        html += `<p style="margin: 3px 0;">Semantic segmentation masks overlayed successfully.</p>`;
      } else {
        html += `<pre style="font-size: 9px; max-height: 100px; overflow: auto; background: #eee; padding: 5px; margin-top: 5px;">${escapeHtml(JSON.stringify(predData, null, 2))}</pre>`;
      }
      
      resultsDiv.innerHTML = html;
      els.nodeForm.appendChild(resultsDiv);
    }
  }

  if (node.type === "evaluator") {
    const trainerNode = getEvaluatorInput(node.id);
    if (!trainerNode) {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = "Please connect a Trainer node to this Evaluator.";
      els.nodeForm.appendChild(msg);
      return;
    }

    if (trainerNode.config.status !== "completed") {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = `Model training status is ${trainerNode.config.status || "idle"}. Please wait for it to complete.`;
      els.nodeForm.appendChild(msg);
      return;
    }

    const details = document.createElement("div");
    details.innerHTML = `<span>Active Model: <code>${trainerNode.config.jobId.slice(0, 8)}</code></span>`;
    els.nodeForm.appendChild(details);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.className = "button primary";
    runBtn.style.width = "100%";
    runBtn.style.marginTop = "10px";
    runBtn.innerHTML = '<i data-lucide="play"></i> Run Model Evaluation';
    
    const isRunning = node.config.status === "running";
    if (isRunning) {
      runBtn.disabled = true;
      runBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Evaluating...';
    }
    
    runBtn.addEventListener("click", () => {
      runModelEvaluation(node.id, trainerNode.config.jobId);
    });
    els.nodeForm.appendChild(runBtn);

    if (node.config.status === "error" && node.config.error) {
      const errCard = document.createElement("div");
      errCard.className = "sample-card";
      errCard.style.borderColor = "var(--danger)";
      errCard.style.color = "var(--danger)";
      errCard.style.marginTop = "10px";
      errCard.innerHTML = `<strong>Evaluation Error</strong><p>${escapeHtml(node.config.error)}</p>`;
      els.nodeForm.appendChild(errCard);
    }

    if (node.config.results) {
      const res = node.config.results;
      
      // Calculate overall macro metrics
      const classMetrics = res.class_metrics || [];
      const numClasses = classMetrics.length;
      let macroPrecision = 0;
      let macroRecall = 0;
      let macroF1 = 0;
      
      if (numClasses > 0) {
        let sumPrec = 0;
        let sumRec = 0;
        let sumF1 = 0;
        classMetrics.forEach(m => {
          sumPrec += m.precision || 0;
          sumRec += m.recall || 0;
          sumF1 += m.f1_score || 0;
        });
        macroPrecision = sumPrec / numClasses;
        macroRecall = sumRec / numClasses;
        macroF1 = sumF1 / numClasses;
      }

      // 1. Overview Value Boxes
      const valBoxesDiv = document.createElement("div");
      let boxes = [];
      if (res.task_type === "image_classification") {
        boxes = [
          { label: "Accuracy", value: `${(res.accuracy * 100).toFixed(1)}%`, color: "var(--primary)" },
          { label: "Macro F1", value: `${(macroF1 * 100).toFixed(1)}%`, color: "var(--ok)" },
          { label: "Macro Prec.", value: `${(macroPrecision * 100).toFixed(1)}%`, color: "var(--warning)" },
          { label: "Macro Rec.", value: `${(macroRecall * 100).toFixed(1)}%`, color: "var(--violet)" }
        ];
      } else if (res.task_type === "object_detection") {
        boxes = [
          { label: "mAP (mAcc)", value: `${(res.accuracy * 100).toFixed(1)}%`, color: "var(--primary)" },
          { label: "AP50", value: `${res.correct_count}%`, color: "var(--ok)" },
          { label: "AP75", value: `${res.incorrect_count}%`, color: "var(--warning)" },
          { label: "Targets", value: res.lowest_precision_class, color: "var(--info)" }
        ];
      }
      
      let boxesHtml = `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 12px; margin-bottom: 12px;">`;
      boxes.forEach(box => {
        boxesHtml += `
          <div style="background: #f9f9f9; border: 1px solid #d2d6de; border-top: 3px solid ${box.color}; border-radius: var(--radius); padding: 8px 10px; display: flex; flex-direction: column; box-shadow: var(--shadow-sm);">
            <span style="font-size: 16px; font-weight: 700; color: #333; line-height: 1.1;">${box.value}</span>
            <span style="font-size: 9px; font-weight: 700; color: var(--muted); text-transform: uppercase; margin-top: 2px;">${box.label}</span>
          </div>
        `;
      });
      boxesHtml += `</div>`;
      valBoxesDiv.innerHTML = boxesHtml;
      els.nodeForm.appendChild(valBoxesDiv);

      // 2. Heatmap Confusion Matrix (For classification only)
      if (res.task_type === "image_classification" && res.confusion_matrix_base64) {
        const matrixLabel = document.createElement("label");
        matrixLabel.style.marginTop = "10px";
        matrixLabel.innerHTML = "<span>Confusion Matrix</span>";
        const matrixImg = document.createElement("img");
        matrixImg.src = `data:image/png;base64,${res.confusion_matrix_base64}`;
        matrixImg.style.width = "100%";
        matrixImg.style.borderRadius = "3px";
        matrixImg.style.border = "1px solid var(--line-strong)";
        matrixImg.className = "clickable-image";
        matrixImg.onclick = () => window.openLightbox(matrixImg.src);
        matrixLabel.appendChild(matrixImg);
        els.nodeForm.appendChild(matrixLabel);
      }

      // 3. Class Performance Bars Plot
      if (classMetrics.length > 0) {
        const barPlotHtml = drawClassMetricsPlot(classMetrics, res.task_type);
        const barPlotDiv = document.createElement("div");
        barPlotDiv.innerHTML = barPlotHtml;
        els.nodeForm.appendChild(barPlotDiv);
      }

      // 4. Raw Report/Details Card
      const detailsCard = document.createElement("div");
      detailsCard.className = "sample-card";
      detailsCard.style.marginTop = "12px";
      let detailsHtml = "<strong>Detailed Metadata</strong>";
      
      if (res.task_type === "image_classification") {
        detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Correct/Incorrect Count:</b> ${res.correct_count} / ${res.incorrect_count}</p>`;
        if (res.lowest_precision_class && res.lowest_precision_class !== "None") {
          detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Lowest Precision Class:</b> <span class="status-pill" data-status="failed">${escapeHtml(res.lowest_precision_class)}</span></p>`;
        }
        if (res.top_confusion && res.top_confusion !== "None") {
          detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Top Confusion:</b> <span style="font-size: 10px; font-family: monospace; color: #a94442;">${escapeHtml(res.top_confusion)}</span></p>`;
        }
        if (res.classification_report) {
          detailsHtml += `<label style="margin-top: 8px;"><span>Classification Report</span></label>`;
          detailsHtml += `<pre style="font-size: 9.5px; padding: 6px; background: #fafafa; border: 1px solid #ddd; overflow: auto; white-space: pre-wrap; font-family: monospace;">${escapeHtml(res.classification_report)}</pre>`;
        }
      } else if (res.task_type === "object_detection") {
        detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Total Targets Count:</b> ${res.lowest_precision_class}</p>`;
        detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Total Predictions Count:</b> ${res.lowest_recall_class}</p>`;
        if (res.top_confusion && res.top_confusion !== "None") {
          detailsHtml += `<p style="margin: 4px 0; font-size: 11px;"><b>Top Class AP:</b> ${escapeHtml(res.top_confusion)}</p>`;
        }
      }
      
      detailsCard.innerHTML = detailsHtml;
      els.nodeForm.appendChild(detailsCard);
    }
  }

  if (node.type === "responsible_ai") {
    const { datasetNode, trainerNode, predictorNode } = getRAIInput(node.id);
    if (!datasetNode && !trainerNode && !predictorNode) {
      const msg = document.createElement("div");
      msg.className = "empty-inspector";
      msg.textContent = "Please connect a Dataset, Trainer, or Predictor node to this Responsible AI node.";
      els.nodeForm.appendChild(msg);
      return;
    }

    if (datasetNode) {
      const dsId = datasetNode.config.datasetId;
      const dObj = state.availableDatasets.find(x => x.id === dsId);
      const dsName = dObj ? dObj.name : (dsId || "Not configured");

      const dsCard = document.createElement("div");
      dsCard.className = "sample-card";
      dsCard.style.marginBottom = "10px";
      dsCard.innerHTML = `
        <strong>Connected Dataset</strong>
        <p><b>Name:</b> ${dsName}</p>
      `;
      els.nodeForm.appendChild(dsCard);

      const validateBtn = document.createElement("button");
      validateBtn.type = "button";
      validateBtn.className = "button primary";
      validateBtn.style.width = "100%";
      validateBtn.style.marginBottom = "10px";
      validateBtn.innerHTML = '<i data-lucide="shield-check"></i> Generate Dataset Card';
      if (!dsId) {
        validateBtn.disabled = true;
        validateBtn.title = "Please select a dataset in the Dataset node first.";
      }
      if (node.config.status === "running") {
        validateBtn.disabled = true;
      }
      validateBtn.addEventListener("click", () => {
        runRAIAnalysis(node.id, "dataset");
      });
      els.nodeForm.appendChild(validateBtn);
    }

    if (trainerNode) {
      const jobId = trainerNode.config.jobId;
      const isCompleted = trainerNode.config.status === "completed";

      const trainerCard = document.createElement("div");
      trainerCard.className = "sample-card";
      trainerCard.style.marginBottom = "10px";
      trainerCard.innerHTML = `
        <strong>Connected Trainer</strong>
        <p><b>Job ID:</b> ${jobId ? `<code>${jobId.slice(0, 8)}</code>` : "None"}</p>
        <p><b>Status:</b> ${trainerNode.config.status || "idle"}</p>
      `;
      els.nodeForm.appendChild(trainerCard);

      const mCardBtn = document.createElement("button");
      mCardBtn.type = "button";
      mCardBtn.className = "button primary";
      mCardBtn.style.width = "100%";
      mCardBtn.style.marginBottom = "10px";
      mCardBtn.innerHTML = '<i data-lucide="file-text"></i> Generate Model Card';
      if (!isCompleted || !jobId) {
        mCardBtn.disabled = true;
        mCardBtn.title = "Trainer must be in completed status first.";
      }
      if (node.config.status === "running") {
        mCardBtn.disabled = true;
      }
      mCardBtn.addEventListener("click", () => {
        runRAIAnalysis(node.id, "model");
      });
      els.nodeForm.appendChild(mCardBtn);
    }

    if (predictorNode) {
      const predCard = document.createElement("div");
      predCard.className = "sample-card";
      predCard.style.marginBottom = "10px";
      predCard.innerHTML = `
        <strong>Connected Predictor</strong>
        <p><b>xAI Method:</b> ${predictorNode.config.explain_method || "none"}</p>
      `;
      els.nodeForm.appendChild(predCard);

      if (predictorNode.config.explanationImage) {
        const xaiLabel = document.createElement("label");
        xaiLabel.style.marginTop = "10px";
        xaiLabel.innerHTML = "<span>xAI Explanation Heatmap</span>";
        
        const xaiImg = document.createElement("img");
        xaiImg.src = predictorNode.config.explanationImage;
        xaiImg.style.width = "100%";
        xaiImg.style.borderRadius = "3px";
        xaiImg.style.border = "1px solid var(--line-strong)";
        xaiLabel.appendChild(xaiImg);
        els.nodeForm.appendChild(xaiLabel);
      } else {
        const noXai = document.createElement("div");
        noXai.className = "empty-inspector";
        noXai.style.marginTop = "10px";
        noXai.textContent = "No xAI explanation heatmap generated yet. Run a prediction on the Predictor node first.";
        els.nodeForm.appendChild(noXai);
      }
    }

    if (node.config.status === "running") {
      const runDiv = document.createElement("div");
      runDiv.className = "empty-inspector";
      runDiv.innerHTML = '<i data-lucide="loader-2" class="spin" style="margin-right:8px;"></i> Running Responsible AI analysis...';
      els.nodeForm.appendChild(runDiv);
    }

    if (node.config.status === "error" && node.config.error) {
      const errCard = document.createElement("div");
      errCard.className = "sample-card";
      errCard.style.borderColor = "var(--danger)";
      errCard.style.color = "var(--danger)";
      errCard.style.marginTop = "10px";
      errCard.innerHTML = `<strong>Analysis Error</strong><p>${escapeHtml(node.config.error)}</p>`;
      els.nodeForm.appendChild(errCard);
    }

    if (node.config.status === "completed" && node.config.reportMarkdown) {
      const reportTitle = node.config.cardType === "dataset" ? "Dataset Card Report" : "Model Card Report";
      const reportHeader = document.createElement("h4");
      reportHeader.style.marginTop = "15px";
      reportHeader.style.marginBottom = "5px";
      reportHeader.style.fontSize = "13px";
      reportHeader.style.fontWeight = "700";
      reportHeader.style.color = "var(--primary)";
      reportHeader.textContent = reportTitle;
      els.nodeForm.appendChild(reportHeader);

      const reportDiv = document.createElement("div");
      reportDiv.className = "sample-card";
      reportDiv.style.background = "#ffffff";
      reportDiv.style.maxHeight = "350px";
      reportDiv.style.overflowY = "auto";
      reportDiv.style.border = "1px solid #d2d6de";
      reportDiv.style.padding = "10px 12px";
      reportDiv.style.fontSize = "12px";
      reportDiv.style.lineHeight = "1.5";
      
      reportDiv.innerHTML = parseMarkdownToHtml(node.config.reportMarkdown);
      els.nodeForm.appendChild(reportDiv);

      if (node.config.cardType === "dataset" && node.config.classDistributionPlot) {
        const plotLabel = document.createElement("label");
        plotLabel.style.marginTop = "10px";
        plotLabel.innerHTML = "<span>Class Distribution Plot</span>";
        
        const plotImg = document.createElement("img");
        plotImg.src = node.config.classDistributionPlot;
        plotImg.style.width = "100%";
        plotImg.style.borderRadius = "3px";
        plotImg.style.border = "1px solid var(--line-strong)";
        
        plotLabel.appendChild(plotImg);
        els.nodeForm.appendChild(plotLabel);
      }
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

async function startPipelineTraining(trainerId, datasetObj, cfg) {
  try {
    const trainerNode = getNode(trainerId);
    if (!trainerNode) return;
    
    logEvent("Pipeline starting", `Configuring training for ${cfg.name}...`);
    
    const num_classes = datasetObj.classes ? datasetObj.classes.length : 2;
    let image_size = [224, 224];
    if (cfg.image_size) {
      const parts = cfg.image_size.split(",").map(p => parseInt(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        image_size = parts;
      }
    }
    
    const payload = {
      name: cfg.name,
      project_id: PROJECT_ID,
      task_type: cfg.task_type,
      architecture: cfg.architecture,
      num_classes: num_classes,
      batch_size: parseInt(cfg.batch_size) || 8,
      epochs: parseInt(cfg.epochs) || 5,
      learning_rate: parseFloat(cfg.learning_rate) || 0.001,
      image_size: image_size,
      augmentation_enabled: cfg.augmentation_enabled,
      early_stopping: cfg.early_stopping,
      patience: 3,
    };
    
    const pipeRes = await fetch("/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (!pipeRes.ok) throw new Error("Failed to create pipeline configuration");
    const jobData = await pipeRes.json();
    const jobId = jobData.id;
    
    trainerNode.config.jobId = jobId;
    trainerNode.config.status = "pending";
    trainerNode.config.logs = ["Pipeline created. Linking dataset..."];
    renderWorkflow();
    renderInspector();
    
    const linkRes = await fetch(`/pipelines/${jobId}/dataset/${datasetObj.id}`, {
      method: "POST"
    });
    if (!linkRes.ok) throw new Error("Failed to link dataset to pipeline");
    
    trainerNode.config.logs.push("Dataset linked. Starting training task...");
    renderInspector();
    
    const trainRes = await fetch(`/pipelines/${jobId}/train`, {
      method: "POST"
    });
    if (!trainRes.ok) throw new Error("Failed to initiate training task");
    
    trainerNode.config.status = "running";
    trainerNode.config.logs.push("Training job triggered in background.");
    saveWorkflow();
    renderWorkflow();
    renderInspector();
    
    startTrainerPolling(trainerId, jobId);
    
  } catch (error) {
    const trainerNode = getNode(trainerId);
    if (trainerNode) {
      trainerNode.config.status = "error";
      trainerNode.config.logs.push(`ERROR: ${error.message}`);
      saveWorkflow();
      renderWorkflow();
      renderInspector();
    }
    logEvent("Training failed", error.message);
  }
}

function startTrainerPolling(trainerId, jobId) {
  if (state.pollingTimers[trainerId]) {
    clearInterval(state.pollingTimers[trainerId]);
  }
  
  const timer = setInterval(async () => {
    try {
      const response = await fetch(`/pipelines/${jobId}`);
      if (!response.ok) return;
      
      const data = await response.json();
      const trainerNode = getNode(trainerId);
      if (!trainerNode) {
        clearInterval(timer);
        return;
      }
      
      trainerNode.config.status = data.status.toLowerCase();
      trainerNode.config.logs = data.logs || [];
      trainerNode.config.metrics = data.metrics || {};
      
      const isFinished = ["completed", "failed", "success"].includes(trainerNode.config.status);
      if (isFinished) {
        clearInterval(timer);
        delete state.pollingTimers[trainerId];
        
        if (trainerNode.config.status === "success" || trainerNode.config.status === "completed") {
          trainerNode.config.status = "completed";
          logEvent("Training Complete", `Pipeline ${trainerId} completed training successfully!`);
        } else {
          logEvent("Training Failed", `Pipeline ${trainerId} failed during training.`);
        }
        
        saveWorkflow();
        renderWorkflow();
      }
      
      if (state.selectedNodeId === trainerId) {
        renderInspector();
      }
    } catch (e) {
      console.warn("Error polling job status:", e);
    }
  }, 2000);
  
  state.pollingTimers[trainerId] = timer;
}

function resumeActiveTrainerPolling() {
  for (const node of state.workflow.nodes) {
    if (node.type === "trainer" && ["pending", "running"].includes(node.config.status) && node.config.jobId) {
      logEvent("Resuming check", `Resuming status polling for pipeline job ${node.config.jobId}`);
      startTrainerPolling(node.id, node.config.jobId);
    }
  }
}

async function runPipelinePrediction(predictorId, jobId, file, imageUrl) {
  const predictorNode = getNode(predictorId);
  if (!predictorNode) return;

  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  }
  if (imageUrl) {
    formData.append("image_url", imageUrl);
  }
  formData.append("confidence_threshold", predictorNode.config.confidence_threshold ?? 0.5);
  formData.append("explain_method", predictorNode.config.explain_method || "none");
  
  const response = await fetch(`/predict/${jobId}`, {
    method: "POST",
    body: formData,
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Prediction failed");
  }
  
  const data = await response.json();
  predictorNode.config.predictions = data;
  
  if (data.explanation_image) {
    predictorNode.config.explanationImage = `data:image/png;base64,${data.explanation_image}`;
  } else {
    predictorNode.config.explanationImage = "";
  }
  
  if (data.annotated_image) {
    predictorNode.config.annotatedImage = `data:image/jpeg;base64,${data.annotated_image}`;
    saveWorkflow();
    renderInspector();
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      predictorNode.config.annotatedImage = e.target.result;
      saveWorkflow();
      renderInspector();
    };
    reader.readAsDataURL(file);
  }
  
  // Construct a detailed log summary
  let logDetail = "Processed inference on test file.";
  if (data.predictions && Array.isArray(data.predictions) && data.predictions.length > 0) {
    const top = data.predictions[0];
    logDetail = `Top class: ${top.class_name} (${top.confidence.toFixed(1)}%)`;
  } else if (data.detections && Array.isArray(data.detections)) {
    logDetail = `Detected ${data.detections.length} objects.`;
    if (data.detections.length > 0) {
      const summary = data.detections.map(d => `${d.class_name} (${d.confidence.toFixed(1)}%)`).slice(0, 3).join(", ");
      logDetail += ` (${summary}${data.detections.length > 3 ? '...' : ''})`;
    }
  } else if (data.instances && Array.isArray(data.instances)) {
    logDetail = `Segmented ${data.instances.length} instances.`;
    if (data.instances.length > 0) {
      const summary = data.instances.map(ins => {
        const conf = typeof ins.confidence === 'number' ? (ins.confidence * 100).toFixed(1) : ins.confidence;
        return `${ins.class_name || ins.class_id} (${conf}%)`;
      }).slice(0, 3).join(", ");
      logDetail += ` (${summary}${data.instances.length > 3 ? '...' : ''})`;
    }
  }
  
  logEvent("Prediction successful", logDetail);
  saveWorkflow();
}

async function runModelEvaluation(evaluatorId, jobId) {
  const evaluatorNode = getNode(evaluatorId);
  if (!evaluatorNode) return;
  
  evaluatorNode.config.status = "running";
  evaluatorNode.config.error = null;
  evaluatorNode.config.results = null;
  renderWorkflow();
  renderInspector();
  
  try {
    logEvent("Evaluation starting", `Triggering evaluation task for model ${jobId}...`);
    const response = await fetch(`/pipelines/${jobId}/evaluate`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || "Evaluation failed");
    }
    const data = await response.json();
    evaluatorNode.config.status = "completed";
    evaluatorNode.config.results = data;
    logEvent("Evaluation complete", `Successfully evaluated job ${jobId}. Accuracy/mAP: ${(data.accuracy * 100).toFixed(1)}%`);
  } catch (error) {
    evaluatorNode.config.status = "error";
    evaluatorNode.config.error = error.message;
    logEvent("Evaluation failed", error.message);
  }
  saveWorkflow();
  renderWorkflow();
  renderInspector();
}

async function runRAIAnalysis(raiId, type) {
  const raiNode = getNode(raiId);
  if (!raiNode) return;
  
  const { datasetNode, trainerNode } = getRAIInput(raiId);
  
  raiNode.config.status = "running";
  raiNode.config.error = null;
  raiNode.config.reportMarkdown = "";
  raiNode.config.classDistributionPlot = "";
  renderWorkflow();
  renderInspector();
  
  try {
    if (type === "dataset" && datasetNode) {
      const dsId = datasetNode.config.datasetId;
      logEvent("RAI Data Card starting", `Validating dataset ${dsId}...`);
      const response = await fetch(`/responsible-ai/dataset-validation/${dsId}`, {
        method: "POST"
      });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Dataset validation failed");
      }
      const data = await response.json();
      raiNode.config.status = "completed";
      raiNode.config.cardType = "dataset";
      raiNode.config.reportMarkdown = data.data_card_markdown;
      if (data.distribution_plot_base64) {
        raiNode.config.classDistributionPlot = `data:image/png;base64,${data.distribution_plot_base64}`;
      }
      logEvent("RAI Analysis complete", `Data Card generated successfully for dataset ${dsId}.`);
    } else if (type === "model" && trainerNode) {
      const jobId = trainerNode.config.jobId;
      logEvent("RAI Model Card starting", `Generating model card for job ${jobId}...`);
      const response = await fetch(`/pipelines/${jobId}/model-card`);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Model card generation failed");
      }
      const data = await response.json();
      raiNode.config.status = "completed";
      raiNode.config.cardType = "model";
      raiNode.config.reportMarkdown = data.model_card_markdown;
      logEvent("RAI Analysis complete", `Model Card generated successfully for job ${jobId}.`);
    } else {
      throw new Error("Invalid RAI configuration or missing connection.");
    }
  } catch (error) {
    raiNode.config.status = "error";
    raiNode.config.error = error.message;
    logEvent("RAI Analysis failed", error.message);
  }
  saveWorkflow();
  renderWorkflow();
  renderInspector();
}

async function fetchAvailableDatasets() {
  try {
    const response = await fetch("/datasets/available");
    if (response.ok) {
      state.availableDatasets = await response.json();
    }
  } catch (error) {
    console.warn("Failed to fetch available datasets:", error);
  }
}

function addNodeToCanvas(type, x, y) {
  const node = makeNode(type, { x, y });
  state.workflow.nodes.push(node);
  selectNode(node.id);
  saveWorkflow();
  renderWorkflow();
  renderEdges();
}

function removeNode(id) {
  const node = getNode(id);
  if (!node) return;
  
  if (state.pollingTimers[id]) {
    clearInterval(state.pollingTimers[id]);
    delete state.pollingTimers[id];
  }
  
  state.workflow.nodes = state.workflow.nodes.filter((item) => item.id !== id);
  state.workflow.edges = state.workflow.edges.filter(([fromId, toId]) => fromId !== id && toId !== id);
  
  if (state.selectedNodeId === id) {
    state.selectedNodeId = state.workflow.nodes[0]?.id || null;
  }
  
  saveWorkflow();
  renderWorkflow();
  renderInspector();
  renderEdges();
  logEvent("Node removed", `${node.title} was removed.`);
}

function removeEdge(index) {
  const [fromId, toId] = state.workflow.edges[index] || [];
  state.workflow.edges.splice(index, 1);
  saveWorkflow();
  renderEdges();
  renderInspector();
  if (fromId && toId) {
    logEvent("Connection removed", `${getNode(fromId)?.title} -> ${getNode(toId)?.title}`);
  }
}

function connectNodes(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;
  
  const fromNode = getNode(fromId);
  const toNode = getNode(toId);
  if (!fromNode || !toNode) return;
  
  if (fromNode.type === "dataset" && !["trainer", "responsible_ai"].includes(toNode.type)) {
    logEvent("Connection Refused", "Dataset nodes must connect to Trainer or Responsible AI nodes.");
    return;
  }
  if (fromNode.type === "model_config" && toNode.type !== "trainer") {
    logEvent("Connection Refused", "Model Config nodes must connect to Trainer nodes.");
    return;
  }
  if (fromNode.type === "trainer" && !["predictor", "evaluator", "responsible_ai"].includes(toNode.type)) {
    logEvent("Connection Refused", "Trainer nodes must connect to Predictor, Evaluator, or Responsible AI nodes.");
    return;
  }
  if (fromNode.type === "predictor" && toNode.type !== "responsible_ai") {
    logEvent("Connection Refused", "Predictor nodes must connect to Responsible AI nodes.");
    return;
  }
  
  const exists = state.workflow.edges.some(([from, to]) => from === fromId && to === toId);
  if (exists) return;
  
  state.workflow.edges.push([fromId, toId]);
  saveWorkflow();
  renderEdges();
  renderInspector();
  logEvent("Connection added", `${fromNode.title} &rarr; ${toNode.title}`);
}

function selectNode(id) {
  state.selectedNodeId = id;
  renderWorkflow();
  renderInspector();
}

function selectNodeByType(type) {
  const node = state.workflow.nodes.find((item) => item.type === type);
  if (node) selectNode(node.id);
}

function getTrainerInputs(trainerId) {
  const incoming = state.workflow.edges.filter(edge => edge[1] === trainerId);
  let datasetNode = null;
  let configNode = null;
  for (const edge of incoming) {
    const fromNode = getNode(edge[0]);
    if (!fromNode) continue;
    if (fromNode.type === "dataset") datasetNode = fromNode;
    else if (fromNode.type === "model_config") configNode = fromNode;
  }
  return { datasetNode, configNode };
}

function getPredictorInput(predictorId) {
  const edge = state.workflow.edges.find(edge => edge[1] === predictorId);
  if (!edge) return null;
  return getNode(edge[0]);
}

function getEvaluatorInput(evaluatorId) {
  const edge = state.workflow.edges.find(edge => edge[1] === evaluatorId);
  if (!edge) return null;
  return getNode(edge[0]);
}

function getRAIInput(raiId) {
  const incoming = state.workflow.edges.filter(edge => edge[1] === raiId);
  let datasetNode = null;
  let trainerNode = null;
  let predictorNode = null;
  for (const edge of incoming) {
    const fromNode = getNode(edge[0]);
    if (!fromNode) continue;
    if (fromNode.type === "dataset") datasetNode = fromNode;
    else if (fromNode.type === "trainer") trainerNode = fromNode;
    else if (fromNode.type === "predictor") predictorNode = fromNode;
  }
  return { datasetNode, trainerNode, predictorNode };
}

function getNode(id) {
  return state.workflow.nodes.find((node) => node.id === id);
}

function selectedNode() {
  return getNode(state.selectedNodeId);
}

function nodeElement(id) {
  return Array.from(els.nodeLayer.children).find((element) => element.dataset.nodeId === id);
}

function portPoint(nodeId, port) {
  const node = getNode(nodeId);
  const canvasRect = els.workflowCanvas.getBoundingClientRect();
  const portElement = nodeElement(nodeId)?.querySelector(`[data-port="${port}"]`);
  if (portElement) {
    const portRect = portElement.getBoundingClientRect();
    return {
      x: portRect.left + portRect.width / 2 - canvasRect.left,
      y: portRect.top + portRect.height / 2 - canvasRect.top,
    };
  }
  return {
    x: node.x + (port === "out" ? NODE_WIDTH : 0),
    y: node.y + NODE_PORT_Y,
  };
}

function startDrag(event, nodeId) {
  if (event.target.closest("button, .node-port")) return;
  const node = getNode(nodeId);
  if (!node) return;
  const rect = els.workflowCanvas.getBoundingClientRect();
  state.dragging = {
    nodeId,
    offsetX: event.clientX - rect.left - node.x,
    offsetY: event.clientY - rect.top - node.y,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  selectNode(nodeId);
}

function onDragMove(event) {
  if (!state.dragging) return;
  const node = getNode(state.dragging.nodeId);
  if (!node) return;
  const rect = els.workflowCanvas.getBoundingClientRect();
  node.x = clamp(event.clientX - rect.left - state.dragging.offsetX, CANVAS_PADDING, rect.width - NODE_WIDTH - CANVAS_PADDING);
  node.y = clamp(event.clientY - rect.top - state.dragging.offsetY, CANVAS_PADDING, rect.height - NODE_HEIGHT - CANVAS_PADDING);
  renderWorkflow();
  renderEdges();
}

function startConnection(event, nodeId) {
  event.preventDefault();
  event.stopPropagation();
  const node = getNode(nodeId);
  if (!node) return;
  const start = portPoint(nodeId, "out");
  state.connecting = {
    fromId: nodeId,
    startX: start.x,
    startY: start.y,
    currentX: start.x,
    currentY: start.y,
  };
  selectNode(nodeId);
  renderEdges();
}

function onConnectionMove(event) {
  if (!state.connecting) return;
  const point = canvasPoint(event);
  state.connecting.currentX = point.x;
  state.connecting.currentY = point.y;
  renderEdges();
}

function stopPointerAction(event) {
  const wasDragging = Boolean(state.dragging);
  if (state.connecting) {
    const targetPort = document.elementFromPoint(event.clientX, event.clientY)?.closest(".node-port.in");
    const toId = targetPort?.closest(".workflow-node")?.dataset.nodeId;
    connectNodes(state.connecting.fromId, toId);
    state.connecting = null;
    renderEdges();
  }
  if (state.dragging) {
    state.dragging = null;
  }
  if (wasDragging) {
    saveWorkflow();
  }
}

function canvasPoint(event) {
  const rect = els.workflowCanvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function connectionPath(startX, startY, endX, endY) {
  const direction = endX >= startX ? 1 : -1;
  const curve = Math.max(70, Math.abs(endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + curve * direction} ${startY}, ${endX - curve * direction} ${endY}, ${endX} ${endY}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseTables(text) {
  const lines = text.split("\n");
  let inTable = false;
  let tableRows = [];
  let result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      inTable = true;
      tableRows.push(line);
    } else {
      if (inTable) {
        const htmlTable = renderHtmlTable(tableRows);
        result.push(htmlTable);
        tableRows = [];
        inTable = false;
      }
      result.push(lines[i]);
    }
  }
  if (inTable && tableRows.length > 0) {
    result.push(renderHtmlTable(tableRows));
  }
  return result.join("\n");
}

function renderHtmlTable(rows) {
  if (rows.length < 2) return rows.join("\n");
  const headers = rows[0].split("|").slice(1, -1).map(h => h.trim());
  const dataRows = rows.slice(2);
  
  let html = `<table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 11.5px; border: 1px solid #ddd;">`;
  html += `<thead><tr style="background: #f4f4f4; border-bottom: 2px solid #ddd;">`;
  headers.forEach(h => {
    html += `<th style="padding: 6px 8px; border: 1px solid #ddd; font-weight: 700; text-align: left;">${h}</th>`;
  });
  html += `</tr></thead><tbody>`;
  
  dataRows.forEach(row => {
    const cells = row.split("|").slice(1, -1).map(c => c.trim());
    html += `<tr style="border-bottom: 1px solid #eee;">`;
    cells.forEach(c => {
      html += `<td style="padding: 6px 8px; border: 1px solid #ddd;">${c}</td>`;
    });
    html += `</tr>`;
  });
  
  html += `</tbody></table>`;
  return html;
}

function parseMarkdownToHtml(md) {
  if (!md) return "";
  let processed = parseTables(md);
  return processed
    .replace(/^# (.*$)/gim, '<h3 style="margin-top: 15px; margin-bottom: 5px; border-bottom: 1px solid #eee; padding-bottom: 3px; font-size: 14px; font-weight: 700; color: #333;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h4 style="margin-top: 12px; margin-bottom: 5px; font-size: 13px; font-weight: 700; color: #444;">$1</h4>')
    .replace(/^### (.*$)/gim, '<h5 style="margin-top: 10px; margin-bottom: 3px; font-size: 12px; font-weight: 700; color: #555;">$1</h5>')
    .replace(/^\* (.*$)/gim, '<li style="margin-left: 15px; font-size: 11.5px; margin-bottom: 3px;">$1</li>')
    .replace(/^- (.*$)/gim, '<li style="margin-left: 15px; font-size: 11.5px; margin-bottom: 3px;">$1</li>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-size: 90%; font-family: monospace;">$1</code>')
    .replace(/\n/g, '<br>');
}

function logEvent(title, detail) {
  const item = document.createElement("li");
  item.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
  els.eventLog.prepend(item);
  while (els.eventLog.children.length > 8) {
    els.eventLog.lastChild.remove();
  }
}

function showContextMenu(clientX, clientY, nodeId) {
  const node = getNode(nodeId);
  if (!node) return;
  state.contextMenuNodeId = nodeId;
  els.contextMenu.hidden = false;
  const rect = els.contextMenu.getBoundingClientRect();
  const x = Math.min(clientX, window.innerWidth - rect.width - 6);
  const y = Math.min(clientY, window.innerHeight - rect.height - 6);
  els.contextMenu.style.left = `${Math.max(6, x)}px`;
  els.contextMenu.style.top = `${Math.max(6, y)}px`;
  if (window.lucide) window.lucide.createIcons();
}

function hideContextMenu() {
  if (!els.contextMenu || els.contextMenu.hidden) return;
  els.contextMenu.hidden = true;
  state.contextMenuNodeId = null;
}

function renameNode(nodeId) {
  const node = getNode(nodeId);
  if (!node) return;
  const current = node.title || "";
  const next = window.prompt("Rename node", current);
  if (next === null) return;
  const trimmed = next.trim();
  if (trimmed) {
    node.title = trimmed;
    renderWorkflow();
    renderInspector();
    saveWorkflow();
  }
}

function makeSelectField(name, label, value, options, onChange) {
  const wrapper = makeLabel(label);
  const select = document.createElement("select");
  select.name = name;
  for (const [optionValue, optionLabel] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionLabel;
    option.selected = optionValue === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

function makeTextField(name, label, value, onChange) {
  const wrapper = makeLabel(label);
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.value = String(value ?? "");
  input.addEventListener("input", () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function makeNumberField(name, label, value, min, max, onChange, step = 1) {
  const wrapper = makeLabel(label);
  const input = document.createElement("input");
  input.type = "number";
  input.name = name;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onChange(Number(input.value)));
  wrapper.appendChild(input);
  return wrapper;
}

function makeSliderField(name, label, value, min, max, step, onChange) {
  const wrapper = makeLabel(label);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.name = name;
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.style.cssText = "flex:1;accent-color:var(--primary);";

  const display = document.createElement("span");
  display.style.cssText = "min-width:38px;text-align:right;font-size:12px;font-weight:600;color:var(--ink);";
  display.textContent = Number(value).toFixed(2);

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    display.textContent = v.toFixed(2);
    onChange(v);
  });

  row.append(slider, display);
  wrapper.appendChild(row);
  return wrapper;
}

function makeToggleField(name, label, value, onChange) {
  const wrapper = document.createElement("label");
  wrapper.className = "checkbox-row";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  input.checked = value;
  input.addEventListener("change", () => onChange(input.checked));
  wrapper.append(text, input);
  return wrapper;
}

function makeLabel(label) {
  const wrapper = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = label;
  wrapper.appendChild(text);
  return wrapper;
}

function drawConfusionMatrix(samples, classes) {
  const size = classes.length;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const rowTotals = Array(size).fill(0);
  
  samples.forEach(s => {
    const trueIdx = classes.indexOf(s.true_label);
    const predIdx = classes.indexOf(s.predicted_label);
    if (trueIdx !== -1 && predIdx !== -1) {
      matrix[trueIdx][predIdx]++;
      rowTotals[trueIdx]++;
    }
  });

  let html = `
    <div class="confusion-matrix-wrapper" style="margin-top: 15px;">
      <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Confusion Matrix Heatmap</div>
      <div style="overflow-x: auto; max-width: 100%; border: 1px solid #ddd; border-radius: var(--radius); background: #ffffff;">
        <table style="border-collapse: collapse; margin: 10px auto; font-size: 10px; text-align: center;">
          <thead>
            <tr>
              <th style="border: none; padding: 2px;"></th>
              <th style="border: none; padding: 2px; font-weight: 700; color: var(--muted);" colspan="${size + 1}">Predicted Class</th>
            </tr>
            <tr>
              <th style="border: none; padding: 2px;"></th>
              <th style="border: none; padding: 2px;"></th>
  `;
  
  classes.forEach(c => {
    html += `<th style="border: 1px solid #ddd; padding: 4px 6px; font-weight: 600; min-width: 45px; max-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(c)}">${escapeHtml(c.slice(0, 6))}</th>`;
  });
  html += `
            </tr>
          </thead>
          <tbody>
  `;
  
  for (let r = 0; r < size; r++) {
    html += `<tr>`;
    if (r === 0) {
      html += `<td style="border: none; padding: 4px; font-weight: 700; color: var(--muted); vertical-align: middle; width: 15px; white-space: nowrap; writing-mode: vertical-rl; transform: rotate(180deg);" rowspan="${size}">True Class</td>`;
    }
    html += `<td style="border: 1px solid #ddd; padding: 4px 6px; font-weight: 600; text-align: right; max-width: 70px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #fafafa;" title="${escapeHtml(classes[r])}">${escapeHtml(classes[r].slice(0, 6))}</td>`;
    
    for (let c = 0; c < size; c++) {
      const val = matrix[r][c];
      const rowTotal = rowTotals[r] || 1;
      const pct = val / rowTotal;
      const bg = val > 0 ? `rgba(60, 141, 188, ${0.1 + pct * 0.9})` : '#ffffff';
      const color = pct > 0.5 ? '#ffffff' : '#333333';
      html += `<td style="border: 1px solid #ddd; padding: 6px; background-color: ${bg}; color: ${color}; font-weight: 700;" title="True: ${escapeHtml(classes[r])}, Pred: ${escapeHtml(classes[c])} (${val} times)">${val}</td>`;
    }
    html += `</tr>`;
  }
  
  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  return html;
}

function drawClassMetricsPlot(classMetrics, taskType) {
  let html = `
    <div class="class-metrics-wrapper" style="margin-top: 15px;">
      <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">
        ${taskType === "object_detection" ? "Average Precision (AP) per Class" : "F1-Score per Class"}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
  `;
  
  classMetrics.forEach(m => {
    const score = m.f1_score; 
    const pct = (score * 100).toFixed(1);
    
    let progressBg = "var(--primary)";
    if (score < 0.5) {
      progressBg = "var(--danger)";
    } else if (score < 0.75) {
      progressBg = "var(--warning)";
    } else {
      progressBg = "var(--ok)";
    }
    
    html += `
      <div style="font-size: 11.5px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
          <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 220px;" title="${escapeHtml(m.class_name)}">${escapeHtml(m.class_name)}</span>
          <span style="font-weight: 700; color: #555;">${pct}%</span>
        </div>
        <div style="background: #e9ecef; border-radius: 3px; height: 6px; width: 100%; overflow: hidden; border: 1px solid #ddd;">
          <div style="background: ${progressBg}; width: ${pct}%; height: 100%; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  });
  
  html += `
    </div>
  </div>
  `;
  
  return html;
}

// --- Lightbox Functions (Global) ---
window.openLightbox = function(imgSrc) {
  let overlay = document.getElementById("lightboxOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "lightboxOverlay";
    overlay.className = "lightbox-overlay";
    overlay.innerHTML = `
      <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
      <div class="lightbox-content">
        <img id="lightboxImage" class="lightbox-image" src="" />
      </div>
    `;
    overlay.onclick = (e) => {
      if (e.target === overlay) closeLightbox();
    };
    document.body.appendChild(overlay);
  }
  
  const img = document.getElementById("lightboxImage");
  img.src = imgSrc;
  overlay.classList.add("active");
};

window.closeLightbox = function() {
  const overlay = document.getElementById("lightboxOverlay");
  if (overlay) {
    overlay.classList.remove("active");
  }
};

window.fetchTrainingCurves = async function(jobId, btn) {
  try {
    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Fetching...';
    btn.disabled = true;
    if (window.lucide) window.lucide.createIcons();
    
    const response = await fetch(`/pipelines/${jobId}/training-metrics`);
    if (!response.ok) throw new Error("Failed to fetch training curves");
    
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    
    window.openLightbox(`data:image/png;base64,${data.training_curves_base64}`);
  } catch (e) {
    window.logEvent("Error fetching curves", e.message || "Failed to load metrics");
  } finally {
    btn.innerHTML = '<i data-lucide="line-chart"></i> View Training Curves';
    btn.disabled = false;
    if (window.lucide) window.lucide.createIcons();
  }
};
