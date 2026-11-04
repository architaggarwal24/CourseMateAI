import { ban, unban } from "@/server/admin";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api, intParam } from "@/server/route";

export const dynamic = "force-dynamic";

/** { reason?, days? } - days empty = for good. Signs them out everywhere. */
export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const body = await readJson<{ reason?: unknown; days?: unknown }>(req);
  return ban(ctx, actor, intParam(id), body.reason, body.days);
});

export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  return unban(ctx, intParam(id));
});
