// Admin -> AI: the admin's own model, tried first on their own requests only (to test a model; Ollama works under
// `next dev` only). { spec: "provider:model" } sets it, { spec: null } goes back to the normal models.
import { aiSettings, saveOverride } from "@/server/ai/config";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  return { spec: (await aiSettings(ctx.db, u.id)).override };
});

export const PUT = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${u.id}`, 120, 60);
  const { spec } = await readJson<{ spec?: unknown }>(req);
  const { ollamaUrl } = await aiSettings(ctx.db);
  return { spec: await saveOverride(ctx.db, u.id, typeof spec === "string" ? spec : null, process.env, ollamaUrl) };
});
