// The Worker's bindings (D1, R2, ...) for route handlers. null outside Cloudflare (`next start`,
// Docker); under `next dev` wrangler's local platform supplies them (initOpenNextCloudflareForDev in next.config).
import * as log from "./log";
import { getCloudflareContext } from "@opennextjs/cloudflare";

let testEnv: CloudflareEnv | null = null;

/** Tests hand route handlers a local platform (src/server/test/platform.ts). */
export function setEnvForTests(env: CloudflareEnv | null): void {
  testEnv = env;
}

export async function getEnv(): Promise<CloudflareEnv | null> {
  if (testEnv) return testEnv;
  try {
    const env = (await getCloudflareContext({ async: true })).env as CloudflareEnv;
    fillProcessEnv(env as unknown as Record<string, unknown>);
    return env;
  } catch {
    return null;
  }
}

/**
 * The Worker's text settings (vars and secrets) into process.env, where the server reads them, without overwriting
 * anything already there. On Cloudflare OpenNext has done this already; under `next dev` nobody does, so .dev.vars
 * (OWNER_EMAIL, BETTER_AUTH_SECRET, the AI keys) reached only the Cloudflare context and the owner wasn't recognised.
 */
export function fillProcessEnv(env: Record<string, unknown> | null | undefined): void {
  if (!env) return;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && process.env[k] === undefined) process.env[k] = v;
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
  const p = Promise.resolve().then(work).catch((e) => log.warn("[coursemate] background work failed", e instanceof Error ? e.message : e));
  if (trackForTests) { pendingInTests.push(p); return; }
  try {
    getCloudflareContext().ctx.waitUntil(p);
  } catch { /* outside a Worker request: it simply runs on */ }
}
