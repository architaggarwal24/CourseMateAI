// The avatar: equipped slots, owned items and the champion.
import { avatarView } from "@/server/game/avatar";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => avatarView(ctx, (await requirePlayer(req, ctx)).id));
