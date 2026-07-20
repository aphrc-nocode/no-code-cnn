import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Search, RefreshCw, ExternalLink, Activity, Play, AlertTriangle, TrendingUp } from "lucide-react";
import api from "../../api";

interface PipelineJob {
  id: string;
  pipeline_config: {
    name: string;
    task_type: string;
    architecture: string;
    epochs: number;
    batch_size: number;
  };
  status: string;
  created_at: string;
  metrics?: Record<string, number>;
}

export default function TrainingJobs() {
  const { id: projectId } = useParams<{ id: string }>();
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [mlflowUrl, setMlflowUrl] = useState<string>("");
  const [curvesJobId, setCurvesJobId] = useState<string | null>(null);
  const [curvesPlot, setCurvesPlot] = useState<string>("");
  const [loadingCurves, setLoadingCurves] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.get(projectId ? `/pipelines?project_id=${projectId}` : "/pipelines");
      setJobs(res.data || []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchMlflowUrl = async () => {
    try {
      const res = await api.get("/mlflow/ui-url");
      if (res.data && res.data.url) {
        setMlflowUrl(res.data.url);
      }
    } catch {
      setMlflowUrl("http://localhost:5000"); // Standard default
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchMlflowUrl();
  }, [projectId]);

  const handleOpenMlflow = () => {
    window.open(mlflowUrl || "http://localhost:5000", "_blank");
  };

  const handleViewCurves = async (jobId: string) => {
    setCurvesJobId(jobId);
    setCurvesPlot("");
    setLoadingCurves(true);
    try {
      const res = await api.get(`/pipelines/${jobId}/training-metrics`);
      if (res.data && res.data.training_curves_base64) {
        setCurvesPlot(`data:image/png;base64,${res.data.training_curves_base64}`);
      } else if (res.data && res.data.error) {
        alert(res.data.error);
      } else {
        alert("No training curves found.");
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to load curves");
    } finally {
      setLoadingCurves(false);
    }
  };

  const filteredJobs = jobs.filter((j) =>
    j.pipeline_config.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 bg-background text-foreground h-full overflow-y-auto">
      {/* Title Bar */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black text-foreground">Training Jobs</h2>
          <p className="text-xs text-muted-foreground mt-0.5 font-medium">Track your model training runs and background workers</p>
        </div>
        <button
          onClick={handleOpenMlflow}
          className="bg-primary hover:bg-primary/95 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
        >
          <ExternalLink size={14} /> Open MLflow UI
        </button>
      </div>

      {/* Search & Actions */}
      <div className="flex justify-between items-center gap-4">
        <div className="max-w-xs w-full relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search training runs..."
            className="w-full bg-card border border-border pl-9 pr-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
          />
          <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
        </div>
        <button
          onClick={fetchJobs}
          disabled={loading}
          className="flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-3 py-1.5 rounded-lg text-xs font-semibold"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Table List of Recent Jobs */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-muted/35 text-muted-foreground font-bold border-b border-border">
              <th className="p-4">Run Details</th>
              <th className="p-4">Hyperparameters</th>
              <th className="p-4">Status</th>
              <th className="p-4">Started At</th>
              <th className="p-4">Metrics Summary</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  {loading ? "Loading jobs..." : "No training jobs found."}
                </td>
              </tr>
            ) : (
              filteredJobs.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="p-4">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Activity size={14} className="text-primary" /> {j.pipeline_config.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">ID: {j.id}</div>
                  </td>
                  <td className="p-4 text-muted-foreground">
                    <div className="flex flex-wrap gap-x-2 text-[10px]">
                      <span>Arch: <strong className="text-foreground font-semibold">{j.pipeline_config.architecture}</strong></span>
                      <span>•</span>
                      <span>Batch: <strong className="text-foreground font-semibold">{j.pipeline_config.batch_size}</strong></span>
                      <span>•</span>
                      <span>Epochs: <strong className="text-foreground font-semibold">{j.pipeline_config.epochs}</strong></span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      j.status === "completed" || j.status === "success"
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
                        : j.status === "running"
                        ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                        : j.status === "error" || j.status === "failed"
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                        : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                    }`}>
                      {j.status || "pending"}
                    </span>
                  </td>
                  <td className="p-4 text-muted-foreground font-mono">
                    {j.created_at ? new Date(j.created_at).toLocaleString() : "-"}
                  </td>
                  <td className="p-4">
                    {j.metrics && Object.keys(j.metrics).length > 0 ? (
                      <div className="flex flex-wrap gap-2 text-[10px] font-mono font-bold bg-secondary px-2.5 py-1 rounded-md text-foreground">
                        {Object.entries(j.metrics)
                          .filter(([k]) => !k.startsWith("train_") && !k.startsWith("val_"))
                          .map(([k, v]) => (
                            <span key={k} className="whitespace-nowrap">{k}: {typeof v === "number" ? v.toFixed(3) : String(v)}</span>
                          ))
                        }
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="p-4 text-right">
                    {["completed", "success"].includes(j.status?.toLowerCase()) && (
                      <button
                        onClick={() => handleViewCurves(j.id)}
                        className="bg-secondary hover:bg-secondary/80 border border-border text-foreground px-2.5 py-1.5 rounded-md font-semibold text-[10px] inline-flex items-center gap-1"
                      >
                        <TrendingUp size={10} /> Curves
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Curves Modal */}
      {curvesJobId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-2xl w-full p-6 shadow-2xl scale-in overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-black text-base text-foreground">Training Curves</h3>
              <button 
                onClick={() => setCurvesJobId(null)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold"
              >
                ✕ Close
              </button>
            </div>
            
            {loadingCurves ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <RefreshCw className="animate-spin" size={24} />
                <span className="text-xs">Loading training history curves...</span>
              </div>
            ) : curvesPlot ? (
              <div className="flex justify-center">
                <img
                  src={curvesPlot}
                  alt="Training Curves"
                  className="w-full rounded-lg border border-border max-h-[450px] object-contain bg-white"
                />
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground py-8">
                No curves data available.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
