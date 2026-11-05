import { requireUser } from "@/server/context";
import { deleteDocument, getDocumentOrCourse } from "@/server/documents";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";

export const dynamic = "force-dynamic";

/** One document's status (queued | reading | indexing | ready | failed), or a course seen as one document. */
export const GET = api<{ id: string }>(async (req, ctx, { id }) => getDocumentOrCourse(ctx, await requireUser(req, ctx), id));

/** Remove one of your documents (its PDF, chunks and search index; it leaves its courses). */
export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `delete-document:${u.id}`, 30, 60);
  await deleteDocument(ctx, searchDeps(ctx.env), u, id);
  return { success: true };
});
