// Grade one card: 1 Again, 2 Hard, 3 Good, 4 Easy. FSRS sets when it comes back.
import { requireUser } from "@/server/context";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { record } from "@/server/study/mastery";
import { needFeature } from "@/server/study/plan";
import { grade, statsFor } from "@/server/study/review";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await needFeature(ctx, u, "review_queue");
  await rateLimit(ctx.db, `review-grade:${u.id}`, 240, 60);
  const b = await readJson(req);
  if (!Number.isInteger(b.item_id)) throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.", null, { field: "item_id" });
  const out = await grade(ctx, u.id, b.item_id as number, b.rating, {
    reps: b.reps as number | null | undefined, durationMs: b.duration_ms as number | null | undefined,
    mastery: (hash, concept, correct) => record(ctx, u.id, hash, concept, correct, { source: "review" }),
  });
  return { ok: true, item: out.item, mastery: out.mastery, stats: await statsFor(ctx, u), rewards: null };
});
