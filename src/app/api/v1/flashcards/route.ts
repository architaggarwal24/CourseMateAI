// A deck of flashcards on a topic of the document (cached for the same request).
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { makeFlashcards } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `flashcards:${u.id}`, 20, 60);
  return makeFlashcards(ctx, u, await readJson(req));
});
