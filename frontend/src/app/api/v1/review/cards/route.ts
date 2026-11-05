// Add flashcards to the queue ("Add deck to review"). A card already there is left as it is.
import { requireUser } from "@/server/context";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { docHashFor } from "@/server/study/mastery";
import { needFeature } from "@/server/study/plan";
import { addCards, MAX_CARDS_PER_ADD, statsFor } from "@/server/study/review";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await needFeature(ctx, u, "review_queue");
  await rateLimit(ctx.db, `review-add:${u.id}`, 30, 60);
  const b = await readJson(req);
  if (!Array.isArray(b.cards) || !b.cards.length || b.cards.length > MAX_CARDS_PER_ADD) {
    throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.", null, { field: "cards" });
  }
  const hash = await docHashFor(ctx, u.id, String(b.session_id ?? ""));
  if (!hash) throw new HttpError(404, "document_not_found", "That document couldn't be found. It may have been deleted.", "reupload");
  const out = await addCards(ctx, u.id, hash, b.cards as Record<string, unknown>[]);
  return { ok: true, ...out, stats: await statsFor(ctx, u) };
});
