/** @vitest-environment node */
// frontend/wrangler.jsonc names the bindings the code reads (env.DB, env.FILES). `wrangler d1 create` and
// `wrangler r2 bucket create` offer to add entries of their own with other names: those are never used.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

const CONFIG = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));

type D1Entry = { binding: string; database_id?: string; migrations_dir?: string };
type R2Entry = { binding: string; bucket_name?: string };

describe("wrangler.jsonc", () => {
  const raw = unstable_readConfig({ config: CONFIG }) as unknown as { d1_databases?: D1Entry[]; r2_buckets?: R2Entry[] };
  const config = { d1_databases: raw.d1_databases ?? [], r2_buckets: raw.r2_buckets ?? [] };

  it("has the D1 database as DB, with its migrations folder", () => {
    const db = config.d1_databases.find((d) => d.binding === "DB");
    expect(db, 'wrangler.jsonc needs a D1 binding named "DB" (the code reads env.DB)').toBeTruthy();
    expect(db!.migrations_dir).toBe("migrations");
  });

  it("has the file bucket as FILES", () => {
    expect(config.r2_buckets.find((b) => b.binding === "FILES"), 'wrangler.jsonc needs an R2 binding named "FILES"').toBeTruthy();
  });

  it("has no second binding to the same database or bucket", () => {
    const ids = config.d1_databases.map((d) => d.database_id);
    const buckets = config.r2_buckets.map((b) => b.bucket_name);
    expect(new Set(ids).size, "two D1 bindings point at one database: keep only DB").toBe(ids.length);
    expect(new Set(buckets).size, "two R2 bindings point at one bucket: keep only FILES").toBe(buckets.length);
  });
});
