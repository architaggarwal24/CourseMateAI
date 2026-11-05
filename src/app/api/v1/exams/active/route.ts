// The exam in progress (to resume after a refresh), or null.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { activeExam, gate } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  return { exam: await activeExam(ctx, u.id) };
});
