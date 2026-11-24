// One scanned page or photo of an upload, read by the AI and indexed (Files stage 4, server/study/ocr.ts).
import { requireUser } from "@/server/context";
import { ocrPage } from "@/server/study/ocr";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";

export const dynamic = "force-dynamic";

/** {page, mime, data (base64 JPEG/PNG/WebP), done}: the page's text is written out by a model that can see, then indexed. */
export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `upload-ocr:${u.id}`, 60, 60);
  const deps = searchDeps(ctx.env);
  if (!deps) throw new HttpError(503, "search_unavailable", "Search isn't set up on this server yet (Workers AI and Vectorize).", "retry");
  return ocrPage(ctx, deps, u, id, await readJson(req));
});
