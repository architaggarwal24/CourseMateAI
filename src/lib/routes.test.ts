// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AREAS, CHAMPION_TABS, HERO_TABS, LEGACY_HERO_TABS, LEGACY_REDIRECTS, PLAY_PAGES, ROUTES, STUDY_TAB_PATH_SOURCE, areaOf, isChampionTab, isHeroTab, isStudyTab, legacyHeroUrl } from "./routes";

const appDir = fileURLToPath(new URL("../app", import.meta.url));

/** All URL paths the app directory serves (route groups "(x)" don't count; "[[...x]]" also serves the bare path). */
function servedPaths(dir = appDir, prefix = ""): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some(e => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))) out.push(prefix || "/");
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("(")) out.push(...servedPaths(`${dir}/${e.name}`, prefix));
    else if (/^\[\[\.\.\./.test(e.name)) { if (existsSync(`${dir}/${e.name}/page.tsx`)) out.push(prefix || "/"); }
    else if (!e.name.startsWith("[")) out.push(...servedPaths(`${dir}/${e.name}`, `${prefix}/${e.name}`));
  }
  return out;
}

const pathOf = (url: string) => url.split("?")[0];

describe("routes", () => {
  const served = servedPaths();

  it("every old URL redirects to a page that exists", () => {
    expect(LEGACY_REDIRECTS.map(r => r.from).sort()).toEqual(
      [
        "/avatar", "/avatar/hero-forge", "/inventory", "/profile", "/settings", "/shop",
        "/hero/quests", "/hero/arena", "/hero/bestiary", "/hero/shop", "/hero/inventory", "/hero/avatar", "/hero/forge",
        "/hero/champion", "/hero/achievements", "/hero/mastery",
      ].sort(),
    );
    for (const { from, to } of LEGACY_REDIRECTS) expect(served, `${from} -> ${to}`).toContain(pathOf(to));
  });

  it("old URLs are no longer pages themselves (the redirect is what answers them)", () => {
    for (const { from } of LEGACY_REDIRECTS) expect(served).not.toContain(from);
  });

  it("the site's root is the landing page (a page, not a redirect: signed in, it sends you on to Today itself)", () => {
    expect(LEGACY_REDIRECTS.find((r) => r.from === "/")).toBeUndefined();
    expect(served).toContain("/");
  });

  it("no redirect lands on another redirect", () => {
    const froms = new Set(LEGACY_REDIRECTS.map(r => r.from));
    for (const { to } of LEGACY_REDIRECTS) expect(froms.has(to)).toBe(false);
  });

  it("every navigable ROUTES entry is served", () => {
    for (const [name, path] of Object.entries(ROUTES)) {
      if (typeof path === "string") expect(served, name).toContain(pathOf(path));
    }
    expect(served).toContain("/study");               // the tab is ?tab=, not a path
  });

  it("the three areas map to their paths", () => {
    expect(AREAS.map(a => a.href)).toEqual(["/study", "/champion", "/account"]);
    expect(areaOf("/study/quiz")).toBe("study");
    for (const p of ["/quests", "/arena", "/bestiary", "/champion", "/adventurer"]) expect(areaOf(p), p).toBe("hero");   // the play area
    expect(areaOf("/hero")).toBe("hero");
    expect(areaOf("/hero/shop")).toBe("hero");          // (an old URL: it redirects, but it is still the play area)
    expect(areaOf("/arenas")).toBeNull();
    expect(areaOf("/account/settings")).toBe("account");
    expect(areaOf("/login")).toBeNull();
  });

  it("study tab links", () => {
    expect(ROUTES.studyTab("quiz")).toBe("/study?tab=quiz");
    expect(ROUTES.studyTab("quiz", undefined, "d1")).toBe("/study?tab=quiz&doc=d1");
    expect(ROUTES.studyTab("notes", "a b")).toBe("/study?tab=notes&session=a%20b");
    expect(ROUTES.studyTab("chat", "s1", "d 1")).toBe("/study?tab=chat&doc=d%201&session=s1");
    expect(isStudyTab("flashcards")).toBe(true);
    expect(isStudyTab("review")).toBe(true);
    expect(isStudyTab("arena")).toBe(false);
    expect(isStudyTab(undefined)).toBe(false);
  });

  it("play: Quests, Arena and Bestiary are pages, the rest are Champion tabs, and every old Hero URL lands on one", () => {
    for (const p of ["/quests", "/arena", "/bestiary", "/champion", "/adventurer"]) expect(served, p).toContain(p);
    expect(ROUTES.heroProfile).toBe("/adventurer");                    // your hero's profile: card, bonuses, settings
    expect(existsSync(fileURLToPath(new URL("../app/hero/route.ts", import.meta.url)))).toBe(true);   // /hero?tab= redirects (legacyHeroUrl)
    expect([...PLAY_PAGES]).toEqual(["quests", "arena", "bestiary"]);
    expect([...CHAMPION_TABS]).toEqual(["champion", "inventory", "forge", "shop", "achievements", "mastery"]);
    expect([...HERO_TABS]).toEqual([...PLAY_PAGES, ...CHAMPION_TABS]);
    for (const p of PLAY_PAGES) expect(ROUTES.heroTab(p)).toBe(`/${p}`);
    for (const t of CHAMPION_TABS) expect(ROUTES.heroTab(t)).toBe(`/champion?tab=${t}`);
    expect(ROUTES.heroShop).toBe("/champion?tab=shop");
    expect(ROUTES.heroHunt("oni")).toBe("/arena?hunt=oni");
    expect(isHeroTab("shop")).toBe(true);
    expect(isHeroTab("overview")).toBe(false);
    expect(isHeroTab(null)).toBe(false);
    expect(isChampionTab("arena")).toBe(false);
    expect(isChampionTab("mastery")).toBe(true);
    const toTab = Object.fromEntries(LEGACY_REDIRECTS.map(r => [r.from, r.to]));
    for (const tab of ["arena", "quests", "bestiary"] as const) expect(toTab[`/hero/${tab}`], tab).toBe(`/${tab}`);
    for (const tab of ["shop", "inventory", "champion", "achievements", "forge", "mastery"] as const) {
      expect(toTab[`/hero/${tab}`], tab).toBe(`/champion?tab=${tab}`);
    }
    expect(toTab["/shop"]).toBe("/champion?tab=shop");
    for (const old of ["/avatar", "/avatar/hero-forge", "/hero/avatar"]) expect(toTab[old], old).toBe("/champion?tab=champion");
    expect(LEGACY_HERO_TABS).toEqual({ avatar: "champion" });
  });

  it("an old /hero?tab= link goes to its new page, keeping its other parameters", () => {
    const q = (s: string) => legacyHeroUrl(new URLSearchParams(s));
    expect(q("")).toBe("/quests");
    expect(q("tab=nonsense")).toBe("/quests");
    expect(q("tab=arena&doc=d1&topic=ATP")).toBe("/arena?doc=d1&topic=ATP");
    expect(q("tab=arena&hunt=oni")).toBe("/arena?hunt=oni");
    expect(q("tab=bestiary")).toBe("/bestiary");
    expect(q("tab=shop")).toBe("/champion?tab=shop");
    expect(q("tab=avatar")).toBe("/champion?tab=champion");
    expect(q("tab=forge&x=1")).toBe("/champion?tab=forge&x=1");
  });

  it("the old /study/<tab> paths redirect to ?tab= and are no longer pages", () => {
    const config = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");
    expect(STUDY_TAB_PATH_SOURCE).toBe("/study/:tab(chat|quiz|notes|flashcards|map|review|exam|overview)");
    expect(config).toContain("STUDY_TAB_PATH_SOURCE");
    expect(config).toContain('destination: "/study?tab=:tab"');
    expect(served.filter(p => p.startsWith("/study"))).toEqual(["/study"]);
  });

  it("next.config.ts serves the redirect table", () => {
    const config = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");
    expect(config).toContain("LEGACY_REDIRECTS");
  });

  it("nothing in the app still links to an old top-level URL", () => {
    const old = LEGACY_REDIRECTS.map(r => r.from).filter(p => p !== "/");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !p.endsWith("lib/routes.ts")) {
          const text = readFileSync(p, "utf8");
          for (const o of old) if (new RegExp(`(push|replace|href=)[^\\n]*["'\`]${o}["'\`?/]`).test(text)) hits.push(`${p}: ${o}`);
        }
      }
    };
    walk(fileURLToPath(new URL("..", import.meta.url)));
    expect(hits).toEqual([]);
  });
});
