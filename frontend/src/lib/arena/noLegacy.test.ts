// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");
const ROOT = join(SRC, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}
const arenaCode = [
  ...sources(join(SRC, "components/arena")), ...sources(join(SRC, "lib/arena")), join(SRC, "hooks/useArenaBattle.ts"),
];

describe("the arena is React all the way down", () => {
  it("renders every piece of text through React: no innerHTML, no postMessage, no pop-up window, no hand-off through storage", () => {
    expect(arenaCode.length).toBeGreaterThan(8);
    for (const file of arenaCode) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write/);
      expect(text, file).not.toMatch(/postMessage|window\.open|backend_url|localStorage|cmai_active_boss|\/arena\/prefetch/);
    }
  });

  it("the legacy arena is gone: no static files, no old component, no /static rewrite, no legacy aliases", () => {
    expect(existsSync(join(ROOT, "backend/static"))).toBe(false);
    expect(existsSync(join(SRC, "components/ArenaView.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "backend/routers/legacy.py"))).toBe(false);
    expect(readFileSync(join(ROOT, "frontend/next.config.ts"), "utf8")).not.toMatch(/\/static\/:path/);
    expect(readFileSync(join(ROOT, "backend/app.py"), "utf8")).not.toMatch(/StaticFiles|legacy_router/);
  });

  it("the old client-side battle state is gone from the frontend", () => {
    const all = sources(SRC).filter((f) => !f.includes("generated"));
    for (const file of all) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/handleHeal|summonBoss|generateArenaQuiz|handleOpenBattleArena|\/static\/arena\.html/);
    }
  });
});
