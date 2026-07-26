import React, { useState, useRef, useEffect } from "react";
import { User, Pencil, LogOut, ChevronDown, Check, X, Shield, Mail } from "lucide-react";
import api from "../api";

interface UserProfileDropdownProps {
  user: {
    id: number;
    username: string;
    email: string;
    role: string;
  };
  onLogout: () => void;
  onUpdateUser: (updatedUser: any) => void;
}

export default function UserProfileDropdown({ user, onLogout, onUpdateUser }: UserProfileDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Edit form state
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsEditing(false);
        setError(null);
        setSuccess(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const payload: any = { username, email };
      if (password.trim()) payload.password = password;

      const res = await api.put("/users/me", payload);
      onUpdateUser(res.data);
      setSuccess(true);
      setPassword("");
      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      {/* ── Navbar Trigger Button ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          padding: "5px 12px",
          borderRadius: 20,
          border: isOpen ? "1px solid hsl(var(--primary))" : "1px solid hsl(var(--border))",
          background: isOpen ? "hsl(var(--secondary))" : "hsl(var(--secondary) / 0.5)",
          color: "hsl(var(--foreground))",
          cursor: "pointer",
          userSelect: "none",
          transition: "all 0.15s ease",
          boxShadow: isOpen ? "0 0 0 2px hsl(var(--primary) / 0.2)" : "none"
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.background = "hsl(var(--secondary))";
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.background = "hsl(var(--secondary) / 0.5)";
        }}
      >
        <div style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "hsl(var(--primary))",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: 12
        }}>
          {user.username.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{user.username}</span>
        <ChevronDown size={14} style={{ color: "hsl(var(--muted-foreground))", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {/* ── Dropdown Menu ── */}
      {isOpen && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 8px)",
          right: 0,
          width: 280,
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          zIndex: 1000,
          overflow: "hidden",
          animation: "fadeIn 0.15s ease-out"
        }}>
          {/* Dropdown Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--secondary) / 0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "hsl(var(--primary))",
                color: "#ffffff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 16
              }}>
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "hsl(var(--foreground))" }}>{user.username}</span>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 800,
                    background: "hsl(var(--primary) / 0.15)",
                    color: "hsl(var(--primary))",
                    padding: "1px 6px",
                    borderRadius: 4,
                    textTransform: "uppercase"
                  }}>
                    {user.role}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{user.email}</span>
              </div>
            </div>
          </div>

          {/* Feedback messages */}
          {error && (
            <div style={{ padding: "8px 12px", background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))", fontSize: 11, borderBottom: "1px solid hsl(var(--border))" }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ padding: "8px 12px", background: "rgba(34, 197, 94, 0.1)", color: "#22c55e", fontSize: 11, borderBottom: "1px solid hsl(var(--border))" }}>
              Profile updated!
            </div>
          )}

          {/* Menu Options / Inline Edit */}
          <div style={{ padding: "6px" }}>
            {isEditing ? (
              <form onSubmit={handleSaveProfile} style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={{ width: "100%", height: 32, padding: "0 8px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, color: "hsl(var(--foreground))", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ width: "100%", height: 32, padding: "0 8px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, color: "hsl(var(--foreground))", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>New Password (optional)</label>
                  <input
                    type="password"
                    placeholder="Leave blank to keep current"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: "100%", height: 32, padding: "0 8px", background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, color: "hsl(var(--foreground))", outline: "none" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    style={{ flex: 1, height: 32, background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "hsl(var(--foreground))" }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{ flex: 1, height: 32, background: "hsl(var(--primary))", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: "hsl(var(--foreground))",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "hsl(var(--secondary))"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <Pencil size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                  <span>Edit Profile</span>
                </button>

                <div style={{ height: 1, background: "hsl(var(--border))", margin: "4px 0" }} />

                <button
                  onClick={() => {
                    setIsOpen(false);
                    onLogout();
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 6,
                    color: "hsl(var(--destructive))",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "hsl(var(--destructive) / 0.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <LogOut size={14} />
                  <span>Log Out</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
