import { me, updateProfile, type ProfileChange } from "@/server/auth/account";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `update-profile:${u.id}`, 10, 300);
  const result = await updateProfile(req, ctx, u, await readJson<ProfileChange>(req));
  const fresh = await requireUser(req, ctx).catch(() => null);
  return { ...result, user: fresh ? await me(ctx, fresh) : null };
});
