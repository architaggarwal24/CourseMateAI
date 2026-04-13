/**
 * pixelArt.ts — Complete pixel art sprite library for CourseMateAI
 *
 * Character is 20×48px — proper human proportions:
 *   Head:  rows  0–13  (14px)
 *   Neck:  row  14     ( 1px)
 *   Torso: rows 15–27  (13px)  ← outfit shape differences live here + arms built in
 *   Hips:  rows 28–30  ( 3px)
 *   Legs:  rows 31–44  (14px)  ← long legs for human look
 *   Feet:  rows 45–47  ( 3px)
 *
 * Canvas: 64×80 logical px. Character sits at CHAR_X=22, CHAR_Y=2.
 * Small pets: 14×14, to the LEFT (x=0) at ground level (y=58).
 * Mount pets: 48×22, below character (y=58), character y shifts to y=36.
 * Weapons: 8×24, RIGHT side (x=44) or LEFT (x=10) for dual-wield.
 */

export type Pixel  = string | null;
export type Sprite = Pixel[][];

/** Convert string rows + palette → 2-D colour array */
export function spr(rows: string[], p: Record<string,string>): Sprite {
  return rows.map(row => Array.from(row).map(ch => (ch in p ? p[ch] : null)));
}

/** Blit sprite onto canvas at logical pixel offset */
export function blit(ctx: CanvasRenderingContext2D, px: Sprite, ox: number, oy: number): void {
  px.forEach((row, y) => row.forEach((col, x) => {
    if (col) { ctx.fillStyle = col; ctx.fillRect(ox+x, oy+y, 1, 1); }
  }));
}

/** Mirror sprite horizontally (for left-hand weapon) */
export function mirrorX(s: Sprite): Sprite { return s.map(row => [...row].reverse()); }

export const SKIN_TONES = [
  { id:"ivory", label:"Ivory", b:"#FFDBB4", m:"#EDB97A", d:"#C8833E", o:"#7A3A10" },
  { id:"tan",   label:"Tan",   b:"#D4956A", m:"#B87040", d:"#8C4A1E", o:"#4A2008" },
  { id:"brown", label:"Brown", b:"#A0693A", m:"#7A4A1E", d:"#5C3010", o:"#321404" },
  { id:"deep",  label:"Deep",  b:"#614126", m:"#422A12", d:"#2C1606", o:"#160802" },
] as const;

export const HAIR_COLORS = [
  { id:"black",  label:"Black",  c:"#111111", h:"#2A2A2A" },
  { id:"auburn", label:"Auburn", c:"#5C2000", h:"#883000" },
  { id:"honey",  label:"Honey",  c:"#C87820", h:"#E8A040" },
  { id:"flaxen", label:"Flaxen", c:"#E8D060", h:"#F5E888" },
  { id:"silver", label:"Silver", c:"#888888", h:"#BBBBBB" },
  { id:"cobalt", label:"Cobalt", c:"#1A3A8C", h:"#2A5ACC" },
  { id:"violet", label:"Violet", c:"#5A1A8C", h:"#8A2ACC" },
  { id:"scarlet",label:"Scarlet",c:"#8C1A10", h:"#CC2A18" },
] as const;

export type SkinTone  = (typeof SKIN_TONES)[number];
export type HairColor = (typeof HAIR_COLORS)[number];

export function buildHead(skin: SkinTone, hair: HairColor, eyeColor?: {iris:string;pupil:string}, lipColor?: {color:string}): Sprite {
  const S=skin.b, s=skin.m, d=skin.d, O=skin.o;
  const H=hair.c, HL=hair.h;
  const EW="#F2F5FF";  // eye white/sclera
  const EI=eyeColor?.iris   ?? "#2255DD";  // iris — customisable
  const EP=eyeColor?.pupil  ?? "#060810";  // pupil
  const EL="#101020";  // eyelash row
  const ML=lipColor?.color  ?? "#C02010";  // lip line — customisable
  const MH="#FF9988";  // lower lip highlight
  const NS=skin.d;     // nose shadow (same as skin deep)

  return spr([
    "____HHHHHHHHHHH_____",
    "___HHhHHHHHHHhHH____",
    "__HOoSSSSSSSSSSSoH__",
    "__HOoSSSSSSSSSSSoH__",
    "__HOoSEESSSSEESoH___",
    "__HOoWIPISsIPIWoH___",
    "__HOoSSSSSSSSSSSoH__",
    "__HOoSSSSSSSSSSSoH__",
    "___OoSSSNnNSSSoOO___",
    "____OSSSMMSSSoOO____",
    "____OSSSMRMSSoOO____",
    "____OSSSSSSSSoO_____",
    "_____OSSSSSSSoO_____",
    "________SSSS________",
  ], {
    H, h:HL,             // hair base / highlight
    O, o:d,              // hard outline / deep shadow
    S, s,                // skin base / mid
    E:EL,                // eyelash/brow shadow
    W:EW, I:EI, P:EP,   // eye white / iris / pupil
    N:NS, n:O,           // nose shadow / nostril
    M:ML, R:MH,          // lip line / lip highlight
  });
}

/** @deprecated Use buildHead instead */
export const buildBase = buildHead;

export function buildArmDown(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "SsS","SsS","SsS",  // upper arm — side shadow
    "SsS","SsS",        // forearm
    "SdS","SdS",        // forearm shadow (deeper toward wrist)
    "dSd","ddd","ddd",  // hand / knuckles
  ], { S, s, d });
}
export function buildArmUp(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "ddd","ddd","dSd",  // hand raised — tips up
    "SdS","SdS",        // forearm upper
    "SsS","SsS",        // forearm lower
    "SsS","SsS","SsS",  // upper arm
  ], { S, s, d });
}

function bodySprite(rows14to47: string[], p: Record<string,string>): Sprite {
  const full: Sprite = Array.from({length:48}, ()=>Array(20).fill(null));
  const compiled = spr(rows14to47.map(r=>r.padEnd(20,'_').slice(0,20)), p);
  compiled.forEach((row,i) => { if(i < 34) full[14+i] = row; });
  return full;
}

/* ── CASUAL T-SHIRT + JEANS ──────────────────────────────────────────────────
   T-shirt: collarbone exposed, short sleeves that end at elbow.
   Jeans: fitted with visible seam, cuffs, white sneakers.          */
function makeShirtBasic(): Sprite {
  return bodySprite([
    "____SWWWWWWWWWWS____", // 14: skin sides, white collar
    "___SSWWWWWWWWWWSS___", // 15: short sleeve shoulders (SS=skin, WW=shirt)
    "__SSSSWWWwWWWWSSSSS_", // 16: sleeve ends (skin wider), chest highlight w
    "__SSSSPPWWWWWPSSSSS_", // 17: pocket P on chest, skin arms still visible
    "____SSWWWWWWWWSS____", // 18: shirt body (arms = skin S outside cols 4-15)
    "____SSWWWWWWWWSS____", // 19
    "____SSWWWWWWWWSS____", // 20
    "____SSWWWWWWWWSS____", // 21: shirt hem
    "____SSbBBBBBBbSS____", // 22: belt
    "____JJJJJJJJJJJJ___", // 23: jean waistband (connected)
    "____JJJJ____JJJJ____", // 24: thigh split
    "____JJjJ____JJjJ____", // 25: denim seam
    "____JJJJ____JJJJ____", // 26
    "____JJjJ____JJjJ____", // 27
    "____JJJJ____JJJJ____", // 28  ← past hips, still body rows
    "____JJjJ____JJjJ____", // 29
    "____JJJJ____JJJJ____", // 30
    "____JJjJ____JJjJ____", // 31
    "____JJJJ____JJJJ____", // 32
    "____JJjJ____JJjJ____", // 33
  ], {S:skin_b(), s:skin_m(), b:"#554400", B:"#776600",
      W:"#EEEEEE", w:"#CCCCDD", P:"#DDDDBB", J:"#3355AA", j:"#5577CC"});
}

function skin_b(){ return "#FFDBB4"; }
function skin_m(){ return "#EDB97A"; }

/** Make a full 20×48 body sprite that includes skin-colored arms */
export function armorSprite(
  rows: string[],  // 34 rows (14-47), 20 chars each. Use S=skin, s=skin_mid
  p: Record<string,string>,
  skin: SkinTone
): Sprite {
  const augP = { ...p, S: skin.b, s: skin.m };
  const full: Sprite = Array.from({length:48}, ()=>Array(20).fill(null));
  const compiled = spr(rows.map(r=>r.padEnd(20,'_').slice(0,20)), augP);
  compiled.forEach((row,i) => { if(i < 34) full[14+i] = row; });
  return full;
}

function buildTShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____SWWwWWWwWWS_____", // neck — collar with highlight w
    /* 15 */ "SSSsWWWwWWWWwWWSSSs_", // shoulders: skin arms + shirt highlights
    /* 16 */ "SSssWWwWWWWWWwWSSSs_", // short sleeve ends
    /* 17 */ "SSssPWWwWWWWwWWSSss_", // pocket P, chest highlight w
    /* 18 */ "____WWWwWWWWwWW_____", // shirt body (arms gone)
    /* 19 */ "____WWwWWWWWwWW_____",
    /* 20 */ "____WWWWWWWWwWW_____",
    /* 21 */ "____wWWWWWWWwWW_____", // shirt hem darker edge
    /* 22 */ "____bBBBBBBBBb______", // leather belt
    /* 23 */ "____JJJJjJJJJJJJ____", // jeans — denim highlight j
    /* 24 */ "____JJJj____JJjJ____", // thigh split
    /* 25 */ "____JjJJ____JJjJ____", // denim seam
    /* 26 */ "____JJJj____JJjJ____",
    /* 27 */ "____JjJJ____JJjJ____",
    /* 28 */ "____JJJj____JJjJ____",
    /* 29 */ "____JjJJ____JJjJ____",
    /* 30 */ "____JJJj____JJjJ____",
    /* 31 */ "____JjJJ____JJjJ____",
    /* 32 */ "____JJJj____JJjJ____",
    /* 33 */ "____JjJJ____JJjJ____",
    /* 34 */ "____ssss____ssss____", // ankle skin
    /* 35 */ "___NNNNn____NNNNn___", // sneaker body
    /* 36 */ "___NnNNN____NnNNN___", // swoosh highlight
    /* 37 */ "___nNNNNN___nNNNNN__", // thick sole
  ], {W:"#E8EEF8",w:"#C4CAD8",P:"#D0D4C0",b:"#3A2800",B:"#604400",
      J:"#2A4A8C",j:"#4A72B8",N:"#F0F0FF",n:"#9090BB"}, skin);
}

function buildBareBasic(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____SUUUUUUUUUUS____", // neck — skin sides, plain undershirt
    /* 15 */ "SSSsUUUUUUUUUUUSSSSs", // no sleeves — skin arms visible full length
    /* 16 */ "SSssUUUUUUUUUUUSSSs_", // skin arms
    /* 17 */ "SSssUUUUUUUUUUUSSSs_",
    /* 18 */ "____UUUUUUUUUUUs____", // undershirt body
    /* 19 */ "____UUUUUUUUUUUs____",
    /* 20 */ "____UUUUUUUUUUUs____",
    /* 21 */ "____UUUuUUUUuUUU____", // undershirt hem
    /* 22 */ "____HHHHHHHHHHHH____", // waistband
    /* 23 */ "____QQQQQQQQQQQQQ___", // plain shorts
    /* 24 */ "____QQQQ____QQQQ____",
    /* 25 */ "____QQQQ____QQQQ____",
    /* 26 */ "____QQQQ____QQQQ____",
    /* 27 */ "____QQQQ____QQQQ____",
    /* 28 */ "____QQQQ____QQQQ____", // shorts hem
    /* 29 */ "____ssss____ssss____", // skin calves
    /* 30 */ "____SSSS____SSSS____",
    /* 31 */ "____ssss____ssss____",
    /* 32 */ "____SSSS____SSSS____",
    /* 33 */ "____ssss____ssss____",
    /* 34 */ "____ssss____ssss____", // ankle
    /* 35 */ "___FFSFF____FFSFF___", // sandal strap F=tan, S=darker
    /* 36 */ "___FFFFF____FFFFF___",
    /* 37 */ "___FFFFFFF__FFFFFFF_", // sandal sole
  ], {U:"#F0EDE8",u:"#D8D4CC",H:"#444444",Q:"#666677",F:"#C8A070",S:"#A07040"}, skin);
}

function buildHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "___HHHHHHHHHHHHH____", // hood collar inner
    /* 15 */ "HHHHHHHHHHHHHHHHHHH_", // WIDE shoulders (hood rim full width 19px)
    /* 16 */ "HHHhGGGGGGGGGGGhHHH_", // sleeve top (H=hood,h=rim shadow,G=hoodie)
    /* 17 */ "HHHhGGZZGGGGGZZGhHHH".slice(0,20), // zipper Z visible
    /* 18 */ "GGGgGGZZGGGGGZZGgGGG".slice(0,20), // sleeve mid, zipper continues
    /* 19 */ "GGGgGGGGGGGGGGGGgGGG".slice(0,20), // pocket area starts
    /* 20 */ "GGGgGGPPPPPPPPGGgGGG".slice(0,20), // kangaroo pocket P (bump shape)
    /* 21 */ "GGGgGGPpppppPPGGgGGG".slice(0,20), // pocket interior p
    /* 22 */ "GGGgGGPPPPPPPPGGgGGG".slice(0,20), // pocket bottom
    /* 23 */ "CCCcCCCCCCCCCCCCcCCC".slice(0,20), // cuff ring C on sleeves
    /* 24 */ "____DDDDDDDDDDDD____", // dark jeans (sleeves gone)
    /* 25 */ "____DDdD____DDdD____",
    /* 26 */ "____DDDD____DDDD____",
    /* 27 */ "____DDdD____DDdD____",
    /* 28 */ "____DDDD____DDDD____",
    /* 29 */ "____DDdD____DDdD____",
    /* 30 */ "____DDDD____DDDD____",
    /* 31 */ "____DDdD____DDdD____",
    /* 32 */ "____DDDD____DDDD____",
    /* 33 */ "____DDdD____DDdD____",
    /* 34 */ "____WWWW____WWWW____", // white shoe
    /* 35 */ "___WWWWWW___WWWWWW__", // shoe (wider at toe)
    /* 36 */ "___WWWwwW___WWWwwW__", // sole stripe
    /* 37 */ "___WWWWWW___WWWWWW__", // sole
  ], {H:"#AAAAAA",h:"#888888",G:"#777788",g:"#555566",Z:"#222233",
      P:"#888899",p:"#666677",C:"#CCCCDD",c:"#9999AA",
      D:"#222233",d:"#334455",W:"#DDDDEE",w:"#AABBCC"}, skin);
}

function buildRobe(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____RRRRRRRRRRRR____", // high collar
    /* 15 */ "GGRRRRRRRRRRRRRRRGG_", // wide shoulders + gold trim corners
    /* 16 */ "GRRRRRRRrRRRRRRRRGR_", // sleeve top (wide!), fold detail r
    /* 17 */ "GRRRRRRRrRRRRRRRRGR_", // sleeve
    /* 18 */ "_GRRRRRGcGRRRRGRGR__", // clasp c, gold trim
    /* 19 */ "_GRRRRRRRRRRRRRRGR__", // torso
    /* 20 */ "_GRRRRRRRRRRRRRRGR__", // torso
    /* 21 */ "__GRRRRRRRRRRRRRGR__", // sleeve narrows
    /* 22 */ "___GRRRRRRRRRRRGRR__", // sleeve narrows more
    /* 23 */ "___GRRRRRRRRRRRGRR__", // wrist cuff
    /* 24 */ "____RRRRRRRRRRRR____", // SKIRT starts full width (no leg gap!)
    /* 25 */ "____RRRrRRRRRRrRR___", // skirt fold
    /* 26 */ "___RRRRRRRRRRRRRR___",
    /* 27 */ "___RRRrRRRRRRrRRR___",
    /* 28 */ "__RRRRRRRRRRRRRRRRR_",  // skirt widens
    /* 29 */ "__RRRrRRRRRRRRrRRRR_",
    /* 30 */ "_GRRRRRRRRRRRRRRRRG_", // gold border
    /* 31 */ "_GRRRrRRRRRRRRrRRG__",
    /* 32 */ "_GRRRRRRRRRRRRRRRG__", // skirt hem
    /* 33 */ "_GGGRRRRRRRRRRRGGGr_", // gold hem band
    /* 34 */ "__GGGGGGRRRGGGGGGrr_", // gold hem bottom
    /* 35 */ "____rRRR____rRRR____", // tiny feet peek under robe
    /* 36 */ "____rRrr____rRrr____",
    /* 37 */ "________________",     // floor
  ], {R:"#2244AA",r:"#1133CC",G:"#CCAA00",c:"#FFDD44"}, skin);
}

function buildJacket(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "_____JJJJJJJJJJ_____", // collar
    /* 15 */ "JJJJJJJJJJJJJJJJJJJ", // full width leather shoulders (19px)
    /* 16 */ "JJJJJLLJJJJJJJjJJJJJ".slice(0,20), // left lapel L starts
    /* 17 */ "JJJJJLLLJJJJJjJJJJJJ".slice(0,20), // lapel diagonal
    /* 18 */ "JJJJJILLJJJIIJjJJJJJ".slice(0,20), // inner shirt I visible
    /* 19 */ "JJJJJIILJJJIIJjJJJJJ".slice(0,20), // V narrows
    /* 20 */ "JJJJJIIILLIIIJjJJJJJ".slice(0,20), // V bottom
    /* 21 */ "JJJJJIIIIIIIIJjJJJJJ".slice(0,20), // inner shirt closes
    /* 22 */ "JJJJJcBBBBBBBcJjJJJJJ".slice(0,20),// belt c=clasp B=buckle
    /* 23 */ "____PPPPPPPPPPPP____", // dark pants start
    /* 24 */ "____PPPpP___PPpP____",
    /* 25 */ "____PPPP____PPPP____",
    /* 26 */ "____PPPpP___PPpP____",
    /* 27 */ "____PPPP____PPPP____",
    /* 28 */ "____PPPpP___PPpP____",
    /* 29 */ "____PPPP____PPPP____",
    /* 30 */ "____PPPpP___PPpP____",
    /* 31 */ "____PPPP____PPPP____",
    /* 32 */ "____PPPpP___PPpP____",
    /* 33 */ "____PPPP____PPPP____",
    /* 34 */ "___BBBBB____BBBBB___", // combat boot top
    /* 35 */ "___BBBBB____BBBBB___",
    /* 36 */ "___BBBbb____BBBbb___", // boot crease
    /* 37 */ "___BBBBBB___BBBBBB__", // thick sole
  ], {J:"#1A1A2E",j:"#2A2A44",L:"#CCBBAA",I:"#DDCCBB",c:"#AAAAAA",
      B:"#FFCC00",P:"#111122",p:"#223344",b:"#0A0A14"}, skin);
}

function buildPlate(skin: SkinTone, A:string, AL:string, AD:string, G:string): Sprite {
  return armorSprite([
    /* 14 */ "____AAAAAAAAAAAAA___", // gorget
    /* 15 */ "AAAAAAAAAAAAAAAAAAAA", // FULL 20px pauldrons - widest point
    /* 16 */ "APAAAAAAAAAAAAAAApA_", // pauldron spike P, highlight L
    /* 17 */ "AAPAAAAAAAAAAAAAPA__", // spike taper
    /* 18 */ "__AAAGGGGGGGGGAAA___", // breastplate with gold ridge G
    /* 19 */ "__AAAGGGGGGGGGAAA___",
    /* 20 */ "__AAAAAAAAAAAAAAAA__", // lower breastplate
    /* 21 */ "__AAAAAAAAAAAAAAAAA_",
    /* 22 */ "___GGGAAAAAAAAGGG___", // tasset waist gold trim
    /* 23 */ "___TTTTTTTTTTTTT____", // tasset plates T
    /* 24 */ "____AAAAD___AAAA____", // greave top (D=darker shadow)
    /* 25 */ "____AAAA____AAAA____",
    /* 26 */ "____AAAAD___AAAA____", // knee guard
    /* 27 */ "____AAAA____AAAA____",
    /* 28 */ "____AAAAD___AAAA____",
    /* 29 */ "____AAAA____AAAA____",
    /* 30 */ "____AAAAD___AAAA____",
    /* 31 */ "____AAAA____AAAA____",
    /* 32 */ "____AAAAD___AAAA____",
    /* 33 */ "____AAAA____AAAA____",
    /* 34 */ "___AAGGG____AAGGG___", // sabaton
    /* 35 */ "___AGGGG____AGGGG___",
    /* 36 */ "___AGGGG____AGGGG___",
    /* 37 */ "___AGGGGG___AGGGGG__", // wide sabaton tip
  ], {A,L:AL,D:AD,G,P:AD,T:A}, skin);
}

function buildWizard(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "_____PPPPPPPPPPP____", // collar
    /* 15 */ "PPPPPPPPPPPPPPPPPPP_", // full shoulder
    /* 16 */ "PPPPPPPPsPPPPPPPPPP_", // chest
    /* 17 */ "PPPPPPPPsPPPPPPPPPP_", // rune center s=sash
    /* 18 */ "PPPPPPsPsPPPsPPPPPP_", // star shape begins *
    /* 19 */ "PPPPPPssRssssssPPPPP".slice(0,20), // runic emblem R in center
    /* 20 */ "PPPPPPsPsPPPsPPPPPP_", // star
    /* 21 */ "PPPPPPPPsPPPPPPPPPP_",
    /* 22 */ "PPPPPPPPPPPPPPPPPPP_", // sleeve base wide
    /* 23 */ "PPPPssssssssssssPPPP".slice(0,20), // sash belt
    /* 24 */ "_PPPPPPPPPPPPPPPPP__", // SKIRT begins
    /* 25 */ "_PPrPPPPPPPPPPPrPP__", // rune marks r
    /* 26 */ "__PPPPPPPPPPPPPPPP__",
    /* 27 */ "__PPrPPPPPPPPPrPP___",
    /* 28 */ "__PPPPPPPPPPPPPPPPP_", // skirt widens
    /* 29 */ "__PPrPPPPPPPPPrPPP__",
    /* 30 */ "___PPPPPPPPPPPPPPr__",
    /* 31 */ "___PPrPPPPPPPrPPPP__",
    /* 32 */ "___PPPPPPPPPPPPPPP__", // hem
    /* 33 */ "___PPPPPPPPPPPPPrr__",
    /* 34 */ "____rPPPPPPPPPPrP___",
    /* 35 */ "_____QQQQ____QQQQ___", // pointed shoes Q
    /* 36 */ "_____QQqqqq__QQqqq__", // shoe detail
    /* 37 */ "______qqq____qqq____", // shoe tip
  ], {P:"#5511AA",p:"#3300AA",s:"#FFDD88",R:"#FFDD44",r:"#FF88FF",
      Q:"#220044",q:"#440088"}, skin);
}

function buildDragonScale(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____DDDDDDDDDDDD____", // collar
    /* 15 */ "_SSDDDDDDDDDDDDDSS__", // spike bases
    /* 16 */ "SSDDDDDDDDDDDDDDDDSS".slice(0,20), // full spike row
    /* 17 */ "_SSDDDDDDDDDDDDDSS__", // spike taper
    /* 18 */ "__DDDsDDDsDDDsDDD___", // scale pattern
    /* 19 */ "__DsDDsDDDsDDDsDDD__",
    /* 20 */ "__DDDsDDDsDDDsDDD___",
    /* 21 */ "__DsDDsDDDsDDDsDDD__",
    /* 22 */ "__DDDsDDDsDDDsDDD___", // scale
    /* 23 */ "__DsDDcDDDcDDDsDDD__", // clasp/buckle c
    /* 24 */ "____DDDD____DDDD____", // legs - scale armored
    /* 25 */ "____DsDsD___DsDsD___",
    /* 26 */ "____DDDD____DDDD____",
    /* 27 */ "____DsDsD___DsDsD___",
    /* 28 */ "____DDDD____DDDD____",
    /* 29 */ "____DsDsD___DsDsD___",
    /* 30 */ "____DDDD____DDDD____",
    /* 31 */ "____DsDsD___DsDsD___",
    /* 32 */ "____DDDD____DDDD____",
    /* 33 */ "____DsDsD___DsDsD___",
    /* 34 */ "___CCCCC____CCCCC___", // claw boot
    /* 35 */ "___CCcCC____CCcCC___", // claw
    /* 36 */ "___cCCCC____cCCCC___", // claw base
    /* 37 */ "___CCCCCC___CCCCCC__", // wide claw base
  ], {D:"#1A3A20",d:"#0A2010",s:"#2A5A30",S:"#FF6600",c:"#334422",C:"#111A10"}, skin);
}

export type ArmorFactory = (skin: SkinTone) => Sprite;

function buildLegendMantle(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____cCGGGGGGGGCc____",
    /* 15 */ "GGCCCCCCCCCCCCCCCCGg",
    /* 16 */ "GCccCCCCCCCCCCCCccCG",
    /* 17 */ "GCCCCGgGgGgGGCCCCCCG",
    /* 18 */ "GCCCCCCGGGGCCCCCCCCG",
    /* 19 */ "GCCCCCGGgGGGCCCCCCCG",
    /* 20 */ "GCCCCCCGGGGCCCCCCCCG",
    /* 21 */ "GCCcCCCCCCCCCCcCCCCG",
    /* 22 */ "GCCCCCCCCCCCCCCCCCCg",
    /* 23 */ "GCCcCCCCCCCCCcCCCCCG",
    /* 24 */ "_GCCCCCCCCCCCCCCCGg_",
    /* 25 */ "_GCCcCCCCCCCCcCCCGg_",
    /* 26 */ "_GCCCCCCCCCCCCCCCGg_",
    /* 27 */ "__GCCcCCCCCCcCCCGg__",
    /* 28 */ "__GCCCCCCCCCCCCCGg__",
    /* 29 */ "__GCCcCCCCCCcCCCGg__",
    /* 30 */ "___GCCCCCCCCCCCGg___",
    /* 31 */ "___GCCcCCCCCcCCGg___",
    /* 32 */ "___GGGGGGGGGGGGGg___",
    /* 33 */ "____LLLLLLLLLLLl____",
    /* 34 */ "______BBBBBBBBb_____",
    /* 35 */ "______BBBbBBBbb_____",
    /* 36 */ "______bBBBBBBbb_____",
    /* 37 */ "_____bbBBBBBBbb_____",
  ], {C:"#2A1060",c:"#5030A0",G:"#FFD700",g:"#AA8800",L:"#EED890",B:"#1A1030",b:"#0D0820"}, skin);
}

// ── GI OUTFITS — IK+ / fighting-game style ────────────────────────────────────
// White Gi: crossed lapels, black belt, wide white pants, bare feet
// Red Gi:   bare chest, pink sash, wide red pants, bare feet
// Blue Gi:  bare chest, yellow belt, wide blue pants, bare feet
//
// These are the DEFAULT (mid-build) body-type versions used as fallbacks.
// Body-type-specific overrides live in PixelAvatar.tsx's _BODY_FACTORIES.
// ---------------------------------------------------------------------------

function buildGiWhite(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 V-collar  */ "____SWWwWWWWwWWWS___",
    /* 15 shoulders */ "SSSsWWWWWWWWWWWSSSs_",
    /* 16 lapels    */ "SSsWWWWLLLLWWWWSSs__",
    /* 17           */ "SSsWWWLLwwLLLWWSSs__",
    /* 18 cross     */ "____WWLLwwWWLLWW____",
    /* 19 chest     */ "____WWWwWWWWWWWW____",
    /* 20           */ "____WWWWWWWWwWWW____",
    /* 21 hem       */ "____wWWWWWWWwWWW____",
    /* 22 black belt*/ "____bBBBBBBBBBBb____",
    /* 23 gi pants  */ "___JJJJJJJJJJJJJJ__",
    /* 24           */ "___JJJJJj__jJJJJJ__",
    /* 25           */ "___JjJJJJ__JJJJjJ__",
    /* 26           */ "___JJJJJj__jJJJJJ__",
    /* 27           */ "___JjJJJJ__JJJJjJ__",
    /* 28           */ "____JJJJj__jJJJJ____",
    /* 29           */ "____JjJJJ__JJJjJ____",
    /* 30           */ "____JJJJj__jJJJJ____",
    /* 31           */ "____JjJJJ__JJJjJ____",
    /* 32           */ "____JJJJj__jJJJJ____",
    /* 33           */ "____JjJJJ__JJJjJ____",
    /* 34 bare ankle*/ "____ssss___ssss_____",
    /* 35 bare foot */ "____SSSS___SSSS_____",
    /* 36           */ "____SSSS___SSSS_____",
    /* 37 sole shad */ "___sSSSss__sSSSss___",
  ], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
       J:"#EBEBEB",j:"#C8C8C4" }, skin);
}

function buildGiRed(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 bare neck */ "____SSSSSSSSSSss____",
    /* 15 bare top  */ "SSSSSSSSSSSSSSSSSSs_",
    /* 16           */ "SSssSSSSSSSSSSSSss__",
    /* 17           */ "SSssSSSSSSSSSSSSss__",
    /* 18           */ "____SSSSSSSSSSss____",
    /* 19           */ "____SSSSSSSSSss_____",
    /* 20           */ "____SSSSSSSSss______",
    /* 21           */ "____SSSSSSSss_______",
    /* 22 pink sash */ "____PPPPPPPPPPPP____",
    /* 23 red pants */ "___JJJJJJJJJJJJJJ__",
    /* 24           */ "___JJJJJj__jJJJJJ__",
    /* 25           */ "___JjJJJJ__JJJJjJ__",
    /* 26           */ "___JJJJJj__jJJJJJ__",
    /* 27           */ "___JjJJJJ__JJJJjJ__",
    /* 28           */ "____JJJJj__jJJJJ____",
    /* 29           */ "____JjJJJ__JJJjJ____",
    /* 30           */ "____JJJJj__jJJJJ____",
    /* 31           */ "____JjJJJ__JJJjJ____",
    /* 32           */ "____JJJJj__jJJJJ____",
    /* 33           */ "____JjJJJ__JJJjJ____",
    /* 34 bare ankle*/ "____ssss___ssss_____",
    /* 35 bare foot */ "____SSSS___SSSS_____",
    /* 36           */ "____SSSS___SSSS_____",
    /* 37           */ "___sSSSss__sSSSss___",
  ], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin);
}

function buildGiBlue(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 bare neck */ "____SSSSSSSSSSss____",
    /* 15 bare top  */ "SSSSSSSSSSSSSSSSSSs_",
    /* 16           */ "SSssSSSSSSSSSSSSss__",
    /* 17           */ "SSssSSSSSSSSSSSSss__",
    /* 18           */ "____SSSSSSSSSSss____",
    /* 19           */ "____SSSSSSSSSss_____",
    /* 20           */ "____SSSSSSSSss______",
    /* 21           */ "____SSSSSSSss_______",
    /* 22 yel belt  */ "____bBBBBBBBBBBb____",
    /* 23 blue pants*/ "___JJJJJJJJJJJJJJ__",
    /* 24           */ "___JJJJJj__jJJJJJ__",
    /* 25           */ "___JjJJJJ__JJJJjJ__",
    /* 26           */ "___JJJJJj__jJJJJJ__",
    /* 27           */ "___JjJJJJ__JJJJjJ__",
    /* 28           */ "____JJJJj__jJJJJ____",
    /* 29           */ "____JjJJJ__JJJjJ____",
    /* 30           */ "____JJJJj__jJJJJ____",
    /* 31           */ "____JjJJJ__JJJjJ____",
    /* 32           */ "____JJJJj__jJJJJ____",
    /* 33           */ "____JjJJJ__JJJjJ____",
    /* 34 bare ankle*/ "____ssss___ssss_____",
    /* 35 bare foot */ "____SSSS___SSSS_____",
    /* 36           */ "____SSSS___SSSS_____",
    /* 37           */ "___sSSSss__sSSSss___",
  ], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin);
}

export const ARMOR_FACTORIES: Record<string, ArmorFactory> = {
  armor_bare_basic:    buildBareBasic,
  armor_shirt_basic:   buildTShirt,
  armor_hoodie_gray:   buildHoodie,
  armor_robe_blue:     buildRobe,
  armor_jacket_cool:   buildJacket,
  armor_knight_silver: (sk) => buildPlate(sk,"#9AAABB","#CCDDEE","#667788","#BBBB99"),
  armor_knight_gold:   (sk) => buildPlate(sk,"#BB9922","#EEDD55","#886611","#FFFFFF"),
  armor_wizard_purple: buildWizard,
  armor_dragon_scale:  buildDragonScale,
  armor_legends_mantle: buildLegendMantle,
  armor_gi_white:      buildGiWhite,
  armor_gi_red:        buildGiRed,
  armor_gi_blue:       buildGiBlue,
};

export const ARMOR_SPRITES: Record<string, () => Sprite> = Object.fromEntries(
  Object.entries(ARMOR_FACTORIES).map(([k,f]) => [k, ()=>f(SKIN_TONES[0])])
);

function headSprite(rows: string[], p: Record<string,string>): Sprite {
  const full: Sprite = Array.from({length:48}, ()=>Array(20).fill(null));
  spr(rows.map(r=>r.padEnd(20,'_').slice(0,20)), p).forEach((row,i)=>{
    if(i<4) full[i]=row;  // rows 0-3 only: hair+forehead — never covers eyes
  });
  return full;
}

export const HEADGEAR_SPRITES: Record<string,()=>Sprite> = {

  hat_baseball_red:  ()=>headSprite([
    "____RRRRRRRRRRRR____", // 0: cap crown
    "___RRRrRRRRRRrRRR___", // 1: highlight stripe
    "__RRRRRRRRRRRRRRRR__", // 2: cap body (sits at forehead)
    "BBBBBBBBBBBBBBBBBBBB", // 3: brim band — full width at forehead line
  ],{R:"#CC2222",r:"#FF4444",B:"#111111"}),

  hat_beanie_blue: ()=>headSprite([
    "__BBBBBBBBBBBBBBBB__", // 0: beanie top
    "__BBBbBBBBBBbBBBBB__", // 1: highlight
    "__BBBBBBBBBBBBBBBB__", // 2: body
    "__CCCCCCCCCCCCCCCC__", // 3: ribbed cuff band
  ],{B:"#2244AA",b:"#4466CC",C:"#1133880"}),

  hat_wizard: ()=>headSprite([
    "_________P__________", // 0: tip
    "_______PPPPPPP______", // 1: upper hat
    "_____PPPPSPPPPPP____", // 2: star detail, lower cone
    "___GGGGGGGGGGGGGG___", // 3: wide gold brim at forehead
  ],{P:"#5511AA",S:"#FFDD44",G:"#FFCC00"}),

  hat_crown_bronze:  ()=>makeCrown("#AA7722","#DD9933","#884400","#CC2244","#2244CC"),
  hat_crown_silver:  ()=>makeCrown("#999999","#CCCCCC","#667788","#4499FF","#44CC88"),
  hat_crown_gold:    ()=>makeCrown("#CC9900","#FFDD22","#AA7700","#FF44AA","#44FFAA"),

  hat_headphones: ()=>headSprite([
    "___BBBBBBBBBBBBBBB__", // 0: headband arc
    "__BBbBBBBBBBBBBBbB__", // 1: padded top
    "__BBB___________BBB_", // 2: ear cup top
    "__BBB___________BBB_", // 3: ear cup bottom (sits at forehead level)
  ],{B:"#222222",b:"#555555"}),

  hat_ninja: ()=>headSprite([
    "NNNNNNNNNNNNNNNNNNNN", // 0: full forehead wrap
    "NNNnNNNNNNNNNNnNNNN_", // 1: wrap fold
    "NNNNNNNNNNNNNNNNNNNN", // 2: wrap body
    "NNNnNNNNNNNNNNnNNNN_", // 3: lower wrap edge (stops at forehead)
  ],{N:"#111122",n:"#1A1A33"}),

  hat_samurai: ()=>headSprite([
    "___SSSSSSSSSSSSSS___", // 0: helm dome
    "__SSSsSSSSSSSSSSsS__", // 1: rivets
    "__SSSSSSSSSSSSSSSS__", // 2: lower helm
    "__GGGGGGGGGGGGGGGG__", // 3: gold forehead guard band
  ],{S:"#888899",s:"#AABBCC",G:"#CCAA00"}),

  // ── FIGHTING-GAME HEADBANDS ─────────────────────────────────────────────────
  hat_headband_red: ()=>headSprite([
    "____________________",
    "__RRRRRRRRRRRRRRRR__",
    "__RrRRRRRRRRRRRRrR__",
    "____________________",
  ],{R:"#DD2222",r:"#AA0000"}),

  hat_headband_blue: ()=>headSprite([
    "____________________",
    "__BBBBBBBBBBBBBBBBB_",
    "__BbBBBBBBBBBBBBbB__",
    "____________________",
  ],{B:"#2255DD",b:"#1133AA"}),

  hat_headband_white: ()=>headSprite([
    "____________________",
    "__WWWWWWWWWWWWWWWWW_",
    "__WwWWWWWWWWWWWWwWW_",
    "____________________",
  ],{W:"#F0EEE8",w:"#C8C6C2"}),
};

function makeCrown(M:string,ML:string,D:string,J1:string,J2:string): Sprite {
  return headSprite([
    "_M____M____M____M___", // 0: crown points at hair level
    "_MM__LMM__MMM__MM___", // 1: points widen
    "_MMMMMMMMMMMMMMMM___", // 2: crown band
    "_MJ1MJ2MJ1MJ2MJ1M___", // 3: jewels at forehead level
  ],{M,L:ML,D,"1":J1,"2":J2});
}

function wpn(rows: string[], p: Record<string,string>): Sprite {
  return spr(rows.map(r=>r.padEnd(8,'_').slice(0,8)), p);
}

export const WEAPON_SPRITES: Record<string,()=>Sprite> = {
  weapon_pencil: ()=>wpn([
    "__YYY___","__YYYY__","_YYYYL__","_YYYYYy_","_YYYYYy_","_YYYYYy_",
    "_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYSSYy_","_YYYYSS_",
    "__YYYs__","__YYss__","__SSs___","________","________","________",
    "________","________","________","________","________","________",
  ],{Y:"#FFEE88",y:"#CCAA22",S:"#EEEEEE",s:"#FF8866",L:"#FFFF44"}),

  weapon_ruler: ()=>wpn([
    "_RRRRRRR","RRrRrRrR","RRrRrRrR","RRrRrRrR","_RRRRRRR","_RRRRRRR",
    "_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR",
    "_RRRRRRR","_RRRRRRR","________","________","________","________",
    "________","________","________","________","________","________",
  ],{R:"#EEEECC",r:"#CCAA88"}),

  weapon_sword_bronze:   ()=>makeSword("#AA7722","#CC9933","#776611","#CCAA00","#5C3010"),
  weapon_sword_silver:   ()=>makeSword("#AABBCC","#DDEEFF","#778899","#CCCCAA","#3A2A1A"),
  weapon_sword_excalibur:()=>makeSword("#DDBB00","#FFEE44","#AA8800","#FFFFFF","#4A3020"),
  weapon_staff_wood:     ()=>makeStaff("#7A4A18","#9A6A28","#556622","#779933"),
  weapon_staff_crystal:  ()=>makeStaff("#335588","#4477BB","#2299CC","#44CCEE"),
  weapon_staff_legendary:()=>makeStaff("#551188","#8833CC","#CC4400","#FF8833"),
  weapon_bow:            ()=>makeBow(),
  weapon_hammer:         ()=>makeHammer(),
};

function makeSword(B:string,BL:string,BD:string,G:string,H:string): Sprite {
  return wpn([
    "______BL","_____BLL","____BB__","___BBB__","__BBBBD_","_BBBBBDD",
    "GGG_BBBD","G_G_BBD_","GGG_BD__","____H___","____H___","____H___",
    "____H___","____Hh__","____H___","____H___","________","________",
    "________","________","________","________","________","________",
  ],{B,L:BL,D:BD,G,H,h:"#AA8844"});
}
function makeStaff(S:string,SL:string,G:string,GL:string): Sprite {
  return wpn([
    "___GL___","__GGlGG_","_GGG_GG_","__GGGGG_","___GGG__","____S___",
    "____S___","____Sl__","____S___","____S___","____S___","____Sl__",
    "____S___","____S___","____S___","____Sl__","____S___","____S___",
    "____Sl__","____S___","____S___","____Sl__","____S___","________",
  ],{S,l:SL,G,L:GL});
}
function makeBow(): Sprite {
  return wpn([
    "____BL__","___B__T_","__B___T_","_B____T_","B_____T_","_B____T_",
    "__BL__T_","___B__T_","___B__T_","___BL_T_","___B__T_","__B___T_",
    "_B____T_","B_____T_","_B____T_","__B___T_","___B__T_","____B___",
    "____BL__","________","________","________","________","________",
  ],{B:"#7A4A18",L:"#8B5020",T:"#CCCCAA"});
}
function makeHammer(): Sprite {
  return wpn([
    "________","_HHHHHHHH".slice(0,8),"_HhHHhHH".slice(0,8),"_HHHHHHHH".slice(0,8),
    "_HhHHhHH".slice(0,8),"_HHHHHHHH".slice(0,8),"___SS___","___SS___",
    "___SS___","___SS___","___SS___","___SS___","___SS___","___SS___",
    "___SS___","___SSl__","___SS___","___SS___","________","________",
    "________","________","________","________",
  ],{H:"#888899",h:"#AABBCC",S:"#7A5020",l:"#9A7040"});
}

export const DUAL_WIELD_WEAPONS = new Set([
  "weapon_sword_bronze","weapon_sword_silver","weapon_sword_excalibur"
]);

function sp(rows: string[], p: Record<string,string>): Sprite {
  return spr(rows.map(r=>r.padEnd(14,'_').slice(0,14)), p);
}

export const SMALL_PET_SPRITES: Record<string,()=>Sprite> = {
  pet_cat_orange: ()=>sp([
    "_____oo_______", // ears
    "____oOOo______",
    "___OOWEOo_____", // face: W=white, E=eye
    "___OOmOOO_____", // m=nose
    "___OOOOOOO____", // body
    "__OOOOOOOoT___", // T=tail base
    "__OOoOOOoTTT__", // tail
    "__OOOOOOOTTTT_", // tail curl
    "___OOOOOOTT___",
    "___OOOOO_TT___",
    "____oooo______", // paws
    "____________",
    "____________",
    "____________",
  ],{O:"#DD7733",o:"#BB5511",W:"#EEEECC",E:"#111122",m:"#FF7744",T:"#CC4400"}),

  pet_dog_brown: ()=>sp([
    "__BBB_________", // ears flop left
    "_BBBBB________",
    "_BbBEBb_______", // E=eye
    "_BBmBBBB______", // m=mouth/tongue m
    "_BBBBBBB______",
    "BBBBBBBB______",
    "BBBbBBBBt_____", // t=tongue
    "_BBBBBBBtt____",
    "_BBBB_BB______",
    "_BBBB_BB______",
    "_BBBBoBBBo____", // o=paw
    "____ooo_______",
    "____________",
    "____________",
  ],{B:"#8B5523",b:"#6B3A0F",E:"#111122",m:"#FF8877",t:"#FF5544",o:"#5C3010"}),

  pet_owl: ()=>sp([
    "____BBBB______", // ear tufts
    "___BBBBBB_____",
    "__BBWEBWBb____", // W=white, E=eye
    "__BBBOBBBb____", // O=beak orange
    "__BBBBBBBb____",
    "__BBBBBBBB____",
    "__BBbBBBBb____",
    "___BBBBBBB____",
    "___BBBBBBB____",
    "___bYbYbYb____", // Y=yellow talons
    "____________",
    "____________",
    "____________",
    "____________",
  ],{B:"#8B6030",b:"#5C3010",W:"#FFEECC",E:"#111122",O:"#FF8800",Y:"#FFEE00"}),

  pet_panda: ()=>sp([
    "___BWWWWB_____",
    "__BWWWWWWB____",
    "__BWEWEWBb____",
    "__BWWWWWWB____",
    "__BWWmWWWb____",
    "__BWWWWWWB____",
    "__BBWWWWBB____",
    "___BWWWWBB____",
    "___BBwwBBB____",
    "____BBBBb_____",
    "____________",
    "____________",
    "____________",
    "____________",
  ],{W:"#EEEEEE",B:"#111111",b:"#333333",E:"#111122",m:"#CC6655",w:"#AAAAAA"}),

  pet_fox: ()=>sp([
    "____oo________",
    "___OOOo_______",
    "___OWEOo______",
    "___OmOOo______",
    "___OOOOOO_____",
    "__OOOOOOOO____",
    "__OOoOOOOT____",
    "___OOOOOOTT___",
    "____oooooTTT__",
    "_____ooo__TT__",
    "_______TTT____",
    "____________",
    "____________",
    "____________",
  ],{O:"#DD6611",o:"#AA4400",W:"#EEEECC",E:"#111122",m:"#FF7755",T:"#EEEECC"}),
};

function mt(rows: string[], p: Record<string,string>): Sprite {
  return spr(rows.map(r=>r.padEnd(48,'_').slice(0,48)), p);
}

export const MOUNT_PET_SPRITES: Record<string,()=>Sprite> = {
  pet_dragon_baby: ()=>mt([
    "________________GGGGGG____________________________",
    "_____________LGGGGGGGGl___________________________",
    "___________LGGGGGGGGGGGl__________________________",
    "GGGGL_____GGGGGGGGGGGGGGGl________________________",
    "GGGGGGllGGGGGGGGGGGGGGGGGGGl______________________",
    "_GGGGGGGGGGGGGGGGGGGGGGGGGGGGGl___________________",
    "__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl________________",
    "___GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl______________",
    "____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl_____________",
    "_____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl____________",
    "______GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl___________",
    "_______GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl__________",
    "_OOO____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGl_________",
    "__OOO____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__________",
    "___OO_____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__________",
    "____OOO____OOO____OOO____OOO____OOO____OOO_________",
    "_____OO_____OO_____OO_____OO_____OO_____OO_________",
    "___________________________________________________",
    "___________________________________________________",
    "___________________________________________________",
  ],{G:"#2A9A40",g:"#1A7A28",L:"#55CC66",l:"#88EE88",O:"#FF8800"}),

  pet_phoenix: ()=>mt([
    "__________________RR______________________________",
    "_________________RRRRR____________________________",
    "____________RRRRRRRRRRRRRR________________________",
    "__________RRRRRRRRRRRRRRRRRRRR____________________",
    "________RRRRRLLRRRRRRRRRRRRRLLRRRR________________",
    "_______RRRRRLLRRRRRRRRRRRRRRLLRRRRRR______________",
    "______RRRRRLLRRYYYYRRYYYYRRLLRRRRRRRR_____________",
    "_____RRRRRRLLRYYYYYYYYYYYYYRLLRRRRRRRRR___________",
    "____RRRRRRRRYYYYYYYYYYYYYYYRRRRRRRRRRRRRR_________",
    "___RRRRRRRROYYYYYYYOOYYYYYRRRRRRRRRRRRRRRR________",
    "__RRRRRRRROOOYYYOOOYYYOOORRRRRRRRRRRRRRRRRRR______",
    "_RRRRRRRROOOOOOOOOOOOOOOORRRRRRRRRRRRRRRRRRRRR____",
    "RRRRRRRROOOOOOOOOOOOOOOOORRRRRRRRRRRRRRRRRRRRRRR__",
    "_RRRRRROOOOOOOOOOOOOOOOORRRRRRRRRRRRRRRRRRRRRRR___",
    "__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR____",
    "____RRRR____RRRR____RRRR____RRRR____RRRR_________",
    "_____RRR_____RRR_____RRR_____RRR_____RRR__________",
    "___________________________________________________",
    "___________________________________________________",
    "___________________________________________________",
  ],{R:"#DD2200",r:"#BB1100",L:"#FF5522",Y:"#FFEE00",O:"#FF8800"}),

  pet_unicorn: ()=>mt([
    "_____NNNNN________________________________________",
    "____rNNNNNr_______________________________________",
    "___rrRNNNNrr______________________________________",
    "___rRRRRRRrr______________________________________",
    "__rRRRWWWWWWWWWWWWWWWWWWWW________________________",
    "_rRRRWWwWWWWWWWWWWWWWWWWWWWW_____________________",
    "___RRWWWWWWWWWWWWWWWWWWWWWWWWWW__________________",
    "____RWWWWWWWWWWWWWWWWWWWWWWWWWWWW________________",
    "_____WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW______________",
    "______WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW___________",
    "_______WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW_________",
    "________WWWWWWWWWWWWWWWWWWWWWWWWwWWwWWWWW________",
    "_________WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW______",
    "__________WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW______",
    "___________WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW_______",
    "___________WWW____WWW____WWW____WWW____WWW_________",
    "____________WW____WW_____WW_____WW_____WW__________",
    "___________________________________________________",
    "___________________________________________________",
    "___________________________________________________",
  ],{W:"#EEEEEE",w:"#CCCCCC",R:"#FF99CC",r:"#FF55EE",N:"#FFEEAA"}),

  pet_dragon_ancient: ()=>mt([
    "______________DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD__",
    "_DDDL_________DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl_",
    "DDDDDL_______DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl_",
    "_DDDDDDl____DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl__",
    "__DDDDDDDlDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl___",
    "____DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl____",
    "_____DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl_____",
    "______DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl______",
    "_______DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl_______",
    "________DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl________",
    "_________DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDl_________",
    "__________DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD_________",
    "_________OOO____OOO____OOO____OOO____OOO____________",
    "__________OO_____OO_____OO_____OO_____OO____________",
    "___________________________________________________",
    "___________________________________________________","___________________________________________________",
    "___________________________________________________","___________________________________________________",
    "___________________________________________________",
  ],{D:"#1A4A28",d:"#0A2A10",L:"#2A8A40",l:"#55CC66",O:"#CC4400"}),

  pet_lion_golden: ()=>mt([
    "__LLLL____________________________________________",
    "_LLLLLL___________________________________________",
    "_LLlLLLL__________________________________________",
    "__LLLLLLLLLllll___________________________________",
    "__LlLlLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL___________",
    "_LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_________",
    "_LlLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl________",
    "__LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_______",
    "___LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_______",
    "____LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_______",
    "_____LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_______",
    "______LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLl_______",
    "_______LLlLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL________",
    "________LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL_________",
    "_________LLL____LLL____LLL____LLL____LLL___________",
    "__________LL____LL_____LL_____LL_____LL____________",
    "___________________________________________________",
    "___________________________________________________","___________________________________________________",
    "___________________________________________________",
  ],{L:"#CC9900",l:"#AA7700"}),
};

export const PET_MOUNTS = new Set([
  "pet_dragon_baby","pet_phoenix","pet_unicorn","pet_dragon_ancient","pet_lion_golden"
]);

export const PET_SPRITES: Record<string,()=>Sprite> = {
  ...SMALL_PET_SPRITES, ...MOUNT_PET_SPRITES
};

function icon16(rows: string[], p: Record<string,string>): Sprite {
  return spr(rows.map(r=>r.padEnd(16,'_').slice(0,16)), p);
}
const mkArmIcon=(T:string,t:string,B:string,b:string)=>()=>icon16([
  "________________","_____TTTTTT_____","___TTTTTTTTTT___","___TtTTTTTtTT___",
  "___TTTTTTTTTT___","___TTTTTTTTTT___","____TTTTTTTT____","____BBBB_BBB____",
  "____BBBb_BBBb___","____BBBB_BBBB___","____BBBb_BBBb___","____BBBB_BBBB___",
  "____bbbbb_bbb___","________________","________________","________________",
],{T,t,B,b});
const mkSword=(B:string,G:string,H:string)=>()=>icon16([
  "________________","___________BL___","__________B_____","_________BB_____",
  "________BBB_____","_______BBBG_____","__GGGG_BBG______","___GGG_BG_______",
  "___G___BG_______","____H___________","____H___________","____H___________",
  "________________","________________","________________","________________",
],{B,L:B,G,H});
const mkStaff=(S:string,G:string)=>()=>icon16([
  "________________","____GL__________","___GGlG_________","__GGGGG_________",
  "____S___________","____S___________","____S___________","____S___________",
  "____S___________","____S___________","____S___________","____S___________",
  "________________","________________","________________","________________",
],{S,G,l:G,L:G});
const petCat=(C:string,c:string)=>()=>icon16([
  "_EE__________EE_","EEEE________EEEE","_EEEEEEEEEEEEEE_","_EEbbEEEEEbbEE__",
  "_EEEEEEEEEEEE___","_EEEcEEcEEEE____","_EEEEEEEEEEEE___","__EEEEEEEEEE____",
  "__EEECEEECEE____","__EEEEEEEEEE____","___EEEEEEEE_____","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#1A1000",c:c});
const petDog=(C:string,c:string)=>()=>icon16([
  "_EE__________EE_","EEEE_EEEEEE_EEEE","_EEEEEEEEEEEEE__","_EEbbEEEEEbbEE__",
  "_EEEEEEEEEEEE___","_EEEEcEEEEEE____","_EEEEEEEEEEEE___","__EEEEEEEEEE____",
  "__EEEEEEEEEE____","__EECEEEEECEE___","___EEEEEEEE_____","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#1A0800",c:c,C:"#FFFFFF"});
const petOwl=(C:string,c:string)=>()=>icon16([
  "____EEEEEEE_____","___EEEEEEEEe____","__EEebEEEbeEE___","__EEbbEEEbbEE___",
  "__EEEEEcEEEEE___","__EEEEEEEEeE____","__EEEEEEEEEE____","___EEEEEEEE_____",
  "___EEEEEEEE_____","____EEEEEEE_____","________________","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#1A1000",c:"#FFEE00"});
const petPanda=(C:string,c:string)=>()=>icon16([
  "__eE__________Ee","_eEEEe______eEEE","_eEEEEEEEEEEEEEe","_eEEbbEEEEbbEEe_","_EEEEEEeEEEEEE__",
  "_EEEEEEeEEEEE___","_EEEEEEEEEEEE___","__EEEEEEEEEEE___","___EEEEEEEE_____","________________",
  "________________","________________","________________","________________","________________","________________",
],{E:C,e:c,b:"#1A1A1A"});
const petFox=(C:string,c:string)=>()=>icon16([
  "_E____________E_","_EE__________EE_","_EEEEEEEEEEEEE__","_EEbbEEEEEbbEE__",
  "_EEEEEcEEEEEE___","_EEEEcEcEEEEE___","_EEEEEEEEEEEE___","__WWWEEEEEWWW___",
  "__EEEEEEEEE_____","___EEEEEEE______","________________","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#1A0800",c:"#F0C0A0",W:"#EEEEEE"});
const petDragonBaby=(C:string,c:string)=>()=>icon16([
  "e__EEEEEEE__e___","ee_EEEEEEE_ee___","EEEEEEEEEEEEEE__","EEbbEEEEEbbEE___",
  "EEEEEcEEEEEE____","_EEEEEEEEEE_____","_EEEEEEEEEEE____","__EEEEEEEEE_____",
  "__EEEEEEEEE_____","__fEEfEEfEE_____","___ff__ff__ff___","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#1A2A10",c:c,f:"#FF8800"});
const petPhoenix=(C:string,c:string)=>()=>icon16([
  "___YY_YY_YYY____","__YYYYYYYYYYYY__","_YYEEEEEEEEEYy__","_YEEbbEEEbbEEY__",
  "_YEEEEcEEEEEYY__","_YYEEEEEEEEYYy__","__YYYEEEEYYY____","___YYYYYYYY_____",
  "___YYYYYYYYYYY__","___Yy__Y__yYY___","________________","________________",
  "________________","________________","________________","________________",
],{E:C,Y:c,y:"#884400",b:"#1A0800",c:"#FFEE44"});
const petUnicorn=(C:string,c:string)=>()=>icon16([
  "___H____________","__HHH___________","__HEEEEEEEEE____","_EEEEEEEEEEEE___",
  "_EEbbEEEEbbEE___","_EEEEEEcEEEEE___","_EEEEEEEEEEEE___","__EEEEEEEEE_____",
  "__mmmEEEmmm_____","__EEEEEEEEe_____","___EEEEEEEE_____","________________",
  "________________","________________","________________","________________",
],{E:C,H:"#FFEE00",b:"#1A1800",c:"#FF88CC",m:c,e:c});
const petDragonAncient=(C:string,c:string)=>()=>icon16([
  "e___EEEEEEE___e_","EEE_EEEEEEE_EEE_","EEEEEEEEEEEEEEE_","EEEbbEEEEEbbEEE_",
  "EEEEEEcEEEEEEE__","EEEEcEcEEEEEEE__","EEEEEEEEEEEEEEE_","_EEEEEEEEEEEEEE_",
  "__EEEEEEEEEEE___","___EEEEEEEEEE___","__ffEEEEEEff____","________________",
  "________________","________________","________________","________________",
],{E:C,e:c,b:"#0A0A18",c:c,f:"#CC4400"});
const petLionGolden=(C:string,c:string)=>()=>icon16([
  "_cc__cccccc__cc_","cccccEEEEEEccccc","ccEEEEEEEEEEEcc_","_cEEbbEEEbbEEc__",
  "_cEEEEEEEEEEEc__","_cEEEEcEEEEEc___","_cEEEEEEEEEEc___","__cEEEEEEEEcc___",
  "__ccEEEEEEcc____","___cccccccc_____","________________","________________",
  "________________","________________","________________","________________",
],{E:C,c:c,b:"#1A1000"});

export const ITEM_ICON_SPRITES: Record<string,()=>Sprite> = {
  hat_baseball_red:   ()=>icon16(["________________","___RRRRRRRRRR___","__RRRrRRRRRrRRR_","__RRRRRRRRRRRRR_","____BBBBBBBB____","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{R:"#CC2222",r:"#AA0000",B:"#222222"}),
  hat_beanie_blue:    ()=>icon16(["___BBBBBBBBBB___","__BBBBbBBBBbBBB_","_BBBBBBBBBBBBBBB","_BBBBBBBBBBBBBBB","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{B:"#2244AA",b:"#4466CC"}),
  hat_wizard:         ()=>icon16(["________P_______","_______PPP______","______PPSPP_____","____PPPPPPPPPP__","___GGGGGGGGGG___","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{P:"#5511AA",S:"#FFDD44",G:"#FFCC00"}),
  hat_crown_bronze:   ()=>icon16(["________________","__M__M__M__M____","_MMM_MM_MM_MMM__","_MMMMMMMMMMMM___","_MJ1MJ2MJ1MJ2M__","_MMMMMMMMMMMM___","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{M:"#AA7722",L:"#DD9933","1":"#CC2244","2":"#2244CC"}),
  hat_crown_silver:   ()=>icon16(["________________","__M__M__M__M____","_MMM_MM_MM_MMM__","_MMMMMMMMMMMM___","_MJ1MJ2MJ1MJ2M__","_MMMMMMMMMMMM___","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{M:"#999999",L:"#CCCCCC","1":"#4499FF","2":"#44CC88"}),
  hat_crown_gold:     ()=>icon16(["________________","__M__M__M__M____","_MMM_MM_MM_MMM__","_MMMMMMMMMMMM___","_MJ1MJ2MJ1MJ2M__","_MMMMMMMMMMMM___","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{M:"#CC9900",L:"#FFDD22","1":"#FF44AA","2":"#44FFAA"}),
  hat_headphones:     ()=>icon16(["___BBBBBBBBBB___","__BbBBBBBBBbB___","_BBBBBBBBBBBBBB_","_BBB________BBB_","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{B:"#222222",b:"#444444"}),
  hat_ninja:          ()=>icon16(["_NNNNNNNNNNNNNN_","NNNNNNNNNNNNNNNN","NNNN_______NNNN_","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{N:"#111122"}),
  hat_samurai:        ()=>icon16(["____SSSSSSSS____","__SSSSSSSSSSSSS_","_SSSsSSSSSSSSSSs","_GGGGGGGGGGGGGG_","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{S:"#888899",s:"#AABBCC",G:"#CCAA00"}),
  armor_bare_basic: ()=>icon16([
    "________________","_____UUUUUUUU___","__SUUUUUUUUUUS__","__SUUUUUUUUUUS__",
    "_____UUUUUUUU___","_____UUUUUUUU___","_____UUUUUUUU___","_____uUUUUUUu___",
    "_____HHHHHHHH___","_____QQ____QQ___","_____QQ____QQ___","_____QQ____QQ___",
    "_____QQ____QQ___","________________","________________","________________",
  ],{U:"#F0EDE8",u:"#D0CCBC",H:"#444444",Q:"#666677",S:"#D8D4CC"}),
  armor_shirt_basic: ()=>icon16([
    "________________","____WWWWWWWW____","__SWWWWWWWWWWS__","__SWWWWWWWWWWS__",
    "____WWWWWWWW____","____WWWWWWWW____","____WWWWWWWW____","____wWWWWWWw____",
    "____JJJJJJJJ____","____JJ____JJ____","____JJ____JJ____","____JJ____JJ____",
    "____JJ____JJ____","____JJ____JJ____","________________","________________",
  ],{W:"#E8EEF8",w:"#AABBCC",S:"#BBCCDD",J:"#2A4A8C"}),
  armor_hoodie_gray: ()=>icon16([
    "________________","_HHHHHHHHHHHHHH_","HHHHgggggggHHHHH","HHHHgZZZZZgHHHHH",
    "HHHHgggggggHHHHH","HHHHHgPPPgHHHHHH","HHHHHgPPPgHHHHHH","HHHHHgggggHHHHHH",
    "CCCCHHHHHHHHHCCc","____DDDDDDDDDD__","____DD____DD____","____DD____DD____",
    "____DD____DD____","____Dd____Dd____","________________","________________",
  ],{H:"#777788",g:"#555566",Z:"#222233",P:"#666677",C:"#9999AA",c:"#777788",D:"#222233",d:"#334455"}),
  armor_robe_blue: ()=>icon16([
    "________________","___GRRRRRRRRG___","__GRRrRRRRrRRG__","_GRRRRRcRRRRRRG_",
    "_GRRRRRRRRRRRRG_","_GRRRRRRRRRRRRG_","__GRRRRRRRRRRRG_","__GRRRRRRRRRRG__",
    "___RRRRRRRRRR___","__RRRRRRRRRRRRR_","_RRRRRRRRRRRRRR_","RRRRRRRRRRRRRRR_",
    "_GRRRRRRRRRRRG__","__GGGGGGGGGGG___","________________","________________",
  ],{R:"#2244AA",r:"#3355CC",G:"#CCAA00",c:"#FFDD44"}),
  armor_jacket_cool: ()=>icon16([
    "________________","___JJJJJJJJJJ___","_JJJJLLJJJJjJJJ_","_JJJJLLLJJjJJJJ_",
    "_JJJJILLJIJjJJJ_","_JJJJIILLIJ jJJJ".replace(" ",""),"_JJJJIIIIIJjJJJ_","_JJJBBBBBBBBJJJ_",
    "____PPPPPPPPPP__","____PPP____PPP__","____PP______PP__","____PP______PP__",
    "___BBBB____BBBB_","___BBBB____BBBB_","________________","________________",
  ],{J:"#1A1A2E",j:"#2A2A44",L:"#DDCCBB",I:"#CCBBAA",B:"#111111",P:"#111122"}),
  armor_knight_silver: ()=>icon16([
    "________________","AAAAAAAAAAAAAAAA","APAAAAAAAAAAAApA","_AAAAAAAAAAAAAAA",
    "__AAAGGGGGGGAAA_","__AAAGGGGGGGAAA_","__AAAAAAAAAAAAAA","___GGGAAAAAAGGG_",
    "___AAAAAAAAAAAA_","____AAA____AAA__","____AAA____AAA__","____AAD____AAD__",
    "___AGGGG___AGGGG","___AGGGG___AGGGG","________________","________________",
  ],{A:"#9AAABB",a:"#CCDDEE",G:"#BBBB99",D:"#667788",P:"#AABBCC",p:"#667788"}),
  armor_wizard_purple: ()=>icon16([
    "________________","PPPPPPPPPPPPPPPP","PPPPPPsPPPPPPPPP","PPPPPsRssRsPPPPP",
    "PPPPPPsPPPPPPPPP","PPPPPPPPPPPPPPPP","_PPPPPPPPPPPPPP_","__PPPPPPPPPPP___",
    "___PPPPPPPPP____","___PPrPPPPrPP___","__PPPPPPPPPPP___","_PPPPPPPPPPPPPP_",
    "_PPPPPPPPPPPPPss","_PPrrrrrrrrrrss_","________________","________________",
  ],{P:"#5511AA",p:"#3300AA",s:"#FFDD88",R:"#FFDD44",r:"#FF88FF"}),
  armor_knight_gold: ()=>icon16([
    "________________","GGGGGGGGGGGGGGGG","GPGGGGGGGGGGGGPG","_GGGGGGGGGGGGGG_",
    "__GGGWWWWWWWGGG_","__GGGWdddddWGGG_","__GGGGWWWWWGGGG_","___GGGGGGGGGGG__",
    "___GGGGGGGGGGG__","____GGG____GGG__","____GGG____GGG__","____GGD____GGD__",
    "___GGGG____GGGG_","___GGGGG___GGGGG","________________","________________",
  ],{G:"#CC9922",g:"#EEDD55",W:"#FFFFFF",d:"#CC4488",D:"#886611",P:"#FFEE66",p:"#886611"}),
  armor_dragon_scale: ()=>icon16([
    "________________","_SS_DDDDDDDDSS__","SSDDDDDDDDDDDSS_","_SSDDDSDDSDDSS__",
    "__DDDsDDDsDDDsD_","__DsDDsDDsDDsDDs","__DDDsDDDsDDDsD_","__DsDcDDsDcDDs__",
    "___DDDDDDDDDD___","____DsD____DsD__","____DDD____DDD__","____DsD____DsD__",
    "___cCCC____cCCC_","___CCCC____CCCC_","________________","________________",
  ],{D:"#1A3A20",d:"#2A5A30",s:"#0A2010",S:"#FF6600",c:"#111A10",C:"#0A1008"}),
  // ── Fighting Gi icons ───────────────────────────────────────────────────────
  armor_gi_white: ()=>icon16([
    "________________","____WWWWWWWWW___","__SWWWWWWWWWWS__","__SWWLLwwLLWWS__",
    "__SWWLwwwwLWWS__","____WWWWWWWWW___","____WWWWWWWWW___","____wWWWWWWWw___",
    "____BBBBBBBBB___","___JJJJJJJJJJJ__","___JJJ_____JJJ__","___JJJ_____JJJ__",
    "___JJJ_____JJJ__","___JJJ_____JJJ__","________________","________________",
  ],{W:"#F0EEE8",w:"#D0CECC",L:"#A8A4A0",S:"#FFDBB4",B:"#111111",J:"#EBEBEB"}),
  armor_gi_red: ()=>icon16([
    "________________","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__",
    "__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__",
    "____PPPPPPPPPP__","___JJJJJJJJJJJ__","___JJJ_____JJJ__","___JJJ_____JJJ__",
    "___JJJ_____JJJ__","___JJJ_____JJJ__","________________","________________",
  ],{S:"#FFDBB4",P:"#E85080",J:"#CC2222"}),
  armor_gi_blue: ()=>icon16([
    "________________","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__",
    "__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__","__SSSSSSSSSSSS__",
    "____BBBBBBBBBB__","___JJJJJJJJJJJ__","___JJJ_____JJJ__","___JJJ_____JJJ__",
    "___JJJ_____JJJ__","___JJJ_____JJJ__","________________","________________",
  ],{S:"#FFDBB4",B:"#FFDD00",J:"#2244AA"}),
  // ── Headband icons ──────────────────────────────────────────────────────────
  hat_headband_red:   ()=>icon16([
    "________________","________________","__RRRRRRRRRRRR__","__rrrrrrrrrrrrr_",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
  ],{R:"#DD2222",r:"#AA0000"}),
  hat_headband_blue:  ()=>icon16([
    "________________","________________","__BBBBBBBBBBBBBB","__bbbbbbbbbbbbbb",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
  ],{B:"#2255DD",b:"#1133AA"}),
  hat_headband_white: ()=>icon16([
    "________________","________________","__WWWWWWWWWWWWWW","__wwwwwwwwwwwwww",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
    "________________","________________","________________","________________",
  ],{W:"#F0EEE8",w:"#C8C6C2"}),
  weapon_pencil:          ()=>icon16(["________________","________YYYY____","_______YYYYYY___","_______YYYYYy___","_______YYYYSS___","________YYss____","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{Y:"#FFEE88",y:"#CCAA22",S:"#EEEEEE",s:"#FF8866"}),
  weapon_ruler:           ()=>icon16(["________________","_RRRRRRRRRRRR___","_RrRrRrRrRrRrR__","_RRRRRRRRRRRR___","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________","________________"],{R:"#EEEECC",r:"#CCAA88"}),
  weapon_sword_bronze:    ()=>icon16(["____________B___","___________BB___","__________BB____","_________BBB____","________BBBB____","_GGG____BBB_____","_G_G____BB______","_GGG____B_______","________H_______","________H_______","________H_______","________H_______","________H_______","________________","________________","________________"],{B:"#AA7722",G:"#CCAA00",H:"#5C3010"}),
  weapon_staff_wood:      ()=>icon16(["____GGG_________","___GGgGG________","___GGGGG________","____GGG_________","_____ll_________","_____S__________","_____S__________","_____S__________","_____S__________","_____S__________","_____S__________","_____S__________","_____S__________","_____S__________","________________","________________"],{S:"#7A4A18",G:"#556622",g:"#779933",l:"#9A6A28"}),
  weapon_bow:             ()=>icon16(["________B_______","_______BB_______","______BB________","_____BB_S_______","____BB__S_______","___BB___S_______","__BL____S_______","___BB___S_______","____BB__S_______","_____BB_S_______","______BB________","_______BB_______","________B_______","________________","________________","________________"],{B:"#7A4A18",L:"#8B5020",S:"#CCCCAA"}),
  weapon_sword_silver:    ()=>icon16(["__________B_____","_________BB_____","________BB______","_______BBB______","_GGGGG__BB______","_GlGlG__B_______","_GGGGG__B_______","________B_______","________H_______","________H_______","________H_______","________Hh______","________H_______","________H_______","________________","________________"],{B:"#AABBCC",G:"#CCCCAA",l:"#EEEEFF",H:"#3A2A1A",h:"#5A4A3A"}),
  weapon_staff_crystal:   ()=>icon16(["____G___________","___GGG__________","__GGgGG_________","_GGgggGG________","__GGgGG_________","___GGG__________","____S___________","____S___________","____Sl__________","____S___________","____S___________","____Sl__________","____S___________","________________","________________","________________"],{S:"#335588",G:"#2299CC",g:"#44CCEE",l:"#4477BB"}),
  weapon_hammer:          ()=>icon16(["________________","__HHHHHHHH______","__HhHHHHhH______","__HHHHHHHH______","__HhHHHHhH______","__HHHHHHHH______","______SS________","______SS________","______SS________","______SS________","______SS________","______SS________","______SS________","________________","________________","________________"],{H:"#888899",h:"#AABBCC",S:"#7A5020"}),
  weapon_sword_excalibur: ()=>icon16(["_________GL_____","________GGL_____","_______GGG______","______GGG_______","_____GGGG_______","_RRR__GGG_______","_RwR__GG________","_RRR__G_________","______H_________","______H_________","______Hh________","______H_________","______H_________","________________","________________","________________"],{G:"#DDBB00",L:"#FFFFFF",R:"#FFFFFF",w:"#FFEE88",H:"#4A3020",h:"#6A5030"}),
  weapon_staff_legendary: ()=>icon16(["__GG____________","_GGGGl__________","GGGlGGGG________","GGlGGGGG________","_GGGlGGG________","__GGGGRR________","____RRRR________","_____S__________","_____S__________","_____Sl_________","_____S__________","_____S__________","_____Sl_________","________________","________________","________________"],{S:"#551188",G:"#CC4400",l:"#FF8833",R:"#FF6600"}),
  pet_cat_orange:    petCat("#DD7733","#BB5511"),
  pet_dog_brown:     petDog("#C28040","#8B5523"),
  pet_owl:           petOwl("#C8A050","#FFEE00"),
  pet_panda:         petPanda("#EEEEEE","#222222"),
  pet_fox:           petFox("#DD6611","#AA4400"),
  pet_dragon_baby:   petDragonBaby("#3ABB55","#FF8800"),
  pet_phoenix:       petPhoenix("#CC4400","#FFAA00"),
  pet_unicorn:       petUnicorn("#EEEEEE","#FF88CC"),
  pet_dragon_ancient:petDragonAncient("#1E4A30","#CC4400"),
  pet_lion_golden:   petLionGolden("#EEBB22","#CC8800"),
  potion_health_small: ()=>icon16([
    "________________","________________","_______A________","______AAA_______",
    "____RRRRRR______","___RRRlRRRR_____","___RRlllRRRR____","___RRRlRRRRR____",
    "___RRRRRRRRR____","___RRRRRRRRR____","____RRRRRRR_____","_____RRRRR______",
    "________________","________________","________________","________________",
  ],{A:"#888899",R:"#CC2222",l:"#FF8888"}),
  fifty_fifty: ()=>icon16([
    "________________",
    "________A_______",
    "________A_______",
    "______AAAAA_____",
    "___AA_____AA____",
    "__AAAA___AAAA___",
    "___AA_____AA____",
    "______AAaAA_____",
    "_______aAa______",
    "________A_______",
    "________A_______",
    "______AAAAA_____",
    "________________",
    "________________",
    "________________",
    "________________",
  ],{A:"#C9A84C",a:"#8B6914"}),

  potion_xp_boost: ()=>icon16([
    "________________","_______A________","_______A________","______AAA_______",
    "_____PPPPP______","____PPPsPPP_____","____PPssssPP____","____PPPsPPP_____",
    "_____PPPPP______","_____PPPPP______","_____PPPPP______","______PPP_______",
    "______PPP_______","________________","________________","________________",
  ],{A:"#888899",P:"#8822CC",s:"#CC66FF"}),
  potion_coin_boost: ()=>icon16([
    "________________","________________","_____AAA________","_____AAA________",
    "___GGGGGGGGG____","__GGGGgGGGGG____","__GGGgGGgGGG____","__GGGGGGgGGG____",
    "__GGGGGGGGGGG___","__GGGGGGGGGGG___","___GGGGGGGGG____","____GGGGGGG_____",
    "________________","________________","________________","________________",
  ],{A:"#888899",G:"#CC9900",g:"#FFDD44"}),
  item_quest_scroll:   ()=>icon16(["________________","__BBBBBBBBBBB___","_BBRRRRRRRRRRB__","_BRRRRRRRRRRRB__","_BRRRRRRRRRRRRB_","_BRRRRRRRRRRRB__","_BRRRRRRRRRRRB__","_BRRRRRRRRRRRB__","_BBRRRRRRRRRRB__","__BBBBBBBBBBB___","________________","________________","________________","________________","________________","________________"],{B:"#8B6030",R:"#E8D098"}),
  item_lucky_coin:     ()=>icon16(["________________","___GGGGGGG______","__GGgGGGGGGG____","_GGGGgGGGGGGG___","_GGGGGGGgGGGG___","_GGGgGGGGGGGG___","_GGGGGGGgGGGG___","__GGGGGGGGGG____","___GGGGGGG______","________________","________________","________________","________________","________________","________________","________________"],{G:"#DDAA00",g:"#FFDD44"}),
  item_time_gem:       ()=>icon16(["________________","____BBBBB_______","___BlBBBBBl_____","__BlBBBBBBBl____","__BBBBBBBBBBB___","__BBBbBBBBBBB___","__BBBBBbBBBBB___","__BlBBBBBBBl____","___BlBBBBBl_____","____BBBBB_______","________________","________________","________________","________________","________________","________________"],{B:"#2266CC",b:"#88CCFF",l:"#44AAFF"}),
  title_scholar:       ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#3388FF"}),
  title_quiz_master:   ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#FF8800"}),
  title_dragon_slayer: ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#CC2222"}),
  armor_legends_mantle: ()=>icon16([
    "________________",
    "____GGGGGGGG____",
    "CCCCCCCCCCCCCCCC",
    "CcCCCCCCCCCCCcCC",
    "GCCCCGGgGGCCCCGg",
    "GCCCCGGGGGCCCCGg",
    "GCCCCCGgGCCCCCGg",
    "GCCcCCCCCCcCCCGg",
    "GCCCCCCCCCCCCCGg",
    "_GCCcCCCCCcCCGg_",
    "_GCCCCCCCCCCCGg_",
    "__GCCcCCCcCCGg__",
    "__GGGGGGGGGGGg__",
    "___LLLLLLLLLl___",
    "________________",
    "________________",
  ],{C:"#2A1060",c:"#5030A0",G:"#FFD700",g:"#AA8800",L:"#EED890"}),
  potion_streak_shield: ()=>icon16([
    "________________","________________","______A_________","_____BBBBB______",
    "___BBBBBBBBB____","__BBBBsBBBBB____","__BBBsssBBBB____","__BBBBsBBBBB____",
    "___BBBBBBBBB____","____BBBBBBB_____","_____BBBBB______","______BBB_______",
    "________________","________________","________________","________________",
  ],{A:"#888899",B:"#1155CC",s:"#66AAFF"}),
  potion_xp_boost_2h: ()=>icon16([
    "________________","______A_________","_____AAA________","_____SSS________",
    "____SSSSS_______","____SgSgS_______","____SSSSS_______","____SgSgS_______",
    "____SSSSS_______","____SgSgS_______","____SSSSS_______","____SSSSS_______",
    "____SSSSS_______","________________","________________","________________",
  ],{A:"#888899",S:"#CC8800",g:"#FFE855"}),
  potion_quest_reset: ()=>icon16([
    "________________","________________","____AAAAAAA_____","____TTTTTTT_____",
    "_____TTTTT______","______TTT_______","______tTt_______","______TTT_______",
    "_____TTTTT______","____TTTTTTT_____","________________","________________",
    "________________","________________","________________","________________",
  ],{A:"#888899",T:"#448866",t:"#88FFCC"}),
  hint_scroll: ()=>icon16([
    "________________","___BBBBBBBBBB___","__BBeeeeeeeeBB__","__BeWWWWWWWWeB__",
    "__BeWWwwWWWWeB__","__BeWWWWwWWWeB__","__BeWWwWWWWWeB__","__BeWWWWWwWWeB__",
    "__BeWWWWWWWWeB__","__BBeeeeeeeeBB__","___BBBBBBBBBB___","____RRRRRRRR____",
    "____rBBBBBBr____","________________","________________","________________",
  ],{B:"#8B6030",e:"#C8A060",W:"#F0E8C0",w:"#A09060",R:"#CC3322",r:"#AA2211"}),
  title_arena_champ:   ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#DD3333"}),
  title_the_eternal:   ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#00DDCC"}),
  title_legend:        ()=>icon16(["________________","___CCCCCCCCC____","__CCC_____CCC___","_CC__CCCCCCC_CC_","_CC_CC___CC_CC__","_CC_CCCCCCC_CC__","__CCC_____CCC___","___CCCCCCCCC____","________________","__CCCCCCCCCCC___","________________","________________","________________","________________","________________","________________"],{C:"#FFDD00"}),
};

export const AVATAR = {
  CW: 64, CH: 82,               // canvas size in logical px
  CHAR_X:  22, CHAR_Y:  2,      // normal character position (20px wide, 48px tall)
  CHAR_Y_MOUNTED: 10,           // character Y offset when riding mount
  MOUNT_X: 8,  MOUNT_Y: 50,    // mount rendered at this position (48×20)
  SPET_X: 2,   SPET_Y: 18,     // small companion pet — beside character at hand/arm height
  WEAPON_X: 44, WEAPON_Y: 14,  // right-hand weapon
  WEAPON_LEFT_X: 10, WEAPON_LEFT_Y: 14, // left-hand weapon (dual-wield)
  FACE_COL_START: 4, FACE_COL_END: 15,  // cols for face portrait
  FACE_ROW_START: 0, FACE_ROW_END: 17,  // rows for face portrait (includes head+shoulder)
  L_ARM_X: 19, L_ARM_Y: 16,   // left arm — snug against body left edge (CHAR_X=22, col 0)
  R_ARM_X: 41, R_ARM_Y: 16,   // right arm — snug against body right edge (CHAR_X+19=41)
} as const;
// ============================================================================
// AVATAR EXTENDED — Eye colors, Lip colors, Female face, Female armor
// Added for bitmoji-style customisation (bodyTypeId, eyeColorId, lipColorId)
// ============================================================================

export interface EyeColor { id: string; label: string; iris: string; pupil: string; }
export interface LipColor { id: string; label: string; color: string; }

export const EYE_COLORS: EyeColor[] = [
  { id: "blue",    label: "Ocean Blue",    iris: "#2255DD", pupil: "#060810" },
  { id: "green",   label: "Forest Green",  iris: "#1A8844", pupil: "#052218" },
  { id: "brown",   label: "Warm Brown",    iris: "#7A4A1E", pupil: "#1A0800" },
  { id: "hazel",   label: "Golden Hazel",  iris: "#BB7722", pupil: "#2A1400" },
  { id: "grey",    label: "Steel Grey",    iris: "#7788AA", pupil: "#1A2230" },
  { id: "violet",  label: "Violet Storm",  iris: "#8833CC", pupil: "#1A0830" },
  { id: "amber",   label: "Amber Blaze",   iris: "#CC6611", pupil: "#3A1800" },
  { id: "crimson", label: "Crimson Fire",  iris: "#CC2222", pupil: "#3A0808" },
];

export const LIP_COLORS: LipColor[] = [
  { id: "natural",  label: "Natural",      color: "#C07060" },
  { id: "rosy",     label: "Rose Pink",    color: "#DD4488" },
  { id: "bold_red", label: "Bold Red",     color: "#CC1122" },
  { id: "plum",     label: "Plum",         color: "#883366" },
  { id: "coral",    label: "Coral",        color: "#FF7744" },
  { id: "nude",     label: "Nude Beige",   color: "#D4A882" },
  { id: "berry",    label: "Berry",        color: "#662244" },
  { id: "gloss",    label: "Gloss Clear",  color: "#FFBBCC" },
];

/** Female face — softer features, longer lashes, defined lips */
export function buildFemaleHead(
  skin: SkinTone,
  hair: HairColor,
  eyeColor: EyeColor,
  lipColor: LipColor,
  sporty = false,
): Sprite {
  const S=skin.b, s=skin.m, d=skin.d, O=skin.o;
  const H=hair.c, HL=hair.h;
  const EW="#F2F5FF";
  const EI=eyeColor.iris;
  const EP=eyeColor.pupil;
  const EL="#101020";
  const ML=lipColor.color;
  const MH=lighten(lipColor.color);
  const NS=skin.d;

  return spr([
    // Row 0-1: Hair top — wider/taller crown than male
    "___HHHHHHHHHHHHHH___",
    "___HHhHHHHHHHhHHH___",
    // Row 2-9: Face with hair framing sides
    "__HOoSSSSSSSSSSSoH__",
    "__HOoSSSSSSSSSSSoH__",
    // Row 4: Defined lashes on BOTH corners (the key female tell)
    "__HOoEeLSSSSLeEoH___",
    // Row 5: Eyes — slightly larger iris
    "__HOoWIIPSIPIIWoH___",
    "__HOoSSSSSSSSSSoH___",
    // Row 7: Softer nose
    "___OoSSSSnNnSSSoO___",
    // Row 8-9: Defined lips — wider/fuller than male
    "___OoSSSMLLLMSSoO___",
    "___OoSSSMRRRMSSoO___",
    // Row 10-13: LONG HAIR flowing DOWN past face on both sides
    // This is the KEY visual difference — hair extends below jawline
    "__HHHoSSSSSSSSoHHH__",
    "__HHhsSSSSSSSsSHHh__",
    sporty
      ? "__HHHsSSSSSSsSHHH___"   // sporty: shorter side hair
      : "__HHHhSSSSSSShHHH___",  // elegant: more flowing hair
    sporty
      ? "____HhSSSSSSShH_____"   // sporty tapers quickly
      : "___HHHhSSSSSShHHH___",  // elegant: longer flowing
  ], {
    H, h:HL,
    O, o:d,
    S, s,
    E:EL, e:EL, L:EL,
    W:EW, I:EI, P:EP,
    N:NS, n:d,
    M:ML, R:MH,
  });
}

/** Lighten a hex color by mixing with white */
function lighten(hex: string): string {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const mix = (v: number) => Math.min(255, Math.round(v + (255-v)*0.45));
  return `#${mix(r).toString(16).padStart(2,"0")}${mix(g).toString(16).padStart(2,"0")}${mix(b).toString(16).padStart(2,"0")}`;
}

// Updated buildHead to accept optional eye/lip overrides (backwards compatible)
// The original buildHead uses hardcoded blue eyes + red lips.
// New callers can pass eyeColor/lipColor for customisation.
const _origBuildHead = buildHead;
declare module "@/lib/pixelArt" {
  // augmented signature — consumers who pass extra args get coloured eyes/lips
}

/** Female outfit variants — slightly narrower shoulders, fitted silhouette */
function buildFemaleShirt(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____SWWwWWWwWWS_____",
    /* 15 */ "SSssWWWwWWWWwWWSSSs_",
    /* 16 */ "SSssWWwWWWWWWwWSSSs_",
    /* 17 */ "SSssPWWwWWWWwWWSSss_",
    /* 18 */ "_____WWwWWWWwWW_____",
    /* 19 */ "_____WWWWWWWwWW_____",
    /* 20 */ "_____WWWWWWWWwW_____",   // narrower waist
    /* 21 */ "_____wWWWWWWwWW_____",
    /* 22 */ "_____bBBBBBBBb______",
    /* 23 */ "_____JJJjJJJJJ______",
    /* 24 */ "_____JJJj__JJjJ_____",
    /* 25 */ "_____JjJJ__JJjJ_____",
    /* 26 */ "_____JJJj__JJjJ_____",
    /* 27 */ "_____JjJJ__JJjJ_____",
    /* 28 */ "_____JJJj__JJjJ_____",
    /* 29 */ "_____JjJJ__JJjJ_____",
    /* 30 */ "_____JJJj__JJjJ_____",
    /* 31 */ "_____JjJJ__JJjJ_____",
    /* 32 */ "_____JJJj__JJjJ_____",
    /* 33 */ "_____JjJJ__JJjJ_____",
    /* 34 */ "_____ssss__ssss_____",
    /* 35 */ "____NNNNNn_NNNNNn___",
    /* 36 */ "____NnNNNN_NnNNNN___",
    /* 37 */ "____nNNNNNN_nNNNNN__",
  ], {W:"#E8EEF8",w:"#C4CAD8",P:"#D0D4C0",b:"#3A2800",B:"#604400",
      J:"#2A4A8C",j:"#4A72B8",N:"#F0F0FF",n:"#9090BB"}, skin);
}

function buildFemaleHoodie(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "___HHHHHHHHHHHHH____",
    /* 15 */ "HHHHHHHHHHHHHHHHHHH_",
    /* 16 */ "HHHhGGGGGGGGGGGhHHH_",
    /* 17 */ "HHHhGGZZGGGGGZZGhHH_",
    /* 18 */ "GGGgGGZZGGGGGZZGgGG_",
    /* 19 */ "GGGgGGGGGGGGGGGGgGG_",
    /* 20 */ "_GGgGGPPPPPPPGGgGG__",  // narrower body
    /* 21 */ "_GGgGGPpppppPGGgGG__",
    /* 22 */ "_GGgGGPPPPPPPGGgGG__",
    /* 23 */ "CCCcCCCCCCCCCCCCcCCC".slice(0,20),
    /* 24 */ "_____DDDDDDDDDD_____",
    /* 25 */ "_____DDdD__DDdD_____",
    /* 26 */ "_____DDDD__DDDD_____",
    /* 27 */ "_____DDdD__DDdD_____",
    /* 28 */ "_____DDDD__DDDD_____",
    /* 29 */ "_____DDdD__DDdD_____",
    /* 30 */ "_____DDDD__DDDD_____",
    /* 31 */ "_____DDdD__DDdD_____",
    /* 32 */ "_____DDDD__DDDD_____",
    /* 33 */ "_____DDdD__DDdD_____",
    /* 34 */ "_____WWWW__WWWW_____",
    /* 35 */ "____WWWWWW_WWWWWW___",
    /* 36 */ "____WWWwwW_WWWwwW___",
    /* 37 */ "____WWWWWW_WWWWWW___",
  ], {H:"#AAAAAA",h:"#888888",G:"#777788",g:"#555566",Z:"#222233",
      P:"#888899",p:"#666677",C:"#CCCCDD",c:"#9999AA",
      D:"#222233",d:"#334455",W:"#DDDDEE",w:"#AABBCC"}, skin);
}

function buildFemaleRobe(skin: SkinTone): Sprite {
  return armorSprite([
    /* 14 */ "____RRRRRRRRRRRR____",
    /* 15 */ "GGRRRRRRRRRRRRRRRGG_",
    /* 16 */ "GRRRRRRRrRRRRRRRRGR_",
    /* 17 */ "GRRRRRRRrRRRRRRRRGR_",
    /* 18 */ "_GRRRRRGcGRRRRGRGR__",
    /* 19 */ "__GRRRRRRRRRRRRGR___",  // narrowed
    /* 20 */ "__GRRRRRRRRRRRRGR___",
    /* 21 */ "__GRRRRRRRRRRRRGRR__",
    /* 22 */ "___GRRRRRRRRRRRGRR__",
    /* 23 */ "___GRRRRRRRRRRRGRR__",
    /* 24 */ "____RRRRRRRRRRRR____",
    /* 25 */ "____RRRrRRRRRRrRR___",
    /* 26 */ "___RRRRRRRRRRRRRR___",
    /* 27 */ "___RRRrRRRRRRrRRR___",
    /* 28 */ "__RRRRRRRRRRRRRRRRR_",
    /* 29 */ "__RRRrRRRRRRRRrRRRR_",
    /* 30 */ "_GRRRRRRRRRRRRRRRRG_",
    /* 31 */ "_GRRRrRRRRRRRRrRRG__",
    /* 32 */ "_GRRRRRRRRRRRRRRRG__",
    /* 33 */ "_GGGRRRRRRRRRRRGGGr_",
    /* 34 */ "__GGGGGGRRRGGGGGGrr_",
    /* 35 */ "____rRRR____rRRR____",
    /* 36 */ "____rRrr____rRrr____",
    /* 37 */ "________________",
  ], {R:"#2244AA",r:"#1133CC",G:"#CCAA00",c:"#FFDD44"}, skin);
}

export const FEMALE_ARMOR_FACTORIES: Record<string, ArmorFactory> = {
  armor_shirt_basic:   buildFemaleShirt,
  armor_hoodie_gray:   buildFemaleHoodie,
  armor_robe_blue:     buildFemaleRobe,
  // Female gi — hourglass-shaped gi jacket/pants (narrower waist, flared hips)
  armor_gi_white: (skin) => armorSprite([
    /* 14 */ "____SWWwWWWwWWWS____",
    /* 15 */ "SSssWWWWWWWWWWWSSSs_",
    /* 16 */ "SSsWWWLLLLLWWWWSSs__",
    /* 17 */ "SSsWWLLwwLLLWWWSss__",
    /* 18 */ "____WWLLwwWLLWW_____",
    /* 19 */ "_____WWwWWWWWWW_____",
    /* 20 */ "_____WWWWWWWwWW_____",  // narrower waist
    /* 21 */ "_____wWWWWWwWWW_____",
    /* 22 */ "_____bBBBBBBBb______",
    /* 23 */ "___JJJJJJJJJJJJJJ__",  // wide hip flare
    /* 24 */ "___JJJJJj__jJJJJJ__",
    /* 25 */ "___JjJJJJ__JJJJjJ__",
    /* 26 */ "___JJJJJj__jJJJJJ__",
    /* 27 */ "___JjJJJJ__JJJJjJ__",
    /* 28 */ "____JJJJj__jJJJJ____",
    /* 29 */ "____JjJJJ__JJJjJ____",
    /* 30 */ "____JJJJj__jJJJJ____",
    /* 31 */ "____JjJJJ__JJJjJ____",
    /* 32 */ "____JJJJj__jJJJJ____",
    /* 33 */ "____JjJJJ__JJJjJ____",
    /* 34 */ "____ssss___ssss_____",
    /* 35 */ "____SSSS___SSSS_____",
    /* 36 */ "____SSSS___SSSS_____",
    /* 37 */ "___sSSSss__sSSSss___",
  ], { W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",
       J:"#EBEBEB",j:"#C8C8C4" }, skin),
  armor_gi_red: (skin) => armorSprite([
    /* 14 */ "____SSSSSSSSSSss____",
    /* 15 */ "SSssSSSSSSSSSSSSss__",
    /* 16 */ "SSssSSSSSSSSSSSSss__",
    /* 17 */ "SSssSSSSSSSSSSSSss__",
    /* 18 */ "_____SSSSSSSSSss____",
    /* 19 */ "_____SSSSSSSSss_____",
    /* 20 */ "_____SSSSSSSss______",
    /* 21 */ "_____SSSSSSss_______",
    /* 22 */ "_____PPPPPPPPPP_____",
    /* 23 */ "___JJJJJJJJJJJJJJ__",
    /* 24 */ "___JJJJJj__jJJJJJ__",
    /* 25 */ "___JjJJJJ__JJJJjJ__",
    /* 26 */ "___JJJJJj__jJJJJJ__",
    /* 27 */ "___JjJJJJ__JJJJjJ__",
    /* 28 */ "____JJJJj__jJJJJ____",
    /* 29 */ "____JjJJJ__JJJjJ____",
    /* 30 */ "____JJJJj__jJJJJ____",
    /* 31 */ "____JjJJJ__JJJjJ____",
    /* 32 */ "____JJJJj__jJJJJ____",
    /* 33 */ "____JjJJJ__JJJjJ____",
    /* 34 */ "____ssss___ssss_____",
    /* 35 */ "____SSSS___SSSS_____",
    /* 36 */ "____SSSS___SSSS_____",
    /* 37 */ "___sSSSss__sSSSss___",
  ], { P:"#E85080",J:"#CC2222",j:"#8B0000" }, skin),
  armor_gi_blue: (skin) => armorSprite([
    /* 14 */ "____SSSSSSSSSSss____",
    /* 15 */ "SSssSSSSSSSSSSSSss__",
    /* 16 */ "SSssSSSSSSSSSSSSss__",
    /* 17 */ "SSssSSSSSSSSSSSSss__",
    /* 18 */ "_____SSSSSSSSSss____",
    /* 19 */ "_____SSSSSSSSss_____",
    /* 20 */ "_____SSSSSSSss______",
    /* 21 */ "_____SSSSSSss_______",
    /* 22 */ "_____bBBBBBBBBBb____",
    /* 23 */ "___JJJJJJJJJJJJJJ__",
    /* 24 */ "___JJJJJj__jJJJJJ__",
    /* 25 */ "___JjJJJJ__JJJJjJ__",
    /* 26 */ "___JJJJJj__jJJJJJ__",
    /* 27 */ "___JjJJJJ__JJJJjJ__",
    /* 28 */ "____JJJJj__jJJJJ____",
    /* 29 */ "____JjJJJ__JJJjJ____",
    /* 30 */ "____JJJJj__jJJJJ____",
    /* 31 */ "____JjJJJ__JJJjJ____",
    /* 32 */ "____JJJJj__jJJJJ____",
    /* 33 */ "____JjJJJ__JJJjJ____",
    /* 34 */ "____ssss___ssss_____",
    /* 35 */ "____SSSS___SSSS_____",
    /* 36 */ "____SSSS___SSSS_____",
    /* 37 */ "___sSSSss__sSSSss___",
  ], { b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC" }, skin),
  // Other armors (plate, wizard, dragon scale) look fine on both genders
};

// ============================================================================
// BODY-TYPE ARM VARIANTS
// Skinny arms (2px), Muscular arms (4px with bulge)
// Default/female keep standard 3px buildArmDown/buildArmUp.
// ============================================================================

/** Slim 2-px arms for the skinny body type */
export function buildArmDownSkinny(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "Ss","Ss","Ss",
    "Ss","Ss",
    "Sd","Sd",
    "dS","dd","dd",
  ], { S, s, d });
}
export function buildArmUpSkinny(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "dd","dd","dS",
    "Sd","Sd",
    "Ss","Ss",
    "Ss","Ss","Ss",
  ], { S, s, d });
}

/** Thick 4-px arms for the muscular body type */
export function buildArmDownMuscular(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "SSSs","SSSs","SSss",   // bulging bicep
    "SSSs","SSss",           // forearm
    "SSsd","SSsd",
    "dSSd","dddd","dddd",   // thick hand
  ], { S, s, d });
}
export function buildArmUpMuscular(skin: SkinTone): Sprite {
  const S = skin.b, s = skin.m, d = skin.d;
  return spr([
    "dddd","dddd","dSSd",
    "SSsd","SSsd",
    "SSss","SSSs",
    "SSSs","SSSs","SSss",
  ], { S, s, d });
}

/** Arm X offsets for muscular (4px arms need to shift 1px outward) */
export const ARM_X = {
  default:  { L: 19, R: 41 },
  skinny:   { L: 20, R: 41 },   // 2px: shift left arm 1px inward
  muscular: { L: 18, R: 41 },   // 4px: shift left arm 1px outward
  female:   { L: 19, R: 41 },   // same as default
} as const;