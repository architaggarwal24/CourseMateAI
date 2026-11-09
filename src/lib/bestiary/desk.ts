// The Scholar's desk around the Bestiary (round 7): what the side panels and the creature pages say, worked out from
// the book's data (GET /bestiary) - the hunt record, the tier map, fight notes, and which pages were newly written or
// unsealed since you last opened the book (the unlock rituals). Pure functions, so they're easy to test.
import type { BestiaryEntry, BestiaryResponse } from "@/lib/arena/types";

export const SILVER_WINS = 5;                       // server/game/tome.ts: bronze at a first win, silver at five, gold flawless/nightmare
export const ROMAN = ["", "I", "II", "III", "IV"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "today", "yesterday", "3 days ago", "2 weeks ago" (from an ISO time). */
export function ago(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** The Scribe's notes on your fights with one creature: how they went, and what the next seal asks. */
export function fightNotes(c: BestiaryEntry, now = new Date()): string[] {
  const r = c.record;
  if (!c.open) return [];
  if (!r || !r.fights) return ["Not yet faced. Its page fills in as you fight it."];
  const out: string[] = [];
  if (!r.wins) out.push(`Faced ${plural(r.fights, "time")}; it still stands.`);
  else out.push(`Beaten ${r.wins} of ${plural(r.fights, "fight")} (${Math.round((r.wins / r.fights) * 100)}%).`);
  if (r.flawless_wins) out.push(`${plural(r.flawless_wins, "flawless victory", "flawless victories")}.`);
  if (r.nightmare_wins) out.push(`Its Elder form fell ${plural(r.nightmare_wins, "time")}.`);
  const last = ago(r.last_fought_at, now);
  if (last) out.push(`Last met ${last}.`);
  if (c.mastery === "none") out.push("A first victory earns the bronze seal.");
  else if (c.mastery === "bronze") out.push(`${plural(Math.max(1, SILVER_WINS - r.wins), "more victory", "more victories")} for the silver seal; a flawless win on hard, or any nightmare win, for gold.`);
  else if (c.mastery === "silver") out.push("A flawless win on hard, or any nightmare win, earns the gold seal.");
  return out;
}

export interface HuntTotals {
  hunts: number; victories: number; losses: number; flawless: number; elder: number;
  seals: { gold: number; silver: number; bronze: number };
  banes: number; lostPages: number; written: number; total: number;
  fastest: { name: string; seconds: number } | null;
  sharpest: { name: string; accuracy: number } | null;
  last: { name: string; species: string; when: string } | null;
}

/** The hunt record: every fight, seal, bane and lost page in the book. */
export function huntTotals(data: BestiaryResponse, now = new Date()): HuntTotals {
  const t: HuntTotals = { hunts: 0, victories: 0, losses: 0, flawless: 0, elder: 0, seals: { gold: 0, silver: 0, bronze: 0 },
    banes: 0, lostPages: 0, written: 0, total: data.creatures.length, fastest: null, sharpest: null, last: null };
  let lastAt = 0;
  for (const c of data.creatures) {
    const r = c.record;
    if (c.defeated) t.written++;
    if (c.mastery !== "none") t.seals[c.mastery]++;
    if (c.bane?.moves) t.banes++;
    if (c.lost_page) t.lostPages++;
    if (!r) continue;
    t.hunts += r.fights; t.victories += r.wins; t.losses += r.losses; t.flawless += r.flawless_wins; t.elder += r.nightmare_wins;
    const name = c.name ?? "A sealed creature";
    if (r.best_seconds !== null && (!t.fastest || r.best_seconds < t.fastest.seconds)) t.fastest = { name, seconds: r.best_seconds };
    if (r.best_accuracy !== null && (!t.sharpest || r.best_accuracy > t.sharpest.accuracy)) t.sharpest = { name, accuracy: r.best_accuracy };
    const at = r.last_fought_at ? new Date(r.last_fought_at).getTime() : 0;
    if (at > lastAt) { lastAt = at; t.last = { name, species: c.species, when: ago(r.last_fought_at, now) ?? "" }; }
  }
  return t;
}

/** What to hunt next: the first open creature not yet beaten (else the first without a gold seal), in book order. */
export function nextQuarry(data: BestiaryResponse): BestiaryEntry | null {
  return data.creatures.find((c) => c.open && !c.defeated && c.name) ?? data.creatures.find((c) => c.open && c.mastery !== "gold" && c.name) ?? null;
}

export interface TierStop { tier: number; roman: string; name: string; open: boolean; beaten: number; total: number; here: boolean; hint: string | null }

/** The tier map: each tier, whether it's open, and where you are (the highest open tier). */
export function tierMap(data: BestiaryResponse): TierStop[] {
  const highest = Math.max(0, ...data.tiers.filter((t) => t.open).map((t) => t.tier));
  return data.tiers.map((t) => {
    const prev = data.tiers.find((p) => p.tier === t.tier - 1);
    const need = prev && prev.opens_next_at !== null ? Math.max(0, prev.opens_next_at - prev.beaten) : 0;
    return {
      tier: t.tier, roman: ROMAN[t.tier], name: t.open ? t.name : "Sealed", open: t.open, beaten: t.beaten, total: t.total,
      here: t.tier === highest,
      hint: !t.open && prev ? `Beat ${plural(Math.max(1, need), "more creature")} of tier ${ROMAN[prev.tier]} to break this seal.` : null,
    };
  });
}

// ── the unlock rituals ────────────────────────────────────────────────────────────────────────────────────────
/** What the book has already shown you: pages written in full (a first win) and tiers unsealed. */
export interface Seen { written: string[]; tiers: number[] }
const SEEN_KEY = "cmai_tome_seen_v1";

export function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Seen>;
    return { written: Array.isArray(v.written) ? v.written : [], tiers: Array.isArray(v.tiers) ? v.tiers : [] };
  } catch { return null; }
}
export function writeSeen(s: Seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* private mode: the rituals may replay */ }
}
export const seenNow = (data: BestiaryResponse): Seen => ({
  written: data.creatures.filter((c) => c.defeated).map((c) => c.species),
  tiers: data.tiers.filter((t) => t.open).map((t) => t.tier),
});

export interface Rituals {
  /** Pages written in full since you last looked: their ink burns in when the page opens. */
  burn: string[];
  /** Tiers unsealed since you last looked: the wax seal on the tier's first page cracks when it opens. */
  seals: number[];
}

/**
 * The rituals still to play. The first time the book is opened on this device nothing plays: what's already there
 * counts as seen (no flood of animations for a long-time player).
 */
export function pendingRituals(data: BestiaryResponse, seen: Seen | null): Rituals {
  if (!seen) return { burn: [], seals: [] };
  return {
    burn: data.creatures.filter((c) => c.defeated && !seen.written.includes(c.species)).map((c) => c.species),
    seals: data.tiers.filter((t) => t.open && t.tier > 1 && !seen.tiers.includes(t.tier)).map((t) => t.tier),
  };
}

/** A ritual played: remember it. */
export function markSeen(seen: Seen, done: { species?: string; tier?: number }): Seen {
  return {
    written: done.species && !seen.written.includes(done.species) ? [...seen.written, done.species] : seen.written,
    tiers: done.tier !== undefined && !seen.tiers.includes(done.tier) ? [...seen.tiers, done.tier] : seen.tiers,
  };
}
