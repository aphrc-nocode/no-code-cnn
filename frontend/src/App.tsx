import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { Sun, Moon, ExternalLink, LogOut, User, X, Pencil } from "lucide-react";
import { useTheme } from "./components/ThemeContext";
import { useAuth } from "./features/auth/AuthContext";
import { useState, useEffect } from "react";
import api from "./api";
import Dashboard from "./features/dashboard/Dashboard";
import ProjectWorkspace from "./components/ProjectWorkspace";
import Login from "./features/auth/Login";
import Register from "./features/auth/Register";
import PendingApproval from "./features/auth/PendingApproval";
import AdminDashboard from "./features/dashboard/AdminDashboard";
import UserProfileDropdown from "./components/UserProfileDropdown";
import dswbLogo  from "./assets/dswb-logo.PNG";

// ── Partner organisations shown on /about ────────────────────────────────────
const PARTNERS = [
  {
    name: "Mak-AI Research Centre",
    tagline: "AI for Societal Good",
    description:
      "Based at Makerere University, Mak-AI drives responsible AI research and innovation. Mak-AI collaborates on DeepLens to democratise computer vision for industry, agriculture, healthcare and urban planning across the continent.",
    logo: "https://air.ug/wp-content/uploads/2025/06/Mak-AI-06.png",
    url: "https://air.ug/",
    logoHeight: 48,
  },
  {
    name: "Data Science Without Borders",
    tagline: "Bridging the data divide across Africa",
    description:
      "DSWB is a continent-wide initiative that builds data science capacity, promotes open data, and enables African researchers and institutions to harness the power of data for development. DeepLens benefits from DSWB's infrastructure and collaborative network.",
    logo: dswbLogo,
    url: "https://dswb.africa/",
    logoHeight: 44,
  },
  {
    name: "African Population and Health Research Center",
    tagline: "Evidence for Change",
    description:
      "APHRC is a leading pan-African research institution generating evidence on population, health, education, and development. DeepLens is a flagship platform designed to ensure computer vision applications incorporate responsible data governance and health equity principles.",
    logo: "",
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
          About <span style={{ color: "hsl(var(--primary))" }}>DeepLens</span>
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
          DeepLens lowers the barrier to deploying computer vision solutions — enabling researchers,
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
  const { user, loading, logout, refreshUser } = useAuth();

  // Profile Editor Modal states
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileConfirmPassword, setProfileConfirmPassword] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Initialize fields when modal opens
  useEffect(() => {
    if (profileOpen && user) {
      setProfileUsername(user.username);
      setProfileEmail(user.email);
      setProfilePassword("");
      setProfileConfirmPassword("");
      setProfileError(null);
      setProfileSuccess(false);
      setIsEditingProfile(false);
    }
  }, [profileOpen, user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setProfileSuccess(false);

    if (profilePassword && profilePassword !== profileConfirmPassword) {
      setProfileError("Passwords do not match");
      return;
    }

    setProfileSaving(true);
    try {
      await api.put("auth/profile", {
        username: profileUsername,
        email: profileEmail,
        password: profilePassword || undefined
      });
      await refreshUser();
      setProfileSuccess(true);
      setProfilePassword("");
      setProfileConfirmPassword("");
    } catch (err: any) {
      setProfileError(err.response?.data?.detail || "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(var(--background))" }}>
        <p style={{ color: "hsl(var(--muted-foreground))" }}>Loading...</p>
      </div>
    );
  }

  // Auth Guards
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/register";
  if (!user) {
    if (isAuthRoute) {
      return (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      );
    }
    return <Navigate to="/login" replace />;
  }

  // If user is pending or rejected, show PendingApproval page
  if (user.status !== "approved") {
    return (
      <Routes>
        <Route path="/pending" element={<PendingApproval />} />
        <Route path="*" element={<Navigate to="/pending" replace />} />
      </Routes>
    );
  }

  // Nav links — no "Overview", just Dashboard + About
  // Clicking the logo returns to home (/)
  const NAV = [
    { path: "/projects", label: "Dashboard", match: (p: string) => p.startsWith("/projects") || p === "/" },
    { path: "/about",    label: "About",     match: (p: string) => p === "/about" },
  ];

  if (user.role === "admin") {
    NAV.push({ path: "/admin", label: "Admin", match: (p: string) => p.startsWith("/admin") });
  }

  // Only show header when NOT inside the workspace annotator (full-screen annotator has its own bar)
  const isAnnotating = /\/projects\/[a-zA-Z0-9-]+\/annotate\/[^\s/]+/.test(location.pathname);
  const isWorkspace = /^\/projects\/[a-zA-Z0-9-]+/.test(location.pathname) && !isAnnotating;

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
          /* Three columns so nav is truly centred */
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 20px",
        }}>

          {/* Left column: wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span onClick={() => navigate("/")}
              style={{ fontWeight: 900, letterSpacing: "-0.04em", cursor: "pointer",
                fontSize: "clamp(15px, 3vw, 18px)", lineHeight: 1, userSelect: "none" }}>
              <span style={{ color: "hsl(var(--primary))" }}>DeepLens</span>
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

          {/* Right column: profile badge dropdown */}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
            {!isWorkspace && user && (
              <UserProfileDropdown
                user={user}
                onLogout={logout}
                onUpdateUser={(updatedUser) => setUser(updatedUser)}
              />
            )}
          </div>
        </header>
      )}

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, width: "100%", overflow: "auto",
        /* Push down if header is visible */
        display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/"               element={<Navigate to="/projects" replace />} />
          <Route path="/projects"       element={<Dashboard />} />
          <Route path="/about"          element={<About />} />
          <Route path="/projects/:id/*" element={<ProjectWorkspace />} />
          <Route path="/admin"          element={user.role === "admin" ? <AdminDashboard /> : <Navigate to="/projects" replace />} />
          <Route path="*"               element={<Navigate to="/projects" replace />} />
        </Routes>
      </div>
    </div>
  );
}
