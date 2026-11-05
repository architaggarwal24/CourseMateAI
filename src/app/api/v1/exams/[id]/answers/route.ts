// Save, change or clear an answer, or flag a question. No feedback until the exam is graded.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { answerExam, gate } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  await rateLimit(ctx.db, `exam-answer:${u.id}`, 240, 60);
  return answerExam(ctx, u, id, await readJson(req));
});
