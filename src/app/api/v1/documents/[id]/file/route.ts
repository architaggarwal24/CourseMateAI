import { requireUser } from "@/server/context";
import { pdfFile, putFile } from "@/server/documents";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** The original PDF, for the side-by-side page viewer (byte ranges supported). */
export const GET = api<{ id: string }>(async (req, ctx, { id }) => pdfFile(ctx, await requireUser(req, ctx), id, req));

/** The PDF itself, right after POST /upload: kept in R2, its fingerprint checked. */
export const PUT = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `upload-file:${u.id}`, 20, 60);
  return putFile(ctx, u, id, req);
});
