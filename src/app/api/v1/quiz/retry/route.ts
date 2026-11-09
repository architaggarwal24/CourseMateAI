// "Retry the ones I missed": a new quiz from a finished quiz's wrong answers (no AI call).
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { retryQuiz } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `quiz-retry:${u.id}`, 30, 60);
  return retryQuiz(ctx, u, await readJson(req));
});
