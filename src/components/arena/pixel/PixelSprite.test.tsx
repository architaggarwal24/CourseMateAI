import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { HEROES } from "@/lib/pixel/heroes";
import PixelSprite, { SPRITE_FIDGET_WAIT } from "./PixelSprite";
import { activeTicks } from "@/lib/pixel/ticker";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("PixelSprite idle fidgets (Stage 7)", () => {
  it("left idle with `fidget`, it plays one now and then, never the same twice running, and goes back to idle", () => {
    vi.useFakeTimers();
    const { container } = render(<PixelSprite hero={HEROES[0]} fidget label="Kaien" />);
    const canvas = () => container.querySelector("canvas")!;
    expect(canvas().dataset.fidget).toBeUndefined();
    const played: string[] = [];
    for (let i = 0; i < 6; i++) {
      act(() => { vi.advanceTimersByTime(SPRITE_FIDGET_WAIT[1] + 10); });
      const f = canvas().dataset.fidget;
      expect(f).toMatch(/^fidget[123]$/);
      played.push(f!);
      act(() => { vi.advanceTimersByTime(5000); });                            // it ends: idle again
      expect(canvas().dataset.fidget).toBeUndefined();
    }
    played.forEach((f, i) => { if (i) expect(f).not.toBe(played[i - 1]); });
  });

  it("a creature fidgets with its own two; nothing without `fidget`, in another animation, or as a still", () => {
    vi.useFakeTimers();
    const boss = render(<PixelSprite boss="kraken" fidget />);
    act(() => { vi.advanceTimersByTime(SPRITE_FIDGET_WAIT[1] + 10); });
    expect(boss.container.querySelector("canvas")!.dataset.fidget).toMatch(/^fidget[12]$/);
    cleanup();
    for (const el of [<PixelSprite key="a" hero={HEROES[1]} />, <PixelSprite key="b" hero={HEROES[1]} anim="win" fidget />, <PixelSprite key="c" hero={HEROES[1]} still fidget />]) {
      const r = render(el);
      act(() => { vi.advanceTimersByTime(SPRITE_FIDGET_WAIT[1] * 2); });
      expect(r.container.querySelector("canvas")!.dataset.fidget).toBeUndefined();
      cleanup();
    }
  });
});

/** A canvas that counts what is drawn on it (jsdom has none). */
function fakeCanvas() {
  const draws = { n: 0 };
  const ctx = {
    clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, putImageData() {},
    drawImage() { draws.n++; },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return draws;
}

/** An IntersectionObserver the test drives: show(true / false) scrolls every watched sprite in or out of view. */
function fakeViewport() {
  const watchers: ((e: { isIntersecting: boolean }[]) => void)[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) { watchers.push(cb); }
    observe() {} disconnect() {}
  });
  return { show: (on: boolean) => act(() => { watchers.forEach((w) => w([{ isIntersecting: on }])); }) };
}

describe("PixelSprite performance (smooth Hero world)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("draws only when its frame changes, on the shared clock, not every display frame", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
    const draws = fakeCanvas();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    render(<PixelSprite hero={HEROES[0]} label="Kaien" />);
    const first = draws.n;
    expect(first).toBeGreaterThan(0);                                  // drawn straight away
    expect(activeTicks()).toBe(1);
    act(() => { vi.advanceTimersByTime(1000); });                      // idle runs at 10 fps
    expect(draws.n - first).toBeGreaterThanOrEqual(9);
    expect(draws.n - first).toBeLessThanOrEqual(11);
    expect(raf).not.toHaveBeenCalled();                                // no per-sprite frame loop
    cleanup();
    expect(activeTicks()).toBe(0);
  });

  it("stops drawing while scrolled out of view (or hidden), and catches up when it comes back", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const draws = fakeCanvas();
    const view = fakeViewport();
    render(<PixelSprite hero={HEROES[1]} label="Rin" />);
    view.show(true);
    expect(activeTicks()).toBe(1);
    view.show(false);
    expect(activeTicks()).toBe(0);
    const n = draws.n;
    act(() => { vi.advanceTimersByTime(3000); });
    expect(draws.n).toBe(n);                                           // nothing drawn off screen
    view.show(true);
    expect(draws.n).toBeGreaterThan(n);                                // back: the right frame at once
    expect(activeTicks()).toBe(1);
  });

  it("a still sprite, or reduced motion, is drawn once and never joins the clock", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const draws = fakeCanvas();
    render(<PixelSprite hero={HEROES[2]} still />);
    expect(draws.n).toBeGreaterThan(0);
    expect(activeTicks()).toBe(0);
  });
});
