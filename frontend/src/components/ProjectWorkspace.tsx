import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Edit3, Database, Cpu, Play, ChevronLeft, Sun, Moon, User, LogOut, Pencil, X } from "lucide-react";
import api, { type Project } from "../api";
import { useTheme } from "./ThemeContext";
import { useAuth } from "../features/auth/AuthContext";
import UserProfileDropdown from "./UserProfileDropdown";

import Annotator from "../features/annotator/Annotator";
import ImageGallery from "../features/dataset/ImageGallery";
import DatasetManager from "../features/dataset/DatasetManager";
import ModelGarden from "../features/models/ModelGarden";
import TestModel from "../features/test_explain/TestModel";

type TabType = "datasets" | "annotate" | "models" | "test";

const TABS: { id: TabType; label: string; Icon: any }[] = [
  { id: "datasets",  label: "Data",            Icon: Database },
  { id: "annotate",  label: "Annotate",        Icon: Edit3 },
  { id: "models",    label: "Models",          Icon: Cpu },
  { id: "test",      label: "Test & Explain",  Icon: Play },
];

const TASK_BADGE: Record<string, { color: string; bg: string }> = {
  detection:            { color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  image_segmentation:   { color: "#10b981", bg: "rgba(16,185,129,0.12)"  },
  segmentation:         { color: "#10b981", bg: "rgba(16,185,129,0.12)"  },
  image_classification: { color: "#06b6d4", bg: "rgba(6,182,212,0.12)"  },
  classification:       { color: "#06b6d4", bg: "rgba(6,182,212,0.12)"  },
};

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { user, logout, refreshUser } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("datasets");

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

  // Initialize profile fields
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

  // Synchronize active tab with location path
  useEffect(() => {
    const path = location.pathname;
    if (path.includes("/annotate")) setActiveTab("annotate");
    else if (path.includes("/models")) setActiveTab("models");
    else if (path.includes("/test")) setActiveTab("test");
    else setActiveTab("datasets");
  }, [location]);

  // Fetch project details
  useEffect(() => {
    if (id) {
      api.get(`/projects/${id}`)
        .then((res) => setProject(res.data))
        .catch(() => setProject({ id: Number(id) || 1, name: "Project", task_type: "image_classification", classes: [] }));
    }
  }, [id]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    navigate(`/projects/${id}/${tab}`);
  };

  const renderActiveView = () => {
    const path = location.pathname;
    if (activeTab === "annotate") {
      const hasImageId = /\/annotate\/\d+/.test(path);
      return hasImageId ? <Annotator /> : <ImageGallery />;
    }
    switch (activeTab) {
      case "datasets":  return <DatasetManager />;
      case "models":    return <ModelGarden />;
      case "test":      return <TestModel />;
      default:          return <DatasetManager />;
    }
  };

  const taskStyle = TASK_BADGE[project?.task_type ?? ""] ?? { color: "#64748b", bg: "rgba(100,116,139,0.1)" };
  const isAnnotating = /\/projects\/[a-zA-Z0-9-]+\/annotate\/\d+/.test(location.pathname);

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", height: isAnnotating ? "100vh" : "calc(100vh - 54px)",
        width: "100%", overflow: "hidden", background: "hsl(var(--background))", position: "relative" }}>

        {/* ─── Horizontal Step Navigation Header (Intel Geti Paradigm) ─── */}
        <div style={{
          height: 52,
          background: "hsl(var(--card))",
          borderBottom: "1px solid hsl(var(--border))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          flexShrink: 0
        }}>
          {/* Left Area: Back arrow and project metadata */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => navigate("/projects")}
              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12,
                fontWeight: 600, color: "hsl(var(--muted-foreground))", background: "none",
                border: "none", cursor: "pointer", padding: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--foreground))")}
              onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--muted-foreground))")}>
              <ChevronLeft size={14} /> Projects
            </button>
            <div style={{ width: 1, height: 16, background: "hsl(var(--border))" }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--foreground))", margin: 0,
              maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project?.name || "Loading..."}
            </h2>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase",
              padding: "2px 7px", borderRadius: 4, letterSpacing: "0.06em",
              background: taskStyle.bg, color: taskStyle.color }}>
              {project?.task_type?.replace(/_/g, " ") || ""}
            </span>
          </div>

          {/* Center Area: step steps */}
          <nav style={{ display: "flex", height: "100%" }}>
            {TABS.map(({ id: tab, label, Icon }) => {
              const active = activeTab === tab;
              return (
                <button key={tab} onClick={() => handleTabChange(tab)}
                  style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 20px",
                    border: "none",
                    borderBottom: active ? "3px solid hsl(var(--primary))" : "3px solid transparent",
                    background: "transparent",
                    color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    boxSizing: "border-box"
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = "hsl(var(--foreground))"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = "hsl(var(--muted-foreground))"; }}>
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Area: global settings and profile */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={toggleTheme} title="Switch Theme"
              style={{ background: "none", border: "none", color: "hsl(var(--muted-foreground))",
                cursor: "pointer", padding: 4, display: "flex", transition: "color 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "hsl(var(--foreground))")}
              onMouseLeave={e => (e.currentTarget.style.color = "hsl(var(--muted-foreground))")}>
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>

            {user && (
              <UserProfileDropdown
                user={user}
                onLogout={logout}
                onUpdateUser={(updatedUser) => setUser(updatedUser)}
              />
            )}
          </div>
        </div>

        {/* ─── Main Content View area ─── */}
        <main style={{ flex: 1, width: "100%", overflow: "hidden", background: "hsl(var(--background))" }}>
          {renderActiveView()}
        </main>
      </div>
    </>
  );
}
