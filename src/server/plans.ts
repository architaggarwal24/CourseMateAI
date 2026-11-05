// Plans: what each one unlocks and allows (the TypeScript port of backend/services/entitlements.py, Stage 4.1).
// A user's plan is their user_plans row while it hasn't expired (an admin, an invite code, later a subscription),
// else Free (Apprentice). The owner (OWNER_EMAIL, verified) is always on the top plan.
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { userPlans } from "./db/schema";
import { HttpError } from "./http";

export const TIERS = ["apprentice", "scholar", "sage", "archmage"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_NAMES: Record<Tier, string> = { apprentice: "Apprentice", scholar: "Scholar", sage: "Sage", archmage: "Archmage" };
export const DEFAULT_TIER: Tier = "apprentice";
export const OWNER_TIER: Tier = "archmage";

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** feature -> the lowest tier that has it */
export const FEATURES = {
  review_queue: "scholar",
  exam_mode: "sage",
  courses: "sage",
  concept_map: "sage",
  pdf_viewer: "sage",
} as const satisfies Record<string, Tier>;
export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES: Record<Feature, string> = {
  review_queue: "Spaced-repetition review", exam_mode: "Exam mode", courses: "Courses",
  concept_map: "The concept map", pdf_viewer: "The PDF page viewer",
};

export const LIMIT_KEYS = ["documents", "pdf_mb", "ai_calls_day", "tokens_month", "courses"] as const;
export type Limits = Record<(typeof LIMIT_KEYS)[number], number>;

export const PLANS: Record<Tier, { price_month: number; price_year: number } & Limits> = {
  apprentice: { price_month: 0, price_year: 0, documents: 3, pdf_mb: 10, ai_calls_day: 25, tokens_month: 300_000, courses: 0 },
  scholar: { price_month: 149, price_year: 1490, documents: 15, pdf_mb: 25, ai_calls_day: 150, tokens_month: 3_000_000, courses: 0 },
  sage: { price_month: 299, price_year: 2990, documents: 50, pdf_mb: 50, ai_calls_day: 400, tokens_month: 10_000_000, courses: 10 },
  archmage: { price_month: 599, price_year: 5990, documents: 150, pdf_mb: 50, ai_calls_day: 1200, tokens_month: 30_000_000, courses: 30 },
};
const TAGLINES: Record<Tier, string> = {
  apprentice: "Try every core tool on a few PDFs.",
  scholar: "For a semester: more PDFs and the daily review queue.",
  sage: "Courses, exams, the concept map and the PDF viewer.",
  archmage: "Everything, with the most room and the strongest models.",
};
const HIGHLIGHTS: Record<Tier, string[]> = {
  apprentice: ["Chat, quizzes, notes and flashcards", "The arena and your champion"],
  scholar: ["Everything in Apprentice", "Spaced-repetition review"],
  sage: ["Everything in Scholar", "Courses across PDFs", "Mock exams with a report", "Concept map and PDF viewer"],
  archmage: ["Everything in Sage", "Strongest models first", "The largest limits"],
};

/** PLAN_LIMITS_JSON: optional overrides, e.g. {"scholar": {"ai_calls_day": 200}} */
function overrides(env: Record<string, string | undefined>): Partial<Record<Tier, Partial<Limits>>> {
  const raw = (env.PLAN_LIMITS_JSON || "").trim();
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    const out: Partial<Record<Tier, Partial<Limits>>> = {};
    for (const t of TIERS) {
      for (const k of LIMIT_KEYS) {
        const v = data?.[t]?.[k];
        if (Number.isInteger(v)) (out[t] ??= {})[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function limits(tier: Tier, env: Record<string, string | undefined> = process.env): Limits {
  const base = Object.fromEntries(LIMIT_KEYS.map((k) => [k, PLANS[tier][k]])) as Limits;
  return { ...base, ...overrides(env)[tier] };
}

export function has(tier: Tier, feature: Feature): boolean {
  return TIERS.indexOf(tier) >= TIERS.indexOf(FEATURES[feature]);
}

export function plansCatalog(env: Record<string, string | undefined> = process.env) {
  return TIERS.map((t) => ({
    tier: t, name: TIER_NAMES[t], tagline: TAGLINES[t], price_month: PLANS[t].price_month, price_year: PLANS[t].price_year,
    currency: "INR", limits: limits(t, env), features: (Object.keys(FEATURES) as Feature[]).filter((f) => has(t, f)),
    highlights: HIGHLIGHTS[t],
  }));
}

export type PlanRow = typeof userPlans.$inferSelect;

export function nowIso(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The user's plan row while it is in force, else null. */
export async function planRow(db: Db, userId: number, now: Date = new Date()): Promise<PlanRow | null> {
  const row = await db.select().from(userPlans).where(eq(userPlans.userId, userId)).get();
  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt) <= now) return null;
  return row;
}

export interface PlanHolder { id: number; owner: boolean }

export async function tierFor(db: Db, who: PlanHolder, now: Date = new Date()): Promise<Tier> {
  if (who.owner) return OWNER_TIER;
  const row = await planRow(db, who.id, now);
  return row && isTier(row.tier) ? row.tier : DEFAULT_TIER;
}

export async function entitlementsSummary(db: Db, who: PlanHolder) {
  const tier = await tierFor(db, who);
  return {
    tier, tier_name: TIER_NAMES[tier],
    features: Object.fromEntries((Object.keys(FEATURES) as Feature[]).map((f) => [f, {
      enabled: has(tier, f), required_tier: FEATURES[f], required_tier_name: TIER_NAMES[FEATURES[f]], name: FEATURE_NAMES[f],
    }])),
  };
}

function nextDay(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return nowIso(d);
}
function nextMonth(now: Date): string {
  return nowIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
}

/** GET /account/usage. The meters fill in as documents (4.2) and AI calls (4.3) move to the Worker. */
export async function usageSummary(db: Db, who: PlanHolder, used: { ai_calls_day?: number; tokens_month?: number; documents?: number; courses?: number; history?: { day: string; ai_calls: number; tokens: number }[] } = {}, now: Date = new Date()) {
  const tier = await tierFor(db, who, now);
  const row = who.owner ? null : await planRow(db, who.id, now);
  return {
    tier, tier_name: TIER_NAMES[tier],
    source: who.owner ? "owner" : row ? row.source : "default",
    expires_at: row?.expiresAt ?? null,
    limits: limits(tier),
    used: { ai_calls_day: used.ai_calls_day ?? 0, tokens_month: used.tokens_month ?? 0, documents: used.documents ?? 0, courses: used.courses ?? 0 },
    own_key: { active: false, exempt: false, calls_today: 0, tokens_month: 0 },
    resets: { ai_calls_day: nextDay(now), tokens_month: nextMonth(now) },
    history: used.history ?? [],
  };
}

function lowestTierWith(key: (typeof LIMIT_KEYS)[number], needed: number): Tier | null {
  return TIERS.find((t) => limits(t)[key] >= needed) ?? null;
}

/** The error for a plan limit: 403 (documents, size, courses) or 429 (AI calls, tokens), action "plans". */
export function planLimit(tier: Tier, key: (typeof LIMIT_KEYS)[number], used: number, allowed: number, message: string,
  { status = 403, resetsAt }: { status?: number; resetsAt?: string } = {}): HttpError {
  let up: Tier | null = TIERS.indexOf(tier) < TIERS.length - 1 ? lowestTierWith(key, Math.max(allowed + 1, used + 1)) : null;
  if (up && TIERS.indexOf(up) <= TIERS.indexOf(tier)) up = TIERS[TIERS.indexOf(tier) + 1] ?? null;
  const details: Record<string, unknown> = {
    limit: key, used, allowed, tier, tier_name: TIER_NAMES[tier], upgrade_tier: up, upgrade_tier_name: up ? TIER_NAMES[up] : null,
  };
  if (resetsAt) details.resets_at = resetsAt;
  return new HttpError(status, "plan_limit", message, "plans", details);
}

/** 403 feature_locked unless the plan has `feature`. */
export function requireFeature(tier: Tier, feature: Feature): void {
  if (has(tier, feature)) return;
  const need = FEATURES[feature];
  throw new HttpError(403, "feature_locked", `${FEATURE_NAMES[feature]} comes with the ${TIER_NAMES[need]} plan.`, "plans",
    { feature, tier, required_tier: need, required_tier_name: TIER_NAMES[need] });
}
