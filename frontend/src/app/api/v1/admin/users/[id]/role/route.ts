import { setRole } from "@/server/admin";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api, intParam } from "@/server/route";

export const dynamic = "force-dynamic";

/** { role: "admin" | "user" } - the owner only. */
export const PUT = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  return setRole(ctx, actor, intParam(id), (await readJson<{ role?: unknown }>(req)).role);
});
