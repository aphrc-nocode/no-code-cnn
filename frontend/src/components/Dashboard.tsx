import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Cpu, Database, MousePointer, BarChart3, Shield, Info, ArrowRight } from "lucide-react";
import api, { type Project } from "../api";

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isLanding, setIsLanding] = useState(true);

  // New Project Form State
  const [projectName, setProjectName] = useState("");
  const [projectTask, setProjectTask] = useState<"classification" | "detection" | "segmentation">("classification");
  const [classesInput, setClassesInput] = useState("");

  const fetchProjects = async () => {
    try {
      setError(null);
      const res = await api.get("/projects");
      if (res.data) {
        setProjects(res.data);
      }
    } catch (e: any) {
      setError("Failed to load projects from server.");
      // Set some mock data for development
      setProjects([
        { id: 1, name: "Defect Detection", task_type: "detection", classes: ["scratch", "crack", "dent"] },
        { id: 2, name: "Plant Classification", task_type: "classification", classes: ["healthy", "blight", "rust"] }
      ]);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;

    const classesArray = classesInput
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    try {
      const payload = {
        name: projectName.trim(),
        task_type: projectTask,
        classes: classesArray
      };
      const res = await api.post("/projects", payload);
      setShowCreateModal(false);
      setProjectName("");
      setClassesInput("");
      fetchProjects();
      navigate(`/projects/${res.data.id}/workflow`);
    } catch (err: any) {
      alert("Failed to create project");
    }
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLanding) {
    return (
      <div className="flex flex-col min-h-screen bg-background text-foreground">
        {/* Hero Section */}
        <section className="flex flex-col items-center justify-center text-center px-4 py-20 bg-gradient-to-b from-primary/5 to-transparent">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-none mb-6">
              Build Computer Vision <br />
              <span className="text-primary bg-clip-text">Models in Days</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              MakLens simplifies laborious data upload, manual image annotation, pipeline construction, and model evaluation. Develop custom models for your operations with less data, powered by active learning.
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setIsLanding(false)}
                className="bg-primary hover:bg-primary/90 text-white font-semibold px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm"
              >
                Launch Dashboard <ArrowRight size={16} />
              </button>
              <a
                href="#features"
                className="bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border font-semibold px-6 py-3 rounded-lg text-sm transition-all"
              >
                Learn More
              </a>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="max-w-6xl mx-auto px-4 py-16 w-full">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">
            Next-Generation Computer Vision Platform
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm hover:border-primary/50 transition-all">
              <span className="p-3 bg-blue-500/10 text-blue-500 rounded-lg inline-flex items-center justify-center mb-4">
                <Cpu size={24} />
              </span>
              <h3 className="font-bold text-lg mb-2">Interactive Training</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Get started with as few as 20 to 30 images, then let active learning help you teach the model as it learns.
              </p>
            </div>
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm hover:border-violet-500/50 transition-all">
              <span className="p-3 bg-violet-500/10 text-violet-500 rounded-lg inline-flex items-center justify-center mb-4">
                <Database size={24} />
              </span>
              <h3 className="font-bold text-lg mb-2">Multiple CV Tasks</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Train state-of-the-art neural networks for classification, object detection, and semantic segmentation.
              </p>
            </div>
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm hover:border-emerald-500/50 transition-all">
              <span className="p-3 bg-emerald-500/10 text-emerald-500 rounded-lg inline-flex items-center justify-center mb-4">
                <MousePointer size={24} />
              </span>
              <h3 className="font-bold text-lg mb-2">Smart Annotations</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Expedite data labeling with drawing assistants, bounding boxes, polygons, and Segment Anything Model (SAM).
              </p>
            </div>
            <div className="bg-card border border-border p-6 rounded-xl shadow-sm hover:border-amber-500/50 transition-all">
              <span className="p-3 bg-amber-500/10 text-amber-500 rounded-lg inline-flex items-center justify-center mb-4">
                <BarChart3 size={24} />
              </span>
              <h3 className="font-bold text-lg mb-2">Model Evaluation</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Assess performance in real time with metrics, confusion matrices, and explainability maps (Grad-CAM).
              </p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 w-full bg-background text-foreground">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black leading-none">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">Each project trains one computer vision model</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-primary hover:bg-primary/95 text-white font-semibold px-4 py-2 rounded-lg text-sm shadow flex items-center gap-1.5"
        >
          <Plus size={16} /> New Project
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-8 max-w-md relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search projects by name..."
          className="w-full bg-card border border-border text-foreground pl-10 pr-4 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
        />
        <Search size={16} className="absolute left-3 top-3.5 text-muted-foreground" />
      </div>

      {error && <div className="text-xs text-destructive mb-4">{error}</div>}

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-16 text-center text-muted-foreground">
          <p className="font-bold text-foreground text-base mb-1">No projects yet</p>
          <p className="text-xs">Create your first project to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}/workflow`)}
              className="bg-card border border-border hover:border-primary/50 p-5 rounded-xl cursor-pointer hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {p.task_type.replace("_", " ")}
                  </span>
                </div>
                <h3 className="font-bold text-base text-foreground mb-1 hover:text-primary transition-colors">
                  {p.name}
                </h3>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  Classes: {p.classes ? p.classes.join(", ") : "None defined"}
                </p>
              </div>
              <div className="mt-4 pt-4 border-t border-border/50 flex justify-between items-center text-[10px] text-muted-foreground">
                <span>ID: {p.id}</span>
                <span className="text-primary font-semibold flex items-center gap-0.5">
                  Open Workspace <ArrowRight size={10} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl scale-in">
            <h3 className="font-black text-lg text-foreground mb-4">Create New Project</h3>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., Apple Defects Detection"
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Task Type</label>
                <select
                  value={projectTask}
                  onChange={(e: any) => setProjectTask(e.target.value)}
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-sm"
                >
                  <option value="classification">Image Classification</option>
                  <option value="detection">Object Detection</option>
                  <option value="segmentation">Image Segmentation</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Classes (comma separated)</label>
                <input
                  type="text"
                  value={classesInput}
                  onChange={(e) => setClassesInput(e.target.value)}
                  placeholder="e.g., healthy, rot, spot"
                  className="w-full bg-background border border-border text-foreground px-3 py-2 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-xs hover:bg-primary/95 transition-all shadow"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
