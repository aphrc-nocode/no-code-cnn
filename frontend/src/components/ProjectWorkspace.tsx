import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { GitBranch, Edit3, Database, Cpu, Activity, ChevronLeft, Menu, X, Sun, Moon, User, LogOut, Pencil } from "lucide-react";
import api, { type Project } from "../api";
import { useTheme } from "./ThemeContext";
import { useAuth } from "./AuthContext";

import WorkflowBuilder from "./WorkflowBuilder";
import Annotator from "./Annotator";
import ImageGallery from "./ImageGallery";
import DatasetManager from "./DatasetManager";
import ModelGarden from "./ModelGarden";
import TrainingJobs from "./TrainingJobs";

type TabType = "workflow" | "annotate" | "datasets" | "models" | "jobs";

const TABS: { id: TabType; label: string; Icon: any }[] = [
  { id: "workflow",  label: "Visual Pipeline", Icon: GitBranch },
  { id: "annotate",  label: "Annotate",        Icon: Edit3 },
  { id: "datasets",  label: "Datasets",         Icon: Database },
  { id: "models",    label: "Model Garden",     Icon: Cpu },
  { id: "jobs",      label: "Training Jobs",   Icon: Activity },
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
  const { theme, toggleTheme } = useTheme();

  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("workflow");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const { user, logout, refreshUser } = useAuth();
  
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

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const collapsed = isCollapsed && !isMobile;

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
    <>
      {/* Mobile: sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            zIndex: 200, backdropFilter: "blur(1px)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div style={{ display: "flex", height: "calc(100vh - 54px)",
        width: "100%", overflow: "hidden", position: "relative" }}>

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        {/*
          Desktop: renders normally in flow (flex child, 240px wide).
          Mobile:  hidden off-screen via CSS class; slides in as a fixed overlay.
        */}
        <aside className={`ws-sidebar ${sidebarOpen ? "ws-sidebar--open" : ""}`}
          style={{
            width: collapsed ? 64 : 240,
            flexShrink: 0,
            background: "hsl(var(--card))",
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid hsl(var(--border))",
            transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            overflow: "hidden"
          }}>

          <div style={{
            padding: collapsed ? "16px 8px" : "20px 20px 16px",
            borderBottom: "1px solid hsl(var(--border))",
            display: "flex",
            flexDirection: "column",
            alignItems: collapsed ? "center" : "stretch",
            gap: 12,
            transition: "all 0.2s"
          }}>
            {!collapsed ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <button onClick={() => navigate("/projects")}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12,
                    fontWeight: 600, color: "hsl(var(--muted-foreground))", background: "none",
                    border: "none", cursor: "pointer", padding: 0 }}
                  onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--foreground))")}
                  onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--muted-foreground))")}>
                  <ChevronLeft size={14} /> Projects
                </button>
                {!isMobile && (
                  <button onClick={() => setIsCollapsed(true)}
                    title="Collapse Sidebar"
                    style={{
                      background: "none",
                      border: "none",
                      color: "hsl(var(--muted-foreground))",
                      cursor: "pointer",
                      display: "flex",
                      padding: 4,
                      borderRadius: 4,
                      transition: "background 0.15s"
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--secondary))")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}>
                    <ChevronLeft size={16} />
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", width: "100%" }}>
                <button onClick={() => navigate("/projects")}
                  title="Back to Projects"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36,
                    borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--secondary) / 0.3)",
                    color: "hsl(var(--muted-foreground))", cursor: "pointer", padding: 0 }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = "hsl(var(--foreground))";
                    e.currentTarget.style.background = "hsl(var(--secondary))";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                    e.currentTarget.style.background = "hsl(var(--secondary) / 0.3)";
                  }}>
                  <ChevronLeft size={16} />
                </button>
                {!isMobile && (
                  <button onClick={() => setIsCollapsed(false)}
                    title="Expand Sidebar"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36,
                      borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--secondary) / 0.3)",
                      color: "hsl(var(--muted-foreground))", cursor: "pointer", padding: 0 }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = "hsl(var(--foreground))";
                      e.currentTarget.style.background = "hsl(var(--secondary))";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                      e.currentTarget.style.background = "hsl(var(--secondary) / 0.3)";
                    }}>
                    <Menu size={16} />
                  </button>
                )}
              </div>
            )}

            {!collapsed ? (
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700,
                  color: "hsl(var(--foreground))", margin: "0 0 5px",
                  letterSpacing: "-0.01em", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis" }}>
                  {project?.name || "Loading..."}
                </h2>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                  padding: "2px 7px", borderRadius: 4, letterSpacing: "0.06em",
                  background: taskStyle.bg, color: taskStyle.color, display: "inline-block" }}>
                  {project?.task_type?.replace(/_/g, " ") || ""}
                </span>
              </div>
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: taskStyle.bg, color: taskStyle.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, textTransform: "uppercase",
                cursor: "pointer"
              }} title={`${project?.name || "Project"} (${project?.task_type?.replace(/_/g, " ") || ""})`}
              onClick={() => setIsCollapsed(false)}>
                {(project?.name || "P").charAt(0)}
              </div>
            )}
          </div>

          <nav style={{ flex: 1, padding: collapsed ? "12px 6px" : "12px 10px",
            display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", transition: "padding 0.2s" }}>
            {TABS.map(({ id: tab, label, Icon }) => {
              const active = activeTab === tab;
              return (
                <button key={tab} onClick={() => handleTabChange(tab)}
                  title={collapsed ? label : undefined}
                  style={{ width: "100%", display: "flex", alignItems: "center",
                    justifyContent: collapsed ? "center" : "flex-start",
                    gap: collapsed ? 0 : 10, padding: collapsed ? "10px 0" : "10px 14px", border: "none", borderRadius: 6,
                    background: active ? "hsl(var(--primary))" : "transparent",
                    color: active ? "#fff" : "hsl(var(--muted-foreground))",
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    textAlign: collapsed ? "center" : "left", cursor: "pointer", transition: "all 0.12s" }}
                  onMouseEnter={e => { if (!active) {
                    e.currentTarget.style.background = "hsl(var(--secondary))";
                    e.currentTarget.style.color = "hsl(var(--foreground))";
                  }}}
                  onMouseLeave={e => { if (!active) {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                  }}}>
                  <Icon size={15} style={{ flexShrink: 0 }} />
                  {!collapsed && <span>{label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Settings Section */}
          <div style={{
            padding: collapsed ? "12px 8px" : "16px 20px",
            borderTop: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
            display: "flex",
            flexDirection: "column",
            alignItems: collapsed ? "center" : "stretch",
            gap: collapsed ? 0 : 10,
            transition: "all 0.2s"
          }}>
            {!collapsed && (
              <p style={{
                fontSize: 10,
                fontWeight: 700,
                color: "hsl(var(--muted-foreground))",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "0 0 10px 0"
              }}>
                Settings
              </p>
            )}
            
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "space-between",
              width: "100%"
            }}>
              {!collapsed && <span style={{ fontSize: 13, color: "hsl(var(--foreground))", fontWeight: 500 }}>Theme</span>}
              <button
                onClick={toggleTheme}
                title={`Switch to ${theme === "light" ? "Dark" : "Light"} mode`}
                style={{
                  padding: collapsed ? "0" : "6px 10px",
                  width: collapsed ? 36 : "auto",
                  height: collapsed ? 36 : "auto",
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--secondary))",
                  color: "hsl(var(--foreground))",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  transition: "background 0.15s"
                }}
              >
                {theme === "light" ? (
                  <>
                    <Sun size={13} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
                    {!collapsed && <span>Light</span>}
                  </>
                ) : (
                  <>
                    <Moon size={13} style={{ color: "hsl(var(--primary))", flexShrink: 0 }} />
                    {!collapsed && <span>Dark</span>}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Profile Section */}
          <div style={{
            padding: collapsed ? "12px 8px" : "12px 20px",
            borderTop: "1px solid hsl(var(--border))",
            background: "hsl(var(--card))",
            display: "flex",
            flexDirection: "column",
            alignItems: collapsed ? "center" : "stretch",
            gap: collapsed ? 0 : 10,
            transition: "all 0.2s"
          }}>
            {collapsed ? (
              <div
                onClick={() => setProfileOpen(true)}
                title="User Profile"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "hsl(var(--primary))",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  boxShadow: "0 2px 5px rgba(0,0,0,0.1)"
                }}
              >
                {user?.username.charAt(0).toUpperCase()}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: "pointer" }} onClick={() => setProfileOpen(true)}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: "hsl(var(--primary))",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    flexShrink: 0
                  }}>
                    {user?.username.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user?.username}
                    </span>
                    <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                      {user?.role}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setProfileOpen(true)}
                  title="Profile Settings"
                  style={{
                    background: "none",
                    border: "none",
                    color: "hsl(var(--muted-foreground))",
                    cursor: "pointer",
                    display: "flex",
                    padding: 6,
                    borderRadius: 6,
                    transition: "background 0.15s"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--secondary))")}
                  onMouseLeave={e => (e.currentTarget.style.background = "none")}
                >
                  <User size={14} />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Mobile hamburger bar ─────────────────────────────────────────── */}
        {/* Only visible on mobile via CSS; gives project name + hamburger icon */}
        <div className="ws-mobile-bar">
          <span style={{ fontWeight: 700, fontSize: 14,
            color: "hsl(var(--foreground))",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {project?.name || "..."}
          </span>
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ flexShrink: 0, background: "none",
              border: "1px solid hsl(var(--border))", borderRadius: 6,
              padding: "5px 7px", cursor: "pointer",
              color: "hsl(var(--foreground))", display: "flex",
              alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600 }}>
            {sidebarOpen ? <X size={15} /> : <Menu size={15} />}
            <span>{sidebarOpen ? "Close" : "Menu"}</span>
          </button>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main style={{ flex: 1, height: "100%", overflow: "hidden",
          background: "hsl(var(--background))", minWidth: 0 }}>
          {renderActiveView()}
        </main>
      </div>

      {/* Sidebar responsive CSS */}
      <style>{`
        /* Desktop default — sidebar shows inline */
        .ws-sidebar {
          position: relative;
        }
        .ws-mobile-bar {
          display: none;
        }

        /* Mobile — sidebar hidden, drawer behaviour */
        @media (max-width: 767px) {
          .ws-sidebar {
            position: fixed !important;
            top: 0; left: 0; bottom: 0;
            height: 100dvh;
            z-index: 210;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            width: 260px !important;
          }
          .ws-sidebar.ws-sidebar--open {
            transform: translateX(0);
          }
          .ws-mobile-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 0 12px;
            height: 44px;
            position: absolute;
            top: 0; left: 0; right: 0;
            background: hsl(var(--card));
            border-bottom: 1px solid hsl(var(--border));
            z-index: 10;
            flex-shrink: 0;
          }
          /* Push main content down for mobile bar */
          main {
            padding-top: 44px;
          }
        }
      `}</style>

      {/* ── Profile Modal ─────────────────────────────────────────────────── */}
      {profileOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 2200,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}>
          <div style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 12,
            padding: 24,
            width: 400,
            maxWidth: "90vw",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            color: "hsl(var(--foreground))",
            position: "relative"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                <User size={18} style={{ color: "hsl(var(--primary))" }} /> User Profile
              </h3>
              <button
                onClick={() => {
                  setProfileOpen(false);
                  setProfileError(null);
                  setProfileSuccess(false);
                }}
                style={{ background: "transparent", border: "none", color: "hsl(var(--muted-foreground))", cursor: "pointer", display: "flex" }}
              >
                <X size={18} />
              </button>
            </div>

            {profileError && (
              <div style={{
                background: "hsl(var(--destructive) / 0.1)",
                border: "1px solid hsl(var(--destructive) / 0.2)",
                color: "hsl(var(--destructive))",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 14
              }}>
                {profileError}
              </div>
            )}
            
            {profileSuccess && (
              <div style={{
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.2)",
                color: "#22c55e",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 12,
                marginBottom: 14
              }}>
                Profile updated successfully!
              </div>
            )}

            {!isEditingProfile ? (
              /* Read-only User Detail View */
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: 8, background: "hsl(var(--secondary) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "hsl(var(--primary))",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 20
                  }}>
                    {user?.username.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "hsl(var(--foreground))" }}>{user?.username}</span>
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        background: "hsl(var(--primary) / 0.15)",
                        color: "hsl(var(--primary))",
                        padding: "1px 5px",
                        borderRadius: 4,
                        textTransform: "uppercase"
                      }}>
                        {user?.role}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{user?.email}</span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(true)}
                    style={{
                      height: 36, width: "100%", background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      border: "1px solid hsl(var(--border))", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      transition: "background 0.15s"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--border))"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "hsl(var(--secondary))"; }}
                  >
                    <Pencil size={14} /> Edit Profile
                  </button>
                  
                  <div style={{ height: "1px", background: "hsl(var(--border))", margin: "6px 0" }} />

                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      logout();
                    }}
                    style={{
                      height: 36, width: "100%", background: "hsl(var(--destructive) / 0.1)",
                      color: "hsl(var(--destructive))", border: "1px solid hsl(var(--destructive) / 0.2)",
                      borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      transition: "all 0.15s"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "hsl(var(--destructive) / 0.15)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "hsl(var(--destructive) / 0.1)";
                    }}
                  >
                    <LogOut size={14} /> Log Out
                  </button>
                </div>
              </div>
            ) : (
              /* Editable Profile Input Form */
              <form onSubmit={handleSaveProfile} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Username</label>
                  <input
                    type="text"
                    required
                    value={profileUsername}
                    onChange={e => setProfileUsername(e.target.value)}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary) / 0.3)",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--foreground))",
                      outline: "none", fontSize: 13, boxSizing: "border-box"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Email Address</label>
                  <input
                    type="email"
                    required
                    value={profileEmail}
                    onChange={e => setProfileEmail(e.target.value)}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary) / 0.3)",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--foreground))",
                      outline: "none", fontSize: 13, boxSizing: "border-box"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>New Password (optional)</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={profilePassword}
                    onChange={e => setProfilePassword(e.target.value)}
                    style={{
                      width: "100%", height: 36, padding: "0 10px",
                      background: "hsl(var(--secondary) / 0.3)",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--foreground))",
                      outline: "none", fontSize: 13, boxSizing: "border-box"
                    }}
                  />
                </div>

                {profilePassword && (
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 4, textTransform: "uppercase" }}>Confirm New Password</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={profileConfirmPassword}
                      onChange={e => setProfileConfirmPassword(e.target.value)}
                      style={{
                        width: "100%", height: 36, padding: "0 10px",
                        background: "hsl(var(--secondary) / 0.3)",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        color: "hsl(var(--foreground))",
                        outline: "none", fontSize: 13, boxSizing: "border-box"
                      }}
                    />
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingProfile(false);
                      setProfileUsername(user?.username || "");
                      setProfileEmail(user?.email || "");
                      setProfilePassword("");
                      setProfileConfirmPassword("");
                      setProfileError(null);
                    }}
                    style={{
                      height: 36, flex: 1, background: "hsl(var(--secondary))", color: "hsl(var(--foreground))",
                      border: "1px solid hsl(var(--border))", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s"
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "hsl(var(--border))"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "hsl(var(--secondary))"; }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={profileSaving}
                    style={{
                      height: 36, flex: 2, background: "hsl(var(--primary))", color: "#fff",
                      border: "none", borderRadius: 6, fontWeight: 600, fontSize: 13, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      transition: "background 0.15s"
                    }}
                  >
                    {profileSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
