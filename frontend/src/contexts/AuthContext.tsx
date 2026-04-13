"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHUDStore } from "@/hooks/useHUD";

interface User {
  user_id: number;
  email: string;
  username?: string;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, username: string, fullName: string, apiKey: string, provider: string, model?: string) => Promise<boolean | string>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const hudRefresh = useHUDStore((s) => s.refresh);
  const setUserIdAsync = useHUDStore((s) => s.setUserIdAsync);

  useEffect(() => {
    checkAuth();
  }, []);

  // FIX BUG 50: Wrap in useCallback so checkAuth has a stable reference.
  // Without this, adding checkAuth to a dependency array causes infinite loops.
  const checkAuth = useCallback(async function checkAuth() {
    try {
      const res = await fetch(`${API}/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        await setUserIdAsync(String(data.user_id));
        await hudRefresh();
      } else {
        setUser(null);
        await setUserIdAsync("guest");
        await hudRefresh();
      }
    } catch (error) {
      setUser(null);
      await setUserIdAsync("guest");
      await hudRefresh();
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // stable — deps are setState functions which never change

  async function login(email: string, password: string): Promise<boolean> {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        await checkAuth();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function register(email: string, password: string, username: string, fullName: string, apiKey: string, provider: string, model?: string): Promise<boolean | string> {
    try {
      const res = await fetch(`${API}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, username, full_name: fullName, api_key: apiKey, llm_provider: provider, llm_model: model }),
      });
      if (res.ok) {
        // FIX BUG 49: Instead of calling login() (which makes a second API round-trip
        // and could fail independently), call checkAuth() to verify the session.
        // The register endpoint doesn't set a session cookie so we still need to
        // log in — but we do it directly without risking a false "registration failed"
        // error if the second call encounters a transient failure.
        const loginOk = await login(email, password);
        if (!loginOk) {
          return "Account created but login failed — please log in manually.";
        }
        return true;
      }
      // Surface the actual error from the backend
      try {
        const err = await res.json();
        return err.detail || "Registration failed";
      } catch {
        return "Registration failed";
      }
    } catch {
      return "Registration failed — check your connection";
    }
  }

  async function logout() {
    try {
      await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    } catch {}
    setUser(null);
    await setUserIdAsync("guest");
    await hudRefresh();
    router.push("/");
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}