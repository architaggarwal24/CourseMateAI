"use client";

// Who is signed in, and the account actions every screen shares. Since Stage 4.1 accounts live on the Worker
// (Better Auth, src/server/auth): sign-in, sign-up and codes go to /api/auth/* (src/lib/auth/authApi.ts), and
// GET /api/v1/auth/me says who you are, with your plan and whether you are an admin.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { rawApi } from "@/lib/api";
import * as authApi from "@/lib/auth/authApi";
import type { AuthFailure, SignInResult, SignUpForm } from "@/lib/auth/authApi";
import { ROUTES } from "@/lib/routes";
import { useChampion } from "@/hooks/useChampion";
import { useReview } from "@/hooks/useReview";
import { useCourses } from "@/hooks/useCourses";

export interface User {
  user_id: number;
  email: string;
  username?: string;
  full_name?: string;
  email_verified?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  two_factor_enabled?: boolean;
  has_password?: boolean;
  /** Other ways this account signs in: "github", "google". */
  sign_in_providers?: string[];
  tier?: string;
  tier_name?: string;
}

export type RegisterResult = { ok: true; signedIn: boolean } | { ok: false; failure: AuthFailure };

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** The sign-in check couldn't reach the server (offline): not the same as being signed out. */
  unreachable?: boolean;
  /** Re-reads who is signed in (after a code, a profile change, Google). */
  refresh: () => Promise<User | null>;
  login: (email: string, password: string) => Promise<SignInResult>;
  register: (form: SignUpForm) => Promise<RegisterResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const setUserIdAsync = useHUDStore((s) => s.setUserIdAsync);

  const refresh = useCallback(async (): Promise<User | null> => {
    let next: User | null = null;
    let offline = false;
    try {
      const { data, response } = await rawApi.GET("/auth/me");
      if (response.ok && data) next = data as unknown as User;
    } catch { offline = true; /* offline: no answer either way */ }
    setUser(next);
    setUnreachable(offline);
    // One GET /hud at most: it shares the request AppShell started on mount (in parallel with /auth/me), and a
    // signed-out visitor gets the guest HUD without asking.
    try { await setUserIdAsync(next ? String(next.user_id) : "guest"); } catch { /* it fills in later */ }
    setLoading(false);
    return next;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function login(email: string, password: string): Promise<SignInResult> {
    const result = await authApi.signIn(email, password);
    if (result.status === "signed-in") await refresh();
    return result;
  }

  async function register(form: SignUpForm): Promise<RegisterResult> {
    const r = await authApi.signUp(form);
    if (r.ok && r.signedIn) await refresh();
    return r;
  }

  async function logout() {
    try { await rawApi.POST("/auth/logout"); } catch { /* signed out here either way */ }
    useChampion.getState().reset();             // the next person on this browser starts from the default
    useReview.getState().reset();
    useCourses.getState().reset();
    // A full page load to the landing page: every cached store starts empty, and the app frame never sees a
    // signed-out moment (it would send you to the login page instead).
    window.location.assign(ROUTES.home);
  }

  return (
    <AuthContext.Provider value={{ user, loading, unreachable, refresh, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
