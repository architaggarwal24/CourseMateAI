// A copy of your data (legal and trust pass, BreakingBreach launch checklist item 13: access requests). Everything
// the app keeps about you, as one JSON file: the profile, plan, documents and courses (their details; the PDFs are
// yours already), study history, game progress, payments' status and the deletion log. Never in it: password
// hashes, sign-in sessions and tokens, two-step secrets, or cached AI output.
import { eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { CurrentUser, RequestContext } from "../context";
import * as s from "../db/schema";

/** The tables a person's rows are copied from, by the name they get in the file. */
const TABLES: Record<string, SQLiteTable & { userId: SQLiteColumn }> = {
  plans: s.userPlans, documents: s.documents, courses: s.courses, trash: s.trash, usage_by_day: s.usageDaily,
  activity: s.activityLog, quizzes: s.quizzes, quiz_bank: s.quizBank, concept_mastery: s.conceptMastery,
  missed_questions: s.missedQuestions, review_cards: s.reviewItems, review_log: s.reviewLogs, exams: s.exams,
  progress: s.userProgress, rewards: s.rewardEvents, avatar: s.userAvatar, bestiary: s.bestiaryRecords,
  champions: s.championProgress, champion_challenges: s.championChallenges, champion_unlocks: s.championUnlocks,
  hero: s.heroState, items: s.itemProgress, forge_materials: s.forgeMaterials, quests: s.questScrolls,
  daily_quests: s.dailyQuests, achievements: s.userAchievements, inventory: s.userInventory, buffs: s.userBuffs,
  arena_battles: s.arenaBattles, arena_scores: s.arenaScores, arena_bests: s.arenaPersonalBests, expeditions: s.arenaRuns,
  gauntlets: s.arenaGauntlets, subscriptions: s.subscriptions, deletion_log: s.deletionLog,
} as never;

/** Inside some rows: never handed out, even to their owner (keys and signatures from the payment provider). */
const NEVER = new Set(["secret", "signature", "token", "password"]);
const clean = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => ![...NEVER].some((n) => k.toLowerCase().includes(n))));

export async function exportData(ctx: RequestContext, u: CurrentUser, now = new Date()) {
  const r = u.row;
  const out: Record<string, unknown> = {
    exported_at: now.toISOString(),
    about: "Everything CourseMateAI keeps about your account. Your PDFs themselves aren't included: you uploaded them.",
    profile: {
      id: r.id, name: r.name, username: r.displayUsername || r.username, email: r.email, email_verified: r.emailVerified,
      created_at: r.createdAt, timezone: r.timezone, two_step_sign_in: !!r.twoFactorEnabled,
      terms_version: r.termsVersion ?? null, terms_accepted_at: r.termsAcceptedAt ?? null,
    },
  };
  for (const [name, table] of Object.entries(TABLES)) {
    const rows = await ctx.db.select().from(table).where(eq(table.userId, u.id)).all();
    out[name] = (rows as Record<string, unknown>[]).map((row) => {
      const c = clean(row);
      if (name === "trash" && typeof c.row === "string") delete c.row;               // its details, not the stored copy
      return c;
    });
  }
  return out;
}
