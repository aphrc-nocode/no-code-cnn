import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import {
  Database,
  Sliders,
  Cpu,
  Eye,
  BarChart2,
  Shield,
  Trash2,
  Save,
  RefreshCw,
  Play,
  FileText,
  AlertCircle,
  Loader2,
  Plus,
  ChevronDown,
  MoreVertical
} from "lucide-react";
import api, { type Project } from "../api";

const NODE_WIDTH = 210;
const NODE_HEIGHT = 88;

interface NodeConfig {
  datasetId?: string;
  name?: string;
  task_type?: "image_classification" | "object_detection" | "image_segmentation";
  architecture?: string;
  epochs?: number;
  batch_size?: number;
  learning_rate?: number;
  image_size?: string;
  augmentation_enabled?: boolean;
  early_stopping?: boolean;
  jobId?: string;
  status?: string;
  logs?: string[];
  metrics?: Record<string, number>;
  predictions?: any;
  annotatedImage?: string;
  explain_method?: string;
  explanationImage?: string;
  confidence_threshold?: number;
  results?: any;
  error?: string | null;
  cardType?: string;
  reportMarkdown?: string;
  classDistributionPlot?: string;
}

interface WorkflowNode {
  id: string;
  type: "dataset" | "model_config" | "trainer" | "predictor" | "evaluator" | "responsible_ai";
  title: string;
  subtitle: string;
  x: number;
  y: number;
  enabled: boolean;
  config: NodeConfig;
}

type Edge = [string, string]; // [fromNodeId, toNodeId]

const NODE_BLUEPRINTS: Record<string, { title: string; subtitle: string; config: NodeConfig }> = {
  dataset: {
    title: "Dataset",
    subtitle: "Select dataset source",
    config: { datasetId: "" }
  },
  model_config: {
    title: "Model Config",
    subtitle: "Hyperparameters",
    config: {
      name: "Visual Pipeline",
      task_type: "image_classification",
      architecture: "resnet18",
      epochs: 5,
      batch_size: 8,
      learning_rate: 0.001,
      image_size: "224, 224",
      augmentation_enabled: true,
      early_stopping: true
    }
  },
  trainer: {
    title: "Trainer",
    subtitle: "Run pipeline training",
    config: { jobId: "", status: "idle", logs: [], metrics: {} }
  },
  predictor: {
    title: "Predictor",
    subtitle: "Run predictions",
    config: {
      predictions: null,
      annotatedImage: "",
      explain_method: "none",
      explanationImage: "",
      confidence_threshold: 0.5
    }
  },
  evaluator: {
    title: "Evaluator",
    subtitle: "Evaluate model performance",
    config: { status: "idle", results: null, error: null }
  },
  responsible_ai: {
    title: "Responsible AI",
    subtitle: "Dataset & Model cards",
    config: {
      status: "idle",
      cardType: "dataset",
      reportMarkdown: "",
      classDistributionPlot: "",
      error: null
    }
  }
};

const DEFAULT_WORKFLOW = {
  nodes: [
    { id: "dataset_1", type: "dataset", title: "Dataset", subtitle: "Select dataset source", x: 60, y: 80, enabled: true, config: { datasetId: "" } },
    { id: "model_config_1", type: "model_config", title: "Model Config", subtitle: "Hyperparameters", x: 60, y: 280, enabled: true, config: { name: "Visual Pipeline", task_type: "image_classification", architecture: "resnet18", epochs: 5, batch_size: 8, learning_rate: 0.001, image_size: "224, 224", augmentation_enabled: true, early_stopping: true } },
    { id: "trainer_1", type: "trainer", title: "Trainer", subtitle: "Run pipeline training", x: 360, y: 180, enabled: true, config: { jobId: "", status: "idle", logs: [], metrics: {} } },
    { id: "predictor_1", type: "predictor", title: "Predictor", subtitle: "Run predictions", x: 660, y: 180, enabled: true, config: { predictions: null, annotatedImage: "", explain_method: "none", explanationImage: "", confidence_threshold: 0.5 } }
  ] as WorkflowNode[],
  edges: [
    ["dataset_1", "trainer_1"],
    ["model_config_1", "trainer_1"],
    ["trainer_1", "predictor_1"]
  ] as Edge[]
};

export default function WorkflowBuilder() {
  const { id: projectIdParam } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const projectId = projectIdParam || searchParams.get("project_id") || "default_project";

  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("trainer_1");
  const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
  const [projectRuns, setProjectRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [workflowStatus, setWorkflowStatus] = useState<string>("Idle");
  const [evalSampleIndices, setEvalSampleIndices] = useState<Record<string, number>>({});

  // Popover + mobile panel state
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [activeMenuNodeId, setActiveMenuNodeId] = useState<string | null>(null);

  // Keyboard deletion hook
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        handleRemoveNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, nodes]);

  // Close menus on click-outside/global click
  useEffect(() => {
    const closeMenu = () => setActiveMenuNodeId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // Dragging state
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Port connection state
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectMousePos, setConnectMousePos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const pollingIntervals = useRef<Record<string, any>>({});

  // ─── Global Mouse Event Listeners for Smooth Dragging ─────────────────────
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (dragNodeId && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        // Compute position relative to canvas, accounting for scroll
        const x = e.clientX - rect.left + canvasRef.current.scrollLeft - dragOffset.x;
        const y = e.clientY - rect.top  + canvasRef.current.scrollTop  - dragOffset.y;
        setNodes(prev =>
          prev.map(n => (n.id === dragNodeId ? { ...n, x: Math.max(0, x), y: Math.max(0, y) } : n))
        );
      } else if (connectingFromId && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setConnectMousePos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
    };

    const handleGlobalMouseUp = () => {
      if (dragNodeId) {
        setDragNodeId(null);
        handleSaveWorkflow();
      }
      if (connectingFromId) {
        setConnectingFromId(null);
        setConnectMousePos(null);
      }
    };

    if (dragNodeId || connectingFromId) {
      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [dragNodeId, dragOffset, connectingFromId, nodes, edges]);

  // ─── Keyboard: Delete selected node on Delete/Backspace ──────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        e.preventDefault();
        handleRemoveNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedNodeId, nodes, edges]);

  // ─── Fetch Initial Data ──────────────────────────────────────────────────
  useEffect(() => {
    // Fetch Project Details
    api.get(`/projects/${projectId}`)
      .then(res => setProject(res.data))
      .catch(() => setProject({ id: Number(projectId) || 1, name: "Project", task_type: "classification", classes: [] }));

    // Fetch Datasets
    api.get(projectId ? `/datasets/available?project_id=${projectId}` : "/datasets/available")
      .then(res => setAvailableDatasets(res.data))
      .catch(() => setAvailableDatasets([]));

    // Fetch Workflows
    api.get(`/projects/${projectId}/workflow/canvas`)
      .then(res => {
        if (res.data && Array.isArray(res.data.nodes)) {
          setNodes(res.data.nodes);
          setEdges(res.data.edges || []);
          if (res.data.nodes.length > 0) {
            setSelectedNodeId(res.data.nodes[0].id);
          }
        } else {
          setNodes(structuredClone(DEFAULT_WORKFLOW.nodes));
          setEdges(structuredClone(DEFAULT_WORKFLOW.edges));
        }
      })
      .catch(() => {
        setNodes(structuredClone(DEFAULT_WORKFLOW.nodes));
        setEdges(structuredClone(DEFAULT_WORKFLOW.edges));
      });

    // Clean up timers on unmount
    return () => {
      Object.values(pollingIntervals.current).forEach(clearInterval);
    };
  }, [projectId]);

  // Save workflow back to the backend helper
  const handleSaveWorkflow = async (currentNodes = nodes, currentEdges = edges) => {
    try {
      setWorkflowStatus("Saving...");
      await api.post(`/projects/${projectId}/workflow/canvas`, {
        nodes: currentNodes,
        edges: currentEdges
      });
      setWorkflowStatus("Saved");
      setTimeout(() => setWorkflowStatus("Idle"), 2000);
    } catch {
      setWorkflowStatus("Save Failed");
      setTimeout(() => setWorkflowStatus("Idle"), 2000);
    }
  };

  const handleResetWorkflow = () => {
    if (window.confirm("Are you sure you want to reset the canvas to the default configuration?")) {
      setNodes(structuredClone(DEFAULT_WORKFLOW.nodes));
      setEdges(structuredClone(DEFAULT_WORKFLOW.edges));
      setSelectedNodeId("trainer_1");
      handleSaveWorkflow(DEFAULT_WORKFLOW.nodes, DEFAULT_WORKFLOW.edges);
    }
  };

  // ─── Add Node ───────────────────────────────────────────────────────────
  const handleAddNode = (type: string) => {
    const blueprint = NODE_BLUEPRINTS[type];
    const newNode: WorkflowNode = {
      id: `${type}_${Date.now()}`,
      type: type as any,
      title: blueprint.title,
      subtitle: blueprint.subtitle,
      x: 100 + Math.random() * 80,
      y: 100 + Math.random() * 80,
      enabled: true,
      config: structuredClone(blueprint.config)
    };
    const updated = [...nodes, newNode];
    setNodes(updated);
    setSelectedNodeId(newNode.id);
    handleSaveWorkflow(updated, edges);
  };

  const handleRemoveNode = (nodeId: string) => {
    const updatedNodes = nodes.filter(n => n.id !== nodeId);
    const updatedEdges = edges.filter(e => e[0] !== nodeId && e[1] !== nodeId);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(updatedNodes[0]?.id || null);
    }
    handleSaveWorkflow(updatedNodes, updatedEdges);
  };

  // ─── Node Dragging ───────────────────────────────────────────────────────
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).closest(".port")) return; // Don't drag if clicking port
    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    // Store offset between mouse position (canvas-relative) and node top-left
    setDragNodeId(nodeId);
    setDragOffset({
      x: e.clientX - rect.left + canvasRef.current.scrollLeft - node.x,
      y: e.clientY - rect.top  + canvasRef.current.scrollTop  - node.y
    });
  };



  // ─── Connections ────────────────────────────────────────────────────────
  const handleStartConnection = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setConnectingFromId(nodeId);
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setConnectMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  };

  const handleEndConnection = (e: React.MouseEvent, targetNodeId: string) => {
    e.stopPropagation();
    if (connectingFromId && connectingFromId !== targetNodeId) {
      // Avoid duplicate edges
      const edgeExists = edges.some(edge => edge[0] === connectingFromId && edge[1] === targetNodeId);
      if (!edgeExists) {
        const newEdges = [...edges, [connectingFromId, targetNodeId] as Edge];
        setEdges(newEdges);
        handleSaveWorkflow(nodes, newEdges);
      }
    }
    setConnectingFromId(null);
    setConnectMousePos(null);
  };

  // Node rendering helper coordinates for ports
  const getPortCoords = (nodeId: string, isOutput: boolean) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    return {
      x: node.x + (isOutput ? NODE_WIDTH : 0),
      y: node.y + NODE_HEIGHT / 2
    };
  };

  // ─── Trainer Operations ─────────────────────────────────────────────────
  const startTrainerPolling = (trainerId: string, jobId: string) => {
    if (pollingIntervals.current[trainerId]) {
      clearInterval(pollingIntervals.current[trainerId]);
    }
    
    pollingIntervals.current[trainerId] = setInterval(async () => {
      try {
        const res = await api.get(`/pipelines/${jobId}`);
        const status = res.data.status.toLowerCase();
        
        setNodes(prev => prev.map(node => {
          if (node.id === trainerId) {
            return {
              ...node,
              config: {
                ...node.config,
                status,
                logs: res.data.logs || [],
                metrics: res.data.metrics || {}
              }
            };
          }
          return node;
        }));

        if (["completed", "failed", "success"].includes(status)) {
          clearInterval(pollingIntervals.current[trainerId]);
          delete pollingIntervals.current[trainerId];
          handleSaveWorkflow();
        }
      } catch {
        // Continue polling or clear if persistent error
      }
    }, 2000);
  };

  const runTrainerJob = async (trainerId: string) => {
    const datasetEdge = edges.find(e => e[1] === trainerId && e[0].startsWith("dataset"));
    const configEdge = edges.find(e => e[1] === trainerId && e[0].startsWith("model_config"));
    
    if (!datasetEdge || !configEdge) {
      alert("Missing connections. Connect both a 'Dataset' node and a 'Model Config' node to the 'Trainer'.");
      return;
    }

    const dsNode = nodes.find(n => n.id === datasetEdge[0]);
    const cfgNode = nodes.find(n => n.id === configEdge[0]);

    if (!dsNode || !dsNode.config.datasetId) {
      alert("Please select a dataset in the Connected Dataset node first.");
      return;
    }
    if (!cfgNode) return;

    try {
      setWorkflowStatus("Starting training...");
      const config = cfgNode.config;
      const num_classes = 2; // custom default or from class distribution

      const payload = {
        name: config.name || "Visual Pipeline",
        project_id: projectId,
        task_type: config.task_type || "image_classification",
        architecture: config.architecture || "resnet18",
        num_classes,
        batch_size: Number(config.batch_size) || 8,
        epochs: Number(config.epochs) || 5,
        learning_rate: Number(config.learning_rate) || 0.001,
        image_size: [224, 224],
        augmentation_enabled: !!config.augmentation_enabled,
        early_stopping: !!config.early_stopping,
        patience: 3
      };

      // Create pipeline
      const pipeRes = await api.post("/pipelines", payload);
      const jobId = pipeRes.data.id;

      // Update node state
      setNodes(prev => prev.map(node => {
        if (node.id === trainerId) {
          return {
            ...node,
            config: {
              ...node.config,
              jobId,
              status: "pending",
              logs: ["Pipeline configuration created. Linking dataset..."]
            }
          };
        }
        return node;
      }));

      // Link dataset
      await api.post(`/pipelines/${jobId}/dataset/${dsNode.config.datasetId}`);

      // Start train
      await api.post(`/pipelines/${jobId}/train`);

      setNodes(prev => prev.map(node => {
        if (node.id === trainerId) {
          return {
            ...node,
            config: {
              ...node.config,
              status: "running",
              logs: [...(node.config.logs || []), "Training job triggered in background."]
            }
          };
        }
        return node;
      }));

      startTrainerPolling(trainerId, jobId);
      handleSaveWorkflow();
    } catch (e: any) {
      const errMsg = e.response?.data?.detail || e.message || "Failed to start training";
      setNodes(prev => prev.map(node => {
        if (node.id === trainerId) {
          return {
            ...node,
            config: {
              ...node.config,
              status: "error",
              error: errMsg
            }
          };
        }
        return node;
      }));
    }
  };

  // ─── Predictor Operations ──────────────────────────────────────────────
  const runPrediction = async (predictorId: string, imageFile: File) => {
    const trainerEdge = edges.find(e => e[1] === predictorId && e[0].startsWith("trainer"));
    if (!trainerEdge) {
      alert("Connect a 'Trainer' node to the 'Predictor' to perform predictions.");
      return;
    }
    const trainerNode = nodes.find(n => n.id === trainerEdge[0]);
    if (!trainerNode || !trainerNode.config.jobId) {
      alert("Connect a TRAINED model or wait for the Trainer node to complete training first.");
      return;
    }
    const predictorNode = nodes.find(n => n.id === predictorId);

    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      if (predictorNode) {
        formData.append("confidence_threshold", (predictorNode.config.confidence_threshold ?? 0.5).toString());
        formData.append("explain_method", predictorNode.config.explain_method || "none");
      }

      const url = `/predict/${trainerNode.config.jobId}`;
      const res = await api.post(url, formData);

      // Extract result data
      setNodes(prev => prev.map(node => {
        if (node.id === predictorId) {
          return {
            ...node,
            config: {
              ...node.config,
              predictions: res.data.predictions || res.data,
              annotatedImage: res.data.annotated_image ? `data:image/jpeg;base64,${res.data.annotated_image}` : "",
              explanationImage: res.data.explanation_image ? `data:image/png;base64,${res.data.explanation_image}` : ""
            }
          };
        }
        return node;
      }));
      handleSaveWorkflow();
    } catch (e: any) {
      alert(e.response?.data?.detail || "Prediction failed");
    }
  };

  // ─── Evaluator Operations ──────────────────────────────────────────────
  const runEvaluation = async (evaluatorId: string) => {
    const trainerEdge = edges.find(e => e[1] === evaluatorId && e[0].startsWith("trainer"));
    if (!trainerEdge) {
      alert("Connect a 'Trainer' node to the 'Evaluator' to measure performance.");
      return;
    }
    const trainerNode = nodes.find(n => n.id === trainerEdge[0]);
    if (!trainerNode || !trainerNode.config.jobId) {
      alert("Wait for the Trainer to run training first.");
      return;
    }

    try {
      setNodes(prev => prev.map(n => n.id === evaluatorId ? { ...n, config: { ...n.config, status: "running" } } : n));
      const res = await api.post(`/pipelines/${trainerNode.config.jobId}/evaluate`);
      setNodes(prev => prev.map(n => n.id === evaluatorId ? { ...n, config: { ...n.config, status: "completed", results: res.data } } : n));
      handleSaveWorkflow();
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || "Evaluation failed";
      setNodes(prev => prev.map(n => n.id === evaluatorId ? { ...n, config: { ...n.config, status: "error", error: errorMsg } } : n));
    }
  };

  // ─── Responsible AI Card Generator ─────────────────────────────────────
  const runResponsibleAI = async (raiId: string, cardType: "dataset" | "model") => {
    const datasetEdge = edges.find(e => e[1] === raiId && e[0].startsWith("dataset"));
    const trainerEdge = edges.find(e => e[1] === raiId && e[0].startsWith("trainer"));

    if (cardType === "dataset" && !datasetEdge) {
      alert("Connect a 'Dataset' node to generate a Dataset Card.");
      return;
    }
    if (cardType === "model" && !trainerEdge) {
      alert("Connect a 'Trainer' node to generate a Model Card.");
      return;
    }

    try {
      setNodes(prev => prev.map(n => n.id === raiId ? { ...n, config: { ...n.config, status: "running", cardType } } : n));
      
      let res;
      let reportMarkdown = "";
      let classDistributionPlot = "";
      
      if (cardType === "dataset") {
        const dsNode = nodes.find(n => n.id === datasetEdge![0]);
        res = await api.post(`/responsible-ai/dataset-validation/${dsNode?.config.datasetId}`);
        reportMarkdown = res.data.data_card_markdown || "";
        if (res.data.distribution_plot_base64) {
          classDistributionPlot = `data:image/png;base64,${res.data.distribution_plot_base64}`;
        }
      } else {
        const trNode = nodes.find(n => n.id === trainerEdge![0]);
        res = await api.get(`/pipelines/${trNode?.config.jobId}/model-card`);
        reportMarkdown = res.data.model_card_markdown || "";
      }

      setNodes(prev => prev.map(n => n.id === raiId ? {
        ...n,
        config: {
          ...n.config,
          status: "completed",
          reportMarkdown,
          classDistributionPlot
        }
      } : n));
      handleSaveWorkflow();
    } catch (e: any) {
      const errorMsg = e.response?.data?.detail || "Report generation failed";
      setNodes(prev => prev.map(n => n.id === raiId ? { ...n, config: { ...n.config, status: "error", error: errorMsg } } : n));
    }
  };

  // ─── Inspector Render Forms ──────────────────────────────────────────────
  const renderConfigForm = () => {
    const node = nodes.find(n => n.id === selectedNodeId);
    if (!node) return <div className="text-muted-foreground p-4">Select a node to inspect properties</div>;

    const handleConfigChange = (field: keyof NodeConfig, value: any) => {
      setNodes(prev => prev.map(n => {
        if (n.id === selectedNodeId) {
          return { ...n, config: { ...n.config, [field]: value } };
        }
        return n;
      }));
    };

    switch (node.type) {
      case "dataset":
        return (
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-foreground">Select Source Dataset</label>
            <select
              value={node.config.datasetId || ""}
              onChange={(e) => {
                handleConfigChange("datasetId", e.target.value);
                handleSaveWorkflow();
              }}
              className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-md outline-none focus:ring-2 focus:ring-primary text-sm"
            >
              <option value="">-- Choose Dataset --</option>
              {availableDatasets.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        );

      case "model_config":
        return (
          <div className="space-y-4 text-sm">
            <div>
              <label className="block font-semibold mb-1">Pipeline Name</label>
              <input
                type="text"
                value={node.config.name || ""}
                onChange={(e) => handleConfigChange("name", e.target.value)}
                onBlur={() => handleSaveWorkflow()}
                className="w-full bg-background border border-border text-foreground px-3 py-1.5 rounded-md text-xs"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Task Type</label>
              <select
                value={node.config.task_type || "image_classification"}
                onChange={(e) => handleConfigChange("task_type", e.target.value)}
                onBlur={() => handleSaveWorkflow()}
                className="w-full bg-background border border-border text-foreground px-3 py-1.5 rounded-md text-xs"
              >
                <option value="image_classification">Image Classification</option>
                <option value="object_detection">Object Detection</option>
                <option value="image_segmentation">Image Segmentation</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Architecture</label>
              <select
                value={node.config.architecture || "resnet18"}
                onChange={(e) => handleConfigChange("architecture", e.target.value)}
                onBlur={() => handleSaveWorkflow()}
                className="w-full bg-background border border-border text-foreground px-3 py-1.5 rounded-md text-xs"
              >
                {node.config.task_type === "object_detection" ? (
                  <>
                    <option value="faster_rcnn">Faster R-CNN</option>
                    <option value="ssd">SSD</option>
                    <option value="yolo">YOLOv8</option>
                  </>
                ) : node.config.task_type === "image_segmentation" ? (
                  <>
                    <option value="fcn">FCN ResNet50</option>
                    <option value="deeplabv3">DeepLabV3</option>
                    <option value="unet">U-Net (Instance)</option>
                  </>
                ) : (
                  <>
                    <option value="resnet18">ResNet-18</option>
                    <option value="resnet50">ResNet-50</option>
                    <option value="mobilenet">MobileNet V3</option>
                    <option value="efficientnet">EfficientNet B0</option>
                  </>
                )}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">Epochs</label>
                <input
                  type="number"
                  value={node.config.epochs || 5}
                  onChange={(e) => handleConfigChange("epochs", parseInt(e.target.value))}
                  onBlur={() => handleSaveWorkflow()}
                  className="w-full bg-background border border-border text-foreground px-2 py-1 rounded-md text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Batch Size</label>
                <input
                  type="number"
                  value={node.config.batch_size || 8}
                  onChange={(e) => handleConfigChange("batch_size", parseInt(e.target.value))}
                  onBlur={() => handleSaveWorkflow()}
                  className="w-full bg-background border border-border text-foreground px-2 py-1 rounded-md text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Learning Rate</label>
              <input
                type="number"
                step="0.0001"
                value={node.config.learning_rate || 0.001}
                onChange={(e) => handleConfigChange("learning_rate", parseFloat(e.target.value))}
                onBlur={() => handleSaveWorkflow()}
                className="w-full bg-background border border-border text-foreground px-3 py-1.5 rounded-md text-xs"
              />
            </div>
          </div>
        );

      case "trainer":
        const metrics = node.config.metrics || {};
        return (
          <div className="space-y-4 text-xs">
            <button
              onClick={() => runTrainerJob(node.id)}
              disabled={node.config.status === "running"}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play size={14} /> Run Training Job
            </button>

            {node.config.jobId && (
              <div className="bg-muted/40 p-2.5 rounded-md border border-border">
                <span className="font-semibold block mb-1">Job Details</span>
                <div>Job ID: <code className="bg-muted px-1 py-0.5 rounded">{node.config.jobId}</code></div>
                <div className="mt-1 flex items-center gap-1.5">
                  Status: 
                  <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                    node.config.status === "completed" || node.config.status === "success"
                      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                      : node.config.status === "running"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                      : node.config.status === "error" || node.config.status === "failed"
                      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                      : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                  }`}>
                    {node.config.status || "idle"}
                  </span>
                </div>
              </div>
            )}

            {Object.keys(metrics).length > 0 && (
              <div className="bg-muted/40 p-2.5 rounded-md border border-border">
                <span className="font-semibold block mb-1.5">Latest Evaluation Metrics</span>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {Object.entries(metrics).map(([k, v]) => (
                    <div key={k} className="border-b border-border/50 pb-1">
                      <span className="text-muted-foreground block">{k}</span>
                      <span className="font-bold text-foreground">{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {node.config.logs && node.config.logs.length > 0 && (
              <div>
                <span className="font-semibold block mb-1.5">Training Console Logs</span>
                <pre className="bg-slate-950 text-emerald-400 p-2.5 rounded-md text-[10px] max-height-[200px] overflow-y-auto font-mono whitespace-pre-wrap">
                  {node.config.logs.join("\n")}
                </pre>
              </div>
            )}
          </div>
        );

      case "predictor":
        return (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Confidence Threshold ({node.config.confidence_threshold || 0.5})</label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={node.config.confidence_threshold || 0.5}
                onChange={(e) => handleConfigChange("confidence_threshold", parseFloat(e.target.value))}
                onBlur={() => handleSaveWorkflow()}
                className="w-full accent-primary"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Explainable AI (xAI) Method</label>
              <select
                value={node.config.explain_method || "none"}
                onChange={(e) => {
                  handleConfigChange("explain_method", e.target.value);
                  handleSaveWorkflow();
                }}
                className="w-full bg-background border border-border text-foreground px-2.5 py-1.5 rounded-md text-xs"
              >
                <option value="none">None (Standard Predict)</option>
                <option value="gradcam">Grad-CAM (CNN saliency map)</option>
                <option value="lime">LIME (Locally interpretable explanations)</option>
                <option value="shap">SHAP (Feature contribution)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Upload Inference Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) runPrediction(node.id, file);
                }}
                className="w-full border border-border px-2 py-1.5 rounded-md text-[10px] bg-background"
              />
            </div>

            {node.config.annotatedImage && (
              <div className="space-y-1">
                <span className="font-semibold block text-[10px] text-muted-foreground uppercase">Prediction Overlay</span>
                <img
                  src={node.config.annotatedImage}
                  alt="Prediction Overlay"
                  className="w-full rounded-md border border-border mt-1 cursor-pointer hover:opacity-90 max-h-[180px] object-contain bg-slate-900"
                  onClick={() => {
                    const w = window.open();
                    w?.document.write(`<img src="${node.config.annotatedImage}" style="max-width:100%; max-height:100vh;" />`);
                  }}
                />
              </div>
            )}
            
            {node.config.explanationImage && (
              <div className="space-y-1 mt-2">
                <span className="font-semibold block text-[10px] text-muted-foreground uppercase">xAI Heatmap Output</span>
                <img
                  src={node.config.explanationImage}
                  alt="Explanation Output"
                  className="w-full rounded-md border border-border mt-1 cursor-pointer hover:opacity-90 max-h-[180px] object-contain bg-slate-900"
                  onClick={() => {
                    const w = window.open();
                    w?.document.write(`<img src="${node.config.explanationImage}" style="max-width:100%; max-height:100vh;" />`);
                  }}
                />
              </div>
            )}

            {node.config.predictions && (
              <div className="bg-muted/40 p-2.5 rounded-md border border-border mt-2">
                <span className="font-semibold block mb-1 text-[10px] text-muted-foreground uppercase">Prediction Results</span>
                {Array.isArray(node.config.predictions) ? (
                  <ul className="space-y-1 mt-1 text-[11px]">
                    {node.config.predictions.map((p: any, idx: number) => (
                      <li key={idx} className="flex justify-between border-b border-border/40 pb-1">
                        <span className="font-medium text-foreground">{p.class_name || p.label || `Class ${p.class_id}`}</span>
                        <span className="text-muted-foreground font-semibold">
                          {typeof p.confidence === "number" ? `${(p.confidence).toFixed(1)}%` : p.confidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <pre className="text-[10px] overflow-x-auto bg-slate-950 text-emerald-400 p-2 rounded mt-1 max-h-[120px]">
                    {JSON.stringify(node.config.predictions, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        );

      case "evaluator":
        return (
          <div className="space-y-4 text-xs">
            <button
              onClick={() => runEvaluation(node.id)}
              disabled={node.config.status === "running"}
              className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 rounded-md transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <BarChart2 size={14} /> Calculate Evaluation Metrics
            </button>

            {node.config.status === "running" && (
              <div className="flex items-center gap-1.5 text-muted-foreground justify-center py-4">
                <Loader2 size={14} className="animate-spin" /> Running test set evaluation...
              </div>
            )}

            {node.config.results && (() => {
              const res = node.config.results;
              const classMetrics = res.class_metrics || [];
              const numClasses = classMetrics.length;
              let macroF1 = 0;
              let macroPrecision = 0;
              let macroRecall = 0;
              
              if (numClasses > 0) {
                let sumPrec = 0, sumRec = 0, sumF1 = 0;
                classMetrics.forEach((m: any) => {
                  sumPrec += m.precision || 0;
                  sumRec += m.recall || 0;
                  sumF1 += m.f1_score || 0;
                });
                macroPrecision = sumPrec / numClasses;
                macroRecall = sumRec / numClasses;
                macroF1 = sumF1 / numClasses;
              }

              let boxes = [];
              if (res.task_type === "image_classification" || !res.task_type) {
                boxes = [
                  { label: "Accuracy", value: `${((res.accuracy ?? 0) * 100).toFixed(1)}%`, border: "border-t-primary" },
                  { label: "Macro F1", value: `${(macroF1 * 100).toFixed(1)}%`, border: "border-t-emerald-500" },
                  { label: "Macro Prec.", value: `${(macroPrecision * 100).toFixed(1)}%`, border: "border-t-warning" },
                  { label: "Macro Rec.", value: `${(macroRecall * 100).toFixed(1)}%`, border: "border-t-violet-500" }
                ];
              } else {
                boxes = [
                  { label: "mAP", value: `${((res.accuracy ?? 0) * 100).toFixed(1)}%`, border: "border-t-primary" },
                  { label: "AP50", value: `${res.correct_count ?? 0}%`, border: "border-t-emerald-500" },
                  { label: "AP75", value: `${res.incorrect_count ?? 0}%`, border: "border-t-warning" },
                  { label: "Targets", value: res.lowest_precision_class ?? "-", border: "border-t-violet-500" }
                ];
              }

              return (
                <div className="space-y-4">
                  {/* Grid of Metric Boxes */}
                  <div className="grid grid-cols-2 gap-2">
                    {boxes.map((box, idx) => (
                      <div key={idx} className={`bg-muted/30 border border-border border-t-4 ${box.border} rounded-md p-2 flex flex-col`}>
                        <span className="text-sm font-bold text-foreground leading-tight">{box.value}</span>
                        <span className="text-[8px] font-semibold text-muted-foreground uppercase mt-0.5">{box.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Confusion Matrix Heatmap */}
                  {res.confusion_matrix_base64 && (
                    <div className="space-y-1">
                      <span className="font-semibold block text-[10px] text-muted-foreground uppercase">Confusion Matrix Heatmap</span>
                      <img
                        src={`data:image/png;base64,${res.confusion_matrix_base64}`}
                        alt="Confusion Matrix"
                        className="w-full rounded-md border border-border cursor-pointer hover:opacity-90 bg-white"
                        onClick={() => {
                          const w = window.open();
                          w?.document.write(`<img src="data:image/png;base64,${res.confusion_matrix_base64}" style="max-width:100%; max-height:100vh;" />`);
                        }}
                      />
                    </div>
                  )}

                  {/* Class-wise Metrics Progress Bars */}
                  {classMetrics.length > 0 && (
                    <div className="space-y-2 border-t border-border/40 pt-3">
                      <span className="font-semibold block text-[10px] text-muted-foreground uppercase">
                        {res.task_type === "object_detection" ? "Average Precision (AP) per Class" : "F1-Score per Class"}
                      </span>
                      <div className="space-y-2">
                        {classMetrics.map((cm: any, idx: number) => {
                          const score = cm.f1_score ?? cm.ap ?? 0;
                          const scorePercent = (score * 100).toFixed(1);
                          let progressBg = "bg-primary";
                          if (score < 0.5) progressBg = "bg-destructive";
                          else if (score < 0.75) progressBg = "bg-warning";
                          else progressBg = "bg-emerald-500";
                          return (
                            <div key={idx} className="text-[10px]">
                              <div className="flex justify-between mb-0.5 font-semibold">
                                <span className="text-foreground">{cm.class_name}</span>
                                <span className="text-muted-foreground">{scorePercent}%</span>
                              </div>
                              <div className="w-full bg-muted border border-border/40 rounded-full h-1.5 overflow-hidden">
                                <div className={`${progressBg} h-full`} style={{ width: `${scorePercent}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Test Split Sample Browser */}
                  {res.samples && res.samples.length > 0 && (() => {
                    const samples = res.samples;
                    const currentIdx = evalSampleIndices[node.id] || 0;
                    const sample = samples[currentIdx] || samples[0];
                    
                    return (
                      <div className="space-y-2 border-t border-border/40 pt-3">
                        <span className="font-semibold block text-[10px] text-muted-foreground uppercase">Test Split Samples ({samples.length})</span>
                        <div className="border border-border/60 rounded-md p-2 bg-muted/10">
                          <div className="relative aspect-video w-full overflow-hidden rounded bg-slate-950 flex items-center justify-center border border-border/40">
                            {sample.base64_image ? (
                              <img
                                src={sample.base64_image}
                                alt={sample.filename}
                                className="max-h-full max-w-full object-contain cursor-pointer"
                                onClick={() => {
                                  const w = window.open();
                                  w?.document.write(`<img src="${sample.base64_image}" style="max-width:100%; max-height:100vh;" />`);
                                }}
                              />
                            ) : (
                              <span className="text-muted-foreground text-[10px]">No Image</span>
                            )}
                            <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-wider ${sample.correct ? 'bg-emerald-500' : 'bg-destructive'}`}>
                              {sample.correct ? 'Correct' : 'Incorrect'}
                            </div>
                          </div>
                          <div className="mt-2 space-y-1 text-[10px]">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-semibold">File:</span>
                              <span className="font-semibold text-foreground truncate max-w-[120px]" title={sample.filename}>{sample.filename}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-semibold">True:</span>
                              <span className="font-semibold text-foreground">{sample.true_label_summary || sample.true_label}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground font-semibold">Pred:</span>
                              <span className="font-semibold text-foreground">{sample.predicted_label_summary || sample.predicted_label}</span>
                            </div>
                            {typeof sample.confidence === "number" && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground font-semibold">Conf:</span>
                                <span className="font-semibold text-foreground">{(sample.confidence * 100).toFixed(1)}%</span>
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between items-center mt-3 pt-2 border-t border-border/40">
                            <button
                              type="button"
                              onClick={() => {
                                const prevIdx = (currentIdx - 1 + samples.length) % samples.length;
                                setEvalSampleIndices(prev => ({ ...prev, [node.id]: prevIdx }));
                              }}
                              className="px-2 py-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded text-[10px] font-semibold"
                            >
                              Prev
                            </button>
                            <span className="text-[10px] text-muted-foreground font-semibold">
                              {currentIdx + 1} / {samples.length}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const nextIdx = (currentIdx + 1) % samples.length;
                                setEvalSampleIndices(prev => ({ ...prev, [node.id]: nextIdx }));
                              }}
                              className="px-2 py-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border rounded text-[10px] font-semibold"
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        );

      case "responsible_ai":
        return (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => runResponsibleAI(node.id, "dataset")}
                disabled={node.config.status === "running"}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium py-2 rounded-md flex items-center justify-center gap-1.5"
              >
                <Database size={14} /> Data Card
              </button>
              <button
                onClick={() => runResponsibleAI(node.id, "model")}
                disabled={node.config.status === "running"}
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium py-2 rounded-md flex items-center justify-center gap-1.5"
              >
                <Sliders size={14} /> Model Card
              </button>
            </div>

            {node.config.status === "running" && (
              <div className="flex items-center gap-1.5 text-muted-foreground justify-center py-4">
                <Loader2 size={14} className="animate-spin" /> Generating Responsible AI Card...
              </div>
            )}

            {node.config.reportMarkdown && (
              <div className="space-y-2">
                <span className="font-semibold block uppercase tracking-wider text-[10px] text-primary">Generated Report</span>
                <div className="bg-background border border-border p-2.5 rounded-md max-h-[250px] overflow-y-auto text-[11px] prose prose-invert font-sans">
                  <div dangerouslySetInnerHTML={{ __html: node.config.reportMarkdown.replace(/\n/g, "<br/>") }} />
                </div>
              </div>
            )}

            {node.config.classDistributionPlot && (
              <div>
                <span className="font-semibold block mb-1">Class Distribution Plot</span>
                <img
                  src={node.config.classDistributionPlot}
                  alt="Class Distribution"
                  className="w-full rounded-md border border-border mt-1"
                />
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background text-foreground">
      {/* ── Top action bar ──────────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', height: 44, borderBottom: '1px solid hsl(var(--border))',
        background: 'hsl(var(--card))', gap: 8, flexShrink: 0 }}>
        {/* Title + project tag — hidden on mobile */}
        <div className="wf-title-group" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>
            Visual Pipeline
          </h2>
          <span style={{ fontSize: 10, padding: '2px 8px', background: 'hsl(var(--secondary))',
            color: 'hsl(var(--muted-foreground))', borderRadius: 99, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
            {project?.name || 'Loading...'}
          </span>
        </div>
        {/* Status indicator */}
        <div className="wf-status" style={{ display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: 'hsl(var(--muted-foreground))', whiteSpace: 'nowrap' }}>
          Status: <strong style={{ color: 'hsl(var(--foreground))' }}>{workflowStatus}</strong>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <button onClick={handleResetWorkflow}
            className="wf-reset-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'hsl(var(--secondary))', color: 'hsl(var(--secondary-foreground))',
              border: '1px solid hsl(var(--border))', borderRadius: 6,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <RefreshCw size={11} /> Reset
          </button>
          <button onClick={() => handleSaveWorkflow()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
              background: 'hsl(var(--primary))', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Save size={11} /> Save
          </button>
        </div>
      </header>

      {/* Workspace panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side Visual Canvas */}
        <div className="flex flex-col flex-1 relative bg-muted/20">
          {/* ── Add Node popover button ──────────────────────────────────── */}
          <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 200 }}>
            <button
              onClick={() => setAddNodeOpen(prev => !prev)}
              style={{ display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', background: 'hsl(var(--card) / 0.92)',
                backdropFilter: 'blur(8px)', border: '1px solid hsl(var(--border))',
                borderRadius: 8, fontSize: 12, fontWeight: 600,
                color: 'hsl(var(--foreground))', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <Plus size={13} style={{ color: 'hsl(var(--primary))' }} />
              Add Node
              <ChevronDown size={11} style={{
                transform: addNodeOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s',
                color: 'hsl(var(--muted-foreground))' }} />
            </button>

            {/* Dropdown menu */}
            {addNodeOpen && (
              <div
                style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                  background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
                  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  padding: '6px', minWidth: 160, zIndex: 300,
                  display: 'flex', flexDirection: 'column', gap: 2 }}>
                {([
                  { type: 'dataset',        label: 'Dataset',        Icon: Database,  color: 'hsl(var(--primary))' },
                  { type: 'model_config',   label: 'Config',         Icon: Sliders,   color: 'hsl(var(--primary))' },
                  { type: 'trainer',        label: 'Trainer',        Icon: Cpu,       color: 'hsl(var(--primary))' },
                  { type: 'predictor',      label: 'Predictor',      Icon: Eye,       color: 'hsl(var(--primary))' },
                  { type: 'evaluator',      label: 'Evaluator',      Icon: BarChart2, color: 'hsl(var(--primary))' },
                  { type: 'responsible_ai', label: 'Responsible AI', Icon: Shield,    color: 'hsl(var(--primary))' },
                ] as const).map(({ type, label, Icon, color }) => (
                  <button key={type}
                    onClick={() => { handleAddNode(type); setAddNodeOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', border: 'none', borderRadius: 6,
                      background: 'transparent', cursor: 'pointer',
                      fontSize: 12, fontWeight: 500,
                      color: 'hsl(var(--foreground))', textAlign: 'left',
                      width: '100%', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'hsl(var(--secondary))')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <Icon size={13} style={{ color, flexShrink: 0 }} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Interactive Flow Canvas */}
          <div
            ref={canvasRef}
            onClick={() => setAddNodeOpen(false)}
            className="flex-1 w-full h-full relative overflow-auto select-none bg-[radial-gradient(#ccc_1px,transparent_1px)] dark:bg-[radial-gradient(#444_1px,transparent_1px)] [background-size:16px_16px]"
          >
            {/* SVG Edge Connectors Layer */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              {edges.map(([fromId, toId], idx) => {
                const start = getPortCoords(fromId, true);
                const end = getPortCoords(toId, false);
                const dx = Math.abs(end.x - start.x) * 0.5;
                const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
                return (
                  <path
                    key={idx}
                    d={path}
                    fill="none"
                    stroke="hsla(var(--primary), 0.55)"
                    strokeWidth="3.5"
                    className="hover:stroke-primary transition-colors duration-150"
                  />
                );
              })}

              {/* Live drawing connection path */}
              {connectingFromId && connectMousePos && (() => {
                const start = getPortCoords(connectingFromId, true);
                const end = connectMousePos;
                const dx = Math.abs(end.x - start.x) * 0.5;
                const path = `M ${start.x} ${start.y} C ${start.x + dx} ${start.y}, ${end.x - dx} ${end.y}, ${end.x} ${end.y}`;
                return (
                  <path
                    d={path}
                    fill="none"
                    stroke="hsla(var(--primary), 0.75)"
                    strokeWidth="2.5"
                    strokeDasharray="5,5"
                  />
                );
              })()}
            </svg>

            {/* Nodes Render Layer */}
            {nodes.map(node => {
              const isSelected = selectedNodeId === node.id;

              // Map icon + background color per node type (matching vanilla workflow_web)
              let iconBg = "#3b82f6";
              let NodeIcon = Database;
              if (node.type === "model_config") { NodeIcon = Sliders; iconBg = "#f59e0b"; }
              else if (node.type === "trainer") { NodeIcon = Cpu; iconBg = "#a855f7"; }
              else if (node.type === "predictor") { NodeIcon = Eye; iconBg = "#10b981"; }
              else if (node.type === "evaluator") { NodeIcon = BarChart2; iconBg = "#00c0ef"; }
              else if (node.type === "responsible_ai") { NodeIcon = Shield; iconBg = "#605ca8"; }

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={() => { setSelectedNodeId(node.id); setMobilePanelOpen(true); }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${NODE_WIDTH}px`,
                    minHeight: `${NODE_HEIGHT}px`,
                    display: 'grid',
                    gridTemplateColumns: '44px 1fr',
                  }}
                  className={`absolute z-10 rounded-lg border overflow-hidden cursor-move shadow-md bg-card transition-all select-none ${
                    isSelected ? "border-primary ring-2 ring-primary/20 shadow-lg" : "border-border hover:border-muted-foreground/40 hover:shadow-md"
                  }`}
                >
                  {/* Col 1: Colored Icon Block */}
                  <div
                    style={{ backgroundColor: iconBg }}
                    className="flex items-center justify-center text-white border-r border-black/10"
                  >
                    <NodeIcon size={18} strokeWidth={2.2} />
                  </div>

                  {/* Col 2: Node Body */}
                  <div className="px-3 py-2.5 flex flex-col justify-between min-w-0 gap-1">
                    {/* Title row with options */}
                    <div className="flex items-start justify-between gap-1 min-w-0">
                      <div className="flex flex-col min-w-0 overflow-hidden">
                        <span className="font-bold text-xs truncate leading-tight text-foreground" title={node.title}>{node.title}</span>
                        <span className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5" title={node.subtitle}>{node.subtitle}</span>
                      </div>
                      {/* Three-dot options */}
                      <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setActiveMenuNodeId(activeMenuNodeId === node.id ? null : node.id)}
                          className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors shrink-0"
                        >
                          <MoreVertical size={13} />
                        </button>
                        {activeMenuNodeId === node.id && (
                          <div style={{
                            position: "absolute", right: 0, top: "100%",
                            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                            borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            zIndex: 200, minWidth: 90, padding: 4,
                          }}>
                            <button
                              onClick={() => { handleRemoveNode(node.id); setActiveMenuNodeId(null); }}
                              style={{
                                width: "100%", padding: "5px 10px", background: "transparent",
                                border: "none", color: "hsl(var(--destructive))", fontSize: 11,
                                fontWeight: 600, textAlign: "left", cursor: "pointer", borderRadius: 4,
                              }}
                              className="hover:bg-destructive/10"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status Indicator */}
                    {node.config.status && (
                      <div className="text-[9px] flex items-center gap-1.5 text-muted-foreground select-none">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          node.config.status === "running" ? "bg-primary animate-pulse" :
                          node.config.status === "completed" || node.config.status === "success" ? "bg-green-500" :
                          node.config.status === "error" || node.config.status === "failed" ? "bg-red-500" : "bg-gray-400"
                        }`} />
                        <span className="capitalize font-semibold">{node.config.status}</span>
                      </div>
                    )}
                  </div>

                  {/* Input Port */}
                  {node.type !== "dataset" && node.type !== "model_config" && (
                    <div
                      onMouseUp={(e) => handleEndConnection(e, node.id)}
                      className="port absolute -left-[7px] top-1/2 -translate-y-1/2 w-3 h-3 bg-card border-2 border-slate-400 hover:border-primary rounded-full cursor-crosshair z-20 transition-all hover:scale-125"
                    />
                  )}

                  {/* Output Port */}
                  {node.type !== "predictor" && node.type !== "evaluator" && (
                    <div
                      onMouseDown={(e) => handleStartConnection(e, node.id)}
                      className="port absolute -right-[7px] top-1/2 -translate-y-1/2 w-3 h-3 bg-card border-2 border-slate-400 hover:border-primary rounded-full cursor-crosshair z-20 transition-all hover:scale-125"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Properties panel — hidden on mobile; opens as bottom sheet ── */}
        <aside
          className={`wf-props-panel ${mobilePanelOpen ? 'wf-props-panel--open' : ''}`}
          style={{ width: 288, borderLeft: '1px solid hsl(var(--border))',
            background: 'hsl(var(--card))', display: 'flex', flexDirection: 'column',
            overflowY: 'auto', flexShrink: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid hsl(var(--border))',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'hsl(var(--muted) / 0.15)', flexShrink: 0 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, margin: 0,
              display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sliders size={14} /> Properties
            </h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {selectedNodeId && (
                <span style={{ fontSize: 9, fontWeight: 600,
                  color: 'hsl(var(--muted-foreground))',
                  background: 'hsl(var(--secondary))', padding: '2px 7px',
                  borderRadius: 99 }}>
                  {nodes.find(n => n.id === selectedNodeId)?.title}
                </span>
              )}
              {/* Close button — only visible on mobile */}
              <button className="wf-props-close"
                onClick={() => setMobilePanelOpen(false)}
                style={{ display: 'none', background: 'none', border: 'none',
                  cursor: 'pointer', color: 'hsl(var(--muted-foreground))',
                  padding: 2, lineHeight: 1, fontSize: 16 }}>✕</button>
            </div>
          </div>
          <div style={{ padding: 14, flex: 1 }}>
            {renderConfigForm()}
          </div>
        </aside>
      </div>

      {/* Mobile CSS */}
      <style>{`
        /* Desktop: title + status visible, reset button visible, panel inline */
        .wf-title-group { display: flex; }
        .wf-status      { display: flex; }
        .wf-reset-btn   { display: flex; }
        .wf-props-panel { position: relative; }
        .wf-props-close { display: none !important; }

        @media (max-width: 767px) {
          /* Header: hide title group and status on mobile */
          .wf-title-group { display: none !important; }
          .wf-status      { display: none !important; }
          .wf-reset-btn   { display: none !important; }

          /* Properties panel: hide unless open */
          .wf-props-panel {
            position: fixed !important;
            bottom: 0; left: 0; right: 0;
            width: 100% !important;
            max-height: 55vh;
            z-index: 300;
            border-left: none !important;
            border-top: 1px solid hsl(var(--border));
            border-radius: 14px 14px 0 0;
            box-shadow: 0 -8px 32px rgba(0,0,0,0.18);
            transform: translateY(100%);
            transition: transform 0.28s cubic-bezier(0.4,0,0.2,1);
          }
          .wf-props-panel.wf-props-panel--open {
            transform: translateY(0);
          }
          .wf-props-close { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
