// The concept map of a document or course. GET: as it is now (never starts work). POST: makes the map of every
// document in it that has none yet (one AI pass each, reused at no cost), answering when done; meanwhile GET
// shows its progress line.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { build, gate, view } from "@/server/study/concept-map";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  return view(ctx, u, new URL(req.url).searchParams.get("session_id") ?? "");
});

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await gate(ctx, u);
  await rateLimit(ctx.db, `concept-map:${u.id}`, 10, 60);
  const body = await readJson(req);
  return build(ctx, u, String(body.session_id ?? ""));
});
