// The Worker's bindings (D1, R2, ...) for route handlers. null outside Cloudflare (`next start`,
// Docker); under `next dev` wrangler's local platform supplies them (initOpenNextCloudflareForDev in next.config).
import { getCloudflareContext } from "@opennextjs/cloudflare";

let testEnv: CloudflareEnv | null = null;

/** Tests hand route handlers a local platform (src/server/test/platform.ts). */
export function setEnvForTests(env: CloudflareEnv | null): void {
  testEnv = env;
}

export async function getEnv(): Promise<CloudflareEnv | null> {
  if (testEnv) return testEnv;
  try {
    return (await getCloudflareContext({ async: true })).env as CloudflareEnv;
  } catch {
    return null;
  }
}

// ── work that may finish after the response (Workers: ctx.waitUntil) ─────────────────────────────────────────
const pendingInTests: Promise<unknown>[] = [];
let trackForTests = false;

/** Tests collect background work and await it (settleBackground) instead of letting it outlive the test. */
export function trackBackgroundForTests(on: boolean): void {
  trackForTests = on;
}

export async function settleBackground(): Promise<void> {
  while (pendingInTests.length) await Promise.allSettled(pendingInTests.splice(0));
}

/** Run `work` without making the response wait for it. Never rejects. */
export function background(work: () => Promise<unknown>): void {
  const p = Promise.resolve().then(work).catch((e) => console.warn("[coursemate] background work failed", e instanceof Error ? e.message : e));
  if (trackForTests) { pendingInTests.push(p); return; }
  try {
    getCloudflareContext().ctx.waitUntil(p);
  } catch { /* outside a Worker request: it simply runs on */ }
}
