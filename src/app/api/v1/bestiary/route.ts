// The Bestiary: every creature's page (a silhouette while its tier is locked), your record against it, its mastery
// and bane, and which tiers are open.
import { requireUser } from "@/server/context";
import { bestiaryView } from "@/server/game/tome";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => bestiaryView(ctx, (await requireUser(req, ctx)).id));
