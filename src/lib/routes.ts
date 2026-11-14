// The app's three areas and where everything lives. Study = the document workspace, Play = the game layer
// (play theme: Quests, Arena, Bestiary, Champion), Account = profile, settings and history. One place for paths, so links and redirects agree.

/** "overview" is a course's page (shown only when the workspace is on a course). */
export const STUDY_TABS = ["chat", "quiz", "notes", "flashcards", "map", "review", "exam", "overview"] as const;
export type StudyTab = (typeof STUDY_TABS)[number];
export const DEFAULT_STUDY_TAB: StudyTab = "chat";

/**
 * The play pages (the side panel's Play group): Quests, Arena and Bestiary are pages of their own; Champion is one
 * page with tabs (/champion?tab=<tab>). All of them share the play header (level, XP, coins, streak).
 */
export const PLAY_PAGES = ["quests", "arena", "bestiary"] as const;
export type PlayPage = (typeof PLAY_PAGES)[number];
export const CHAMPION_TABS = ["champion", "inventory", "forge", "shop", "achievements", "mastery"] as const;
export type ChampionTab = (typeof CHAMPION_TABS)[number];
export const DEFAULT_CHAMPION_TAB: ChampionTab = "champion";
/** Every play screen by its old /hero?tab= name: the play pages and the Champion page's tabs. */
export const HERO_TABS = [...PLAY_PAGES, ...CHAMPION_TABS] as const;
export type HeroTab = (typeof HERO_TABS)[number];
/** Retired tabs and the tab that replaced them (the Avatar tab and the Hero Forge became the Champion tab). */
export const LEGACY_HERO_TABS: Readonly<Record<string, HeroTab>> = { avatar: "champion" };

const isPlayPage = (t: HeroTab): t is PlayPage => (PLAY_PAGES as readonly string[]).includes(t);
/** Where a play screen lives: /quests, /arena, /bestiary, or /champion?tab=<tab>. */
const playHref = (tab: HeroTab) => (isPlayPage(tab) ? `/${tab}` : `/champion?tab=${tab}`);

export const ROUTES = {
  /** The landing page for logged-out visitors (signed in, "/" goes to Today). */
  home: "/",
  login: "/login",
  /** The login page opened on "Create account". */
  signup: "/login?mode=register",
  /** The login page, coming back to `path` afterwards. */
  loginNext: (path: string) => `/login?next=${encodeURIComponent(path)}`,
  /** Home after signing in: what to do today (due reviews, where you left off, streak, quests, your PDFs). */
  today: "/today",
  study: "/study",
  /** /study?tab=<tab>. `session` reopens a saved chat/quiz/notes/flashcards session; `doc` is the active document. */
  studyTab: (tab: StudyTab, sessionId?: string, documentId?: string) =>
    `/study?tab=${tab}` +
    (documentId ? `&doc=${encodeURIComponent(documentId)}` : "") +
    (sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""),
  /** A tool opened on one concept (the concept map's actions): the quiz / flashcards topic is filled in. */
  studyTopic: (tab: "quiz" | "flashcards", documentId: string, topic: string) =>
    `/study?tab=${tab}&doc=${encodeURIComponent(documentId)}&topic=${encodeURIComponent(topic)}`,
  /** The arena's Quick Battle on a document (or course) with the boss topic filled in. */
  heroArenaTopic: (documentId: string, topic: string) =>
    `/arena?doc=${encodeURIComponent(documentId)}&topic=${encodeURIComponent(topic)}`,
  /** A Hunt (the Bestiary's Hunt button): the arena's Quick Battle against that creature. */
  heroHunt: (species: string) => `/arena?hunt=${encodeURIComponent(species)}`,
  /** The Champion page (its first tab): the side panel's way into your champion, gear and progress. */
  hero: "/champion",
  champion: "/champion",
  /** Any play screen: /quests, /arena, /bestiary, or a Champion tab (/champion?tab=<tab>). */
  heroTab: playHref,
  heroQuests: "/quests",
  heroArena: "/arena",
  heroBestiary: "/bestiary",
  heroShop: playHref("shop"),
  heroInventory: playHref("inventory"),
  heroChampion: playHref("champion"),
  heroAchievements: playHref("achievements"),
  heroMastery: playHref("mastery"),
  /** Your hero's profile: the Adventurer card, arena and study bonuses, and the Hero world's settings. */
  heroProfile: "/adventurer",
  account: "/account",
  accountSettings: "/account/settings",
  accountHistory: "/account/history",
  accountTrash: "/account/trash",
  /** Account -> Plan & usage: the plan, its limits, what has been used, invite codes, the plans to compare. */
  accountUsage: "/account/usage",
  /** Account -> Security: verify the email, two-step sign-in. */
  accountSecurity: "/account/security",
  /** Account -> Admin (admins only): accounts, plans, bans, invite codes. */
  accountAdmin: "/account/admin",
} as const;

export function isHeroTab(value: string | undefined | null): value is HeroTab {
  return !!value && (HERO_TABS as readonly string[]).includes(value);
}

export function isChampionTab(value: string | undefined | null): value is ChampionTab {
  return !!value && (CHAMPION_TABS as readonly string[]).includes(value);
}

/** The play paths (all in the Play theme, all under the play header). /hero is the old one: it only redirects. */
export const PLAY_PATHS = ["/quests", "/arena", "/bestiary", "/champion", "/adventurer"] as const;

/**
 * An old /hero?tab=<tab>&... link and where it lives now: the tab picks the page (an unknown or missing tab was the
 * quests tab), every other parameter (doc, topic, hunt) comes along.
 */
export function legacyHeroUrl(query: URLSearchParams): string {
  const raw = query.get("tab");
  const tab: HeroTab = isHeroTab(raw) ? raw : (raw && LEGACY_HERO_TABS[raw]) || "quests";
  const rest = new URLSearchParams(query);
  rest.delete("tab");
  const more = rest.toString();
  const base = playHref(tab);
  return more ? `${base}${base.includes("?") ? "&" : "?"}${more}` : base;
}

export function isStudyTab(value: string | undefined): value is StudyTab {
  return !!value && (STUDY_TABS as readonly string[]).includes(value);
}

/** Old URLs and the place each one now lives. Wired into next.config.ts (redirects keep the query string). */
export const LEGACY_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "/shop", to: ROUTES.heroShop },
  { from: "/inventory", to: ROUTES.heroInventory },
  { from: "/avatar", to: ROUTES.heroChampion },
  { from: "/avatar/hero-forge", to: ROUTES.heroChampion },
  { from: "/profile", to: ROUTES.account },
  { from: "/settings", to: ROUTES.accountSettings },
  // The Hero area used to be one page per screen, then one page with tabs (/hero?tab=, see legacyHeroUrl); now
  // Quests, Arena and Bestiary are pages and the rest are Champion tabs.
  { from: "/hero/quests", to: ROUTES.heroQuests },
  { from: "/hero/arena", to: ROUTES.heroArena },
  { from: "/hero/bestiary", to: ROUTES.heroBestiary },
  { from: "/hero/shop", to: ROUTES.heroShop },
  { from: "/hero/inventory", to: ROUTES.heroInventory },
  { from: "/hero/avatar", to: ROUTES.heroChampion },
  { from: "/hero/forge", to: ROUTES.heroTab("forge") },
  { from: "/hero/champion", to: ROUTES.heroChampion },
  { from: "/hero/achievements", to: ROUTES.heroAchievements },
  { from: "/hero/mastery", to: ROUTES.heroMastery },
];

/** The old path-based tab URLs: /study/quiz -> /study?tab=quiz (the query string is kept). */
export const STUDY_TAB_PATH_SOURCE = `/study/:tab(${STUDY_TABS.join("|")})`;

/** Redirect source for /study/<not a tab> (and anything deeper than /study/<tab>). */
export const STUDY_UNKNOWN_TAB_SOURCE = `/study/:rest((?!(?:${STUDY_TABS.join("|")})$).+)`;

export type Area = "study" | "hero" | "account";

export const AREAS: ReadonlyArray<{ id: Area; label: string; href: string }> = [
  { id: "study", label: "Study", href: ROUTES.study },
  { id: "hero", label: "Play", href: ROUTES.champion },
  { id: "account", label: "Account", href: ROUTES.account },
];

/** Which area a path belongs to (for the active nav item). */
export function areaOf(pathname: string): Area | null {
  const first = pathname.split("/")[1];
  if (first === "study" || first === "account") return first;
  // the play pages (and the old /hero, which only redirects) are the play area
  return first === "hero" || (PLAY_PATHS as readonly string[]).includes(`/${first}`) ? "hero" : null;
}
