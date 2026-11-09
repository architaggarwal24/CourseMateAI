import { defineConfig, devices } from "@playwright/test";

// Accessibility + mobile checks (axe) against the production build. The backend is not needed: every /api/v1 call
// is answered by e2e/fixtures/api.ts, so the run is the same on any machine.
//
//   npx playwright install chromium     (once)
//   npm run test:e2e                    (builds, starts the app on :3100, runs axe on every page, desktop + 360px)
//
// Already have a build / server running?  PW_BASE_URL=http://localhost:3000 npx playwright test
// A Chromium installed somewhere else?    PW_CHROMIUM_PATH=/path/to/chrome npx playwright test
const PORT = 3100;
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Each worker drives a whole browser against one production server: more than 4 at once overloads a laptop and
  // tests time out waiting (PW_WORKERS overrides).
  workers: Number(process.env.PW_WORKERS) || (process.env.CI ? 2 : 4),
  reporter: [["list"]],
  use: {
    baseURL,
    // The service worker would fetch pages itself, out of reach of the per-test API mocks: off, except in pwa.spec.ts.
    serviceWorkers: "block",
    // Pinned, so the result is the same on every machine (otherwise the OS's light/dark and "show animations"
    // settings leak in). Dark mode is checked by axe.spec.ts and the desktop-dark project.
    colorScheme: "light",
    reducedMotion: "no-preference",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // The flows with dialogs, toasts and the arena again in dark mode (the page sweep in axe.spec.ts does its own dark pass).
    { name: "desktop-dark", testMatch: /(arena|courses|exam|plans|review|citations)\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, colorScheme: "dark" } },
    // 360px wide, touch: what a small Android phone is. (Chromium engine for both, so one browser install is enough.)
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: process.env.PW_BASE_URL ? undefined : {
    command: `npm run build && npx next start -p ${PORT}`,
    // a production build needs the canonical address (src/lib/site.ts); the tests check it is used everywhere
    env: { NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "https://coursemateai.architaggarwal.workers.dev" },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: "ignore",
  },
});
