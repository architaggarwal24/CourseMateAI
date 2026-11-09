/** @vitest-environment node */
// The Bestiary as progression (Stage B1): tiers that open from wins, stand-ins for locked creatures, banes, mastery,
// and the rewards for each, through the real arena routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as battles from "@/app/api/v1/arena/battles/route";
import * as battleOne from "@/app/api/v1/arena/battles/[id]/route";
import * as question from "@/app/api/v1/arena/battles/[id]/question/route";
import * as answerRoute from "@/app/api/v1/arena/battles/[id]/answer/route";
import * as forfeit from "@/app/api/v1/arena/battles/[id]/forfeit/route";
import * as bestiary from "@/app/api/v1/bestiary/route";
import * as bestiaryOne from "@/app/api/v1/bestiary/[species]/route";
import * as achievementsRoute from "@/app/api/v1/achievements/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests, settleBackground, trackBackgroundForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import { summon } from "./bestiary";
import { intentBaseDamage } from "./boss";
import {
  BANES, FIRST_WIN, baneHud, masteryOf, openSpecies, openTiers, recordFight, TIER_OF, trackBane,
} from "./tome";

// ── rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
const rec = (wins: number, extra: Record<string, unknown> = {}) => ({ wins, flawlessWins: 0, nightmareWins: 0, baneFound: false, ...extra });
const recs = (m: Record<string, number>) => new Map(Object.entries(m).map(([s, w]) => [s, rec(w)])) as never;

describe("tiers", () => {
  it("tier I is open; any two wins in a tier open the next; a gap stops the climb", () => {
    expect([...openTiers(recs({}))]).toEqual([1]);
    expect([...openTiers(recs({ minotaur: 1 }))]).toEqual([1]);
    expect([...openTiers(recs({ minotaur: 1, oni: 3 }))]).toEqual([1, 2]);
    expect([...openTiers(recs({ minotaur: 1, oni: 1, naga: 1, sphinx: 1, hydra: 1, kraken: 1 }))]).toEqual([1, 2, 3, 4]);
    expect([...openTiers(recs({ naga: 1, sphinx: 1 }))]).toEqual([1]);           // tier II wins without tier I open
  });

  it("13 creatures in 4 tiers; the Nemesis is never summoned by a topic", () => {
    expect(Object.keys(TIER_OF)).toHaveLength(13);
    expect(openSpecies(recs({})).has("ammit")).toBe(false);
    expect([...openSpecies(recs({}))].sort()).toEqual(["cyclops", "kitsune", "minotaur", "oni"]);
  });

  it("a locked creature's topic sends the closest open creature, and says which one it wanted", async () => {
    const open = openSpecies(recs({}));
    const r = await summon("cell biology", open);
    expect(r.wanted).toBe("hydra");
    expect(open.has(r.species)).toBe(true);
    expect(await summon("graph algorithms", open)).toEqual({ species: "minotaur", wanted: "minotaur" });
    expect(await summon("cell biology", open)).toEqual(r);                        // the same topic, the same stand-in
  });

  it("higher tiers hit harder", () => {
    expect(intentBaseDamage({ tier: 1 }, "easy")).toBe(1);
    expect(intentBaseDamage({ tier: 3, rage: false }, "easy")).toBe(1);
    expect(intentBaseDamage({ tier: 3, rage: true }, "easy")).toBe(2);
    expect(intentBaseDamage({ tier: 4 }, "easy")).toBe(2);
  });
});

describe("banes", () => {
  it("land on the exact moves answered right in a row; a wrong answer starts over", () => {
    const boss: Record<string, any> = { species: "minotaur" };
    expect(trackBane(boss, "guard", true)).toBe(false);
    expect(trackBane(boss, "heavy", true)).toBe(true);
    expect(trackBane(boss, "guard", true)).toBe(false);
    expect(trackBane(boss, "heavy", false)).toBe(false);                         // wrong: no bane
    expect(trackBane(boss, "heavy", true)).toBe(false);                          // the guard before it was forgotten
    expect(trackBane(boss, "strike", true)).toBe(false);
    expect(trackBane(boss, "guard", true)).toBe(false);
    expect(trackBane(boss, "heavy", true)).toBe(true);
  });

  it("the battle shows only the clue until the bane is written in, then the moves and how far along you are", () => {
    const boss: Record<string, any> = { species: "cyclops", bane_known: false };
    expect(baneHud(boss)).toMatchObject({ known: false, moves: null, clue: BANES.cyclops.clue });
    boss.bane_known = true;
    trackBane(boss, "jab", true);
    expect(baneHud(boss)).toMatchObject({ known: true, moves: ["jab", "jab", "heavy"], progress: 1 });
    trackBane(boss, "jab", true);
    expect(baneHud(boss)!.progress).toBe(2);
  });

  it("every creature has one", () => {
    for (const s of Object.keys(TIER_OF)) expect(BANES[s]?.moves.length, s).toBeGreaterThanOrEqual(2);
  });
});

describe("mastery", () => {
  it("bronze at the first win, silver at five, gold for a flawless or nightmare win", () => {
    expect(masteryOf(rec(0) as never)).toBe("none");
    expect(masteryOf(rec(1) as never)).toBe("bronze");
    expect(masteryOf(rec(5) as never)).toBe("silver");
    expect(masteryOf(rec(1, { flawlessWins: 1 }) as never)).toBe("gold");
    expect(masteryOf(rec(2, { nightmareWins: 1 }) as never)).toBe("gold");
  });
});

// ── through the routes ────────────────────────────────────────────────────────────────────────────────────────
let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let n = 0;
const BIO = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration from glucose and oxygen." },
];
function script(m: ChatMessage[]) {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("battle game")) {
    return JSON.stringify({ questions: Array.from({ length: 6 }, (_, i) => {
      n++;
      return { question: `Battle question ${n}?`, options: ["ATP", "DNA", "RNA", "Fat"], correct_answer: "ATP", explanation: "Energy.", concept: `concept ${n % 3}`, difficulty: ["easy", "medium", "hard"][i % 3] };
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

const post = (b: Browser, path: string, body: unknown = {}) => b.request(path, { body });
const db = () => p.env.DB;
const start = async (b: Browser, id: string, topic: string) =>
  json(await battles.POST(post(b, "/api/v1/arena/battles", { session_id: id, topic, difficulty: "easy" })));
const ask = async (b: Browser, battle: string, move?: string) =>
  json(await question.GET(b.request(`/api/v1/arena/battles/${battle}/question${move ? `?move=${move}` : ""}`), params({ id: battle })));
const reply = async (b: Browser, battle: string, qid: number, answer: string) =>
  json(await answerRoute.POST(post(b, `/api/v1/arena/battles/${battle}/answer`, { question_id: qid, answer }), params({ id: battle })));
const view = async (b: Browser) => json(await bestiary.GET(b.request("/api/v1/bestiary")));
const uid = async (b: Browser) => {
  const req = b.request("/api/v1/bestiary");
  const ctx = await requestContext(req);
  const s = await ctx.auth.api.getSession({ headers: req.headers });
  return Number(s!.user.id);
};

/** Win a battle quickly: lots of focus for heavy moves, then a last hit on 1 HP. */
async function win(b: Browser, battle: string, moves: string[] = ["strike"]) {
  await db().prepare("UPDATE arena_battles SET focus = 5, focus_cap = 5, boss_json = json_set(boss_json, '$.current_hp', 9999, '$.max_hp', 9999), boss_hp = 9999, boss_max_hp = 9999 WHERE id = ?").bind(battle).run();
  for (let i = 0; i < moves.length; i++) {
    const last = i === moves.length - 1;
    const q = await ask(b, battle, moves[i]);
    if (last) await db().prepare("UPDATE arena_battles SET boss_json = json_set(boss_json, '$.current_hp', 1), boss_hp = 1, shield = 0 WHERE id = ?").bind(battle).run();
    await db().prepare("UPDATE arena_battles SET focus = 5, shield = 0 WHERE id = ?").bind(battle).run();
    const r = await reply(b, battle, q.question.id, "ATP");
    if (last) return r;
  }
}

describe("the Bestiary in play", () => {
  it("locked pages are silhouettes; a locked topic fights a stand-in and leaves a teaser", async () => {
    const b = await person(mail, "a@example.com", "alpha");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const v0 = await view(b);
    expect(v0.tiers.map((t: { open: boolean }) => t.open)).toEqual([true, false, false, false]);
    const hydra = v0.creatures.find((c: { species: string }) => c.species === "hydra");
    expect(hydra).toMatchObject({ open: false, name: null, bane: null, tier: 3, stats: null });
    // an open page has its stat block (round 7): its blows, its special, how much tougher its tier is
    expect(v0.creatures.find((c: { species: string }) => c.species === "minotaur").stats).toEqual({
      attacks: ["Labyrinth Charge", "Horn Gore", "Axe Cleave"], special: "Endless Labyrinth", hp_scale: 1, time_scale: 1 });
    const s = await start(b, id, "cell biology");
    expect(["minotaur", "cyclops", "oni", "kitsune"]).toContain(s.boss.species);
    expect(s.battle).toMatchObject({ tier: 1, bane: { known: false, moves: null } });
    expect(JSON.stringify(s.boss)).not.toContain("wanted");
    expect((await view(b)).creatures.find((c: { species: string }) => c.species === "hydra").teaser_topic).toBe("cell biology");
  }, 30_000);

  it("a first win pays once, opens the page's bane, and two wins in tier I open tier II", async () => {
    const b = await person(mail, "b@example.com", "beta");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id, "graph algorithms");
    expect(s.boss.species).toBe("minotaur");
    const r = await win(b, s.battle_id);
    expect(r.battle.status).toBe("won");
    const done = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${s.battle_id}`), params({ id: s.battle_id })));
    expect(done.battle.result.bestiary).toMatchObject({ species: "minotaur", tier: 1, won: true, first_win: true, mastery: "bronze",
      rewards: { xp: FIRST_WIN[1].xp, coins: FIRST_WIN[1].coins }, tier_opened: null });
    const page = json(await bestiaryOne.GET(b.request("/api/v1/bestiary/minotaur"), params({ species: "minotaur" })));
    expect(await page).toMatchObject({ defeated: true, bane: { moves: ["guard", "heavy"] }, record: { wins: 1, fights: 1 } });
    expect((await page).concepts.length).toBeGreaterThan(0);

    // a second minotaur win pays no first-win reward again
    const again = await start(b, id, "graph algorithms");
    await win(b, again.battle_id);
    const second = await json(await battleOne.GET(b.request(`/api/v1/arena/battles/${again.battle_id}`), params({ id: again.battle_id })));
    expect(second.battle.result.bestiary).toMatchObject({ first_win: false, rewards: { xp: 0, coins: 0 } });

    const ctxUser = await uid(b);
    const ctx = await requestContext(b.request("/api/v1/bestiary"));
    const third = await recordFight(ctx, ctxUser, { species: "oni", won: true, flawless: false, nightmare: false, seconds: 60, accuracy: 80 });
    expect(third).toMatchObject({ first_win: true, tier_opened: 2 });
    expect((await view(b)).tiers[1]).toMatchObject({ open: true });
  }, 60_000);

  it("finding the bane before the first win pays once and unlocks Lorekeeper; the combo stays hidden until the win", async () => {
    const b = await person(mail, "c@example.com", "gamma");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id, "graph algorithms");
    await db().prepare("UPDATE arena_battles SET focus = 5, boss_json = json_set(boss_json, '$.current_hp', 9999, '$.max_hp', 9999), boss_hp = 9999, boss_max_hp = 9999 WHERE id = ?").bind(s.battle_id).run();
    const q1 = await ask(b, s.battle_id, "guard");
    const r1 = await reply(b, s.battle_id, q1.question.id, "ATP");
    expect(r1.bane).toBeNull();
    await db().prepare("UPDATE arena_battles SET focus = 5 WHERE id = ?").bind(s.battle_id).run();
    const q2 = await ask(b, s.battle_id, "heavy");
    const r2 = await reply(b, s.battle_id, q2.question.id, "ATP");
    expect(r2.bane).toEqual({ landed: true, found: true });
    expect(r2.damage_taken).toBe(0);                                              // staggered: it lost its turn
    expect(r2.new_achievements?.map((a: { id: string }) => a.id)).toContain("lorekeeper");
    expect(r2.battle.bane).toMatchObject({ known: false });                       // still only the clue
    const page = await json(await bestiaryOne.GET(b.request("/api/v1/bestiary/minotaur"), params({ species: "minotaur" })));
    expect(page.bane).toMatchObject({ found_alone: true, moves: null });
    const ach = await json(await achievementsRoute.GET(b.request("/api/v1/achievements")));
    expect(ach.progress.bestiary_banes_found).toBe(1);
    // landing it again in the same fight pays nothing more
    await db().prepare("UPDATE arena_battles SET focus = 5 WHERE id = ?").bind(s.battle_id).run();
    const q3 = await ask(b, s.battle_id, "guard");
    await reply(b, s.battle_id, q3.question.id, "ATP");
    await db().prepare("UPDATE arena_battles SET focus = 5 WHERE id = ?").bind(s.battle_id).run();
    const q4 = await ask(b, s.battle_id, "heavy");
    expect((await reply(b, s.battle_id, q4.question.id, "ATP")).bane).toEqual({ landed: true, found: false });
  }, 60_000);

  it("silver at five wins, gold for a flawless win: each paid once; a loss counts as a fight", async () => {
    const b = await person(mail, "d@example.com", "delta");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const s = await start(b, id, "graph algorithms");
    const lost = await json(await forfeit.POST(post(b, `/api/v1/arena/battles/${s.battle_id}/forfeit`), params({ id: s.battle_id })));
    expect(lost.battle.result.bestiary).toMatchObject({ won: false, first_win: false, mastery: "none" });
    const ctx = await requestContext(b.request("/api/v1/bestiary"));
    const me = await uid(b);
    const fight = (flawless = false) => recordFight(ctx, me, { species: "minotaur", won: true, flawless, nightmare: false, seconds: 50, accuracy: 90 });
    for (let i = 0; i < 4; i++) await fight();
    const fifth = await fight();
    expect(fifth).toMatchObject({ mastery: "silver", mastery_up: "silver", rewards: { coins: 60 } });
    const gold = await fight(true);
    expect(gold).toMatchObject({ mastery: "gold", mastery_up: "gold", rewards: { xp: 150, coins: 120 } });
    expect(await fight(true)).toMatchObject({ mastery_up: null, rewards: { xp: 0, coins: 0 } });
    const page = await json(await bestiaryOne.GET(b.request("/api/v1/bestiary/minotaur"), params({ species: "minotaur" })));
    expect(page.record).toMatchObject({ fights: 8, wins: 7, losses: 1, flawless_wins: 2, best_seconds: 50, best_accuracy: 90 });
    expect((await bestiaryOne.GET(b.request("/api/v1/bestiary/nope"), params({ species: "nope" }))).status).toBe(404);
  }, 60_000);
});
