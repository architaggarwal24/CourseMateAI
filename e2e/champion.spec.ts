import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// The pixel champion is the avatar everywhere (Phase 3, Stage 1): picked in the Champion tab, saved on the account,
// drawn in the Hero header, the sidebar menu, the shop and the inventory; old Avatar / Hero Forge links land here.

const roster = (page: Page) => page.getByRole("radiogroup", { name: "Choose your champion" });
const header = (page: Page) => page.getByTestId("hero-header-champion");

test("choosing a champion saves it on the account and every avatar shows it", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  await expect(roster(page).getByRole("radio", { checked: true })).toContainText("Kaien");
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Kaien/);
  await expect(roster(page).getByRole("radio", { name: /Kaien/ }).getByText("Level 2")).toBeVisible();

  const saved = page.waitForRequest((r) => r.url().endsWith("/avatar/champion") && r.method() === "PUT");
  await roster(page).getByRole("radio", { name: /Mira/ }).click();
  expect((await saved).postDataJSON()).toEqual({ champion_id: "mira" });
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Mira/);
  await expect(header(page).locator(".champ-avatar[data-champion='mira']")).toBeVisible();
  // the picked champion's kit and mastery skins follow the pick (Phase 3 Stage 2)
  await expect(page.getByTestId("champion-kit")).toContainText("Passive · Quiet Study");
  await expect(page.getByRole("list", { name: "Mira's mastery skins" }).getByRole("listitem")).toHaveCount(3);
  // Phase 1: the weakness, and the mastery % (its challenges are on the Mastery tab)
  await expect(page.getByTestId("champion-weakness")).toContainText("Weakness · Quiet Study Flaw");
  await expect(page.getByTestId("champion-kit")).toContainText("0%Mira's mastery");

  // the account remembers it: a fresh load (cache cleared) comes back with Mira
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(roster(page).getByRole("radio", { checked: true })).toContainText("Mira");
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Mira/);
});

test("old Avatar and Hero Forge links open the Champion tab", async ({ page }) => {
  await mockApi(page);
  for (const old of ["/hero?tab=avatar", "/champion?tab=avatar", "/avatar", "/avatar/hero-forge"]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/champion\?tab=champion$/);
    await expect(roster(page)).toBeVisible();
  }
});

test("the shop's try-on dresses the champion, and the inventory shows the same champion", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=shop");
  await page.getByRole("button", { name: /Head Pieces/ }).click();
  await page.getByRole("button", { name: "Try on Red Headband" }).click();
  await expect(page.getByTestId("shop-preview").getByRole("img", { name: "Kaien, trying on Red Headband" })).toBeVisible();
  await expect(header(page)).toHaveAttribute("aria-label", "Your champion, Kaien, trying on Red Headband");
  await page.goto("/champion?tab=inventory");
  await expect(page.getByRole("img", { name: "Kaien, your champion, in your skins" })).toBeVisible();
});

test("the champion's sprites are painted, and the Champion tab passes axe", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  await expect(roster(page)).toBeVisible();
  const stage = page.getByTestId("champion-stage").locator("canvas");
  await expect.poll(() => stage.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  })).toBeGreaterThan(400);
  // the same bar as e2e/axe.spec.ts: no serious or critical findings
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});

/** The preview canvas, sampled a few times over one idle cycle: how many different pictures it showed. */
const distinctFrames = (page: Page) => page.getByTestId("champion-stage").locator("canvas").evaluate(async (c: HTMLCanvasElement) => {
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) { seen.add(c.toDataURL()); await new Promise((r) => setTimeout(r, 140)); }
  return seen.size;
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("every sprite is a still frame", async ({ page }) => {
    await mockApi(page);
    await page.goto("/champion?tab=champion");
    await expect(roster(page)).toBeVisible();
    await page.waitForTimeout(300);
    const playing = await page.locator("canvas[data-playing]").evaluateAll((cs) => cs.map((c) => c.getAttribute("data-playing")));
    expect(playing.length).toBeGreaterThan(6);
    expect(new Set(playing)).toEqual(new Set(["false"]));
    expect(await distinctFrames(page)).toBe(1);
  });
});

test("without reduced motion the champion idles (the frames change)", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  await expect(roster(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await distinctFrames(page)).toBeGreaterThan(1);
});

// Stage C1: champions join through the Bestiary (and Thorne at level 25), each with a ceremony.
test("a locked champion is a silhouette that says what brings them, and can't be picked", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  const vex = roster(page).getByRole("radio", { name: /Vex/ });
  await expect(vex).toHaveAttribute("aria-disabled", "true");
  await expect(vex).toContainText("Beat every creature in Bestiary tier IV");
  let put = false;
  page.on("request", (r) => { if (r.url().endsWith("/avatar/champion") && r.method() === "PUT") put = true; });
  await vex.click({ force: true });                                         // (aria-disabled: Playwright would wait for it)
  await expect(page.getByText("Vex hasn't joined you yet.", { exact: false })).toBeVisible();
  expect(put).toBe(false);
  await expect(roster(page).getByRole("radio", { checked: true })).toContainText("Kaien");
  await expect(page.getByTestId("champion-signature")).toContainText("Ninth Page Cut Finale");
});

test("a champion who just joined gets a ceremony; Fight as picks them", async ({ page }) => {
  await mockApi(page, { ceremony: "asha" });
  await page.goto("/champion?tab=champion");
  const dialog = page.getByRole("dialog", { name: "Asha joins you" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("You finished Bestiary tier I.");
  await settle(page);
  const results = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + " " + (n.any[0]?.message ?? "")).join(", ")}`)).toEqual([]);
  const claimed = page.waitForRequest((r) => r.url().endsWith("/avatar/champion/celebrate"));
  await dialog.getByRole("button", { name: "Fight as Asha" }).click();
  expect((await claimed).postDataJSON()).toEqual({ champion_id: "asha" });
  await expect(dialog).toBeHidden();
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Asha/);
  await page.reload();
  await expect(roster(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("your hero: pick it, build its look, and see its styles, loadout and skills", async ({ page }) => {
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  const saved = page.waitForRequest((r) => r.url().endsWith("/avatar/champion") && r.method() === "PUT");
  await roster(page).getByRole("radio", { name: /Your hero/ }).click();
  expect((await saved).postDataJSON()).toEqual({ champion_id: "hero" });
  const builder = page.getByTestId("hero-builder");
  await expect(builder).toContainText("Fighting with Apprentice Blade");
  await expect(builder.getByText("Kaien at 100% mastery (42%)")).toBeVisible();

  await page.getByTestId("customize-look").click();
  const editor = page.getByRole("dialog", { name: "Your hero's look" });
  await expect(editor.getByRole("img", { name: /Preview: your hero/ })).toBeVisible();
  await expect(editor.getByRole("button", { name: /Kaien: unlocks at 100% mastery/ })).toHaveAttribute("aria-disabled", "true");
  await editor.getByRole("tab", { name: "Hair" }).click();
  await editor.getByRole("button", { name: "Ponytail" }).click();
  await editor.getByRole("button", { name: "Hair colour: Pink" }).click();
  const results = await new AxeBuilder({ page }).include(".look-editor").analyze();
  expect(results.violations).toEqual([]);
  const look = page.waitForRequest((r) => r.url().endsWith("/hero/look") && r.method() === "PUT");
  await editor.getByRole("button", { name: "Save look" }).click();
  expect((await look).postDataJSON()).toMatchObject({ look: { hair: "ponytail", hairColor: "pink" } });
  await expect(editor).toBeHidden();

  await builder.getByRole("tab", { name: /Skills/ }).click();
  await builder.getByRole("button", { name: "Put a point in Sharpened" }).click();
  const tree = page.waitForRequest((r) => r.url().endsWith("/hero/tree") && r.method() === "PUT");
  await builder.getByRole("button", { name: "Save skills" }).click();
  expect((await tree).postDataJSON()).toEqual({ tree: { o1: 1 } });
  const axe = await new AxeBuilder({ page }).include("[data-testid='hero-builder']").analyze();
  expect(axe.violations).toEqual([]);
  await settle(page);
});

test("the look editor fits a phone: preview in view, nothing cut off, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await mockApi(page);
  await page.goto("/champion?tab=champion");
  await roster(page).getByRole("radio", { name: /Your hero/ }).click();
  await page.getByTestId("customize-look").click();
  const editor = page.getByRole("dialog", { name: "Your hero's look" });
  await expect(editor).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll(".look-editor *")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1);
  }).length);
  expect(overflow).toBe(0);
  await editor.getByRole("tab", { name: "Extras" }).click();
  await editor.getByRole("button", { name: "Scarf: Red" }).scrollIntoViewIfNeeded();
  await expect(editor.getByRole("img", { name: /Preview: your hero/ })).toBeInViewport();
});

test("the forge: gear XP, materials and an upgrade", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/champion?tab=forge");
  const forge = page.getByTestId("forge");
  await expect(forge).toContainText("Bronze ore 4");
  const up = page.waitForRequest((r) => r.url().endsWith("/forge/upgrade") && r.method() === "POST");
  await forge.getByRole("button", { name: "Forge to II" }).click();
  expect((await up).postDataJSON()).toEqual({ item: "hat_headband_red" });
  await expect(forge.getByText("Tier II")).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("[data-testid='forge']").analyze();
  expect(axe.violations).toEqual([]);
  expect(unanswered).toEqual([]);
});

test("play is in the side panel: Quests, Arena, Bestiary and Champion, whose tabs hold the rest", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("mobile"), "the side panel is desktop only (phones: Arena and Champion in the bottom bar)");
  const { unanswered } = await mockApi(page);
  await page.goto("/today");
  const play = page.getByRole("navigation", { name: "Main" }).getByRole("group", { name: "Play" });
  await expect(play.getByRole("link")).toHaveText(["Quests", "Arena", "Bestiary", "Champion"]);
  await play.getByRole("link", { name: "Bestiary" }).click();
  await expect(page).toHaveURL(/\/bestiary$/);
  await expect(page.getByTestId("hero-header")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Champion" })).toHaveCount(0);
  await play.getByRole("link", { name: "Champion" }).click();
  await expect(page).toHaveURL(/\/champion$/);
  const tabs = page.getByRole("navigation", { name: "Champion" });
  await expect(tabs.getByRole("link")).toHaveText(["Champion", "Inventory", "Forge", "Shop", "Achievements", "Mastery"]);
  await expect(tabs.getByRole("link", { name: "Champion" })).toHaveAttribute("aria-current", "page");
  await expect(roster(page)).toBeVisible();
  expect(unanswered).toEqual([]);
});

test("old Hero links land on the new pages, parameters and all", async ({ page }) => {
  await mockApi(page);
  for (const [old, now] of [["/hero", /\/quests$/], ["/hero?tab=bestiary", /\/bestiary$/], ["/hero?tab=shop", /\/champion\?tab=shop$/], ["/hero/arena", /\/arena$/]] as const) {
    await page.goto(old);
    await expect(page, old).toHaveURL(now);
  }
  await page.goto("/hero?tab=arena&hunt=minotaur");
  await expect(page).toHaveURL(/\/arena\?hunt=minotaur$/);
});

test("the Mastery tab: every champion's mastery and your hero's level", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/champion?tab=mastery");
  const tab = page.getByTestId("mastery");
  await expect(tab.getByRole("region", { name: "Your hero" })).toContainText("Lv 4");
  for (const name of ["Kaien", "Asha", "Brak", "Mira", "Vex", "Thorne"]) await expect(tab.getByRole("region", { name })).toBeVisible();
  await expect(tab.getByRole("progressbar", { name: "Kaien's mastery" })).toHaveAttribute("aria-valuenow", "8");
  await expect(tab.getByRole("list", { name: "Mira's mastery challenges" }).getByRole("listitem")).toHaveCount(2);
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[data-testid='mastery']").analyze();
  expect(axe.violations).toEqual([]);
  expect(unanswered).toEqual([]);
});
