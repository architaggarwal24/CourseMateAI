// What admins change about the server's AI from the app (the API keys stay Cloudflare secrets):
//   - models for everyone: the fast / strong / premium / small slots, saved in app_settings "ai_slots" and laid over
//     LLM_FAST, LLM_STRONG, LLM_PREMIUM and WORKERS_AI_MODEL; clearing one goes back to the setting
//   - each admin's own model ("ai_override:<user id>"): tried first on that admin's own requests (to test a model),
//     the normal models still behind it; students never get it
//   - Ollama (a model on the admin's computer): only under `next dev`, only as an admin's own model
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { appSettings } from "../db/schema";
import { HttpError } from "../http";
import { DEFAULT_WORKERS_AI_MODEL, KEY_ENV, parseSpec, PROVIDERS, type KeyedProvider, type Target } from "./models";

type Env = Record<string, string | undefined>;

export const SLOT_NAMES = ["fast", "strong", "premium", "small"] as const;
export type SlotName = (typeof SLOT_NAMES)[number];
export type Slots = Partial<Record<SlotName, string>>;

const SLOTS_KEY = "ai_slots";
const overrideKey = (userId: number) => `ai_override:${userId}`;
/** The setting each slot stands in for. */
export const SLOT_ENV: Record<SlotName, string> = { fast: "LLM_FAST", strong: "LLM_STRONG", premium: "LLM_PREMIUM", small: "WORKERS_AI_MODEL" };

/** Ollama is for local development only: `next dev` (NODE_ENV=development). */
export function ollamaEnabled(env: Env = process.env): boolean {
  return env.NODE_ENV === "development";
}
export function ollamaBase(env: Env = process.env): string {
  return (env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

/** The saved slots and (for `userId`) that admin's own model, in one read. */
export async function aiSettings(db: Db, userId?: number): Promise<{ slots: Slots; override: string | null }> {
  const keys = userId ? [SLOTS_KEY, overrideKey(userId)] : [SLOTS_KEY];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys)).all();
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const slots = parseJson<Slots>(get(SLOTS_KEY), {});
  const override = userId ? parseJson<{ spec?: string } | null>(get(overrideKey(userId)), null)?.spec ?? null : null;
  return { slots: typeof slots === "object" && slots ? slots : {}, override };
}

/** The environment with the saved slots laid over it (what models.ts route() reads). */
export function withSlots(env: Env, slots: Slots): Env {
  const out: Env = { ...env };
  for (const s of SLOT_NAMES) if (slots[s]) out[SLOT_ENV[s]] = slots[s];
  return out;
}

export async function effectiveEnv(db: Db, env: Env = process.env): Promise<Env> {
  return withSlots(env, (await aiSettings(db)).slots);
}

const configured = (provider: KeyedProvider, env: Env) => !!(env[KEY_ENV[provider]] || "").trim();

function invalid(message: string, field: string): HttpError {
  return new HttpError(400, "invalid_model", message, null, { field });
}

/** A slot's value checked: "provider:model" with a key on the server, or a Workers AI model for the small slot. */
function checkSlot(slot: SlotName, value: string, env: Env): string {
  const v = value.trim();
  if (slot === "small") {
    if (!/^@cf\/[\w.@/-]+$/.test(v)) throw invalid("The small slot is a Workers AI model, such as @cf/meta/llama-3.1-8b-instruct-fp8.", slot);
    return v;
  }
  const spec = parseSpec(v);
  if (!spec || spec.provider === "ollama") {
    throw invalid("Write it as provider:model, with provider gemini, openai, claude, nvidia or workers-ai.", slot);
  }
  if (spec.provider !== "workers-ai" && !configured(spec.provider, env)) {
    throw new HttpError(400, "provider_not_configured", `The server has no ${KEY_ENV[spec.provider]} set, so ${spec.provider} can't answer. Add the key in the Cloudflare dashboard first.`, null, { field: slot });
  }
  return `${spec.provider}:${spec.model}`;
}

/** Change some slots: a string sets one, null or "" clears it (back to the setting). Returns the saved slots. */
export async function saveSlots(db: Db, change: Partial<Record<SlotName, string | null>>, env: Env = process.env): Promise<Slots> {
  const { slots } = await aiSettings(db);
  const next: Slots = { ...slots };
  for (const s of SLOT_NAMES) {
    if (!(s in change)) continue;
    const v = change[s];
    if (v === null || v === undefined || String(v).trim() === "") delete next[s];
    else next[s] = checkSlot(s, String(v), env);
  }
  const value = JSON.stringify(next);
  await db.insert(appSettings).values({ key: SLOTS_KEY, value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: nowIso() } });
  return next;
}

/** An admin's own model as a target, or null when it can't be used here (Ollama outside dev, a missing key). */
export function overrideTarget(spec: string | null | undefined, env: Env = process.env): Target | null {
  const s = parseSpec(spec ?? undefined);
  if (!s) return null;
  if (s.provider === "ollama") return ollamaEnabled(env) ? { slot: "strong", provider: "ollama", model: s.model } : null;
  if (s.provider === "workers-ai") return { slot: "small", provider: "workers-ai", model: s.model };
  const apiKey = (env[KEY_ENV[s.provider]] || "").trim();
  return apiKey ? { slot: "strong", provider: s.provider, model: s.model, apiKey } : null;
}

/** Set (or with null clear) an admin's own model. */
export async function saveOverride(db: Db, userId: number, spec: string | null, env: Env = process.env): Promise<string | null> {
  const key = overrideKey(userId);
  if (spec === null || spec.trim() === "") {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return null;
  }
  const s = parseSpec(spec);
  if (!s || (s.provider === "ollama" && !ollamaEnabled(env))) {
    throw invalid(s?.provider === "ollama" ? "Ollama works only while running the app on your computer (npm run dev)." : "Write it as provider:model.", "spec");
  }
  if (s.provider !== "ollama" && s.provider !== "workers-ai" && !configured(s.provider, env)) {
    throw new HttpError(400, "provider_not_configured", `The server has no ${KEY_ENV[s.provider]} set, so ${s.provider} can't answer.`, null, { field: "spec" });
  }
  const value = JSON.stringify({ spec: `${s.provider}:${s.model}` });
  await db.insert(appSettings).values({ key, value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: nowIso() } });
  return `${s.provider}:${s.model}`;
}

/** Each provider and whether the server can use it (a key set; Workers AI always; Ollama only in development). */
export function providerStatus(env: Env = process.env): { id: string; configured: boolean; key_env: string | null }[] {
  return PROVIDERS.filter((p) => p !== "ollama" || ollamaEnabled(env)).map((p) => ({
    id: p,
    configured: p === "workers-ai" || p === "ollama" ? true : configured(p, env),
    key_env: p === "workers-ai" || p === "ollama" ? null : KEY_ENV[p],
  }));
}

/** The models the local Ollama has pulled ([] when it isn't running, or outside development). */
export async function ollamaModels(env: Env = process.env, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  if (!ollamaEnabled(env)) return [];
  try {
    const res = await fetchImpl(`${ollamaBase(env)}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const j = (await res.json()) as { models?: { name?: string }[] };
    return (j.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}

/** The settings each slot falls back to when nothing is saved (shown as the placeholder). */
export function slotDefaults(env: Env = process.env): Record<SlotName, string> {
  return {
    fast: env.LLM_FAST || "", strong: env.LLM_STRONG || env.LLM_FAST || "",
    premium: env.LLM_PREMIUM || env.LLM_STRONG || env.LLM_FAST || "", small: env.WORKERS_AI_MODEL || DEFAULT_WORKERS_AI_MODEL,
  };
}
