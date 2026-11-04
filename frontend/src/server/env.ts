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
