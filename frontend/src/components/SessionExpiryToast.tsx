import React, { useEffect, useState } from "react";
import { useAuth } from "../features/auth/AuthContext";
import { Clock, RefreshCw, X } from "lucide-react";

export function SessionExpiryToast() {
  const { token, extendSession } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!token) {
      setSecondsLeft(null);
      return;
    }

    const checkTokenExpiry = () => {
      try {
        const payloadBase64 = token.split(".")[1];
        if (!payloadBase64) return;
        const decodedJson = atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(decodedJson);
        if (payload.exp) {
          const now = Math.floor(Date.now() / 1000);
          const remaining = payload.exp - now;
          if (remaining > 0 && remaining <= 180) { // 3 minutes warning
            setSecondsLeft(remaining);
          } else {
            setSecondsLeft(null);
            if (remaining > 180) setDismissed(false);
          }
        }
      } catch (e) {
        setSecondsLeft(null);
      }
    };

    checkTokenExpiry();
    const interval = setInterval(checkTokenExpiry, 1000);
    return () => clearInterval(interval);
  }, [token]);

  if (secondsLeft === null || secondsLeft <= 0 || dismissed) {
    return null;
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const handleExtend = async () => {
    setExtending(true);
    try {
      const ok = await extendSession();
      if (ok) {
        setDismissed(true);
      }
    } finally {
      setExtending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 99990,
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(56, 189, 248, 0.3)",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 20px 35px -10px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
        color: "#ffffff",
        fontFamily: "inherit",
        animation: "toastSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <style>{`
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: "rgba(56, 189, 248, 0.15)",
          color: "#38bdf8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Clock size={18} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#f8fafc", display: "flex", alignItems: "center", gap: 6 }}>
          Session Expiring in <span style={{ color: "#38bdf8", fontFamily: "monospace", fontSize: 13 }}>{formatTime(secondsLeft)}</span>
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          Extend session to continue your active work
        </div>
      </div>

      <button
        onClick={handleExtend}
        disabled={extending}
        style={{
          background: "linear-gradient(135deg, #0284c7, #2563eb)",
          border: "none",
          borderRadius: 8,
          padding: "7px 12px",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: extending ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginLeft: 8,
          transition: "all 0.2s ease",
          boxShadow: "0 2px 8px rgba(37, 99, 235, 0.4)",
        }}
      >
        <RefreshCw size={12} style={{ animation: extending ? "spin 1s linear infinite" : "none" }} />
        {extending ? "Extending..." : "Extend"}
      </button>

      <button
        onClick={() => setDismissed(true)}
        style={{
          background: "transparent",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          transition: "color 0.2s ease",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "#f1f5f9")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
