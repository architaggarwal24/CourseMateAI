// Pixel-level snapshot of everything that draws a hero: the full figure (shop, inventory, avatar tab, HUD header),
// the face (profile menu), item icons (cards, slots, forge options) and the forge's live preview. Each canvas is
// rasterised by test/softCanvas.ts and reduced to size + opaque-pixel count + a hash of every RGBA byte, so a
// refactor that moves one pixel fails. The id lists are written out here (not read from the sprite data) so
// deleting or renaming a sprite also fails.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { fingerprint, installSoftCanvas } from "@/test/softCanvas";
import AvatarDisplay from "./AvatarDisplay";
import AvatarFace from "./AvatarFace";
import PixelSprite from "./PixelSprite";
import PixelAvatarBuilder, { DEFAULT_CONFIG, type AvatarConfig } from "./PixelAvatar";

let restore = () => {};
beforeAll(() => { restore = installSoftCanvas(); });
afterAll(() => restore());

const BODIES = ["male_default", "male_athletic", "female_elegant", "female_sporty"];
const SKINS = ["ivory", "tan", "brown", "deep"];
const HAIRS = ["black", "auburn", "honey", "flaxen", "silver", "cobalt", "violet", "scarlet"];
const EYES = ["blue", "green", "brown", "hazel", "grey", "violet", "amber", "crimson"];
const LIPS = ["natural", "rosy", "bold_red", "plum", "coral", "nude", "berry", "gloss"];
const ARMOR = ["armor_bare_basic", "armor_shirt_basic", "armor_hoodie_gray", "armor_robe_blue", "armor_jacket_cool", "armor_knight_silver", "armor_knight_gold", "armor_wizard_purple", "armor_dragon_scale", "armor_legends_mantle", "armor_gi_white", "armor_gi_red", "armor_gi_blue"];
const HEAD = ["hat_baseball_red", "hat_beanie_blue", "hat_wizard", "hat_crown_bronze", "hat_crown_silver", "hat_crown_gold", "hat_headphones", "hat_ninja", "hat_samurai", "hat_headband_red", "hat_headband_blue", "hat_headband_white"];
const WEAPON = ["weapon_pencil", "weapon_ruler", "weapon_sword_bronze", "weapon_sword_silver", "weapon_sword_excalibur", "weapon_staff_wood", "weapon_staff_crystal", "weapon_staff_legendary", "weapon_bow", "weapon_hammer"];
const SMALL_PET = ["pet_cat_orange", "pet_dog_brown", "pet_owl", "pet_panda", "pet_fox"];
const MOUNT = ["pet_dragon_baby", "pet_phoenix", "pet_unicorn", "pet_dragon_ancient", "pet_lion_golden"];
const ICONS = [
  ...HEAD, ...ARMOR, ...WEAPON, ...SMALL_PET, ...MOUNT,
  "potion_health_small", "fifty_fifty", "potion_xp_boost", "potion_coin_boost", "item_quest_scroll", "item_lucky_coin",
  "item_time_gem", "title_scholar", "title_quiz_master", "title_dragon_slayer", "potion_streak_shield", "potion_xp_boost_2h",
  "potion_quest_reset", "hint_scroll", "title_arena_champ", "title_the_eternal", "title_legend",
];
const SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

const canvasOf = (container: HTMLElement, selector = "canvas") => container.querySelector(selector) as HTMLCanvasElement;
function figure(equipped: Record<string, string>, size: (typeof SIZES)[number] = "md", extra: Record<string, string> = {}) {
  const { container } = render(<AvatarDisplay equipped={equipped} size={size} {...extra} />);
  const out = fingerprint(canvasOf(container));
  cleanup();
  return out;
}
const collect = (entries: [string, () => string][]) => Object.fromEntries(entries.map(([k, f]) => [k, f()]));

describe("hero figure (shop preview, inventory, avatar tab, header)", () => {
  it("every outfit on every body type", () => {
    expect(collect(BODIES.flatMap((b) => ARMOR.map((a): [string, () => string] => [`${b}/${a}`, () => figure({ body_type_id: b, armor: a })])))).toMatchSnapshot();
  });
  it("every headgear, weapon and pet (the full-effects size)", () => {
    expect(collect([
      ...HEAD.map((h): [string, () => string] => [h, () => figure({ headgear: h }, "lg")]),
      ...WEAPON.map((w): [string, () => string] => [w, () => figure({ weapon: w, armor: "armor_shirt_basic" }, "lg")]),
      ...[...SMALL_PET, ...MOUNT].map((p): [string, () => string] => [p, () => figure({ pet: p }, "lg")]),
    ])).toMatchSnapshot();
  });
  it("every skin x hair, and every eye and lip colour", () => {
    expect(collect([
      ...SKINS.flatMap((s) => HAIRS.map((h): [string, () => string] => [`${s}/${h}`, () => figure({ skin_id: s, hair_id: h }, "sm")])),
      ...EYES.map((e): [string, () => string] => [`eye:${e}`, () => figure({ eye_color_id: e }, "xl")]),
      ...LIPS.map((l): [string, () => string] => [`lip:${l}`, () => figure({ lip_color_id: l, body_type_id: "female_elegant" }, "xl")]),
    ])).toMatchSnapshot();
  });
  it("skin and hair passed as props win over the equipped ones", () => {
    expect({
      props: figure({ skin_id: "ivory", hair_id: "black" }, "md", { skinId: "deep", hairId: "violet" }),
      equipped: figure({ skin_id: "deep", hair_id: "violet" }, "md"),
    }).toMatchSnapshot();
  });
  it("mixed loadouts at every size (guard stance, dual wield, mounted, female, unknown ids)", () => {
    const loadouts: Record<string, Record<string, string>> = {
      gi: { armor: "armor_gi_red", body_type_id: "male_athletic" },
      dual: { armor: "armor_knight_gold", headgear: "hat_crown_gold", weapon: "weapon_sword_excalibur", body_type_id: "male_default" },
      mounted: { armor: "armor_dragon_scale", headgear: "hat_samurai", weapon: "weapon_staff_legendary", pet: "pet_phoenix", body_type_id: "female_sporty" },
      small: { armor: "armor_robe_blue", headgear: "hat_wizard", weapon: "weapon_bow", pet: "pet_fox", body_type_id: "female_elegant", skin_id: "tan", hair_id: "cobalt", eye_color_id: "amber", lip_color_id: "plum" },
      outfit_id: { outfit_id: "armor_jacket_cool" },
      unknown: { armor: "armor_nope", headgear: "hat_nope", weapon: "weapon_nope", pet: "pet_nope", body_type_id: "nope", skin_id: "nope", hair_id: "nope" },
      empty: {},
    };
    expect(collect(Object.entries(loadouts).flatMap(([name, eq]) => SIZES.map((s): [string, () => string] => [`${name}@${s}`, () => figure(eq, s)])))).toMatchSnapshot();
  });
});

describe("face (profile menu)", () => {
  const face = (equipped: Record<string, string>, diameter: number, extra: Record<string, string> = {}) => {
    const { container } = render(<AvatarFace equipped={equipped} items={[]} diameter={diameter} {...extra} />);
    const out = fingerprint(canvasOf(container));
    cleanup();
    return out;
  };
  it("every outfit and headgear at the two menu sizes", () => {
    expect(collect([
      ...ARMOR.flatMap((a) => [40, 48].map((d): [string, () => string] => [`${a}@${d}`, () => face({ armor: a }, d)])),
      ...HEAD.map((h): [string, () => string] => [h, () => face({ headgear: h }, 48)]),
      ...[24, 33, 64].map((d): [string, () => string] => [`size ${d}`, () => face({ armor: "armor_knight_gold", headgear: "hat_crown_gold" }, d)]),
    ])).toMatchSnapshot();
  });
  it("every skin x hair", () => {
    expect(collect(SKINS.flatMap((s) => HAIRS.map((h): [string, () => string] => [`${s}/${h}`, () => face({ armor: "armor_shirt_basic" }, 48, { skinId: s, hairId: h })])))).toMatchSnapshot();
  });
});

describe("item icons (cards, slots, forge options)", () => {
  it("every icon at the smallest and the card size, and the placeholder for an unknown id", () => {
    const icon = (id: string, size: "xs" | "sm" | "md" | "lg") => {
      const { container } = render(<PixelSprite itemId={id} size={size} />);
      const out = fingerprint(canvasOf(container));
      cleanup();
      return out;
    };
    expect(collect([
      ...ICONS.flatMap((id) => (["xs", "md"] as const).map((s): [string, () => string] => [`${id}@${s}`, () => icon(id, s)])),
      ["unknown@md", () => icon("item_nope", "md")],
      ["sm", () => icon("weapon_bow", "sm")],
      ["lg", () => icon("weapon_bow", "lg")],
    ])).toMatchSnapshot();
  });
});

describe("hero forge live preview", () => {
  const forge = (over: Partial<AvatarConfig>) => {
    const { container } = render(<PixelAvatarBuilder config={{ ...DEFAULT_CONFIG, ...over }} onConfigChange={() => {}} />);
    const out = fingerprint(canvasOf(container, 'canvas[width="384"]'));
    cleanup();
    return out;
  };
  it("every body type with its outfits, and the other slots", () => {
    expect(collect([
      ...BODIES.flatMap((b) => ARMOR.map((a): [string, () => string] => [`${b}/${a}`, () => forge({ bodyTypeId: b, armorId: a })])),
      ...HEAD.map((h): [string, () => string] => [h, () => forge({ headId: h })]),
      ...WEAPON.map((w): [string, () => string] => [w, () => forge({ weaponId: w })]),
      ...[...SMALL_PET, ...MOUNT].map((p): [string, () => string] => [p, () => forge({ petId: p })]),
      ...SKINS.flatMap((s) => ["black", "scarlet"].map((h): [string, () => string] => [`${s}/${h}`, () => forge({ skinId: s, hairId: h })])),
      ...EYES.map((e): [string, () => string] => [`eye:${e}`, () => forge({ eyeColorId: e, bodyTypeId: "female_sporty" })]),
      ...LIPS.map((l): [string, () => string] => [`lip:${l}`, () => forge({ lipColorId: l })]),
      ["mixed", () => forge({ bodyTypeId: "female_elegant", armorId: "armor_gi_blue", headId: "hat_ninja", weaponId: "weapon_sword_silver", petId: "pet_unicorn", skinId: "brown", hairId: "violet" })],
    ])).toMatchSnapshot();
  });
});
