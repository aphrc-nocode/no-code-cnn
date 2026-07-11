import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { GitBranch, Edit3, Database, Cpu, Activity, ChevronLeft, Menu, X } from "lucide-react";
import api, { type Project } from "../api";

import WorkflowBuilder from "./WorkflowBuilder";
import Annotator from "./Annotator";
import ImageGallery from "./ImageGallery";
import DatasetManager from "./DatasetManager";
import ModelGarden from "./ModelGarden";
import TrainingJobs from "./TrainingJobs";

type TabType = "workflow" | "annotate" | "datasets" | "models" | "jobs";

const TABS: { id: TabType; label: string; Icon: any }[] = [
  { id: "workflow",  label: "Visual Pipeline",  Icon: GitBranch },
  { id: "annotate",  label: "Annotate",         Icon: Edit3 },
  { id: "datasets",  label: "Datasets",         Icon: Database },
  { id: "models",    label: "Model Garden",     Icon: Cpu },
  { id: "jobs",      label: "Training Jobs",    Icon: Activity },
];

const TASK_BADGE: Record<string, { color: string; bg: string }> = {
  detection:            { color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
  image_segmentation:   { color: "#22c55e", bg: "rgba(34,197,94,0.12)"  },
  segmentation:         { color: "#22c55e", bg: "rgba(34,197,94,0.12)"  },
  image_classification: { color: "#06b6d4", bg: "rgba(6,182,212,0.12)"  },
  classification:       { color: "#06b6d4", bg: "rgba(6,182,212,0.12)"  },
};

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("workflow");
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        .catch(() => setProject({ id: Number(id) || 1, name: "Project", task_type: "classification", classes: [] }));
    }
  }, [id]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    navigate(`/projects/${id}/${tab}`);
  };

  const renderActiveView = () => {
    const path = location.pathname;
    if (activeTab === "annotate") {
      const hasImageId = /\/annotate\/\d+/.test(path);
      return hasImageId ? <Annotator /> : <ImageGallery />;
    }
    switch (activeTab) {
      case "workflow":  return <WorkflowBuilder />;
      case "datasets":  return <DatasetManager />;
      case "models":    return <ModelGarden />;
      case "jobs":      return <TrainingJobs />;
      default:          return <WorkflowBuilder />;
    }
  };

  const taskStyle = TASK_BADGE[project?.task_type ?? ""] ?? { color: "#64748b", bg: "rgba(100,116,139,0.1)" };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', width: '100%',
      overflow: 'hidden', position: 'relative' }}>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 30 }}
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className="workspace-aside" style={{
        width: 240, flexShrink: 0, background: 'hsl(var(--card))', display: 'flex',
        flexDirection: 'column', borderRight: '1px solid hsl(var(--border))',
        transition: 'transform 0.25s ease', zIndex: 40,
      }}>
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid hsl(var(--border))' }}>
          <button onClick={() => navigate("/projects")}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
              fontWeight: 600, color: 'hsl(var(--muted-foreground))', background: 'none',
              border: 'none', cursor: 'pointer', marginBottom: 14, padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = 'hsl(var(--foreground))')}
            onMouseLeave={e => (e.currentTarget.style.color = 'hsl(var(--muted-foreground))')}>
            <ChevronLeft size={14} /> Back to Projects
          </button>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'hsl(var(--foreground))',
              margin: '0 0 5px', letterSpacing: '-0.01em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project?.name || "Loading..."}
            </h2>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
              padding: '2px 7px', borderRadius: 4, letterSpacing: '0.06em',
              background: taskStyle.bg, color: taskStyle.color, display: 'inline-block' }}>
              {project?.task_type?.replace(/_/g, " ") || ""}
            </span>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '12px 10px', display: 'flex',
          flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {TABS.map(({ id: tab, label, Icon }) => {
            const active = activeTab === tab;
            return (
              <button key={tab} onClick={() => handleTabChange(tab)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', border: 'none', borderRadius: 6,
                  background: active ? 'hsl(var(--primary))' : 'transparent',
                  color: active ? '#fff' : 'hsl(var(--muted-foreground))',
                  fontSize: 13, fontWeight: active ? 600 : 500, textAlign: 'left',
                  cursor: 'pointer', transition: 'all 0.12s ease' }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'hsl(var(--secondary))'; e.currentTarget.style.color = 'hsl(var(--foreground))'; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--muted-foreground))'; }}}>
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile hamburger */}
      <button onClick={() => setSidebarOpen(!sidebarOpen)}
        className="mobile-sidebar-btn"
        style={{ display: 'none', position: 'absolute', top: 8, left: 8, zIndex: 50,
          background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
          borderRadius: 6, padding: '6px', cursor: 'pointer',
          color: 'hsl(var(--foreground))', alignItems: 'center', justifyContent: 'center' }}>
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </button>

      {/* Main content */}
      <main style={{ flex: 1, height: '100%', overflow: 'hidden',
        background: 'hsl(var(--background))', minWidth: 0 }}>
        {renderActiveView()}
      </main>

      <style>{`
        @media (max-width: 767px) {
          .mobile-sidebar-btn { display: flex !important; }
          .workspace-aside {
            position: fixed !important;
            top: 0; left: 0; bottom: 0;
            transform: ${sidebarOpen ? 'translateX(0)' : 'translateX(-100%)'};
          }
        }
      `}</style>
    </div>
  );
}
