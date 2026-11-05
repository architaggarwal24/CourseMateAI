// A quiz on a topic of the document: the questions without their answers (graded one by one on /quiz/answer).
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { createQuiz } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `quiz:${u.id}`, 20, 60);
  return createQuiz(ctx, u, await readJson(req));
});
