// How many cards are due (the nav badge). Answered on every plan: `locked` says whether reviewing is on.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import { statsFor } from "@/server/study/review";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => statsFor(ctx, await requireUser(req, ctx)));
