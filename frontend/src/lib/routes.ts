// The app's three areas and where everything lives. Study = the document workspace, Hero = the game layer
// (play theme), Account = profile, settings and history. One place for paths, so links and redirects agree.

export const STUDY_TABS = ["chat", "quiz", "notes", "flashcards"] as const;
export type StudyTab = (typeof STUDY_TABS)[number];
export const DEFAULT_STUDY_TAB: StudyTab = "chat";

/** The Hero area is one page with tabs: /hero?tab=<tab>. */
export const HERO_TABS = ["quests", "arena", "shop", "inventory", "avatar", "forge", "achievements"] as const;
export type HeroTab = (typeof HERO_TABS)[number];
export const DEFAULT_HERO_TAB: HeroTab = "quests";

export const ROUTES = {
  login: "/login",
  study: "/study",
  /** /study?tab=<tab>. `session` reopens a saved chat/quiz/notes/flashcards session; `doc` is the active document. */
  studyTab: (tab: StudyTab, sessionId?: string, documentId?: string) =>
    `/study?tab=${tab}` +
    (documentId ? `&doc=${encodeURIComponent(documentId)}` : "") +
    (sessionId ? `&session=${encodeURIComponent(sessionId)}` : ""),
  hero: "/hero",
  /** /hero?tab=<tab> (the Hero area's tabs share one page and one header). */
  heroTab: (tab: HeroTab) => `/hero?tab=${tab}`,
  heroQuests: "/hero?tab=quests",
  heroArena: "/hero?tab=arena",
  heroShop: "/hero?tab=shop",
  heroInventory: "/hero?tab=inventory",
  heroAvatar: "/hero?tab=avatar",
  heroForge: "/hero?tab=forge",
  heroAchievements: "/hero?tab=achievements",
  account: "/account",
  accountSettings: "/account/settings",
  accountHistory: "/account/history",
} as const;

export function isHeroTab(value: string | undefined | null): value is HeroTab {
  return !!value && (HERO_TABS as readonly string[]).includes(value);
}

export function isStudyTab(value: string | undefined): value is StudyTab {
  return !!value && (STUDY_TABS as readonly string[]).includes(value);
}

/** Old URLs and the place each one now lives. Wired into next.config.ts (redirects keep the query string). */
export const LEGACY_REDIRECTS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "/", to: ROUTES.study },
  { from: "/shop", to: ROUTES.heroShop },
  { from: "/inventory", to: ROUTES.heroInventory },
  { from: "/avatar", to: ROUTES.heroAvatar },
  { from: "/avatar/hero-forge", to: ROUTES.heroForge },
  { from: "/profile", to: ROUTES.account },
  { from: "/settings", to: ROUTES.accountSettings },
  { from: "/arena", to: ROUTES.heroArena },
  // The Hero area used to be one page per screen: now one page, one tab each.
  { from: "/hero/arena", to: ROUTES.heroArena },
  { from: "/hero/shop", to: ROUTES.heroShop },
  { from: "/hero/inventory", to: ROUTES.heroInventory },
  { from: "/hero/avatar", to: ROUTES.heroAvatar },
  { from: "/hero/forge", to: ROUTES.heroForge },
  { from: "/hero/achievements", to: ROUTES.heroAchievements },
];

/** The old path-based tab URLs: /study/quiz -> /study?tab=quiz (the query string is kept). */
export const STUDY_TAB_PATH_SOURCE = `/study/:tab(${STUDY_TABS.join("|")})`;

/** Redirect source for /study/<not a tab> (and anything deeper than /study/<tab>). */
export const STUDY_UNKNOWN_TAB_SOURCE = `/study/:rest((?!(?:${STUDY_TABS.join("|")})$).+)`;

export type Area = "study" | "hero" | "account";

export const AREAS: ReadonlyArray<{ id: Area; label: string; href: string }> = [
  { id: "study", label: "Study", href: ROUTES.study },
  { id: "hero", label: "Hero", href: ROUTES.hero },
  { id: "account", label: "Account", href: ROUTES.account },
];

/** Which area a path belongs to (for the active nav item). */
export function areaOf(pathname: string): Area | null {
  const first = pathname.split("/")[1];
  return first === "study" || first === "hero" || first === "account" ? first : null;
}
