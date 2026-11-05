// Flashcards made from the questions the user got wrong on this document, newest first. No AI call.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { reviewDeck } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const q = new URL(req.url).searchParams;
  return reviewDeck(ctx, await requireUser(req, ctx), q.get("session_id") ?? "", Number(q.get("limit") ?? 50));
});
