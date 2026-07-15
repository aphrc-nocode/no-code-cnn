import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Search, RefreshCw, Cpu, Play, Trash2 } from "lucide-react";
import api from "../api";

interface ModelJob {
  id: string;
  pipeline_config: {
    name: string;
    task_type: string;
    architecture: string;
    epochs: number;
  };
  status: string;
  metrics: Record<string, number>;
}

export default function ModelGarden() {
  const { id: projectId } = useParams<{ id: string }>();
  const [jobs, setJobs] = useState<ModelJob[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [testJobId, setTestJobId] = useState<string | null>(null);
  
  // Predict Form State
  const [testImageFile, setTestImageFile] = useState<File | null>(null);
  const [predictionResults, setPredictionResults] = useState<any>(null);
  const [explanationImg, setExplanationImg] = useState<string>("");
  const [predicting, setPredicting] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.get(projectId ? `/pipelines?project_id=${projectId}` : "/pipelines");
      // filter only completed jobs
      const completed = (res.data || []).filter((j: any) =>
        ["completed", "success"].includes(j.status?.toLowerCase())
      );
      setJobs(completed);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [projectId]);

  const handleDeleteModel = async (jobId: string) => {
    if (!window.confirm("Are you sure you want to delete this model and pipeline?")) return;
    try {
      await api.delete(`/pipelines/${jobId}`);
      fetchJobs();
    } catch {
      alert("Failed to delete model");
    }
  };

  const handleTestPrediction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testJobId || !testImageFile) return;

    setPredicting(true);
    setPredictionResults(null);
    setExplanationImg("");
    try {
      const formData = new FormData();
      formData.append("file", testImageFile);

      const res = await api.post(`/predict/${testJobId}`, formData);
      setPredictionResults(res.data.predictions || res.data);
      setExplanationImg(res.data.explanation_image || "");
    } catch {
      alert("Prediction request failed");
    } finally {
      setPredicting(false);
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
          <h2 className="text-xl font-black text-foreground">Model Garden</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Explore, evaluate, and test your trained computer vision models</p>
        </div>
      </div>

      {/* Search & Actions */}
      <div className="flex justify-between items-center gap-4">
        <div className="max-w-xs w-full relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search models..."
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

      {/* Models Grid/Table */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-muted/35 text-muted-foreground font-bold border-b border-border">
              <th className="p-4">Pipeline Details</th>
              <th className="p-4">Architecture</th>
              <th className="p-4">Task</th>
              <th className="p-4">Epochs</th>
              <th className="p-4">Latest Metrics</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  {loading ? "Loading models..." : "No trained models found."}
                </td>
              </tr>
            ) : (
              filteredJobs.map((j) => (
                <tr key={j.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="p-4">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <Cpu size={14} className="text-primary" /> {j.pipeline_config.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">Job ID: {j.id}</div>
                  </td>
                  <td className="p-4 font-mono">{j.pipeline_config.architecture}</td>
                  <td className="p-4">
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-bold capitalize">
                      {j.pipeline_config.task_type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-foreground">{j.pipeline_config.epochs}</td>
                  <td className="p-4 text-muted-foreground">
                    {j.metrics ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px]">
                        {Object.entries(j.metrics).map(([k, v]) => (
                          <span key={k} className="text-foreground font-semibold">
                            {k}: <strong className="text-primary">{v.toFixed(3)}</strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-4 text-right space-x-2">
                    <button
                      onClick={() => {
                        setTestJobId(j.id);
                        setPredictionResults(null);
                        setExplanationImg("");
                        setTestImageFile(null);
                      }}
                      className="bg-primary hover:bg-primary/95 text-white px-2.5 py-1.5 rounded-md font-semibold text-[10px] inline-flex items-center gap-1"
                    >
                      <Play size={10} /> Test Model
                    </button>
                    <button
                      onClick={() => handleDeleteModel(j.id)}
                      className="text-muted-foreground hover:text-destructive p-1.5 rounded-md transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Model Testing Drawer/Modal */}
      {testJobId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl scale-in overflow-y-auto max-h-[90vh]">
            <h3 className="font-black text-base text-foreground mb-4">Run Inference Test</h3>
            <form onSubmit={handleTestPrediction} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Upload Test Image</label>
                <input
                  type="file"
                  required
                  accept="image/*"
                  onChange={(e) => setTestImageFile(e.target.files?.[0] || null)}
                  className="w-full border border-border px-3 py-2 rounded-lg text-xs bg-background text-foreground"
                />
              </div>

              {predicting && (
                <div className="text-xs text-muted-foreground py-2 flex items-center gap-1.5">
                  <RefreshCw className="animate-spin" size={14} /> Performing predictions...
                </div>
              )}

              {predictionResults && (
                <div className="bg-slate-950 text-emerald-400 p-3 rounded-lg text-xs font-mono max-h-[180px] overflow-y-auto">
                  <span className="font-bold text-white block mb-1">Outputs</span>
                  {JSON.stringify(predictionResults, null, 2)}
                </div>
              )}

              {explanationImg && (
                <div>
                  <span className="text-xs font-semibold block mb-1">xAI Heatmap (Grad-CAM)</span>
                  <img
                    src={explanationImg}
                    alt="gradcam"
                    className="w-full rounded-lg border border-border max-h-[250px] object-contain"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTestJobId(null)}
                  className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-secondary/80 transition-colors"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={predicting || !testImageFile}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-xs hover:bg-primary/95 transition-all shadow disabled:opacity-50"
                >
                  Run Prediction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
