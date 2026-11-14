import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";
import { deleteForever } from "@/server/study/trash";

export const dynamic = "force-dynamic";

/** Delete one item in your Trash for good (a PDF's file and search index too). */
export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `trash-delete:${u.id}`, 30, 60);
  return deleteForever(ctx, searchDeps(ctx.env), u, id);
});
