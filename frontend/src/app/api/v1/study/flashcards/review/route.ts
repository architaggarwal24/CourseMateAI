// A flipped flashcard, self-graded: counts for its concept; with front and back it joins the review queue.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { flashcardReview } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `flashcard-review:${u.id}`, 120, 60);
  return flashcardReview(ctx, u, await readJson(req));
});
