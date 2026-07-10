import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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
  Loader2
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
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("project_id") || "default_project";

  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("trainer_1");
  const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
  const [projectRuns, setProjectRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [workflowStatus, setWorkflowStatus] = useState<string>("Idle");

  // Dragging state
  const [dragNodeId, setDragNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Port connection state
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [connectMousePos, setConnectMousePos] = useState<{ x: number; y: number } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const pollingIntervals = useRef<Record<string, any>>({});

  // ─── Fetch Initial Data ──────────────────────────────────────────────────
  useEffect(() => {
    // Fetch Project Details
    api.get(`/projects/${projectId}`)
      .then(res => setProject(res.data))
      .catch(() => setProject({ id: Number(projectId) || 1, name: "Project", task_type: "classification", classes: ["Class A", "Class B"] }));

    // Fetch Datasets
    api.get("/datasets")
      .then(res => setAvailableDatasets(res.data))
      .catch(() => setAvailableDatasets([
        { id: "ds_1", name: "Mock Image Dataset (Cats vs Dogs)" },
        { id: "ds_2", name: "Mock Traffic Signs Detection" }
      ]));

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
    if (!node) return;
    setDragNodeId(nodeId);
    setDragOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragNodeId) {
      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
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

  const handleMouseUp = () => {
    if (dragNodeId) {
      setDragNodeId(null);
      handleSaveWorkflow();
    }
    if (connectingFromId) {
      setConnectingFromId(null);
      setConnectMousePos(null);
    }
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

    try {
      const formData = new FormData();
      formData.append("file", imageFile);

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
              explanationImage: res.data.explanation_image || ""
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
      if (cardType === "dataset") {
        const dsNode = nodes.find(n => n.id === datasetEdge![0]);
        res = await api.post(`/datasets/${dsNode?.config.datasetId}/data-card`);
      } else {
        const trNode = nodes.find(n => n.id === trainerEdge![0]);
        res = await api.post(`/pipelines/${trNode?.config.jobId}/model-card`);
      }

      setNodes(prev => prev.map(n => n.id === raiId ? {
        ...n,
        config: {
          ...n.config,
          status: "completed",
          reportMarkdown: res.data.report || res.data,
          classDistributionPlot: res.data.class_distribution_plot || ""
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

            {node.config.predictions && (
              <div className="bg-muted/40 p-2.5 rounded-md border border-border">
                <span className="font-semibold block mb-1">Prediction Outputs</span>
                <pre className="text-[10px] overflow-x-auto bg-slate-950 text-emerald-400 p-2 rounded">
                  {JSON.stringify(node.config.predictions, null, 2)}
                </pre>
              </div>
            )}
            
            {node.config.explanationImage && (
              <div>
                <span className="font-semibold block mb-1">xAI Heatmap Output</span>
                <img
                  src={node.config.explanationImage}
                  alt="Explanation Output"
                  className="w-full rounded-md border border-border mt-1"
                />
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

            {node.config.results && (
              <div className="bg-muted/40 p-2.5 rounded-md border border-border">
                <span className="font-semibold block mb-1.5">Evaluation Results</span>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {Object.entries(node.config.results).map(([k, v]) => (
                    <div key={k} className="border-b border-border/50 pb-1">
                      <span className="text-muted-foreground block">{k}</span>
                      <span className="font-bold text-foreground">{typeof v === "number" ? v.toFixed(4) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
    <div className="flex flex-col h-[calc(100vh-64px)] w-full overflow-hidden bg-background text-foreground">
      {/* Top action bar */}
      <header className="flex justify-between items-center px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold flex items-center gap-1.5 text-foreground">
            Visual Workflow Workspace
          </h2>
          <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">
            Project: {project?.name || "Loading..."}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status: <strong className="text-foreground">{workflowStatus}</strong></span>
          <button
            onClick={handleResetWorkflow}
            className="flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-3 py-1.5 rounded-md text-xs font-semibold"
          >
            <RefreshCw size={12} /> Reset Canvas
          </button>
          <button
            onClick={() => handleSaveWorkflow()}
            className="flex items-center gap-1 bg-primary text-primary-foreground hover:bg-primary/95 px-3 py-1.5 rounded-md text-xs font-semibold"
          >
            <Save size={12} /> Save Workflow
          </button>
        </div>
      </header>

      {/* Workspace panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side Visual Canvas */}
        <div className="flex flex-col flex-1 relative bg-muted/20">
          {/* Quick Node Spawners */}
          <div className="absolute top-3 left-3 z-10 bg-card/85 backdrop-blur-md p-2 rounded-lg border border-border flex items-center gap-2 shadow-sm text-xs">
            <span className="font-semibold text-muted-foreground mr-1.5">Add Node:</span>
            <button
              onClick={() => handleAddNode("dataset")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <Database size={12} className="text-blue-500" /> Dataset
            </button>
            <button
              onClick={() => handleAddNode("model_config")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <Sliders size={12} className="text-violet-500" /> Config
            </button>
            <button
              onClick={() => handleAddNode("trainer")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <Cpu size={12} className="text-orange-500" /> Trainer
            </button>
            <button
              onClick={() => handleAddNode("predictor")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <Eye size={12} className="text-emerald-500" /> Predictor
            </button>
            <button
              onClick={() => handleAddNode("evaluator")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <BarChart2 size={12} className="text-amber-500" /> Evaluator
            </button>
            <button
              onClick={() => handleAddNode("responsible_ai")}
              className="flex items-center gap-1 bg-background hover:bg-secondary px-2.5 py-1.5 rounded border border-border font-medium"
            >
              <Shield size={12} className="text-rose-500" /> Responsible AI
            </button>
          </div>

          {/* Interactive Flow Canvas */}
          <div
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
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
                    stroke="rgba(var(--primary), 0.55)"
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
                    stroke="rgba(var(--primary), 0.75)"
                    strokeWidth="2.5"
                    strokeDasharray="5,5"
                  />
                );
              })()}
            </svg>

            {/* Nodes Render Layer */}
            {nodes.map(node => {
              const isSelected = selectedNodeId === node.id;
              
              // Map icon color
              let iconColor = "text-blue-500 bg-blue-500/10";
              let NodeIcon = Database;
              if (node.type === "model_config") { NodeIcon = Sliders; iconColor = "text-violet-500 bg-violet-500/10"; }
              else if (node.type === "trainer") { NodeIcon = Cpu; iconColor = "text-orange-500 bg-orange-500/10"; }
              else if (node.type === "predictor") { NodeIcon = Eye; iconColor = "text-emerald-500 bg-emerald-500/10"; }
              else if (node.type === "evaluator") { NodeIcon = BarChart2; iconColor = "text-amber-500 bg-amber-500/10"; }
              else if (node.type === "responsible_ai") { NodeIcon = Shield; iconColor = "text-rose-500 bg-rose-500/10"; }

              return (
                <div
                  key={node.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onClick={() => setSelectedNodeId(node.id)}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${NODE_WIDTH}px`,
                    height: `${NODE_HEIGHT}px`
                  }}
                  className={`absolute z-10 rounded-xl border p-3 flex flex-col justify-between cursor-move shadow-md bg-card transition-all select-none ${
                    isSelected ? "border-primary ring-2 ring-primary/20 shadow-lg" : "border-border hover:border-muted-foreground/40 hover:shadow-md"
                  }`}
                >
                  {/* Node Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className={`p-1.5 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                        <NodeIcon size={16} />
                      </span>
                      <div className="flex flex-col overflow-hidden">
                        <span className="font-bold text-xs truncate leading-tight">{node.title}</span>
                        <span className="text-[10px] text-muted-foreground truncate leading-tight">{node.subtitle}</span>
                      </div>
                    </div>
                    {/* Delete Icon button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveNode(node.id); }}
                      className="text-muted-foreground hover:text-destructive p-1 rounded-md transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Input Port */}
                  {node.type !== "dataset" && node.type !== "model_config" && (
                    <div
                      onMouseUp={(e) => handleEndConnection(e, node.id)}
                      className="port absolute -left-2 top-[38px] w-4 h-4 bg-muted border-2 border-border hover:border-primary rounded-full cursor-pointer flex items-center justify-center z-20 group"
                    >
                      <span className="w-1.5 h-1.5 bg-foreground group-hover:bg-primary rounded-full transition-colors"></span>
                    </div>
                  )}

                  {/* Output Port */}
                  {node.type !== "predictor" && node.type !== "evaluator" && (
                    <div
                      onMouseDown={(e) => handleStartConnection(e, node.id)}
                      className="port absolute -right-2 top-[38px] w-4 h-4 bg-muted border-2 border-border hover:border-primary rounded-full cursor-pointer flex items-center justify-center z-20 group"
                    >
                      <span className="w-1.5 h-1.5 bg-foreground group-hover:bg-primary rounded-full transition-colors"></span>
                    </div>
                  )}

                  {/* Status Indicator */}
                  {node.config.status && (
                    <div className="text-[9px] flex items-center gap-1 text-muted-foreground">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        node.config.status === "running" ? "bg-blue-500 animate-pulse" :
                        node.config.status === "completed" || node.config.status === "success" ? "bg-green-500" :
                        node.config.status === "error" || node.config.status === "failed" ? "bg-red-500" : "bg-gray-400"
                      }`} />
                      <span className="capitalize">{node.config.status}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side Inspector Properties Panel */}
        <aside className="w-80 border-l border-border bg-card flex flex-col overflow-y-auto">
          <div className="p-4 border-b border-border bg-muted/15 flex items-center justify-between">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Sliders size={16} /> Properties
            </h3>
            {selectedNodeId && (
              <span className="text-[10px] font-semibold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                {nodes.find(n => n.id === selectedNodeId)?.id}
              </span>
            )}
          </div>
          <div className="p-4 flex-1">
            {renderConfigForm()}
          </div>
        </aside>
      </div>
    </div>
  );
}
