// "You've been upgraded" (the window in components/fx/UpgradeCeremony.tsx): what it says, worked out from the
// server's notice (src/server/account/plan-notices.ts). Pure, so the words are easy to test.
import type { components } from "@/lib/api/generated/schema";
import { FEATURES, FEATURE_NAMES, TIERS, TIER_NAMES, type Feature, type Tier } from "@/lib/account/plan-tiers";
import { ROUTES } from "@/lib/routes";

export type PlanNotice = components["schemas"]["PlanNotice"];

/** Raised on window when the window opens: screens showing a locked feature ask the server again. */
export const PLAN_CHANGED_EVENT = "cmai:plan-changed";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const count = (n: number) => n.toLocaleString("en-IN");

const GAIN_TEXT: Record<PlanNotice["gains"][number]["key"], (to: string, from: string) => string> = {
  documents: (to, from) => `Up to ${to} PDFs (was ${from})`,
  courses: (to, from) => `${to} courses (was ${from})`,
  ai_calls_day: (to, from) => `${to} AI questions a day (was ${from})`,
  pdf_mb: (to, from) => `PDFs up to ${to} MB each (was ${from} MB)`,
};

/** Where each new feature lives, and the button that takes you there. */
const TRY: Record<string, { label: string; href: string }> = {
  review_queue: { label: "Start a review", href: ROUTES.studyTab("review") },
  exam_mode: { label: "Try a mock exam", href: ROUTES.studyTab("exam") },
  concept_map: { label: "Open the concept map", href: ROUTES.studyTab("map") },
  pdf_viewer: { label: "Ask the tutor", href: ROUTES.studyTab("chat") },
};

export interface NoticeTexts {
  /** "You've been upgraded to Sage" / "Your Sage plan got longer" */
  title: string;
  /** The short game-style title ("Upgraded!") */
  shout: string;
  /** Who or what it came from */
  from: string;
  /** The plan's end: "Until 10 Dec 2026" / "No end date" */
  until: string;
  /** What's new, one line each */
  lines: string[];
  /** The main button */
  cta: { label: string; href: string };
}

export function noticeTexts(n: PlanNotice): NoticeTexts {
  const upgrade = n.kind === "upgrade";
  const from = n.source === "admin" ? (n.from_name ? `A gift from ${n.from_name}` : "A gift from the CourseMateAI team")
    : n.source === "invite" ? "Your invite code worked"
    : "Payment received. Thank you!";
  const lines = upgrade
    ? [...n.unlocked.map((u) => u.name), ...n.gains.map((g) => GAIN_TEXT[g.key](count(g.to), count(g.from)))]
    : [n.expires_at ? `Now until ${date(n.expires_at)}${n.from_expires_at ? ` (was ${date(n.from_expires_at)})` : ""}` : "No end date any more"];
  const first = upgrade ? n.unlocked.find((u) => TRY[u.feature]) : undefined;
  return {
    title: upgrade ? `You've been upgraded to ${n.tier_name}` : `Your ${n.tier_name} plan got longer`,
    shout: upgrade ? "Upgraded!" : "Plan extended!",
    from,
    until: n.expires_at ? `Until ${date(n.expires_at)}` : "No end date",
    lines,
    cta: first ? TRY[first.feature] : { label: "See your plan", href: ROUTES.accountUsage },
  };
}

/** The confetti and the badge colour for each plan. */
export const TIER_RARITY: Record<PlanNotice["tier"], "common" | "rare" | "epic" | "legendary"> = {
  apprentice: "common", scholar: "rare", sage: "epic", archmage: "legendary",
};

/**
 * What the user would see if the admin saved this plan now (the admin page's preview), worked out the way the
 * server does: null when it isn't an upgrade or a longer plan, so there'd be no window.
 */
export function previewNotice(o: {
  fromTier: Tier; fromExpiresAt: string | null; toTier: Tier; days: number | null; note: string; fromName: string | null;
  limits: Partial<Record<Tier, Record<string, number>>>; now?: Date;
}): PlanNotice | null {
  const rank = (t: Tier) => TIERS.indexOf(t);
  const now = o.now ?? new Date();
  const expires = o.toTier === "apprentice" ? null : o.days ? new Date(now.getTime() + o.days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
  const longer = expires === null ? o.fromExpiresAt !== null : o.fromExpiresAt !== null && expires > o.fromExpiresAt;
  const kind = rank(o.toTier) > rank(o.fromTier) ? "upgrade"
    : o.toTier === o.fromTier && o.toTier !== "apprentice" && longer ? "extend" : null;
  if (!kind) return null;
  const has = (t: Tier, f: Feature) => rank(t) >= rank(FEATURES[f]);
  const before = o.limits[o.fromTier] ?? {}, after = o.limits[o.toTier] ?? {};
  const keys = ["documents", "courses", "ai_calls_day", "pdf_mb"] as const;
  return {
    id: 0, kind, tier: o.toTier, tier_name: TIER_NAMES[o.toTier], from_tier: o.fromTier, from_tier_name: TIER_NAMES[o.fromTier],
    source: "admin", expires_at: expires, from_expires_at: o.fromExpiresAt, note: o.note.replace(/\s+/g, " ").trim().slice(0, 280) || null,
    from_name: o.fromName, created_at: now.toISOString(),
    unlocked: (Object.keys(FEATURES) as Feature[]).filter((f) => has(o.toTier, f) && !has(o.fromTier, f)).map((f) => ({ feature: f, name: FEATURE_NAMES[f] })),
    gains: kind === "upgrade" ? keys.filter((k) => (after[k] ?? 0) > (before[k] ?? 0)).map((k) => ({ key: k, from: before[k] ?? 0, to: after[k] ?? 0 })) : [],
  };
}
