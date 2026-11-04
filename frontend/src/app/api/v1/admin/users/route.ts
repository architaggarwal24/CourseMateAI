import { listUsers } from "@/server/admin";
import { requireAdmin } from "@/server/context";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, ctx);
  const q = new URL(req.url).searchParams;
  return listUsers(ctx, { q: q.get("q") ?? "", offset: Number(q.get("offset") ?? 0) || 0, limit: Number(q.get("limit") ?? 25) || 25 });
});
