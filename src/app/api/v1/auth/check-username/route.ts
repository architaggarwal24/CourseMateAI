import { checkUsername } from "@/server/auth/account";
import { currentUser } from "@/server/context";
import { rateLimit, clientIp } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  await rateLimit(ctx.db, `check-username:${clientIp(req)}`, 60, 60);
  const u = await currentUser(req, ctx);
  return checkUsername(ctx, new URL(req.url).searchParams.get("username") ?? "", u?.id);
});
