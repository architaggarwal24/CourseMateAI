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
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  use: {
    baseURL,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // 360px wide, touch: what a small Android phone is. (Chromium engine for both, so one browser install is enough.)
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: process.env.PW_BASE_URL ? undefined : {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: "ignore",
  },
});
