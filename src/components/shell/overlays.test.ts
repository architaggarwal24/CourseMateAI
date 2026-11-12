// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The frame lifts everything in it over the backdrop (position: relative; z-index: 1). Overlays that float over the
// whole screen are direct children of the frame too, so they must be left out of that rule, or they become a strip
// in the layout under the page (the portal's pixels, the focus bar).
describe("overlays in the app frame", () => {
  const css = readFileSync(join(__dirname, "shell.css"), "utf8");
  const rule = css.match(/\.app-shell > :not\(([^)]*)\)\s*\{\s*position: relative; z-index: 1;/);

  it("the portal transition and the focus bar float above the page, not inside its layout", () => {
    expect(rule).not.toBeNull();
    const left = rule![1].split(",").map((s) => s.trim());
    for (const overlay of [".portal-fx", ".focusbar", ".fx-coin-rain", ".fx-ach"]) expect(left).toContain(overlay);
  });
});
