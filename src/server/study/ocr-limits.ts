// The daily cap on scanned pages and photos the AI reads (Files stage 4; the reading itself is study/ocr.ts).
// Kept apart from ocr.ts so the upload (study/documents.ts) can check it without importing the reader.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { usageDaily } from "../db/schema";
import { HttpError } from "../http";
import { dayOf } from "../ai/usage";
import type { Tier } from "../account/plans";

/** Scanned pages and photos the AI reads a day, per plan. */
export const OCR_PAGES_DAY: Record<Tier, number> = { apprentice: 10, scholar: 50, sage: 150, archmage: 400 };

function nextDay(now: Date) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(); }

/** Today's OCR pages, and the cap (null: no cap, the owner). */
export async function ocrToday(db: Db, who: { id: number; owner: boolean; tier: Tier }, now = new Date()) {
  const row = await db.select({ n: usageDaily.ocrPages }).from(usageDaily).where(and(eq(usageDaily.userId, who.id), eq(usageDaily.day, dayOf(now)))).get();
  return { used: row?.n ?? 0, allowed: who.owner ? null : OCR_PAGES_DAY[who.tier] };
}

function capReached(tier: Tier, allowed: number, now: Date) {
  return new HttpError(429, "plan_limit", `Your plan reads ${allowed} scanned pages or photos a day, and today's are used. They come back at midnight (UTC), or upgrade for more.`,
    "plans", { limit: "ocr_pages_day", allowed, resets_at: nextDay(now), tier });
}

/** Before an upload with scanned pages starts: refuse at once if they can't all be read today (nothing is spent). */
export async function checkOcrRoom(db: Db, who: { id: number; owner: boolean; tier: Tier }, pages: number, now = new Date()) {
  if (pages <= 0) return;
  const { used, allowed } = await ocrToday(db, who, now);
  if (allowed === null || used + pages <= allowed) return;
  const left = Math.max(0, allowed - used);
  throw new HttpError(429, "plan_limit",
    `This file has ${pages} scanned page${pages === 1 ? "" : "s"} to read, and your plan reads ${allowed} a day (${left} left today). Try a shorter part, come back tomorrow, or upgrade for more.`,
    "plans", { limit: "ocr_pages_day", allowed, used, needed: pages, resets_at: nextDay(now), tier: who.tier });
}

/** Take one of today's OCR pages, atomically (parallel pages can't pass the cap). false: the owner (no cap). */
export async function reserveOcrPage(db: Db, who: { id: number; owner: boolean; tier: Tier }, now = new Date()): Promise<boolean> {
  if (who.owner) return false;
  const allowed = OCR_PAGES_DAY[who.tier];
  const row = await db.insert(usageDaily).values({ userId: who.id, day: dayOf(now), aiCalls: 0, tokensIn: 0, tokensOut: 0, ocrPages: 1 })
    .onConflictDoUpdate({
      target: [usageDaily.userId, usageDaily.day],
      set: { ocrPages: sql`${usageDaily.ocrPages} + 1` },
      setWhere: sql`${usageDaily.ocrPages} < ${allowed}`,
    }).returning({ n: usageDaily.ocrPages }).get();
  if (!row || allowed <= 0) {
    if (row) await releaseOcrPage(db, who.id, now);
    throw capReached(who.tier, allowed, now);
  }
  return true;
}

export async function releaseOcrPage(db: Db, userId: number, now = new Date()) {
  await db.update(usageDaily).set({ ocrPages: sql`max(${usageDaily.ocrPages} - 1, 0)` })
    .where(and(eq(usageDaily.userId, userId), eq(usageDaily.day, dayOf(now))));
}
