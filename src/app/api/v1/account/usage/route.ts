import { accountUsage } from "@/server/account-usage";
import { requireUser } from "@/server/context";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => accountUsage(ctx, await requireUser(req, ctx)));
