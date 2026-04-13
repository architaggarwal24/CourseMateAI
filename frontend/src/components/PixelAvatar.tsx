"use client";
/**
 * PixelAvatar.tsx — Bitmoji-style Hero Forge Builder
 * 4 visually distinct body types, each with unique arm width + torso shape:
 *   male_default   → SKINNY  (2-px slim arms, narrow 6-px torso)
 *   male_athletic  → MUSCULAR (4-px bulging arms, 20-px shoulder-to-shoulder)
 *   female_elegant → HOURGLASS (bust→pinched waist→flared hips)
 *   female_sporty  → SLIM ATHLETIC (lean, even proportions)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  buildHead, buildFemaleHead, buildArmDown, buildArmUp,
  buildArmDownSkinny, buildArmUpSkinny,
  buildArmDownMuscular, buildArmUpMuscular,
  ARM_X,
  blit, mirrorX, spr,
  ARMOR_FACTORIES, FEMALE_ARMOR_FACTORIES,
  HEADGEAR_SPRITES, WEAPON_SPRITES,
  SMALL_PET_SPRITES, MOUNT_PET_SPRITES, PET_MOUNTS, DUAL_WIELD_WEAPONS,
  SKIN_TONES as LIB_SKIN_TONES,
  HAIR_COLORS as LIB_HAIR_COLORS,
  EYE_COLORS as LIB_EYE_COLORS,
  LIP_COLORS as LIB_LIP_COLORS,
  AVATAR,
  type Sprite,
  type SkinTone, type HairColor, type EyeColor, type LipColor,
} from "@/lib/pixelArt";
import PixelSprite from "@/components/PixelSprite";
export const SKIN_TONES  = LIB_SKIN_TONES;
export const HAIR_COLORS = LIB_HAIR_COLORS;

// ── Inlined body-type armor factories ────────────────────────────────────────
// (avoids external pixelArtBodyTypes.ts dependency)

const SP = { W:"#E8EEF8", w:"#C4CAD8", b:"#3A2800", B:"#604400",
             J:"#2A4A8C", j:"#4A72B8", N:"#F0F0FF", n:"#9090BB" };
const HP = { H:"#777788", h:"#888888", G:"#777788", g:"#555566", Z:"#222233",
             P:"#888899", p:"#666677", C:"#CCCCDD", c:"#9999AA",
             D:"#222233", d:"#334455", W:"#DDDDEE", w:"#AABBCC" };

function _armorSprite(rows: string[], p: Record<string,string>, skin: SkinTone): Sprite {
  const augP = { ...p, S: skin.b, s: skin.m };
  const full: Sprite = Array.from({length:48}, ()=>Array(20).fill(null));
  const compiled = spr(rows.map(r=>r.padEnd(20,"_").slice(0,20)), augP);
  compiled.forEach((row,i) => { if(i < 34) full[14+i] = row; });
  return full;
}

// ─── BODY-TYPE ARMOR SPRITES ─────────────────────────────────────────────────
// Each body type is drawn with genuinely different pixel proportions.
// SP / HP are shirt+jeans and hoodie palettes respectively.

// ── SKINNY MALE ──────────────────────────────────────────────────────────────
// Narrow 8px torso, very slim arms, legs close together
const buildSkinnyShirt = (skin: SkinTone): Sprite => _armorSprite([
  /*14 collar  */ "_______WWwWWW_______",  // 6px collar — very narrow
  /*15 shoulder*/ "SSSSSSSWwWwWSSSSSSSS",  // 6px shirt, wide arm skin
  /*16         */ "SSSSSSSWwWwWSSSSSSSS",
  /*17         */ "SSSSSSSWwWwWSSSSSSSS",
  /*18 torso   */ "_______WWwWW________",  // 6px body
  /*19         */ "_______WwWWW________",
  /*20         */ "_______WWwWW________",
  /*21 hem     */ "_______wWWWw________",
  /*22 belt    */ "_______bBBBb________",  // 6px belt
  /*23 waist   */ "______JJJjJJJJ______",  // 8px waistband
  /*24 legs    */ "______JJj__JJj______",  // slim legs, small gap
  /*25         */ "______JjJJ_JJjJ_____",
  /*26         */ "______JJj__JJj______",
  /*27         */ "______JjJJ_JJjJ_____",
  /*28         */ "______JJj__JJj______",
  /*29         */ "______JjJJ_JJjJ_____",
  /*30         */ "______JJj__JJj______",
  /*31         */ "______JjJJ_JJjJ_____",
  /*32         */ "______JJj__JJj______",
  /*33         */ "______JjJJ_JJjJ_____",
  /*34 ankle   */ "______ssss_ssss_____",
  /*35 sneaker */ "_____NNNNn_NNNNn____",
  /*36         */ "_____NnNNNN_NnNNN___",
  /*37 sole    */ "_____nNNNNNN_nNNNN__",
], SP, skin);

const buildSkinnyHoodie = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "_______HHHHH________",  // narrow hood
  /*15*/ "SSSSSShHHhHhHSSSSSSS",  // hood tiny, lots of arm skin
  /*16*/ "SSSSSShGGGGGhHSSSSSS",
  /*17*/ "SSSSSShGGZZGhHSSSSSS",
  /*18*/ "_______GGGGGhH______",
  /*19*/ "_______GGPPGhH______",
  /*20*/ "_______GGPpGhH______",
  /*21*/ "_______GGPPGhH______",
  /*22*/ "_______CcCCCC_______",
  /*23*/ "______DDDDDDDD______",
  /*24*/ "______DDd__DDd______",
  /*25*/ "______DdDD_DDdD_____",
  /*26*/ "______DDd__DDd______",
  /*27*/ "______DdDD_DDdD_____",
  /*28*/ "______DDd__DDd______",
  /*29*/ "______DdDD_DDdD_____",
  /*30*/ "______DDd__DDd______",
  /*31*/ "______DdDD_DDdD_____",
  /*32*/ "______DDd__DDd______",
  /*33*/ "______DdDD_DDdD_____",
  /*34*/ "______WWWW_WWWW_____",
  /*35*/ "_____WWWwwW_WWWwwW__",
  /*36*/ "_____WWWwWW_WWWwWW__",
  /*37*/ "_____WWWWWW_WWWWWW__",
], HP, skin);

// ── SKINNY GI OUTFITS ─────────────────────────────────────────────────────────
const buildSkinnyGiWhite = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "_______WWwWWWW______",  // narrow 6px collar
  /*15*/ "SSSSSSSWWwWWWSSSSSS_",  // tiny gi, wide arms
  /*16*/ "SSSSSSSWLLLWSSSSss__",  // lapel L
  /*17*/ "SSSSSSSWLwLWSSSss___",  // lapel V
  /*18*/ "_______WLwWW________",
  /*19*/ "_______WWwWW________",
  /*20*/ "_______WwWWW________",
  /*21*/ "_______wWWWw________",
  /*22*/ "_______bBBBb________",  // narrow belt
  /*23*/ "______JJJJjJJJJJ____",  // gi pants wider than jeans
  /*24*/ "_____JJJJj__jJJJJ___",
  /*25*/ "_____JjJJJ__JJJjJ___",
  /*26*/ "_____JJJJj__jJJJJ___",
  /*27*/ "_____JjJJJ__JJJjJ___",
  /*28*/ "_____JJJJj__jJJJJ___",
  /*29*/ "_____JjJJJ__JJJjJ___",
  /*30*/ "_____JJJJj__jJJJJ___",
  /*31*/ "_____JjJJJ__JJJjJ___",
  /*32*/ "______JJJj__jJJJJ___",
  /*33*/ "______JjJJ__JJjJJ___",
  /*34*/ "______ssss__ssss____",
  /*35*/ "______SSSS__SSSS____",
  /*36*/ "______SSSS__SSSS____",
  /*37*/ "_____sSSSs__sSSSs___",
], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
     J:"#EBEBEB",j:"#C8C8C4" }, skin);

const buildSkinnyGiRed = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "_______SSSSSss______",
  /*15*/ "SSSSSSSSSSSSSSSSSS__",
  /*16*/ "SSSSSSSSSSSSSSSSs___",
  /*17*/ "SSSSSSSSSSSSSSss____",
  /*18*/ "_______SSSSSSs______",
  /*19*/ "_______SSSSSss______",
  /*20*/ "_______SSSSss_______",
  /*21*/ "_______SSSss________",
  /*22*/ "_______PPPPP________",  // pink sash
  /*23*/ "______JJJJjJJJJJ____",
  /*24*/ "_____JJJJj__jJJJJ___",
  /*25*/ "_____JjJJJ__JJJjJ___",
  /*26*/ "_____JJJJj__jJJJJ___",
  /*27*/ "_____JjJJJ__JJJjJ___",
  /*28*/ "_____JJJJj__jJJJJ___",
  /*29*/ "_____JjJJJ__JJJjJ___",
  /*30*/ "_____JJJJj__jJJJJ___",
  /*31*/ "_____JjJJJ__JJJjJ___",
  /*32*/ "______JJJj__jJJJJ___",
  /*33*/ "______JjJJ__JJjJJ___",
  /*34*/ "______ssss__ssss____",
  /*35*/ "______SSSS__SSSS____",
  /*36*/ "______SSSS__SSSS____",
  /*37*/ "_____sSSSs__sSSSs___",
], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin);

const buildSkinnyGiBlue = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "_______SSSSSss______",
  /*15*/ "SSSSSSSSSSSSSSSSSS__",
  /*16*/ "SSSSSSSSSSSSSSSSs___",
  /*17*/ "SSSSSSSSSSSSSSss____",
  /*18*/ "_______SSSSSSs______",
  /*19*/ "_______SSSSSss______",
  /*20*/ "_______SSSSss_______",
  /*21*/ "_______SSSss________",
  /*22*/ "_______bBBBb________",  // yellow belt
  /*23*/ "______JJJJjJJJJJ____",
  /*24*/ "_____JJJJj__jJJJJ___",
  /*25*/ "_____JjJJJ__JJJjJ___",
  /*26*/ "_____JJJJj__jJJJJ___",
  /*27*/ "_____JjJJJ__JJJjJ___",
  /*28*/ "_____JJJJj__jJJJJ___",
  /*29*/ "_____JjJJJ__JJJjJ___",
  /*30*/ "_____JJJJj__jJJJJ___",
  /*31*/ "_____JjJJJ__JJJjJ___",
  /*32*/ "______JJJj__jJJJJ___",
  /*33*/ "______JjJJ__JJjJJ___",
  /*34*/ "______ssss__ssss____",
  /*35*/ "______SSSS__SSSS____",
  /*36*/ "______SSSS__SSSS____",
  /*37*/ "_____sSSSs__sSSSs___",
], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin);
// FULL 20px shoulders, wide 16px torso, very thick legs
const buildMuscularShirt = (skin: SkinTone): Sprite => _armorSprite([
  /*14 collar  */ "__SWWWWWWWWWWWWWSs__",  // 16px wide collar
  /*15 shoulder*/ "WWWWWWWWWWWWWWWWWWWW",  // FULL 20px — massive shoulders!
  /*16         */ "WWWWWWWWWWWWWWWWWWWW",  // still full width
  /*17 chest   */ "WWWWwWWWWWWWWwWWWWWW",  // slight highlight
  /*18 torso   */ "__WWWWWWWWWWWWWWWw___",  // 16px — stays wide
  /*19         */ "__WWWwWWWWWWwWWWWW___",
  /*20         */ "__WWWWWWWWWWWWwWWW___",
  /*21 hem     */ "__wWWWWWWWWWWWWwWW___",
  /*22 belt    */ "__bBBBBBBBBBBBBBb____",  // 16px belt
  /*23 hips    */ "__JJJJJJjJJJJJJJJJ__",  // 16px waistband
  /*24 legs    */ "__JJJJJj___JJJJJj___",   // thick legs, wide gap
  /*25         */ "__JjJJJJ___JJJJjJJ__",
  /*26         */ "__JJJJJj___JJJJJj___",
  /*27         */ "__JjJJJJ___JJJJjJJ__",
  /*28         */ "__JJJJJj___JJJJJj___",
  /*29         */ "__JjJJJJ___JJJJjJJ__",
  /*30         */ "__JJJJJj___JJJJJj___",
  /*31         */ "__JjJJJJ___JJJJjJJ__",
  /*32         */ "__JJJJJj___JJJJJj___",
  /*33         */ "__JjJJJJ___JJJJjJJ__",
  /*34 ankle   */ "__SSSSSs___SSSSSs____",   // thick ankles
  /*35 shoes   */ "_NNNNNNNn__NNNNNNNn_",   // big wide shoes
  /*36         */ "_NnNNNNNN__NnNNNNNN_",
  /*37 sole    */ "_nNNNNNNNN_nNNNNNNNN",
], SP, skin);

const buildMuscularHoodie = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "___HHHHHHHHHHHHHH___",
  /*15*/ "HHHHHHHHHHHHHHHHHHHH",  // full 20px hood
  /*16*/ "HHHHhGGGGGGGGGGhHHHH",
  /*17*/ "HHHHhGGZZGGGGZZGhHHH",
  /*18*/ "HHHHHGGZZGGGGZZGhHHH",
  /*19*/ "HHHHHGGGGGGGGGGGhHHH",
  /*20*/ "__HHHGGPPPPPPPGGhHH_",
  /*21*/ "__HHHGGPpppppPGGhHH_",
  /*22*/ "__HHHGGPPPPPPPGGhHH_",
  /*23*/ "CCCCCCCCCCCCCCCCCCCC",
  /*24*/ "__DDDDDDDDDDDDDDDD__",
  /*25*/ "__DDDDDd___DDDDDd___",
  /*26*/ "__DdDDDD___DDDDdD___",
  /*27*/ "__DDDDDd___DDDDDd___",
  /*28*/ "__DdDDDD___DDDDdD___",
  /*29*/ "__DDDDDd___DDDDDd___",
  /*30*/ "__DdDDDD___DDDDdD___",
  /*31*/ "__DDDDDd___DDDDDd___",
  /*32*/ "__DdDDDD___DDDDdD___",
  /*33*/ "__DDDDDd___DDDDDd___",
  /*34*/ "__WWWWWW___WWWWWW___",
  /*35*/ "_WWWWwwWW__WWWwwWW__",
  /*36*/ "_WWWwWWWW__WWWwWWWW_",
  /*37*/ "_WWWWWWWWW_WWWWWWWWW",
], HP, skin);

// ── MUSCULAR GI OUTFITS ───────────────────────────────────────────────────────
const buildMuscularGiWhite = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "__SWWWWWWWWWWWWWWS__",  // wide 16px collar
  /*15*/ "WWWWWWWWWWWWWWWWWWWW",  // full 20px gi shoulders
  /*16*/ "WWWWWWWWLLLLWWWWWWwW",  // lapels
  /*17*/ "WWWWWWLLwwLLLWWWWWwW",  // crossed lapels
  /*18*/ "__WWWWLLwwWWLLWWWWw_",
  /*19*/ "__WWWWWwWWWWWWWWWW__",
  /*20*/ "__WWWWWWWWWWWWWWWw__",
  /*21*/ "__wWWWWWWWWWWWWWWW__",
  /*22*/ "__bBBBBBBBBBBBBBBb__",  // wide belt
  /*23*/ "__JJJJJJjJJJJJJJJJ__",  // extra-wide gi pants
  /*24*/ "__JJJJJJj___JJJJJJj_",
  /*25*/ "__JjJJJJJ___JJJJJjJ_",
  /*26*/ "__JJJJJJj___JJJJJJj_",
  /*27*/ "__JjJJJJJ___JJJJJjJ_",
  /*28*/ "__JJJJJJj___JJJJJJj_",
  /*29*/ "__JjJJJJJ___JJJJJjJ_",
  /*30*/ "__JJJJJJj___JJJJJJj_",
  /*31*/ "__JjJJJJJ___JJJJJjJ_",
  /*32*/ "__JJJJJJj___JJJJJJj_",
  /*33*/ "__JjJJJJJ___JJJJJjJ_",
  /*34*/ "__SSSSSSs___SSSSSSs__",
  /*35*/ "_NNNNNNN____NNNNNNN__",
  /*36*/ "_NnNNNNN____NnNNNNN__",
  /*37*/ "_nNNNNNNN___nNNNNNNN_",
], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
     J:"#EBEBEB",j:"#C8C8C4",N:"#F0F0FF",n:"#9090BB" }, skin);

const buildMuscularGiRed = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "__SSSSSSSSSSSSSSSS__",
  /*15*/ "SSSSSSSSSSSSSSSSSSSS",
  /*16*/ "SSSSSSSSSSSSSSSSSSss",
  /*17*/ "SSSSSSSSSSSSSSSSSSs_",
  /*18*/ "__SSSSSSSSSSSSSSSSs_",
  /*19*/ "__SSSSSSSSSSSSSSSs__",
  /*20*/ "__SSSSSSSSSSSSSSss__",
  /*21*/ "__SSSSSSSSSSSSSss___",
  /*22*/ "__PPPPPPPPPPPPPPPP__",  // wide pink sash
  /*23*/ "__JJJJJJjJJJJJJJJJ__",
  /*24*/ "__JJJJJJj___JJJJJJj_",
  /*25*/ "__JjJJJJJ___JJJJJjJ_",
  /*26*/ "__JJJJJJj___JJJJJJj_",
  /*27*/ "__JjJJJJJ___JJJJJjJ_",
  /*28*/ "__JJJJJJj___JJJJJJj_",
  /*29*/ "__JjJJJJJ___JJJJJjJ_",
  /*30*/ "__JJJJJJj___JJJJJJj_",
  /*31*/ "__JjJJJJJ___JJJJJjJ_",
  /*32*/ "__JJJJJJj___JJJJJJj_",
  /*33*/ "__JjJJJJJ___JJJJJjJ_",
  /*34*/ "__SSSSSSs___SSSSSSs__",
  /*35*/ "_SSSSSSS____SSSSSSS__",
  /*36*/ "_SSSSSSS____SSSSSSS__",
  /*37*/ "_sSSSSSSs___sSSSSSSs_",
], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin);

const buildMuscularGiBlue = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "__SSSSSSSSSSSSSSSS__",
  /*15*/ "SSSSSSSSSSSSSSSSSSSS",
  /*16*/ "SSSSSSSSSSSSSSSSSSss",
  /*17*/ "SSSSSSSSSSSSSSSSSSs_",
  /*18*/ "__SSSSSSSSSSSSSSSSs_",
  /*19*/ "__SSSSSSSSSSSSSSSs__",
  /*20*/ "__SSSSSSSSSSSSSSss__",
  /*21*/ "__SSSSSSSSSSSSSss___",
  /*22*/ "__bBBBBBBBBBBBBBBb__",  // wide yellow belt
  /*23*/ "__JJJJJJjJJJJJJJJJ__",
  /*24*/ "__JJJJJJj___JJJJJJj_",
  /*25*/ "__JjJJJJJ___JJJJJjJ_",
  /*26*/ "__JJJJJJj___JJJJJJj_",
  /*27*/ "__JjJJJJJ___JJJJJjJ_",
  /*28*/ "__JJJJJJj___JJJJJJj_",
  /*29*/ "__JjJJJJJ___JJJJJjJ_",
  /*30*/ "__JJJJJJj___JJJJJJj_",
  /*31*/ "__JjJJJJJ___JJJJJjJ_",
  /*32*/ "__JJJJJJj___JJJJJJj_",
  /*33*/ "__JjJJJJJ___JJJJJjJ_",
  /*34*/ "__SSSSSSs___SSSSSSs__",
  /*35*/ "_SSSSSSS____SSSSSSS__",
  /*36*/ "_SSSSSSS____SSSSSSS__",
  /*37*/ "_sSSSSSSs___sSSSSSSs_",
], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin);
// 12px bust → dramatic 6px waist → 14px flared hips
// Legs positioned wider apart (under the hips)
const buildElegantShirt = (skin: SkinTone): Sprite => _armorSprite([
  /*14 collar  */ "____SWWwWWWwWWS_____",  // 10px collar
  /*15 bust/sh */ "SSSsWWWwWWWwWWsSSSs_",  // 12px bust, skin arms
  /*16         */ "SSSsWWWwWWWwWWsSSSs_",  // 12px
  /*17 bust    */ "SSSsWWbWWWWbWWSSSs__",  // bust dart b=shadow suggesting chest
  /*18 taper   */ "_____WWwWWWwWW______",  // 10px — beginning to taper
  /*19 taper   */ "______WWwWWwWW______",  // 8px — waist taper
  /*20 WAIST   */ "_______WwWwW________",  // 6px PINCHED WAIST
  /*21 WAIST   */ "_______WwWwW________",  // 6px still pinched
  /*22 belt    */ "_______bBBBb________",  // 6px narrow belt
  /*23 HIP FLARE*/"___JJJJJJjJJJJJJJ___", // 14px WIDE HIPS — wider than bust!
  /*24 legs    */ "___JJJJj____JJJJj___",  // legs at col 3-7 and 12-16
  /*25         */ "___JjJJJ____JJJjJ___",
  /*26         */ "___JJJJj____JJJJj___",
  /*27         */ "___JjJJJ____JJJjJ___",
  /*28 taper   */ "____JJJj____JJJj____",  // hips narrow back down
  /*29         */ "____JjJJ____JJjJJ___",
  /*30         */ "____JJJj____JJJj____",
  /*31         */ "____JjJJ____JJjJJ___",
  /*32         */ "____JJJj____JJJj____",
  /*33         */ "____JjJJ____JJjJJ___",
  /*34 ankle   */ "_____ssss___ssss____",
  /*35 shoes   */ "____NNNNNn__NNNNNn__",
  /*36         */ "____NnNNNN__NnNNNN__",
  /*37 sole    */ "____nNNNNNN_nNNNNN__",
], SP, skin);

const buildElegantHoodie = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____HHHHHHHHHHH_____",
  /*15*/ "SSSssHHHhHHhHHSSSss_",  // narrow hood on wide skin
  /*16*/ "SSSsshHGGGGGGhHSSss_",
  /*17*/ "SSSsshGGZZGGGhHSSss_",
  /*18*/ "_____hGGGGGGGhH_____",
  /*19*/ "______hGGGGGhH______",
  /*20*/ "_______GGPpGG_______",  // WAIST 6px
  /*21*/ "_______GGPpGG_______",
  /*22*/ "_______CCcCCC_______",
  /*23*/ "___DDDDDDDDDDDDDDD__",  // HIP 14px
  /*24*/ "___DDDDd____DDDDd___",
  /*25*/ "___DdDDD____DDDdD___",
  /*26*/ "___DDDDd____DDDDd___",
  /*27*/ "___DdDDD____DDDdD___",
  /*28*/ "____DDDd____DDDd____",
  /*29*/ "____DdDD____DDdD____",
  /*30*/ "____DDDd____DDDd____",
  /*31*/ "____DdDD____DDdD____",
  /*32*/ "____DDDd____DDDd____",
  /*33*/ "____DdDD____DDdD____",
  /*34*/ "_____WWWW___WWWW____",
  /*35*/ "____WWWwwW__WWWwwW__",
  /*36*/ "____WWWwWW__WWWwWW__",
  /*37*/ "____WWWWWW__WWWWWW__",
], HP, skin);

// ── SPORTY FEMALE (SLIM ATHLETIC) ─────────────────────────────────────────────
// 10px chest → gentle 8px waist → 11px hips — toned, lean
const buildSportyShirt = (skin: SkinTone): Sprite => _armorSprite([
  /*14 collar  */ "_____SWWwWWWwWS_____",  // 10px collar
  /*15 shoulder*/ "SSSssWWWwWWWwWSSSSs_",  // 10px bust, skin arms
  /*16         */ "SSSssWwWWWWWwWSSSSs_",
  /*17         */ "SSSssWWWWWWWwWSSSSs_",
  /*18 torso   */ "______WwWWWWwW______",  // 8px torso
  /*19         */ "______WWWWWwWW______",
  /*20 WAIST   */ "______WWwWWwWW______",  // 8px slight waist dip
  /*21         */ "______wWWWWWwW______",
  /*22 belt    */ "______bBBBBBb_______",  // 8px belt
  /*23 hips    */ "_____JJJJjJJJJJJ____",  // 10px moderate hips
  /*24 legs    */ "_____JJJj__JJJj_____",
  /*25         */ "_____JjJJJ_JJJjJ____",
  /*26         */ "_____JJJj__JJJj_____",
  /*27         */ "_____JjJJJ_JJJjJ____",
  /*28         */ "_____JJJj__JJJj_____",
  /*29         */ "_____JjJJJ_JJJjJ____",
  /*30         */ "_____JJJj__JJJj_____",
  /*31         */ "_____JjJJJ_JJJjJ____",
  /*32         */ "_____JJJj__JJJj_____",
  /*33         */ "_____JjJJJ_JJJjJ____",
  /*34 ankle   */ "_____ssss__ssss_____",
  /*35 sneaker */ "____NNNNNn_NNNNNn___",
  /*36         */ "____NnNNNN_NnNNNN___",
  /*37 sole    */ "____nNNNNNN_nNNNNN__",
], SP, skin);

const buildSportyHoodie = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____HHHHHHHHHHHH____",
  /*15*/ "SSSsssHHhHHhHHSSSSs_",
  /*16*/ "SSSssshHGGGGhHSSSSs_",
  /*17*/ "SSSssshGGZZGhHSSSSs_",
  /*18*/ "______hGGGGGhH______",
  /*19*/ "______hGGPPGhH______",
  /*20*/ "______hGGPpGhH______",
  /*21*/ "______hGGPPGhH______",
  /*22*/ "______CccCCCCc______",
  /*23*/ "_____DDDDDDDDDDD____",
  /*24*/ "_____DDDd__DDDd_____",
  /*25*/ "_____DdDD__DDdD_____",
  /*26*/ "_____DDDd__DDDd_____",
  /*27*/ "_____DdDD__DDdD_____",
  /*28*/ "_____DDDd__DDDd_____",
  /*29*/ "_____DdDD__DDdD_____",
  /*30*/ "_____DDDd__DDDd_____",
  /*31*/ "_____DdDD__DDdD_____",
  /*32*/ "_____DDDd__DDDd_____",
  /*33*/ "_____DdDD__DDdD_____",
  /*34*/ "_____WWWW__WWWW_____",
  /*35*/ "____WWWwwW_WWWwwW___",
  /*36*/ "____WWWwWW_WWWwWW___",
  /*37*/ "____WWWWWW_WWWWWW___",
], HP, skin);

// ── ELEGANT + SPORTY GI OUTFITS ───────────────────────────────────────────────
// These share a common gi pants helper — only the torso section differs by type.
const _giPantsRows = [
  "___JJJJJJjJJJJJJJJ__",  // hip flare
  "___JJJJJj__jJJJJJ__",
  "___JjJJJJ__JJJJjJ__",
  "___JJJJJj__jJJJJJ__",
  "___JjJJJJ__JJJJjJ__",
  "____JJJJj__jJJJJ____",
  "____JjJJJ__JJJjJ____",
  "____JJJJj__jJJJJ____",
  "____JjJJJ__JJJjJ____",
  "____JJJJj__jJJJJ____",
  "____JjJJJ__JJJjJ____",
  "____ssss___ssss_____",
  "____SSSS___SSSS_____",
  "____SSSS___SSSS_____",
  "___sSSSss__sSSSss___",
];

const buildElegantGiWhite = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SWWwWWWwWWWS____",
  /*15*/ "SSssWWWWWWWWWWWSSSs_",
  /*16*/ "SSsWWWLLLLLWWWWSSs__",
  /*17*/ "SSsWWLLwwLLLWWWSss__",
  /*18*/ "____WWLLwwWLLWW_____",
  /*19*/ "_____WWwWWWWWWW_____",
  /*20*/ "_____WWWWWWWwWW_____",
  /*21*/ "_____wWWWWWwWWW_____",
  /*22*/ "_____bBBBBBBBb______",
  ..._giPantsRows,
], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
     J:"#EBEBEB",j:"#C8C8C4" }, skin);

const buildElegantGiRed = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SSSSSSSSSSss____",
  /*15*/ "SSssSSSSSSSSSSSSss__",
  /*16*/ "SSssSSSSSSSSSSSSss__",
  /*17*/ "SSssSSSSSSSSSSSSss__",
  /*18*/ "_____SSSSSSSSSss____",
  /*19*/ "_____SSSSSSSSss_____",
  /*20*/ "_____SSSSSSSss______",
  /*21*/ "_____SSSSSSss_______",
  /*22*/ "_____PPPPPPPPPP_____",
  ..._giPantsRows,
], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin);

const buildElegantGiBlue = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SSSSSSSSSSss____",
  /*15*/ "SSssSSSSSSSSSSSSss__",
  /*16*/ "SSssSSSSSSSSSSSSss__",
  /*17*/ "SSssSSSSSSSSSSSSss__",
  /*18*/ "_____SSSSSSSSSss____",
  /*19*/ "_____SSSSSSSSss_____",
  /*20*/ "_____SSSSSSSss______",
  /*21*/ "_____SSSSSSss_______",
  /*22*/ "_____bBBBBBBBBBb____",
  ..._giPantsRows,
], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin);

const buildSportyGiWhite = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SWWwWWWwWWS_____",
  /*15*/ "SSSssWWWWWWWWWWSSSs_",
  /*16*/ "SSSsWWWLLLLWWWWSSs__",
  /*17*/ "SSSsWWLLwwLLWWWSss__",
  /*18*/ "______WWLLwLLWW_____",
  /*19*/ "______WWwWWWWWW_____",
  /*20*/ "______WWWWWWwWW_____",
  /*21*/ "______wWWWWwWWW_____",
  /*22*/ "______bBBBBBBb______",
  ..._giPantsRows,
], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
     J:"#EBEBEB",j:"#C8C8C4" }, skin);

const buildSportyGiRed = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SSSSSSSSSSss____",
  /*15*/ "SSSssSSSSSSSSSSSSs__",
  /*16*/ "SSSssSSSSSSSSSSSss__",
  /*17*/ "SSSssSSSSSSSSSSSss__",
  /*18*/ "______SSSSSSSSSss___",
  /*19*/ "______SSSSSSSSss____",
  /*20*/ "______SSSSSSSss_____",
  /*21*/ "______SSSSSSss______",
  /*22*/ "______PPPPPPPPPP____",
  ..._giPantsRows,
], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin);

const buildSportyGiBlue = (skin: SkinTone): Sprite => _armorSprite([
  /*14*/ "____SSSSSSSSSSss____",
  /*15*/ "SSSssSSSSSSSSSSSSs__",
  /*16*/ "SSSssSSSSSSSSSSSss__",
  /*17*/ "SSSssSSSSSSSSSSSss__",
  /*18*/ "______SSSSSSSSSss___",
  /*19*/ "______SSSSSSSSss____",
  /*20*/ "______SSSSSSSss_____",
  /*21*/ "______SSSSSSss______",
  /*22*/ "______bBBBBBBBBBb___",
  ..._giPantsRows,
], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin);

// ── GI outfit ID set — used to trigger guard stance arms ─────────────────────
const GI_OUTFITS = new Set(["armor_gi_white","armor_gi_red","armor_gi_blue"]);

type _AF = (skin: SkinTone) => Sprite;
const _BODY_FACTORIES: Record<string, Record<string, _AF>> = {
  male_default:   {
    armor_shirt_basic: buildSkinnyShirt,   armor_hoodie_gray: buildSkinnyHoodie,
    armor_gi_white:    buildSkinnyGiWhite, armor_gi_red:      buildSkinnyGiRed,
    armor_gi_blue:     buildSkinnyGiBlue,
  },
  male_athletic:  {
    armor_shirt_basic: buildMuscularShirt,  armor_hoodie_gray: buildMuscularHoodie,
    armor_gi_white:    buildMuscularGiWhite,armor_gi_red:      buildMuscularGiRed,
    armor_gi_blue:     buildMuscularGiBlue,
  },
  female_elegant: {
    armor_shirt_basic: buildElegantShirt,   armor_hoodie_gray: buildElegantHoodie,
    armor_gi_white:    buildElegantGiWhite, armor_gi_red:      buildElegantGiRed,
    armor_gi_blue:     buildElegantGiBlue,
  },
  female_sporty:  {
    armor_shirt_basic: buildSportyShirt,    armor_hoodie_gray: buildSportyHoodie,
    armor_gi_white:    buildSportyGiWhite,  armor_gi_red:      buildSportyGiRed,
    armor_gi_blue:     buildSportyGiBlue,
  },
};
function getBodyTypedArmorFactory(armorId: string, bodyTypeId: string): _AF | null {
  return _BODY_FACTORIES[bodyTypeId]?.[armorId] ?? null;
}

const {
  CW, CH, CHAR_X, CHAR_Y, CHAR_Y_MOUNTED,
  MOUNT_X, MOUNT_Y, SPET_X, SPET_Y,
  WEAPON_X, WEAPON_Y, WEAPON_LEFT_X, WEAPON_LEFT_Y,
  L_ARM_X, L_ARM_Y, R_ARM_X, R_ARM_Y,
} = AVATAR;

const SCALE = 5;

// ── Body types ────────────────────────────────────────────────────────────────
export const BODY_TYPES = [
  { id: "male_default",   label: "Skinny Male",    emoji: "🧍",  desc: "Lean & lanky build" },
  { id: "male_athletic",  label: "Muscular Male",  emoji: "💪",  desc: "Jacked. Absolutely jacked." },
  { id: "female_elegant", label: "Elegant Female", emoji: "👸",  desc: "Curves in all the right places" },
  { id: "female_sporty",  label: "Sporty Female",  emoji: "🏃",  desc: "Slim, toned & athletic" },
] as const;

export type BodyTypeId = typeof BODY_TYPES[number]["id"];

export interface AvatarConfig {
  bodyTypeId: BodyTypeId | string;
  skinId:     string;
  hairId:     string;
  eyeColorId: string;
  lipColorId: string;
  armorId:    string;
  headId:     string;
  weaponId:   string;
  petId:      string;
}

export const DEFAULT_CONFIG: AvatarConfig = {
  bodyTypeId: "male_default",
  skinId:     "ivory",
  hairId:     "black",
  eyeColorId: "blue",
  lipColorId: "natural",
  armorId:    "armor_shirt_basic",
  headId:     "",
  weaponId:   "",
  petId:      "",
};

const isFemale = (b: string) => b === "female_elegant" || b === "female_sporty";

// ── Arm helpers per body type ─────────────────────────────────────────────────
function getArmBuilders(bodyTypeId: string) {
  switch (bodyTypeId) {
    case "male_default":
      return { down: buildArmDownSkinny, up: buildArmUpSkinny };
    case "male_athletic":
      return { down: buildArmDownMuscular, up: buildArmUpMuscular };
    default:
      return { down: buildArmDown, up: buildArmUp };
  }
}

function getArmX(bodyTypeId: string) {
  switch (bodyTypeId) {
    case "male_default":  return ARM_X.skinny;
    case "male_athletic": return ARM_X.muscular;
    default:              return ARM_X.default;
  }
}

// ── Canvas render ─────────────────────────────────────────────────────────────
function renderToCtx(ctx: CanvasRenderingContext2D, config: AvatarConfig) {
  const skin     = LIB_SKIN_TONES.find(s => s.id === config.skinId)  ?? LIB_SKIN_TONES[0];
  const hair     = LIB_HAIR_COLORS.find(h => h.id === config.hairId) ?? LIB_HAIR_COLORS[0];
  const eyeColor = LIB_EYE_COLORS.find(e => e.id === config.eyeColorId) ?? LIB_EYE_COLORS[0];
  const lipColor = LIB_LIP_COLORS.find(l => l.id === config.lipColorId) ?? LIB_LIP_COLORS[0];

  const bodyTypeId = config.bodyTypeId || "male_default";
  const armorId    = config.armorId  || "armor_bare_basic";
  const petId      = config.petId    || "";
  const weaponId   = config.weaponId || "";
  const headId     = config.headId   || "";
  const female     = isFemale(bodyTypeId);

  const isMount = PET_MOUNTS.has(petId);
  const isSmall = !isMount && !!SMALL_PET_SPRITES[petId];
  const charY   = isMount ? CHAR_Y_MOUNTED : CHAR_Y;
  const hasWpn  = !!weaponId && !!WEAPON_SPRITES[weaponId];
  const isDual  = hasWpn && DUAL_WIELD_WEAPONS.has(weaponId);
  const isGi    = GI_OUTFITS.has(armorId);  // fighting stance — both arms raised

  ctx.clearRect(0, 0, CW * SCALE, CH * SCALE);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(SCALE, SCALE);

  // Pets
  if (isMount && MOUNT_PET_SPRITES[petId]) blit(ctx, MOUNT_PET_SPRITES[petId](), MOUNT_X, MOUNT_Y);
  if (isSmall && SMALL_PET_SPRITES[petId]) blit(ctx, SMALL_PET_SPRITES[petId](), SPET_X, SPET_Y);

  // ── Arms — body-type specific ─────────────────────────────────────────────
  const arms = getArmBuilders(bodyTypeId);
  const ax   = getArmX(bodyTypeId);

  const lArmFn = (isDual || isGi) ? arms.up   : arms.down;
  const rArmFn = (hasWpn || isGi) ? arms.up   : arms.down;

  blit(ctx, lArmFn(skin), ax.L, charY + L_ARM_Y - CHAR_Y);
  blit(ctx, rArmFn(skin), ax.R, charY + R_ARM_Y - CHAR_Y);

  // ── Body armor — body-type specific first, then female, then default ──────
  const bodyTypedFn = getBodyTypedArmorFactory(armorId, bodyTypeId);
  const fallbackFn  = female
    ? (FEMALE_ARMOR_FACTORIES[armorId] ?? ARMOR_FACTORIES[armorId] ?? ARMOR_FACTORIES["armor_bare_basic"])
    : (ARMOR_FACTORIES[armorId] ?? ARMOR_FACTORIES["armor_bare_basic"]);
  const armorFn = bodyTypedFn ?? fallbackFn;
  blit(ctx, armorFn(skin), CHAR_X, charY);

  // ── Head — female variant for female body types ───────────────────────────
  const headSprite = female
    ? buildFemaleHead(skin, hair, eyeColor, lipColor, bodyTypeId === "female_sporty")
    : buildHead(skin, hair, eyeColor, lipColor);
  blit(ctx, headSprite, CHAR_X, charY);

  if (headId && HEADGEAR_SPRITES[headId]) blit(ctx, HEADGEAR_SPRITES[headId](), CHAR_X, charY);
  if (hasWpn) blit(ctx, WEAPON_SPRITES[weaponId](), WEAPON_X, charY + WEAPON_Y);
  if (isDual) blit(ctx, mirrorX(WEAPON_SPRITES[weaponId]()), WEAPON_LEFT_X, charY + WEAPON_LEFT_Y);

  ctx.restore();

  // ── Ground shadow ─────────────────────────────────────────────────────────
  const W = CW * SCALE, H = CH * SCALE;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle   = "#000020";
  ctx.beginPath();
  ctx.ellipse(W / 2, H - SCALE * 3, W * 0.28, SCALE * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Option lists ──────────────────────────────────────────────────────────────
const OUTFIT_OPTIONS = [
  { id: "armor_gi_white",       label: "White Gi",         emoji: "🥋", hint: "Karate gi, black belt" },
  { id: "armor_gi_red",         label: "Red Fighter",      emoji: "🔴", hint: "Bare chest + red pants" },
  { id: "armor_gi_blue",        label: "Blue Fighter",     emoji: "🔵", hint: "Bare chest + blue pants" },
  { id: "armor_shirt_basic",    label: "Street Tee",       emoji: "👕", hint: "Clean tee + jeans" },
  { id: "armor_hoodie_gray",    label: "Phantom Hoodie",   emoji: "🧥", hint: "Oversized, kangaroo pocket" },
  { id: "armor_robe_blue",      label: "Azure Vestments",  emoji: "📜", hint: "Sapphire robe, gold trim" },
  { id: "armor_jacket_cool",    label: "Midnight Jacket",  emoji: "😎", hint: "Black leather, combat boots" },
  { id: "armor_knight_silver",  label: "Titanfall Plate",  emoji: "🛡️", hint: "Spiked pauldrons & greaves" },
  { id: "armor_knight_gold",    label: "Sol Emperor",      emoji: "⚜️", hint: "Solidified sunlight armor" },
  { id: "armor_wizard_purple",  label: "Void Weaver",      emoji: "🔮", hint: "Arcane robes + rune emblem" },
  { id: "armor_dragon_scale",   label: "Ignis Scale Mail", emoji: "🐉", hint: "Volcano dragon scales" },
  { id: "armor_legends_mantle", label: "Astral Mantle",    emoji: "✨", hint: "Pulsing with starlight" },
];

const HEAD_OPTIONS = [
  { id: "",                     label: "Bare Head",        emoji: "〇" },
  { id: "hat_headband_red",     label: "Red Headband",     emoji: "🔴" },
  { id: "hat_headband_blue",    label: "Blue Headband",    emoji: "🔵" },
  { id: "hat_headband_white",   label: "White Headband",   emoji: "⬜" },
  { id: "hat_baseball_red",     label: "Crimson Cap",      emoji: "🧢" },
  { id: "hat_beanie_blue",    label: "Frostwave Beanie",emoji: "🎿" },
  { id: "hat_wizard",         label: "Archmage Hat",    emoji: "🧙" },
  { id: "hat_crown_bronze",   label: "Verdant Crown",   emoji: "👑" },
  { id: "hat_crown_silver",   label: "Glacial Crown",   emoji: "👑" },
  { id: "hat_crown_gold",     label: "Solaris Crown",   emoji: "👑" },
  { id: "hat_headphones",     label: "Neural Link",     emoji: "🎧" },
  { id: "hat_ninja",          label: "Shadow Veil",     emoji: "🥷" },
  { id: "hat_samurai",        label: "Oni Helm",        emoji: "⛩️" },
];

const WEAPON_OPTIONS = [
  { id: "",                       label: "Unarmed",         emoji: "✊", hint: "" },
  { id: "weapon_pencil",          label: "Scholar Pencil",  emoji: "✏️", hint: "" },
  { id: "weapon_ruler",           label: "Precision Ruler", emoji: "📏", hint: "" },
  { id: "weapon_sword_bronze",    label: "Dawnsteel ✦✦",   emoji: "⚔️", hint: "Dual wield!" },
  { id: "weapon_sword_silver",    label: "Moonblade ✦✦",   emoji: "⚔️", hint: "Dual wield!" },
  { id: "weapon_sword_excalibur", label: "Excalibur ✦✦",   emoji: "✨", hint: "Dual wield!" },
  { id: "weapon_staff_wood",      label: "Emberwood Staff", emoji: "🪄", hint: "" },
  { id: "weapon_staff_crystal",   label: "Aqua Prism",      emoji: "💎", hint: "" },
  { id: "weapon_staff_legendary", label: "Infernal Codex",  emoji: "🌟", hint: "" },
  { id: "weapon_bow",             label: "Ashwood Bow",     emoji: "🏹", hint: "" },
  { id: "weapon_hammer",          label: "Thundercrack",    emoji: "🔨", hint: "" },
];

const PET_OPTIONS = [
  { id: "",                   label: "No Pet",   emoji: "〇",  size: "" as const },
  { id: "pet_cat_orange",     label: "Pyra",     emoji: "🐱",  size: "companion" as const },
  { id: "pet_dog_brown",      label: "Rex",      emoji: "🐶",  size: "companion" as const },
  { id: "pet_owl",            label: "Athena",   emoji: "🦉",  size: "companion" as const },
  { id: "pet_panda",          label: "Kai",      emoji: "🐼",  size: "companion" as const },
  { id: "pet_fox",            label: "Zephyr",   emoji: "🦊",  size: "companion" as const },
  { id: "pet_dragon_baby",    label: "Ignis",    emoji: "🔥",  size: "mount" as const },
  { id: "pet_phoenix",        label: "Solara",   emoji: "🦅",  size: "mount" as const },
  { id: "pet_unicorn",        label: "Lumis",    emoji: "🌈",  size: "mount" as const },
  { id: "pet_dragon_ancient", label: "Erebus",   emoji: "💀",  size: "mount" as const },
  { id: "pet_lion_golden",    label: "Aurum",    emoji: "⭐",  size: "mount" as const },
];

// ── Body type silhouette preview (pure CSS — drawn in the card) ───────────────
function BodySilhouette({ bodyTypeId, selected }: { bodyTypeId: string; selected: boolean }) {
  const c  = selected ? "#FFCC00" : "#AA88EE";
  const c2 = selected ? "#AA8800" : "#6644AA";

  if (bodyTypeId === "male_default") return (
    // SKINNY — tall, narrow, 8px-wide torso
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={5}  ry={6}  fill={c} />
      <rect    x={25.5}  y={13} width={5}  height={3}  fill={c} />
      {/* Narrow torso */}
      <path d="M 22 16 L 34 16 L 33 38 L 23 38 Z" fill={c} opacity={0.9} />
      {/* Slim arms (barely wider than a line) */}
      <rect x={19} y={17} width={3} height={18} rx={1} fill={c2} opacity={0.85} />
      <rect x={34} y={17} width={3} height={18} rx={1} fill={c2} opacity={0.85} />
      {/* Slim legs */}
      <rect x={22} y={38} width={4} height={28} rx={2} fill={c} />
      <rect x={30} y={38} width={4} height={28} rx={2} fill={c} />
    </svg>
  );

  if (bodyTypeId === "male_athletic") return (
    // MUSCULAR — very wide shoulders, thick neck, thick limbs
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={8}  ry={8}  fill={c} />
      <rect    x={23}  y={14} width={10} height={4}  fill={c} />
      {/* Wide V-taper torso */}
      <path d="M 8 18 L 48 18 L 40 42 L 16 42 Z" fill={c} opacity={0.9} />
      {/* Massive arms */}
      <rect x={2}  y={18} width={8} height={22} rx={3} fill={c2} opacity={0.9} />
      <rect x={46} y={18} width={8} height={22} rx={3} fill={c2} opacity={0.9} />
      {/* Thick legs */}
      <rect x={15} y={42} width={10} height={26} rx={3} fill={c} />
      <rect x={31} y={42} width={10} height={26} rx={3} fill={c} />
    </svg>
  );

  if (bodyTypeId === "female_elegant") return (
    // HOURGLASS — wide hips, pinched waist, moderate shoulders
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={6}  ry={7}  fill={c} />
      <rect    x={25.5} y={14} width={5} height={3} fill={c} />
      {/* Hourglass — shoulders, pinch, hips */}
      <path d="M 17 17 C 10 22, 22 30, 21 34 C 20 38, 11 40, 10 48 L 46 48 C 45 40, 36 38, 35 34 C 34 30, 46 22, 39 17 Z" fill={c} opacity={0.9} />
      {/* Delicate arms */}
      <rect x={12} y={18} width={3} height={17} rx={1} fill={c2} opacity={0.8} />
      <rect x={41} y={18} width={3} height={17} rx={1} fill={c2} opacity={0.8} />
      {/* Legs from wide hip base */}
      <rect x={14} y={48} width={7} height={24} rx={3} fill={c} />
      <rect x={35} y={48} width={7} height={24} rx={3} fill={c} />
    </svg>
  );

  // SPORTY FEMALE — lean and toned, slight curves, athletic
  return (
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={6}  ry={7}  fill={c} />
      <rect    x={25}  y={14} width={6} height={3}  fill={c} />
      {/* Slim athletic torso — slight taper waist then hips */}
      <path d="M 18 17 L 38 17 L 36 34 L 33 42 L 23 42 L 20 34 Z" fill={c} opacity={0.9} />
      {/* Toned arms */}
      <rect x={14} y={18} width={4} height={17} rx={2} fill={c2} opacity={0.85} />
      <rect x={38} y={18} width={4} height={17} rx={2} fill={c2} opacity={0.85} />
      {/* Athletic legs */}
      <rect x={20} y={42} width={6} height={27} rx={2} fill={c} />
      <rect x={30} y={42} width={6} height={27} rx={2} fill={c} />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PixelAvatarBuilderProps {
  config:         AvatarConfig;
  onConfigChange: (key: keyof AvatarConfig, val: string) => void;
  ownedItemIds?:  string[];
}

type TabId = "body"|"skin"|"hair"|"face"|"outfit"|"headgear"|"weapon"|"pet";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "body",     icon: "🧑", label: "BODY"   },
  { id: "skin",     icon: "🎨", label: "SKIN"   },
  { id: "hair",     icon: "💇", label: "HAIR"   },
  { id: "face",     icon: "👁️", label: "FACE"   },
  { id: "outfit",   icon: "👕", label: "OUTFIT" },
  { id: "headgear", icon: "🪖", label: "HEAD"   },
  { id: "weapon",   icon: "⚔️", label: "WEAPON" },
  { id: "pet",      icon: "🐾", label: "PET"    },
];

const PREVIEW_SCALE = 6;

export default function PixelAvatarBuilder({ config, onConfigChange, ownedItemIds }: PixelAvatarBuilderProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<TabId>("body");
  const [hoveredId,   setHoveredId]   = useState<string | null>(null);
  const [flashState,  setFlashState]  = useState<"idle"|"flash"|"settle">("idle");
  const prevConfigRef = useRef(config);

  const owned = ownedItemIds ?? null;
  const filterOpts = <T extends { id: string }>(opts: T[], cur: string): T[] => {
    if (!owned) return opts;
    return opts.filter(o => o.id === "" || o.id === cur || owned.includes(o.id));
  };

  const visOuts    = filterOpts(OUTFIT_OPTIONS,  config.armorId);
  const visHeads   = filterOpts(HEAD_OPTIONS,    config.headId);
  const visWeapons = filterOpts(WEAPON_OPTIONS,  config.weaponId);
  const visPets    = filterOpts(PET_OPTIONS,     config.petId);

  // Build preview config on hover
  const previewCfg = useCallback((): AvatarConfig => {
    if (!hoveredId) return config;
    if (OUTFIT_OPTIONS.some(o => o.id === hoveredId))  return { ...config, armorId:  hoveredId };
    if (HEAD_OPTIONS.some(o => o.id === hoveredId))    return { ...config, headId:   hoveredId };
    if (WEAPON_OPTIONS.some(o => o.id === hoveredId))  return { ...config, weaponId: hoveredId };
    if (PET_OPTIONS.some(o => o.id === hoveredId))     return { ...config, petId:    hoveredId };
    return config;
  }, [config, hoveredId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    renderToCtx(ctx, previewCfg());
  }, [previewCfg]);

  useEffect(() => { draw(); }, [draw]);

  // Flash on real config change (not hover)
  useEffect(() => {
    if (JSON.stringify(prevConfigRef.current) !== JSON.stringify(config)) {
      prevConfigRef.current = config;
      setFlashState("flash");
      setTimeout(() => setFlashState("settle"), 120);
      setTimeout(() => setFlashState("idle"),   350);
    }
  }, [config]);

  const female = isFemale(config.bodyTypeId);

  // ── Option card component ─────────────────────────────────────────────────
  const Opt = ({ id, selected, onHoverEnter, onHoverLeave, onClick, children }: {
    id: string; selected: boolean;
    onHoverEnter: () => void; onHoverLeave: () => void; onClick: () => void;
    children: React.ReactNode;
  }) => {
    const hovered = hoveredId === id;
    return (
      <button
        onClick={onClick}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        style={{
          position: "relative",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 6, padding: "9px 6px", borderRadius: 10, cursor: "pointer",
          border: `2px solid ${selected ? "#F59E0B" : hovered ? "#7C3AED66" : "#0C0C1E"}`,
          background: selected ? "#1C0E00" : hovered ? "#0E0A1E" : "#07070D",
          boxShadow: selected ? "0 0 20px #F59E0B33, inset 0 1px 0 #F59E0B15" : "none",
          fontFamily: "'Press Start 2P', monospace",
          transition: "all .1s",
        }}
      >
        {selected && (
          <div style={{
            position: "absolute", top: 4, right: 5,
            fontSize: 9, color: "#F59E0B", lineHeight: 1,
          }}>✦</div>
        )}
        {children}
      </button>
    );
  };

  const SecHead = ({ title, sub }: { title: string; sub?: string }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: "#7C3AED", letterSpacing: 1 }}>{title}</div>
      {sub && <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 5, color: "#1E1A30", lineHeight: 2, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  const spriteBox = (id: string, selected: boolean) => (
    <div style={{
      padding: 3, background: selected ? "#2A1000" : "#080810",
      border: `1px solid ${selected ? "#7C3AED" : "#0C0C1E"}`,
      borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 38, minWidth: 38,
    }}>
      {id ? <PixelSprite itemId={id} size="sm" /> : <span style={{ fontSize: 20 }}>—</span>}
    </div>
  );

  const loadoutLabels = {
    outfit:  visOuts.find(o => o.id === config.armorId)?.label ?? "—",
    head:    visHeads.find(o => o.id === config.headId)?.label ?? "None",
    weapon:  visWeapons.find(o => o.id === config.weaponId)?.label ?? "None",
    pet:     visPets.find(o => o.id === config.petId)?.label ?? "None",
    body:    BODY_TYPES.find(b => b.id === config.bodyTypeId)?.label.replace("\n", " ") ?? "—",
  };

  return (
    <div style={{
      display: "flex", height: "100%",
      maxWidth: 1100, width: "min(1100px, 100%)", borderRadius: 20, overflow: "hidden",
      border: "1px solid #0C0C1E",
      boxShadow: "0 0 100px #7C3AED18, 0 32px 80px rgba(0,0,0,.9)",
    }}>

      {/* ══ LEFT — AVATAR STAGE ══════════════════════════════════════════ */}
      <div style={{
        flexShrink: 0,
        width: CW * PREVIEW_SCALE + 60,
        height: "100%",
        background: "#05030C",
        position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>

        {/* Animated aurora bg */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", width: "120%", height: "120%", top: "-10%", left: "-10%",
            background: "radial-gradient(ellipse 60% 40% at 30% 20%, #4C1D9530 0%, transparent 60%)",
            animation: "hf-aurora1 9s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: "120%", height: "120%", top: "-10%", left: "-10%",
            background: "radial-gradient(ellipse 50% 50% at 70% 70%, #06402430 0%, transparent 60%)",
            animation: "hf-aurora2 11s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: "100%", height: "100%",
            background: "radial-gradient(ellipse 70% 60% at 50% 100%, #7C3AED18 0%, transparent 60%)" }} />
        </div>

        {/* Vertical scan lines */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,.015) 39px,rgba(255,255,255,.015) 40px)",
          zIndex: 0,
        }} />

        {/* Circle rune behind avatar */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 0 }}>
          <svg width={360} height={360} style={{ animation: "hf-runespin 20s linear infinite" }}>
            <circle cx={180} cy={180} r={168} fill="none" stroke="#7C3AED" strokeWidth={1} strokeDasharray="6 14" strokeOpacity={.25} />
            {[...Array(8)].map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              return <circle key={i} cx={180 + 164 * Math.cos(a)} cy={180 + 164 * Math.sin(a)} r={4} fill="#7C3AED" fillOpacity={i % 2 === 0 ? .5 : .2} />;
            })}
          </svg>
        </div>

        {/* Ground glow — anchored to same center as avatar */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400, height: 400,
          background: "radial-gradient(circle, #7C3AED22 0%, transparent 70%)",
          filter: "blur(40px)", pointerEvents: "none", zIndex: 0,
        }} />

        {/* ── THE AVATAR — character-center aligned to stage center ─── */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, calc(-50% + 90px))",
          zIndex: 2,
        }}>
          {/* Flash ring */}
          <div style={{
            position: "absolute", inset: -16, borderRadius: 24, pointerEvents: "none",
            background: "radial-gradient(circle, #F59E0B66, transparent 70%)",
            opacity: flashState === "flash" ? 1 : 0,
            transform: flashState === "flash" ? "scale(1)" : "scale(.85)",
            transition: flashState === "idle" ? "opacity .25s, transform .25s" : "none",
          }} />

          <div style={{ animation: "hf-float 4s ease-in-out infinite" }}>
            <canvas
              ref={canvasRef}
              width={CW * PREVIEW_SCALE}
              height={CH * PREVIEW_SCALE}
              style={{
                imageRendering: "pixelated",
                display: "block",
                filter: `drop-shadow(0 12px 32px #7C3AED66) drop-shadow(0 0 8px #7C3AED44)`,
                transition: "filter .2s",
              }}
            />
          </div>
        </div>

        {/* ── Loadout chips — pinned to bottom of stage ───────────────── */}
        <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, zIndex: 3, display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", padding: "0 12px" }}>
          {([
            ["BODY",   loadoutLabels.body,   "#A78BFA"],
            ["OUTFIT", loadoutLabels.outfit, "#60A5FA"],
            ["HEAD",   loadoutLabels.head,   "#F59E0B"],
            ["WEAPON", loadoutLabels.weapon, "#F87171"],
            ["PET",    loadoutLabels.pet,    "#34D399"],
          ] as [string, string, string][]).map(([k, v, c]) => (
            <div key={k} style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 5,
              color: c, background: c + "12", border: `1px solid ${c}28`,
              borderRadius: 5, padding: "3px 8px",
              maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {k}: {v}
            </div>
          ))}
        </div>

        {/* Hover preview label */}
        {hoveredId && (
          <div style={{
            position: "absolute", top: 14, left: 0, right: 0, textAlign: "center",
            fontFamily: "'Press Start 2P', monospace", fontSize: 6,
            color: "#7C3AED", letterSpacing: 2, zIndex: 5,
            animation: "hf-pulse 1.2s ease-in-out infinite",
          }}>
            ● PREVIEW
          </div>
        )}
      </div>

      {/* ══ RIGHT — CUSTOMISER ══════════════════════════════════════════ */}
      <div style={{
        flex: 1, minWidth: 0, background: "#040408",
        display: "flex", flexDirection: "column",
        borderLeft: "1px solid #0C0C1E",
        fontFamily: "'Press Start 2P', monospace",
      }}>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexWrap: "wrap", background: "#030306", borderBottom: "1px solid #0C0C1E", flexShrink: 0 }}>
          {TABS.map(t => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: "1 1 auto", minWidth: 40, padding: "9px 2px 8px",
                background: on ? "#0A0818" : "transparent",
                border: "none", outline: "none", cursor: "pointer",
                borderBottom: `3px solid ${on ? "#F59E0B" : "transparent"}`,
                color: on ? "#F59E0B" : "#1A1530",
                fontSize: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                fontFamily: "inherit", transition: "all .1s",
              }}>
                <span style={{ fontSize: 15, filter: on ? "drop-shadow(0 0 6px #F59E0BAA)" : "none", transition: "filter .1s" }}>{t.icon}</span>
                <span style={{ letterSpacing: 0.5 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Panel body ────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

          {/* BODY */}
          {tab === "body" && (
            <div>
              <SecHead title="CHOOSE BUILD" sub="Your silhouette defines your legend" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {BODY_TYPES.map(bt => {
                  const sel = config.bodyTypeId === bt.id;
                  return (
                    <button key={bt.id} onClick={() => onConfigChange("bodyTypeId", bt.id)} style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                      padding: "14px 8px 10px", borderRadius: 12, cursor: "pointer",
                      border: `2px solid ${sel ? "#F59E0B" : "#0C0C1E"}`,
                      background: sel ? "#1A0D00" : "#07070D",
                      boxShadow: sel ? "0 0 22px #F59E0B22" : "none",
                      fontFamily: "inherit", transition: "all .15s",
                    }}>
                      <div style={{ fontSize: 48, lineHeight: 1, filter: sel ? "drop-shadow(0 0 8px #F59E0B88)" : "opacity(.55)", transition: "filter .15s" }}>
                        {bt.emoji}
                      </div>
                      <div style={{ fontSize: 7, color: sel ? "#F59E0B" : "#7766AA", textAlign: "center", lineHeight: 1.8, fontFamily: "inherit" }}>{bt.label}</div>
                      <div style={{ fontSize: 5, color: sel ? "#7C5A20" : "#1A1030", textAlign: "center", lineHeight: 1.5 }}>{bt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SKIN */}
          {tab === "skin" && (
            <div>
              <SecHead title="SKIN TONE" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {LIB_SKIN_TONES.map(s => {
                  const sel = config.skinId === s.id;
                  return (
                    <div key={s.id} onClick={() => onConfigChange("skinId", s.id)} style={{
                      width: 58, height: 58, borderRadius: 10, cursor: "pointer", position: "relative",
                      background: `linear-gradient(145deg,${s.b},${s.d})`,
                      border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                      boxShadow: sel ? "0 0 16px #F59E0B66" : "none",
                      transition: "all .12s",
                    }}>
                      <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 4, color: "#fff", textShadow: "0 1px 3px #000", fontFamily: "inherit" }}>{s.label}</span>
                      {sel && <div style={{ position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#000", fontWeight: 900 }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HAIR */}
          {tab === "hair" && (
            <div>
              <SecHead title="HAIR COLOR" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {LIB_HAIR_COLORS.map(h => {
                  const sel = config.hairId === h.id;
                  return (
                    <div key={h.id} onClick={() => onConfigChange("hairId", h.id)} style={{
                      width: 58, height: 58, borderRadius: 10, cursor: "pointer", position: "relative",
                      background: `linear-gradient(145deg,${h.h},${h.c})`,
                      border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                      boxShadow: sel ? "0 0 16px #F59E0B66" : "none",
                      transition: "all .12s",
                    }}>
                      <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 4, color: "#fff", textShadow: "0 1px 3px #000", fontFamily: "inherit" }}>{h.label}</span>
                      {sel && <div style={{ position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#000", fontWeight: 900 }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FACE */}
          {tab === "face" && (
            <div>
              <SecHead title="FACE DETAILS" />
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 6, color: "#4C1D95", marginBottom: 10, letterSpacing: 1 }}>👁 EYE COLOR</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {LIB_EYE_COLORS.map(e => {
                    const sel = config.eyeColorId === e.id;
                    return (
                      <div key={e.id} title={e.label} onClick={() => onConfigChange("eyeColorId", e.id)} style={{
                        width: 42, height: 42, borderRadius: "50%", cursor: "pointer",
                        background: `radial-gradient(circle at 35% 35%,${e.iris}CC,${e.iris})`,
                        border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                        boxShadow: sel ? `0 0 14px ${e.iris}88` : "none",
                        transition: "all .12s",
                      }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 5, color: "#3A2060", marginTop: 6 }}>{LIB_EYE_COLORS.find(e => e.id === config.eyeColorId)?.label ?? "Blue"}</div>
              </div>
              <div>
                <div style={{ fontSize: 6, color: "#4C1D95", marginBottom: 10, letterSpacing: 1 }}>💋 LIP COLOR</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {LIB_LIP_COLORS.map(l => {
                    const sel = config.lipColorId === l.id;
                    return (
                      <div key={l.id} title={l.label} onClick={() => onConfigChange("lipColorId", l.id)} style={{
                        width: 42, height: 42, borderRadius: "50%", cursor: "pointer",
                        background: `radial-gradient(circle at 35% 35%,${l.color}CC,${l.color})`,
                        border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                        boxShadow: sel ? `0 0 14px ${l.color}88` : "none",
                        transition: "all .12s",
                      }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 5, color: "#3A2060", marginTop: 6 }}>{LIB_LIP_COLORS.find(l => l.id === config.lipColorId)?.label ?? "Natural"}</div>
              </div>
            </div>
          )}

          {/* OUTFIT */}
          {tab === "outfit" && (
            <div>
              <SecHead title="OUTFIT" sub={female ? "♀ Fitted for your body type" : undefined} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visOuts.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.armorId === o.id}
                    onClick={() => onConfigChange("armorId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.armorId === o.id)}
                    <span style={{ fontSize: 6, color: config.armorId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.hint && <span style={{ fontSize: 5, color: config.armorId === o.id ? "#7C5A20" : "#1A1030", textAlign: "center", lineHeight: 1.4 }}>{o.hint}</span>}
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* HEADGEAR */}
          {tab === "headgear" && (
            <div>
              <SecHead title="HEADGEAR" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visHeads.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.headId === o.id}
                    onClick={() => onConfigChange("headId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.headId === o.id)}
                    <span style={{ fontSize: 6, color: config.headId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* WEAPON */}
          {tab === "weapon" && (
            <div>
              <SecHead title="WEAPON" sub="✦✦ marks dual-wield weapons" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visWeapons.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.weaponId === o.id}
                    onClick={() => onConfigChange("weaponId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.weaponId === o.id)}
                    <span style={{ fontSize: 6, color: config.weaponId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.hint && <span style={{ fontSize: 5, color: "#7C3000", background: "#1A0800", padding: "2px 5px", borderRadius: 4 }}>{o.hint}</span>}
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* PET */}
          {tab === "pet" && (
            <div>
              <SecHead title="PET / MOUNT" sub="Companions walk beside you · Mounts carry you" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visPets.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.petId === o.id}
                    onClick={() => onConfigChange("petId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.petId === o.id)}
                    <span style={{ fontSize: 6, color: config.petId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.size === "mount" && (
                      <span style={{ fontSize: 5, color: "#A16207", background: "#1C1000", padding: "2px 5px", borderRadius: 4, border: "1px solid #3A2000" }}>MOUNT</span>
                    )}
                    {o.size === "companion" && (
                      <span style={{ fontSize: 5, color: "#047857", background: "#001A0E", padding: "2px 5px", borderRadius: 4, border: "1px solid #003A1A" }}>COMPANION</span>
                    )}
                  </Opt>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes hf-float   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes hf-pulse   { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes hf-runespin { to { transform: rotate(360deg); } }
        @keyframes hf-aurora1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,-30px)} }
        @keyframes hf-aurora2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-50px,40px)} }
        ::-webkit-scrollbar { width:3px }
        ::-webkit-scrollbar-thumb { background:#0E0E1E;border-radius:2px }
      `}</style>
    </div>
  );
}