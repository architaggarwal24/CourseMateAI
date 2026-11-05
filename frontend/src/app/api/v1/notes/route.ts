// Study notes on a topic of the document (cached for the same request).
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { makeNotes } from "@/server/study/tools";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `notes:${u.id}`, 20, 60);
  return makeNotes(ctx, u, await readJson(req));
});
