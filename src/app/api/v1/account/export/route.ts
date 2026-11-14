import { exportData } from "@/server/account/export";
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** Download a copy of your data (one JSON file). A few times an hour at most: it reads every table. */
export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `export:${u.id}`, 3, 3600);
  const data = await exportData(ctx, u);
  const day = String(data.exported_at).slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      "content-disposition": `attachment; filename="coursemateai-data-${day}.json"`,
    },
  });
});
