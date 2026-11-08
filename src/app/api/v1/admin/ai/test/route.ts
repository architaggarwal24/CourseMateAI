// Admin -> AI -> Test connection. { spec: "provider:model" } tests that model; { slot: "fast" | ... } tests what the
// slot uses now. Answers { ok, spec, source, latency_ms, reply | error, hint }. Admins only, not metered.
import { SLOT_NAMES, type SlotName } from "@/server/ai/config";
import { testModel } from "@/server/ai/test";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin-ai-test:${u.id}`, 20, 60);
  const b = await readJson<{ spec?: unknown; slot?: unknown }>(req);
  const slot = typeof b.slot === "string" && (SLOT_NAMES as readonly string[]).includes(b.slot) ? (b.slot as SlotName) : null;
  const spec = typeof b.spec === "string" && b.spec.trim() ? b.spec.trim().slice(0, 200) : null;
  return testModel(ctx.db, u.id, { spec, slot }, ctx.env as unknown as { AI?: unknown });
});
