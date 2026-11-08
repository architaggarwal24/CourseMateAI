// The app's three areas and where everything lives. Study = the document workspace, Hero = the game layer
// (play theme), Account = profile, settings and history. One place for paths, so links and redirects agree.

/** "overview" is a course's page (shown only when the workspace is on a course). */
export const STUDY_TABS = ["chat", "quiz", "notes", "flashcards", "map", "review", "exam", "overview"] as const;
export type StudyTab = (typeof STUDY_TABS)[number];
export const DEFAULT_STUDY_TAB: StudyTab = "chat";

/** The Hero area is one page with tabs: /hero?tab=<tab>. */
export const HERO_TABS = ["quests", "arena", "bestiary", "shop", "inventory", "champion", "achievements"] as const;
export type HeroTab = (typeof HERO_TABS)[number];
export const DEFAULT_HERO_TAB: HeroTab = "quests";
/** Retired tabs and the tab that replaced them (the Avatar tab and the Hero Forge became the Champion tab). */
export const LEGACY_HERO_TABS: Readonly<Record<string, HeroTab>> = { avatar: "champion", forge: "champion" };

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
    `/hero?tab=arena&doc=${encodeURIComponent(documentId)}&topic=${encodeURIComponent(topic)}`,
  hero: "/hero",
  /** /hero?tab=<tab> (the Hero area's tabs share one page and one header). */
  heroTab: (tab: HeroTab) => `/hero?tab=${tab}`,
  heroQuests: "/hero?tab=quests",
  heroArena: "/hero?tab=arena",
  heroShop: "/hero?tab=shop",
  heroInventory: "/hero?tab=inventory",
  heroChampion: "/hero?tab=champion",
  heroAchievements: "/hero?tab=achievements",
  account: "/account",
  accountSettings: "/account/settings",
  accountHistory: "/account/history",
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
  { from: "/arena", to: ROUTES.heroArena },
  // The Hero area used to be one page per screen: now one page, one tab each.
  { from: "/hero/arena", to: ROUTES.heroArena },
  { from: "/hero/shop", to: ROUTES.heroShop },
  { from: "/hero/inventory", to: ROUTES.heroInventory },
  { from: "/hero/avatar", to: ROUTES.heroChampion },
  { from: "/hero/forge", to: ROUTES.heroChampion },
  { from: "/hero/champion", to: ROUTES.heroChampion },
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
