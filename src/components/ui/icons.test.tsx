import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import * as Icons from "./icons";

afterEach(cleanup);
const SRC = join(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, out); else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("icons", () => {
  it("come from one place: no screen imports an icon pack directly", () => {
    const offenders = files(SRC).filter((p) => !p.endsWith(join("components", "ui", "icons.tsx")))
      .filter((p) => /from\s+["'](lucide-react|@heroicons\/react[^"']*)["']/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p));
    expect(offenders).toEqual([]);
  });

  it("are Heroicons outline, with Lucide only for what Heroicons lacks (game icons), drawn at the same line weight", () => {
    const { container } = render(<><Icons.BookOpen size={20} /><Icons.Swords size={20} /></>);
    const [hero, lucide] = [...container.querySelectorAll("svg")];
    expect(hero.getAttribute("data-icon-pack")).toBe("heroicons");
    expect(lucide.getAttribute("data-icon-pack")).toBe("lucide");
    for (const svg of [hero, lucide]) {
      expect(svg.getAttribute("width")).toBe("20");
      expect(svg.getAttribute("stroke-width")).toBe("1.5");
      expect(svg.getAttribute("aria-hidden")).toBe("true");                 // decorative unless labelled
    }
  });

  it("small icons get a slightly heavier line so they don't go faint, and a label makes an icon speak", () => {
    const { container, getByRole } = render(<><Icons.Check size={14} /><Icons.X size={16} aria-label="Close" aria-hidden={false} /></>);
    expect(container.querySelector("svg")!.getAttribute("stroke-width")).toBe("2");
    expect(getByRole("img", { name: "Close" })).toBeTruthy();
  });
});
