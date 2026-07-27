import React, { useState } from "react";
import { useAuth } from "../features/auth/AuthContext";
import api from "../api";
import { Lock, LogOut, ArrowRight, ShieldCheck, AlertCircle, KeyRound } from "lucide-react";

export function SessionReauthModal() {
  const { user, isReauthModalOpen, login, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isReauthModalOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter your password to resume session.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await api.post("auth/login", {
        username: user.username,
        password: password,
      });

      if (res.data && res.data.access_token) {
        login(res.data.access_token, res.data.user, res.data.refresh_token);
        setPassword("");
      } else {
        setError("Invalid password. Please try again.");
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Authentication failed. Check your password.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5, 8, 16, 0.75)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        animation: "fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        padding: 20,
      }}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.94) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 25px rgba(56, 189, 248, 0.15); }
          50% { box-shadow: 0 0 45px rgba(56, 189, 248, 0.35); }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "linear-gradient(145deg, rgba(17, 24, 39, 0.95), rgba(9, 13, 22, 0.98))",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 20,
          padding: 32,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.1)",
          animation: "scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1), pulseGlow 4s infinite",
          color: "#f8fafc",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Header Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(99, 102, 241, 0.2))",
              border: "1px solid rgba(56, 189, 248, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#38bdf8",
              boxShadow: "0 4px 12px rgba(56, 189, 248, 0.15)",
            }}
          >
            <Lock size={24} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: "#ffffff" }}>
              Session Expired
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
              Re-authenticate to protect and preserve your unsaved work
            </p>
          </div>
        </div>

        {/* User Card */}
        <div
          style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 14,
              color: "#fff",
            }}
          >
            {user.username.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.username}
            </div>
            <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.email}
            </div>
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              padding: "4px 8px",
              borderRadius: 20,
              background: "rgba(52, 211, 153, 0.15)",
              color: "#34d399",
              border: "1px solid rgba(52, 211, 153, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ShieldCheck size={12} /> Active Work Saved
          </div>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 6 }}>
              <KeyRound size={14} style={{ color: "#38bdf8" }} /> Enter Password to Unlock
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoFocus
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "rgba(15, 23, 42, 0.8)",
                border: error ? "1px solid #f87171" : "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 14,
                color: "#ffffff",
                outline: "none",
                transition: "all 0.2s ease",
                boxShadow: "inset 0 2px 4px rgba(0,0,0,0.4)",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                background: "rgba(248, 113, 113, 0.1)",
                border: "1px solid rgba(248, 113, 113, 0.3)",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#f87171",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <button
              type="button"
              onClick={logout}
              style={{
                flex: 1,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 10,
                padding: "11px 16px",
                color: "#94a3b8",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(248, 113, 113, 0.15)", e.currentTarget.style.color = "#f87171")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)", e.currentTarget.style.color = "#94a3b8")}
            >
              <LogOut size={14} /> Log Out
            </button>

            <button
              type="submit"
              disabled={submitting}
              style={{
                flex: 2,
                background: "linear-gradient(135deg, #0284c7, #2563eb)",
                border: "none",
                borderRadius: 10,
                padding: "11px 16px",
                color: "#ffffff",
                fontSize: 13,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)",
                transition: "all 0.2s ease",
                opacity: submitting ? 0.7 : 1,
              }}
              onMouseEnter={(e) => !submitting && (e.currentTarget.style.transform = "translateY(-1px)", e.currentTarget.style.boxShadow = "0 6px 18px rgba(37, 99, 235, 0.6)")}
              onMouseLeave={(e) => !submitting && (e.currentTarget.style.transform = "translateY(0)", e.currentTarget.style.boxShadow = "0 4px 14px rgba(37, 99, 235, 0.4)")}
            >
              {submitting ? (
                "Unlocking Session..."
              ) : (
                <>
                  Resume Session <ArrowRight size={14} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
