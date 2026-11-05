// Grade the exam (once). Submitting again returns the same result.
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { gate, submitExam } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  await rateLimit(ctx.db, `exam-submit:${u.id}`, 30, 60);
  return submitExam(ctx, u, id);
});
