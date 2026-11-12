// Start an upload: the browser has read the PDF (pages, fingerprint); this checks the plan and makes the row.
// Then PUT /documents/{id}/file and POST /documents/{id}/pages (src/server/study/documents.ts).
import { requireUser } from "@/server/context";
import { startUpload, type StartUpload } from "@/server/study/documents";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { searchDeps } from "@/server/search";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `upload:${u.id}`, 20, 60);
  const out = await startUpload(ctx, searchDeps(ctx.env), u, await readJson<StartUpload>(req));
  return Response.json(out, { status: out.reused ? 200 : 202, headers: { "cache-control": "no-store" } });
});
