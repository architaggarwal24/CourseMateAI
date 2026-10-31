// Every screen the accessibility pass covers. `auth` = needs a signed-in user.
export interface PageCase { name: string; path: string; auth: boolean; ready: string; before?: "register" | "register-step-2" }

export const PAGES: PageCase[] = [
  { name: "login", path: "/login", auth: false, ready: "role=heading[name='Welcome Back']" },
  { name: "signup step 1", path: "/login", auth: false, ready: "role=heading[name='Your account']", before: "register" },
  { name: "signup step 2", path: "/login", auth: false, ready: "role=heading[name=/Connect your AI provider/i]", before: "register-step-2" },
  { name: "study: chat", path: "/study?tab=chat&doc=doc-1", auth: true, ready: "role=log" },
  { name: "study: quiz", path: "/study?tab=quiz&doc=doc-1", auth: true, ready: "role=heading[name=/quiz/i]" },
  { name: "study: notes", path: "/study?tab=notes&doc=doc-1", auth: true, ready: "role=heading[name=/notes/i]" },
  { name: "study: flashcards", path: "/study?tab=flashcards&doc=doc-1", auth: true, ready: "role=heading[name=/flashcards/i]" },
  { name: "hero: quests", path: "/hero", auth: true, ready: "main" },
  { name: "hero: arena", path: "/hero?tab=arena", auth: true, ready: "main" },
  { name: "hero: shop", path: "/hero?tab=shop", auth: true, ready: "main" },
  { name: "hero: inventory", path: "/hero?tab=inventory", auth: true, ready: "main" },
  { name: "hero: avatar", path: "/hero?tab=avatar", auth: true, ready: "main" },
  { name: "hero: forge", path: "/hero?tab=forge", auth: true, ready: "main" },
  { name: "hero: achievements", path: "/hero?tab=achievements", auth: true, ready: "main" },
  { name: "account", path: "/account", auth: true, ready: "main" },
  { name: "account: settings", path: "/account/settings", auth: true, ready: "role=heading[name='Settings']" },
  { name: "account: history", path: "/account/history", auth: true, ready: "main" },
];
