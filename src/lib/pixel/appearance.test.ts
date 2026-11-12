// @vitest-environment node
import { describe, expect, it } from "vitest";
import { OUTFITS, HAIR_STYLES, STARTER_LOOKS, type Appearance } from "../game/appearance";
import { withAppearance } from "./appearance";
import { HEROES, heroAnims, heroById } from "./heroes";
import { ARMOR_SKINS, dressed } from "./skins";
import { heroFrame } from "./sprites";

const filled = (px: Uint32Array) => px.reduce((n, v) => n + (v ? 1 : 0), 0);

describe("built looks on the rig", () => {
  it("any outfit and hair on any champion draws in every animation, and keeps the champion's weapon", () => {
    for (const hero of HEROES) {
      for (const [i, outfit] of OUTFITS.entries()) {
        const a: Appearance = { ...STARTER_LOOKS.kaien, outfit, hair: HAIR_STYLES[i % HAIR_STYLES.length], cape: i % 2 ? "royal" : "none", gloves: i % 3 ? "none" : "black" };
        const h = withAppearance(hero, a);
        expect(h.look.weapon).toBe(hero.look.weapon);
        expect(h.style).toBe(hero.style);
        for (const [anim, poses] of Object.entries(heroAnims(h.style))) {
          for (let f = 0; f < poses.length; f += 3) expect(filled(heroFrame(h, anim as never, f).buf.px), `${hero.id} ${outfit} ${anim}#${f}`).toBeGreaterThan(400);
        }
      }
    }
  });

  it("the same look is the same figure (cached), a different look a different one", () => {
    const k = heroById("kaien");
    expect(withAppearance(k, STARTER_LOOKS.mira)).toBe(withAppearance(k, { ...STARTER_LOOKS.mira }));
    expect(withAppearance(k, STARTER_LOOKS.mira).skinKey).not.toBe(withAppearance(k, STARTER_LOOKS.brak).skinKey);
    expect(withAppearance(k, null)).toBe(k);
    const a = heroFrame(withAppearance(k, STARTER_LOOKS.mira), "idle", 0).buf.px;
    const b = heroFrame(withAppearance(k, { ...STARTER_LOOKS.mira, main: "red" }), "idle", 0).buf.px;
    expect(a).not.toEqual(b);
  });

  it("an outfit skin from the shop dresses a built look by what it wears, and the loadout keeps the look in its key", () => {
    const built = withAppearance(heroById("thorne"), { ...STARTER_LOOKS.mira });
    for (const skin of Object.keys(ARMOR_SKINS)) {
      const d = dressed(built, { armor: skin });
      expect(d.skinKey).toContain(built.skinKey!);
      expect(d.look.topStyle).toBe("robe");
      expect(filled(heroFrame(d, "attack", 4).buf.px)).toBeGreaterThan(400);
    }
  });
});
