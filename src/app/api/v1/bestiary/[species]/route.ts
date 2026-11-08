// One Bestiary page, with the concepts this creature has tested you on.
import { requireUser } from "@/server/context";
import { bestiaryPage } from "@/server/game/tome";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api<{ species: string }>(async (req, ctx, { species }) => bestiaryPage(ctx, (await requireUser(req, ctx)).id, species));
