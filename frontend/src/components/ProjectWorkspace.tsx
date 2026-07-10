import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { GitBranch, Edit3, Database, Cpu, Activity, ChevronLeft } from "lucide-react";
import api, { type Project } from "../api";

import WorkflowBuilder from "./WorkflowBuilder";
import Annotator from "./Annotator";
import DatasetManager from "./DatasetManager";
import ModelGarden from "./ModelGarden";
import TrainingJobs from "./TrainingJobs";

type TabType = "workflow" | "annotate" | "datasets" | "models" | "jobs";

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("workflow");

  // Determine active tab from URL path
  useEffect(() => {
    const path = location.pathname;
    if (path.includes("/annotate")) setActiveTab("annotate");
    else if (path.includes("/datasets")) setActiveTab("datasets");
    else if (path.includes("/models")) setActiveTab("models");
    else if (path.includes("/jobs")) setActiveTab("jobs");
    else setActiveTab("workflow");
  }, [location]);

  useEffect(() => {
    if (id) {
      api.get(`/projects/${id}`)
        .then((res) => setProject(res.data))
        .catch(() => {
          setProject({
            id: Number(id) || 1,
            name: "Project",
            task_type: "classification",
            classes: ["Class A", "Class B"]
          });
        });
    }
  }, [id]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    navigate(`/projects/${id}/${tab}`);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case "workflow":
        return <WorkflowBuilder />;
      case "annotate":
        return <Annotator />;
      case "datasets":
        return <DatasetManager />;
      case "models":
        return <ModelGarden />;
      case "jobs":
        return <TrainingJobs />;
      default:
        return <WorkflowBuilder />;
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar navigation */}
      <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border">
          <button
            onClick={() => navigate("/projects")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-semibold mb-3 transition-colors"
          >
            <ChevronLeft size={14} /> Back to Projects
          </button>
          <div className="flex flex-col">
            <h2 className="font-black text-sm text-foreground truncate">{project?.name || "Loading..."}</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider text-primary/80 mt-0.5">
              {project?.task_type.replace("_", " ") || ""}
            </span>
          </div>
        </div>

        {/* Sidebar Navigation Options */}
        <nav className="flex-1 p-2 space-y-1.5 overflow-y-auto">
          <button
            onClick={() => handleTabChange("workflow")}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "workflow"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <GitBranch size={16} /> Visual Pipeline
          </button>
          <button
            onClick={() => handleTabChange("annotate")}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "annotate"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Edit3 size={16} /> Annotate
          </button>
          <button
            onClick={() => handleTabChange("datasets")}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "datasets"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Database size={16} /> Datasets
          </button>
          <button
            onClick={() => handleTabChange("models")}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "models"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Cpu size={16} /> Model Garden
          </button>
          <button
            onClick={() => handleTabChange("jobs")}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === "jobs"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <Activity size={16} /> Training Jobs
          </button>
        </nav>
      </aside>

      {/* Main workspace content area */}
      <main className="flex-1 h-full overflow-hidden bg-background">
        {renderActiveView()}
      </main>
    </div>
  );
}
