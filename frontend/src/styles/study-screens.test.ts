// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

// The Study screens: chat, quiz, flashcards, notes, history, settings, login, profile and the shell around them.
// Study is "graphite glass": it may use the glass utilities and the --gradient-* tokens, but paint (gradient literals,
// raw colours) lives in styles/tokens.css only, and the pixel font never appears.
const STUDY_FILES = [
  "components/ChatView.tsx", "components/QuizView.tsx", "components/FlashcardView.tsx", "components/NotesView.tsx",
  "components/HistoryView.tsx", "components/HistoryPanel.tsx", "components/SessionList.tsx", "components/FileUploader.tsx", "components/shell/DocumentHeader.tsx",
  "components/UserMenu.tsx", "components/shell/AppShell.tsx", "components/shell/NavSidebar.tsx",
  "components/shell/BottomNav.tsx", "components/shell/StudyWorkspace.tsx", "components/shell/AccountNav.tsx",
  "components/ProviderPicker.tsx", "components/Providers.tsx",
  "components/chat/ChatMarkdown.tsx", "components/chat/SourceChips.tsx", "components/chat/NotFoundCard.tsx",
  "components/quiz/QuizQuestionView.tsx", "components/quiz/QuizReview.tsx",
  "components/study/StudyToolbar.tsx", "components/history/sessionMeta.tsx",
  "app/login/page.tsx", "app/(app)/account/settings/page.tsx", "app/(app)/account/page.tsx",
  "app/(app)/account/history/page.tsx", "app/layout.tsx", "app/globals.css",
];
// Hero (the play theme): everything under app/(app)/hero is wrapped once, by its layout.
const PLAY_ROUTES = [
  "app/(app)/hero/layout.tsx",
];
const HERO_COMPONENTS = [
  "components/hero/HeroArea.tsx", "components/hero/HeroHeader.tsx", "components/hero/ItemCard.tsx",
  "components/hero/QuestsTab.tsx", "components/hero/ShopTab.tsx", "components/hero/InventoryTab.tsx",
  "components/hero/AvatarTab.tsx", "components/hero/ForgeTab.tsx",
];
const PLAY_FILES = [
  ...HERO_COMPONENTS,
  "components/arena/ArenaArea.tsx", "components/arena/BattleScreen.tsx", "components/arena/SummonPanel.tsx",
  "components/arena/ResultPanel.tsx", "components/arena/pixel/PixelArena.tsx", "components/arena/TimerRing.tsx", "components/arena/pixel/Roster.tsx",
  "components/arena/Hearts.tsx", "components/AchievementsView.tsx", "components/QuestPanel.tsx",
];

describe("Study screens", () => {
  it.each(STUDY_FILES)("%s has no gradient literals and no pixel font", (file) => {
    const text = readFileSync(src(file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(text).not.toMatch(/Press Start|--font-pixel/);
    if (!file.endsWith(".css")) expect(text).not.toMatch(/pixel-font/);     // the class itself is defined (as Inter in Study) in globals.css
  });
});

// The Study tools: no Play styling (gold / purple accents, heavy borders) and no hand-mixed colours: glass and glow come
// from the kit and the .glass utilities, not from ad-hoc rgba() or Tailwind blur/shadow presets.
const KIT_STUDY_FILES = [
  "components/ChatView.tsx", "components/QuizView.tsx", "components/NotesView.tsx", "components/FlashcardView.tsx",
  "components/HistoryView.tsx", "components/HistoryPanel.tsx", "components/FileUploader.tsx",
  "components/chat/ChatMarkdown.tsx", "components/chat/SourceChips.tsx", "components/chat/NotFoundCard.tsx",
  "components/quiz/QuizQuestionView.tsx", "components/quiz/QuizReview.tsx", "components/study/StudyToolbar.tsx",
];
describe("Kit-styled Study tools", () => {
  it.each(KIT_STUDY_FILES)("%s has no Play styling", (file) => {
    const text = readFileSync(src(file), "utf8");
    expect(text).not.toMatch(/accent-(gold|purple)|backdrop-blur|shadow-lg|shadow-accent|border-[tb]-4|rgba\(/);
  });
});

describe("Play screens", () => {
  it.each(PLAY_ROUTES)("%s is wrapped in the play theme", (file) => {
    expect(readFileSync(src(file), "utf8")).toContain('<ThemeScope theme="play">');
  });

  it.each(PLAY_FILES)("%s exists and is not wrapped on its own (its route or layout does that)", (file) => {
    const text = readFileSync(src(file), "utf8");
    expect(text).not.toContain("<ThemeScope");
  });

  it("the Hero area is ONE page under the Hero layout: its tabs are components, not routes", () => {
    expect(readdirSync(src("app/(app)/hero")).sort()).toEqual(["layout.tsx", "page.tsx"]);
    expect(readdirSync(src("app")).sort()).not.toContain("(immersive)");
  });

  it("the Hero styles use tokens only: no raw colours, and gradients only through the --gradient-* tokens", () => {
    for (const file of ["components/hero/hero.css", "components/arena/arena.css", "components/arena/arena-v2.css"]) {
      const css = readFileSync(src(file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, file).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull();
      expect(css, file).not.toMatch(/rgba?\(/);
    }
  });

  it.each([...HERO_COMPONENTS, "components/AchievementsView.tsx"])("%s colours rarity through the rarity tokens, not Tailwind palette colours", (file) => {
    const text = readFileSync(src(file), "utf8");
    expect(text).not.toMatch(/\b(?:bg|text|border|from|to|shadow)-(?:slate|blue|cyan|purple|violet|yellow|orange|green|red)-\d{3}/);
    expect(text).not.toMatch(/gradient/);
  });

  it("shop and inventory draw items with the same card, and the card takes its rarity from lib/rarity", () => {
    expect(readFileSync(src("components/hero/ShopTab.tsx"), "utf8")).toContain("<ItemCard");
    expect(readFileSync(src("components/hero/InventoryTab.tsx"), "utf8")).toContain("<ItemCard");
    const card = readFileSync(src("components/hero/ItemCard.tsx"), "utf8");
    expect(card).toContain("rarityOf(item)");
    expect(card).toContain("rarityClass(rarity)");
  });
});

describe("styles", () => {
  it("retro.css only holds rules scoped to the play theme", () => {
    const css = readFileSync(src("styles/retro.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...css.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => m[2].trim());
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s, s).toMatch(/^\[data-theme="play"\]/);
  });

  it("the pixel font module is imported only by ThemeScope", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) && /fonts\/pixel/.test(readFileSync(p, "utf8"))) importers.push(e.name);
      }
    };
    walk(src(""));
    expect(importers).toEqual(["ThemeScope.tsx"]);
  });
});
