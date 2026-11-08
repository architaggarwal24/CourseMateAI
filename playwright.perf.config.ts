import { defineConfig, devices } from "@playwright/test";

// The performance measurement in perf/ (see perf/measure.spec.ts). One worker, so pages don't compete for the CPU.
// Needs a production build: `npm run build` first (or PW_BASE_URL pointing at a running server).
const PORT = 3100;
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./perf",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    serviceWorkers: "block",
    colorScheme: "light",
    reducedMotion: "no-preference",
    // A phone-sized screen: what most students will open the app on.
    ...devices["Pixel 5"],
    viewport: { width: 360, height: 740 },
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: process.env.PW_BASE_URL ? undefined : {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
  },
});
