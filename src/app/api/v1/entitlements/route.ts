import { requireUser } from "@/server/context";
import { entitlementsSummary } from "@/server/account/plans";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  return entitlementsSummary(ctx.db, { id: u.id, owner: u.owner });
});
