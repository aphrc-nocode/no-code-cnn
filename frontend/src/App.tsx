import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Sun, Moon, Info, LayoutDashboard, HelpCircle } from "lucide-react";
import { useTheme } from "./components/ThemeContext";
import Dashboard from "./components/Dashboard";
import ProjectWorkspace from "./components/ProjectWorkspace";

function About() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-foreground bg-background">
      <div className="text-center mb-12">
        <h1 className="text-3xl sm:text-5xl font-black mb-4">About MakLens</h1>
        <p className="text-base text-muted-foreground">Uganda's Leading No-Code Computer Vision Solution</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <h3 className="text-lg font-bold text-primary">Our Mission</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            MakLens was developed by the <strong>Mak-AI Research Centre</strong> (AI for Societal Good) at Makerere University. It lowers the barrier of entry for deploying computer vision solutions across diverse sectors, including defect detection, smart agriculture, urban planning, and medical imaging.
          </p>

          <h3 className="text-lg font-bold text-primary">Integrated Technologies</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li><strong>Neural Engines:</strong> PyTorch, TorchVision, and Hugging Face Transformers for state-of-the-art inference.</li>
            <li><strong>Active Storage:</strong> MinIO Object Storage for securely indexing datasets, annotations, and model binaries.</li>
            <li><strong>Experiment Tracking:</strong> MLflow Server for logging metrics, hyperparameter configs, and artifacts.</li>
            <li><strong>Visual Interface:</strong> Drag-and-drop workflow builder using native HTML canvas and javascript nodes.</li>
          </ul>
        </div>

        <div className="bg-card border border-border p-6 rounded-xl shadow-sm space-y-4">
          <h4 className="font-bold text-sm text-foreground">Responsible AI Built-In</h4>
          <p className="text-xs leading-relaxed text-muted-foreground">
            MakLens includes visual explanation modules (Grad-CAM) to explain model predictions, class balance checkers to highlight dataset bias, and fairness reports to prevent algorithmic discrimination before models are built.
          </p>
          <div className="flex items-center gap-3 pt-4 border-t border-border/50">
            <img
              src="https://air.ug/wp-content/uploads/2025/06/Mak-AI-06.png"
              alt="Mak-AI Logo"
              className="h-10 object-contain"
            />
            <div className="text-[10px] leading-tight text-muted-foreground font-semibold">
              MAK-AI Research Centre<br />
              <span className="text-foreground">AI for Societal Good</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-200">
      {/* App Header */}
      <header className="h-16 px-4 shrink-0 border-b border-border bg-card flex justify-between items-center z-30">
        {/* Left header */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <img
            src="https://air.ug/wp-content/uploads/2025/06/Mak-AI-06.png"
            alt="MakLens Logo"
            className="h-8 object-contain"
          />
          <span className="font-black tracking-tight text-base sm:text-lg">MakLens</span>
        </div>

        {/* Center navigation links */}
        <nav className="flex items-center gap-4 text-xs sm:text-sm font-semibold">
          <button
            onClick={() => navigate("/")}
            className={`flex items-center gap-1.5 py-1 px-3 rounded-lg transition-all ${
              location.pathname === "/"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <HelpCircle size={15} /> Overview
          </button>
          <button
            onClick={() => navigate("/projects")}
            className={`flex items-center gap-1.5 py-1 px-3 rounded-lg transition-all ${
              location.pathname.startsWith("/projects")
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutDashboard size={15} /> Dashboard
          </button>
          <button
            onClick={() => navigate("/about")}
            className={`flex items-center gap-1.5 py-1 px-3 rounded-lg transition-all ${
              location.pathname === "/about"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Info size={15} /> About
          </button>
        </nav>

        {/* Right header actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border shadow-sm flex items-center justify-center transition-colors"
            title="Toggle theme"
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      {/* Page Content Viewport */}
      <div className="flex-1 w-full relative overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Dashboard />} />
          <Route path="/about" element={<About />} />
          <Route path="/projects/:id/*" element={<ProjectWorkspace />} />
        </Routes>
      </div>
    </div>
  );
}
