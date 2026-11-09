// Take a card out of the queue (until its question is missed again); POST puts it back (Undo).
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api, intParam } from "@/server/route";
import { needFeature } from "@/server/study/plan";
import { removeItem, restoreItem } from "@/server/study/review";

export const dynamic = "force-dynamic";

export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await needFeature(ctx, u, "review_queue");
  await rateLimit(ctx.db, `review-remove:${u.id}`, 120, 60);
  await removeItem(ctx, u.id, intParam(id));
  return { ok: true };
});

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await needFeature(ctx, u, "review_queue");
  await rateLimit(ctx.db, `review-remove:${u.id}`, 120, 60);
  await restoreItem(ctx, u.id, intParam(id));
  return { ok: true };
});
