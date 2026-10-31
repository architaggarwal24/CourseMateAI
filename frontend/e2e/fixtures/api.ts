// Answers every /api/v1 call the app makes, so the e2e run needs no backend. The JSON files in this folder are
// real responses captured from the backend (shapes stay honest); `signedIn: false` plays a visitor who is not logged in.
import type { Page, Route } from "@playwright/test";
import me from "./me.json";
import hud from "./hud.json";
import profile from "./profile.json";
import dailyQuests from "./daily-quests.json";
import shop from "./shop.json";
import avatar from "./avatar.json";
import achievements from "./achievements.json";
import providers from "./providers.json";
import apiKey from "./api-key.json";

export const DOCUMENT = {
  id: "doc-1", filename: "Cell Biology.pdf", file_hash: "abc123", status: "ready", error: null, chunks: 42,
  embedding_model: "bge-small", created_at: "2026-10-14T09:00:00Z", last_used_at: "2026-10-15T09:00:00Z",
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export interface MockOptions {
  signedIn?: boolean;
  /** Level 5+ with coins, so the shop, inventory and the arena have something to show. */
  advanced?: boolean;
  documents?: typeof DOCUMENT[];
}

/** Installs the mock. Returns the list of GET paths nothing answered, so a test can say a new call needs a fixture. */
export async function mockApi(page: Page, { signedIn = true, advanced = true, documents = [DOCUMENT] }: MockOptions = {}) {
  const unanswered: string[] = [];
  const progress = { ...hud.progress, current_level: advanced ? 7 : 1, total_xp: advanced ? 1450 : 0, coins: advanced ? 320 : 0, xp_into_level: advanced ? 150 : 0, xp_to_next: 400, streak_days: advanced ? 4 : 0 };
  const shopData = { ...shop, shop_unlocked: advanced, level: progress.current_level, coins: progress.coins };

  // Nothing outside the app is fetched (web fonts, images): the run is the same offline.
  await page.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (route) => route.abort());
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();

    if (path === "/auth/me") return signedIn ? json(route, 200, me) : json(route, 401, { error: { code: "unauthenticated", message: "Please log in to continue.", action: "relogin", details: null } });
    if (path === "/hud") return json(route, 200, { ...hud, progress, shop: shopData, guest_mode: !signedIn });
    if (path === "/profile") return json(route, 200, { ...profile, progress });
    if (path === "/daily-quests") return json(route, 200, dailyQuests);
    if (path === "/shop") return json(route, 200, shopData);
    if (path === "/avatar") return json(route, 200, avatar);
    if (path === "/achievements") return json(route, 200, achievements);
    if (path === "/providers") return json(route, 200, providers);
    if (path === "/auth/api-key") return json(route, 200, apiKey);
    if (path === "/auth/check-username") return json(route, 200, { available: true });
    if (path === "/documents") return json(route, 200, { documents: signedIn ? documents : [] });
    const doc = path.match(/^\/documents\/([^/]+)$/);
    if (doc) {
      const found = documents.find((d) => d.id === doc[1]);
      return found ? json(route, 200, found) : json(route, 404, { error: { code: "document_not_found", message: "Document not found.", action: "reupload", details: null } });
    }
    if (path === "/arena/leaderboard") return json(route, 200, { ok: true, entries: [], total: 0 });
    if (path === "/arena/weak-concepts") return json(route, 200, { concepts: [], missed_total: 0, nemesis_ready: false });
    if (path === "/arena/runs/active") return json(route, 200, { ok: true, run: null });
    if (path === "/study/review-deck") return json(route, 200, { cards: [], total: 0 });
    if (path === "/arena/battles/active") return json(route, 200, { ok: true, battle: null });
    if (path === "/history") return json(route, 200, { history: [] });

    if (method === "GET") unanswered.push(path);
    return json(route, 404, { error: { code: "not_found", message: "Not found.", action: null, details: null } });
  });
  return { unanswered };
}
