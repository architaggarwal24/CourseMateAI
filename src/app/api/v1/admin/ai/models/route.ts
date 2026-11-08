// Admin -> AI models: the models everyone's requests use (saved over the LLM_* settings), which providers have a
// key, the admin's own model and, under `next dev`, the models the local Ollama has. Any admin can change them; the
// daily spend cap (owner only, /admin/ai) still limits what they cost.
import { aiSettings, ollamaBase, ollamaEnabled, ollamaModels, providerStatus, saveOllamaUrl, saveSlots, slotDefaults, SLOT_NAMES, withSlots, type SlotName } from "@/server/ai/config";
import { slotProblem } from "@/server/ai/test";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import type { Db } from "@/server/db";

export const dynamic = "force-dynamic";

async function view(db: Db, userId: number) {
  const { slots, override, ollamaUrl } = await aiSettings(db, userId);
  const models = await ollamaModels(process.env, fetch, ollamaUrl);
  const on = ollamaEnabled(process.env, ollamaUrl);
  return {
    slots, defaults: slotDefaults(), providers: providerStatus(process.env, ollamaUrl), mine: override,
    // why a slot can't be used (e.g. LLM_FAST without "provider:"), so it doesn't silently fall back to Workers AI
    problems: Object.fromEntries(SLOT_NAMES.map((s) => [s, slotProblem(s, withSlots(process.env, slots))])),
    ollama: { enabled: on, base: on ? ollamaBase(process.env, ollamaUrl) : null, models, tunnel: ollamaUrl, local: process.env.NODE_ENV === "development" },
  };
}

export const GET = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  return view(ctx.db, u.id);
});

/**
 * { slots: { fast?: "provider:model" | null, strong?, premium?, small?: "@cf/..." | null } } - null clears one.
 * { ollama_url: "https://..." | null } saves (or clears) the tunnel to an admin's Ollama.
 */
export const PUT = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${u.id}`, 120, 60);
  const body = await readJson<{ slots?: Record<string, unknown>; ollama_url?: unknown }>(req);
  if ("ollama_url" in body) await saveOllamaUrl(ctx.db, typeof body.ollama_url === "string" ? body.ollama_url : null);
  const change: Partial<Record<SlotName, string | null>> = {};
  for (const s of SLOT_NAMES) {
    const v = body.slots?.[s];
    if (v === null || typeof v === "string") change[s] = v;
  }
  if (Object.keys(change).length) await saveSlots(ctx.db, change);
  return view(ctx.db, u.id);
});
