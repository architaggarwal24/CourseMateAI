# Stage 1 — Foundation + design system

Unzip over the project root (paths are relative to `CourseMateAI/`). Then delete the files listed under "Delete".

## Delete these (removed in this stage)
- frontend/postcss.config.js            (replaced by postcss.config.mjs)
- frontend/tailwind.config.js           (Tailwind v4: config now lives in src/app/globals.css `@theme`)
- frontend/src/fonts/inter.ts, frontend/src/fonts/Inter-latin-variable.woff2, frontend/src/fonts/LICENSE-Inter.txt  (Geist replaces Inter)
- frontend/src/components/arena/BossCanvas.tsx   (dead code; was breaking 11 tests + tsc)
- frontend/undefined/   (stray screenshots folder)

## Then
```
cd frontend
rm -rf node_modules package-lock.json   # lockfile in zip is fresh; a clean install avoids React 18 leftovers
npm install
npm run dev
```

## What changed
- **Stack**: React 19.3, Next 16.4, Tailwind 4.3 (CSS-first), motion 14.8, lucide 1.x, zustand 5, react-markdown 10,
  uuid 14 + new: GSAP, Three.js / R3F / drei, Radix (`radix-ui`), cmdk, class-variance-authority, tw-animate-css, Phosphor icons, Geist fonts. shadcn `components.json` added.
- **Tokens** (`src/styles/tokens.css`): Study = "graphite glass" (indigo accent, aurora, frosted panels); Play = "arcane glass"
  (violet + gold, stronger glow). New `--glass-*`, `--aurora-*`, `--glow-*`, spring/expo easings, Geist Sans/Mono.
- **Tailwind class names renamed** (codemod over all .tsx): `bg-bg-primary→bg-canvas`, `bg-bg-card→bg-panel`, `text-text-primary→text-fg`,
  `text-text-secondary→text-fg-2`, `text-text-muted→text-fg-muted`, `border-border*→border-line*`, `text-accent-X→text-ink-X` (fills stay `bg-accent-X`).
- **UI kit** restyled to glass: Button (lift, sheen sweep, spring press, ripple from click point, new `reward` variant + spark burst, `size="lg"`),
  Card (glass, new `interactive` spotlight prop), inputs (glow focus), segmented Tabs with sliding lit pill, glass Modal/Toast (toast drain timer), Badge, Skeleton shimmer, EmptyState floating icon.
- **Effects library** `src/components/fx/`: Aurora, Starfield (canvas, parallax), Spotlight, Magnetic, TiltCard, AnimatedNumber, TextReveal, sparkBurst/ripple. All respect reduced motion + the in-app "Reduce animations" setting.
- **Shell**: floating glass sidebar with pointer light, area blurbs, "Go to… ⌘K" **command palette** (Radix Dialog + cmdk), floating mobile dock, aurora backdrop (+ starfield in Hero), page-enter transition (`app/(app)/template.tsx`), new loading orb.
- Docker base → node:22-alpine.

## What to test
1. `npm run typecheck` and `npm test` → expect **437/437** pass.
2. `npm run build` → succeeds.
3. `npm run dev`, open **/dev/kit** → both themes side by side. Hover the Spotlight / Tilt cards, hover + click buttons (ripple, sheen), click "Claim reward" (sparks), toggle the switch (number counts up).
4. Press **⌘K / Ctrl+K** anywhere in the app → type "arena" → Enter navigates. Esc closes, focus returns.
5. Sidebar: hover it (soft light follows pointer), switch areas (pill slides, page fades in).
6. Hero area: starfield drifts and leans with the mouse.
7. Mobile width (<768px): floating dock at bottom.
8. Settings → Appearance → "Reduce animations" ON → aurora, stars, ripples, sparks all stop.

## Known / next stage
- Study screens (chat/quiz/notes/flashcards/upload/login/account) still have their old inner layouts on top of the new kit —
  that's Stage 2. Arena/Hero inner screens are Stage 4.
