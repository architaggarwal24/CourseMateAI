import { authConfig } from "@/server/auth/account";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (_req, ctx) => authConfig(ctx));
