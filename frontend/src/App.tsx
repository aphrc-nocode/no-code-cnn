import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Sun, Moon, ExternalLink } from "lucide-react";
import { useTheme } from "./components/ThemeContext";
import Dashboard from "./components/Dashboard";
import ProjectWorkspace from "./components/ProjectWorkspace";
import dswbLogo  from "./assets/dswb-logo.PNG";
import aphrcLogo from "./assets/aphrc-logo.png";

// ── Partner organisations shown on /about ────────────────────────────────────
const PARTNERS = [
  {
    name: "Mak-AI Research Centre",
    tagline: "AI for Societal Good",
    description:
      "Based at Makerere University, Mak-AI drives responsible AI research and innovation for Uganda and the African continent. MakLens is a flagship product of Mak-AI, designed to democratise computer vision for industry, agriculture, healthcare and urban planning.",
    logo: "https://air.ug/wp-content/uploads/2025/06/Mak-AI-06.png",
    url: "https://air.ug/",
    logoHeight: 48,
  },
  {
    name: "Data Science Without Borders",
    tagline: "Bridging the data divide across Africa",
    description:
      "DSWB is a continent-wide initiative that builds data science capacity, promotes open data, and enables African researchers and institutions to harness the power of data for development. MakLens benefits from DSWB's infrastructure and collaborative network.",
    logo: dswbLogo,
    url: "https://dswb.africa/",
    logoHeight: 44,
  },
  {
    name: "African Population and Health Research Center",
    tagline: "APHRC — Evidence for Change",
    description:
      "APHRC is a leading pan-African research institution generating evidence on population, health, education, and development. APHRC partners with Mak-AI to ensure MakLens incorporates responsible data governance and health equity principles.",
    logo: aphrcLogo,
    url: "https://aphrc.org/",
    logoHeight: 52,
  },
];

// ── About page ───────────────────────────────────────────────────────────────
function About() {
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 80px",
      color: "hsl(var(--foreground))" }}>

      {/* Hero */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h1 style={{ fontSize: "clamp(26px, 5vw, 40px)", fontWeight: 800,
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
        borderRadius: 10,
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

      {/* Partners */}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "0 0 20px",
        letterSpacing: "-0.02em" }}>Partner Organisations</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {PARTNERS.map((p) => (
          <div key={p.name}
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
              borderRadius: 10, padding: "20px 22px",
              display: "flex", gap: 20, alignItems: "flex-start",
              transition: "box-shadow 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 14px rgba(0,0,0,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)")}>

            {/* Logo */}
            <div style={{ flexShrink: 0, width: 96, height: 72, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: "#fff", borderRadius: 8, padding: 10,
              border: "1px solid hsl(var(--border))" }}>
              <img src={p.logo} alt={p.name}
                style={{ height: p.logoHeight, width: "auto",
                  objectFit: "contain", display: "block" }} />
            </div>

            {/* Text */}
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
                  borderRadius: 5, transition: "all 0.15s", background: "transparent" }}
                onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--primary) / 0.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                <ExternalLink size={11} /> Visit Website
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Nav links — no "Overview", just Dashboard + About
  // Clicking the logo returns to home (/)
  const NAV = [
    { path: "/projects", label: "Dashboard", match: (p: string) => p.startsWith("/projects") || p === "/" },
    { path: "/about",    label: "About",     match: (p: string) => p === "/about" },
  ];

  // Only show header when NOT inside the workspace annotator (full-screen annotator has its own bar)
  const isAnnotating = /\/projects\/\d+\/annotate\/\d+/.test(location.pathname);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column",
      background: "hsl(var(--background))", color: "hsl(var(--foreground))",
      fontFamily: "inherit", transition: "background 0.2s, color 0.2s" }}>

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      {!isAnnotating && (
        <header style={{
          position: "sticky", top: 0, zIndex: 100,
          height: 54, background: "hsl(var(--card))",
          borderBottom: "1px solid hsl(var(--border))",
          display: "grid",
          /* Three equal columns so nav is truly centred */
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 20px",
        }}>

          {/* Left column: wordmark */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <span onClick={() => navigate("/")}
              style={{ fontWeight: 900, letterSpacing: "-0.04em", cursor: "pointer",
                fontSize: "clamp(15px, 3vw, 18px)", lineHeight: 1, userSelect: "none" }}>
              Mak<span style={{ color: "hsl(var(--primary))" }}>Lens</span>
            </span>
          </div>

          {/* Centre column: navigation links — text only, no icons */}
          <nav style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {NAV.map(({ path, label, match }) => {
              const active = match(location.pathname);
              return (
                <button key={path} onClick={() => navigate(path)}
                  style={{ padding: "6px 14px", borderRadius: 7, border: "none",
                    background: active ? "hsl(var(--primary))" : "transparent",
                    color: active ? "#fff" : "hsl(var(--muted-foreground))",
                    fontWeight: 600, fontSize: 13, cursor: "pointer",
                    transition: "all 0.15s", letterSpacing: "0.01em",
                    whiteSpace: "nowrap" }}
                  onMouseEnter={e => { if (!active) {
                    e.currentTarget.style.background = "hsl(var(--secondary))";
                    e.currentTarget.style.color = "hsl(var(--foreground))";
                  }}}
                  onMouseLeave={e => { if (!active) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                  }}}>
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Right column: theme toggle — push to far right */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={toggleTheme}
              style={{ padding: "7px 8px", borderRadius: 7,
                border: "1px solid hsl(var(--border))",
                background: "hsl(var(--secondary))",
                color: "hsl(var(--foreground))", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s" }}
              title="Toggle theme">
              {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
            </button>
          </div>
        </header>
      )}

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, width: "100%", overflow: "auto",
        /* Push down if header is visible */
        display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/"               element={<Dashboard />} />
          <Route path="/projects"       element={<Dashboard />} />
          <Route path="/about"          element={<About />} />
          <Route path="/projects/:id/*" element={<ProjectWorkspace />} />
        </Routes>
      </div>
    </div>
  );
}
