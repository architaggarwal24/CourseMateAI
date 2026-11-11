// One-off cleanup: files later stages replaced or removed. Unzipping updates cannot delete files,
// so run this once from the repo root:   node scripts/remove-old-files.mjs
// Safe to run again: missing files are skipped. (PostCSS config is checked and repaired by scripts/doctor.mjs.)
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const OLD = [
  "src/components/arena/BossCanvas.tsx",   // dead code: breaks the type check (bossSize / drawBoss no longer exist)
  "tailwind.config.js",                    // Tailwind 4 reads its config from src/app/globals.css
  "src/fonts/inter.ts",                    // Geist replaced Inter
  "src/fonts/Inter-latin-variable.woff2",
  "src/fonts/LICENSE-Inter.txt",
  "undefined",                             // a stray screenshots folder
  // Pixel arena (Stage C): the SVG boss, the 3D core and the old scene were replaced by src/lib/pixel
  "src/components/arena/Scene.tsx",
  "src/components/arena/bosses.tsx",
  "src/components/arena/HeroSprite.tsx",
  "src/components/arena/ArenaCore3D.tsx",
  "src/lib/arena/boss.ts",
  "src/lib/arena/boss.test.ts",
  "src/lib/arena/boss.test.tsx",
  "src/lib/arena/data",
  "src/app/dev/bosses",
  // Phase 3 / Stage 1: the pixel champion is the avatar everywhere; the vector avatar and the Hero Forge are retired
  "src/components/avatar",                 // HeroFace, HeroFigure, HeroForge, ItemIcon, ItemPicture, GearChips, art/*
  "src/lib/avatar",                        // look.ts, palettes, render.ts, sprites.ts, data/*
  "src/components/AvatarDisplay.tsx",
  "src/components/AvatarFace.tsx",
  "src/components/PixelAvatar.tsx",
  "src/components/PixelSprite.tsx",        // the old 16x16 item icon (the pixel sprite is components/arena/pixel/PixelSprite.tsx)
  "src/components/avatarRendering.test.tsx",
  "src/components/hero/AvatarTab.tsx",     // -> components/hero/ChampionTab.tsx
  // (the old components/hero/ForgeTab.tsx was listed here: a new ForgeTab.tsx, the Forge, now lives at that path)
  "src/hooks/useArenaHero.ts",             // -> hooks/useChampion.ts (saved on the account)
  "src/app/dev/avatar",
  // Phase 4 / Stage 4.3: the server's AI only - no keys of one's own any more
  "src/components/ProviderPicker.tsx",
  "src/components/ProviderPicker.test.tsx",
  "src/lib/llmProviders.ts",
  // Phase 4 / Stage 4.6: everything runs on the Worker; the Python backend, Docker and the VPS/Windows setups are gone
  "src/server/proxy.ts",
  "src/server/proxy.test.ts",
  "src/server/config.ts",
  "src/server/config.test.ts",
  "Dockerfile",
  "backend",
  "deploy",
  "docker-compose.yml",
  "Makefile",
  "setup.md",
  "AUDIT_FIXES.md",
  "docs/deploy-vps.md",
  "docs/deploy-windows.md",
  "docs/postgres.md",
  // After 4.6: old Phase 2 notes (the Python-era docs moved to docs/archive/ with git mv)
  "STAGE1_NOTES.md",
  "STAGE2_NOTES.md",
  "STAGE3_NOTES.md",
  "STAGE4_NOTES.md",
  "STAGE5_NOTES.md",
  // The app moved from frontend/ to the repo root (git mv); what git doesn't track stays behind in frontend/
  "frontend/.dockerignore",
  "frontend/tsconfig.tsbuildinfo",
  // Redesign Stage 1 (Ink): flat surfaces, Onest + Bricolage Grotesque; the ambient effects and Geist Sans are gone
  "src/fonts/Geist-Variable.woff2",
  "src/components/fx/Aurora.tsx",
  "src/components/fx/Starfield.tsx",
  "src/components/fx/Spotlight.tsx",
  "src/components/fx/TiltCard.tsx",
  "src/components/fx/usePointerVars.ts",
  // Performance pass: an empty leftover file
  "src/hooks/useApi.ts",
  // Stage Q1: the quest board's scrolls (components/hero/QuestScroll.tsx) replaced the old quest list
  "src/components/QuestPanel.tsx",
  // The Bestiary lives in its own tab (the book); the arena tab no longer shows the creature grid
  "src/components/arena/pixel/Bestiary.tsx",
  "src/components/arena/bestiary.test.tsx",
  // Your hero: the per-champion look editor and its route were replaced by the hero's own look (/api/v1/hero/look)
  "src/app/api/v1/avatar/champion/look",
  // Play navigation: Quests, Arena, Bestiary and Champion are pages (app/(app)/(play)); /hero only redirects
  // (app/hero/route.ts), and components/hero/HeroArea.tsx became PlayArea.tsx
  "src/app/(app)/hero",
  "src/components/hero/HeroArea.tsx",
  "src/components/hero/HeroArea.test.tsx",
  "DELETE.txt",                            // a note from a zip, unzipped into the root by mistake
  // Next's generated route checks: rebuilt by `next dev` / `next build`, but a stale one still points at the routes
  // above and fails the type check (npm run check) until then
  ".next/types/validator.ts",
  ".next/dev/types/validator.ts",
];

for (const rel of OLD) {
  const p = join(process.cwd(), rel);
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log("removed  ", rel); }
  else console.log("not found", rel);
}
