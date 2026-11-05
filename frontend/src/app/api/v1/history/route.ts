// The user's activity (questions, quizzes, notes, flashcards), newest first. Arena activity is never listed.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { userHistory } from "@/server/study/core";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  const q = new URL(req.url).searchParams;
  return { history: await userHistory(ctx, u.id, q.get("mode"), Number(q.get("limit") ?? 100)) };
});
