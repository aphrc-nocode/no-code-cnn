import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { 
  Users, FolderGit2, Cpu, CheckCircle2, AlertCircle, XCircle, 
  Trash2, ShieldCheck, UserCheck, RefreshCw, Search, ShieldAlert, Clock
} from "lucide-react";
import api from "../api";

interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface AdminStats {
  users: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  projects: {
    total: number;
  };
  jobs: {
    total: number;
    running: number;
    completed: number;
  };
}

export default function AdminDashboard() {
  const { user: currentAdmin } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, statsRes] = await Promise.all([
        api.get("admin/users"),
        api.get("admin/stats")
      ]);
      setUsers(usersRes.data || []);
      setStats(statsRes.data || null);
    } catch (err: any) {
      console.error(err);
      setError("Failed to load admin data. Ensure you have administrator access.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateStatus = async (userId: string, newStatus: "approved" | "rejected") => {
    try {
      const res = await api.put(`admin/users/${userId}/status`, { status: newStatus });
      if (res.data) {
        setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        // Refresh stats
        const statsRes = await api.get("admin/stats");
        setStats(statsRes.data || null);
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update status");
    }
  };

  const handleUpdateRole = async (userId: string, newRole: "admin" | "user") => {
    try {
      const res = await api.put(`admin/users/${userId}/role`, { role: newRole });
      if (res.data) {
        setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      }
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to update role");
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await api.delete(`admin/users/${userId}`);
      setUsers(users.filter(u => u.id !== userId));
      setConfirmDeleteId(null);
      // Refresh stats
      const statsRes = await api.get("admin/stats");
      setStats(statsRes.data || null);
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to delete user");
    }
  };

  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 text-slate-900 dark:text-zinc-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Admin Control Panel</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
            Manage user approval states, platform roles, and track global platform usage.
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="self-start md:self-auto px-4 py-2 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700/80 text-slate-700 dark:text-zinc-200 text-sm font-semibold rounded-xl border border-slate-200/60 dark:border-zinc-700/50 flex items-center gap-2 transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Reload System
        </button>
      </div>

      {error && (
        <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Metrics Grid */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Users Card */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-6 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                User Registry
              </p>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-white">{stats.users.total} Total</h3>
              <div className="flex gap-4 mt-3 text-xs text-slate-500 dark:text-zinc-400">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> {stats.users.approved} Approved</span>
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-amber-500" /> {stats.users.pending} Pending</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-slate-50 dark:bg-zinc-800/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-zinc-400">
              <Users className="w-6 h-6" />
            </div>
          </div>

          {/* Projects Card */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-6 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                Active Projects
              </p>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-white">{stats.projects.total}</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-3">
                Total computer vision workspace buckets.
              </p>
            </div>
            <div className="w-12 h-12 bg-slate-50 dark:bg-zinc-800/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-zinc-400">
              <FolderGit2 className="w-6 h-6" />
            </div>
          </div>

          {/* Training Jobs Card */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 rounded-2xl p-6 shadow-sm flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2">
                Training Workloads
              </p>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-white">{stats.jobs.total} Pipelines</h3>
              <div className="flex gap-4 mt-3 text-xs text-slate-500 dark:text-zinc-400">
                <span className="flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" /> {stats.jobs.running} Running</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {stats.jobs.completed} Done</span>
              </div>
            </div>
            <div className="w-12 h-12 bg-slate-50 dark:bg-zinc-800/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-zinc-400">
              <Cpu className="w-6 h-6" />
            </div>
          </div>
        </div>
      )}

      {/* Directory Section */}
      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800/80 rounded-2xl shadow-sm overflow-hidden transition-all">
        {/* Toolbar */}
        <div className="p-6 border-b border-slate-100 dark:border-zinc-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-lg font-bold">User Directory</h2>
          <div className="relative w-full sm:max-w-xs">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              placeholder="Search by username or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700/60 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all"
            />
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3" />
              Loading users...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              No matching users found in the system.
            </div>
          ) : (
            <div>
              {/* Mobile Card List View */}
              <div className="block md:hidden divide-y divide-slate-100 dark:divide-zinc-800/50">
                {filteredUsers.map((u) => {
                  const isSelf = u.id === currentAdmin?.id;
                  
                  return (
                    <div key={u.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                          {u.username}
                          {isSelf && <span className="text-[10px] bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200/50 dark:border-zinc-700/50">You</span>}
                        </div>
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                          u.status === "approved"
                            ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/30 text-green-700 dark:text-green-400"
                            : u.status === "rejected"
                            ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-400"
                            : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30 text-amber-700 dark:text-amber-400"
                        }`}>
                          {u.status === "approved" ? <CheckCircle2 className="w-3 h-3" /> : u.status === "rejected" ? <XCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                        </span>
                      </div>
                      
                      <div className="text-xs text-slate-500 dark:text-zinc-400 space-y-1">
                        <div><span className="font-medium text-slate-400 dark:text-zinc-500">Email:</span> {u.email}</div>
                        <div><span className="font-medium text-slate-400 dark:text-zinc-500">Registered:</span> {new Date(u.created_at).toLocaleDateString()}</div>
                      </div>
                      
                      <div className="flex items-center justify-between pt-2">
                        <div>
                          {isSelf ? (
                            <span className="inline-flex items-center gap-1 text-primary font-semibold text-xs uppercase tracking-wider">
                              <ShieldCheck className="w-4 h-4" /> Admin
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) => handleUpdateRole(u.id, e.target.value as any)}
                              className="bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </div>
                        
                        {!isSelf && (
                          <div className="flex items-center gap-2">
                            {u.status !== "approved" && (
                              <button
                                onClick={() => handleUpdateStatus(u.id, "approved")}
                                title="Approve account"
                                className="p-2 bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 rounded-lg transition-colors border border-green-200/50 dark:border-green-900/30"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                            )}

                            {u.status !== "rejected" && (
                              <button
                                onClick={() => handleUpdateStatus(u.id, "rejected")}
                                title="Reject / Suspend account"
                                className="p-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-lg transition-colors border border-rose-200/50 dark:border-rose-900/30"
                              >
                                <ShieldAlert className="w-4 h-4" />
                              </button>
                            )}

                            {confirmDeleteId === u.id ? (
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleDeleteUser(u.id)}
                                  className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-all"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2.5 py-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-slate-700 dark:text-zinc-200 text-xs font-semibold rounded-lg transition-all"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(u.id)}
                                title="Remove User Account"
                                className="p-2 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-700/80 text-slate-500 dark:text-zinc-400 rounded-lg transition-colors border border-slate-200/40 dark:border-zinc-700/50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <table className="hidden md:table w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-zinc-800/30 text-slate-500 dark:text-zinc-400 font-semibold border-b border-slate-100 dark:border-zinc-800/60">
                    <th className="p-4 pl-6">Username</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Registered At</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 pr-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/50">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentAdmin?.id;
                    
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/55 dark:hover:bg-zinc-800/20 transition-colors">
                        <td className="p-4 pl-6 font-medium text-slate-900 dark:text-white flex items-center gap-2">
                          {u.username}
                          {isSelf && <span className="text-[10px] bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-semibold px-2 py-0.5 rounded-full border border-slate-200/50 dark:border-zinc-700/50">You</span>}
                        </td>
                        <td className="p-4 text-slate-500 dark:text-zinc-400">{u.email}</td>
                        <td className="p-4 text-slate-400 dark:text-zinc-500">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="p-4">
                          {isSelf ? (
                            <span className="inline-flex items-center gap-1 text-primary font-semibold text-xs uppercase tracking-wider">
                              <ShieldCheck className="w-4 h-4" /> Admin
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              onChange={(e) => handleUpdateRole(u.id, e.target.value as any)}
                              className="bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-xs py-1 px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          )}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                            u.status === "approved"
                              ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/30 text-green-700 dark:text-green-400"
                              : u.status === "rejected"
                              ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/30 text-red-700 dark:text-red-400"
                              : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/30 text-amber-700 dark:text-amber-400"
                          }`}>
                            {u.status === "approved" ? <CheckCircle2 className="w-3.5 h-3.5" /> : u.status === "rejected" ? <XCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                            {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                          </span>
                        </td>
                        <td className="p-4 pr-6 text-right">
                          {isSelf ? (
                            <span className="text-xs text-slate-400 dark:text-zinc-500 italic">No actions available</span>
                          ) : (
                            <div className="inline-flex items-center gap-2 justify-end">
                              {u.status !== "approved" && (
                                <button
                                  onClick={() => handleUpdateStatus(u.id, "approved")}
                                  title="Approve account"
                                  className="p-1.5 bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 rounded-lg transition-colors border border-green-200/50 dark:border-green-900/30"
                                >
                                  <UserCheck className="w-4 h-4" />
                                </button>
                              )}

                              {u.status !== "rejected" && (
                                <button
                                  onClick={() => handleUpdateStatus(u.id, "rejected")}
                                  title="Reject / Suspend account"
                                  className="p-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-lg transition-colors border border-rose-200/50 dark:border-rose-900/30"
                                >
                                  <ShieldAlert className="w-4 h-4" />
                                </button>
                              )}

                              {confirmDeleteId === u.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleDeleteUser(u.id)}
                                    className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-all"
                                  >
                                    Delete
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="px-2.5 py-1 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 text-slate-700 dark:text-zinc-200 text-xs font-semibold rounded-lg transition-all"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(u.id)}
                                  title="Remove User Account"
                                  className="p-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/80 dark:hover:bg-zinc-700/80 text-slate-500 dark:text-zinc-400 rounded-lg transition-colors border border-slate-200/40 dark:border-zinc-700/50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
