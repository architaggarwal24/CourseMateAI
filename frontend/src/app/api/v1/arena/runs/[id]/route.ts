// One run.
import { requireUser } from "@/server/context";
import { getRun, state } from "@/server/game/expedition";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => ({ ok: true, run: await state(ctx, await getRun(ctx, (await requireUser(req, ctx)).id, id)) }));
