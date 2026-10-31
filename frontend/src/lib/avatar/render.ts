// THE avatar renderer. The shop preview, inventory, avatar tab, header (drawFigure), the profile menu (drawFace),
// item icons (drawIcon) and the hero forge's live preview all draw through this file: they differ only in the
// options they pass, never in how a pixel is placed.
import {
  ARMS, EYE_COLORS, HAIR_COLORS, HEADGEAR, HEADS, ICONS, LAYOUT, LIP_COLORS, OUTFITS, PETS, SKIN_TONES, WEAPONS,
  bodyShape, type EyeColor, type LipColor, type SpriteData,
} from "./sprites";

/** What a hero looks like. Every field is an id; an unknown or missing one falls back to the first/none. */
export interface Look {
  bodyTypeId?: string; skinId?: string; hairId?: string; eyeColorId?: string; lipColorId?: string;
  armorId?: string; headId?: string; weaponId?: string; petId?: string;
}

export interface FigureOptions {
  /** Canvas pixels per sprite pixel. */
  scale: number;
  /** "display": ground shadow, scanlines (scale >= 4) and a top-light (scale >= 5). "shadow": the shadow only (the forge). */
  finish?: "display" | "shadow";
  /** Draw the outfit made for the body type when there is one (the forge); otherwise the shared outfit (everywhere else). */
  bodyTypedOutfit?: boolean;
}

type Tokens = Record<string, string>;
const byId = <T extends { id: string }>(list: readonly T[], id?: string): T => list.find((x) => x.id === id) ?? list[0];

/** Mix a hex colour 45% of the way to white (the lower-lip highlight). */
function lighten(hex: string): string {
  const mix = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.min(255, Math.round(v + (255 - v) * 0.45)).toString(16).padStart(2, "0");
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

function tokensOf(look: Look, eye: EyeColor = byId(EYE_COLORS, look.eyeColorId), lip: LipColor = byId(LIP_COLORS, look.lipColorId)): Tokens {
  const s = byId(SKIN_TONES, look.skinId), h = byId(HAIR_COLORS, look.hairId);
  return {
    "$skin.b": s.b, "$skin.m": s.m, "$skin.d": s.d, "$skin.o": s.o,
    "$hair.c": h.c, "$hair.h": h.h,
    "$eye.iris": eye.iris, "$eye.pupil": eye.pupil, "$lip.color": lip.color, "$lip.light": lighten(lip.color),
  };
}

/** Paint a sprite with its top-left at (ox, oy) in the context's units, a pixel at a time, row by row. */
function paint(ctx: CanvasRenderingContext2D, sp: SpriteData, tokens: Tokens, ox: number, oy: number, mirror = false) {
  const colors: Record<string, string> = {};
  for (const [ch, c] of Object.entries(sp.palette)) colors[ch] = tokens[c] ?? c;
  sp.rows.forEach((row, j) => {
    const cols = row.length;
    for (let n = 0; n < cols; n++) {
      const i = mirror ? cols - 1 - n : n;
      const ch = row[i];
      if (ch === ".") continue;
      ctx.fillStyle = colors[ch];
      ctx.fillRect(ox + (mirror ? sp.w - 1 - (sp.x + i) : sp.x + i), oy + sp.y + j, 1, 1);
    }
  });
}

/** The whole hero (64 x 82 sprite pixels) with pet, arms, outfit, head, headgear and weapon(s). */
export function drawFigure(ctx: CanvasRenderingContext2D, look: Look, { scale, finish = "display", bodyTypedOutfit = false }: FigureOptions) {
  const L = LAYOUT, tokens = tokensOf(look);
  const bodyTypeId = look.bodyTypeId || "male_default";
  const body = bodyShape(bodyTypeId);
  const armorId = look.armorId || "armor_bare_basic", petId = look.petId || "", weaponId = look.weaponId || "", headId = look.headId || "";

  const isMount = L.mounts.includes(petId);
  const smallPet = !isMount ? PETS.small[petId] : undefined;
  const charY = isMount ? L.CHAR_Y_MOUNTED : L.CHAR_Y;
  const weapon = weaponId ? WEAPONS[weaponId] : undefined;
  const isDual = !!weapon && L.dualWield.includes(weaponId);
  const guard = L.guardStance.includes(armorId);            // fighting stance: both arms up

  const W = L.CW * scale, H = L.CH * scale;
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(scale, scale);

  if (isMount && PETS.mount[petId]) paint(ctx, PETS.mount[petId], tokens, L.MOUNT_X, L.MOUNT_Y);
  if (smallPet) paint(ctx, smallPet, tokens, L.SPET_X, L.SPET_Y);

  const arms = ARMS[body.arms], ax = L.armX[body.arms];
  paint(ctx, isDual || guard ? arms.up : arms.down, tokens, ax.L, charY + L.L_ARM_Y - L.CHAR_Y);
  paint(ctx, weapon || guard ? arms.up : arms.down, tokens, ax.R, charY + L.R_ARM_Y - L.CHAR_Y);

  const outfit = (bodyTypedOutfit ? OUTFITS.byBody[bodyTypeId]?.[armorId] : undefined)
    ?? (body.female ? OUTFITS.female[armorId] : undefined) ?? OUTFITS.default[armorId] ?? OUTFITS.default.armor_bare_basic;
  paint(ctx, outfit, tokens, L.CHAR_X, charY);
  paint(ctx, HEADS[body.head], tokens, L.CHAR_X, charY);
  if (headId && HEADGEAR[headId]) paint(ctx, HEADGEAR[headId], tokens, L.CHAR_X, charY);
  if (weapon) paint(ctx, weapon, tokens, L.WEAPON_X, charY + L.WEAPON_Y);
  if (isDual) paint(ctx, weapon, tokens, L.WEAPON_LEFT_X, charY + L.WEAPON_LEFT_Y, true);
  ctx.restore();

  if (finish === "shadow" || scale >= 4) {                  // soft ground shadow
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000020";
    ctx.beginPath();
    ctx.ellipse(W / 2, H - scale * 3, W * 0.28, scale * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (finish === "display" && scale >= 4) {                 // scanlines
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = "#000000";
    const lineH = Math.max(1, Math.floor(scale / 3));
    for (let y = 0; y < H; y += scale) ctx.fillRect(0, y, W, lineH);
    ctx.restore();
  }
  if (finish === "display" && scale >= 5) {                 // top-light
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.35);
    grad.addColorStop(0, "rgba(200,220,255,0.07)");
    grad.addColorStop(1, "rgba(200,220,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/** Head-and-shoulders portrait in a gold-ringed circle `diameter` px across (the profile menu). */
export function drawFace(ctx: CanvasRenderingContext2D, look: Look, diameter: number) {
  const L = LAYOUT, fd = L.faceDefaults;
  const portraitW = L.FACE_COL_END - L.FACE_COL_START + 1, portraitH = L.FACE_ROW_END - L.FACE_ROW_START + 1;
  const scale = Math.max(2, Math.floor(diameter / portraitH));
  const offW = portraitW * scale, offH = portraitH * scale;
  const tokens = tokensOf(look, { id: "", label: "", iris: fd.iris, pupil: fd.pupil }, { id: "", label: "", color: fd.lip });

  ctx.clearRect(0, 0, diameter, diameter);
  ctx.imageSmoothingEnabled = false;

  const off = document.createElement("canvas");             // the portrait region, drawn at pixel scale
  off.width = offW;
  off.height = offH;
  const oc = off.getContext("2d")!;
  oc.imageSmoothingEnabled = false;
  oc.save();
  oc.scale(scale, scale);
  const ox = -L.FACE_COL_START, oy = -L.FACE_ROW_START;
  paint(oc, OUTFITS.default[look.armorId ?? "armor_shirt_basic"] ?? OUTFITS.default.armor_shirt_basic, tokens, ox, oy);
  paint(oc, HEADS.male, tokens, ox, oy);
  if (look.headId && HEADGEAR[look.headId]) paint(oc, HEADGEAR[look.headId], tokens, ox, oy);
  oc.restore();

  const r = diameter / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0D0D1A";
  ctx.fill();
  ctx.clip();
  ctx.drawImage(off, (diameter - offW) / 2, (diameter - offH) / 2, offW, offH);
  ctx.restore();

  ctx.save();                                                // gold ring
  ctx.beginPath();
  ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,170,0,0.7)";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/** A 16 x 16 item icon at `scale`; an unknown id gets a "?" tile. */
export function drawIcon(ctx: CanvasRenderingContext2D, itemId: string, scale: number) {
  const dim = 16 * scale;
  ctx.clearRect(0, 0, dim, dim);
  ctx.imageSmoothingEnabled = false;
  const sprite = ICONS[itemId];
  if (!sprite) {
    ctx.save();
    ctx.fillStyle = "#3A2A5A";
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = "#8866AA";
    ctx.font = `bold ${Math.floor(dim * 0.5)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", dim / 2, dim / 2);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.scale(scale, scale);
  paint(ctx, sprite, {}, 0, 0);
  ctx.restore();
}
