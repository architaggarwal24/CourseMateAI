// Your hero: level, look, build, skill tree, and everything it can unlock (game/build.ts).
import { heroView } from "@/server/game/build";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => heroView(ctx, (await requirePlayer(req, ctx)).id));
