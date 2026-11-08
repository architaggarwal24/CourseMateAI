// Admin -> AI -> "Test connection": ask one model for a one-word answer and say how it went (time, reply, or the
// error with a plain hint). Admins only; not metered (a few tokens). Also explains why a slot can't be used (a
// setting without "provider:", a provider with no key), which otherwise silently falls through to the next model.
import type { Db } from "../db";
import { aiSettings, overrideTarget, SLOT_ENV, withSlots, type SlotName } from "./config";
import { KEY_ENV, parseSpec, slotTarget, type KeyedProvider, type Target } from "./models";
import { llmFor } from "./run";

type Env = Record<string, string | undefined>;

export interface TestResult {
  ok: boolean;
  /** What was tested, as provider:model (when it could be worked out). */
  spec: string | null;
  /** Where the model came from: "your model", "LLM_FAST", "saved in Admin" ... */
  source: string;
  latency_ms?: number;
  reply?: string;
  error?: string;
  hint?: string;
}

const PROMPT = [{ role: "user" as const, content: "Reply with exactly one word: OK" }];

/** Why a slot's setting can't be used here, in plain words (null: it can). */
export function slotProblem(slot: SlotName, env: Env): string | null {
  if (slot === "small") return null;
  const names: Record<Exclude<SlotName, "small">, string[]> = {
    fast: ["LLM_FAST"], strong: ["LLM_STRONG", "LLM_FAST"], premium: ["LLM_PREMIUM", "LLM_STRONG", "LLM_FAST"],
  };
  if (slotTarget(slot, env)) return null;
  const problems: string[] = [];
  for (const name of names[slot]) {
    const raw = (env[name] || "").trim();
    if (!raw) continue;
    const spec = parseSpec(raw);
    if (!spec) { problems.push(`${name} is "${raw}": write it as provider:model, e.g. gemini:${raw.includes(":") ? raw.split(":").pop() : raw}`); continue; }
    if (spec.provider === "ollama") { problems.push(`${name} can't be Ollama (that's for an admin's own model only)`); continue; }
    if (spec.provider !== "workers-ai" && !(env[KEY_ENV[spec.provider as KeyedProvider]] || "").trim()) problems.push(`${name} needs ${KEY_ENV[spec.provider as KeyedProvider]}`);
  }
  return problems.length ? problems.join("; ") : `${names[slot][0]} isn't set: requests fall back to Workers AI`;
}

function hintFor(t: Target, message: string): string | undefined {
  const m = message.toLowerCase();
  const status = Number(/^(\d{3})\b/.exec(message)?.[1] ?? NaN);
  if (t.provider === "ollama") {
    // Ollama's own 404 for a wrong path is plain "404 page not found"; a missing model says "model ... not found"
    if (m.includes("page not found")) return "That address isn't Ollama's root. Use just the address, like http://localhost:11434 or https://xyz.trycloudflare.com (no /v1 or /api at the end).";
    if (m.includes("unauthorized") || m.includes("sign in") || status === 401) return "Cloud models need your Ollama account: on your computer run `ollama signin`, then try again.";
    if (status === 404 || m.includes("not found")) {
      return t.model.includes("cloud")
        ? `Ollama doesn't know "${t.model}". Cloud models need: ollama signin, then ollama pull ${t.model} (the exact name as shown on ollama.com or in \`ollama list\`).`
        : `Ollama doesn't have "${t.model}". On your computer run: ollama pull ${t.model} (check the exact name with \`ollama list\`).`;
    }
    if (status === 403) return "Ollama refused the tunnel's requests. Start the tunnel with --http-host-header localhost:11434 (cloudflared) or --host-header=localhost:11434 (ngrok).";
    if (status === 502 || status === 503 || status === 530) return "The tunnel is up but Ollama isn't answering behind it. Is `ollama serve` running?";
    if (m.includes("timeout") || m.includes("abort") || m.includes("fetch") || m.includes("network")) {
      return "The tunnel address didn't answer. Quick tunnels (trycloudflare.com) get a new address every time they start: paste the new one in Admin → AI.";
    }
    return "Check that Ollama and the tunnel are both running on your computer.";
  }
  if (t.provider === "workers-ai") return "Is the Workers AI binding (AI) set, and is the model name an @cf/... model from the Workers AI catalog?";
  if (status === 400 && m.includes("api key")) return `The provider rejected the key: check ${KEY_ENV[t.provider as KeyedProvider]}.`;
  if (status === 401 || status === 403) return `The key is wrong or has no access to this model: check ${KEY_ENV[t.provider as KeyedProvider]}.`;
  if (status === 404) return `No model called "${t.model}" for this key. Check the exact model id in the provider's docs.`;
  if (status === 429) return "Rate limit or quota reached for this key. Try again in a minute, or check billing.";
  if (m.includes("timeout") || m.includes("abort")) return "The model took too long (20 s).";
  return undefined;
}

/** Test a provider:model, or what a slot uses now. */
export async function testModel(db: Db, adminId: number, input: { spec?: string | null; slot?: SlotName | null },
  bindings: { AI?: unknown }, env: Env = process.env, now: () => number = Date.now): Promise<TestResult> {
  const { slots, ollamaUrl } = await aiSettings(db, adminId);
  let target: Target | null = null;
  let source = "";
  if (input.spec) {
    source = "this setting";
    const parsed = parseSpec(input.spec);
    if (!parsed) return { ok: false, spec: null, source, error: `"${input.spec}" isn't provider:model.`, hint: "For example gemini:gemini-3.6-flash or ollama:llama3.2." };
    target = overrideTarget(input.spec, env, ollamaUrl);
    if (!target) {
      return {
        ok: false, spec: `${parsed.provider}:${parsed.model}`, source,
        error: parsed.provider === "ollama" ? "Ollama can't be reached from here." : `No key for ${parsed.provider}.`,
        hint: parsed.provider === "ollama" ? "Save your tunnel address in Admin → AI (the live site can't see your computer otherwise)." : `Add ${KEY_ENV[parsed.provider as KeyedProvider]} in the Worker's settings.`,
      };
    }
  } else if (input.slot) {
    const merged = withSlots(env, slots);
    source = slots[input.slot] ? "saved in Admin" : SLOT_ENV[input.slot];
    target = slotTarget(input.slot, merged);
    if (!target) return { ok: false, spec: null, source, error: "This slot has no usable model.", hint: slotProblem(input.slot, merged) ?? undefined };
  } else {
    return { ok: false, spec: null, source, error: "Nothing to test." };
  }
  const spec = `${target.provider}:${target.model}`;
  const start = now();
  try {
    const r = await llmFor(target, bindings).generate(PROMPT, { maxOutputTokens: 16, temperature: 0, timeoutMs: 20_000 });
    const reply = (r.text || "").trim();
    if (!reply) return { ok: false, spec, source, latency_ms: now() - start, error: "The model answered with nothing.", hint: hintFor(target, "") };
    return { ok: true, spec, source, latency_ms: now() - start, reply: reply.slice(0, 120) };
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    return { ok: false, spec, source, latency_ms: now() - start, error: message, hint: hintFor(target, message) };
  }
}
