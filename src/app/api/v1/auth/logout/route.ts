import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const res = await ctx.auth.api.signOut({ headers: req.headers, asResponse: true });
  const headers = new Headers({ "cache-control": "no-store" });
  for (const c of res.headers.getSetCookie()) headers.append("set-cookie", c);
  return Response.json({ ok: true }, { headers });
});
