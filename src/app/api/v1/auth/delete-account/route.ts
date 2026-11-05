import { deleteAccount } from "@/server/account";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const DELETE = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `delete-account:${u.id}`, 5, 300);
  const body = await readJson<{ password?: string }>(req).catch(() => ({} as { password?: string }));
  const cleared = await deleteAccount(req, ctx, u, body.password);
  const headers = new Headers({ "cache-control": "no-store" });
  for (const c of cleared.getSetCookie()) headers.append("set-cookie", c);
  return Response.json({ ok: true }, { headers });
});
