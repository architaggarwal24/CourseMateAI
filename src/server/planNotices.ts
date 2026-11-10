// "You've been upgraded": when a plan goes up (or, from an admin or an invite code, gets longer), the user gets a
// notice that the app shows once, as a congratulations window, on whichever device opens first (seen_at).
//
// Every place that changes a plan reads the plan before (planState), makes the change, then calls notePlanChange.
// A notice compares against the plan before the first change the user hasn't seen yet, so quick corrections fold
// into one window: owner gives Sage, then fixes it to Scholar -> one "upgraded to Scholar"; gives Sage, then takes it
// away -> no window at all. Payments only celebrate a higher plan, never the monthly renewal that pushes the end on.
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import type { Db } from "./db";
import { planNotices, user as userTable } from "./db/schema";
import { DEFAULT_TIER, FEATURES, FEATURE_NAMES, TIERS, TIER_NAMES, has, limits, nowIso, planRow, type Feature, type Tier } from "./plans";

export type PlanSource = "admin" | "invite" | "subscription";
export interface PlanState { tier: Tier; expiresAt: string | null }

/** The longest note an admin can leave with a plan. */
export const NOTE_MAX = 280;

const rank = (t: Tier) => TIERS.indexOf(t);

/** The plan in force now (an expired row counts as Free). */
export async function planState(db: Db, userId: number, now = new Date()): Promise<PlanState> {
  const row = await planRow(db, userId, now);
  return row ? { tier: row.tier, expiresAt: row.expiresAt } : { tier: DEFAULT_TIER, expiresAt: null };
}

/** Does `after` end later than `before`? (No end beats any end.) */
function longer(after: string | null, before: string | null): boolean {
  if (after === null) return before !== null;
  return before !== null && new Date(after).getTime() > new Date(before).getTime();
}

/** What changed, worth a window: a higher plan, or the same paid plan for longer. */
export function noticeKind(before: PlanState, after: PlanState, extensions: boolean): "upgrade" | "extend" | null {
  if (rank(after.tier) > rank(before.tier)) return "upgrade";
  if (extensions && after.tier === before.tier && after.tier !== DEFAULT_TIER && longer(after.expiresAt, before.expiresAt)) return "extend";
  return null;
}

/** An admin's note: trimmed, at most NOTE_MAX characters, or null. */
export function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const t = note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t || null;
}

/**
 * A plan just changed: replace the notices not yet seen with one that tells the change since the user last looked
 * (or none, if the plan is no better than it was).
 */
export async function notePlanChange(db: Db, userId: number, before: PlanState,
  opts: { source: PlanSource; note?: string | null; grantedBy?: number | null }, now = new Date()) {
  const after = await planState(db, userId, now);
  const pending = await db.select().from(planNotices)
    .where(and(eq(planNotices.userId, userId), isNull(planNotices.seenAt))).orderBy(desc(planNotices.id)).get();
  const base: PlanState = pending ? { tier: pending.fromTier, expiresAt: pending.fromExpiresAt } : before;
  const kind = noticeKind(base, after, opts.source !== "subscription");
  if (pending) await db.delete(planNotices).where(and(eq(planNotices.userId, userId), isNull(planNotices.seenAt)));
  if (!kind) return null;
  // A later change with no note of its own keeps the admin's note from the change it folds into.
  const note = opts.note ?? (pending && opts.source === "admin" && pending.source === "admin" ? pending.note : null);
  const grantedBy = opts.grantedBy ?? (note && pending ? pending.grantedBy : null);
  const [row] = await db.insert(planNotices).values({
    userId, kind, tier: after.tier, fromTier: base.tier, fromExpiresAt: base.expiresAt, source: opts.source,
    expiresAt: after.expiresAt, note, grantedBy, createdAt: nowIso(now),
  }).returning();
  return row;
}

const GAIN_KEYS = ["documents", "courses", "ai_calls_day", "pdf_mb"] as const;

/** The window's content: what the plan is now, what's new, who it's from. */
export function noticeView(n: typeof planNotices.$inferSelect, fromName: string | null) {
  const before = limits(n.fromTier), after = limits(n.tier);
  const unlocked = (Object.keys(FEATURES) as Feature[])
    .filter((f) => has(n.tier, f) && !has(n.fromTier, f))
    .map((f) => ({ feature: f, name: FEATURE_NAMES[f] }));
  const gains = GAIN_KEYS.filter((k) => after[k] > before[k]).map((k) => ({ key: k, from: before[k], to: after[k] }));
  return {
    id: n.id, kind: n.kind, tier: n.tier, tier_name: TIER_NAMES[n.tier], from_tier: n.fromTier, from_tier_name: TIER_NAMES[n.fromTier],
    source: n.source, expires_at: n.expiresAt, from_expires_at: n.fromExpiresAt, note: n.note, from_name: fromName,
    unlocked, gains, created_at: n.createdAt,
  };
}
export type PlanNoticeView = ReturnType<typeof noticeView>;

/**
 * The notice to show now, if any. One whose plan is no longer in force (it ran out before the user came back, or
 * was taken away) is quietly marked seen instead.
 */
export async function pendingPlanNotice(db: Db, userId: number, now = new Date()): Promise<PlanNoticeView | null> {
  const n = await db.select().from(planNotices)
    .where(and(eq(planNotices.userId, userId), isNull(planNotices.seenAt))).orderBy(desc(planNotices.id)).get();
  if (!n) return null;
  const current = await planState(db, userId, now);
  if (current.tier !== n.tier) {
    await markPlanNoticeSeen(db, userId, n.id, now);
    return null;
  }
  let fromName: string | null = null;
  if (n.source === "admin" && n.grantedBy) {
    const g = await db.select({ name: userTable.name, username: userTable.displayUsername }).from(userTable).where(eq(userTable.id, n.grantedBy)).get();
    fromName = (g?.name || g?.username || "").trim() || null;
  }
  return noticeView({ ...n, expiresAt: current.expiresAt }, fromName);
}

/** Shown: this notice and any older one are done, everywhere. */
export async function markPlanNoticeSeen(db: Db, userId: number, id: number, now = new Date()): Promise<void> {
  await db.update(planNotices).set({ seenAt: nowIso(now) })
    .where(and(eq(planNotices.userId, userId), lte(planNotices.id, id), isNull(planNotices.seenAt)));
}
