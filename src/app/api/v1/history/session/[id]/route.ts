// One document's activity, oldest first: only the caller's own rows.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { sessionHistory } from "@/server/study/core";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => ({ history: await sessionHistory(ctx, (await requireUser(req, ctx)).id, id) }));
