import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Sun, Moon, Info, LayoutDashboard, HelpCircle, ExternalLink } from "lucide-react";
import { useTheme } from "./components/ThemeContext";
import Dashboard from "./components/Dashboard";
import ProjectWorkspace from "./components/ProjectWorkspace";
import dswbLogo  from "./assets/dswb-logo.PNG";
import aphrcLogo from "./assets/aphrc-logo.png";

const PARTNERS = [
  {
    name: "Mak-AI Research Centre",
    tagline: "AI for Societal Good",
    description: "Based at Makerere University, Mak-AI drives responsible AI research and innovation for Uganda and the African continent. MakLens is a flagship product of Mak-AI, designed to democratise computer vision for industry, agriculture, healthcare and urban planning.",
    logo: "https://air.ug/wp-content/uploads/2025/06/Mak-AI-06.png",
    url: "https://air.ug/",
    logoHeight: 48,
  },
  {
    name: "Data Science Without Borders",
    tagline: "Bridging the data divide across Africa",
    description: "DSWB is a continent-wide initiative that builds data science capacity, promotes open data, and enables African researchers and institutions to harness the power of data for development. MakLens benefits from DSWB's infrastructure and collaborative network.",
    logo: dswbLogo,
    url: "https://dswb.africa/",
    logoHeight: 44,
  },
  {
    name: "African Population and Health Research Center",
    tagline: "APHRC — Evidence for Change",
    description: "APHRC is a leading pan-African research institution generating evidence on population, health, education, and development. APHRC partners with Mak-AI to ensure MakLens incorporates responsible data governance and health equity principles.",
    logo: aphrcLogo,
    url: "https://aphrc.org/",
    logoHeight: 52,
  },
];

function About() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 16px 80px",
      color: "hsl(var(--foreground))" }}>

      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: "clamp(24px, 5vw, 38px)", fontWeight: 800,
          letterSpacing: "-0.03em", margin: "0 0 10px" }}>
          About <span style={{ color: "hsl(var(--primary))" }}>MakLens</span>
        </h1>
        <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))",
          maxWidth: 520, margin: "0 auto", lineHeight: 1.65 }}>
          A no-code computer vision platform built by African researchers, for African impact.
        </p>
      </div>

      {/* Mission */}
      <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
        borderLeft: "4px solid hsl(var(--primary))", borderRadius: 10,
        padding: "22px 26px", marginBottom: 40 }}>
        <h2 style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--primary))",
          margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Our Mission
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.75,
          color: "hsl(var(--muted-foreground))", margin: 0 }}>
          MakLens lowers the barrier to deploying computer vision solutions — enabling researchers,
          field workers and organisations to build, train, and deploy custom vision models without
          writing a single line of code. From image labelling to model evaluation, every step is
          visual and accessible.
        </p>
      </div>

      {/* Partner organisations */}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 20px",
        letterSpacing: "-0.02em" }}>Partner Organisations</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {PARTNERS.map((p) => (
          <div key={p.name}
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
              borderRadius: 10, padding: "20px 22px", display: "flex",
              gap: 20, alignItems: "flex-start", transition: "box-shadow 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)")}>

            {/* Logo box */}
            <div style={{ flexShrink: 0, width: 96, height: 72, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: "#fff", borderRadius: 8, padding: 10,
              border: "1px solid hsl(var(--border))" }}>
              <img src={p.logo} alt={p.name}
                style={{ height: p.logoHeight, width: "auto",
                  objectFit: "contain", display: "block" }} />
            </div>

            {/* Text info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 2px",
                color: "hsl(var(--foreground))" }}>{p.name}</h3>
              <p style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--primary))",
                textTransform: "uppercase", letterSpacing: "0.07em",
                margin: "0 0 8px" }}>{p.tagline}</p>
              <p style={{ fontSize: 13, lineHeight: 1.7,
                color: "hsl(var(--muted-foreground))", margin: "0 0 12px" }}>
                {p.description}
              </p>
              <a href={p.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 12, fontWeight: 600, color: "hsl(var(--primary))",
                  textDecoration: "none", padding: "4px 11px",
                  border: "1px solid hsl(var(--primary) / 0.35)",
                  borderRadius: 5, transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--primary) / 0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                <ExternalLink size={11} /> Visit Website
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Tech stack */}
      <div style={{ marginTop: 48, background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))", borderRadius: 10, padding: "24px 26px" }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 14px",
          color: "hsl(var(--foreground))" }}>Integrated Technologies</h2>
        <div style={{ display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {[
            { name: "PyTorch & TorchVision", desc: "Neural network training & inference" },
            { name: "Hugging Face", desc: "Pre-trained model hub & Transformers" },
            { name: "MinIO Object Storage", desc: "Scalable image & model storage" },
            { name: "MLflow", desc: "Experiment tracking & metrics" },
            { name: "SAM – Segment Anything", desc: "AI-assisted segmentation" },
            { name: "Grad-CAM", desc: "Visual model explainability" },
          ].map(t => (
            <div key={t.name} style={{ background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))", borderRadius: 7, padding: "11px 13px" }}>
              <div style={{ fontSize: 12, fontWeight: 700,
                color: "hsl(var(--foreground))", marginBottom: 2 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))",
                lineHeight: 1.5 }}>{t.desc}</div>
            </div>
          ))}
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
      {/* App Header — wordmark only, no logo image on header to keep mobile clean */}
      <header className="shrink-0 border-b border-border bg-card z-30"
        style={{ height: 52, display: "flex", justifyContent: "space-between",
          alignItems: "center", padding: "0 14px" }}>

        {/* Left: text wordmark */}
        <div style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
          onClick={() => navigate("/")}>
          <span style={{ fontWeight: 900, letterSpacing: "-0.04em",
            fontSize: "clamp(15px, 3vw, 18px)", lineHeight: 1 }}>
            Mak<span style={{ color: "hsl(var(--primary))" }}>Lens</span>
          </span>
        </div>

        {/* Center nav */}
        <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {[
            { path: "/",         label: "Overview",  Icon: HelpCircle,
              match: (p: string) => p === "/" },
            { path: "/projects", label: "Dashboard", Icon: LayoutDashboard,
              match: (p: string) => p.startsWith("/projects") },
            { path: "/about",    label: "About",     Icon: Info,
              match: (p: string) => p === "/about" },
          ].map(({ path, label, Icon, match }) => {
            const active = match(location.pathname);
            return (
              <button key={path} onClick={() => navigate(path)}
                style={{ display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 9px", borderRadius: 7, border: "none",
                  background: active ? "hsl(var(--primary) / 0.1)" : "transparent",
                  color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                  fontWeight: 600, fontSize: 12, cursor: "pointer",
                  transition: "all 0.12s", whiteSpace: "nowrap" }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = "hsl(var(--foreground))"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = "hsl(var(--muted-foreground))"; }}>
                <Icon size={14} />
                <span className="nav-label">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: theme toggle */}
        <button onClick={toggleTheme}
          style={{ padding: 7, borderRadius: 7,
            border: "1px solid hsl(var(--border))",
            background: "hsl(var(--secondary))",
            color: "hsl(var(--foreground))", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.15s" }}
          title="Toggle theme">
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </header>

      {/* Page content */}
      <div className="flex-1 w-full relative overflow-auto">
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/projects"       element={<Dashboard />} />
          <Route path="/about"          element={<About />} />
          <Route path="/projects/:id/*" element={<ProjectWorkspace />} />
        </Routes>
      </div>

      <style>{`
        /* Hide nav text labels below 420px — keep icons only */
        @media (max-width: 420px) {
          .nav-label { display: none; }
        }
      `}</style>
    </div>
  );
}
