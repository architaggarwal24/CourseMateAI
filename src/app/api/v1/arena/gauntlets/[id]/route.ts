// One Boss Rush / Survival.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => A.getGauntlet(ctx, await requireUser(req, ctx), id));
