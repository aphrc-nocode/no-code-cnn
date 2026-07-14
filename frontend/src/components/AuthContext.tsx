import React, { createContext, useContext, useEffect, useState } from "react";
import api from "../api";

export interface User {
  id: string;
  username: string;
  email: string;
  role: "user" | "admin";
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("maklens_token");
    const savedUser = localStorage.getItem("maklens_user");
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (e) {
        // Clear corrupt state
        localStorage.removeItem("maklens_token");
        localStorage.removeItem("maklens_user");
      }
    }
    setLoading(false);
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("maklens_token", newToken);
    localStorage.setItem("maklens_user", JSON.stringify(newUser));
    // Set cookie for static tools (workflow canvas, annotator) compatibility
    document.cookie = `maklens_token=${newToken}; path=/; max-age=86400; SameSite=Lax`;
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem("maklens_token");
    localStorage.removeItem("maklens_user");
    // Clear cookie
    document.cookie = "maklens_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax";
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    const savedToken = localStorage.getItem("maklens_token");
    if (!savedToken) return;
    try {
      const res = await api.get("auth/me");
      if (res.data) {
        localStorage.setItem("maklens_user", JSON.stringify(res.data));
        setUser(res.data);
      }
    } catch (err) {
      console.error("Failed to refresh user profile, logging out:", err);
      logout();
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
