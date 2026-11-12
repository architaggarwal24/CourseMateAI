// The two worlds (Stage 1 of the two-worlds UI): Study (the calm workspace) and Hero (the pixel game). Each has its
// own frame: Study keeps the sidebar it has; Hero gets a JRPG pause-menu panel. Both menus come from the lists here,
// so the desktop panel and the phone tab bar can't drift apart.
import { areaOf, ROUTES } from "./routes";

export type World = "study" | "hero";

export interface WorldItem { id: string; label: string; href: string; children?: WorldItem[] }

/** The Hero menu: the play pages, and Champion's own screens under it. */
export const HERO_MENU: WorldItem[] = [
  { id: "arena", label: "Arena", href: ROUTES.heroArena },
  { id: "quests", label: "Quests", href: ROUTES.heroQuests },
  { id: "bestiary", label: "Bestiary", href: ROUTES.heroBestiary },
  {
    id: "champion", label: "Champion", href: ROUTES.champion,
    children: [
      { id: "inventory", label: "Inventory", href: ROUTES.heroInventory },
      { id: "forge", label: "Forge", href: ROUTES.heroTab("forge") },
      { id: "shop", label: "Shop", href: ROUTES.heroShop },
      { id: "achievements", label: "Achievements", href: ROUTES.heroAchievements },
      { id: "mastery", label: "Mastery", href: ROUTES.heroMastery },
    ],
  },
];

/** Where the portal lands when nothing is remembered yet. */
export const WORLD_HOME: Record<World, string> = { study: ROUTES.today, hero: ROUTES.heroArena };
export const WORLD_NAME: Record<World, string> = { study: "Study", hero: "the Hero world" };

/** Which world a path is in: the play pages are Hero; everything else in the app (Today, Study, Account) is Study. */
export const worldOf = (pathname: string): World => (areaOf(pathname) === "hero" ? "hero" : "study");
export const otherWorld = (w: World): World => (w === "hero" ? "study" : "hero");

// ── Stage 2: each world remembers where you were, so the portal takes you back there ──────────────────────────
const MEMORY_KEY = (w: World) => `cmai_world_${w}`;
/** Note the page you're on as this world's last one (a path in the app, with its query). */
export function rememberPage(w: World, href: string) {
  if (!href.startsWith("/") || href.startsWith("//")) return;
  try { localStorage.setItem(MEMORY_KEY(w), href); } catch { /* storage blocked: the portal goes to the world's home */ }
}
/** The page to land on in a world: the last one you were on there, or the world's home. */
export function lastPage(w: World): string {
  try {
    const href = localStorage.getItem(MEMORY_KEY(w));
    if (href && href.startsWith("/") && !href.startsWith("//") && worldOf(href.split("?")[0]) === w) return href;
  } catch { /* storage blocked */ }
  return WORLD_HOME[w];
}
