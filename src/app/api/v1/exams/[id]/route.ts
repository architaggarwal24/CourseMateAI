// One exam: the answers and the result only once it is graded.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { gate, getExam } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  return getExam(ctx, u.id, id);
});
