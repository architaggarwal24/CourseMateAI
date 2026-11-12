import { me } from "@/server/auth/account";
import { requireUser } from "@/server/context";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => me(ctx, await requireUser(req, ctx)));
