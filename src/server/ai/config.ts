// What admins change about the server's AI from the app (the API keys stay Cloudflare secrets):
//   - models for everyone: the fast / strong / premium / small slots, saved in app_settings "ai_slots" and laid over
//     LLM_FAST, LLM_STRONG, LLM_PREMIUM and WORKERS_AI_MODEL; clearing one goes back to the setting
//   - each admin's own model ("ai_override:<user id>"): tried first on that admin's own requests (to test a model),
//     the normal models still behind it; students never get it
//   - Ollama (a model on an admin's computer), only ever as an admin's own model: on that computer under `next dev`
//     (http://localhost:11434, or OLLAMA_BASE_URL), and on the live site through a tunnel URL an admin saves
//     ("ollama_url": a Cloudflare Tunnel or ngrok address in front of their Ollama). Any model name may be used.
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

const OLLAMA_URL_KEY = "ollama_url";
/** Ollama answers under `next dev` (this computer), or anywhere once an admin has saved a tunnel URL. */
export function ollamaEnabled(env: Env = process.env, tunnel?: string | null): boolean {
  return env.NODE_ENV === "development" || !!tunnel;
}
/**
 * Ollama's own address, without an API path: people paste ".../v1" (the OpenAI-style path) or ".../api", and the app
 * adds those itself, so ".../v1/v1/chat/completions" answered "404 page not found".
 */
export function ollamaRoot(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/(?:v1|api)(?:\/(?:chat\/completions|chat|tags|generate))?$/i, "").replace(/\/+$/, "");
}
/** Where Ollama answers: the saved tunnel URL first, then OLLAMA_BASE_URL, then this computer. */
export function ollamaBase(env: Env = process.env, tunnel?: string | null): string {
  return ollamaRoot(tunnel || env.OLLAMA_BASE_URL || "http://localhost:11434");
}

/** A tunnel URL checked: https (or http://localhost in development), no path tricks. */
export function checkOllamaUrl(raw: string, env: Env = process.env): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw invalid("Paste the whole address, such as https://my-ollama.trycloudflare.com.", "url"); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && env.NODE_ENV === "development")) {
    throw invalid("The live site can only reach Ollama over https (a tunnel address).", "url");
  }
  if (u.username || u.password) throw invalid("Leave the user name and password out of the address.", "url");
  return ollamaRoot(`${u.origin}${u.pathname}`);
}

/** Save (or with null clear) the Ollama tunnel URL. */
export async function saveOllamaUrl(db: Db, url: string | null, env: Env = process.env): Promise<string | null> {
  if (url === null || url.trim() === "") {
    await db.delete(appSettings).where(eq(appSettings.key, OLLAMA_URL_KEY));
    return null;
  }
  const value = checkOllamaUrl(url, env);
  await db.insert(appSettings).values({ key: OLLAMA_URL_KEY, value: JSON.stringify({ url: value }), updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify({ url: value }), updatedAt: nowIso() } });
  return value;
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function parseJson<T>(raw: string | undefined | null, fallback: T): T {
  try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

/** The saved slots, the Ollama tunnel URL and (for `userId`) that admin's own model, in one read. */
export async function aiSettings(db: Db, userId?: number): Promise<{ slots: Slots; override: string | null; ollamaUrl: string | null }> {
  const keys = userId ? [SLOTS_KEY, OLLAMA_URL_KEY, overrideKey(userId)] : [SLOTS_KEY, OLLAMA_URL_KEY];
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys)).all();
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const slots = parseJson<Slots>(get(SLOTS_KEY), {});
  const override = userId ? parseJson<{ spec?: string } | null>(get(overrideKey(userId)), null)?.spec ?? null : null;
  const ollamaUrl = parseJson<{ url?: string } | null>(get(OLLAMA_URL_KEY), null)?.url ?? null;
  return { slots: typeof slots === "object" && slots ? slots : {}, override, ollamaUrl };
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

/** An admin's own model as a target, or null when it can't be used here (Ollama with no way to reach it, no key). */
export function overrideTarget(spec: string | null | undefined, env: Env = process.env, tunnel?: string | null): Target | null {
  const s = parseSpec(spec ?? undefined);
  if (!s) return null;
  if (s.provider === "ollama") return ollamaEnabled(env, tunnel) ? { slot: "strong", provider: "ollama", model: s.model, baseUrl: ollamaBase(env, tunnel) } : null;
  if (s.provider === "workers-ai") return { slot: "small", provider: "workers-ai", model: s.model };
  const apiKey = (env[KEY_ENV[s.provider]] || "").trim();
  return apiKey ? { slot: "strong", provider: s.provider, model: s.model, apiKey } : null;
}

/** Set (or with null clear) an admin's own model. */
export async function saveOverride(db: Db, userId: number, spec: string | null, env: Env = process.env, tunnel?: string | null): Promise<string | null> {
  const key = overrideKey(userId);
  if (spec === null || spec.trim() === "") {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return null;
  }
  const s = parseSpec(spec);
  if (!s || (s.provider === "ollama" && !ollamaEnabled(env, tunnel))) {
    throw invalid(s?.provider === "ollama" ? "Ollama works under npm run dev, or on the live site once a tunnel URL is saved in Admin → AI." : "Write it as provider:model.", "spec");
  }
  if (s.provider !== "ollama" && s.provider !== "workers-ai" && !configured(s.provider, env)) {
    throw new HttpError(400, "provider_not_configured", `The server has no ${KEY_ENV[s.provider]} set, so ${s.provider} can't answer.`, null, { field: "spec" });
  }
  const value = JSON.stringify({ spec: `${s.provider}:${s.model}` });
  await db.insert(appSettings).values({ key, value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: nowIso() } });
  return `${s.provider}:${s.model}`;
}

/** Each provider and whether the server can use it (a key set; Workers AI always; Ollama when it can be reached). */
export function providerStatus(env: Env = process.env, tunnel?: string | null): { id: string; configured: boolean; key_env: string | null }[] {
  return PROVIDERS.filter((p) => p !== "ollama" || ollamaEnabled(env, tunnel)).map((p) => ({
    id: p,
    configured: p === "workers-ai" || p === "ollama" ? true : configured(p, env),
    key_env: p === "workers-ai" || p === "ollama" ? null : KEY_ENV[p],
  }));
}

/** The models that Ollama has pulled ([] when it isn't answering, or can't be reached from here). */
export async function ollamaModels(env: Env = process.env, fetchImpl: typeof fetch = fetch, tunnel?: string | null): Promise<string[]> {
  if (!ollamaEnabled(env, tunnel)) return [];
  try {
    // ngrok's free tunnels show a warning page to browsers unless asked not to
    const res = await fetchImpl(`${ollamaBase(env, tunnel)}/api/tags`, { signal: AbortSignal.timeout(tunnel ? 5000 : 2000), headers: { "ngrok-skip-browser-warning": "1" } });
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
