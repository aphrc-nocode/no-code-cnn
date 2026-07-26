import React, { useEffect, useState } from "react";
import { 
  Search, UploadCloud, RefreshCw, Database, FileImage, 
  Layers, Download, Plus, CheckCircle, AlertCircle, Tag, Eye, Play, Sparkles
} from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../api";

interface MediaItem {
  id: string;
  filename: string;
  path: string;
  status: "annotated" | "unannotated";
  checksum?: string;
  width?: number;
  height?: number;
  annotations?: any[];
  added_at?: number;
  source_zip?: string;
}

interface DatasetVersionSnapshot {
  version_id: string;
  version_name: string;
  created_at: number;
  sample_count: number;
  classes: string[];
  split_ratios: { train: number; val: number };
}

export default function DatasetManager() {
  const { id: projectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"explorer" | "versions">("explorer");

  // Master Dataset Items State
  const [items, setItems] = useState<MediaItem[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Version Snapshots State
  const [versions, setVersions] = useState<DatasetVersionSnapshot[]>([]);
  const [showVersionModal, setShowVersionModal] = useState<boolean>(false);
  const [versionName, setVersionName] = useState<string>("v1.0");
  const [trainRatio, setTrainRatio] = useState<number>(70);
  const [valRatio, setValRatio] = useState<number>(20);
  const [creatingVersion, setCreatingVersion] = useState<boolean>(false);

  // Import Modal & Label Mapping State (Geti Workflow)
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importStep, setImportStep] = useState<1 | 2>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [zipPreview, setZipPreview] = useState<any>(null);
  const [labelMapping, setLabelMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<boolean>(false);

  const [annotatedCount, setAnnotatedCount] = useState<number>(0);
  const [unannotatedCount, setUnannotatedCount] = useState<number>(0);

  const fetchDatasetItems = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        status_filter: statusFilter,
        class_filter: classFilter,
      };
      if (searchQuery && searchQuery.trim() !== "") {
        params.search = searchQuery.trim();
      }
      const res = await api.get(`/projects/${projectId}/dataset/items`, { params });
      const fetchedItems = res.data.items || [];
      setItems(fetchedItems);
      setClasses(res.data.classes || []);
      setTotalCount(res.data.total_count ?? fetchedItems.length);
      
      const annCount = res.data.annotated_count ?? fetchedItems.filter((i: any) => i.status === "annotated" || (i.annotations && i.annotations.length > 0)).length;
      const unannCount = res.data.unannotated_count ?? (res.data.total_count ? Math.max(0, res.data.total_count - annCount) : fetchedItems.filter((i: any) => i.status !== "annotated").length);
      
      setAnnotatedCount(annCount);
      setUnannotatedCount(unannCount);
    } catch (err) {
      console.error("Failed to fetch unified dataset items", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchVersions = async () => {
    if (!projectId) return;
    try {
      const res = await api.get(`/projects/${projectId}/dataset/versions`);
      setVersions(res.data || []);
    } catch (err) {
      console.error("Failed to fetch version snapshots", err);
    }
  };

  useEffect(() => {
    fetchDatasetItems();
  }, [projectId, statusFilter, classFilter, searchQuery]);

  useEffect(() => {
    if (activeTab === "versions") {
      fetchVersions();
    }
  }, [projectId, activeTab]);

  // Step 1: Preview ZIP Archive
  const handleZipFileSelected = async (file: File) => {
    setSelectedFile(file);
    if (!projectId) return;
    setPreviewLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(`/projects/${projectId}/dataset/import-preview`, formData);
      setZipPreview(res.data);

      // Pre-fill label mapping
      const initMap: Record<string, string> = {};
      (res.data.detected_classes || []).forEach((cls: string) => {
        initMap[cls] = cls;
      });
      setLabelMapping(initMap);
      setImportStep(2);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to analyze dataset ZIP");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Step 2: Confirm Ingestion
  const handleConfirmImport = async () => {
    if (!selectedFile || !projectId) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("label_mapping", JSON.stringify(labelMapping));
      formData.append("task_type", "object_detection");

      const res = await api.post(`/projects/${projectId}/dataset/import`, formData);
      alert(`Successfully ingested ${res.data.added_count} items (${res.data.skipped_count} skipped duplicates)!`);
      setShowImportModal(false);
      setImportStep(1);
      setSelectedFile(null);
      setZipPreview(null);
      fetchDatasetItems();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to ingest dataset ZIP");
    } finally {
      setImporting(false);
    }
  };

  // Create Snapshot Version
  const handleCreateVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !versionName.trim()) return;
    setCreatingVersion(true);
    try {
      const tRatio = trainRatio / 100.0;
      const vRatio = valRatio / 100.0;
      const teRatio = Math.max(0, (100 - trainRatio - valRatio)) / 100.0;
      await api.post(`/projects/${projectId}/dataset/versions`, {
        version_name: versionName,
        train_ratio: tRatio,
        val_ratio: vRatio,
        test_ratio: teRatio
      });
      setShowVersionModal(false);
      setVersionName("");
      fetchVersions();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to create dataset snapshot");
    } finally {
      setCreatingVersion(false);
    }
  };

  // Export Dataset ZIP
  const handleExportDataset = (versionId?: string) => {
    if (!projectId) return;
    const exportUrl = `/api/v1/projects/${projectId}/dataset/export${versionId ? `?version_id=${versionId}` : ""}`;
    window.open(exportUrl, "_blank");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }} className="bg-background text-foreground">
      {/* ── Sub Header / Navigation Tabs ── */}
      <div style={{
        minHeight: 48,
        height: "auto",
        background: "hsl(var(--secondary) / 0.4)",
        borderBottom: "1px solid hsl(var(--border))",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 16px",
        flexWrap: "wrap",
        gap: 12,
        flexShrink: 0
      }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", overflowX: "auto", maxWidth: "100%" }}>
          <button
            onClick={() => setActiveTab("explorer")}
            style={{
              height: 32,
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "explorer" ? "2.5px solid hsl(var(--primary))" : "2.5px solid transparent",
              color: activeTab === "explorer" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap"
            }}
          >
            <FileImage size={15} />
            <span>Master Dataset Pool</span>
            <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-[10px] font-bold">
              {totalCount}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("versions")}
            style={{
              height: 32,
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "versions" ? "2.5px solid hsl(var(--primary))" : "2.5px solid transparent",
              color: activeTab === "versions" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap"
            }}
          >
            <Layers size={15} />
            <span>Dataset Versions</span>
          </button>
        </div>

        {/* Global Action Controls */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => { setShowImportModal(true); setImportStep(1); }}
            className="bg-primary hover:bg-primary/95 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow transition-all"
          >
            <UploadCloud size={14} /> Import Dataset
          </button>
          <button
            onClick={() => setShowVersionModal(true)}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
          >
            <Plus size={14} /> Create Version
          </button>
          <button
            onClick={() => handleExportDataset()}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5"
            title="Export full dataset as ZIP"
          >
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── Main Tab Content ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeTab === "explorer" ? (
          <div className="p-6 space-y-6 h-full overflow-y-auto">
            {/* Stats Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-card border border-border p-4 rounded-xl flex items-center gap-3">
                <div className="p-3 bg-primary/10 text-primary rounded-lg"><Database size={20} /></div>
                <div>
                  <div className="text-[11px] text-muted-foreground font-semibold">Total Items</div>
                  <div className="text-xl font-black text-foreground">{totalCount}</div>
                </div>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl flex items-center gap-3">
                <div className="p-3 bg-green-500/10 text-green-500 rounded-lg"><CheckCircle size={20} /></div>
                <div>
                  <div className="text-[11px] text-muted-foreground font-semibold">Annotated Items</div>
                  <div className="text-xl font-black text-foreground">{annotatedCount}</div>
                </div>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl flex items-center gap-3">
                <div className="p-3 bg-amber-500/10 text-amber-500 rounded-lg"><AlertCircle size={20} /></div>
                <div>
                  <div className="text-[11px] text-muted-foreground font-semibold">Unannotated Items</div>
                  <div className="text-xl font-black text-foreground">{unannotatedCount}</div>
                </div>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl flex items-center gap-3">
                <div className="p-3 bg-purple-500/10 text-purple-500 rounded-lg"><Tag size={20} /></div>
                <div>
                  <div className="text-[11px] text-muted-foreground font-semibold">Project Classes</div>
                  <div className="text-xl font-black text-foreground">{classes.length}</div>
                </div>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap justify-between items-center gap-4 bg-card border border-border p-3 rounded-xl">
              <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search media items..."
                    className="w-full bg-background border border-border pl-9 pr-3 py-1.5 rounded-lg text-xs outline-none focus:ring-2 focus:ring-primary"
                  />
                  <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground font-semibold">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-background border border-border px-2.5 py-1.5 rounded-lg text-xs outline-none"
                  >
                    <option value="all">All Items</option>
                    <option value="annotated">Annotated</option>
                    <option value="unannotated">Unannotated</option>
                  </select>
                </div>

                {/* Class Filter */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground font-semibold">Class:</span>
                  <select
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    className="bg-background border border-border px-2.5 py-1.5 rounded-lg text-xs outline-none"
                  >
                    <option value="all">All Classes</option>
                    {classes.map((cls) => (
                      <option key={cls} value={cls}>
                        {cls}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={fetchDatasetItems}
                disabled={loading}
                className="flex items-center gap-1 bg-secondary text-secondary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold ml-auto"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
            </div>

            {/* Media Items Grid */}
            {items.length === 0 ? (
              <div className="border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground bg-card">
                <Database size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold">No media items match your criteria</p>
                <p className="text-xs mt-1">Import a dataset ZIP or add images to start building your unified dataset.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                {items.map((item) => {
                  const targetId = item.id || item.filename;
                  const imgUrl = `/api/v1/projects/${projectId}/images/${encodeURIComponent(targetId)}/file`;
                  const isAnnotated = item.status === "annotated" || (item.annotations && item.annotations.length > 0);
                  return (
                    <div
                      key={item.id}
                      onClick={() => navigate(`/projects/${projectId}/annotate/${encodeURIComponent(targetId)}`)}
                      className="bg-card border border-border hover:border-primary/80 rounded-lg p-2 flex flex-col gap-2 group cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="w-full h-[120px] rounded border border-border overflow-hidden bg-slate-950 relative flex items-center justify-center">
                        <img
                          src={imgUrl}
                          alt={item.filename}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => { (e.target as any).style.display = "none"; }}
                        />
                        <div className="absolute top-1.5 right-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold shadow flex items-center gap-1 ${
                            isAnnotated
                              ? "bg-emerald-500 text-white"
                              : "bg-slate-900/80 text-slate-300 border border-slate-700 backdrop-blur-sm"
                          }`}>
                            {isAnnotated ? "Annotated" : "Unannotated"}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5 px-0.5">
                        <div className="text-[11px] font-semibold text-foreground truncate" title={item.filename}>
                          {item.filename}
                        </div>
                        <div className="text-[9px] text-muted-foreground font-mono truncate">
                          {item.width && item.height ? `${item.width}x${item.height}` : ""}
                          {item.annotations && item.annotations.length > 0 ? ` • ${item.annotations.length} obj` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Dataset Versions Tab ── */
          <div className="p-6 space-y-6 h-full overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-bold text-foreground">Dataset Versions & Snapshots</h3>
                <p className="text-xs text-muted-foreground">Immutable dataset versions locked for training model pipelines</p>
              </div>
              <button
                onClick={() => setShowVersionModal(true)}
                className="bg-primary hover:bg-primary/95 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow"
              >
                <Plus size={14} /> Create Snapshot Version
              </button>
            </div>

            {versions.length === 0 ? (
              <div className="border border-dashed border-border rounded-xl p-12 text-center text-muted-foreground bg-card">
                <Layers size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm font-semibold">No version snapshots created yet</p>
                <p className="text-xs mt-1">Create a dataset version snapshot (e.g. v1.0) to lock your annotations and train models.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {versions.map((v) => (
                  <div key={v.version_id} className="bg-card border border-border rounded-xl p-5 space-y-4 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-base font-black text-foreground flex items-center gap-2">
                          <Layers size={18} className="text-primary" /> {v.version_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                          ID: {v.version_id} • Created: {new Date(v.created_at * 1000).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => handleExportDataset(v.version_id)}
                        className="bg-secondary hover:bg-secondary/80 border border-border text-foreground px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"
                      >
                        <Download size={12} /> Export ZIP
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-muted/20 p-3 rounded-lg text-xs">
                      <div>
                        <span className="text-[10px] text-muted-foreground block font-semibold">Samples</span>
                        <span className="font-bold text-foreground">{v.sample_count}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block font-semibold">Classes</span>
                        <span className="font-bold text-foreground">{v.classes.length}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block font-semibold">Train/Val Split</span>
                        <span className="font-bold text-primary">
                          {Math.round(v.split_ratios.train * 100)} / {Math.round(v.split_ratios.val * 100)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Import Dataset ZIP & Label Mapping Modal (Geti Import Workflow) ── */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl scale-in space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <UploadCloud size={18} className="text-primary" /> Import Dataset ZIP (Geti Workflow)
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-muted-foreground hover:text-foreground text-sm font-semibold">✕</button>
            </div>

            {importStep === 1 ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Select a dataset ZIP archive (COCO JSON, YOLO, or image folders). The system will unpack and analyze the dataset labels before ingestion.</p>

                <div className="border-2 border-dashed border-border rounded-xl p-8 text-center bg-background hover:border-primary/50 transition-colors">
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleZipFileSelected(f);
                    }}
                    className="hidden"
                    id="zip-upload-input"
                  />
                  <label htmlFor="zip-upload-input" className="cursor-pointer flex flex-col items-center gap-2">
                    <UploadCloud size={32} className="text-primary" />
                    <span className="text-xs font-bold text-foreground">Click to select ZIP Archive</span>
                    <span className="text-[10px] text-muted-foreground">Supports COCO, YOLO, and Images ZIPs</span>
                  </label>
                </div>

                {previewLoading && (
                  <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 py-2">
                    <RefreshCw className="animate-spin" size={14} /> Analyzing dataset format & labels...
                  </div>
                )}
              </div>
            ) : (
              /* Step 2: Label Mapping & Ingestion Confirmation */
              <div className="space-y-4">
                <div className="bg-primary/10 border border-primary/20 p-3 rounded-lg text-xs space-y-1">
                  <div className="font-bold text-primary flex items-center gap-1.5">
                    <Sparkles size={14} /> Dataset Analysis Complete
                  </div>
                  <div>Format: <strong className="uppercase">{zipPreview?.format}</strong> • Images: <strong>{zipPreview?.image_count}</strong></div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-2">Label Mapping & Conflict Resolution</label>
                  <p className="text-[11px] text-muted-foreground mb-3">Map dataset labels from the ZIP to your existing project classes:</p>

                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(zipPreview?.detected_classes || []).map((zipCls: string) => (
                      <div key={zipCls} className="flex items-center justify-between gap-3 text-xs bg-background p-2 rounded-lg border border-border">
                        <span className="font-mono font-semibold text-foreground truncate max-w-[150px]">{zipCls}</span>
                        <span>➔</span>
                        <input
                          type="text"
                          value={labelMapping[zipCls] || zipCls}
                          onChange={(e) => setLabelMapping({ ...labelMapping, [zipCls]: e.target.value })}
                          className="bg-card border border-border px-2 py-1 rounded text-xs text-foreground outline-none w-40"
                          placeholder="Project label"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setImportStep(1)} className="px-4 py-2 border border-border rounded-lg text-xs font-bold hover:bg-secondary">
                    Back
                  </button>
                  <button
                    onClick={handleConfirmImport}
                    disabled={importing}
                    className="px-4 py-2 bg-primary text-white font-bold rounded-lg text-xs hover:bg-primary/95 flex items-center gap-1.5 shadow"
                  >
                    {importing ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle size={14} />}
                    {importing ? "Ingesting..." : "Confirm & Ingest"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Create Version Snapshot Modal ── */}
      {showVersionModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl scale-in space-y-4">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
                <Layers size={18} className="text-primary" /> Create Dataset Version Snapshot
              </h3>
              <button onClick={() => setShowVersionModal(false)} className="text-muted-foreground hover:text-foreground text-sm font-semibold">✕</button>
            </div>

            <form onSubmit={handleCreateVersion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">Version Name / Release</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. v1.0, v2.0 or Initial Annotation Set"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  className="w-full border border-border px-3 py-2 rounded-lg text-xs bg-background text-foreground outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Dataset Split Ratios ({trainRatio}% Train / {valRatio}% Val / {Math.max(0, 100 - trainRatio - valRatio)}% Test)</label>
                <div className="space-y-2 pt-1">
                  <div>
                    <span className="text-[10px] text-muted-foreground font-semibold">Train Ratio: {trainRatio}%</span>
                    <input
                      type="range"
                      min="40"
                      max="90"
                      value={trainRatio}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setTrainRatio(val);
                        if (val + valRatio > 95) setValRatio(Math.max(5, 95 - val));
                      }}
                      className="w-full accent-primary"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground font-semibold">Validation Ratio: {valRatio}%</span>
                    <input
                      type="range"
                      min="5"
                      max="40"
                      value={valRatio}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (trainRatio + val <= 95) setValRatio(val);
                      }}
                      className="w-full accent-primary"
                    />
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground bg-secondary/50 p-2 rounded border border-border">
                    Test Set Ratio: <span className="font-bold text-foreground">{Math.max(0, 100 - trainRatio - valRatio)}%</span> (Reserved for model performance evaluation)
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowVersionModal(false)} className="px-4 py-2 border border-border rounded-lg text-xs font-semibold">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingVersion || !versionName.trim()}
                  className="px-4 py-2 bg-primary text-white font-bold rounded-lg text-xs hover:bg-primary/95 flex items-center gap-1.5 shadow"
                >
                  {creatingVersion ? <RefreshCw className="animate-spin" size={14} /> : <Layers size={14} />}
                  {creatingVersion ? "Creating Snapshot..." : "Create Snapshot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

