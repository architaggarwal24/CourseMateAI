/** @vitest-environment node */
// The D1 migrations (migrations/, written by `npm run db:generate` from src/server/db/schema.ts).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, migrationStatements } from "./test/platform";

describe("D1 migrations", () => {
  it("are all made by drizzle-kit (each SQL file is in its journal)", () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
    const listed = journal.entries.map((e: { tag: string }) => `${e.tag}.sql`).sort();
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual(listed);
  });

  // The deploy migrates before the new Worker version goes live, so the version still serving must keep working:
  // a migration only adds. Removing or rebuilding a table comes later, once no deployed code reads it, with a
  // `-- allow-destructive` comment in that statement.
  it("only ever add", () => {
    const destructive = /\b(DROP\s+(TABLE|COLUMN)|RENAME\s+(TO|COLUMN))\b/i;
    const offenders = migrationStatements().filter((s) => destructive.test(s) && !/--\s*allow-destructive/i.test(s));
    expect(offenders).toEqual([]);
  });
});
