import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Search, RefreshCw, Cpu, Play, Trash2, TrendingUp, Activity, Terminal, Plus, Download, Sliders } from "lucide-react";
import api from "../../api";
import { CircularProgress } from "../../components/CircularProgress";

interface Dataset {
  id: string;
  name: string;
  task_type: string;
}

interface TrainingJob {
  id: string;
  pipeline_config: {
    name: string;
    task_type: string;
    architecture: string;
    epochs: number;
    batch_size: number;
    learning_rate: number;
    early_stopping: boolean;
    augmentation_enabled: boolean;
  };
  status: string;
  created_at: string;
  metrics?: Record<string, number>;
  logs?: string[];
}

export default function ModelGarden() {
  const { id: projectId } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>(null);
  
  // Lists
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // New Training Form
  const [showTrainModal, setShowTrainModal] = useState(false);
  const [modelName, setModelName] = useState("");
  const [selectedArch, setSelectedArch] = useState("");
  const [epochs, setEpochs] = useState(10);
  const [batchSize, setBatchSize] = useState(8);
  const [learningRate, setLearningRate] = useState(0.001);
  const [datasetSource, setDatasetSource] = useState("current_annotations");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [augmentation, setAugmentation] = useState(true);
  const [augTypes, setAugTypes] = useState<string[]>(["horizontal_flip", "vertical_flip", "random_rotation", "color_jitter"]);
  const [earlyStopping, setEarlyStopping] = useState(true);
  const [patience, setPatience] = useState(3);
  const [startingTraining, setStartingTraining] = useState(false);
  const [projectImages, setProjectImages] = useState<any[]>([]);
  const [evaluationResults, setEvaluationResults] = useState<any>(null);
  const [loadingEvaluation, setLoadingEvaluation] = useState(false);
  const [rightTab, setRightTab] = useState<"telemetry" | "evaluation">("telemetry");

  useEffect(() => {
    if (showTrainModal && projectId) {
      api.get(`/projects/${projectId}/images`)
        .then(res => setProjectImages(res.data || []))
        .catch(() => setProjectImages([]));
    }
  }, [showTrainModal, projectId]);

  // Live Monitor Panel
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<TrainingJob | null>(null);
  const [curvesPlot, setCurvesPlot] = useState<string>("");
  const [loadingCurves, setLoadingCurves] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<any>(null);

  useEffect(() => {
    fetchProjectDetails();
    fetchJobs();
    fetchDatasets();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [projectId]);

  // Scroll to bottom of logs
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeJob?.logs]);

  // Start polling when an active job is selected or running
  useEffect(() => {
    setEvaluationResults(null);
    setCurvesPlot("");
    setRightTab("telemetry");
    if (activeJobId) {
      fetchActiveJobDetails(activeJobId);
      pollTimerRef.current = setInterval(() => {
        fetchActiveJobDetails(activeJobId);
      }, 3500);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeJobId]);

  const fetchProjectDetails = async () => {
    try {
      const res = await api.get(`/projects/${projectId}`);
      setProject(res.data);
      // Select appropriate default architecture based on project type
      if (res.data.task_type === "image_classification" || res.data.task_type === "classification") {
        setSelectedArch("resnet18");
      } else if (res.data.task_type === "image_segmentation" || res.data.task_type === "segmentation") {
        setSelectedArch("deeplabv3_resnet50");
      } else {
        setSelectedArch("faster_rcnn");
      }
      setModelName(`${res.data.name} Model Run`);
    } catch {}
  };

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.get(projectId ? `/pipelines?project_id=${projectId}` : "/pipelines");
      setJobs(res.data || []);
      // If there's an active job running, monitor it
      const runningJob = (res.data || []).find((j: any) => ["running", "pending"].includes(j.status?.toLowerCase()));
      if (runningJob && !activeJobId) {
        setActiveJobId(runningJob.id);
      }
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchDatasets = async () => {
    try {
      const res = await api.get(projectId ? `/datasets/available?project_id=${projectId}` : "/datasets/available");
      setDatasets(res.data || []);
    } catch {}
  };

  const fetchActiveJobDetails = async (jobId: string) => {
    try {
      const res = await api.get(`/pipelines/${jobId}`);
      setActiveJob(res.data);
      // Load training curves
      const curvesRes = await api.get(`/pipelines/${jobId}/training-metrics`);
      if (curvesRes.data && curvesRes.data.training_curves_base64) {
        setCurvesPlot(`data:image/png;base64,${curvesRes.data.training_curves_base64}`);
      }
      
      // Load evaluation metrics if completed/success
      const isDone = ["completed", "success"].includes(res.data.status?.toLowerCase());
      if (isDone) {
        setLoadingEvaluation(true);
        try {
          const evalRes = await api.get(`/pipelines/${jobId}/evaluate`);
          setEvaluationResults(evalRes.data);
        } catch (err) {
          console.error("Failed to load evaluation metrics:", err);
          setEvaluationResults(null);
        } finally {
          setLoadingEvaluation(false);
        }
      } else {
        setEvaluationResults(null);
      }

      // Stop polling if completed or failed
      if (["completed", "success", "failed"].includes(res.data.status?.toLowerCase())) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        fetchJobs(); // refresh list
      }
    } catch {}
  };

  const handleStartTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;

    setStartingTraining(true);
    try {
      let finalDatasetId = selectedDatasetId;

      // 1. Auto-Snapshot if requested
      if (datasetSource === "current_annotations") {
        const snapName = `auto_${project.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
        const snapVer = `1.0.${Date.now().toString().slice(-4)}`;
        const snapRes = await api.post(`/projects/${projectId}/save-dataset?dataset_name=${encodeURIComponent(snapName)}&version=${encodeURIComponent(snapVer)}`);
        finalDatasetId = snapRes.data.dataset_id;
      }

      if (!finalDatasetId) {
        alert("Please select a dataset to train on.");
        setStartingTraining(false);
        return;
      }

      // 2. Create pipeline
      // project.task_type is already the full-form value from the API
      // (image_classification, image_segmentation, object_detection).
      // Support legacy shorthand values as fallback.
      const taskTypeMap: Record<string, string> = {
        classification: "image_classification",
        segmentation: "image_segmentation",
        detection: "object_detection",
      };
      const task_type_val = taskTypeMap[project.task_type] ?? project.task_type;

      const payload = {
        name: modelName,
        project_id: projectId,
        task_type: task_type_val,
        architecture: selectedArch,
        epochs: epochs,
        batch_size: batchSize,
        learning_rate: learningRate,
        early_stopping: earlyStopping,
        patience: earlyStopping ? patience : undefined,
        augmentation_enabled: augmentation,
        augmentation_types: augmentation ? augTypes : [],
        num_classes: project.classes?.length || 2
      };

      const pipeRes = await api.post("/pipelines", payload);
      const jobId = pipeRes.data.id;

      // 3. Associate dataset
      await api.post(`/pipelines/${jobId}/dataset/${finalDatasetId}`);

      // 4. Start training
      await api.post(`/pipelines/${jobId}/train`);

      setShowTrainModal(false);
      setActiveJobId(jobId);
      fetchJobs();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to start model training.");
    } finally {
      setStartingTraining(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!window.confirm("Delete this training run and all associated metrics?")) return;
    try {
      await api.delete(`/pipelines/${jobId}`);
      if (activeJobId === jobId) {
        setActiveJobId(null);
        setActiveJob(null);
        setCurvesPlot("");
      }
      fetchJobs();
    } catch {
      alert("Failed to delete model run");
    }
  };

  const filteredJobs = jobs.filter((j) =>
    j.pipeline_config.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Split runs into active vs completed
  const activeRuns = jobs.filter(j => ["running", "pending"].includes(j.status?.toLowerCase()));
  const completedRuns = jobs.filter(j => ["completed", "success", "failed"].includes(j.status?.toLowerCase()));

  // Architectures supported by project type
  const getSupportedArchitectures = () => {
    if (!project) return [];
    const taskType = project.task_type;
    if (taskType === "image_classification" || taskType === "classification") {
      return [
        { id: "resnet18", name: "ResNet-18 (Standard)" },
        { id: "resnet50", name: "ResNet-50 (Deep)" },
        { id: "mobilenet", name: "MobileNet V2 (Lightweight)" },
        { id: "efficientnet", name: "EfficientNet-B0 (Optimized)" },
        { id: "vgg16", name: "VGG-16 (Classic)" }
      ];
    } else if (taskType === "image_segmentation" || taskType === "segmentation") {
      return [
        { id: "deeplabv3_resnet50", name: "DeepLabV3 ResNet-50 (High Accuracy)" },
        { id: "fcn_resnet50", name: "FCN ResNet-50 (Standard)" },
        { id: "unet", name: "UNet (Biomedical/Custom)" },
        { id: "mask_rcnn", name: "Mask R-CNN (Instance Segmentation)" }
      ];
    } else {
      // object_detection (default)
      return [
        { id: "faster_rcnn", name: "Faster R-CNN (ResNet-50 Backbone)" },
        { id: "ssd", name: "SSDLite (MobileNet-V3 Backbone)" }
      ];
    }
  };

  const classMetrics = evaluationResults?.class_metrics || [];
  const macroPrecision = classMetrics.length > 0
    ? classMetrics.reduce((acc: number, m: any) => acc + m.precision, 0) / classMetrics.length
    : 0;
  const macroRecall = classMetrics.length > 0
    ? classMetrics.reduce((acc: number, m: any) => acc + m.recall, 0) / classMetrics.length
    : 0;
  const macroF1 = classMetrics.length > 0
    ? classMetrics.reduce((acc: number, m: any) => acc + m.f1_score, 0) / classMetrics.length
    : 0;

  const renderCircularProgress = (val: number) => {
    const pct = Math.max(0, Math.min(100, val * 100));
    const strokeColor = val >= 0.8 ? "#10b981" : (val >= 0.5 ? "#f59e0b" : "#ef4444");
    return (
      <div style={{ position: "relative", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <CircularProgress
          percentage={pct}
          size={40}
          strokeWidth={3}
          labelFontSize={9}
          color={strokeColor}
          checkMarkOnComplete={false}
          labelFontColor="hsl(var(--foreground))"
          backStrokeColor="rgba(255, 255, 255, 0.05)"
        />
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "hsl(var(--background))" }}>
      {/* ── Left side: Runs Queue & Wizard ── */}
      <div style={{
        flex: 1,
        borderRight: "1px solid hsl(var(--border))",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        overflowY: "auto",
        minWidth: 450
      }}>
        {/* Title bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>Model Training Center</h2>
            <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: "2px 0 0" }}>Configure architectures, trigger training, and inspect runs</p>
          </div>
          <button
            onClick={() => setShowTrainModal(true)}
            style={{
              background: "hsl(var(--primary))",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <Plus size={13} /> Train Model
          </button>
        </div>

        {/* Queue Switch / Search */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ position: "relative", width: 220 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search model runs..."
              style={{
                width: "100%",
                height: 30,
                padding: "0 10px 0 28px",
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 4,
                color: "hsl(var(--foreground))",
                fontSize: 11,
                outline: "none",
                boxSizing: "border-box"
              }}
            />
            <Search size={12} style={{ position: "absolute", left: 10, top: 9, color: "hsl(var(--muted-foreground))" }} />
          </div>
          <button
            onClick={fetchJobs}
            disabled={loading}
            style={{
              background: "hsl(var(--secondary))",
              border: "1px solid hsl(var(--border))",
              color: "hsl(var(--foreground))",
              borderRadius: 4,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {/* Runs List Table */}
        <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
            <thead>
              <tr style={{ background: "hsl(var(--secondary) / 0.3)", borderBottom: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                <th style={{ padding: "10px 12px", fontWeight: 700 }}>Run Name</th>
                <th style={{ padding: "10px 12px", fontWeight: 700 }}>Architecture</th>
                <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                <th style={{ padding: "10px 12px", fontWeight: 700 }}>Metrics</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }} />
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
                    {loading ? "Loading runs..." : "No model training runs found."}
                  </td>
                </tr>
              ) : (
                filteredJobs.map((j) => {
                  const isSelected = activeJobId === j.id;
                  const isRunning = ["running", "pending"].includes(j.status?.toLowerCase());
                  
                  return (
                    <tr
                      key={j.id}
                      onClick={() => setActiveJobId(j.id)}
                      style={{
                        borderBottom: "1px solid hsl(var(--border))",
                        cursor: "pointer",
                        background: isSelected ? "hsl(var(--secondary) / 0.7)" : "transparent",
                        transition: "background 0.15s"
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "hsl(var(--secondary) / 0.3)"; }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ padding: "12px 12px", fontWeight: 600 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "hsl(var(--foreground))" }}>
                          <Cpu size={13} style={{ color: isRunning ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }} />
                          {j.pipeline_config.name}
                        </div>
                      </td>
                      <td style={{ padding: "12px 12px", fontFamily: "monospace", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                        {j.pipeline_config.architecture}
                      </td>
                      <td style={{ padding: "12px 12px" }}>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: isRunning ? "rgba(59,130,246,0.1)" : (j.status === "failed" ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)"),
                          color: isRunning ? "#3b82f6" : (j.status === "failed" ? "#ef4444" : "#10b981")
                        }}>
                          {j.status}
                        </span>
                      </td>
                      <td style={{ padding: "12px 12px", fontFamily: "monospace", fontSize: 10, color: "hsl(var(--primary))" }}>
                        {j.metrics ? (
                          Object.entries(j.metrics)
                            .filter(([k]) => ["f1", "val_f1", "val_loss", "accuracy"].includes(k.toLowerCase()) || !k.includes("_"))
                            .map(([k, v]) => `${k}:${typeof v === "number" ? v.toFixed(3) : v}`)
                            .slice(0, 2)
                            .join(", ")
                        ) : "-"}
                      </td>
                      <td style={{ padding: "12px 12px", textAlign: "right" }} onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDeleteJob(j.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "hsl(var(--muted-foreground))",
                            cursor: "pointer",
                            padding: 4,
                            borderRadius: 4
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = "hsl(var(--destructive))"}
                          onMouseLeave={e => e.currentTarget.style.color = "hsl(var(--muted-foreground))"}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Right side: Telemetry & Logs Panel ── */}
      <div style={{
        width: "40%",
        minWidth: 440,
        background: "hsl(var(--card))",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0
      }}>
        {!activeJobId ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "hsl(var(--muted-foreground))", padding: 24 }}>
            <Activity size={32} />
            <p style={{ fontSize: 12, fontWeight: 500 }}>Select a model training run to monitor logs and metrics</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            
            {/* Run details header */}
            <div style={{ padding: "20px 24px 0px 24px", borderBottom: "1px solid hsl(var(--border))", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "hsl(var(--foreground))" }}>
                    {activeJob?.pipeline_config.name || "Loading details..."}
                  </h3>
                  <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", display: "block", marginTop: 2 }}>
                    Job ID: {activeJobId}
                  </span>
                </div>
                <button
                  onClick={() => fetchActiveJobDetails(activeJobId)}
                  style={{
                    background: "none", border: "1px solid hsl(var(--border))", borderRadius: 4,
                    padding: 4, cursor: "pointer", color: "hsl(var(--foreground))"
                  }}
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {/* Subtabs for completed runs */}
              {["completed", "success"].includes(activeJob?.status?.toLowerCase() ?? "") && (
                <div style={{ display: "flex", gap: 16, borderBottom: "1px solid transparent", marginBottom: -1 }}>
                  <button
                    onClick={() => setRightTab("telemetry")}
                    style={{
                      padding: "8px 0",
                      fontSize: 12,
                      fontWeight: 600,
                      background: "transparent",
                      border: "none",
                      borderBottom: rightTab === "telemetry" ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                      color: rightTab === "telemetry" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      cursor: "pointer",
                      transition: "all 0.15s"
                    }}
                  >
                    Training Progress & Logs
                  </button>
                  <button
                    onClick={() => setRightTab("evaluation")}
                    style={{
                      padding: "8px 0",
                      fontSize: 12,
                      fontWeight: 600,
                      background: "transparent",
                      border: "none",
                      borderBottom: rightTab === "evaluation" ? "2px solid hsl(var(--primary))" : "2px solid transparent",
                      color: rightTab === "evaluation" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                      cursor: "pointer",
                      transition: "all 0.15s"
                    }}
                  >
                    Evaluation Metrics
                  </button>
                </div>
              )}
            </div>

            {/* Scrollable content area */}
            <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
              {rightTab === "telemetry" || !["completed", "success"].includes(activeJob?.status?.toLowerCase() ?? "") ? (
                <>
                  {/* Telemetry Curves Plot */}
                  <div>
                    <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px" }}>
                      Learning Progress Charts
                    </h4>
                    {curvesPlot ? (
                      <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 4, overflow: "hidden", background: "#fff", display: "flex", justifyContent: "center" }}>
                        <img src={curvesPlot} alt="Training Progress Curves" style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />
                      </div>
                    ) : (
                      <div style={{ height: 120, border: "1px dashed hsl(var(--border))", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", color: "hsl(var(--muted-foreground))", fontSize: 11 }}>
                        {activeJob?.status === "failed" ? "Job failed. No metrics generated." : "Learning progress charts will appear as epochs execute."}
                      </div>
                    )}
                  </div>

                  {/* Logs terminal console */}
                  <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 200 }}>
                    <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}>
                      <Terminal size={12} /> Terminal Output Console
                    </h4>
                    <div style={{
                      flex: 1,
                      background: "#090d16",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      padding: 14,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Roboto Mono', 'Courier New', monospace",
                      fontSize: 11,
                      overflowY: "auto",
                      lineHeight: 1.6,
                      maxHeight: 320,
                      boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)"
                    }}>
                      {activeJob?.logs && activeJob.logs.length > 0 ? (
                        activeJob.logs.map((log, idx) => {
                          let textColor = "#e2e8f0"; // Default bright crisp text
                          let fontWeight = 400;

                          const lowerLog = log.toLowerCase();
                          if (lowerLog.includes("starting epoch") || lowerLog.includes("epoch ")) {
                            textColor = "#38bdf8"; // Sky blue for epoch headers
                            fontWeight = 600;
                          } else if (lowerLog.includes("loss =") || lowerLog.includes("completed in")) {
                            textColor = "#a5f3fc"; // Cyan for loss metrics
                          } else if (lowerLog.includes("success") || lowerLog.includes("saved") || lowerLog.includes("loaded")) {
                            textColor = "#34d399"; // Emerald green for success/saved
                            fontWeight = 500;
                          } else if (lowerLog.includes("failed") || lowerLog.includes("error") || lowerLog.includes("exception") || lowerLog.includes("warning")) {
                            textColor = "#f87171"; // Rose red for errors/warnings
                            fontWeight = 600;
                          }

                          return (
                            <div key={idx} style={{
                              color: textColor,
                              fontWeight,
                              borderBottom: "1px solid rgba(255,255,255,0.03)",
                              padding: "3px 0",
                              wordBreak: "break-all"
                            }}>
                              {log}
                            </div>
                          );
                        })
                      ) : (
                        <span style={{ color: "#64748b", fontStyle: "italic" }}>Waiting for execution logs...</span>
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                </>
              ) : (
                // Evaluation Metrics Tab View
                <>
                  {loadingEvaluation ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 12 }}>
                      <RefreshCw size={24} className="animate-spin" style={{ color: "hsl(var(--primary))" }} />
                      <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontWeight: 500 }}>Running test split evaluation...</span>
                    </div>
                  ) : evaluationResults ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        
                        {/* Summary Cards Grid */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <div style={{ background: "hsl(var(--secondary) / 0.25)", border: "1px solid hsl(var(--border))", padding: "12px 16px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", display: "block" }}>
                                {evaluationResults.task_type === "object_detection" ? "mAP (mAP@0.5)" : "Accuracy"}
                              </span>
                              <div style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--foreground))", marginTop: 4 }}>
                                {(evaluationResults.accuracy * 100).toFixed(1)}%
                              </div>
                            </div>
                            {renderCircularProgress(evaluationResults.accuracy)}
                          </div>

                          <div style={{ background: "hsl(var(--secondary) / 0.25)", border: "1px solid hsl(var(--border))", padding: "12px 16px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", display: "block" }}>
                                F1-Score (Macro)
                              </span>
                              <div style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--foreground))", marginTop: 4 }}>
                                {(macroF1 * 100).toFixed(1)}%
                              </div>
                            </div>
                            {renderCircularProgress(macroF1)}
                          </div>

                          <div style={{ background: "hsl(var(--secondary) / 0.25)", border: "1px solid hsl(var(--border))", padding: "12px 16px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", display: "block" }}>
                                Precision (Macro)
                              </span>
                              <div style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--foreground))", marginTop: 4 }}>
                                {(macroPrecision * 100).toFixed(1)}%
                              </div>
                            </div>
                            {renderCircularProgress(macroPrecision)}
                          </div>

                          <div style={{ background: "hsl(var(--secondary) / 0.25)", border: "1px solid hsl(var(--border))", padding: "12px 16px", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div>
                              <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", display: "block" }}>
                                Recall (Macro)
                              </span>
                              <div style={{ fontSize: 18, fontWeight: 700, color: "hsl(var(--foreground))", marginTop: 4 }}>
                                {(macroRecall * 100).toFixed(1)}%
                              </div>
                            </div>
                            {renderCircularProgress(macroRecall)}
                          </div>
                        </div>

                        {/* Secondary metrics summary list */}
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          background: "hsl(var(--secondary) / 0.15)",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 4,
                          padding: "8px 12px",
                          fontSize: 10,
                          color: "hsl(var(--muted-foreground))"
                        }}>
                          {evaluationResults.task_type === "object_detection" ? (
                            <>
                              <span><strong>AP50:</strong> {evaluationResults.correct_count}%</span>
                              <span><strong>AP75:</strong> {evaluationResults.incorrect_count}%</span>
                              <span><strong>Annotations:</strong> {evaluationResults.lowest_precision_class}</span>
                              <span><strong>Predictions:</strong> {evaluationResults.lowest_recall_class}</span>
                            </>
                          ) : (
                            <>
                              <span><strong>ROC-AUC:</strong> {evaluationResults.roc_auc ? evaluationResults.roc_auc.toFixed(3) : "N/A"}</span>
                              <span><strong>Correct:</strong> {evaluationResults.correct_count}</span>
                              <span><strong>Incorrect:</strong> {evaluationResults.incorrect_count}</span>
                              <span><strong>Worst:</strong> {evaluationResults.lowest_precision_class}</span>
                            </>
                          )}
                        </div>

                      {/* Performance Breakdown Table */}
                      <div>
                        <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px" }}>
                          Class-level Performance
                        </h4>
                        <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, overflow: "hidden" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" }}>
                            <thead>
                              <tr style={{ background: "hsl(var(--secondary) / 0.3)", borderBottom: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                                <th style={{ padding: "10px 10px", fontWeight: 700 }}>Class</th>
                                <th style={{ padding: "10px 10px", fontWeight: 700 }}>Precision</th>
                                <th style={{ padding: "10px 10px", fontWeight: 700 }}>Recall</th>
                                <th style={{ padding: "10px 10px", fontWeight: 700 }}>F1-Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {evaluationResults.class_metrics?.map((m: any, idx: number) => {
                                const renderMetricProgress = (val: number, isPrimary: boolean = false) => {
                                  const pct = val * 100;
                                  const barColor = val >= 0.8 ? "#10b981" : (val >= 0.5 ? "#f59e0b" : "#ef4444");
                                  return (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 60 }}>
                                      <span style={{
                                        fontFamily: "monospace",
                                        fontWeight: 600,
                                        color: isPrimary ? "hsl(var(--primary))" : "hsl(var(--foreground))"
                                      }}>
                                        {pct.toFixed(1)}%
                                      </span>
                                      <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 1.5, overflow: "hidden" }}>
                                        <div style={{
                                          width: `${pct}%`,
                                          height: "100%",
                                          background: barColor,
                                          borderRadius: 1.5,
                                          transition: "width 0.3s ease"
                                        }} />
                                      </div>
                                    </div>
                                  );
                                };

                                return (
                                  <tr key={idx} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                                    <td style={{ padding: "10px 10px", fontWeight: 600, color: "hsl(var(--foreground))" }}>{m.class_name}</td>
                                    <td style={{ padding: "10px 10px" }}>{renderMetricProgress(m.precision)}</td>
                                    <td style={{ padding: "10px 10px" }}>{renderMetricProgress(m.recall)}</td>
                                    <td style={{ padding: "10px 10px" }}>{renderMetricProgress(m.f1_score, true)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Confusion Matrix Plot */}
                      {evaluationResults.confusion_matrix_base64 && (
                        <div>
                          <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "10px 0 10px" }}>
                            Confusion Matrix Heatmap
                          </h4>
                          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 4, overflow: "hidden", background: "#fff", display: "flex", justifyContent: "center", padding: 10 }}>
                            <img
                              src={`data:image/png;base64,${evaluationResults.confusion_matrix_base64}`}
                              alt="Confusion Matrix"
                              style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain" }}
                            />
                          </div>
                        </div>
                      )}

                      {/* ROC Curve Plot */}
                      {evaluationResults.roc_curve_base64 && (
                        <div>
                          <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "10px 0 10px" }}>
                            Receiver Operating Characteristic (ROC)
                          </h4>
                          <div style={{ border: "1px solid hsl(var(--border))", borderRadius: 4, overflow: "hidden", background: "#fff", display: "flex", justifyContent: "center", padding: 10 }}>
                            <img
                              src={`data:image/png;base64,${evaluationResults.roc_curve_base64}`}
                              alt="ROC Curve"
                              style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain" }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ border: "1px dashed hsl(var(--border))", borderRadius: 4, padding: 20, textAlign: "center", color: "hsl(var(--muted-foreground))", fontSize: 12 }}>
                      No evaluation results available for this run.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Train Model Config Modal ── */}
      {showTrainModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16
        }}>
          <div style={{
            background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
            borderRadius: 6, width: 440, maxWidth: "100%", padding: 24,
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)", color: "hsl(var(--foreground))"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <Sliders size={16} style={{ color: "hsl(var(--primary))" }} /> Train Custom Model
              </h3>
              <button
                onClick={() => setShowTrainModal(false)}
                style={{ background: "transparent", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", fontSize: 14 }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartTraining} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Run Name</label>
                <input
                  type="text"
                  required
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  style={{
                    width: "100%", height: 36, padding: "0 10px",
                    background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                    borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Architecture Model</label>
                <select
                  value={selectedArch}
                  onChange={(e) => setSelectedArch(e.target.value)}
                  style={{
                    width: "100%", height: 36, padding: "0 10px",
                    background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                    borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                  }}
                >
                  {getSupportedArchitectures().map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Dataset Source</label>
                <select
                  value={datasetSource}
                  onChange={(e) => {
                    setDatasetSource(e.target.value);
                    if (e.target.value === "zips") {
                      setSelectedDatasetId(datasets[0]?.id || "");
                    }
                  }}
                  style={{
                    width: "100%", height: 36, padding: "0 10px",
                    background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                    borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                  }}
                >
                  <option value="current_annotations">Current Project Annotations (Auto-Snapshot)</option>
                  <option value="zips">Imported Zipped Dataset</option>
                </select>
                {datasetSource === "current_annotations" && projectImages.length === 0 && (
                  <div style={{
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: 4,
                    padding: "8px 10px",
                    fontSize: 11,
                    color: "#f87171",
                    lineHeight: 1.4,
                    marginTop: 6
                  }}>
                    ⚠️ <strong>No media files:</strong> There are no images uploaded in this project to train on. Go to the <strong>Data</strong> tab to upload and label images first, or select <strong>Imported Zipped Dataset</strong>.
                  </div>
                )}
              </div>

              {datasetSource === "zips" && (
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Select Zip Dataset</label>
                  <select
                    value={selectedDatasetId}
                    onChange={(e) => setSelectedDatasetId(e.target.value)}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                      borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                    }}
                  >
                    {datasets.length === 0 ? (
                      <option value="">No datasets available. Please upload a zip first.</option>
                    ) : (
                      datasets.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.task_type.replace("_", " ")})</option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Epochs</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={200}
                    value={epochs}
                    onChange={(e) => setEpochs(parseInt(e.target.value))}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                      borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Batch Size</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={128}
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value))}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                      borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={augmentation} onChange={(e) => setAugmentation(e.target.checked)} />
                  <span>Augmentation</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={earlyStopping} onChange={(e) => setEarlyStopping(e.target.checked)} />
                  <span>Early Stopping</span>
                </label>
              </div>

              {augmentation && (
                <div style={{ marginTop: 10, padding: 10, background: "hsl(var(--secondary) / 0.3)", border: "1px solid hsl(var(--border))", borderRadius: 4 }}>
                  <span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 6, textTransform: "uppercase" }}>Augmentation Techniques</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {[
                      { key: "horizontal_flip", label: "Horizontal Flip" },
                      { key: "vertical_flip", label: "Vertical Flip" },
                      { key: "random_rotation", label: "Random Rotation" },
                      { key: "color_jitter", label: "Color Jitter" }
                    ].map(({ key, label }) => {
                      const isChecked = augTypes.includes(key);
                      return (
                        <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, cursor: "pointer", userSelect: "none" }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const nextTypes = e.target.checked
                                ? [...augTypes, key]
                                : augTypes.filter(t => t !== key);
                              setAugTypes(nextTypes);
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {earlyStopping && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Patience (Epochs)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={100}
                    value={patience}
                    onChange={(e) => setPatience(parseInt(e.target.value) || 3)}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary))", border: "1px solid hsl(var(--border))",
                      borderRadius: 4, color: "hsl(var(--foreground))", fontSize: 12, outline: "none", boxSizing: "border-box"
                    }}
                  />
                </div>
              )}

              {startingTraining && (
                <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 6 }}>
                  <RefreshCw size={12} className="animate-spin" /> Snapshotting data & starting pipeline worker...
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowTrainModal(false)}
                  style={{
                    height: 36, flex: 1, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--border))", borderRadius: 4, fontWeight: 600, fontSize: 12, cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={startingTraining || (datasetSource === "zips" && !selectedDatasetId) || (datasetSource === "current_annotations" && projectImages.length === 0)}
                  style={{
                    height: 36, flex: 2,
                    background: (startingTraining || (datasetSource === "current_annotations" && projectImages.length === 0) || (datasetSource === "zips" && !selectedDatasetId)) ? "hsl(var(--muted))" : "hsl(var(--primary))",
                    color: (startingTraining || (datasetSource === "current_annotations" && projectImages.length === 0) || (datasetSource === "zips" && !selectedDatasetId)) ? "hsl(var(--muted-foreground))" : "#fff",
                    border: "none", borderRadius: 4, fontWeight: 600, fontSize: 12,
                    cursor: (startingTraining || (datasetSource === "current_annotations" && projectImages.length === 0) || (datasetSource === "zips" && !selectedDatasetId)) ? "not-allowed" : "pointer",
                    opacity: (startingTraining || (datasetSource === "current_annotations" && projectImages.length === 0) || (datasetSource === "zips" && !selectedDatasetId)) ? 0.5 : 1
                  }}
                >
                  {startingTraining ? "Starting..." : "Start Training Loop"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
