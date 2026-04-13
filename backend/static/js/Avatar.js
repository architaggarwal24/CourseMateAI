// ============================================================
// avatar.js — Vanilla JS port of pixelArt.ts avatar renderer
// Reads user customization from backend /shop endpoint and
// draws the pixel avatar onto a canvas element.
// ============================================================

// ── Constants (matches pixelArt.ts AVATAR object) ──────────
const AVATAR_CONST = {
  CW: 64, CH: 82,
  CHAR_X: 22, CHAR_Y: 2,
  CHAR_Y_MOUNTED: 10,
  MOUNT_X: 8,  MOUNT_Y: 50,
  SPET_X: 2,   SPET_Y: 18,
  WEAPON_X: 44, WEAPON_Y: 14,
  WEAPON_LEFT_X: 10, WEAPON_LEFT_Y: 14,
  L_ARM_X: 19, L_ARM_Y: 16,
  R_ARM_X: 41, R_ARM_Y: 16,
};

// ── Sprite helpers ──────────────────────────────────────────
function spr(rows, p) {
  return rows.map(row => Array.from(row).map(ch => (ch in p ? p[ch] : null)));
}
function blit(ctx, px, ox, oy) {
  px.forEach((row, y) => row.forEach((col, x) => {
    if (col) { ctx.fillStyle = col; ctx.fillRect(ox + x, oy + y, 1, 1); }
  }));
}
function mirrorX(s) { return s.map(row => [...row].reverse()); }

// ── Skin tones (matches SKIN_TONES in pixelArt.ts) ──────────
const SKIN_TONES_AV = [
  { id:"ivory", b:"#FFDBB4", m:"#EDB97A", d:"#C8833E", o:"#7A3A10" },
  { id:"tan",   b:"#D4956A", m:"#B87040", d:"#8C4A1E", o:"#4A2008" },
  { id:"brown", b:"#A0693A", m:"#7A4A1E", d:"#5C3010", o:"#321404" },
  { id:"deep",  b:"#614126", m:"#422A12", d:"#2C1606", o:"#160802" },
];
const HAIR_COLORS_AV = [
  { id:"black",   c:"#111111", h:"#2A2A2A" },
  { id:"auburn",  c:"#5C2000", h:"#883000" },
  { id:"honey",   c:"#C87820", h:"#E8A040" },
  { id:"flaxen",  c:"#E8D060", h:"#F5E888" },
  { id:"silver",  c:"#888888", h:"#BBBBBB" },
  { id:"cobalt",  c:"#1A3A8C", h:"#2A5ACC" },
  { id:"violet",  c:"#5A1A8C", h:"#8A2ACC" },
  { id:"scarlet", c:"#8C1A10", h:"#CC2A18" },
];

function getSkin(id) { return SKIN_TONES_AV.find(s => s.id === id) || SKIN_TONES_AV[0]; }
function getHair(id) { return HAIR_COLORS_AV.find(h => h.id === id) || HAIR_COLORS_AV[0]; }

// ── Head ────────────────────────────────────────────────────
function buildHead(skin, hair) {
  const S=skin.b, s=skin.m, O=skin.o;
  const H=hair.c, HL=hair.h;
  const E="#111122", W="#EEF0FF", M="#CC3322";
  return spr([
    "____HHHHHHHHHHHH____",
    "___HHLHLHLHLHLHH____",
    "___OOSSSSSSSSSSOO___",
    "___OOSSSSSSSSSSOO___",
    "___OOSWEESSWEESOOO__",
    "___OOSSSSSSSSSSOO___",
    "___OOSSSSSSSSSSOO___",
    "____OOSSSsSSSOO_____",
    "____OOSSMmMSSSOO____",
    "____OOSSSSSSSSOO____",
    "_____OOSSSSSSOO_____",
    "_____OOSSSSSSOO_____",
    "______OOSSSSOO______",
    "________SSSS________",
  ], {H, L:HL, O, S, s, E, W, M, m:"#EE6655"});
}

// ── Female head (softer, slightly rounder) ─────────────────
function buildFemaleHead(skin, hair) {
  const S=skin.b, s=skin.m, O=skin.o;
  const H=hair.c, HL=hair.h;
  const E="#111122", W="#EEF0FF", M="#DD4455";
  return spr([
    "____HHHHHHHHHHHH____",
    "___HHLHLHLHLHLHH____",
    "___OOSSSSSSSSSSOO___",
    "___OOSSSSSSSSSSOO___",
    "___OOSWEESSWEESOOO__",
    "___OOSSSSSSSSSSOO___",
    "___OOSSSSSSSSSSOO___",
    "____OOSSSsSSSOO_____",
    "____OOSSMmMSSSOO____",
    "____OOSSSSSSSSOo____",
    "_____OOSSSSSSOO_____",
    "_____OOSSSSSSOO_____",
    "_____HOOSSSSOH______",
    "______HOOSSOH_______",
    "________SSSS________",
  ], {H, L:HL, O, S, s, E, W, M, m:"#EE8877", o:O, H:H});
}


function buildArmDown(skin) {
  const S=skin.b, s=skin.m;
  return spr(["SSS","SSS","SSS","SSS","SSS","SsS","SsS","SHH","HHH","HHH"],{S,s,H:s});
}
function buildArmUp(skin) {
  const S=skin.b, s=skin.m;
  return spr(["HHH","HHH","HHH","SsS","SsS","SSS","SSS","SSS","SSS","SSS"],{S,s,H:s});
}
function buildArmDownSkinny(skin) {
  const S=skin.b, s=skin.m;
  return spr(["SS","SS","SS","SS","SS","Ss","Ss","SH","HH","HH"],{S,s,H:s});
}
function buildArmUpSkinny(skin) {
  const S=skin.b, s=skin.m;
  return spr(["HH","HH","HH","Ss","Ss","SS","SS","SS","SS","SS"],{S,s,H:s});
}
function buildArmDownMuscular(skin) {
  const S=skin.b, s=skin.m;
  return spr(["SSSSS","SSSSS","SSsSS","SSsSS","SSSsS","SSSSS","SSSSS","SHHHs","HHHHH","HHHHH"],{S,s,H:s});
}
function buildArmUpMuscular(skin) {
  const S=skin.b, s=skin.m;
  return spr(["HHHHH","HHHHH","SHHHs","SSsSS","SSSsS","SSSSS","SSSSS","SSsSS","SSsSS","SSSSS"],{S,s,H:s});
}


// ── Armor sprite helper ─────────────────────────────────────
function armorSprite(rows, p, skin) {
  const augP = {...p, S:skin.b, s:skin.m};
  const full = Array.from({length:48}, ()=>Array(20).fill(null));
  const compiled = spr(rows.map(r=>r.padEnd(20,'_').slice(0,20)), augP);
  compiled.forEach((row,i) => { if(i<34) full[14+i]=row; });
  return full;
}

// ── Armors ──────────────────────────────────────────────────
function buildTShirt(skin) {
  return armorSprite([
    "____SWWWWWWWWWWS____","SSSSWWWWWWWWWWWWSSSS","SSSsWWWwWWWWWWwWSSSs",
    "SSSSWWWpWWWWWpWWSSSSS".slice(0,20),"SSSSWWWWWWWWWWwWSSSSS".slice(0,20),
    "SSSSWWWWWWWWWWwWSSSSS".slice(0,20),"SSSSWWWWWWWWWWwWSSSSS".slice(0,20),
    "____WWWWWWWWWWwW____","____bBBBBBBBBBb_____","____JJJJJJJJJJJJ___",
    "____JJJJ____JJJJJ___","____JJjJ____JJjJJ___","____JJJJ____JJJJJ___",
    "____JJjJ____JJjJJ___","____JJJJ____JJJJJ___","____JJjJ____JJjJJ___",
    "____JJJJ____JJJJJ___","____JJjJ____JJjJJ___","____JJJJ____JJJJJ___",
    "____JJjJ____JJjJJ___","___SSSSS____SSSSS___","___NNNNN____NNNNN___",
    "___NNNnn____NNNnn___","___NNNNn____NNNNn___",
  ],{W:"#EEEEEE",w:"#CCCCDD",p:"#DDDDBB",b:"#554400",B:"#776600",J:"#3355AA",j:"#5577CC",N:"#F5F5FF",n:"#9999CC"}, skin);
}

function buildHoodie(skin) {
  return armorSprite([
    "___HHHHHHHHHHHHH____","HHHHHHHHHHHHHHHHHHH_","HHHhGGGGGGGGGGGhHHH_",
    "HHHhGGZZGGGGGZZGhHHH".slice(0,20),"GGGgGGZZGGGGGZZGgGGG".slice(0,20),
    "GGGgGGGGGGGGGGGGgGGG".slice(0,20),"GGGgGGPPPPPPPPGGgGGG".slice(0,20),
    "GGGgGGPpppppPPGGgGGG".slice(0,20),"GGGgGGPPPPPPPPGGgGGG".slice(0,20),
    "CCCcCCCCCCCCCCCCcCCC".slice(0,20),"____DDDDDDDDDDDD____",
    "____DDdD____DDdD____","____DDDD____DDDD____","____DDdD____DDdD____",
    "____DDDD____DDDD____","____DDdD____DDdD____","____DDDD____DDDD____",
    "____DDdD____DDdD____","____DDDD____DDDD____","____DDdD____DDdD____",
    "____WWWW____WWWW____","___WWWWWW___WWWWWW__","___WWWwwW___WWWwwW__","___WWWWWW___WWWWWW__",
  ],{H:"#AAAAAA",h:"#888888",G:"#777788",g:"#555566",Z:"#222233",P:"#888899",p:"#666677",
     C:"#CCCCDD",c:"#9999AA",D:"#222233",d:"#334455",W:"#DDDDEE",w:"#AABBCC"}, skin);
}

function buildRobe(skin) {
  return armorSprite([
    "____RRRRRRRRRRRR____","GGRRRRRRRRRRRRRRRGG_","GRRRRRRRrRRRRRRRRGR_",
    "GRRRRRRRrRRRRRRRRGR_","_GRRRRRGcGRRRRGRGR__","_GRRRRRRRRRRRRRRGR__",
    "_GRRRRRRRRRRRRRRGR__","__GRRRRRRRRRRRRRGR__","___GRRRRRRRRRRRGRR__",
    "___GRRRRRRRRRRRGRR__","____RRRRRRRRRRRR____","____RRRrRRRRRRrRR___",
    "___RRRRRRRRRRRRRR___","___RRRrRRRRRRrRRR___","__RRRRRRRRRRRRRRRRR_",
    "__RRRrRRRRRRRRrRRRR_","_GRRRRRRRRRRRRRRRRG_","_GRRRrRRRRRRRRrRRG__",
    "_GRRRRRRRRRRRRRRRG__","_GGGRRRRRRRRRRRGGGr_","__GGGGGGRRRGGGGGGrr_",
    "____rRRR____rRRR____","____rRrr____rRrr____","________________",
  ],{R:"#2244AA",r:"#1133CC",G:"#CCAA00",c:"#FFDD44"}, skin);
}

function buildJacket(skin) {
  return armorSprite([
    "_____JJJJJJJJJJ_____","JJJJJJJJJJJJJJJJJJJ",
    "JJJJJLLJJJJJJJjJJJJJ".slice(0,20),"JJJJJLLLJJJJJjJJJJJJ".slice(0,20),
    "JJJJJILLJJJIIJjJJJJJ".slice(0,20),"JJJJJIILJJJIIJjJJJJJ".slice(0,20),
    "JJJJJIIILLIIIJjJJJJJ".slice(0,20),"JJJJJIIIIIIIIJjJJJJJ".slice(0,20),
    "JJJJJcBBBBBBBcJjJJJJJ".slice(0,20),"____PPPPPPPPPPPP____",
    "____PPPpP___PPpP____","____PPPP____PPPP____","____PPPpP___PPpP____",
    "____PPPP____PPPP____","____PPPpP___PPpP____","____PPPP____PPPP____",
    "____PPPpP___PPpP____","____PPPP____PPPP____","____PPPpP___PPpP____",
    "____PPPP____PPPP____","___BBBBB____BBBBB___","___BBBBB____BBBBB___",
    "___BBBbb____BBBbb___","___BBBBBB___BBBBBB__",
  ],{J:"#1A1A2E",j:"#2A2A44",L:"#CCBBAA",I:"#DDCCBB",c:"#AAAAAA",B:"#FFCC00",P:"#111122",p:"#223344",b:"#0A0A14"}, skin);
}

function buildPlate(skin, A, AL, AD, G) {
  return armorSprite([
    "____AAAAAAAAAAAAA___","AAAAAAAAAAAAAAAAAAAA","APAAAAAAAAAAAAAAApA_",
    "AAPAAAAAAAAAAAAAPA__","__AAAGGGGGGGGGAAA___","__AAAGGGGGGGGGAAA___",
    "__AAAAAAAAAAAAAAAA__","__AAAAAAAAAAAAAAAAA_","___GGGAAAAAAAAGGG___",
    "___TTTTTTTTTTTTT____","____AAAAD___AAAA____","____AAAA____AAAA____",
    "____AAAAD___AAAA____","____AAAA____AAAA____","____AAAAD___AAAA____",
    "____AAAA____AAAA____","____AAAAD___AAAA____","____AAAA____AAAA____",
    "____AAAAD___AAAA____","____AAAA____AAAA____","___AAGGG____AAGGG___",
    "___AGGGG____AGGGG___","___AGGGG____AGGGG___","___AGGGGG___AGGGGG__",
  ],{A,L:AL,D:AD,G,P:AD,T:A}, skin);
}

function buildWizard(skin) {
  return armorSprite([
    "_____PPPPPPPPPPP____","PPPPPPPPPPPPPPPPPPP_","PPPPPPPPsPPPPPPPPPP_",
    "PPPPPPPPsPPPPPPPPPP_","PPPPPPsPsPPPsPPPPPP_",
    "PPPPPPssRssssssPPPPP".slice(0,20),"PPPPPPsPsPPPsPPPPPP_",
    "PPPPPPPPsPPPPPPPPPP_","PPPPPPPPPPPPPPPPPPP_",
    "PPPPssssssssssssPPPP".slice(0,20),"_PPPPPPPPPPPPPPPPP__",
    "_PPrPPPPPPPPPPPrPP__","__PPPPPPPPPPPPPPPP__","__PPrPPPPPPPPPrPP___",
    "__PPPPPPPPPPPPPPPPP_","__PPrPPPPPPPPPrPPP__","___PPPPPPPPPPPPPPr__",
    "___PPrPPPPPPPrPPPP__","___PPPPPPPPPPPPPPP__","___PPPPPPPPPPPPPrr__",
    "____rPPPPPPPPPPrP___","_____QQQQ____QQQQ___","_____QQqqqq__QQqqq__","______qqq____qqq____",
  ],{P:"#5511AA",p:"#3300AA",s:"#FFDD88",R:"#FFDD44",r:"#FF88FF",Q:"#220044",q:"#440088"}, skin);
}

function buildDragonScale(skin) {
  return armorSprite([
    "____DDDDDDDDDDDD____","_SSDDDDDDDDDDDDDSS__","SSDDDDDDDDDDDDDDDDSS".slice(0,20),
    "_SSDDDDDDDDDDDDDSS__","__DDDsDDDsDDDsDDD___","__DsDDsDDDsDDDsDDD__",
    "__DDDsDDDsDDDsDDD___","__DsDDsDDDsDDDsDDD__","__DDDsDDDsDDDsDDD___",
    "__DsDDcDDDcDDDsDDD__","____DDDD____DDDD____","____DsDsD___DsDsD___",
    "____DDDD____DDDD____","____DsDsD___DsDsD___","____DDDD____DDDD____",
    "____DsDsD___DsDsD___","____DDDD____DDDD____","____DsDsD___DsDsD___",
    "____DDDD____DDDD____","____DsDsD___DsDsD___","___CCCCC____CCCCC___",
    "___CCcCC____CCcCC___","___cCCCC____cCCCC___","___CCCCCC___CCCCCC__",
  ],{D:"#1A3A20",d:"#0A2010",s:"#2A5A30",S:"#FF6600",c:"#334422",C:"#111A10"}, skin);
}

const ARMOR_FACTORIES_AV = {
  armor_shirt_basic:   buildTShirt,
  armor_hoodie_gray:   buildHoodie,
  armor_robe_blue:     buildRobe,
  armor_jacket_cool:   buildJacket,
  armor_knight_silver: sk => buildPlate(sk,"#9AAABB","#CCDDEE","#667788","#BBBB99"),
  armor_knight_gold:   sk => buildPlate(sk,"#BB9922","#EEDD55","#886611","#FFFFFF"),
  armor_wizard_purple: buildWizard,
  armor_dragon_scale:  buildDragonScale,
  // ── Fighting-game gi outfits ──────────────────────────────────────────────
  armor_gi_white: function(skin) {
    return armorSprite([
      "____SWWwWWWwWWWS____","SSSsWWWWWWWWWWWSSSs_","SSsWWWLLLLLWWWWSSs__",
      "SSsWWLLwwLLLWWWSss__","____WWLLwwWLLWW_____","_____WWwWWWWWWW_____",
      "_____WWWWWWWwWW_____","_____wWWWWWWwWWW____","_____bBBBBBBBb______",
      "___JJJJJJJJJJJJJJ__","___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__",
      "___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__","____JJJJj__jJJJJ____",
      "____JjJJJ__JJJjJ____","____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____",
      "____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____","____ssss___ssss_____",
      "____SSSS___SSSS_____","____SSSS___SSSS_____","___sSSSss__sSSSss___",
    ],{W:"#F0EEE8",w:"#D0CECC",L:"#B0ACA6",b:"#111111",B:"#1A1A10",J:"#EBEBEB",j:"#C8C8C4"}, skin);
  },
  armor_gi_red: function(skin) {
    return armorSprite([
      "____SSSSSSSSSSss____","SSSSSSSSSSSSSSSSSSs_","SSssSSSSSSSSSSSSss__",
      "SSssSSSSSSSSSSSSss__","____SSSSSSSSSSss____","_____SSSSSSSSSss____",
      "_____SSSSSSSSss_____","_____SSSSSSSss______","_____PPPPPPPPPP_____",
      "___JJJJJJJJJJJJJJ__","___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__",
      "___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__","____JJJJj__jJJJJ____",
      "____JjJJJ__JJJjJ____","____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____",
      "____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____","____ssss___ssss_____",
      "____SSSS___SSSS_____","____SSSS___SSSS_____","___sSSSss__sSSSss___",
    ],{P:"#E85080",J:"#CC2222",j:"#8B0000"}, skin);
  },
  armor_gi_blue: function(skin) {
    return armorSprite([
      "____SSSSSSSSSSss____","SSSSSSSSSSSSSSSSSSs_","SSssSSSSSSSSSSSSss__",
      "SSssSSSSSSSSSSSSss__","____SSSSSSSSSSss____","_____SSSSSSSSSss____",
      "_____SSSSSSSSss_____","_____SSSSSSSss______","_____bBBBBBBBBBb____",
      "___JJJJJJJJJJJJJJ__","___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__",
      "___JJJJJj__jJJJJJ__","___JjJJJJ__JJJJjJ__","____JJJJj__jJJJJ____",
      "____JjJJJ__JJJjJ____","____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____",
      "____JJJJj__jJJJJ____","____JjJJJ__JJJjJ____","____ssss___ssss_____",
      "____SSSS___SSSS_____","____SSSS___SSSS_____","___sSSSss__sSSSss___",
    ],{b:"#AA8800",B:"#FFDD00",J:"#2244AA",j:"#1133CC"}, skin);
  },
};

// ── Headgear ────────────────────────────────────────────────
function headSprite(rows, p) {
  const full = Array.from({length:48}, ()=>Array(20).fill(null));
  spr(rows.map(r=>r.padEnd(20,'_').slice(0,20)), p).forEach((row,i) => { if(i<8) full[i]=row; });
  return full;
}
function makeCrown(M,ML,D,J1,J2) {
  return headSprite([
    "____________________","_M____M____M____M___","_MM__MMM__MMM__MM___",
    "_MMMMMMMMMMMMMMMM___","_MMMMMMMMMMMMMMMM___","_MMMMMMMMMMMMMMMM___",
    "_MMMMMMMMMMMMMMMM___","____________________",
  ],{M,L:ML,D,'1':J1,'2':J2});
}

const HEADGEAR_SPRITES_AV = {
  hat_baseball_red:  () => headSprite(["____RRRRRRRRRRRR____","___RRRrRRRRRRrRRR___","__RRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRR__","BBBBBBBBBBBBBBBBBBBB","_BBBBBBBBBBBBBBBBBBB".slice(0,20),"____________________","____________________"],{R:"#CC2222",r:"#FF4444",B:"#111111"}),
  hat_beanie_blue:   () => headSprite(["____BBBBBBBBBBBB____","___BBBBbBBBBbBBBB___","__BBBBBBBBBBBBBBBB__","__BBBBBBBBBBBBBBBB__","__BBBBBBBBBBBBBBBB__","____________________","____________________","____________________"],{B:"#2244AA",b:"#4466CC"}),
  hat_wizard:        () => headSprite(["_________P__________","________PPP_________","_______PPPPP________","______PPSPPPP_______","_____PPPPPPPPP______","____PPPPPPPPPPP_____","___GGGGGGGGGGGGGG___","__GGGGGGGGGGGGGGGGG_"],{P:"#5511AA",S:"#FFDD44",G:"#FFCC00"}),
  hat_crown_bronze:  () => makeCrown("#AA7722","#DD9933","#884400","#CC2244","#2244CC"),
  hat_crown_silver:  () => makeCrown("#999999","#CCCCCC","#667788","#4499FF","#44CC88"),
  hat_crown_gold:    () => makeCrown("#CC9900","#FFDD22","#AA7700","#FF44AA","#44FFAA"),
  hat_headphones:    () => headSprite(["___BBBBBBBBBBBBBB___","__BBBBBBBBBBBBBBBb__","__BBBBBBBBBBBBBBB___","__BBB___________BBB_","__BBB___________BBB_","____________________","____________________","____________________"],{B:"#222222",b:"#444444"}),
  hat_ninja:         () => headSprite(["NNNNNNNNNNNNNNNNNNNN","NNNNNNNNNNNNNNNNNNNN","NNNNNNNNNNNNNNNNNNNN","NNNN____________NNNN","NNNN____________NNNN","NNNNNNNNNNNNNNNNNNNN","____________________","____________________"],{N:"#111122"}),
  hat_samurai:       () => headSprite(["____SSSSSSSSSSSS____","___SSSSSSSSSSSSSS___","__SSSSSSSSSSSSSSSS__","__SSSsSSSSSSSSsSS___","__SSSSSSSSSSSSSSSS__","__SSSSSSSSSSSSSSSS__","__GGGGGGGGGGGGGGGG__","____________________"],{S:"#888899",s:"#AABBCC",G:"#CCAA00"}),
  // ── Fighting-game headbands ───────────────────────────────────────────────
  hat_headband_red:   () => headSprite(["____________________","____________________","__RRRRRRRRRRRRRRRR__","__RrRRRRRRRRRRRRrR__","____________________","____________________","____________________","____________________"],{R:"#DD2222",r:"#AA0000"}),
  hat_headband_blue:  () => headSprite(["____________________","____________________","__BBBBBBBBBBBBBBBBB_","__BbBBBBBBBBBBBBbB__","____________________","____________________","____________________","____________________"],{B:"#2255DD",b:"#1133AA"}),
  hat_headband_white: () => headSprite(["____________________","____________________","__WWWWWWWWWWWWWWWWW_","__WwWWWWWWWWWWWWwWW_","____________________","____________________","____________________","____________________"],{W:"#F0EEE8",w:"#C8C6C2"}),
};

// ── Weapons ─────────────────────────────────────────────────
function wpn(rows, p) { return spr(rows.map(r=>r.padEnd(8,'_').slice(0,8)), p); }
function makeSword(B,BL,BD,G,H) {
  return wpn(["______BL","_____BLL","____BB__","___BBB__","__BBBBD_","_BBBBBDD","GGG_BBBD","G_G_BBD_","GGG_BD__","____H___","____H___","____H___","____H___","____Hh__","____H___","____H___","________","________","________","________","________","________","________","________"],{B,L:BL,D:BD,G,H,h:"#AA8844"});
}
function makeStaff(S,SL,G,GL) {
  return wpn(["___GL___","__GGlGG_","_GGG_GG_","__GGGGG_","___GGG__","____S___","____S___","____Sl__","____S___","____S___","____S___","____Sl__","____S___","____S___","____S___","____Sl__","____S___","____S___","____Sl__","____S___","____S___","____Sl__","____S___","________"],{S,l:SL,G,L:GL});
}

const WEAPON_SPRITES_AV = {
  weapon_pencil:          () => wpn(["__YYY___","__YYYY__","_YYYYL__","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYYYYy_","_YYSSYy_","_YYYYSS_","__YYYs__","__YYss__","__SSs___","________","________","________","________","________","________","________","________","________"],{Y:"#FFEE88",y:"#CCAA22",S:"#EEEEEE",s:"#FF8866",L:"#FFFF44"}),
  weapon_ruler:           () => wpn(["_RRRRRRR","RRrRrRrR","RRrRrRrR","RRrRrRrR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","_RRRRRRR","________","________","________","________","________","________","________","________","________","________"],{R:"#EEEECC",r:"#CCAA88"}),
  weapon_sword_bronze:    () => makeSword("#AA7722","#CC9933","#776611","#CCAA00","#5C3010"),
  weapon_sword_silver:    () => makeSword("#AABBCC","#DDEEFF","#778899","#CCCCAA","#3A2A1A"),
  weapon_sword_excalibur: () => makeSword("#DDBB00","#FFEE44","#AA8800","#FFFFFF","#4A3020"),
  weapon_staff_wood:      () => makeStaff("#7A4A18","#9A6A28","#556622","#779933"),
  weapon_staff_crystal:   () => makeStaff("#335588","#4477BB","#2299CC","#44CCEE"),
  weapon_staff_legendary: () => makeStaff("#551188","#8833CC","#CC4400","#FF8833"),
};

const DUAL_WIELD_AV = new Set(["weapon_sword_bronze","weapon_sword_silver","weapon_sword_excalibur"]);
const PET_MOUNTS_AV = new Set(["pet_dragon_baby","pet_phoenix","pet_unicorn","pet_dragon_ancient","pet_lion_golden"]);

// ── Small pet sprites (14×14) ───────────────────────────────
function sp(rows, p) { return spr(rows.map(r=>r.padEnd(14,'_').slice(0,14)), p); }
const SMALL_PET_SPRITES_AV = {
  pet_cat_orange: () => sp(["_____oo_______","____oOOo______","___OOWEOo_____","___OOmOOO_____","___OOOOOOO____","__OOOOOOOoT___","__OOoOOOoTTT__","__OOOOOOOTTTT_","___OOOOOOTT___","___OOOOO_TT___","____oooo______","____________","____________","____________"],{O:"#DD7733",o:"#BB5511",W:"#EEEECC",E:"#111122",m:"#FF7744",T:"#CC4400"}),
  pet_dog_brown:  () => sp(["__BBB_________","_BBBBB________","_BbBEBb_______","_BBmBBBB______","_BBBBBBB______","BBBBBBBB______","BBBbBBBBt_____","_BBBBBBBtt____","_BBBB_BB______","_BBBB_BB______","_BBBBoBBBo____","____ooo_______","____________","____________"],{B:"#8B5523",b:"#6B3A0F",E:"#111122",m:"#FF8877",t:"#FF5544",o:"#5C3010"}),
  pet_owl:        () => sp(["____BBBB______","___BBBBBB_____","__BBWEBWBb____","__BBBOBBBb____","__BBBBBBBb____","__BBBBBBBB____","__BBbBBBBb____","___BBBBBBB____","___BBBBBBB____","___bYbYbYb____","____________","____________","____________","____________"],{B:"#8B6030",b:"#5C3010",W:"#FFEECC",E:"#111122",O:"#FF8800",Y:"#FFEE00"}),
  pet_panda:      () => sp(["___BWWWWB_____","__BWWWWWWB____","__BWEWEWBb____","__BBmWWWBb____","__BWWWWWWB____","__BWWWWWWB____","__bBBBBBBb____","___WWWWWW_____","___WWWWWW_____","____WWWW______","____________","____________","____________","____________"],{B:"#111111",W:"#EEEEEE",b:"#222222",E:"#111122",m:"#FF8877"}),
  pet_fox:        () => sp(["__WW__________","_WWWW_________","WWWWWW________","WwWEWW________","WwWmWW________","_WWWWWW_______","_WWwWWW_______","__WWWWW_______","__WWWWW_______","___WWWW_______","____________","____________","____________","____________"],{W:"#CC6600",w:"#AA4400",E:"#111122",m:"#111122"}),
};

// Mount sprites (48×22) — simplified versions
function mp(rows, p) { return spr(rows.map(r=>r.padEnd(48,'_').slice(0,48)), p); }
const MOUNT_PET_SPRITES_AV = {
  pet_dragon_baby: () => mp(["____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG____","___GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG___","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","__GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG__","___GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG____","____GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG______","_____GGGGGGGGG___________________GGGGGGGGG_____","______GGGGGGG_____________________GGGGGGG______","_______GGGGG_______________________GGGGG_______","________GGG_________________________GGG________","________GGG_________________________GGG________","________GGG_________________________GGG________","________GGG_________________________GGG________","________GGG_________________________GGG________","_________GG___________________________GG________","_________GG___________________________GG________"],{G:"#116611",g:"#0a440a"}),
  pet_phoenix:     () => mp(["____RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR____","___RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR___","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR_","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","__RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR__","___RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR____","____RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR______","_____RRRRRRRRR___________________RRRRRRRRR_____","______RRRRRRRR____________________RRRRRRRR_____","_______RRRRR_______________________RRRRR_______","________RRR_________________________RRR________","________RRR_________________________RRR________","________RRR_________________________RRR________","________RRR_________________________RRR________","________RRR_________________________RRR________","_________RR___________________________RR________","_________RR___________________________RR________"],{R:"#CC3311",r:"#AA2200"}),
  // ── Unicorn — white, golden horn, rainbow mane ──────────────────────────
  pet_unicorn: () => mp([
    "________________________________________________",
    "________________________________________________",
    "_____________________HHHHH______________________",
    "____________________HHhhhHH_____________________",
    "___________________MMMMMMUUUUUU_________________",
    "__________________MMMmMMUUUUUUUU________________",
    "_________________MMMmMMUUUUUUUUUU_______________",
    "__________________MMMmMUUUUuUUUUUUU_____________",
    "___________________MMMUUUUUUUUUUUUU_____________",
    "____________________UUUUUUUUUUUUUUU_____________",
    "____________________UUUUUUUUUUUUUU______________",
    "_____________________UUUUUUUUUUUUU_____________",
    "______________________UUUU_______UUUU___________",
    "_____________________UUUUU_______UUUUU__________",
    "_____________________UUUUU_______UUUUU__________",
    "______________________UUUU________UUUU__________",
    "______________________UUUU________UUUU__________",
    "_______________________UU__________UU___________",
    "________________________________________________",
    "________________________________________________",
    "________________________________________________",
    "________________________________________________",
  ],{U:"#F5F0FF",u:"#E0D8F8",H:"#FFDD00",h:"#FFB800",M:"#FF88CC"}),
  // ── Ancient Dragon — dark crimson, imposing ──────────────────────────────
  pet_dragon_ancient: () => mp([
    "___DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD_____",
    "__DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD___",
    "_DDDDDDDDDDDDdDDDDDDDDDDDDDDDdDDDDDDDDDDDDDD__",
    "_DDDDDDDDDDDdDDDDDDDDDDDDDDDDdDDDDDDDDDDDDDD__",
    "_DDDDDDDDDDdDDDDDDDDDDDDDDDDDdDDDDDDDDDDDDDD__",
    "__DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD___",
    "___DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD_____",
    "____DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD______",
    "_____DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD_______",
    "______DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD________",
    "_______DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD_________",
    "________DDDDDDDDDDDDDDDDDDDDDDDDDDDDD__________",
    "_________DDDDDDD___________DDDDDDD_____________",
    "________DDDDDDDD___________DDDDDDDD____________",
    "_________DDDDDD_____________DDDDDD_____________",
    "_________DDDDD_______________DDDDD_____________",
    "__________DDD_________________DDD______________",
    "__________DDD_________________DDD______________",
    "__________DDD_________________DDD______________",
    "__________DDD_________________DDD______________",
    "___________D___________________D_______________",
    "___________D___________________D_______________",
  ],{D:"#5C0000",d:"#8B0000"}),
  // ── Golden Lion — tawny gold, dark mane ─────────────────────────────────
  pet_lion_golden: () => mp([
    "________________________________________________",
    "________________________________________________",
    "__________________MMMMMMMMMMMM__________________",
    "_________________MMMmMMMMMMmMMM_________________",
    "________________MMmMMMMMMMMMmMM_________________",
    "____LLLLLLL_____MMmMMMMMMMMmMMM_________________",
    "___LLLlLLLL_____MMMMMMMMMMMMMM__________________",
    "__LLLllLLLLLLLLLLLLLLLLLLLLLLL_________________",
    "__LLLLLLLLLLLLLLLLLLLLLLLLLLLLLL________________",
    "___LLLLLLLLLLLLLLLLLLLLLLLLLLLLL________________",
    "____LLLLLLLLLLLLLLLLLLLLLLLLLLL_________________",
    "_____LLLLLLLLLLLLLLLLLLLLLLLLLL_________________",
    "______LLLLL______________LLLLL__________________",
    "_____LLLLLL______________LLLLLL_________________",
    "______LLLLL_______________LLLLL_________________",
    "______LLLL_________________LLLL_________________",
    "______LLLL_________________LLLL_________________",
    "______LLLL_________________LLLL_________________",
    "_______LLL__________________LLL_________________",
    "_______LLL__________________LLL_________________",
    "________LL___________________LL_________________",
    "________tt___________________tt_________________",
  ],{L:"#CC9922",l:"#AA7700",M:"#2A1000",m:"#3D1800",t:"#886600"}),
};

// ── Main avatar render function ─────────────────────────────
function renderAvatar(canvas, equipped, scale) {
  scale = scale || 4;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const {CW, CH, CHAR_X, CHAR_Y, CHAR_Y_MOUNTED, MOUNT_X, MOUNT_Y, SPET_X, SPET_Y,
         WEAPON_X, WEAPON_Y, WEAPON_LEFT_X, WEAPON_LEFT_Y, L_ARM_X, L_ARM_Y, R_ARM_X, R_ARM_Y} = AVATAR_CONST;

  const skinId   = equipped.skin_id  || 'ivory';
  const hairId   = equipped.hair_id  || 'black';
  const armorId  = equipped.armor    || equipped.outfit_id || 'armor_shirt_basic';
  const petId    = equipped.pet      || '';
  const weaponId = equipped.weapon   || '';
  const headId   = equipped.headgear || '';

  const skin = getSkin(skinId);
  const hair = getHair(hairId);

  const isMount = PET_MOUNTS_AV.has(petId);
  const isSmall = !isMount && !!SMALL_PET_SPRITES_AV[petId];
  const charY   = isMount ? CHAR_Y_MOUNTED : CHAR_Y;
  const hasWpn  = !!weaponId && !!WEAPON_SPRITES_AV[weaponId];
  const isDual  = hasWpn && DUAL_WIELD_AV.has(weaponId);
  const isGi    = armorId === 'armor_gi_white' || armorId === 'armor_gi_red' || armorId === 'armor_gi_blue';

  ctx.clearRect(0, 0, CW * scale, CH * scale);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(scale, scale);

  if (isMount && MOUNT_PET_SPRITES_AV[petId])
    blit(ctx, MOUNT_PET_SPRITES_AV[petId](), MOUNT_X, MOUNT_Y);
  if (isSmall && SMALL_PET_SPRITES_AV[petId])
    blit(ctx, SMALL_PET_SPRITES_AV[petId](), SPET_X, SPET_Y);

  // ── Body-type-aware arms ───────────────────────────────────
  const bodyType = equipped.body_type_id || 'male_default';
  const isSkinny    = bodyType === 'male_default';
  const isMuscular  = bodyType === 'male_athletic';
  // female types use standard arm width
  const armDown = isSkinny ? buildArmDownSkinny(skin) : isMuscular ? buildArmDownMuscular(skin) : buildArmDown(skin);
  const armUp   = isSkinny ? buildArmUpSkinny(skin)   : isMuscular ? buildArmUpMuscular(skin)   : buildArmUp(skin);

  const L_OFF = isMuscular ? -1 : (isSkinny ? 1 : 0);
  const R_OFF = isMuscular ? 1  : (isSkinny ? -1 : 0);

  if (isDual || isGi)
    blit(ctx, armUp,   L_ARM_X + L_OFF, charY + L_ARM_Y - CHAR_Y);
  else
    blit(ctx, armDown, L_ARM_X + L_OFF, charY + L_ARM_Y - CHAR_Y);

  if (hasWpn || isGi)
    blit(ctx, armUp,   R_ARM_X + R_OFF, charY + R_ARM_Y - CHAR_Y);
  else
    blit(ctx, armDown, R_ARM_X + R_OFF, charY + R_ARM_Y - CHAR_Y);

  const armorFn = ARMOR_FACTORIES_AV[armorId] || ARMOR_FACTORIES_AV['armor_shirt_basic'];
  blit(ctx, armorFn(skin), CHAR_X, charY);
  // Use female head sprite if body type is female
  const isFemale = bodyType === 'female_elegant' || bodyType === 'female_sporty';
  const headSprite = (isFemale && typeof buildFemaleHead === 'function') ? buildFemaleHead(skin, hair) : buildHead(skin, hair);
  blit(ctx, headSprite, CHAR_X, charY);

  if (headId && HEADGEAR_SPRITES_AV[headId])
    blit(ctx, HEADGEAR_SPRITES_AV[headId](), CHAR_X, charY);
  if (hasWpn && WEAPON_SPRITES_AV[weaponId])
    blit(ctx, WEAPON_SPRITES_AV[weaponId](), WEAPON_X, charY + WEAPON_Y);
  if (isDual && WEAPON_SPRITES_AV[weaponId])
    blit(ctx, mirrorX(WEAPON_SPRITES_AV[weaponId]()), WEAPON_LEFT_X, charY + WEAPON_LEFT_Y);

  ctx.restore();
}

// ── Fetch equipped items from backend and render ────────────
// preloadedEquipped: optional object passed directly (avoids a /shop fetch)
async function initPlayerAvatar(canvasId, scale, backendUrl, preloadedEquipped) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  backendUrl = backendUrl || window.BACKEND_URL || 'http://localhost:8000';
  scale = scale || 3;

  function normalise(equipped) {
    return {
      skin_id:      equipped.skin_id      || 'ivory',
      hair_id:      equipped.hair_id      || 'black',
      body_type_id: equipped.body_type_id || 'male_default',
      armor:        equipped.armor        || equipped.outfit_id || 'armor_shirt_basic',
      headgear:     equipped.headgear     || '',
      weapon:       equipped.weapon       || '',
      pet:          equipped.pet          || '',
    };
  }

  function render(equippedNorm) {
    canvas.width  = 64 * scale;
    canvas.height = 82 * scale;
    renderAvatar(canvas, equippedNorm, scale);
    canvas.dataset.equipped = JSON.stringify(equippedNorm);
  }

  // Use preloaded data if provided (passed via URL param from React)
  if (preloadedEquipped && typeof preloadedEquipped === 'object') {
    render(normalise(preloadedEquipped));
    return normalise(preloadedEquipped);
  }

  // Otherwise fetch from /avatar endpoint (more accurate than /shop for equipped cosmetics)
  try {
    const res = await fetch(`${backendUrl}/avatar`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const equippedNorm = normalise(data.equipped || {});
      render(equippedNorm);
      return equippedNorm;
    }
  } catch(e) {
    console.warn('Avatar load failed, using default:', e);
  }

  // Fallback: default avatar
  render(normalise({}));
}