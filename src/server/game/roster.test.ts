/** @vitest-environment node */
// Champion unlocks and signature weapons (Stage C1): who joins when, the ceremony's reward paid once, picks made
// before the locks kept, and the small perk a champion gets from their own mastery weapon.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as champion from "@/app/api/v1/avatar/champion/route";
import * as celebrateRoute from "@/app/api/v1/avatar/champion/celebrate/route";
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
