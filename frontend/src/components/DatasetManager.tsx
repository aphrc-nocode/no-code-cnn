import React, { useEffect, useState } from "react";
import { Search, UploadCloud, RefreshCw, Database } from "lucide-react";
import { useParams } from "react-router-dom";
import api from "../api";

interface Dataset {
  id: string;
  name: string;
  task_type: string;
  classes: string[];
  item_count: number;
  format?: string;
}

export default function DatasetManager() {
  const { id: projectId } = useParams<{ id: string }>();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Upload dataset form state
  const [datasetName, setDatasetName] = useState("");
  const [taskType, setTaskType] = useState("image_classification");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const fetchDatasets = async () => {
    setLoading(true);
    try {
      const res = await api.get(projectId ? `/datasets/available?project_id=${projectId}` : "/datasets/available");
      setDatasets(res.data || []);
    } catch {
      // Fallback mocks
      setDatasets([
        { id: "ds_1", name: "Plant Disease Classification", task_type: "classification", classes: ["healthy", "rust"], item_count: 45 },
        { id: "ds_2", name: "Defects Object Detection", task_type: "detection", classes: ["scratch", "crack"], item_count: 32 }
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatasets();
  }, [projectId]);

  const handleUploadDataset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !datasetName.trim()) return;

    setUploading(true);
    try {
      const datasetId = datasetName.toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'dataset_' + Date.now();
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (projectId) {
        formData.append("project_id", projectId);
      }
      if (taskType === "image_classification") {
        formData.append("file_type", "zip");
      }

      const uploadUrl = taskType === "object_detection"
        ? `/upload-detection-dataset/${datasetId}?task_type=${taskType}&dataset_name=${encodeURIComponent(datasetName)}`
        : `/upload-dataset/${datasetId}?task_type=${taskType}&dataset_name=${encodeURIComponent(datasetName)}`;

      await api.post(uploadUrl, formData);
      setShowUploadModal(false);
      setDatasetName("");
      setSelectedFile(null);
      fetchDatasets();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to upload dataset");
    } finally {
      setUploading(false);
    }
  };

  const filteredDatasets = datasets.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 bg-background text-foreground h-full overflow-y-auto">
      {/* Title Bar */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-black text-foreground">Manage Datasets</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Upload and organize source image datasets</p>
        </div>
        <button
          onClick={() => setShowUploadModal(true)}
          className="bg-primary hover:bg-primary/95 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow"
        >
          <UploadCloud size={14} /> Upload Dataset
        </button>
      </div>

      {/* Search & Actions */}
      <div className="flex justify-between items-center gap-4">
        <div className="max-w-xs w-full relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search datasets..."
            className="w-full bg-card border border-border pl-9 pr-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
          />
          <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
        </div>
        <button
          onClick={fetchDatasets}
          disabled={loading}
          className="flex items-center gap-1 bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-3 py-1.5 rounded-lg text-xs font-semibold"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Datasets Table */}
      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-muted/35 text-muted-foreground font-bold border-b border-border">
              <th className="p-4">Name / ID</th>
              <th className="p-4">Task Type</th>
              <th className="p-4">Classes</th>
              <th className="p-4 text-right">Items Count</th>
            </tr>
          </thead>
          <tbody>
            {filteredDatasets.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  {loading ? "Loading datasets..." : "No datasets available."}
                </td>
              </tr>
            ) : (
              filteredDatasets.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                  <td className="p-4 font-semibold text-foreground">
                    <div>{d.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{d.id}</div>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary capitalize">
                      {d.task_type.replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-4 text-muted-foreground leading-relaxed truncate max-w-xs">
                    {d.classes ? d.classes.join(", ") : "-"}
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-foreground">
                    {d.item_count}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl scale-in">
            <h3 className="font-black text-base text-foreground mb-4">Upload Dataset ZIP</h3>
            <form onSubmit={handleUploadDataset} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Dataset Name</label>
                <input
                  type="text"
                  required
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="e.g., Apple Defects ZIP"
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Task Type</label>
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-xs"
                >
                  <option value="image_classification">Image Classification</option>
                  <option value="object_detection">Object Detection</option>
                  <option value="image_segmentation">Image Segmentation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Select Dataset ZIP File</label>
                <input
                  type="file"
                  required
                  accept=".zip"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full border border-border px-3 py-2 rounded-lg text-xs bg-background text-foreground"
                />
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  ZIP file must contain images and class folders (for classification) or annotations.
                </span>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-xs hover:bg-primary/95 transition-all shadow disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload Dataset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
