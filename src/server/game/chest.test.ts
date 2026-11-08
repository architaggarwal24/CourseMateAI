/** @vitest-environment node */
// The daily chest (Stage R3): once a day, coins (a streak adds up to double), often a potion, sometimes a skin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as chestRoute from "@/app/api/v1/chest/route";
import * as openRoute from "@/app/api/v1/chest/open/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { person } from "../test/flows";
import { baseCoins, openChest, streakOf } from "./chest";
import { localDate } from "./store";

describe("the streak", () => {
  it("counts days in a row, up to today (or yesterday while today's chest is closed)", () => {
    expect(streakOf([], "2026-11-08")).toBe(0);
    expect(streakOf(["2026-11-07", "2026-11-06"], "2026-11-08")).toBe(2);
    expect(streakOf(["2026-11-08", "2026-11-07"], "2026-11-08")).toBe(2);
    expect(streakOf(["2026-11-07", "2026-11-05"], "2026-11-08")).toBe(1);        // a missed day breaks it
    expect(streakOf(["2026-11-06"], "2026-11-08")).toBe(0);
  });
  it("coins grow with level", () => {
    expect(baseCoins(1, 0)).toBeLessThan(baseCoins(20, 0));
    expect(baseCoins(1, 1)).toBe(baseCoins(1, 0) + 20);
  });
});

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => { setEnvForTests(null); setMailerForTests(null); vi.unstubAllEnvs(); await p?.dispose(); });

const player = async (b: Browser) => {
  const req = b.request("/api/v1/chest");
  const ctx = await requestContext(req);
  const id = Number((await ctx.auth.api.getSession({ headers: req.headers }))!.user.id);
  return { ctx, p: { id, tz: null } };
};

describe("opening it", () => {
  it("once a day: coins, and the second try is refused", async () => {
    const b = await person(mail, "c@example.com", "chester");
    expect(await json(await chestRoute.GET(b.request("/api/v1/chest")))).toMatchObject({ available: true, streak: 0, bonus_pct: 0 });
    const r = await json(await openRoute.POST(b.request("/api/v1/chest/open", { body: {} })));
    expect(r).toMatchObject({ ok: true, streak: 1, bonus_pct: 0 });
    expect(r.coins).toBeGreaterThanOrEqual(30);
    expect(r.totals.coins).toBe(r.coins);
    const again = await openRoute.POST(b.request("/api/v1/chest/open", { body: {} }));
    expect(again.status).toBe(409);
    expect(await json(await chestRoute.GET(b.request("/api/v1/chest")))).toMatchObject({ available: false, streak: 1 });
  }, 60_000);

  it("a streak adds 10% a day; a lucky chest holds a potion and a skin", async () => {
    const b = await person(mail, "s@example.com", "streaker");
    const { ctx, p: pl } = await player(b);
    const today = localDate(null);
    const day = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    for (const n of [1, 2, 3]) {
      await p.env.DB.prepare("INSERT INTO reward_events (user_id, kind, xp, coins, source_id, idempotency_key, created_at) VALUES (?, 'daily_chest', 0, 0, ?, ?, ?)")
        .bind(pl.id, day(n), `old-${n}`, today).run();
    }
    expect(await json(await chestRoute.GET(b.request("/api/v1/chest")))).toMatchObject({ available: true, streak: 3, bonus_pct: 30 });
    const r = await openChest(ctx, pl, () => 0);                                 // every roll lucky
    expect(r).toMatchObject({ streak: 4, bonus_pct: 30, coins: Math.round(baseCoins(1, 0) * 1.3) });
    expect(r.items.map((i) => i.kind)).toEqual(["potion", "skin"]);
    const inv = await p.env.DB.prepare("SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?").bind(pl.id, r.items[0].id).first<{ quantity: number }>();
    expect(inv?.quantity).toBe(1);
    const owned = JSON.parse((await p.env.DB.prepare("SELECT owned_json FROM user_avatar WHERE user_id = ?").bind(pl.id).first<{ owned_json: string }>())!.owned_json);
    expect(owned).toContain(r.items[1].id);
  }, 60_000);
});
