import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// jsdom has no 2D canvas: sprites become a stand-in image, and no sprite sheet or stage picture loads.
vi.mock("./canvas", () => ({ toCanvas: () => ({ width: 1, height: 1 }) }));
vi.mock("./sheets", async (orig) => ({ ...(await orig<typeof import("./sheets")>()), sheetFor: async () => null, stageImageFor: async () => null }));

import { DODGE_EVENTS } from "@/components/arena/BattleScreen";
import { FIDGET_WAIT, FightScene, MECHANIC_FX, type Beat, type BeatKind, type MechanicEffect } from "./fight";
import { BOSS_FIDGET_KEYS, BOSS_FIDGETS, BOSSES, bossAnimFrames } from "./bosses";
import { FIDGET_KEYS, FIDGETS, HEROES, heroAnims, type Style } from "./heroes";

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

  it("left idle, both fighters fidget now and then (Stage 7): never the same twice in a row, back to idle after", () => {
    const { s } = scene(false);
    const seen = { h: [] as string[], b: [] as string[] };
    const actor = (k: "h" | "b") => (s as unknown as Record<string, { anim: string }>)[k].anim;
    for (let t = 0; t < 60_000; t += 16) {
      run(16);
      for (const k of ["h", "b"] as const) {
        const a = actor(k);
        if (a.startsWith("fidget") && seen[k].at(-1) !== a) seen[k].push(a);
        if (a === "idle" && seen[k].at(-1) !== "idle" && seen[k].length) seen[k].push("idle");
      }
    }
    const plays = (k: "h" | "b") => seen[k].filter((a) => a !== "idle");
    expect(plays("h").length).toBeGreaterThanOrEqual(60_000 / (FIDGET_WAIT[1] + 2000) - 1);
    expect(plays("b").length).toBeGreaterThanOrEqual(3);
    expect(plays("h").every((a) => (FIDGETS as readonly string[]).includes(a))).toBe(true);
    expect(plays("b").every((a) => (BOSS_FIDGETS as readonly string[]).includes(a))).toBe(true);
    for (const k of ["h", "b"] as const) plays(k).forEach((a, i, all) => { if (i) expect(a).not.toBe(all[i - 1]); });
    expect(seen.h.filter((a) => a === "idle").length).toBeGreaterThan(0);          // each one ends back in idle
    s.destroy();
  });

  it("no fidgets while something plays, or with reduced motion", () => {
    const busy = scene(false).s;
    run(1000);
    for (let i = 0; i < 40; i++) busy.play({ kind: "boss-strike", key: i });     // a long queue of blows
    let fidgeted = false;
    for (let t = 0; t < FIDGET_WAIT[1] + 1000; t += 16) { run(16); if ((busy as unknown as { h: { anim: string } }).h.anim.startsWith("fidget")) fidgeted = true; }
    expect(fidgeted).toBe(false);
    busy.destroy();
    const still = scene(true).s;
    for (let t = 0; t < 30_000; t += 16) { run(16); expect((still as unknown as { h: { anim: string } }).h.anim.startsWith("fidget")).toBe(false); }
    still.destroy();
  });

  it("knocked down (Stage 4): the champion stays down through a new turn, and a continue brings them back up", () => {
    const { s, onBanner } = scene(false);
    run(1000);
    s.play({ kind: "hero-down", key: 1 });
    run(1500);
    expect(onBanner).toHaveBeenCalledWith("DOWN!", "lose");
    const hero = () => (s as unknown as { h: { anim: string } }).h.anim;
    expect(hero()).toBe("ko");
    s.reset();
    expect(hero()).toBe("ko");                                       // a KO pose survives a new turn
    s.setDown(false);
    expect(hero()).toBe("idle");
    expect(onBanner).toHaveBeenCalledWith("BACK UP!", "fight");
    s.setDown(false);                                                // already up: nothing again
    expect(onBanner.mock.calls.filter(([t]) => t === "BACK UP!")).toHaveLength(1);
    s.destroy();
  });
});

describe("idle fidgets (Stage 7)", () => {
  const styles = Object.keys(FIDGET_KEYS) as Style[];
  it("every fighting style has three named fidgets, each from its stance and back to it", () => {
    expect(styles.sort()).toEqual(["blade", "fan", "fist", "heavy", "kamas", "lance", "mage", "sword", "twin", "whip"]);
    for (const st of styles) {
      expect(FIDGET_KEYS[st]).toHaveLength(3);
      expect(new Set(FIDGET_KEYS[st].map((f) => f.name)).size).toBe(3);
      const a = heroAnims(st);
      for (const f of FIDGETS) {
        expect(a[f].length).toBeGreaterThanOrEqual(4);
        expect(a[f][0]).toEqual(a[f].at(-1));                                   // starts and ends in the stance
      }
      expect(a.fidget1).not.toEqual(a.fidget2);
    }
  });
  it("every creature has two named fidgets of its own, from rest and back", () => {
    expect(Object.keys(BOSS_FIDGET_KEYS).sort()).toEqual(Object.keys(BOSSES).sort());
    const names = new Set<string>();
    for (const id of Object.keys(BOSSES)) {
      for (const f of BOSS_FIDGETS) {
        const frames = bossAnimFrames(id, f);
        expect(frames.length).toBeGreaterThanOrEqual(3);
        expect(frames[0]).toEqual(frames.at(-1));
      }
      BOSS_FIDGET_KEYS[id].forEach((f) => names.add(`${id}:${f.name}`));
    }
    expect(names.size).toBe(Object.keys(BOSSES).length * 2);
    expect(bossAnimFrames("hydra", "fidget1")).not.toEqual(bossAnimFrames("kraken", "fidget1"));
  });
});
