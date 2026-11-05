// Grade one quiz question on the server. The first answer is final.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { answerQuiz } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `quiz-answer:${u.id}`, 120, 60);
  return answerQuiz(ctx, u, await readJson(req));
});
