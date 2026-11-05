// The signed-in player for game routes: their id and time zone (the browser's x-timezone keeps it current).
import { currentUser, requireUser, type CurrentUser, type RequestContext } from "../context";
import { syncTimezone, type Player } from "./store";

export async function playerOf(req: Request, ctx: RequestContext, u: CurrentUser): Promise<Player> {
  return { id: u.id, tz: await syncTimezone(ctx, u.id, u.row.timezone ?? null, req) };
}

export async function requirePlayer(req: Request, ctx: RequestContext): Promise<Player> {
  return playerOf(req, ctx, await requireUser(req, ctx));
}

export async function optionalPlayer(req: Request, ctx: RequestContext): Promise<Player | null> {
  const u = await currentUser(req, ctx);
  return u ? playerOf(req, ctx, u) : null;
}
