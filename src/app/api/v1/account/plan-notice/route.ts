// "You've been upgraded": the window was shown, so it never shows again, on any device.
import { requireUser } from "@/server/context";
import { HttpError, readJson } from "@/server/http";
import { markPlanNoticeSeen, pendingPlanNotice } from "@/server/account/plan-notices";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** The notice to show now, or null. (GET /hud carries it too; this is the light way to ask again.) */
export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  return { plan_notice: await pendingPlanNotice(ctx.db, u.id) };
});

/** { id }: that notice (and any older one) has been shown. */
export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  const { id } = await readJson<{ id?: unknown }>(req);
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "invalid_id", "Which notice?", null, { field: "id" });
  await markPlanNoticeSeen(ctx.db, u.id, n);
  return { ok: true };
});
