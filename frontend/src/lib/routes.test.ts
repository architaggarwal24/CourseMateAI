// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AREAS, HERO_TABS, LEGACY_REDIRECTS, ROUTES, STUDY_TAB_PATH_SOURCE, areaOf, isHeroTab, isStudyTab } from "./routes";

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
        "/", "/arena", "/avatar", "/avatar/hero-forge", "/inventory", "/profile", "/settings", "/shop",
        "/hero/arena", "/hero/shop", "/hero/inventory", "/hero/avatar", "/hero/forge", "/hero/achievements",
      ].sort(),
    );
    for (const { from, to } of LEGACY_REDIRECTS) expect(served, `${from} -> ${to}`).toContain(pathOf(to));
  });

  it("old URLs are no longer pages themselves (the redirect is what answers them)", () => {
    for (const { from } of LEGACY_REDIRECTS) expect(served).not.toContain(from);
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
    expect(AREAS.map(a => a.href)).toEqual(["/study", "/hero", "/account"]);
    expect(areaOf("/study/quiz")).toBe("study");
    expect(areaOf("/hero")).toBe("hero");
    expect(areaOf("/hero/shop")).toBe("hero");          // (an old URL: it redirects, but it is still the Hero area)
    expect(areaOf("/account/settings")).toBe("account");
    expect(areaOf("/login")).toBeNull();
  });

  it("study tab links", () => {
    expect(ROUTES.studyTab("quiz")).toBe("/study?tab=quiz");
    expect(ROUTES.studyTab("quiz", undefined, "d1")).toBe("/study?tab=quiz&doc=d1");
    expect(ROUTES.studyTab("notes", "a b")).toBe("/study?tab=notes&session=a%20b");
    expect(ROUTES.studyTab("chat", "s1", "d 1")).toBe("/study?tab=chat&doc=d%201&session=s1");
    expect(isStudyTab("flashcards")).toBe(true);
    expect(isStudyTab("arena")).toBe(false);
    expect(isStudyTab(undefined)).toBe(false);
  });

  it("the Hero area is one page: every tab is /hero?tab=, and every old Hero URL redirects into a tab", () => {
    expect(served.filter(p => p.startsWith("/hero"))).toEqual(["/hero"]);
    expect([...HERO_TABS]).toEqual(["quests", "arena", "shop", "inventory", "avatar", "forge", "achievements"]);
    for (const tab of HERO_TABS) expect(ROUTES.heroTab(tab)).toBe(`/hero?tab=${tab}`);
    expect(ROUTES.heroShop).toBe(ROUTES.heroTab("shop"));
    expect(isHeroTab("shop")).toBe(true);
    expect(isHeroTab("overview")).toBe(false);
    expect(isHeroTab(null)).toBe(false);
    const toTab = Object.fromEntries(LEGACY_REDIRECTS.map(r => [r.from, r.to]));
    for (const tab of ["arena", "shop", "inventory", "avatar", "forge", "achievements"] as const) {
      expect(toTab[`/hero/${tab}`], tab).toBe(`/hero?tab=${tab}`);
    }
    expect(toTab["/shop"]).toBe("/hero?tab=shop");
    expect(toTab["/avatar/hero-forge"]).toBe("/hero?tab=forge");
  });

  it("the old /study/<tab> paths redirect to ?tab= and are no longer pages", () => {
    const config = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");
    expect(STUDY_TAB_PATH_SOURCE).toBe("/study/:tab(chat|quiz|notes|flashcards)");
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
