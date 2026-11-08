// Admin -> AI models: the models everyone's requests use (saved over the LLM_* settings), which providers have a
// key, the admin's own model and, under `next dev`, the models the local Ollama has. Any admin can change them; the
// daily spend cap (owner only, /admin/ai) still limits what they cost.
import { aiSettings, ollamaBase, ollamaEnabled, ollamaModels, providerStatus, saveSlots, slotDefaults, SLOT_NAMES, type SlotName } from "@/server/ai/config";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import type { Db } from "@/server/db";

export const dynamic = "force-dynamic";

async function view(db: Db, userId: number) {
  const [{ slots, override }, models] = await Promise.all([aiSettings(db, userId), ollamaModels()]);
  return {
    slots, defaults: slotDefaults(), providers: providerStatus(), mine: override,
    ollama: { enabled: ollamaEnabled(), base: ollamaEnabled() ? ollamaBase() : null, models },
  };
}

export const GET = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  return view(ctx.db, u.id);
});

/** { slots: { fast?: "provider:model" | null, strong?, premium?, small?: "@cf/..." | null } } - null clears one. */
export const PUT = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${u.id}`, 120, 60);
  const body = await readJson<{ slots?: Record<string, unknown> }>(req);
  const change: Partial<Record<SlotName, string | null>> = {};
  for (const s of SLOT_NAMES) {
    const v = body.slots?.[s];
    if (v === null || typeof v === "string") change[s] = v;
  }
  await saveSlots(ctx.db, change);
  return view(ctx.db, u.id);
});
