"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHUDStore } from "@/hooks/useHUD";
import { parseApiError, rawApi } from "@/lib/api";
import type { SignupFailure } from "@/lib/signup";
import { ROUTES } from "@/lib/routes";

interface User {
  user_id: number;
  email: string;
  username?: string;
  full_name?: string;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, username: string, fullName: string, apiKey: string, provider: string, model?: string, baseUrl?: string) => Promise<true | SignupFailure>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// The browser's IANA time zone (e.g. "Asia/Kolkata"). Sent silently so the server can use the user's
// local calendar day for streaks, daily quests and caps. Never shown; undefined if the browser has none.
function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

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
      const { data, response } = await rawApi.GET("/auth/me");
      if (response.ok && data) {
        setUser(data as unknown as User);
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
      const { response } = await rawApi.POST("/auth/login", { body: { email, password, timezone: browserTimeZone() } });
      if (response.ok) {
        await checkAuth();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function register(email: string, password: string, username: string, fullName: string, apiKey: string, provider: string, model?: string, baseUrl?: string): Promise<true | SignupFailure> {
    try {
      const { error, response } = await rawApi.POST("/auth/register", {
        body: { email, password, username, full_name: fullName, api_key: apiKey, llm_provider: provider, llm_model: model, llm_base_url: baseUrl, timezone: browserTimeZone() },
      });
      if (response.ok) {
        // FIX BUG 49: Instead of calling login() (which makes a second API round-trip
        // and could fail independently), call checkAuth() to verify the session.
        // The register endpoint doesn't set a session cookie so we still need to
        // log in — but we do it directly without risking a false "registration failed"
        // error if the second call encounters a transient failure.
        const loginOk = await login(email, password);
        if (!loginOk) {
          return { message: "Account created but login failed — please log in manually." };
        }
        return true;
      }
      // Surface the actual error from the backend, with the request field it is about (error.details.field)
      const failure = parseApiError(response.status, error, "Registration failed");
      const field = failure.details?.field;
      return { message: failure.message, field: typeof field === "string" ? field : undefined };
    } catch {
      return { message: "Registration failed — check your connection" };
    }
  }

  async function logout() {
    try {
      await rawApi.POST("/auth/logout");
    } catch {}
    setUser(null);
    await setUserIdAsync("guest");
    await hudRefresh();
    router.push(ROUTES.study);
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