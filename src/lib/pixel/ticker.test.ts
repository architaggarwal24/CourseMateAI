import { afterEach, describe, expect, it, vi } from "vitest";
import { activeTicks, BATCH_MS, nextFrameAt, tick } from "./ticker";

afterEach(() => { vi.useRealTimers(); });

describe("the sprite clock: one timer for every sprite on screen", () => {
  it("wakes only when a sprite's next frame is due, and runs every sprite due then in one go", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const t0 = performance.now();
    const a: number[] = [], b: number[] = [];
    const offA = tick(t0 + 100, (now) => { a.push(Math.round(now - t0)); return now + 100; });   // 10 fps
    const offB = tick(t0 + 100, (now) => { b.push(Math.round(now - t0)); return now + 200; });   // 5 fps
    expect(vi.getTimerCount()).toBe(1);                                // one timer, not one per sprite
    vi.advanceTimersByTime(99);
    expect(a).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(a).toEqual([100]);
    expect(b).toEqual([100]);                                          // both due: one wake-up
    vi.advanceTimersByTime(300);
    expect(a).toEqual([100, 200, 300, 400]);
    expect(b).toEqual([100, 300]);
    offA(); offB();
    expect(activeTicks()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);                                // nothing on screen: the clock sleeps
  });

  it("sprites due within a display frame of each other wake together, each drawing the frame it was due", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const t0 = performance.now();
    const seen: [string, number][] = [];
    tick(t0 + 100, (t) => { seen.push(["a", Math.round(t - t0)]); return null; });
    tick(t0 + 100 + BATCH_MS - 4, (t) => { seen.push(["b", Math.round(t - t0)]); return null; });
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([["a", 100], ["b", 100 + BATCH_MS - 4]]);   // one wake-up at 100 ran both
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a sprite that returns null is done (a one-shot animation ended) and leaves the clock", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const t0 = performance.now();
    let runs = 0;
    tick(t0 + 50, (now) => (++runs < 3 ? now + 50 : null));
    vi.advanceTimersByTime(1000);
    expect(runs).toBe(3);
    expect(activeTicks()).toBe(0);
  });

  it("a frame's next change: the next whole frame of the sprite's own clock; nothing after a one-shot's last frame", () => {
    // started at 0, 10 fps: frames change at 100, 200, ...
    expect(nextFrameAt(0, 10, 0, 4, true)).toBe(100);
    expect(nextFrameAt(0, 10, 150, 4, true)).toBe(200);
    expect(nextFrameAt(0, 10, 950, 4, true)).toBe(1000);              // a loop never ends
    expect(nextFrameAt(0, 10, 250, 4, false)).toBe(300);              // frame 3 (the last) still to come
    expect(nextFrameAt(0, 10, 300, 4, false)).toBeNull();             // on the last frame: done
  });
});
