import { inviteView } from "@/server/account/admin";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { createInvite, listInvites } from "@/server/account/invites";
import { isTier } from "@/server/account/plans";
import { HttpError } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, ctx);
  return { invites: (await listInvites(ctx.db)).map(inviteView) };
});

/** { tier, days?, max_uses?, code?, note?, valid_days? } */
export const POST = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  return idempotent(req, ctx.db, `admin-invite:${actor.id}`, async () => {
    const b = await readJson<Record<string, unknown>>(req);
    if (!isTier(b.tier)) throw new HttpError(400, "invalid_tier", "Choose a plan for the code.", null, { field: "tier" });
    const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    for (const [k, v] of [["days", b.days], ["max_uses", b.max_uses], ["valid_days", b.valid_days]] as const) {
      const n = num(v);
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100_000)) throw new HttpError(400, "invalid_number", "Use a whole number of 1 or more.", null, { field: k });
    }
    const row = await createInvite(ctx.db, {
      tier: b.tier, days: num(b.days), maxUses: num(b.max_uses) ?? 1, code: typeof b.code === "string" ? b.code : undefined,
      note: typeof b.note === "string" ? b.note : undefined, validDays: num(b.valid_days), createdBy: actor.id,
    });
    return inviteView(row);
  });
});
