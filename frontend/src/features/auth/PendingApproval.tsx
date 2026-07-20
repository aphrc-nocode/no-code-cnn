import React, { useState } from "react";
import { useAuth } from "./AuthContext";
import { Clock, ShieldAlert, LogOut, RefreshCw } from "lucide-react";

export default function PendingApproval() {
  const { user, logout, refreshUser } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshUser();
    // Simulate slight lag for visual feedback
    setTimeout(() => setRefreshing(false), 600);
  };

  const isRejected = user?.status === "rejected";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950 px-4 transition-colors duration-200">
      {/* Decorative background blobs */}
      <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-amber-400/10 dark:bg-amber-600/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 bg-rose-400/10 dark:bg-rose-600/5 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl shadow-xl overflow-hidden relative z-10 p-8 transition-all text-center">
        {isRejected ? (
          <div className="w-16 h-16 bg-red-100 dark:bg-red-950/30 rounded-full flex items-center justify-center mx-auto mb-6 text-red-600 dark:text-red-400 animate-pulse">
            <ShieldAlert className="w-8 h-8" />
          </div>
        ) : (
          <div className="w-16 h-16 bg-amber-100 dark:bg-amber-950/30 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-600 dark:text-amber-400">
            <Clock className="w-8 h-8 animate-spin" style={{ animationDuration: "10s" }} />
          </div>
        )}

        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-3">
          {isRejected ? "Registration Rejected" : "Awaiting Admin Approval"}
        </h1>

        <p className="text-sm text-slate-500 dark:text-zinc-400 leading-relaxed mb-8 max-w-sm mx-auto">
          {isRejected
            ? "Your account registration has been rejected by an administrator. Please contact the platform administrators for clarification."
            : `Hello ${user?.username}, your account has been successfully registered! However, a system administrator must approve your account before you can log in to the workspace.`}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {!isRejected && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-md shadow-primary/10 flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Checking..." : "Check Status"}
            </button>
          )}

          <button
            onClick={logout}
            className="px-5 py-2.5 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700/80 text-slate-700 dark:text-zinc-200 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-200/60 dark:border-zinc-700/50"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
