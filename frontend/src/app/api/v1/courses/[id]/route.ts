import { requireUser } from "@/server/context";
import { deleteCourse, getCourse, updateCourse } from "@/server/courses";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => getCourse(ctx, await requireUser(req, ctx), id));

/** Rename, describe, or set the course's documents (the full list, in order). */
export const PUT = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `courses:${u.id}`, 60, 60);
  return updateCourse(ctx, u, id, await readJson(req));
});

/** The course goes; its documents stay. */
export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `courses:${u.id}`, 30, 60);
  await deleteCourse(ctx, u, id);
  return { ok: true };
});
