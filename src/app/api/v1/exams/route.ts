// GET: past exams. POST: write a new exam from the document and start its clock.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { createExam, gate, history } from "@/server/study/exams";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  return { exams: await history(ctx, u.id, Number(new URL(req.url).searchParams.get("limit") ?? 20)) };
});

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  await rateLimit(ctx.db, `exam-create:${u.id}`, 6, 60);
  return createExam(ctx, u, await readJson(req));
});
