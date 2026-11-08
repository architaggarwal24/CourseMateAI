// Which model answers what (Stage 4.3; the same routes as backend/core_brains/model_router.py).
//   small    Workers AI (WORKERS_AI_MODEL): boss lines, follow-up rewrites: free within the daily allowance
//   fast     LLM_FAST, a cheap API model                 e.g. gemini:gemini-3.5-flash-lite
//   strong   LLM_STRONG, for questions and answers        e.g. gemini:gemini-3.8-flash   (default: LLM_FAST)
//   premium  LLM_PREMIUM, the strongest, for Archmage     e.g. claude:claude-sonnet-5-5  (default: LLM_STRONG)
// A route is an ordered list of slots per plan and job: the first configured one answers, the next ones are the
// fallbacks. MODEL_ROUTES_JSON overrides any of it, e.g. {"apprentice": {"strong": ["fast", "small"]}}.
// An API slot needs its provider's key: GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY or NVIDIA_API_KEY.
import { TIERS, type Tier } from "../plans";

export const JOBS = ["small", "strong"] as const;
export type Job = (typeof JOBS)[number];
export const SLOTS = ["small", "fast", "strong", "premium"] as const;
export type Slot = (typeof SLOTS)[number];

export const DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export const ROUTES: Record<Tier, Record<Job, Slot[]>> = {
  apprentice: { small: ["small", "fast"], strong: ["fast", "strong", "small"] },
  scholar: { small: ["small", "fast"], strong: ["strong", "fast", "small"] },
  sage: { small: ["small", "fast"], strong: ["strong", "fast", "small"] },
  archmage: { small: ["fast", "small"], strong: ["premium", "strong", "fast", "small"] },
};

// "ollama": a model on the admin's own computer, for that admin's requests during `next dev` only (ai/config.ts).
export const PROVIDERS = ["gemini", "openai", "claude", "nvidia", "workers-ai", "ollama"] as const;
export type Provider = (typeof PROVIDERS)[number];
/** Providers that take an API key from the server's settings. */
export type KeyedProvider = Exclude<Provider, "workers-ai" | "ollama">;

export const KEY_ENV: Record<KeyedProvider, string> = {
  gemini: "GOOGLE_API_KEY", openai: "OPENAI_API_KEY", claude: "ANTHROPIC_API_KEY", nvidia: "NVIDIA_API_KEY",
};
const ALIASES: Record<string, Provider> = { google: "gemini", anthropic: "claude", "nvidia-nim": "nvidia" };

export interface Target {
  slot: Slot;
  provider: Provider;
  model: string;
  /** The provider key (none for Workers AI). */
  apiKey?: string;
  /** Ollama: where it answers (localhost in development, an admin's tunnel URL on the live site). */
  baseUrl?: string;
}

type Env = Record<string, string | undefined>;

/** "provider:model" -> {provider, model}, or null. */
export function parseSpec(spec: string | undefined): { provider: Provider; model: string } | null {
  const raw = (spec || "").trim();
  const at = raw.indexOf(":");
  if (at < 1) return null;
  const name = raw.slice(0, at).toLowerCase();
  const provider = (ALIASES[name] ?? name) as Provider;
  const model = raw.slice(at + 1).trim();
  if (!model || !(PROVIDERS as readonly string[]).includes(provider)) return null;
  return { provider, model };
}

/** The target a slot stands for here, or null when it isn't set up (no spec, or no key for its provider). */
export function slotTarget(slot: Slot, env: Env = process.env): Target | null {
  if (slot === "small") return { slot, provider: "workers-ai", model: (env.WORKERS_AI_MODEL || "").trim() || DEFAULT_WORKERS_AI_MODEL };
  const names: Record<Exclude<Slot, "small">, string[]> = {
    fast: ["LLM_FAST"], strong: ["LLM_STRONG", "LLM_FAST"], premium: ["LLM_PREMIUM", "LLM_STRONG", "LLM_FAST"],
  };
  for (const name of names[slot]) {
    const spec = parseSpec(env[name]);
    if (!spec) continue;
    if (spec.provider === "workers-ai") return { slot, ...spec };
    if (spec.provider === "ollama") continue;                     // never for everyone
    const apiKey = (env[KEY_ENV[spec.provider]] || "").trim();
    if (!apiKey) continue;
    return { slot, ...spec, apiKey };
  }
  return null;
}

function routeOverrides(env: Env): Partial<Record<Tier, Partial<Record<Job, Slot[]>>>> {
  try {
    const data = JSON.parse(env.MODEL_ROUTES_JSON || "{}");
    const out: Partial<Record<Tier, Partial<Record<Job, Slot[]>>>> = {};
    for (const t of TIERS) {
      for (const j of JOBS) {
        const list = data?.[t]?.[j];
        if (Array.isArray(list) && list.every((s) => (SLOTS as readonly string[]).includes(s))) (out[t] ??= {})[j] = list;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The targets to try, in order, for this plan and job. `capped`: the day's spend cap is reached, Workers AI only. */
export function route(tier: Tier, job: Job, { capped = false, env = process.env }: { capped?: boolean; env?: Env } = {}): Target[] {
  const slots = capped ? (["small"] as Slot[]) : routeOverrides(env)[tier]?.[job] ?? ROUTES[tier][job];
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const s of slots) {
    const t = slotTarget(s, env);
    if (!t) continue;
    const key = `${t.provider}:${t.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
