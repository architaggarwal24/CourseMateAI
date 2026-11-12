// One battle, after any overdue question has been settled.
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arena-api";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => A.getBattle(ctx, await requireUser(req, ctx), id));
