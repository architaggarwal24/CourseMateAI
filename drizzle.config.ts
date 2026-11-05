// The D1 schema lives in src/server/db/schema.ts. `npm run db:generate` writes the next SQL migration into
// migrations/, which `wrangler d1 migrations apply` runs (locally, in tests and on deploy).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./migrations",
});
