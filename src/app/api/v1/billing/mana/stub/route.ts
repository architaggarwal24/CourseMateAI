// The test payment provider's "pay" for a Mana pack (PAYMENTS_PROVIDER=stub only; a 404 otherwise).
import { stubCompleteMana } from "@/server/account/mana";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `mana-verify:${u.id}`, 20, 3600);
  const b = await readJson(req);
  return stubCompleteMana(ctx, u, b.order_id);
});
