// Seasonal events (the two worlds, Stage 7): dated windows when the Hero world changes - a banner, a themed stage and
// a limited boss built from what you studied that month. Shared by the server (the fight) and the client (banners).
export interface Season {
  id: string;
  name: string;
  tagline: string;
  /** The creature it sends, and what it's called this season. */
  boss: string;
  bossName: string;
  /** Where it's fought (lib/pixel/stages.ts). */
  stage: string;
  /** Month-day windows it runs in, every year (inclusive). */
  windows: [string, string][];
  reward: { xp: number; coins: number };
  /** The season's colour (banners). */
  tint: string;
}

export const SEASONS: Season[] = [
  {
    id: "finals", name: "Finals Week", tagline: "The Exam Warden rises from everything you studied this month.",
    boss: "sphinx", bossName: "The Exam Warden", stage: "exam-hall", windows: [["12-01", "12-21"], ["04-25", "05-20"]],
    reward: { xp: 200, coins: 250 }, tint: "#fde68a",
  },
  {
    id: "lanterns", name: "Lantern Night", tagline: "When the lanterns are lit, the fox comes for what you learned.",
    boss: "kitsune", bossName: "The Lantern Fox", stage: "shrine", windows: [["10-24", "11-02"]],
    reward: { xp: 150, coins: 200 }, tint: "#fb923c",
  },
];

const md = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The season on now (by the date where you are), if any. */
export function activeSeason(now = new Date()): Season | null {
  const today = md(now);
  return SEASONS.find((s) => s.windows.some(([a, b]) => today >= a && today <= b)) ?? null;
}

export const seasonById = (id: string | null | undefined): Season | null => SEASONS.find((s) => s.id === id) ?? null;

/** One season's run this year: its boss's bonus is paid once per key. */
export const seasonKey = (s: Season, now = new Date()) => `${s.id}:${now.getFullYear()}`;

/** How far back "this month" looks for the season boss's concepts. */
export const SEASON_DAYS = 30;
export const SEASON_MIN_CONCEPTS = 3;

/**
 * An admin can preview a season out of its dates: ?season-preview=<id> once (on any page), then it's remembered in this
 * browser; ?season-preview= (empty) clears it. The server ignores it for anyone who isn't an admin.
 */
export function seasonPreview(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("season-preview");
    if (q !== null) { if (q) localStorage.setItem("cmai_season_preview", q); else localStorage.removeItem("cmai_season_preview"); }
    return localStorage.getItem("cmai_season_preview");
  } catch { return null; }
}
