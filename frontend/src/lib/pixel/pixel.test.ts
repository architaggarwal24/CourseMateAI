import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PixelBuffer } from "./buffer";
import { hex, ramp, unpack } from "./color";
import { BOSSES, BOSS_ANIMS, bossById } from "./bosses";
import { HEROES, heroAnims, heroById, geared } from "./heroes";
import { bossFrame, heroFrame } from "./sprites";
import { STAGES, stageBackdrop, STAGE_W, STAGE_H } from "./stages";

const filled = (b: PixelBuffer) => b.px.reduce((n, c) => n + (c ? 1 : 0), 0);

describe("rasteriser", () => {
  it("shades a sphere lighter at the upper-left than the lower-right", () => {
    const b = new PixelBuffer(40, 40);
    b.ellipse(20, 20, 14, 14, ramp("#3366cc"));
    const lum = (x: number, y: number) => { const [r, g, bl] = unpack(b.get(x, y)); return r + g + bl; };
    expect(lum(13, 13)).toBeGreaterThan(lum(27, 27));
  });
  it("outlines the silhouette with the material's darkest step", () => {
    const b = new PixelBuffer(20, 20), m = ramp("#cc3333");
    b.ellipse(10, 10, 5, 5, m);
    b.outline(hex("#000000"));
    expect(b.get(10, 4)).toBe(m.ramp[0]);
    expect(b.get(0, 0)).toBe(0);
  });
  it("ramps run dark to light, and the shadow is hue-shifted, not just darkened", () => {
    const m = ramp("#4ade80");
    const lum = (c: number) => { const [r, g, b] = unpack(c); return r + g + b; };
    for (let i = 1; i < 5; i++) expect(lum(m.ramp[i])).toBeGreaterThan(lum(m.ramp[i - 1]));
    const hue = (c: number) => {
      const [r, g, b] = unpack(c).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      const h = mx === r ? (g - b) / d : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    expect(hue(m.ramp[1])).toBeGreaterThan(hue(m.ramp[2]) + 2);   // a green's shadow drifts toward blue
  });
});

describe("heroes", () => {
  it.each(HEROES.map((h) => [h.id, h] as const))("%s renders every frame of every animation", (_, hero) => {
    for (const [anim, poses] of Object.entries(heroAnims(hero.style))) {
      poses.forEach((_, i) => expect(filled(heroFrame(hero, anim as never, i).buf), `${anim}#${i}`).toBeGreaterThan(400));
    }
  });
  it("falls back to the first hero for an unknown id, and gear changes the look", () => {
    expect(heroById("nope").id).toBe(HEROES[0].id);
    const g = geared(HEROES[0], { weaponRarity: "legendary" });
    expect(g.look.weaponGlow).toBeDefined();
    expect(g.look).not.toBe(HEROES[0].look);
  });
});

describe("bestiary", () => {
  it.each(Object.keys(BOSSES))("%s renders every frame, bigger than a hero", (id) => {
    const heroSize = filled(heroFrame(HEROES[0], "idle", 0).buf);
    for (const [anim, list] of Object.entries(BOSS_ANIMS)) {
      list.forEach((_, i) => expect(filled(bossFrame(BOSSES[id], anim as never, i).buf), `${anim}#${i}`).toBeGreaterThan(heroSize * 1.5));
    }
  });
  it("has a sprite for every creature the backend can summon (core_brains/bestiary.py)", () => {
    const py = readFileSync(resolve(__dirname, "../../../../backend/core_brains/bestiary.py"), "utf8");
    const ids = [...py.matchAll(/^ {4}"([a-z]+)": \{$/gm)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThanOrEqual(13);
    for (const id of ids) expect(BOSSES[id], id).toBeDefined();
    expect(bossById("unknown").id).toBe("hydra");
  });
  it("every boss fights on a stage that exists, and every stage paints the whole frame", () => {
    for (const b of Object.values(BOSSES)) expect(STAGES[b.stage], b.id).toBeDefined();
    for (const id of Object.keys(STAGES)) expect(filled(stageBackdrop(id))).toBe(STAGE_W * STAGE_H);
  });
});
