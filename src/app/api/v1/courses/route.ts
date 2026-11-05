import { requireUser } from "@/server/context";
import { createCourse, listCourses } from "@/server/courses";
import { rateLimit, readJson } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => ({ courses: await listCourses(ctx, await requireUser(req, ctx)) }));

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `courses:${u.id}`, 30, 60);
  return idempotent(req, ctx.db, `courses:${u.id}`, async () => createCourse(ctx, u, await readJson(req)));
});
