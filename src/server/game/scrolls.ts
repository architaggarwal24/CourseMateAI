// The quest board (Stage Q1). Every quest is a sealed scroll; "Answer the call" opens the place it is done; when it
// is done the seal can be broken and the reward is paid once. Four kinds:
//   daily    today's three quests (progression.ts, unchanged)
//   weekly   three trials for the player's week (Monday to Sunday in their time zone)
//   hunt     Bestiary hunts: a creature not yet beaten, or its Elder form; the reward includes its lost page
//   story    a three-chapter story for the champion you fight as
// A scroll moves on by its `event` (one UPDATE for every matching scroll: scrollEvent).
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { bestiaryRecords, questScrolls } from "../db/schema";
import { HttpError } from "../http";
import { NEMESIS_SPECIES } from "./bestiary";
import { CHAMPIONS, type Champion } from "./content";
import { dailyQuestsFor, checkAchievements } from "./progression";
import { getAvatar, getProgress, localDate, nowIso, recordRewardEvent, type Player } from "./store";
import { TIER_OF, openTiers, tierOf, type RecordRow } from "./tome";
import { isUnlocked, rosterReads } from "./roster";

export type ScrollKind = "weekly" | "hunt" | "story";
export interface Reward { xp: number; coins: number }
/** Where "Answer the call" goes: a place in the app (the client turns it into a link). */
export interface Call { place: string; topic?: string }

// ── weekly trials ─────────────────────────────────────────────────────────────────────────────────────────────
interface TrialDef { id: string; title: string; text: string; event: string; target: number; reward: Reward; call: Call }
export const TRIALS: TrialDef[] = [
  { id: "trial_bosses", title: "Trial of the Arena", text: "Defeat 5 creatures in the arena.", event: "boss_defeat", target: 5, reward: { xp: 400, coins: 250 }, call: { place: "arena" } },
  { id: "trial_quizzes", title: "Trial of Questions", text: "Complete 6 quizzes.", event: "quiz_complete", target: 6, reward: { xp: 300, coins: 150 }, call: { place: "quiz" } },
  { id: "trial_reviews", title: "Trial of Memory", text: "Review 80 cards.", event: "review_card", target: 80, reward: { xp: 300, coins: 150 }, call: { place: "review" } },
  { id: "trial_exam", title: "Trial of the Examiners", text: "Finish 2 mock exams.", event: "exam_complete", target: 2, reward: { xp: 350, coins: 175 }, call: { place: "exam" } },
  { id: "trial_banes", title: "Trial of Weakness", text: "Land 3 banes on Bestiary creatures.", event: "bane_landed", target: 3, reward: { xp: 350, coins: 200 }, call: { place: "arena" } },
  { id: "trial_hard", title: "Trial of Iron", text: "Win a fight on hard or nightmare.", event: "hard_win", target: 1, reward: { xp: 400, coins: 250 }, call: { place: "arena" } },
  { id: "trial_notes", title: "Trial of Ink", text: "Make notes 4 times.", event: "notes_generation", target: 4, reward: { xp: 250, coins: 120 }, call: { place: "notes" } },
  { id: "trial_cards", title: "Trial of Cards", text: "Study 5 flashcard decks.", event: "flashcard_complete", target: 5, reward: { xp: 250, coins: 120 }, call: { place: "flashcards" } },
];
export const WEEKLY_COUNT = 3;

/** The player's week, as an ISO week key (2026-W45), from their local date. */
export function weekOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;                          // Monday 1 ... Sunday 7
  d.setUTCDate(d.getUTCDate() + 4 - dow);                  // the Thursday of this week decides the year
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** This week's three trials: the same for the whole week (picked from the week and the player, not at random). */
export function trialsFor(userId: number, week: string): TrialDef[] {
  let h = 2166136261;
  for (const ch of `${userId}:${week}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pool = [...TRIALS];
  const out: TrialDef[] = [];
  while (out.length < WEEKLY_COUNT && pool.length) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

// ── hunts ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** A topic that calls each creature (the hunt's "Answer the call" fills it in the arena). */
export const HUNT_TOPIC: Record<string, string> = {
  minotaur: "graph algorithms", cyclops: "mechanics", oni: "business strategy", kitsune: "probability",
  naga: "philosophy", rakshasa: "psychology", sphinx: "logic", fenrir: "economics",
  hydra: "cell biology", kraken: "chemistry", simurgh: "history of science", jormungandr: "climate",
};
const NAMES: Record<string, string> = {
  minotaur: "Minotaur", cyclops: "Cyclops", oni: "Oni", kitsune: "Kitsune", naga: "Naga", rakshasa: "Rakshasa", sphinx: "Sphinx",
  fenrir: "Fenrir", hydra: "Hydra", kraken: "Kraken", simurgh: "Simurgh", jormungandr: "Jörmungandr",
};
export const HUNT_REWARD: Record<number, Reward> = { 1: { xp: 120, coins: 60 }, 2: { xp: 200, coins: 100 }, 3: { xp: 300, coins: 150 }, 4: { xp: 450, coins: 220 } };
export const ELDER_BONUS = 1.5;
export const HUNTS_AT_ONCE = 2;

interface HuntDef { id: string; species: string; elder: boolean; title: string; text: string; event: string; reward: Reward; call: Call }
export function huntDef(id: string): HuntDef | null {
  const m = /^hunt:(elder:)?([a-z]+)$/.exec(id);
  if (!m || !NAMES[m[2]]) return null;
  const species = m[2], elder = !!m[1], base = HUNT_REWARD[tierOf(species)];
  const reward = elder ? { xp: Math.round(base.xp * ELDER_BONUS), coins: Math.round(base.coins * ELDER_BONUS) } : base;
  return elder
    ? { id, species, elder, title: `Hunt the Elder ${NAMES[species]}`, text: `Beat the ${NAMES[species]} on nightmare, where its Elder form waits.`, event: `nightmare_win:${species}`, reward, call: { place: "arena", topic: HUNT_TOPIC[species] } }
    : { id, species, elder, title: `Hunt the ${NAMES[species]}`, text: `Beat the ${NAMES[species]} for the first time.`, event: `win:${species}`, reward, call: { place: "arena", topic: HUNT_TOPIC[species] } };
}

/** Hunts in Bestiary order (tier by tier), first defeats before Elder forms. */
const huntOrder = (id: string) => { const h = huntDef(id); return h ? (h.elder ? 100 : 0) + Object.keys(TIER_OF).indexOf(h.species) : 999; };

/** The hunts worth posting now: open creatures never beaten first, then Elder forms whose lost page is still out there. */
export function huntsWanted(recs: Map<string, RecordRow>): string[] {
  const open = openTiers(recs);
  const species = Object.keys(TIER_OF).filter((s) => s !== NEMESIS_SPECIES && open.has(TIER_OF[s]));
  const first = species.filter((s) => (recs.get(s)?.wins ?? 0) === 0).map((s) => `hunt:${s}`);
  const elder = species.filter((s) => (recs.get(s)?.wins ?? 0) > 0 && !recs.get(s)?.lostPage).map((s) => `hunt:elder:${s}`);
  return [...first, ...elder];
}

// ── champion stories ─────────────────────────────────────────────────────────────────────────────────────────
interface Chapter { title: string; text: string; goal: string; event: (c: string) => string; target: number; reward: Reward }
const GOALS: Omit<Chapter, "title" | "text">[] = [
  { goal: "Win a fight as {name}.", event: (c) => `win_as:${c}`, target: 1, reward: { xp: 100, coins: 60 } },
  { goal: "Land 2 banes as {name}.", event: (c) => `bane_as:${c}`, target: 2, reward: { xp: 200, coins: 120 } },
  { goal: "Win on hard or nightmare as {name}.", event: (c) => `hard_win_as:${c}`, target: 1, reward: { xp: 400, coins: 250 } },
];
export const STORIES: Record<Champion, { title: string; text: string }[]> = {
  kaien: [
    { title: "The Ninth Page", text: "A book with eight pages and a gap where the ninth should be. Kaien was its last reader. Find out what was cut." },
    { title: "Ink on the Blade", text: "The torn edge matches the nicks on his sword. Something he fought carried the page away." },
    { title: "The Cut That Writes", text: "He finds the thief in the hardest fight of all, and learns the ninth page was never lost: he is still writing it." },
  ],
  asha: [
    { title: "The Dawn Wall", text: "Asha held a wall at dawn for a city that was already gone. She still wakes before the sun to stand guard." },
    { title: "What the Wall Kept Out", text: "The creatures she held back were not trying to get in. They were fleeing something behind them." },
    { title: "Sunfall", text: "She plants the spear where the old wall stood, and this time she lets the light through." },
  ],
  brak: [
    { title: "The Lower Stacks", text: "Brak grew up in the bottom floors of the great library, where books were too heavy to carry and too dull to read." },
    { title: "Knuckles and Footnotes", text: "Every fighter he beats leaves a question behind. He starts keeping them, in a book he pretends isn't his." },
    { title: "A Thousand Fists", text: "The hardest fight of his life, and the answer comes from the book. He will never admit he read it." },
  ],
  mira: [
    { title: "The Quiet Stacks", text: "Mira was sworn to silence among the books. She talks to them anyway, and some of them answer." },
    { title: "A Spell in the Margin", text: "A note in her own handwriting, in a book she has never opened. Someone wants her to find the weak points." },
    { title: "The Last Word", text: "On nightmare, the creature speaks her spell back to her. She finishes it first." },
  ],
  vex: [
    { title: "Shadow of the Margins", text: "Vex lives in the white space around the words, where no one looks. It is the best place to hide and the best place to learn." },
    { title: "Two Blades, One Answer", text: "Every bane is a door left open. Vex walks through two of them without being seen." },
    { title: "Eclipse", text: "For one fight, Vex steps into the middle of the page, where everyone can see." },
  ],
  thorne: [
    { title: "The Closing Book", text: "Thorne carried the library's last book out of the fire. He has not let anyone open it since." },
    { title: "The Shield's Oath", text: "Each blow he stops leaves a letter scratched on his shield. Two banes in, the letters start to make a word." },
    { title: "The Closing Chapter", text: "The word is a name: his own. He opens the book at last, on the hardest fight, and reads the ending aloud." },
  ],
};
export const storyId = (c: string, n: number) => `story:${c}:${n}`;
export function storyDef(id: string) {
  const m = /^story:([a-z]+):([1-3])$/.exec(id);
  if (!m || !(CHAMPIONS as readonly string[]).includes(m[1])) return null;
  const c = m[1] as Champion, n = Number(m[2]), name = c[0].toUpperCase() + c.slice(1);
  const g = GOALS[n - 1], ch = STORIES[c][n - 1];
  return { id, champion: c, chapter: n, title: `${name} · ${ch.title}`, text: ch.text, goal: g.goal.replace("{name}", name), event: g.event(c), target: g.target, reward: g.reward, call: { place: "arena" } as Call };
}

/** What a scroll is, by id (weekly trial, hunt or story chapter). */
function defOf(id: string): { title: string; text: string; event: string; target: number; reward: Reward; call: Call; kind: ScrollKind } | null {
  const trial = TRIALS.find((t) => t.id === id);
  if (trial) return { ...trial, kind: "weekly" };
  const hunt = huntDef(id);
  if (hunt) return { ...hunt, target: 1, kind: "hunt" };
  const story = storyDef(id);
  if (story) return { title: story.title, text: `${story.text} ${story.goal}`, event: story.event, target: story.target, reward: story.reward, call: story.call, kind: "story" };
  return null;
}

// ── moving scrolls on ────────────────────────────────────────────────────────────────────────────────────────
/** Something happened: every open scroll waiting on these events moves on (one statement). */
export async function scrollEvent(ctx: RequestContext, userId: number, events: string[], amount = 1): Promise<void> {
  if (!events.length) return;
  const t = nowIso();
  await ctx.db.update(questScrolls).set({
    progress: sql`MIN(${questScrolls.target}, ${questScrolls.progress} + ${amount})`,
    completedAt: sql`CASE WHEN ${questScrolls.progress} + ${amount} >= ${questScrolls.target} THEN ${t} ELSE NULL END`,
  }).where(and(eq(questScrolls.userId, userId), inArray(questScrolls.event, events), isNull(questScrolls.completedAt), isNull(questScrolls.claimedAt)));
}

/** The events a finished, won fight sets off (the arena calls this). */
export function fightEvents(o: { species: string; difficulty: string; champion: string }): string[] {
  const hard = o.difficulty === "hard" || o.difficulty === "nightmare";
  return [
    `win:${o.species}`, `win_as:${o.champion}`,
    ...(o.difficulty === "nightmare" ? [`nightmare_win:${o.species}`] : []),
    ...(hard ? ["hard_win", `hard_win_as:${o.champion}`] : []),
  ];
}

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────
type Row = typeof questScrolls.$inferSelect;
const view = (r: Row) => {
  const d = defOf(r.scrollId)!;
  return {
    id: r.scrollId, kind: d.kind, title: d.title, text: d.text, target: r.target, progress: Math.min(r.progress, r.target),
    completed: !!r.completedAt, claimed: !!r.claimedAt, reward: d.reward, call: d.call, period: r.period,
    ...(d.kind === "hunt" ? { lost_page: huntDef(r.scrollId)!.species } : {}),
  };
};

/** Post what is due (this week's trials, hunts up to two at a time, the current champion's next chapter). */
async function post(ctx: RequestContext, p: Player, week: string, rows: Row[], recs: Map<string, RecordRow>, champion: Champion | null) {
  const have = new Set(rows.map((r) => `${r.scrollId}|${r.period}`));
  const t = nowIso();
  const fresh: (typeof questScrolls.$inferInsert)[] = [];
  for (const tr of trialsFor(p.id, week)) {
    if (!have.has(`${tr.id}|${week}`)) fresh.push({ userId: p.id, scrollId: tr.id, period: week, kind: "weekly", event: tr.event, target: tr.target, createdAt: t });
  }
  const openHunts = rows.filter((r) => r.kind === "hunt" && !r.claimedAt).length;
  const posted = new Set(rows.filter((r) => r.kind === "hunt").map((r) => r.scrollId));
  for (const id of huntsWanted(recs).filter((h) => !posted.has(h)).slice(0, Math.max(0, HUNTS_AT_ONCE - openHunts))) {
    const h = huntDef(id)!;
    fresh.push({ userId: p.id, scrollId: id, period: "", kind: "hunt", event: h.event, target: 1, createdAt: t });
  }
  if (champion) {
    const mine = rows.filter((r) => r.kind === "story" && r.scrollId.startsWith(`story:${champion}:`));
    const next = mine.length === 0 ? 1 : mine.every((r) => r.claimedAt) && mine.length < 3 ? mine.length + 1 : null;
    if (next) { const s = storyDef(storyId(champion, next))!; fresh.push({ userId: p.id, scrollId: s.id, period: "", kind: "story", event: s.event, target: s.target, createdAt: t }); }
  }
  if (!fresh.length) return false;
  const stmts = fresh.map((f) => ctx.db.insert(questScrolls).values(f).onConflictDoNothing());
  await ctx.db.batch(stmts as [typeof stmts[0], ...typeof stmts]);
  return true;
}

/** GET /quests: the whole board, scroll by scroll. */
export async function questBoard(ctx: RequestContext, p: Player) {
  const prog = await getProgress(ctx, p.id);
  const week = weekOf(localDate(p.tz));
  const read = () => ctx.db.select().from(questScrolls).where(and(eq(questScrolls.userId, p.id), or(eq(questScrolls.period, week), eq(questScrolls.period, "")))).all();
  const [daily, avatar, roster] = await Promise.all([dailyQuestsFor(ctx, p, prog), getAvatar(ctx, p.id), rosterReads(ctx, p.id)]);
  const cid = (CHAMPIONS as readonly string[]).includes(avatar.championId ?? "") ? avatar.championId as Champion : "kaien";
  const champion = isUnlocked(cid, roster.rows) ? cid : "kaien";
  let rows = await read();
  if (await post(ctx, p, week, rows, roster.recs, champion)) rows = await read();
  // hunts already claimed and finished chapters stay off the board (their pages and story are in the book / done list)
  const live = rows.filter((r) => !(r.claimedAt && r.kind === "hunt"));
  const story = rows.filter((r) => r.kind === "story" && r.scrollId.startsWith(`story:${champion}:`));
  const current = story.find((r) => !r.claimedAt) ?? null;
  const chapters = story.filter((r) => r.claimedAt).length;
  return {
    week, daily,
    weekly: live.filter((r) => r.kind === "weekly" && r.period === week).map(view),
    hunts: live.filter((r) => r.kind === "hunt").sort((a, b) => huntOrder(a.scrollId) - huntOrder(b.scrollId)).map(view),
    story: { champion, chapters_done: chapters, chapters: 3, scroll: current ? view(current) : null },
  };
}

/** POST /quests/claim: break the seal of a finished scroll and pay it once (a hunt also finds its lost page). */
export async function claimScroll(ctx: RequestContext, p: Player, id: unknown) {
  const d = typeof id === "string" ? defOf(id) : null;
  if (!d) throw new HttpError(404, "scroll_not_found", "There's no such quest.");
  const t = nowIso();
  const period = d.kind === "weekly" ? weekOf(localDate(p.tz)) : "";
  const won = await ctx.db.update(questScrolls).set({ claimedAt: t })
    .where(and(eq(questScrolls.userId, p.id), eq(questScrolls.scrollId, id as string), eq(questScrolls.period, period), sql`${questScrolls.completedAt} IS NOT NULL`, isNull(questScrolls.claimedAt)))
    .returning({ s: questScrolls.scrollId }).all();
  if (!won.length) {
    const row = await ctx.db.select().from(questScrolls).where(and(eq(questScrolls.userId, p.id), eq(questScrolls.scrollId, id as string), eq(questScrolls.period, period))).get();
    if (!row) throw new HttpError(404, "scroll_not_found", "That quest isn't on your board.");
    if (row.claimedAt) throw new HttpError(409, "scroll_claimed", "Its seal is already broken.");
    throw new HttpError(409, "scroll_not_done", "Finish the quest first.");
  }
  const paid = await recordRewardEvent(ctx, p.id, `scroll_${d.kind}`, d.reward.xp, d.reward.coins, id as string, `u${p.id}:scroll:${id}:${period}`);
  let lostPage: string | null = null;
  if (d.kind === "hunt") {
    lostPage = huntDef(id as string)!.species;
    await ctx.db.insert(bestiaryRecords).values({ userId: p.id, species: lostPage, lostPage: true, updatedAt: t })
      .onConflictDoUpdate({ target: [bestiaryRecords.userId, bestiaryRecords.species], set: { lostPage: true, updatedAt: t } });
  }
  const newly = await checkAchievements(ctx, p.id);
  return {
    ok: true, id, kind: d.kind, reward: paid.applied ? d.reward : { xp: 0, coins: 0 }, lost_page: lostPage,
    totals: { total_xp: paid.total_xp, coins: paid.coins, level: paid.level }, new_achievements: newly,
  };
}
