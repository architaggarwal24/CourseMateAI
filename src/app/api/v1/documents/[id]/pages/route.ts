import { requireUser } from "@/server/context";
import { addPages } from "@/server/study/documents";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";

export const dynamic = "force-dynamic";

/** {pages: [{page, text}], done}: these pages are chunked, embedded and stored; `done` makes the document ready. */
export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `upload-pages:${u.id}`, 600, 60);
  const deps = searchDeps(ctx.env);
  if (!deps) throw new HttpError(503, "search_unavailable", "Search isn't set up on this server yet (Workers AI and Vectorize).", "retry");
  return addPages(ctx, deps, u, id, await readJson(req));
});
