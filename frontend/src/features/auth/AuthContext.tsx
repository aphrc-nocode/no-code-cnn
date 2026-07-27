import React, { createContext, useContext, useEffect, useState } from "react";
import api, { silentRefreshToken } from "../../api";

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
  isReauthModalOpen: boolean;
  login: (token: string, user: User, refreshToken?: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
  closeReauthModal: () => void;
  extendSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReauthModalOpen, setIsReauthModalOpen] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem("maklens_token");
      const savedUser = localStorage.getItem("maklens_user");
      if (savedToken && savedUser) {
        try {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          
          // Verify & validate session on startup
          const res = await api.get("auth/me");
          if (res.data) {
            localStorage.setItem("maklens_user", JSON.stringify(res.data));
            setUser(res.data);
          }
        } catch (e) {
          // If auth/me returns 401, customFetch in api.ts will attempt silent refresh automatically.
          // If refresh also failed, session-expired event will fire.
          console.warn("Initial session validation failed, attempting recovery...");
        }
      }
      setLoading(false);
    };

    initAuth();

    const handleSessionExpired = () => {
      setIsReauthModalOpen(true);
    };

    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => {
      window.removeEventListener("auth:session-expired", handleSessionExpired);
    };
  }, []);

  const login = (newToken: string, newUser: User, refreshToken?: string) => {
    localStorage.setItem("maklens_token", newToken);
    localStorage.setItem("maklens_user", JSON.stringify(newUser));
    if (refreshToken) {
      localStorage.setItem("maklens_refresh_token", refreshToken);
    }
    // Set cookie for static tools (workflow canvas, annotator) compatibility
    document.cookie = `maklens_token=${newToken}; path=/; max-age=86400; SameSite=Lax`;
    setToken(newToken);
    setUser(newUser);
    setIsReauthModalOpen(false);
  };

  const logout = () => {
    localStorage.removeItem("maklens_token");
    localStorage.removeItem("maklens_user");
    localStorage.removeItem("maklens_refresh_token");
    // Clear cookie
    document.cookie = "maklens_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax";
    document.cookie = "maklens_refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=Lax";
    setToken(null);
    setUser(null);
    setIsReauthModalOpen(false);
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
      console.error("Failed to refresh user profile:", err);
    }
  };

  const extendSession = async (): Promise<boolean> => {
    const newToken = await silentRefreshToken();
    if (newToken) {
      setToken(newToken);
      await refreshUser();
      return true;
    }
    setIsReauthModalOpen(true);
    return false;
  };

  const closeReauthModal = () => {
    setIsReauthModalOpen(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      loading,
      isReauthModalOpen,
      login,
      logout,
      refreshUser,
      closeReauthModal,
      extendSession
    }}>
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
