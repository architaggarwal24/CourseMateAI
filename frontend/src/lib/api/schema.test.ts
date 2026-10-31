// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

// Same inputs/options as `npm run gen:api` (see package.json).
const SNAPSHOT = new URL("../../../../backend/openapi.json", import.meta.url);
const GENERATED = new URL("./generated/schema.d.ts", import.meta.url);
const lf = (text: string) => text.replace(/\r\n/g, "\n");

describe("generated API types", () => {
  it("match backend/openapi.json (run `npm run gen:api` after changing the backend API)", async () => {
    const ast = await openapiTS(SNAPSHOT, { defaultNonNullable: false });
    const expected = COMMENT_HEADER + astToString(ast);
    const committed = readFileSync(fileURLToPath(GENERATED), "utf8");
    expect(lf(committed)).toBe(lf(expected));
  });

  it("describe the versioned API surface the client calls", () => {
    const schema = JSON.parse(readFileSync(fileURLToPath(SNAPSHOT), "utf8"));
    const paths = Object.keys(schema.paths);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.every((p) => p.startsWith("/api/v1/"))).toBe(true);   // legacy aliases stay out of the schema
  });
});
