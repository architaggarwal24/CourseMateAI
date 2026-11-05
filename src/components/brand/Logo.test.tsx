import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Logo, { LogoMark, MARK } from "./Logo";

afterEach(cleanup);
const ROOT = join(__dirname, "../../..");

describe("the CourseMateAI logo (Companion C)", () => {
  it("reads as one name to a screen reader, and draws the C and the dot", () => {
    const { container } = render(<Logo />);
    expect(screen.getByRole("img", { name: "CourseMateAI" })).toBeTruthy();
    expect(container.querySelector("path")!.getAttribute("d")).toBe(MARK.c);
    expect(container.querySelector("circle")).toBeTruthy();
    expect(container.textContent).toBe("CourseMateAI");
  });

  it("the mark alone is decorative unless it is given a title", () => {
    const { container, rerender } = render(<LogoMark />);
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    rerender(<LogoMark title="CourseMateAI home" />);
    expect(screen.getByRole("img", { name: "CourseMateAI home" })).toBeTruthy();
  });

  it("the favicon, app icons and link preview are drawn from the same mark", () => {
    const svg = readFileSync(join(ROOT, "src/app/icon.svg"), "utf8");
    expect(svg).toContain(`d="${MARK.c}"`);
    expect(svg).toMatch(/prefers-color-scheme: dark/);                      // the C follows the browser's theme
    for (const f of ["public/favicon.ico", "public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/maskable-512.png",
      "public/icons/apple-touch-icon.png", "src/app/opengraph-image.png"]) {
      expect(existsSync(join(ROOT, f)), f).toBe(true);
    }
    const png = readFileSync(join(ROOT, "public/icons/icon-512.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
    const ico = readFileSync(join(ROOT, "public/favicon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);                                    // an icon file
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(2);                  // 16 and 32 px at least
  });
});
