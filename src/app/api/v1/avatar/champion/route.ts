// The champion and its skin loadout. PUT chooses a champion, optionally with a loadout, in one save.
import { championState, chooseChampion } from "@/server/game/avatar";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => championState(ctx, (await requirePlayer(req, ctx)).id));

export const PUT = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `champion:${p.id}`, 60, 60);
  return chooseChampion(ctx, p.id, await readJson(req));
});
