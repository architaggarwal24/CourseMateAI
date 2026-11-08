import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Source rules from the performance pass (Stage P3/P4). Each guards a saving that one innocent edit would undo.
const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("performance rules", () => {
  it("only the two faces the first paint needs are preloaded (Onest, Bricolage); Geist Mono and the pixel font load on use", () => {
    expect(read("fonts/brand.ts")).not.toMatch(/preload:\s*false/);
    expect(read("fonts/geist.ts")).toMatch(/preload:\s*false/);
    expect(read("fonts/pixel.ts")).toMatch(/preload:\s*false/);
  });

  it("Geist Mono stays subset (it was 71 KB with Cyrillic, Greek and Vietnamese)", () => {
    expect(statSync(join(SRC, "fonts/GeistMono-Variable.woff2")).size).toBeLessThan(45_000);
  });

  it("the login page's entrance is CSS, so its server HTML is never stuck at opacity 0 waiting for JavaScript", () => {
    const login = read("app/login/page.tsx");
    expect(login).not.toMatch(/from ['"]motion\/react['"]/);
    expect(login).not.toMatch(/initial=\{\{\s*opacity:\s*0/);
    expect(read("components/fx/TextReveal.tsx")).not.toMatch(/from ["']motion\/react["']/);
  });
});

describe("static asset caching on Cloudflare (public/_headers)", () => {
  const headers = readFileSync(join(SRC, "..", "public", "_headers"), "utf8");
  const rule = (path: string) => {
    const i = headers.indexOf(`\n${path}\n`);
    return i < 0 ? "" : headers.slice(i + path.length + 2).split(/\n(?=\S)/)[0];
  };
  it("hashed build files are kept for a year and never re-checked", () => {
    expect(rule("/_next/static/*")).toMatch(/Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/);
  });
  it("the service worker is never cached (next.config.ts headers don't reach static files)", () => {
    expect(rule("/sw.js")).toMatch(/Cache-Control:\s*no-cache/);
  });
});
