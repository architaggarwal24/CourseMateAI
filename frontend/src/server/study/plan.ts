// Plan checks the study tools share.
import type { CurrentUser, RequestContext } from "../context";
import { has, requireFeature, tierFor, type Feature } from "../plans";

export async function hasFeature(ctx: RequestContext, user: CurrentUser, f: Feature) {
  return has(await tierFor(ctx.db, user), f);
}

export async function needFeature(ctx: RequestContext, user: CurrentUser, f: Feature) {
  requireFeature(await tierFor(ctx.db, user), f);
}
