import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PixelBuffer } from "./buffer";
import { HEROES, heroAnims, heroById } from "./heroes";
import { itemIcon, kindOf } from "./icons";
import { PETS, PET_FRAME, PET_FRAMES, petById, petFrame } from "./pets";
import { ARMOR_SKINS, HEAD_SKINS, RARITY_GLOW, WEAPON_SKINS, dressed, hasSkin, loadoutKey, masteryOwner } from "./skins";
import { heroFrame, lookKey } from "./sprites";
import { hex } from "./color";

const shop = JSON.parse(readFileSync(resolve(__dirname, "../../../../backend/content/shop.json"), "utf8"));
const items: Array<{ id: string; type: string; price: number }> = shop.tiers.flatMap((t: { items: unknown[] }) => t.items);
const ofType = (t: string) => items.filter((i) => i.type === t).map((i) => i.id);
const filled = (b: PixelBuffer) => b.px.reduce((n, c) => n + (c ? 1 : 0), 0);
const differs = (a: PixelBuffer, b: PixelBuffer) => a.px.some((c, i) => c !== b.px[i]);

describe("every shop cosmetic is a champion skin", () => {
  it("armor, headgear and weapons each have a pixel recipe; pets have a sprite", () => {
    for (const id of ofType("armor")) expect(ARMOR_SKINS[id], id).toBeDefined();
    for (const id of ofType("headgear")) expect(HEAD_SKINS[id], id).toBeDefined();
    for (const id of ofType("weapon")) expect(WEAPON_SKINS[id], id).toBeDefined();
    for (const id of ofType("pet")) expect(PETS[id], id).toBeDefined();
    for (const id of [...ofType("potion"), ...ofType("title")]) expect(hasSkin(id), id).toBe(false);
  });
  it("has no recipe for an item the shop does not sell", () => {
    const ids = new Set(items.map((i) => i.id));
    for (const id of [...Object.keys(ARMOR_SKINS), ...Object.keys(HEAD_SKINS), ...Object.keys(WEAPON_SKINS), ...Object.keys(PETS)]) expect(ids.has(id), id).toBe(true);
  });
});

describe("dressed()", () => {
  const kaien = heroById("kaien");
  it("leaves the champion untouched with an empty or unknown loadout", () => {
    expect(dressed(kaien, {})).toBe(kaien);
    expect(dressed(kaien, { armor: "armor_nope", headgear: null, weapon: "" })).toBe(kaien);
  });
  it("re-colours the outfit, adds a head piece and re-finishes the weapon", () => {
    const d = dressed(kaien, { armor: "armor_gi_red", headgear: "hat_crown_gold", weapon: "weapon_sword_silver" });
    expect(d.look.coat).not.toEqual(kaien.look.coat);
    expect(d.look.headgear?.kind).toBe("crown");
    expect(d.look.weaponMat).not.toEqual(kaien.look.weaponMat);
    expect(d.look.weapon).toBe("katana");                 // a weapon skin never changes the weapon type
    expect(d.id).toBe("kaien");
  });
  it("draws a mastery skin only on its own champion", () => {
    const asha = heroById("asha");
    expect(dressed(asha, { armor: "mastery_asha_outfit" }).look.top).not.toEqual(asha.look.top);
    expect(dressed(heroById("kaien"), { armor: "mastery_asha_outfit" })).toBe(heroById("kaien"));
    expect(dressed(asha, { weapon: "mastery_asha_weapon" }).look.weaponGlow).toBeDefined();    // its own glow
  });
  it("never mutates the champion definitions", () => {
    const before = JSON.stringify(HEROES.map((h) => h.look));
    for (const h of HEROES) dressed(h, { armor: "armor_dragon_scale", headgear: "hat_samurai", weapon: "weapon_staff_legendary" }, { weapon: "legendary" });
    expect(JSON.stringify(HEROES.map((h) => h.look))).toBe(before);
  });
  it("lights the weapon in its rarity colour", () => {
    const d = dressed(kaien, { weapon: "weapon_sword_excalibur" }, { weapon: "legendary" });
    expect(d.look.weaponGlow?.ramp[2]).toBe(hex(RARITY_GLOW.legendary));
    expect(dressed(kaien, { weapon: "weapon_pencil" }, { weapon: "common" }).look.weaponGlow).toBeUndefined();
  });
  it("gives each loadout its own frame-cache key", () => {
    const a = dressed(kaien, { armor: "armor_gi_red" }), b = dressed(kaien, { armor: "armor_gi_blue" });
    expect(lookKey(a)).not.toBe(lookKey(b));
    expect(lookKey(a)).toBe(loadoutKey("kaien", { armor: "armor_gi_red" }));
    expect(differs(heroFrame(a, "idle", 0).buf, heroFrame(b, "idle", 0).buf)).toBe(true);
  });
  it("draws every head piece on every champion (the head looks different)", () => {
    for (const h of HEROES) {
      const base = heroFrame(h, "idle", 0).buf;
      for (const id of Object.keys(HEAD_SKINS)) {
        if (masteryOwner(id) && masteryOwner(id) !== h.id) continue;           // only its own champion wears it
        expect(differs(base, heroFrame(dressed(h, { headgear: id }), "idle", 0).buf), `${h.id} ${id}`).toBe(true);
      }
    }
  });
  it.each(HEROES.map((h) => [h.id] as const))("%s renders every animation in a full legendary loadout", (id) => {
    const d = dressed(heroById(id), { armor: "armor_legends_mantle", headgear: "hat_samurai", weapon: "weapon_staff_legendary" }, { weapon: "legendary" });
    for (const [anim, poses] of Object.entries(heroAnims(d.style))) {
      poses.forEach((_, i) => expect(filled(heroFrame(d, anim as never, i).buf), `${anim}#${i}`).toBeGreaterThan(400));
    }
  });
  it("renders every armor skin on every champion", () => {
    for (const h of HEROES) for (const id of Object.keys(ARMOR_SKINS)) expect(filled(heroFrame(dressed(h, { armor: id }), "idle", 0).buf), `${h.id} ${id}`).toBeGreaterThan(400);
  });
});

describe("pets", () => {
  it.each(Object.keys(PETS))("%s idles through every frame, inside its frame", (id) => {
    const frames = Array.from({ length: PET_FRAMES }, (_, i) => petFrame(id, i)!);
    for (const f of frames) {
      expect(filled(f)).toBeGreaterThan(60);
      const [x, y, w, h] = f.bounds();
      expect(x).toBeGreaterThan(0); expect(y).toBeGreaterThan(0);
      expect(x + w).toBeLessThan(PET_FRAME.w); expect(y + h).toBeLessThanOrEqual(PET_FRAME.h);
    }
    expect(frames.some((f) => differs(f, frames[0]))).toBe(true);     // it moves
  });
  it("fliers hover off the ground; walkers stand on it", () => {
    for (const p of Object.values(PETS)) {
      const [, y, , h] = petFrame(p.id, 0)!.bounds();
      if (p.flies) expect(y + h, p.id).toBeLessThan(PET_FRAME.anchor[1] - 6);
      else expect(y + h, p.id).toBeGreaterThanOrEqual(PET_FRAME.anchor[1] - 1);
    }
  });
  it("knows no pet for an empty or unknown id", () => {
    expect(petById(null)).toBeUndefined();
    expect(petById("pet_nope")).toBeUndefined();
    expect(petFrame("pet_nope", 0)).toBeNull();
  });
});

describe("item icons", () => {
  it("draws a square pixel icon for every item in the shop", () => {
    for (const { id } of items) {
      const icon = itemIcon(id, { rarity: "rare" });
      expect(icon, id).not.toBeNull();
      expect(icon!.w, id).toBe(icon!.h);
      expect(filled(icon!), id).toBeGreaterThan(30);
    }
  });
  it("shows each champion their own weapon for a weapon skin", () => {
    const k = itemIcon("weapon_sword_silver", { heroId: "kaien" })!, m = itemIcon("weapon_sword_silver", { heroId: "mira" })!;
    expect(k.w !== m.w || differs(k, m)).toBe(true);
  });
  it("sorts ids into slots, and has nothing for unknown ids", () => {
    expect(kindOf("hat_wizard")).toBe("headgear");
    expect(kindOf("fifty_fifty")).toBe("potion");
    expect(kindOf("title_legend")).toBe("title");
    expect(kindOf("mystery")).toBe("none");
    expect(kindOf("mastery_vex_head")).toBe("headgear");
    expect(kindOf("mastery_thorne_weapon")).toBe("weapon");
    expect(itemIcon("mystery")).toBeNull();
  });
});
