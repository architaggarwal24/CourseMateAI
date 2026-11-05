// Real Cloudflare bindings for server tests: wrangler's local platform (workerd + miniflare) with an in-memory D1
// and R2, migrated with the same files `wrangler d1 migrations apply` runs. Each call gets a fresh, empty platform.
// The bindings come from wrangler.test.jsonc (next to this file), not frontend/wrangler.jsonc, so a remote or
// renamed binding in your own setup can never point a test at real data.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const MIGRATIONS_DIR = join(ROOT, "migrations");

/** The SQL statements of every migration, in order (drizzle-kit separates them with `--> statement-breakpoint`). */
export function migrationStatements(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) => readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint"))
    .map((s) => s.trim())
    .filter(Boolean);
}

// One batch (one round trip, all or nothing) instead of a call per statement: about 0.45 s less per platform.
export async function migrate(db: D1Database): Promise<void> {
  await db.batch(migrationStatements().map((statement) => db.prepare(statement)));
}

export interface LocalPlatform {
  env: CloudflareEnv;
  dispose: () => Promise<void>;
}

export async function localPlatform(): Promise<LocalPlatform> {
  const proxy = await getPlatformProxy<CloudflareEnv>({
    configPath: join(ROOT, "src", "server", "test", "wrangler.test.jsonc"),
    persist: false,
    remoteBindings: false,
    envFiles: [],
  });
  if (!proxy.env.DB || !proxy.env.FILES) throw new Error("src/server/test/wrangler.test.jsonc must declare the DB and FILES bindings");
  await migrate(proxy.env.DB);
  return { env: proxy.env, dispose: proxy.dispose };
}
