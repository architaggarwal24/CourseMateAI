// One-off: the project's new layout (November 2026). Unzip the update, then run once from the repo root:
//   node scripts/restructure.mjs
// It moves and renames files with `git mv` (so each file keeps its history; plain renames outside git), deletes the
// files nothing needs any more, and removes the folders that end up empty. The update already holds the moved files
// whose imports changed; for those it just removes the old copy (git still sees the rename). Safe to run again:
// whatever is already done is skipped.
//
// The layout (docs/coursemateai-context.md "Project layout"):
//   src/components/<feature>/  every component in its feature's folder, none loose at the top
//                               (ui/ = the kit, shell/ = the app frame, play/ = the play pages and their tabs)
//   src/lib/<feature>/          browser-side logic by feature; only app-wide modules sit at the top of lib/
//   src/server/<feature>/       the Worker by feature; only its plumbing sits at the top of server/
//   Names: components PascalCase (ChatView.tsx), hooks useX.ts, everything else kebab-case (chat-stream.ts).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** [from, to]: a folder first when it moves as a whole, so files moved into it afterwards land in the new place. */
const MOVES = [
  // the play pages and their tabs (Quests, Arena, Bestiary, Champion) were the "Hero" area
  ["src/components/hero", "src/components/play"],
  ["e2e/hero-scroll.spec.ts", "e2e/play-scroll.spec.ts"],

  // components loose at the top of src/components -> their feature's folder
  ["src/components/AchievementsView.tsx", "src/components/play/AchievementsView.tsx"],
  ["src/components/ActiveBuffsSidebar.tsx", "src/components/play/ActiveBuffsSidebar.tsx"],
  ["src/components/ChatView.tsx", "src/components/chat/ChatView.tsx"],
  ["src/components/ChatView.test.tsx", "src/components/chat/ChatView.test.tsx"],
  ["src/components/QuizView.tsx", "src/components/quiz/QuizView.tsx"],
  ["src/components/QuizView.test.tsx", "src/components/quiz/QuizView.test.tsx"],
  ["src/components/NotesView.tsx", "src/components/notes/NotesView.tsx"],
  ["src/components/NotesView.test.tsx", "src/components/notes/NotesView.test.tsx"],
  ["src/components/FlashcardView.tsx", "src/components/flashcards/FlashcardView.tsx"],
  ["src/components/FlashcardView.test.tsx", "src/components/flashcards/FlashcardView.test.tsx"],
  ["src/components/HistoryPanel.tsx", "src/components/history/HistoryPanel.tsx"],
  ["src/components/HistoryView.tsx", "src/components/history/HistoryView.tsx"],
  ["src/components/FileUploader.tsx", "src/components/pdf/FileUploader.tsx"],
  ["src/components/FileUploader.test.tsx", "src/components/pdf/FileUploader.test.tsx"],
  ["src/components/ErrorBoundary.tsx", "src/components/shell/ErrorBoundary.tsx"],
  ["src/components/Providers.tsx", "src/components/shell/Providers.tsx"],
  ["src/components/UserMenu.tsx", "src/components/shell/UserMenu.tsx"],
  ["src/components/ThemeScope.tsx", "src/components/ui/ThemeScope.tsx"],
  ["src/components/icons.tsx", "src/components/ui/icons.tsx"],
  ["src/components/icons.test.tsx", "src/components/ui/icons.test.tsx"],
  // helpers inside component folders: kebab-case
  ["src/components/champion/heroFixture.ts", "src/components/champion/hero-fixture.ts"],
  ["src/components/fx/ceremonyQueue.ts", "src/components/fx/ceremony-queue.ts"],
  ["src/components/fx/mergeRefs.ts", "src/components/fx/merge-refs.ts"],
  ["src/components/history/sessionMeta.tsx", "src/components/history/session-meta.tsx"],

  // lib: feature modules into their folder, kebab-case names; app-wide ones (routes, site, theme, utils...) stay
  ["src/lib/api.ts", "src/lib/api/index.ts"],
  ["src/lib/api.test.ts", "src/lib/api/index.test.ts"],
  ["src/lib/errorActions.ts", "src/lib/api/error-actions.ts"],
  ["src/lib/errorActions.test.ts", "src/lib/api/error-actions.test.ts"],
  ["src/lib/chatStream.ts", "src/lib/chat/chat-stream.ts"],
  ["src/lib/chatStream.test.ts", "src/lib/chat/chat-stream.test.ts"],
  ["src/lib/documents.ts", "src/lib/study/documents.ts"],
  ["src/lib/documents.test.ts", "src/lib/study/documents.test.ts"],
  ["src/lib/upload.ts", "src/lib/study/upload.ts"],
  ["src/lib/upload.test.ts", "src/lib/study/upload.test.ts"],
  ["src/lib/sessions.ts", "src/lib/study/sessions.ts"],
  ["src/lib/today.ts", "src/lib/study/today.ts"],
  ["src/lib/today.test.ts", "src/lib/study/today.test.ts"],
  ["src/lib/study/conceptMap.ts", "src/lib/study/concept-map.ts"],
  ["src/lib/study/conceptMap.test.ts", "src/lib/study/concept-map.test.ts"],
  ["src/lib/appearance.ts", "src/lib/game/appearance.ts"],
  ["src/lib/appearance.test.ts", "src/lib/game/appearance.test.ts"],
  ["src/lib/gear.ts", "src/lib/game/gear.ts"],
  ["src/lib/rarity.ts", "src/lib/game/rarity.ts"],
  ["src/lib/rarity.test.ts", "src/lib/game/rarity.test.ts"],
  ["src/lib/features.ts", "src/lib/landing/features.ts"],
  ["src/lib/features.test.ts", "src/lib/landing/features.test.ts"],
  ["src/lib/plan-tiers.ts", "src/lib/account/plan-tiers.ts"],
  ["src/lib/planNotice.ts", "src/lib/account/plan-notice.ts"],
  ["src/lib/account/upgradeNotice.ts", "src/lib/account/upgrade-notice.ts"],
  ["src/lib/signup.ts", "src/lib/auth/signup.ts"],
  ["src/lib/signup.test.ts", "src/lib/auth/signup.test.ts"],
  ["src/lib/auth/authApi.ts", "src/lib/auth/auth-api.ts"],
  ["src/lib/auth/authApi.test.ts", "src/lib/auth/auth-api.test.ts"],
  ["src/lib/admin/adminApi.ts", "src/lib/admin/admin-api.ts"],
  ["src/lib/arena/noLegacy.test.ts", "src/lib/arena/no-legacy.test.ts"],
  ["src/lib/repo-files.test.ts", "src/test/repo-files.test.ts"],
  ["src/test/softCanvas.ts", "src/test/soft-canvas.ts"],

  // server: features into their folder; the plumbing (context, env, errors, http, route, status...) stays on top
  ["src/server/account.ts", "src/server/auth/account.ts"],
  ["src/server/account-usage.ts", "src/server/account/usage.ts"],
  ["src/server/admin.ts", "src/server/account/admin.ts"],
  ["src/server/billing.ts", "src/server/account/billing.ts"],
  ["src/server/billing.test.ts", "src/server/account/billing.test.ts"],
  ["src/server/invites.ts", "src/server/account/invites.ts"],
  ["src/server/plans.ts", "src/server/account/plans.ts"],
  ["src/server/planNotices.ts", "src/server/account/plan-notices.ts"],
  ["src/server/planNotices.test.ts", "src/server/account/plan-notices.test.ts"],
  ["src/server/courses.ts", "src/server/study/courses.ts"],
  ["src/server/documents.ts", "src/server/study/documents.ts"],
  ["src/server/documents.test.ts", "src/server/study/documents.test.ts"],
  ["src/server/study/conceptMap.ts", "src/server/study/concept-map.ts"],
  ["src/server/apiNotFound.test.ts", "src/server/api-not-found.test.ts"],
  ["src/server/game/arenaAi.ts", "src/server/game/arena-ai.ts"],
  ["src/server/game/arenaApi.ts", "src/server/game/arena-api.ts"],
  ["src/server/game/arenaPrompts.ts", "src/server/game/arena-prompts.ts"],
];

/** Files and folders nothing uses any more. */
const DELETE = [
  "src/components/SessionList.tsx",            // unused
  "src/components/ShopPanel.tsx",              // unused (the shop is components/play/ShopTab.tsx)
  "src/components/shell/nav-items.tsx",        // unused
  "src/components/__snapshots__",              // the snapshot of a test deleted long ago
  "src/app/dev",                               // dev-only preview pages (never built for production)
  "perf",                                      // the one-off performance measurement ...
  "playwright.perf.config.ts",                 // ... and its config
  "docs/archive",                              // old notes from the Python era
  "docs/performance-report.md",
  "DELETE.txt",                                // a note from a zip
  "coursemateai-logo.png",                     // a stray copy (the app's icons are in src/app and public/icons)
];

const root = process.cwd();
if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "src"))) {
  console.error("Run this from the project's root folder (where package.json is).");
  process.exit(1);
}

const tracked = (rel) => {
  try { execFileSync("git", ["ls-files", "--error-unmatch", rel], { cwd: root, stdio: "ignore" }); return true; }
  catch { return false; }
};
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const touched = new Set();

for (const [from, to] of MOVES) {
  const src = join(root, from), dst = join(root, to);
  if (!existsSync(src)) { console.log(existsSync(dst) ? `done     ${to}` : `missing  ${from}`); continue; }
  touched.add(dirname(src));
  if (existsSync(dst) && !isDir(src)) {
    // the new file is already there (unzipped first?): the old one is a leftover
    rmSync(src, { force: true });
    console.log(`removed  ${from} (already at ${to})`);
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (isDir(src) && existsSync(dst)) {
    // both folders exist: move what is inside, one by one
    for (const name of readdirSync(src)) MOVES.push([join(from, name), join(to, name)]);
    touched.add(src);
    continue;
  }
  let viaGit = false;
  if (tracked(from)) {
    try { execFileSync("git", ["mv", from, to], { cwd: root, stdio: "ignore" }); viaGit = true; } catch { /* fall back */ }
  }
  if (!viaGit) renameSync(src, dst);
  console.log(`moved    ${from} -> ${to}`);
}

for (const rel of DELETE) {
  const p = join(root, rel);
  if (!existsSync(p)) { console.log(`gone     ${rel}`); continue; }
  rmSync(p, { recursive: true, force: true });
  touched.add(dirname(p));
  console.log(`deleted  ${rel}`);
}

// folders left empty (and their empty parents, up to the repo root)
for (let dir of touched) {
  while (dir.startsWith(root) && dir !== root && isDir(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    console.log(`emptied  ${dir.slice(root.length + 1)}`);
    dir = dirname(dir);
  }
}
console.log("\nDone. Next: npm run check");
