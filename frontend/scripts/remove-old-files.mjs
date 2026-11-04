// One-off cleanup after the redesign: files the redesign replaced or removed. Unzipping updates cannot delete files,
// so run this once from the frontend folder:   node scripts/remove-old-files.mjs
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
  "src/components/hero/ForgeTab.tsx",
  "src/hooks/useArenaHero.ts",             // -> hooks/useChampion.ts (saved on the account)
  "src/app/dev/avatar",
];

for (const rel of OLD) {
  const p = join(process.cwd(), rel);
  if (existsSync(p)) { rmSync(p, { recursive: true, force: true }); console.log("removed  ", rel); }
  else console.log("not found", rel);
}
