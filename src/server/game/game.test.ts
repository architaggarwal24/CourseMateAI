/** @vitest-environment node */
// The game on the Worker (Stage 4.5a): the reward ledger, levels, streaks, daily quests, achievements, the shop,
// potions, the avatar and champions, and the rewards the study tools now pay.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as profileRoute from "@/app/api/v1/profile/route";
import * as hudRoute from "@/app/api/v1/hud/route";
import * as achievementsRoute from "@/app/api/v1/achievements/route";
import * as quests from "@/app/api/v1/daily-quests/route";
import * as questClaim from "@/app/api/v1/daily-quests/claim/route";
import * as rewardsAward from "@/app/api/v1/rewards/award/route";
import * as shopRoute from "@/app/api/v1/shop/route";
import * as purchase from "@/app/api/v1/shop/purchase/route";
import * as equip from "@/app/api/v1/shop/equip/route";
import * as unequip from "@/app/api/v1/shop/unequip/route";
import * as useItem from "@/app/api/v1/items/use/route";
import * as avatarRoute from "@/app/api/v1/avatar/route";
import * as avatarUpdate from "@/app/api/v1/avatar/update/route";
import * as champion from "@/app/api/v1/avatar/champion/route";
import * as quiz from "@/app/api/v1/quiz/route";
import * as quizAnswer from "@/app/api/v1/quiz/answer/route";
import * as quizFinish from "@/app/api/v1/quiz/finish/route";
import * as chat from "@/app/api/v1/chat/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { Browser, fakeMailer, json, ORIGIN, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { person, uploadPdf } from "../test/flows";
import { ACHIEVEMENTS, CATALOG, ITEMS, KNOWN_EFFECTS, KNOWN_UNLOCK_TYPES, levelFromTotalXp, xpProgress } from "./content";
import { calculateRewards } from "./progression";
import { localDate, recordRewardEvent } from "./store";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;

const BIO = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell. Membrane proteins move ions across the membrane." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration. Respiration uses glucose and oxygen and releases carbon dioxide and water as products." },
];
function script(m: ChatMessage[]) {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("quiz generator")) {
    const n = Number(m.at(-1)!.content.match(/EXACTLY (\d+)/)?.[1] ?? 1);
    return JSON.stringify({ questions: Array.from({ length: n }, (_, i) => ({ question: `Q${Math.random()} ${i}?`, options: ["A. ATP", "B. DNA", "C. RNA", "D. Fat"], correct_answer: "A" })) });
  }
  return "Mitochondria make ATP [1].";
}

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV, TOPIC_MIN_SIMILARITY: "0.2", RELEVANCE_BLOCK_BELOW: "0.1", RELEVANCE_CLARIFY_BELOW: "0.15" })) vi.stubEnv(k, v as string);
  setLlmFactoryForTests(fakeLlms({ "*": script }).factory);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const post = (b: Browser, path: string, body: unknown) => b.request(path, { body });
const db = () => p.env.DB;
const uid = async (b: Browser) => (await json(await profileRoute.GET(b.request("/api/v1/profile")))).progress.user_id as string;
async function pay(b: Browser, xp: number, coins: number, key = `test:${Math.random()}`) {
  const ctx = await requestContext(b.request("/api/v1/profile"));
  return recordRewardEvent(ctx, Number(await uid(b)), "test", xp, coins, null, key);
}

describe("content", () => {
  it("is consistent: unique ids, known effects and unlock types, catalog sorted by category then price", () => {
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
    expect(CATALOG.filter((i) => i.effect).every((i) => KNOWN_EFFECTS.includes(i.effect!))).toBe(true);
    expect(ACHIEVEMENTS.every((a) => KNOWN_UNLOCK_TYPES.includes(a.unlock_type))).toBe(true);
    for (let i = 1; i < CATALOG.length; i++) {
      const [a, b] = [CATALOG[i - 1], CATALOG[i]];
      expect(a.category < b.category || (a.category === b.category && a.price <= b.price)).toBe(true);
    }
    expect(ITEMS.get("potion_health_small")).toMatchObject({ consumable: true, effect: "heal_1", category: "potion", level_required: 5 });
    expect(levelFromTotalXp(0)).toBe(1);
    expect(levelFromTotalXp(99)).toBe(1);
    expect(levelFromTotalXp(100)).toBe(2);
    expect(xpProgress(150)).toEqual([2, 50, 200]);
  });

  it("rewards scale with level tier, accuracy, difficulty, streak and (arena) combo", () => {
    expect(calculateRewards("quiz_complete", 1, 1, 1, 0).xp).toBe(150);              // 100 x 1.5 (perfect accuracy)
    expect(calculateRewards("quiz_complete", 6, 0.5, 1, 0).xp).toBe(130);             // tier 2: x1.3
    expect(calculateRewards("boss_defeat", 1, 1, 1, 0, 3).breakdown.combo_mult).toBe(1.2);
    expect(calculateRewards("quiz_complete", 1, 1, 1, 0, 3).breakdown.combo_mult).toBeNull();
  });

  it("a player's day is their local date", () => {
    const at = new Date("2026-11-05T20:00:00Z");
    expect(localDate("Asia/Kolkata", at)).toBe("2026-11-06");                     // 01:30 the next day in India
    expect(localDate("America/New_York", at)).toBe("2026-11-05");
    expect(localDate("Not/AZone", at)).toBe("2026-11-05");
  });
});

describe("the ledger", () => {
  it("pays a key once, never overdraws, and keeps the level in step with XP", async () => {
    const b = await person(mail, "free@example.com", "free");
    expect(await pay(b, 150, 40, "k1")).toMatchObject({ applied: true, total_xp: 150, coins: 40, level: 2 });
    expect(await pay(b, 150, 40, "k1")).toMatchObject({ applied: false, reason: "duplicate", total_xp: 150 });
    expect(await pay(b, 0, -50, "k2")).toMatchObject({ applied: false, reason: "insufficient_funds", coins: 40 });
    expect(await db().prepare("SELECT COUNT(*) AS n FROM reward_events").first("n")).toBe(1);
  });
});

describe("study pays out", () => {
  it("finishing a quiz pays once, moves the quiz quests and the streak; the HUD shows it", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const q = await json(await quiz.POST(post(b, "/api/v1/quiz", { topic: "mitochondria ATP respiration", num_questions: 2, question_type: "MCQ", session_id: id })));
    for (const qid of [1, 2]) await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: qid, answer: "ATP" }));
    const done = await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })));
    expect(done.rewards).toMatchObject({ ok: true, action_type: "quiz_complete", streak_days: 1 });
    expect(done.rewards.totals.level).toBeGreaterThanOrEqual(2);                       // (achievement XP can add more)
    expect(done.rewards.xp_gained).toBe(Math.trunc(100 * 1.5 * 1.2 * 1.05));
    expect(done.rewards.new_achievements.map((a: any) => a.id)).toContain("first_quiz");
    expect((await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })))).rewards).toBeNull();
    const h = await json(await hudRoute.GET(b.request("/api/v1/hud")));
    expect(h.progress).toMatchObject({ total_quizzes_completed: 1, best_quiz_accuracy: 100, streak_days: 1 });
    expect(h.quests).toHaveLength(3);
    expect(h.shop).toMatchObject({ shop_unlocked: false });
    const ach = await json(await achievementsRoute.GET(b.request("/api/v1/achievements")));
    expect(ach.unlocked.first_quiz).toBeTruthy();
    expect(ach.achievements[0]).toHaveProperty("unlock_threshold");
  });

  it("every 5th answered chat question pays a bundle", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const rewards = [];
    for (let i = 0; i < 5; i++) rewards.push((await json(await chat.POST(post(b, "/api/v1/chat", { question: `How do mitochondria make ATP ${i}?`, session_id: id })))).rewards);
    expect(rewards.slice(0, 4)).toEqual([null, null, null, null]);
    expect(rewards[4]).toMatchObject({ ok: true, action_type: "chat_bundle_5" });
  });
});

describe("daily quests", () => {
  it("three for the day; a quest is claimed once, only when complete", async () => {
    const b = await person(mail, "free@example.com", "free");
    const qs = (await json(await quests.GET(b.request("/api/v1/daily-quests")))).quests;
    expect(qs).toHaveLength(3);
    expect(qs[0]).toHaveProperty("description");
    const type = qs[0].quest_type;
    expect(await json(await questClaim.POST(post(b, "/api/v1/daily-quests/claim", { quest_type: type })))).toEqual({ ok: false, reason: "Quest not completed" });
    await db().prepare("UPDATE daily_quests SET completed = 1 WHERE quest_type = ?").bind(type).run();
    const claim = await json(await questClaim.POST(post(b, "/api/v1/daily-quests/claim", { quest_type: type })));
    expect(claim).toMatchObject({ ok: true, xp_gained: qs[0].reward_xp, coins_gained: qs[0].reward_coins });
    expect(await json(await questClaim.POST(post(b, "/api/v1/daily-quests/claim", { quest_type: type })))).toEqual({ ok: false, reason: "Already claimed" });
  });

  it("quests and streaks follow the player's time zone (the browser sends it)", async () => {
    const b = await person(mail, "free@example.com", "free");
    await quests.GET(new Request(`${ORIGIN}/api/v1/daily-quests`, { headers: { cookie: b.header(), "x-timezone": "Pacific/Kiritimati" } }));
    expect(await db().prepare("SELECT timezone FROM user WHERE email = 'free@example.com'").first("timezone")).toBe("Pacific/Kiritimati");
    expect(await db().prepare("SELECT quest_date FROM daily_quests LIMIT 1").first("quest_date")).toBe(localDate("Pacific/Kiritimati"));
  });
});

describe("streaks", () => {
  it("a missed day costs a freeze; without one the streak starts again", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = Number(await uid(b));
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const finishQuiz = async () => {
      const doc = await uploadPdf(b, `Bio${Math.random()}.pdf`, BIO);
      const q = await json(await quiz.POST(post(b, "/api/v1/quiz", { topic: "mitochondria ATP respiration", num_questions: 1, question_type: "MCQ", session_id: doc })));
      await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "ATP" }));
      return (await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })))).rewards.streak_days;
    };
    await profileRoute.GET(b.request("/api/v1/profile"));
    await db().prepare("UPDATE user_progress SET streak_days = 6, last_active_utc = ? WHERE user_id = ?").bind(day(-1), id).run();
    expect(await finishQuiz()).toBe(7);                                              // day 7 earns a freeze
    expect(await db().prepare("SELECT streak_freezes FROM user_progress WHERE user_id = ?").bind(id).first("streak_freezes")).toBe(1);
    await db().prepare("UPDATE user_progress SET last_active_utc = ? WHERE user_id = ?").bind(day(-2), id).run();
    expect(await finishQuiz()).toBe(7);                                              // one missed day: the freeze is used
    await db().prepare("UPDATE user_progress SET last_active_utc = ? WHERE user_id = ?").bind(day(-3), id).run();
    expect(await finishQuiz()).toBe(1);                                              // two missed, no freezes: back to 1
  }, 30_000);
});

describe("the shop, potions and the avatar", () => {
  it("locked below level 5; then buying spends coins once, can't overdraw, and gear needs owning", async () => {
    const b = await person(mail, "free@example.com", "free");
    expect(await json(await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "armor_hoodie_gray" })))).toEqual({ ok: false, reason: "Shop locked until Level 5" });
    expect(await json(await equip.POST(post(b, "/api/v1/shop/equip", { item_id: "armor_hoodie_gray" })))).toEqual({ ok: false, reason: "You don't own this item" });
    await pay(b, 1300, 100);                                                        // level 5
    const shop = await json(await shopRoute.GET(b.request("/api/v1/shop")));
    expect(shop).toMatchObject({ shop_unlocked: true, level: 5, coins: 100 });
    expect(shop.owned).toContain("armor_gi_white");                                 // free items are granted
    expect(shop.items.find((i: any) => i.id === "potion_health_small")).toMatchObject({ quantity: 0, max_stack: 3, at_max: false });

    expect(await json(await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "armor_hoodie_gray" })))).toMatchObject({ ok: true, message: "Purchased" });
    expect(await json(await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "armor_hoodie_gray" })))).toEqual({ ok: true, message: "Already owned" });
    expect(await json(await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "potion_health_small" })))).toEqual({ ok: false, reason: "Not enough coins", need: 60 });
    expect((await json(await shopRoute.GET(b.request("/api/v1/shop")))).coins).toBe(20);
    expect(await json(await equip.POST(post(b, "/api/v1/shop/equip", { item_id: "armor_hoodie_gray" })))).toMatchObject({ ok: true, equipped: { armor: "armor_hoodie_gray" } });
    expect(await json(await unequip.POST(post(b, "/api/v1/shop/unequip", { slot: "armor" })))).toMatchObject({ ok: true, equipped: {} });
    expect((await json(await unequip.POST(post(b, "/api/v1/shop/unequip", { slot: "cape" })))).reason).toMatch(/Invalid slot/);
  });

  it("a retried purchase (same Idempotency-Key) spends the coins once and answers the same", async () => {
    const b = await person(mail, "free@example.com", "free");
    await pay(b, 1300, 200);
    const buy = (key: string) => purchase.POST(b.request("/api/v1/shop/purchase", { body: { item_id: "potion_health_small" }, headers: { "idempotency-key": key } }));
    const first = await json(await buy("tap-1-0123456789abcdef"));
    const retry = await buy("tap-1-0123456789abcdef");
    expect(retry.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(retry)).toEqual(first);
    expect((await json(await shopRoute.GET(b.request("/api/v1/shop")))).coins).toBe(120);
    await buy("tap-2-0123456789abcdef");                                            // a second tap is a second potion
    expect((await json(await shopRoute.GET(b.request("/api/v1/shop")))).coins).toBe(40);
  });

  it("a potion is bought, used once, and its effect waits for the arena", async () => {
    const b = await person(mail, "free@example.com", "free");
    await pay(b, 1300, 200);
    await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "potion_health_small" }));
    await purchase.POST(post(b, "/api/v1/shop/purchase", { item_id: "potion_health_small" }));
    const used = await json(await useItem.POST(post(b, "/api/v1/items/use", { item_id: "potion_health_small" })));
    expect(used).toMatchObject({ ok: true, effect: "heal_1", active_buffs: { heal_1: { count: 1 } } });
    await useItem.POST(post(b, "/api/v1/items/use", { item_id: "potion_health_small" }));
    const none = await useItem.POST(post(b, "/api/v1/items/use", { item_id: "potion_health_small" }));
    expect((await json(none)).error.code).toBe("item_not_owned");
    const h = await json(await hudRoute.GET(b.request("/api/v1/hud")));
    expect(h.buffs.heal_1.count).toBe(2);
  });

  it("champions: choose one with a loadout; unknown ones and unowned skins are refused", async () => {
    const b = await person(mail, "free@example.com", "free");
    const c0 = await json(await champion.GET(b.request("/api/v1/avatar/champion")));
    expect(c0).toMatchObject({ champion_id: "kaien", chosen: false, champions: ["kaien", "asha", "brak", "mira", "vex", "thorne"] });
    expect(c0.progress.asha).toMatchObject({ level: 1, next_level_xp: 100, kit: { passive: { name: "Reach" } }, unlock: { unlocked: false } });
    // a locked champion is refused until it joins (Stage C1: roster.test.ts)
    const locked = await champion.PUT(b.request("/api/v1/avatar/champion", { method: "PUT", body: { champion_id: "asha" } }));
    expect(locked.status).toBe(403);
    expect((await json(locked)).error.code).toBe("champion_locked");
    await p.env.DB.prepare("INSERT INTO champion_unlocks (user_id, champion_id, source, unlocked_at) VALUES (?, 'asha', 'tier1', '2026-11-08')").bind(Number(await uid(b))).run();
    const put = await champion.PUT(b.request("/api/v1/avatar/champion", { method: "PUT", body: { champion_id: "asha", loadout: { armor: "armor_gi_white", weapon: "weapon_dragon_blade" } } }));
    expect(await json(put)).toMatchObject({ champion_id: "asha", chosen: true, loadout: { armor: "armor_gi_white", weapon: null } });
    expect((await champion.PUT(b.request("/api/v1/avatar/champion", { method: "PUT", body: { champion_id: "nobody" } }))).status).toBe(422);
    const upd = await json(await avatarUpdate.POST(post(b, "/api/v1/avatar/update", { equipped: { armor: "", title: "title_nonexistent" } })));
    expect(upd.equipped).toEqual({});
    expect(await json(await avatarRoute.GET(b.request("/api/v1/avatar")))).toMatchObject({ champion_id: "asha", champion_chosen: true });
  });
});

describe("guests and claims", () => {
  it("guests get starting values; the browser can't claim a reward", async () => {
    const guest = new Browser("198.51.100.9");
    expect(await json(await hudRoute.GET(guest.request("/api/v1/hud")))).toMatchObject({ guest_mode: true, quests: [] });
    expect(await json(await profileRoute.GET(guest.request("/api/v1/profile")))).toMatchObject({ guest_mode: true });
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await rewardsAward.POST(post(b, "/api/v1/rewards/award", { action_type: "quiz_complete" })))).error.code).toBe("reward_not_claimable");
    expect((await rewardsAward.POST(post(b, "/api/v1/rewards/award", { action_type: "free_money" }))).status).toBe(400);
  });
});
