// The /admin page's calls (src/app/api/v1/admin/*). Errors come back as ApiError (the API's error shape).
import { ApiError, parseApiError } from "@/lib/api/errors";

export type Tier = "apprentice" | "scholar" | "sage" | "archmage";
export const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "apprentice", label: "Apprentice (Free)" },
  { value: "scholar", label: "Scholar" },
  { value: "sage", label: "Sage" },
  { value: "archmage", label: "Archmage" },
];

export interface AdminUser {
  user_id: number;
  email: string;
  username: string | null;
  full_name: string;
  email_verified: boolean;
  role: "admin" | "user";
  is_owner: boolean;
  banned: boolean;
  ban_reason: string | null;
  ban_expires: string | null;
  created_at: string;
  tier: Tier;
  tier_name: string;
  plan: { tier: Tier; source: string; expires_at: string | null; started_at: string } | null;
}

export interface Invite {
  code: string;
  tier: Tier;
  tier_name: string;
  days: number | null;
  max_uses: number;
  uses: number;
  note: string | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  usable: boolean;
}

export interface AiReport {
  days: number;
  today_usd: number;
  cap_usd: number;
  /** The hard ceiling (AI_DAILY_CAP_MAX_USD); the cap is never off. */
  cap_max_usd: number;
  /** Only the owner changes the cap. */
  can_edit: boolean;
  capped: boolean;
  total_usd: number;
  models: { provider: string; model: string; calls: number; fallbacks: number; tokens_in: number; tokens_out: number; cost_usd: number; priced: boolean }[];
  by_day: { day: string; usd: number }[];
  routes: Record<Tier, { small: string[]; strong: string[] }>;
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/admin${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: "network", message: "Couldn't reach CourseMate. Check your connection.", action: "retry", details: null });
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw parseApiError(res.status, body, "That didn't work");
  return body as T;
}

export const adminApi = {
  users: (q = "", offset = 0, limit = 25) =>
    call<{ users: AdminUser[]; total: number; offset: number; limit: number }>(`/users?q=${encodeURIComponent(q)}&offset=${offset}&limit=${limit}`),
  setPlan: (id: number, tier: Tier, days: number | null) => call<AdminUser>(`/users/${id}/plan`, { method: "PUT", body: { tier, days } }),
  clearPlan: (id: number) => call<AdminUser>(`/users/${id}/plan`, { method: "DELETE" }),
  setRole: (id: number, role: "admin" | "user") => call<AdminUser>(`/users/${id}/role`, { method: "PUT", body: { role } }),
  ban: (id: number, reason: string, days: number | null) => call<AdminUser>(`/users/${id}/ban`, { body: { reason, days } }),
  unban: (id: number) => call<AdminUser>(`/users/${id}/ban`, { method: "DELETE" }),
  invites: () => call<{ invites: Invite[] }>("/invites"),
  createInvite: (b: { tier: Tier; days: number | null; max_uses: number; code?: string; note?: string; valid_days: number | null }) =>
    call<Invite>("/invites", { body: b }),
  ai: () => call<AiReport>("/ai"),
  setCap: (usd: number) => call<AiReport>("/ai", { method: "PUT", body: { cap_usd: usd } }),
  revokeInvite: (code: string) => call<{ ok: true }>(`/invites/${encodeURIComponent(code)}`, { method: "DELETE" }),
};

/** "12 Nov 2026" */
export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
