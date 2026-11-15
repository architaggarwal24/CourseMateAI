// Start buying a Mana pack (a one-time Razorpay order; the browser then opens Checkout). Paid plans only.
import { checkoutMana } from "@/server/account/mana";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `mana-checkout:${u.id}`, 10, 3600);
  return idempotent(req, ctx.db, `mana-checkout:${u.id}`, async () => {
    const b = await readJson(req);
    return checkoutMana(ctx, u, b.pack);
  });
});
