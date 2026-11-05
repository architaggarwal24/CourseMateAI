import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// jsdom has no 2D canvas: sprites become a stand-in image, and no sprite sheet or stage picture loads.
vi.mock("./canvas", () => ({ toCanvas: () => ({ width: 1, height: 1 }) }));
vi.mock("./sheets", async (orig) => ({ ...(await orig<typeof import("./sheets")>()), sheetFor: async () => null, stageImageFor: async () => null }));

import { DODGE_EVENTS } from "@/components/arena/BattleScreen";
import { FightScene, MECHANIC_FX, type Beat, type BeatKind, type MechanicEffect } from "./fight";
import { HEROES } from "./heroes";

// Every event the server can send (server/game/mechanics.ts and kits.ts: t.event("type", ...)) has a beat.
const GAME = resolve(__dirname, "../../server/game");
const serverEvents = () => [...new Set(["mechanics.ts", "kits.ts"].flatMap((f) =>
  [...readFileSync(resolve(GAME, f), "utf8").matchAll(/\bt\.event\("([a-z_]+)"/g)].map((m) => m[1])))];

describe("the beats cover the server's mechanic and kit events", () => {
  it("each event is an effect beat or a dodge", () => {
    const events = serverEvents();
    expect(events.length).toBeGreaterThan(20);
    const missing = events.filter((e) => !(e in MECHANIC_FX) && !DODGE_EVENTS.includes(e));
    expect(missing).toEqual([]);
  });
  it("and no effect is left over that the server never sends", () => {
    const events = new Set(serverEvents());
    expect(Object.keys(MECHANIC_FX).filter((k) => !events.has(k))).toEqual([]);
  });
});

// A canvas context that records nothing: the scene runs its real timeline (the frame loop driven by hand).
function fakeCanvas() {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => undefined),
    set: (t, k, v) => { t[k as string] = v; return true; },
  });
  return { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
}

describe("FightScene plays every new beat", () => {
  let frame: FrameRequestCallback | null = null;
  let now = 0;
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); frame = null; now = 0; });
  const run = (ms: number) => { for (let t = 0; t < ms; t += 16) { now += 16; frame?.(now); } };

  const scene = (reduced: boolean, onImpact = vi.fn(), onBanner = vi.fn()) =>
    ({ s: new FightScene(fakeCanvas(), { hero: HEROES[0], bossId: "minotaur", reduced, onImpact, onBanner }), onImpact, onBanner });

  for (const reduced of [false, true]) {
    it(`each mechanic effect runs to its end${reduced ? " (reduced motion)" : ""}, with its call-out banner`, () => {
      const { s, onBanner } = scene(reduced);
      run(1000);                                                     // past the intro
      for (const effect of Object.keys(MECHANIC_FX) as MechanicEffect[]) s.play({ kind: "mechanic", effect, key: effect });
      run(30_000);
      const banners = onBanner.mock.calls.filter(([, tone]) => tone === "mech").map(([t]) => t);
      expect(banners).toEqual(Object.values(MECHANIC_FX).filter((f) => f.banner).map((f) => f.banner));
      s.destroy();
    });
  }

  it("an ultimate shows its name; a dodge, a charge, a throw and a riposte each land once", () => {
    const { s, onImpact, onBanner } = scene(false);
    run(1000);
    onImpact.mockClear();
    const beats: [BeatKind, Partial<Beat>][] = [
      ["ultimate", { text: "NINTH PAGE CUT" }], ["dodge", {}], ["dodge", { projectile: true }], ["boss-strike", { charge: true }],
      ["boss-strike", { projectile: true }], ["riposte", {}],
    ];
    beats.forEach(([kind, extra], i) => s.play({ kind, ...extra, key: i }));
    run(20_000);
    expect(onBanner).toHaveBeenCalledWith("NINTH PAGE CUT", "ult");
    expect(onImpact.mock.calls).toEqual([["hero", 1], ["hero", 2], ["hero", 3], ["hero", 4], ["boss", 5]]);
    s.destroy();
  });
});
