import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toast: {
    success: (message: string, duration?: number) => void;
    error: (message: string, duration?: number) => void;
    info: (message: string, duration?: number) => void;
    warning: (message: string, duration?: number) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Global static emitter so functions outside React components can trigger toasts
let globalAddToast: ((type: ToastType, message: string, duration?: number) => void) | null = null;

export const toast = {
  success: (msg: string, duration?: number) => globalAddToast?.("success", msg, duration),
  error: (msg: string, duration?: number) => globalAddToast?.("error", msg, duration),
  info: (msg: string, duration?: number) => globalAddToast?.("info", msg, duration),
  warning: (msg: string, duration?: number) => globalAddToast?.("warning", msg, duration),
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]); // Keep max 5

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  }, [removeToast]);

  useEffect(() => {
    globalAddToast = addToast;
    return () => {
      globalAddToast = null;
    };
  }, [addToast]);

  const value = {
    toast: {
      success: (msg: string, dur?: number) => addToast("success", msg, dur),
      error: (msg: string, dur?: number) => addToast("error", msg, dur),
      info: (msg: string, dur?: number) => addToast("info", msg, dur),
      warning: (msg: string, dur?: number) => addToast("warning", msg, dur),
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Floating Toast Container */}
      <div
        style={{
          position: "fixed",
          top: 20,
          right: 20,
          zIndex: 999999,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 400,
          width: "calc(100vw - 40px)",
          pointerEvents: "none",
        }}
      >
        <style>{`
          @keyframes toastSlideIn {
            from { opacity: 0; transform: translateX(30px) scale(0.95); }
            to { opacity: 1; transform: translateX(0) scale(1); }
          }
        `}</style>
        {toasts.map((t) => {
          const config = {
            success: {
              icon: <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />,
              border: "rgba(52, 211, 153, 0.3)",
              bg: "linear-gradient(135deg, rgba(6, 78, 59, 0.92), rgba(15, 23, 42, 0.96))",
              textColor: "#ecfdf5",
            },
            error: {
              icon: <XCircle size={18} className="text-rose-400 shrink-0" />,
              border: "rgba(248, 113, 113, 0.3)",
              bg: "linear-gradient(135deg, rgba(136, 19, 55, 0.92), rgba(15, 23, 42, 0.96))",
              textColor: "#fff1f2",
            },
            warning: {
              icon: <AlertTriangle size={18} className="text-amber-400 shrink-0" />,
              border: "rgba(251, 191, 36, 0.3)",
              bg: "linear-gradient(135deg, rgba(120, 53, 15, 0.92), rgba(15, 23, 42, 0.96))",
              textColor: "#fffbeb",
            },
            info: {
              icon: <Info size={18} className="text-sky-400 shrink-0" />,
              border: "rgba(56, 189, 248, 0.3)",
              bg: "linear-gradient(135deg, rgba(12, 74, 110, 0.92), rgba(15, 23, 42, 0.96))",
              textColor: "#f0f9ff",
            },
          }[t.type];

          return (
            <div
              key={t.id}
              style={{
                pointerEvents: "auto",
                background: config.bg,
                border: `1px solid ${config.border}`,
                borderRadius: 12,
                padding: "12px 14px",
                boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                color: config.textColor,
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                fontSize: 13,
                fontWeight: 500,
                lineHeight: 1.4,
                animation: "toastSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {config.icon}
              <div style={{ flex: 1, wordBreak: "break-word" }}>{t.message}</div>
              <button
                onClick={() => removeToast(t.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.6)",
                  cursor: "pointer",
                  padding: 2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 4,
                  transition: "color 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.toast;
}
