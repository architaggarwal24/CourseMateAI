// The cards to review now, in order (learning, due reviews, then today's new cards); session_id narrows it.
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { needFeature } from "@/server/study/plan";
import { queue, scopeHashes, statsFor } from "@/server/study/review";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await needFeature(ctx, u, "review_queue");
  await rateLimit(ctx.db, `review-queue:${u.id}`, 120, 60);
  const q = new URL(req.url).searchParams;
  const sessionId = q.get("session_id");
  const hashes = sessionId ? await scopeHashes(ctx, u, sessionId) : null;
  return { ok: true, items: await queue(ctx, u.id, { limit: Number(q.get("limit") ?? 20), hashes }), stats: await statsFor(ctx, u) };
});
