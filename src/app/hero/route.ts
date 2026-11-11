import { legacyHeroUrl } from "@/lib/routes";

// The old Hero area (/hero?tab=<tab>): Quests, Arena and Bestiary are now pages of their own and everything else is a
// Champion tab. A real redirect (307), so old links and bookmarks land in the right place with their doc/topic/hunt
// parameters, with or without JavaScript. (The old /hero/<screen> paths redirect in next.config.ts.)
export function GET(request: Request): Response {
  const url = new URL(request.url);
  return Response.redirect(new URL(legacyHeroUrl(url.searchParams), url), 307);
}
