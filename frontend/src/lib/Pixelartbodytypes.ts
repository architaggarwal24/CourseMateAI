/**
 * pixelArtBodyTypes.ts
 * Body-type–specific armor factories for 4 avatar builds:
 *   male_default   → SKINNY   (narrow torso, slim legs)
 *   male_athletic  → MUSCULAR (huge shoulders, thick legs)
 *   female_elegant → HOURGLASS (bust/waist/hip ratio exaggerated)
 *   female_sporty  → SLIM ATHLETIC (even, toned proportions)
 *
 * Each body type has its own shirt / hoodie factory.
 * Other armors fall back to the global ARMOR_FACTORIES.
 */
import { armorSprite, type SkinTone, type Sprite, type ArmorFactory } from "@/lib/pixelArt";

// ─── Shared palettes ─────────────────────────────────────────────────────────
const SP = { W:"#E8EEF8", w:"#C4CAD8", b:"#3A2800", B:"#604400",
             J:"#2A4A8C", j:"#4A72B8", N:"#F0F0FF", n:"#9090BB" };
const HP = { H:"#777788", h:"#888888", G:"#777788", g:"#555566", Z:"#222233",
             P:"#888899", p:"#666677", C:"#CCCCDD", c:"#9999AA",
             D:"#222233", d:"#334455", W:"#DDDDEE", w:"#AABBCC" };

// ─────────────────────────────────────────────────────────────────────────────
// SKINNY MALE  (narrow 6-px shirt body, slim legs)
// ─────────────────────────────────────────────────────────────────────────────
function buildSkinnyShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 collar   */ "_______WWwWWW_______",   // 6-px collar
    /* 15 shoulder */ "SSSSSSSWwWwWSSSSSSSS",   // shirt only 5 px, skin fills rest
    /* 16          */ "SSSSSSSWwWwWSSSSSSSS",
    /* 17          */ "SSSSSSSWwWwWSSSSSSSS",
    /* 18 torso    */ "_______WWwWW________",   // 5-px torso
    /* 19          */ "_______WwWWW________",
    /* 20          */ "_______WWwWW________",
    /* 21 hem      */ "_______wWWWw________",
    /* 22 belt     */ "_______bBBBb________",   // narrow belt
    /* 23 legs     */ "______JJJjJJJJ______",   // waistband
    /* 24          */ "______JJj__JJj______",   // slim leg split
    /* 25          */ "______JjJ__JjJJ_____",
    /* 26          */ "______JJj__JJj______",
    /* 27          */ "______JjJ__JjJJ_____",
    /* 28          */ "______JJj__JJj______",
    /* 29          */ "______JjJ__JjJJ_____",
    /* 30          */ "______JJj__JJj______",
    /* 31          */ "______JjJ__JjJJ_____",
    /* 32          */ "______JJj__JJj______",
    /* 33          */ "______JjJ__JjJJ_____",
    /* 34 ankle    */ "______ssss_ssss_____",
    /* 35 sneaker  */ "_____NNNNn_NNNNn____",
    /* 36          */ "_____NnNNNN_NnNNNN__",
    /* 37 sole     */ "_____nNNNNNN_nNNNN__",
  ], SP, skin);
}

function buildSkinnyHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "______HHHHHHHHH_____",
    /* 15 */ "SSSSSShHHhHHhHHSSSSS",   // narrow hood, skin wide
    /* 16 */ "SSSSSshHGGGGGhHSSSSS_",
    /* 17 */ "SSSSSShGGZZGGhHSSSSS_",
    /* 18 */ "SSSSSShGGGGGGhHSSSSS_",
    /* 19 */ "______hGGPPPGhH_____",
    /* 20 */ "______hGPpppPGh_____",
    /* 21 */ "______hGGPPPGhH_____",
    /* 22 */ "______CCcCCCcCC_____",
    /* 23 */ "______DDDDDDDD______",
    /* 24 */ "______DDd__DDd______",
    /* 25 */ "______DdD__DdDD_____",
    /* 26 */ "______DDd__DDd______",
    /* 27 */ "______DdD__DdDD_____",
    /* 28 */ "______DDd__DDd______",
    /* 29 */ "______DdD__DdDD_____",
    /* 30 */ "______DDd__DDd______",
    /* 31 */ "______DdD__DdDD_____",
    /* 32 */ "______DDd__DDd______",
    /* 33 */ "______DdD__DdDD_____",
    /* 34 */ "______WWWW_WWWW_____",
    /* 35 */ "_____WWWwwW_WWWwwW__",
    /* 36 */ "_____WWWwWW_WWWwWW__",
    /* 37 */ "_____WWWWWW_WWWWWW__",
  ], HP, skin);
}

// ─────────────────────────────────────────────────────────────────────────────
// MUSCULAR MALE  (max-width shoulders, thick chest, big legs)
// ─────────────────────────────────────────────────────────────────────────────
function buildMuscularShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 collar   */ "___SWWWWwWWWWwWWWS__",  // 12-px collar
    /* 15 shoulder */ "WWWWWWWWWwWWWWWWWWWW",  // FULL 20-px shoulders!
    /* 16          */ "WWWWWWWWWwWWWWWWWWWW",  // still full — HUGE
    /* 17          */ "WWWWwWWWWwWWWWwWWWWW",  // chest (slight highlight)
    /* 18 torso    */ "__WWWWWwWWwWWWWWWW___",  // 14-px torso (tapers slightly)
    /* 19          */ "__WWWwWWWWWWwWWWWW___",
    /* 20          */ "__WWWWWWWWWWWWwWWW___",
    /* 21 hem      */ "__wWWWWWWWWWWWWwWW___",
    /* 22 belt     */ "__bBBBBBBBBBBBBBb____",  // wide belt
    /* 23 hips     */ "__JJJJJJjJJJJJJJJJ__",  // 16-px waistband
    /* 24 legs     */ "__JJJJJj___JJJJJj___",  // thick split thighs
    /* 25          */ "__JjJJJJ___JJJJjJJ__",
    /* 26          */ "__JJJJJj___JJJJJj___",
    /* 27          */ "__JjJJJJ___JJJJjJJ__",
    /* 28          */ "__JJJJJj___JJJJJj___",
    /* 29          */ "__JjJJJJ___JJJJjJJ__",
    /* 30          */ "__JJJJJj___JJJJJj___",
    /* 31          */ "__JjJJJJ___JJJJjJJ__",
    /* 32          */ "__JJJJJj___JJJJJj___",
    /* 33          */ "__JjJJJJ___JJJJjJJ__",
    /* 34 ankle    */ "__SSSSSs___SSSSSs____",  // thick ankles
    /* 35 boot     */ "_NNNNNNNn__NNNNNNNn_",  // big shoes
    /* 36          */ "_NnNNNNNN__NnNNNNNN_",
    /* 37 sole     */ "_nNNNNNNNN_nNNNNNNNN",  // very wide sole
  ], SP, skin);
}

function buildMuscularHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "___HHHHHHHHHHHHHH___",
    /* 15 */ "HHHHHHHHHHHHHHHHHHHH",  // FULL shoulder coverage
    /* 16 */ "HHHHhGGGGGGGGGGhHHHH",
    /* 17 */ "HHHHhGGZZGGGGZZGhHHH",
    /* 18 */ "HHHHHGGZZGGGGZZGhHHH",
    /* 19 */ "HHHHHGGGGGGGGGGGhHHH",
    /* 20 */ "__HHHGGPPPPPPPGGhHH_",
    /* 21 */ "__HHHGGPpppppPGGhHH_",
    /* 22 */ "__HHHGGPPPPPPPGGhHH_",
    /* 23 */ "CCCCCCCCCCCCCCCCCcCC",
    /* 24 */ "__DDDDDDDDDDDDDDDD__",
    /* 25 */ "__DDDDDd___DDDDDd___",
    /* 26 */ "__DdDDDD___DDDDdD___",
    /* 27 */ "__DDDDDd___DDDDDd___",
    /* 28 */ "__DdDDDD___DDDDdD___",
    /* 29 */ "__DDDDDd___DDDDDd___",
    /* 30 */ "__DdDDDD___DDDDdD___",
    /* 31 */ "__DDDDDd___DDDDDd___",
    /* 32 */ "__DdDDDD___DDDDdD___",
    /* 33 */ "__DDDDDd___DDDDDd___",
    /* 34 */ "__WWWWWW___WWWWWW___",
    /* 35 */ "_WWWWwwWW__WWWwwWW__",
    /* 36 */ "_WWWwWWWW__WWWwWWWW_",
    /* 37 */ "_WWWWWWWWW_WWWWWWWWW",
  ], HP, skin);
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEGANT FEMALE  (hourglass: shoulders→bust→VERY NARROW waist→wide hips)
// ─────────────────────────────────────────────────────────────────────────────
function buildElegantShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 collar   */ "_____SWWwWWWwWS_____",   // 10-px collar
    /* 15 shoulder */ "SSSSsWWWwWWWwWSSSss_",   // 10-px shirt shoulder
    /* 16          */ "SSSSsWwWWWWWwWSSsss_",
    /* 17          */ "SSSSsWWWWWWWwWSSsss_",
    /* 18 bust     */ "_____WwWWWWWwWW_____",   // 10-px bust
    /* 19          */ "_____WWWWWWwWWW_____",
    /* 20 WAIST    */ "_______WwWWwW_______",   // 6-px (VERY NARROW)
    /* 21          */ "_______WwWWwW_______",   // still narrow
    /* 22 belt     */ "_______bBBBb________",   // narrow belt accentuates waist
    /* 23 HIP FLARE*/ "___JJJJJJjJJJJJJJJ__",  // 14-px wide hips (hourglass!)
    /* 24          */ "___JJJJj___JJJJj____",   // hip split into legs
    /* 25          */ "___JjJJJ___JJJjJ____",
    /* 26          */ "___JJJJj___JJJJj____",
    /* 27          */ "___JjJJJ___JJJjJ____",
    /* 28          */ "____JJJj___JJJj_____",   // hips taper back
    /* 29          */ "____JjJJ___JJjJJ____",
    /* 30          */ "____JJJj___JJJj_____",
    /* 31          */ "____JjJJ___JJjJJ____",
    /* 32          */ "____JJJj___JJJj_____",
    /* 33          */ "____JjJJ___JJjJJ____",
    /* 34 ankle    */ "_____ssss__ssss_____",
    /* 35 heel     */ "____NNNNNn_NNNNNn___",
    /* 36          */ "____NnNNNN_NnNNNN___",
    /* 37          */ "____nNNNNNN_nNNNNN__",
  ], SP, skin);
}

function buildElegantHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____HHHHHHHHHHH_____",
    /* 15 */ "SSSssHHHhHHhHHSSSss_",
    /* 16 */ "SSSsshHGGGGGGhHSSss_",
    /* 17 */ "SSSsshGGZZGGGhHSSss_",
    /* 18 */ "_____hGGGGGGGhH_____",
    /* 19 */ "_____hGGPPPGGhH_____",
    /* 20 */ "_______GGPpPGG______",   // NARROW waist
    /* 21 */ "_______GGPpPGG______",
    /* 22 */ "_______CCcCCCC______",   // narrow cuff band
    /* 23 */ "___DDDDDDDDDDDDDDD__",   // HIP flare
    /* 24 */ "___DDDDd___DDDDd____",
    /* 25 */ "___DdDDD___DDDdD____",
    /* 26 */ "___DDDDd___DDDDd____",
    /* 27 */ "___DdDDD___DDDdD____",
    /* 28 */ "____DDDd___DDDd_____",
    /* 29 */ "____DdDD___DDdD_____",
    /* 30 */ "____DDDd___DDDd_____",
    /* 31 */ "____DdDD___DDdD_____",
    /* 32 */ "____DDDd___DDDd_____",
    /* 33 */ "____DdDD___DDdD_____",
    /* 34 */ "_____WWWW__WWWW_____",
    /* 35 */ "____WWWwwW_WWWwwW___",
    /* 36 */ "____WWWwWW_WWWwWW___",
    /* 37 */ "____WWWWWW_WWWWWW___",
  ], HP, skin);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPORTY FEMALE  (slim + athletic: moderate shoulders, slight waist taper,
//                proportional hips — trim and toned look)
// ─────────────────────────────────────────────────────────────────────────────
function buildSportyShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 collar   */ "_____SWWwWWWwWS_____",
    /* 15 shoulder */ "SSSssWWWwWWWwWSSSSs_",
    /* 16          */ "SSSssWwWWWWWwWSSSSs_",
    /* 17          */ "SSSssWWWWWWWwWSSSSs_",
    /* 18 chest    */ "______WwWWWWwW______",  // 8-px chest
    /* 19          */ "______WWWWWwWW______",
    /* 20 waist    */ "______WWwWWwWW______",  // 8-px, slight indent
    /* 21          */ "______wWWWWWwW______",
    /* 22 belt     */ "______bBBBBBb_______",  // 7-px belt
    /* 23 hips     */ "_____JJJJjJJJJJJ____",  // 10-px hips (barely wider)
    /* 24          */ "_____JJJj__JJJj_____",
    /* 25          */ "_____JjJJJ_JJJjJ____",
    /* 26          */ "_____JJJj__JJJj_____",
    /* 27          */ "_____JjJJJ_JJJjJ____",
    /* 28          */ "_____JJJj__JJJj_____",
    /* 29          */ "_____JjJJJ_JJJjJ____",
    /* 30          */ "_____JJJj__JJJj_____",
    /* 31          */ "_____JjJJJ_JJJjJ____",
    /* 32          */ "_____JJJj__JJJj_____",
    /* 33          */ "_____JjJJJ_JJJjJ____",
    /* 34 ankle    */ "_____ssss__ssss_____",
    /* 35 sneaker  */ "____NNNNNn_NNNNNn___",
    /* 36          */ "____NnNNNN_NnNNNN___",
    /* 37          */ "____nNNNNNN_nNNNNN__",
  ], SP, skin);
}

function buildSportyHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____HHHHHHHHHHHH____",
    /* 15 */ "SSSsssHHhHHhHHSSSSs_",
    /* 16 */ "SSSssshHGGGGhHSSSSs_",
    /* 17 */ "SSSssshGGZZGhHSSSSs_",
    /* 18 */ "______hGGGGGhH______",
    /* 19 */ "______hGGPPGhH______",
    /* 20 */ "______hGGPpGhH______",
    /* 21 */ "______hGGPPGhH______",
    /* 22 */ "______CccCCCCc______",
    /* 23 */ "_____DDDDDDDDDDD____",
    /* 24 */ "_____DDDd__DDDd_____",
    /* 25 */ "_____DdDD__DDdD_____",
    /* 26 */ "_____DDDd__DDDd_____",
    /* 27 */ "_____DdDD__DDdD_____",
    /* 28 */ "_____DDDd__DDDd_____",
    /* 29 */ "_____DdDD__DDdD_____",
    /* 30 */ "_____DDDd__DDDd_____",
    /* 31 */ "_____DdDD__DDdD_____",
    /* 32 */ "_____DDDd__DDDd_____",
    /* 33 */ "_____DdDD__DDdD_____",
    /* 34 */ "_____WWWW__WWWW_____",
    /* 35 */ "____WWWwwW_WWWwwW___",
    /* 36 */ "____WWWwWW_WWWwWW___",
    /* 37 */ "____WWWWWW_WWWWWW___",
  ], HP, skin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry + resolver
// ─────────────────────────────────────────────────────────────────────────────
const BODY_TYPE_FACTORIES: Record<string, Record<string, ArmorFactory>> = {
  male_default: {
    armor_shirt_basic:  buildSkinnyShirt,
    armor_hoodie_gray:  buildSkinnyHoodie,
  },
  male_athletic: {
    armor_shirt_basic:  buildMuscularShirt,
    armor_hoodie_gray:  buildMuscularHoodie,
  },
  female_elegant: {
    armor_shirt_basic:  buildElegantShirt,
    armor_hoodie_gray:  buildElegantHoodie,
  },
  female_sporty: {
    armor_shirt_basic:  buildSportyShirt,
    armor_hoodie_gray:  buildSportyHoodie,
  },
};

/**
 * Returns a body-type–specific ArmorFactory if one is defined,
 * otherwise returns null (caller should fall back to default ARMOR_FACTORIES).
 */
export function getBodyTypedArmorFactory(
  armorId: string,
  bodyTypeId: string,
): ArmorFactory | null {
  return BODY_TYPE_FACTORIES[bodyTypeId]?.[armorId] ?? null;
}