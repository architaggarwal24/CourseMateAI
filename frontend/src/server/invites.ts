// Invite codes and plan grants (the TypeScript port of backend/services/invite_service.py, Stage 4.1).
// A code grants a plan for some days (or for good), to up to `max_uses` people, until it expires or is revoked.
// Redeeming never lowers a plan in force: a code for a lower plan is refused; one for the same plan adds its days.
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { inviteCodes, inviteRedemptions, userPlans } from "./db/schema";
import { HttpError } from "./http";
import { TIER_NAMES, TIERS, isTier, nowIso, planRow, type Tier } from "./plans";

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";          // no 0/O, 1/I
const DAY = 86_400_000;

export function normaliseCode(code: string): string {
  return (code || "").replace(/\s+/g, "").toUpperCase();
}

function invalid(message = "That invite code isn't valid."): HttpError {
  return new HttpError(400, "invite_invalid", message, null, { field: "invite_code" });
}

export type InviteRow = typeof inviteCodes.$inferSelect;

export interface CreateInvite { tier: Tier; days?: number | null; maxUses?: number; code?: string; note?: string; validDays?: number | null; createdBy?: number }

export async function createInvite(db: Db, opts: CreateInvite, now = new Date()): Promise<InviteRow> {
  if (!isTier(opts.tier)) throw new HttpError(400, "invalid_tier", "Choose a plan for the code.");
  let code = opts.code ? normaliseCode(opts.code) : "";
  if (!code) {
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    code = `${opts.tier.slice(0, 4).toUpperCase()}-${[...rnd].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
  }
  if (!CODE_RE.test(code)) throw new HttpError(400, "invalid_code", "A code is 4-40 letters, digits and dashes.", null, { field: "code" });
  const maxUses = Math.max(1, Math.floor(opts.maxUses ?? 1));
  const days = opts.days ? Math.max(1, Math.floor(opts.days)) : null;
  const existing = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).get();
  if (existing) throw new HttpError(409, "code_taken", "That code already exists.", null, { field: "code" });
  await db.insert(inviteCodes).values({
    code, tier: opts.tier, days, maxUses, uses: 0, note: opts.note?.trim() || null, createdBy: opts.createdBy ?? null,
    createdAt: nowIso(now), expiresAt: opts.validDays ? nowIso(new Date(now.getTime() + opts.validDays * DAY)) : null, revoked: false,
  });
  return (await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).get())!;
}

export async function listInvites(db: Db): Promise<InviteRow[]> {
  return db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).all();
}

export async function revokeInvite(db: Db, code: string): Promise<boolean> {
  const res = await db.update(inviteCodes).set({ revoked: true }).where(eq(inviteCodes.code, normaliseCode(code))).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Put a user on a plan for `days` from now (or from `from`, to extend a plan still running). days null = no end. */
export async function setPlan(db: Db, userId: number, tier: Tier, opts: { days?: number | null; source?: "admin" | "invite" | "subscription"; ref?: string | null; grantedBy?: number | null; from?: Date | null } = {}, now = new Date()) {
  if (!isTier(tier)) throw new HttpError(400, "invalid_tier", "Choose a plan.");
  const start = opts.from && opts.from > now ? opts.from : now;
  const expiresAt = opts.days ? nowIso(new Date(start.getTime() + opts.days * DAY)) : null;
  const values = {
    userId, tier, source: opts.source ?? "admin", sourceRef: opts.ref ?? null, grantedBy: opts.grantedBy ?? null,
    startedAt: nowIso(now), expiresAt, updatedAt: nowIso(now),
  } as const;
  await db.insert(userPlans).values(values).onConflictDoUpdate({ target: userPlans.userId, set: values });
  return (await db.select().from(userPlans).where(eq(userPlans.userId, userId)).get())!;
}

export async function clearPlan(db: Db, userId: number): Promise<void> {
  await db.delete(userPlans).where(eq(userPlans.userId, userId));
}

export async function validateInvite(db: Db, code: string, now = new Date()): Promise<InviteRow> {
  const row = code ? await db.select().from(inviteCodes).where(eq(inviteCodes.code, normaliseCode(code))).get() : undefined;
  if (!row || row.revoked) throw invalid();
  if (row.expiresAt && new Date(row.expiresAt) <= now) throw invalid("That invite code has expired.");
  if (row.uses >= row.maxUses) throw invalid("That invite code has been used up.");
  return row;
}

/** Use a code for this user: their plan becomes the code's plan for its days. */
export async function redeemInvite(db: Db, userId: number, code: string, now = new Date()) {
  const row = await validateInvite(db, code, now);
  const used = await db.select().from(inviteRedemptions)
    .where(and(eq(inviteRedemptions.code, row.code), eq(inviteRedemptions.userId, userId))).get();
  if (used) throw invalid("You've already used this invite code.");
  const current = await planRow(db, userId, now);
  if (current && TIERS.indexOf(row.tier) < TIERS.indexOf(current.tier)) {
    throw invalid(`You're already on ${TIER_NAMES[current.tier]}; this code is for a lower plan.`);
  }
  let days = row.days;
  let from: Date | null = null;
  if (current && current.tier === row.tier && current.expiresAt && days) from = new Date(current.expiresAt);   // time adds up
  else if (current && current.tier === row.tier && !current.expiresAt) days = null;                           // stays for good
  // Count the use first, guarded, so two people racing for the last use can't both get it.
  const took = await db.update(inviteCodes).set({ uses: sql`${inviteCodes.uses} + 1` })
    .where(and(eq(inviteCodes.code, row.code), lt(inviteCodes.uses, row.maxUses), eq(inviteCodes.revoked, false))).run();
  if ((took.meta?.changes ?? 0) === 0) throw invalid("That invite code has been used up.");
  await db.insert(inviteRedemptions).values({ code: row.code, userId, redeemedAt: nowIso(now) });
  return setPlan(db, userId, row.tier, { days, source: "invite", ref: row.code, from }, now);
}
