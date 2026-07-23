import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Play, UploadCloud, RefreshCw, Sliders, ShieldAlert, Cpu } from "lucide-react";
import api from "../../api";

interface TrainedModel {
  id: string;
  pipeline_config: {
    name: string;
    task_type: string;
    architecture: string;
    epochs: number;
  };
  status: string;
  metrics?: Record<string, number>;
}

export default function TestModel() {
  const { id: projectId } = useParams<{ id: string }>();
  const [models, setModels] = useState<TrainedModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [loadingModels, setLoadingModels] = useState(false);

  // Testing Image State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string>("");
  const [predicting, setPredicting] = useState(false);
  const [predictionResults, setPredictionResults] = useState<any>(null);
  const [explanationImg, setExplanationImg] = useState<string>("");

  // Controls
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.5);
  const [explainMethod, setExplainMethod] = useState<string>("none");
  const [selectedBoxIndex, setSelectedBoxIndex] = useState<number>(-1);

  // Hover states for overlays
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  
  // Ref for image dimension tracking
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });

  useEffect(() => {
    fetchModels();
  }, [projectId]);

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const res = await api.get(projectId ? `/pipelines?project_id=${projectId}` : "/pipelines");
      const completed = (res.data || []).filter((j: any) =>
        ["completed", "success"].includes(j.status?.toLowerCase())
      );
      setModels(completed);
      if (completed.length > 0) {
        setSelectedModelId(completed[completed.length - 1].id);
      }
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImageSrc(URL.createObjectURL(file));
      setPredictionResults(null);
      setExplanationImg("");
      setSelectedBoxIndex(-1);
    }
  };

  const handleImageLoad = () => {
    if (imgRef.current) {
      setImgDimensions({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
        naturalWidth: imgRef.current.naturalWidth,
        naturalHeight: imgRef.current.naturalHeight
      });
    }
  };

  useEffect(() => {
    const updateDimensions = () => {
      if (imgRef.current) {
        setImgDimensions(prev => ({
          ...prev,
          width: imgRef.current?.clientWidth || 0,
          height: imgRef.current?.clientHeight || 0
        }));
      }
    };
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [imageSrc]);

  const handleRunInference = async () => {
    if (!selectedModelId || !imageFile) return;

    setPredicting(true);
    setExplanationImg("");
    try {
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("confidence_threshold", confidenceThreshold.toString());
      formData.append("explain_method", explainMethod);
      if (selectedBoxIndex >= 0) {
        formData.append("explain_box_index", selectedBoxIndex.toString());
      }

      const res = await api.post(`/predict/${selectedModelId}`, formData);
      setPredictionResults(res.data);
      if (res.data.explanation_image) {
        setExplanationImg(`data:image/png;base64,${res.data.explanation_image}`);
      }
    } catch {
      alert("Inference test failed.");
    } finally {
      setPredicting(false);
    }
  };

  // Re-trigger inference when explanation method or box index changes
  useEffect(() => {
    if (predictionResults && explainMethod !== "none") {
      handleRunInference();
    }
  }, [explainMethod, selectedBoxIndex]);

  const selectedModel = models.find(m => m.id === selectedModelId);
  const taskType = selectedModel?.pipeline_config.task_type;

  // Filter detections based on threshold slider in client-side
  const rawDetections = predictionResults?.detections || [];
  const filteredDetections = rawDetections.filter((d: any) => {
    const confDec = d.confidence > 1 ? d.confidence / 100 : d.confidence;
    return confDec >= confidenceThreshold;
  });

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", background: "hsl(var(--background))" }}>
      {/* ── Left Side Panel: Configurations & Actions ── */}
      <div style={{
        width: 320,
        background: "hsl(var(--card))",
        borderRight: "1px solid hsl(var(--border))",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        overflowY: "auto",
        flexShrink: 0
      }}>
        <div>
          <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px" }}>
            Model Selection
          </h3>
          {loadingModels ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
              <RefreshCw size={12} className="animate-spin" /> Loading models...
            </div>
          ) : models.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "hsl(var(--destructive))", padding: "8px 12px", border: "1px solid hsl(var(--border))", borderRadius: 4 }}>
              <ShieldAlert size={14} /> No trained models available. Go to the Models tab to train a model first.
            </div>
          ) : (
            <select
              value={selectedModelId}
              onChange={(e) => {
                setSelectedModelId(e.target.value);
                setPredictionResults(null);
                setExplanationImg("");
              }}
              style={{
                width: "100%",
                height: 36,
                background: "hsl(var(--secondary))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 4,
                color: "hsl(var(--foreground))",
                padding: "0 10px",
                outline: "none",
                fontSize: 12
              }}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.pipeline_config.name} ({m.pipeline_config.architecture})
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedModel && (
          <>
            <div>
              <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px" }}>
                Upload Image
              </h3>
              <div
                onClick={() => document.getElementById("test-img-file")?.click()}
                style={{
                  border: "1px dashed hsl(var(--border))",
                  borderRadius: 4,
                  padding: "20px 10px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "hsl(var(--secondary) / 0.3)",
                  transition: "border 0.2s"
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "hsl(var(--primary))"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "hsl(var(--border))"}
              >
                <UploadCloud size={24} style={{ color: "hsl(var(--primary))", margin: "0 auto 8px" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--foreground))", display: "block" }}>
                  {imageFile ? imageFile.name : "Choose test image"}
                </span>
                <span style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", display: "block", marginTop: 2 }}>
                  Drag & drop or browse
                </span>
                <input
                  id="test-img-file"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(var(--foreground))" }}>Confidence Threshold</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "hsl(var(--primary))" }}>
                  {Math.round(confidenceThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.95"
                step="0.05"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>

            <div>
              <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 10px" }}>
                Explainability (XAI)
              </h3>
              <select
                value={explainMethod}
                onChange={(e) => {
                  setExplainMethod(e.target.value);
                  if (e.target.value === "none") {
                    setExplanationImg("");
                  }
                }}
                style={{
                  width: "100%",
                  height: 36,
                  background: "hsl(var(--secondary))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 4,
                  color: "hsl(var(--foreground))",
                  padding: "0 10px",
                  outline: "none",
                  fontSize: 12
                }}
              >
                <option value="none">Disabled</option>
                <option value="gradcam">Grad-CAM (Attention Map)</option>
              </select>
              <p style={{ fontSize: 9, color: "hsl(var(--muted-foreground))", marginTop: 4, lineHeight: 1.4 }}>
                Grad-CAM overlays heatmaps displaying pixels the model computed to make prediction features.
              </p>
            </div>

            <button
              onClick={handleRunInference}
              disabled={predicting || !imageFile}
              style={{
                width: "100%",
                height: 40,
                background: "hsl(var(--primary))",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 10,
                opacity: (predicting || !imageFile) ? 0.5 : 1
              }}
            >
              {predicting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" /> Performing...
                </>
              ) : (
                <>
                  <Play size={14} /> Run Prediction
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* ── Right Content Viewport: Interactive Previews ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!imageSrc ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "hsl(var(--muted-foreground))" }}>
            <Cpu size={36} />
            <p style={{ fontSize: 13, fontWeight: 500 }}>Select a model and upload an image to begin testing</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: explanationImg ? "1fr 1fr" : "1fr", padding: 24, gap: 24, overflowY: "auto" }}>
            
            {/* 1. Main Viewport overlaying predictions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                Prediction Canvas
              </h4>
              <div style={{
                position: "relative",
                background: "hsl(var(--secondary) / 0.2)",
                border: "1px solid hsl(var(--border))",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flex: 1,
                minHeight: 350,
                position: "relative"
              }}>
                <div style={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%" }}>
                  <img
                    ref={imgRef}
                    src={imageSrc}
                    alt="Inference image"
                    onLoad={handleImageLoad}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
                  />

                  {/* Overlaid interactive bounding boxes for object detection */}
                  {taskType === "object_detection" && predictionResults && imgDimensions.width > 0 && (
                    <div style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: imgDimensions.width,
                      height: imgDimensions.height,
                      pointerEvents: "none"
                    }}>
                      {filteredDetections.map((det: any, idx: number) => {
                        const box = det.box;
                        if (!box || box.length !== 4) return null;

                        const scaleX = imgDimensions.width / (imgDimensions.naturalWidth || 1);
                        const scaleY = imgDimensions.height / (imgDimensions.naturalHeight || 1);

                        const x1 = box[0] * scaleX;
                        const y1 = box[1] * scaleY;
                        const x2 = box[2] * scaleX;
                        const y2 = box[3] * scaleY;

                        const width = x2 - x1;
                        const height = y2 - y1;

                        const isHovered = hoveredIndex === idx;
                        const isSelected = selectedBoxIndex === idx;

                        let displayName = det.class_name || "";
                        if (!displayName || displayName.toLowerCase().startsWith("class_")) {
                          if (det.actual_class_name && !det.actual_class_name.toLowerCase().startsWith("class_")) {
                            displayName = det.actual_class_name;
                          } else if (displayName.toLowerCase().startsWith("class_")) {
                            const num = displayName.split("_")[1] || (idx + 1);
                            displayName = `Object ${num}`;
                          } else {
                            displayName = `Object ${det.label || idx + 1}`;
                          }
                        }

                        return (
                          <div
                            key={idx}
                            style={{
                              position: "absolute",
                              left: x1,
                              top: y1,
                              width: width,
                              height: height,
                              border: isSelected ? "3.5px solid #10B981" : isHovered ? "3.5px solid #2563EB" : "3px solid #3B82F6",
                              backgroundColor: isSelected ? "rgba(16, 185, 129, 0.12)" : isHovered ? "rgba(37, 99, 235, 0.18)" : "rgba(59, 130, 246, 0.08)",
                              boxShadow: isSelected ? "0 0 12px rgba(16, 185, 129, 0.6)" : isHovered ? "0 0 10px rgba(37, 99, 235, 0.5)" : "0 0 4px rgba(0, 0, 0, 0.2)",
                              pointerEvents: "auto",
                              cursor: "pointer",
                              borderRadius: 3
                            }}
                            onMouseEnter={() => setHoveredIndex(idx)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            onClick={() => {
                              setSelectedBoxIndex(idx);
                            }}
                          >
                            <div style={{
                              position: "absolute",
                              top: -20,
                              left: -3,
                              background: isSelected ? "#10B981" : "#2563EB",
                              color: "#fff",
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "4px 4px 0 0",
                              whiteSpace: "nowrap",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                              boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                            }}>
                              {displayName} ({Math.round(det.confidence > 1 ? det.confidence : det.confidence * 100)}%)
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Saliency Grad-CAM explanation Viewport */}
            {explanationImg && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h4 style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                  Feature Saliency Map
                </h4>
                <div style={{
                  background: "hsl(var(--secondary) / 0.2)",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  flex: 1,
                  minHeight: 350
                }}>
                  <img
                    src={explanationImg}
                    alt="gradcam heatmap"
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
                  />
                </div>
              </div>
            )}

            {/* 3. Prediction list summary */}
            {predictionResults && (
              <div style={{ gridColumn: explanationImg ? "span 2" : "1", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, padding: 20 }}>
                <h4 style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", margin: "0 0 12px" }}>
                  Prediction Performance Summary
                </h4>
                
                {/* Image Classification Results */}
                {taskType === "image_classification" && predictionResults.predictions && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {predictionResults.predictions.map((pred: any, idx: number) => (
                      <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>{pred.class_name}</span>
                          <span style={{ fontWeight: 700, color: "hsl(var(--primary))" }}>{pred.confidence.toFixed(1)}%</span>
                        </div>
                        <div style={{ width: "100%", height: 6, background: "hsl(var(--secondary))", borderRadius: 999 }}>
                          <div style={{ width: `${pred.confidence}%`, height: "100%", background: "hsl(var(--primary))", borderRadius: 999 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Object Detection Results */}
                {taskType === "object_detection" && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                          <th style={{ padding: "8px 12px", fontWeight: 700 }}>Label</th>
                          <th style={{ padding: "8px 12px", fontWeight: 700 }}>Box Coords [x1, y1, x2, y2]</th>
                          <th style={{ padding: "8px 12px", fontWeight: 700 }}>Confidence</th>
                          <th style={{ padding: "8px 12px", fontWeight: 700 }}>xAI Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDetections.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ padding: "16px 12px", textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
                              No predictions match or exceed confidence threshold.
                            </td>
                          </tr>
                        ) : (
                          filteredDetections.map((det: any, idx: number) => {
                            const isHovered = hoveredIndex === idx;
                            return (
                              <tr
                                key={idx}
                                style={{
                                  borderBottom: "1px solid hsl(var(--border))",
                                  background: isHovered ? "hsl(var(--secondary) / 0.5)" : "transparent",
                                  transition: "background 0.15s"
                                }}
                                onMouseEnter={() => setHoveredIndex(idx)}
                                onMouseLeave={() => setHoveredIndex(null)}
                              >
                                <td style={{ padding: "10px 12px", fontWeight: 600, color: "hsl(var(--foreground))" }}>
                                  {det.class_name}
                                </td>
                                <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                                  {JSON.stringify(det.box)}
                                </td>
                                <td style={{ padding: "10px 12px", fontWeight: 700, color: "hsl(var(--primary))" }}>
                                  {Math.round(det.confidence > 1 ? det.confidence : det.confidence * 100)}%
                                </td>
                                <td style={{ padding: "10px 12px" }}>
                                  {explainMethod !== "none" ? (
                                    <button
                                      onClick={() => setSelectedBoxIndex(idx)}
                                      style={{
                                        background: selectedBoxIndex === idx ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                                        color: selectedBoxIndex === idx ? "#fff" : "hsl(var(--foreground))",
                                        border: "1px solid hsl(var(--border))",
                                        borderRadius: 4,
                                        padding: "4px 8px",
                                        fontSize: 10,
                                        fontWeight: 600,
                                        cursor: "pointer"
                                      }}
                                    >
                                      {selectedBoxIndex === idx ? "Explaining Box" : "Explain Box"}
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>Enable XAI dropdown</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                
                {/* Fallback print */}
                {taskType !== "image_classification" && taskType !== "object_detection" && (
                  <pre style={{ margin: 0, padding: 12, background: "hsl(var(--secondary))", borderRadius: 4, fontFamily: "monospace", fontSize: 11 }}>
                    {JSON.stringify(predictionResults, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
