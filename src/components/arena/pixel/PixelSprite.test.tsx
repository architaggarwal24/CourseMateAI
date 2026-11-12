import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { HEROES } from "@/lib/pixel/heroes";
import PixelSprite, { SPRITE_FIDGET_WAIT } from "./PixelSprite";

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
