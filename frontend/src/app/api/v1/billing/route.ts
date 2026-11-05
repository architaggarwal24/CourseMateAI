// Payments on? which provider and its public key, and the user's subscription.
import { status } from "@/server/billing";
import { requireUser } from "@/server/context";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => status(ctx, await requireUser(req, ctx)));
