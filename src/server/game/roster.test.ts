/** @vitest-environment node */
// Champion unlocks and signature weapons (Stage C1): who joins when, the ceremony's reward paid once, picks made
// before the locks kept, and the small perk a champion gets from their own mastery weapon.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as champion from "@/app/api/v1/avatar/champion/route";
import * as celebrateRoute from "@/app/api/v1/avatar/champion/celebrate/route";
import * as heroRoute from "@/app/api/v1/hero/route";
import * as heroLook from "@/app/api/v1/hero/look/route";
import * as heroBuild from "@/app/api/v1/hero/build/route";
import * as heroTree from "@/app/api/v1/hero/tree/route";
import * as heroBuy from "@/app/api/v1/hero/buy/route";
import { STARTER_LOOKS } from "@/lib/game/appearance";
import * as build from "./build";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as battleOne from "@/app/api/v1/arena/battles/[id]/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import {
  KitTurn, SIGNATURE_RIPOSTE, SIGNATURES, charge, hasSignature, initKit, kitHud, prepare, settle,
} from "./kits";
import { championForTier, earned, unlockProgress, UNLOCK_REWARD } from "./roster";
import * as kits from "./kits";
import * as mastery from "./mastery";
import { finishedTiers, recordFight } from "./tome";

const rec = (wins: number) => ({ wins, flawlessWins: 0, nightmareWins: 0, baneFound: false });
const recs = (m: Record<string, number>) => new Map(Object.entries(m).map(([s, w]) => [s, rec(w)])) as never;
const TIER_I = { minotaur: 1, cyclops: 1, oni: 1, kitsune: 1 };

// ── rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe("who joins when", () => {
  it("Kaien is free; each finished Bestiary tier brings the next champion; Thorne comes at level 25", () => {
    expect([...earned(recs({}), 1)]).toEqual(["kaien"]);
    expect([...earned(recs({ minotaur: 1, cyclops: 1, oni: 1 }), 1)]).toEqual(["kaien"]);        // 3 of 4 is not finished
    expect([...earned(recs(TIER_I), 1)]).toEqual(["kaien", "asha"]);
    expect([...earned(recs({ ...TIER_I, naga: 1, rakshasa: 1, sphinx: 1, fenrir: 1 }), 1)]).toEqual(["kaien", "asha", "brak"]);
    expect(earned(recs({}), 25).has("thorne")).toBe(true);
    expect(earned(recs({}), 24).has("thorne")).toBe(false);
    expect([1, 2, 3, 4].map(championForTier)).toEqual(["asha", "brak", "mira", "vex"]);
  });

  it("tier III is finished without the Nemesis (no topic calls it)", () => {
    expect(finishedTiers(recs({ hydra: 1, kraken: 1 }))).toEqual([3]);
  });

  it("says how far along each lock is", () => {
    expect(unlockProgress("asha", recs({ minotaur: 2, oni: 1 }), 1)).toMatchObject({ have: 2, need: 4, how: expect.stringContaining("tier I") });
    expect(unlockProgress("thorne", recs({}), 9)).toEqual({ how: "Reach level 25", have: 9, need: 25 });
    expect(unlockProgress("mira", recs({}), 1)).toMatchObject({ have: 0, need: 2 });
  });
});

describe("signature weapons", () => {
  const turn = (champ: string, sig: boolean, move: string, o: Partial<{ correct: boolean; damaging: boolean; rng: () => number }> = {}) => {
    const s = initKit(champ, sig);
    return new KitTurn(s.champion, "medium", s, move, o.correct ?? true, 0, o.damaging ?? true, o.rng ?? (() => 0.99), 1);
  };

  it("only the champion's own mastery weapon counts", () => {
    expect(hasSignature("kaien", { weapon: "mastery_kaien_weapon" })).toBe(true);
    expect(hasSignature("kaien", { weapon: "mastery_asha_weapon" })).toBe(false);
    expect(hasSignature("kaien", {})).toBe(false);
  });

  it("each perk is small and only with the weapon", () => {
    const k = turn("kaien", true, "guard"); prepare(k);
    expect(k.riposte).toBe(SIGNATURE_RIPOSTE);
    const k0 = turn("kaien", false, "guard"); prepare(k0);
    expect(k0.riposte).toBe(0.5);
    const a = turn("asha", true, "jab"); prepare(a);
    expect(a.jabMult).toBe(0.9);
    const b = turn("brak", true, "heavy"); prepare(b);
    expect(b.mult).toBeCloseTo(1.1);
    const b0 = turn("brak", true, "strike"); prepare(b0);
    expect(b0.mult).toBe(1);
    const m = initKit("mira", true);
    expect(charge(m, true, 0)).toBe(30);
    expect(charge(initKit("mira", false), true, 0)).toBe(25);
    const v = turn("vex", true, "strike", { rng: () => 0.22 }); prepare(v);            // 20% + 5% on medium
    expect(v.dodge).toBe(true);
    const v0 = turn("vex", false, "strike", { rng: () => 0.22 }); prepare(v0);
    expect(v0.dodge).toBe(false);
  });

  it("Thorne's Oathshield blocks the first blow of the fight, once", () => {
    const s = initKit("thorne", true);
    const first = new KitTurn("thorne", "medium", s, "strike", false, 0, true); prepare(first); settle(first);
    expect(first.block).toBe(true);
    expect(first.events.map((e) => e.type)).toContain("fortress");
    const second = new KitTurn("thorne", "medium", s, "strike", false, 0, true); prepare(second);
    expect(second.block).toBe(false);
  });

  it("the battle HUD names the perk and the finisher", () => {
    expect(kitHud(initKit("vex", true)).signature).toEqual({ name: SIGNATURES.vex.perk_name, text: SIGNATURES.vex.perk_text, finisher: "Eclipse" });
    expect(kitHud(initKit("vex", false)).signature).toBeNull();
  });
});

// ── through the routes ────────────────────────────────────────────────────────────────────────────────────────
let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let n = 0;
const BIO = [{ page: 1, text: "Graph algorithms. Breadth first search visits neighbours level by level." }];
function script(m: ChatMessage[]) {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("battle game")) {
    return JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => {
      n++;
      return { question: `Battle question ${n}?`, options: ["BFS", "DFS", "DP", "Sort"], correct_answer: "BFS", explanation: "Levels.", concept: `concept ${n % 3}`, difficulty: ["easy", "medium", "hard"][i % 3] };
    }) });
  }
  return JSON.stringify({ title: "Lord of Mazes" });
}

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  trackBackgroundForTests(true);
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV })) vi.stubEnv(k, v as string);
  setLlmFactoryForTests(fakeLlms({ "*": script }).factory);
}, 60_000);
afterEach(async () => {
  await settleBackground();
  trackBackgroundForTests(false);
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const db = () => p.env.DB;
const state = async (b: Browser) => json(await champion.GET(b.request("/api/v1/avatar/champion")));
const choose = (b: Browser, id: string) => champion.PUT(b.request("/api/v1/avatar/champion", { method: "PUT", body: { champion_id: id } }));
const celebrate = (b: Browser, id: string) => celebrateRoute.POST(b.request("/api/v1/avatar/champion/celebrate", { body: { champion_id: id } }));
const uid = async (b: Browser) => {
  const req = b.request("/api/v1/avatar/champion");
  const ctx = await requestContext(req);
  const s = await ctx.auth.api.getSession({ headers: req.headers });
  return Number(s!.user.id);
};
const beat = async (b: Browser, species: string[]) => {
  const ctx = await requestContext(b.request("/api/v1/avatar/champion"));
  const me = await uid(b);
  let last;
  for (const s of species) last = await recordFight(ctx, me, { species: s, won: true, flawless: false, nightmare: false, seconds: 60, accuracy: 80 });
  return last!;
};
const coins = async (b: Browser) => Number((await db().prepare("SELECT coins FROM user_progress WHERE user_id = ?").bind(await uid(b)).first<{ coins: number }>())!.coins);

describe("champion weaknesses", () => {
  const turn = (champ: string, move: string, correct: boolean) => {
    const t = new KitTurn(champ as never, "medium", initKit(champ), move, correct, 0, true, () => 0.99, 1);
    prepare(t);
    return t;
  };
  it("each champion has one, sized against its passive", () => {
    expect(turn("kaien", "heavy", false).selfDamage).toBe(1);                 // Glass Edge
    expect(turn("kaien", "heavy", true).selfDamage).toBe(0);
    expect(kits.heavyCostFor("asha", 2)).toBe(3);                             // Long Haft
    expect(kits.heavyCostFor("asha", 1)).toBe(2);                             // with the whetstone relic
    expect(kits.heavyCostFor("kaien", 2)).toBe(2);
    expect(turn("brak", "guard", true).guardHalves).toBe(true);               // Reckless
    expect(kits.heartsFor("mira", 10)).toBe(8);                               // Frail
    expect(kits.heartsFor("thorne", 10)).toBe(10);
    expect(turn("vex", "heavy", true).heavyMult).toBe(1.5);                   // Light Blades
    for (const k of Object.values(kits.KITS)) expect(k.weakness_name && k.weakness_text).toBeTruthy();
    expect(kits.kitHud(initKit("mira")).weakness).toEqual({ name: "Frail", text: "You fight with 2 fewer hearts." });
  });
});

describe("your hero's kit in a fight", () => {
  const hk = (o: Partial<Parameters<typeof kits.initHeroKit>[0]> = {}) =>
    kits.initHeroKit({ name: "Me", passive: "second_wind", ultimate: "rally", style: "apprentice", perks: [], weaknesses: [], tree: {}, ...o });
  const turn = (s: kits.KitState, move: string, correct: boolean, o: { hp?: number; ratio?: number; rng?: number } = {}) => {
    const t = new KitTurn("hero", "medium", s, move, correct, 3, true, () => o.rng ?? 0.99, 1);
    t.hp = o.hp ?? 10; t.bossRatio = o.ratio ?? 1;
    prepare(t);
    return t;
  };
  it("the style brings its bonus and its weakness", () => {
    expect(hk({ style: "katana" }).weaknesses).toEqual(["glass_edge"]);
    expect(turn(hk({ style: "katana" }), "strike", true).strikeMult).toBeCloseTo(1.1);
    expect(turn(hk({ style: "katana" }), "heavy", false).selfDamage).toBe(1);
    expect(turn(hk({ style: "greatsword" }), "heavy", true).heavyMult).toBe(2.0);
    expect(turn(hk({ style: "daggers" }), "strike", true, { rng: 0.05 }).dodge).toBe(true);
    expect(kits.heartsFor("hero", 10, hk({ style: "staff" }))).toBe(8);
    expect(kits.startFocusFor(hk({ style: "staff" }))).toBe(1);
    expect(kits.timeBonusFor(hk({ style: "chain_whip" }), "jab")).toBe(5);
    expect(kits.heavyCostFor("hero", 2, hk({ style: "war_fan" }))).toBe(3);
    const ap = turn(hk(), "guard", true); settle(ap);
    expect(ap.focusDelta).toBe(1);                                                 // Apprentice: a right Guard +1 Focus
  });
  it("the tree, perks and extra weaknesses change the numbers", () => {
    const s = hk({ tree: { o1: 2, o2: 1, d1: 2, d2: 1, m4: 1, m5: 1 }, perks: ["quick_hands", "combo_fuel"], weaknesses: ["short_fuse", "glass_body"] });
    expect(turn(s, "strike", true).strikeMult).toBeCloseTo(1.1);
    expect(turn(s, "strike", true).mult).toBe(1.25);                               // Opening
    expect(turn(s, "guard", true).comboBonus).toBe(1);                             // Parry
    expect(kits.heartsFor("hero", 10, s)).toBe(9);                                 // +2 Tough, -3 Glass Body
    expect(kits.focusCapFor(s, 5)).toBe(6);
    expect(kits.timeBonusFor(s, "strike")).toBe(2 + 3 - 3);
    expect(kits.comboCap(s)).toBe(6);
    expect(kits.chargeRate(hk({ weaknesses: ["slow_charge"] }))).toBeCloseTo(0.9 * 0.75);
  });
  it("passives and ultimates work by ability", () => {
    const sw = hk();
    expect(kits.afterBlow(sw, 1, 10)).toBe(2);
    expect(kits.afterBlow(sw, 1, 10)).toBe(0);                                     // once a fight
    const ts = hk({ passive: "thick_skin" });
    const miss = turn(ts, "strike", false); settle(miss);
    expect(miss.forgive).toBe(true);
    expect(turn(ts, "strike", false).forgive).toBe(false);
    const rp = turn(hk({ passive: "riposte" }), "guard", true);
    expect(rp.riposte).toBe(0.5);
    const od = hk({ ultimate: "overdrive" }); od.meter = kits.METER_MAX;
    expect(kits.activate(od).name).toBe("Overdrive");
    expect(turn(od, "strike", true).mult).toBeCloseTo(1.6);
    const ral = hk(); ral.meter = kits.METER_MAX;
    expect(kits.activate(ral)).toMatchObject({ name: "Rally", hearts: 2, focus: 1 });
    expect(kits.kitHud(hk({ style: "fists" }))).toMatchObject({ champion: "hero", style: { id: "fists" }, hero: { name: "Me" }, passive: { name: "Second Wind" } });
  });
});

describe("mastery", () => {
  const f = (o: Partial<mastery.FightSummary> = {}): mastery.FightSummary => ({ won: true, correct: 8, difficulty: "medium", flawless: false, seconds: 200, heartsLeft: 5, stats: {}, tiersFinished: 0, ...o });

  it("is 70% XP and 30% challenges", () => {
    expect(mastery.masteryOf("kaien", 0, []).pct).toBe(0);
    expect(mastery.masteryOf("kaien", 1350, []).pct).toBe(35);
    expect(mastery.masteryOf("kaien", 99_999, [])).toMatchObject({ pct: 70, passive_learnable: true, complete: false });
    const done = mastery.CHALLENGES.kaien.map((c) => ({ userId: 1, championId: "kaien", challengeId: c.id, progress: c.target, doneAt: "x", updatedAt: "x" }));
    expect(mastery.masteryOf("kaien", 2700, done)).toMatchObject({ pct: 100, complete: true });
    expect(mastery.masteryOf("kaien", 0, done.slice(0, 2)).challenges.filter((c) => c.done)).toHaveLength(2);
    for (const list of Object.values(mastery.CHALLENGES)) expect(list).toHaveLength(6);
  });

  it("fights move the champion's challenges; streaks reset on a loss; studying counts for the equipped champion", async () => {
    const b = await person(mail, "m@example.com", "mastery");
    await state(b);
    const ctx = await requestContext(b.request("/api/v1/avatar/champion"));
    const me = await uid(b);
    expect(await mastery.recordFight(ctx, me, "kaien", f({ stats: { riposte: 4 } }))).toEqual([]);
    await mastery.recordFight(ctx, me, "kaien", f({ won: true, difficulty: "hard", flawless: true, stats: { riposte: 11 } }));
    let k = (await state(b)).progress.kaien;
    expect(k.challenges.find((c: { id: string }) => c.id === "riposte15")).toMatchObject({ progress: 15, done: true });
    expect(k.challenges.find((c: { id: string }) => c.id === "flawless")).toMatchObject({ done: true });
    expect(k.challenges.find((c: { id: string }) => c.id === "win10")).toMatchObject({ progress: 2, done: false });
    expect(k.mastery_pct).toBeGreaterThanOrEqual(10);
    expect(k.kit.weakness.name).toBe("Glass Edge");

    // Brak's 3-in-a-row resets on a loss, and is kept once done
    for (const won of [true, true, false, true, true, true, false]) await mastery.recordFight(ctx, me, "brak", f({ won }));
    expect((await state(b)).progress.brak.challenges.find((c: { id: string }) => c.id === "row3")).toMatchObject({ done: true });

    // reviews count for the equipped champion (Kaien), not Thorne
    await mastery.recordStudy(ctx, me, "review_card", 5);
    k = (await state(b)).progress;
    expect(k.thorne.challenges.find((c: { id: string }) => c.id === "review300").progress).toBe(0);
    expect(await mastery.recordFight(ctx, me, "nobody", f())).toEqual([]);
  }, 60_000);
});

describe("your hero", () => {
  const hero = async (b: Browser) => json(await heroRoute.GET(b.request("/api/v1/hero")));
  const put = (route: { PUT: (r: Request) => Promise<Response> }, path: string, b: Browser, body: unknown) => route.PUT(b.request(path, { method: "PUT", body }));
  const addXp = async (b: Browser, xp: number) => build.addXp(await requestContext(b.request("/api/v1/hero")), await uid(b), xp);

  it("levels on 80 + 40 x level XP, one skill point a level, 6 + level/3 loadout points", () => {
    expect(build.heroLevelFor(0)).toEqual({ level: 1, into: 0, next: 120 });
    expect(build.heroLevelFor(120).level).toBe(2);
    expect(build.heroLevelFor(10 ** 7).level).toBe(30);
    expect([build.skillPoints(30), build.loadoutBudget(1), build.loadoutBudget(30)]).toEqual([29, 6, 16]);
    expect(build.buildCost(build.STARTER_BUILD)).toBe(4);
  });

  it("the tree opens top-down, tier 6 needs 5 points in its branch, and respec is free", () => {
    expect(build.treeProblem({ o1: 1 }, 2)).toBeNull();
    expect(build.treeProblem({ o2: 1 }, 5)).toMatch(/Sharpened first/);
    expect(build.treeProblem({ o1: 2 }, 2)).toMatch(/2 skill points; you have 1/);
    expect(build.treeProblem({ o1: 3 }, 30)).toMatch(/0 to 2/);
    expect(build.treeProblem({ o1: 1, o2: 1, o3: 1, o4: 1, o6: 1 }, 30)).toMatch(/needs a point in Finisher/);
    expect(build.treeProblem({ o1: 1, o2: 1, o3: 1, o4: 1, o5: 1, o6: 1 }, 30)).toBeNull();
    expect(build.treeProblem({ o1: 2, o2: 1, o3: 1, o4: 1, o5: 0, o6: 1 }, 30)).toMatch(/needs a point in Finisher/);
    expect(build.treeProblem({ x9: 1 } as never, 30)).toMatch(/no skill/);
  });

  it("starts with the Apprentice Blade, Second Wind and Rally; can be picked; looks are its own; champion looks need 100%", async () => {
    const b = await person(mail, "h@example.com", "herohero");
    const h = await hero(b);
    expect(h).toMatchObject({ level: 1, skill_points: 0, loadout_budget: 6, loadout_cost: 4, build: build.STARTER_BUILD, look: null });
    expect(h.catalog.styles.find((s: { id: string }) => s.id === "katana")).toMatchObject({ owned: false, how: "Kaien at 100% mastery" });
    expect(h.catalog.styles.find((s: { id: string }) => s.id === "chain_whip").for_sale).toMatchObject({ coins: 1200, level: 12, can_buy: false });
    expect((await choose(b, "hero")).status).toBe(200);
    expect((await state(b)).champion_id).toBe("hero");

    const mine = { ...STARTER_LOOKS.mira, hair: "spiky" };
    expect((await json(await put(heroLook, "/api/v1/hero/look", b, { look: mine }))).look).toEqual(mine);
    expect((await json(await put(heroLook, "/api/v1/hero/look", b, { look: STARTER_LOOKS.mira }))).error).toMatchObject({ code: "look_locked" });
    expect((await put(heroLook, "/api/v1/hero/look", b, { look: { ...mine, main: "#fff" } })).status).toBe(422);
    expect((await json(await put(heroLook, "/api/v1/hero/look", b, { look: null }))).look).toBeNull();
  }, 60_000);

  it("the loadout only takes what is owned and fits the points; the tree unlocks abilities; shop items cost coins", async () => {
    const b = await person(mail, "l@example.com", "loadouts");
    await hero(b);
    const save = (bd: unknown) => put(heroBuild, "/api/v1/hero/build", b, { build: bd });
    expect((await json(await save({ ...build.STARTER_BUILD, style: "katana" }))).error).toMatchObject({ code: "not_owned" });
    expect((await json(await save({ ...build.STARTER_BUILD, passive: "thick_skin" }))).error).toMatchObject({ code: "not_owned" });
    expect((await save({ ...build.STARTER_BUILD, style: "nope" })).status).toBe(422);
    // an extra weakness gives points back
    expect((await json(await save({ ...build.STARTER_BUILD, weaknesses: ["glass_body"] }))).loadout_cost).toBe(1);

    await addXp(b, 2000);                                     // level 7ish: a few skill points
    const h = await hero(b);
    expect(h.skill_points).toBeGreaterThanOrEqual(3);
    const t = await json(await put(heroTree, "/api/v1/hero/tree", b, { tree: { d1: 1, d2: 1, d3: 1 } }));
    expect(t.catalog.passives.find((p: { id: string }) => p.id === "thick_skin").owned).toBe(true);
    expect((await save({ ...build.STARTER_BUILD, passive: "thick_skin" })).status).toBe(200);
    // respec: dropping the node drops the passive from the loadout too
    const r = await json(await put(heroTree, "/api/v1/hero/tree", b, { tree: { o1: 1 } }));
    expect(r.build.passive).toBe("second_wind");
    expect((await put(heroTree, "/api/v1/hero/tree", b, { tree: { o2: 1 } })).status).toBe(422);

    // the shop: level-gated, paid in coins, once
    const buy = (item: string) => heroBuy.POST(b.request("/api/v1/hero/buy", { body: { item } }));
    expect((await json(await buy("style:katana"))).error).toMatchObject({ code: "not_for_sale" });
    expect((await json(await buy("perk:lucky_coin"))).error).toMatchObject({ code: "level_locked" });
    await db().prepare("UPDATE user_progress SET current_level = 12, coins = 2000 WHERE user_id = ?").bind(await uid(b)).run();
    const bought = await json(await buy("style:chain_whip"));
    expect(bought.catalog.styles.find((s: { id: string }) => s.id === "chain_whip").owned).toBe(true);
    expect(await coins(b)).toBe(800);
    expect((await buy("style:chain_whip")).status).toBe(409);
    await db().prepare("UPDATE user_progress SET current_level = 12 WHERE user_id = ?").bind(await uid(b)).run();   // the ledger re-derives the level from XP
    const qh = await json(await buy("perk:quick_hands"));
    expect(qh.error).toBeUndefined();
    expect(qh.catalog.perks.find((p: { id: string }) => p.id === "quick_hands").owned).toBe(true);
    await db().prepare("UPDATE user_progress SET current_level = 12 WHERE user_id = ?").bind(await uid(b)).run();
    expect((await json(await buy("perk:lucky_coin"))).error).toMatchObject({ code: "not_enough_coins" });
  }, 60_000);

  it("a mastered champion teaches its style, ultimate and look; 50% teaches its passive", async () => {
    const b = await person(mail, "t@example.com", "teacher");
    await state(b);
    const ctx = await requestContext(b.request("/api/v1/hero"));
    const me = await uid(b);
    await db().prepare("INSERT INTO champion_progress (user_id, champion_id, xp, level, battles, wins, updated_at) VALUES (?, 'kaien', 2700, 10, 30, 20, 'x')").bind(me).run();
    let h = await hero(b);
    expect(h.catalog.passives.find((p: { id: string }) => p.id === "riposte").owned).toBe(true);     // 70%
    expect(h.catalog.styles.find((s: { id: string }) => s.id === "katana").owned).toBe(false);
    for (const c of mastery.CHALLENGES.kaien) await db().prepare("INSERT INTO champion_challenges (user_id, champion_id, challenge_id, progress, done_at, updated_at) VALUES (?, 'kaien', ?, ?, 'x', 'x')").bind(me, c.id, c.target).run();
    h = await hero(b);
    expect(h.looks_unlocked).toEqual(["kaien"]);
    expect(h.catalog.styles.find((s: { id: string }) => s.id === "katana").owned).toBe(true);
    expect(h.catalog.ultimates.find((u: { id: string }) => u.id === "cut").owned).toBe(true);
    expect((await put(heroLook, "/api/v1/hero/look", b, { look: STARTER_LOOKS.kaien })).status).toBe(200);
    // the hero's kit carries the style's weakness with it
    const kit = await build.heroKit(ctx, me, "T");
    expect(kit).toMatchObject({ champion: "hero", style: "apprentice", weaknesses: ["untrained"] });
  }, 60_000);
});

describe("the roster in play", () => {
  it("only Kaien at first; finishing tier I brings Asha, whose ceremony pays once", async () => {
    const b = await person(mail, "a@example.com", "alpha");
    const s0 = await state(b);
    expect(s0.progress.kaien.unlock).toMatchObject({ unlocked: true, celebrated: true });
    expect(s0.progress.asha.unlock).toMatchObject({ unlocked: false, have: 0, need: 4, reward: UNLOCK_REWARD.asha });
    expect((await json(await choose(b, "asha"))).error).toMatchObject({ code: "champion_locked", details: { have: 0, need: 4 } });

    const fight = await beat(b, ["minotaur", "cyclops", "oni", "kitsune"]);
    expect(fight.tiers_finished).toEqual([1]);
    const s1 = await state(b);
    expect(s1.progress.asha.unlock).toMatchObject({ unlocked: true, celebrated: false, source: "tier1" });

    const before = await coins(b);
    const c = await json(await celebrate(b, "asha"));
    expect(c).toMatchObject({ champion_id: "asha", first: true, reward: UNLOCK_REWARD.asha });
    expect(c.state.progress.asha.unlock.celebrated).toBe(true);
    expect(await coins(b)).toBe(before + UNLOCK_REWARD.asha.coins);
    expect(await json(await celebrate(b, "asha"))).toMatchObject({ first: false, reward: { xp: 0, coins: 0 } });
    expect(await coins(b)).toBe(before + UNLOCK_REWARD.asha.coins);

    expect((await choose(b, "asha")).status).toBe(200);
    expect((await celebrate(b, "brak")).status).toBe(403);
    expect((await celebrate(b, "nobody")).status).toBe(422);
  }, 60_000);

  it("a champion picked before the locks is kept, with no ceremony", async () => {
    const b = await person(mail, "k@example.com", "kept");
    await state(b);                                                               // the avatar row exists from the first read
    await db().prepare("UPDATE user_avatar SET champion_id = 'vex', champion_set_at = '2026-10-01' WHERE user_id = ?").bind(await uid(b)).run();
    const s = await state(b);
    expect(s).toMatchObject({ champion_id: "vex", chosen: true });
    expect(s.progress.vex.unlock).toMatchObject({ unlocked: true, celebrated: true, source: "kept" });
    expect(s.progress.mira.unlock.unlocked).toBe(false);
    // switching away and back still works
    expect((await choose(b, "kaien")).status).toBe(200);
    expect((await choose(b, "vex")).status).toBe(200);
  }, 60_000);

  it("Thorne joins at level 25", async () => {
    const b = await person(mail, "t@example.com", "thorne");
    await state(b);
    await db().prepare("UPDATE user_progress SET current_level = 25 WHERE user_id = ?").bind(await uid(b)).run();
    expect((await state(b)).progress.thorne.unlock).toMatchObject({ unlocked: true, celebrated: false, source: "level" });
  }, 60_000);

  it("the win that finishes a tier names the champion who joins; the mastery weapon arms the kit", async () => {
    const b = await person(mail, "w@example.com", "winner");
    const id = await uploadPdf(b, "Graphs.pdf", BIO);
    await beat(b, ["cyclops", "oni", "kitsune"]);
    // Kaien with his own mastery weapon (the level 10 skin)
    await db().prepare("UPDATE user_avatar SET owned_json = '[\"mastery_kaien_weapon\"]', equipped_json = '{\"weapon\":\"mastery_kaien_weapon\"}' WHERE user_id = ?").bind(await uid(b)).run();
    expect((await state(b)).progress.kaien.signature).toMatchObject({ worn: true, owned: true, finisher: "Final Cut" });
    const s = await json(await battles.POST(b.request("/api/v1/arena/battles", { body: { session_id: id, topic: "graph algorithms", difficulty: "easy" } })));
    expect(s.boss.species).toBe("minotaur");
    expect(s.battle.kit.signature).toMatchObject({ finisher: "Final Cut" });
    await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(s.battle_id).run();
    const q = await json(await question.GET(b.request(`/api/v1/arena/battles/${s.battle_id}/question?move=strike`), params({ id: s.battle_id })));
    await json(await answerRoute.POST(b.request(`/api/v1/arena/battles/${s.battle_id}/answer`, { body: { question_id: q.question.id, answer: "BFS" } }), params({ id: s.battle_id })));
    const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(done.battle.status).toBe("won");
    expect(done.battle.result.champions_unlocked).toEqual(["asha"]);
    expect(done.battle.result.bestiary.tiers_finished).toEqual([1]);
  }, 60_000);
});
