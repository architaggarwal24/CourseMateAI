// Score a quiz once every question is answered. Finishing again returns the same result.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { finishQuiz } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `quiz-finish:${u.id}`, 30, 60);
  return finishQuiz(ctx, u, await readJson(req));
});
