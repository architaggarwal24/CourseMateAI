/**
 * Champion skin previews: renders every skin on every champion (plus pets and item icons) with the pixel engine
 * in Node, and writes self-contained HTML contact sheets (PNG sprites embedded) you can open in any browser.
 *
 *   npx jiti scripts/pixel-preview.ts [outDir]        (default: ./pixel-previews)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PixelBuffer } from "../src/lib/pixel/buffer";
import { HEROES, heroAnims, type AnimName, type HeroDef } from "../src/lib/pixel/heroes";
import { itemIcon } from "../src/lib/pixel/icons";
import { PETS, PET_FRAME, PET_FRAMES, PET_OFFSET, petFrame } from "../src/lib/pixel/pets";
import { ARMOR_SKINS, HEAD_SKINS, WEAPON_SKINS, dressed, type Loadout } from "../src/lib/pixel/skins";
import { HERO_FRAME, heroFrame } from "../src/lib/pixel/sprites";
import { toPng } from "./pixel-png";

const out = resolve(process.argv[2] ?? "pixel-previews");
mkdirSync(out, { recursive: true });

const shop = JSON.parse(readFileSync(resolve(__dirname, "../src/server/game/content/shop.json"), "utf8"));
const items: Record<string, { name: string; price: number }> = {};
for (const t of shop.tiers) for (const i of t.items) items[i.id] = i;
const rarity = (id: string) => { const p = items[id]?.price ?? 0; return p >= 3000 ? "legendary" : p >= 1000 ? "epic" : p >= 300 ? "rare" : "common"; };
const nameOf = (id: string) => items[id]?.name ?? id;

/** A champion (and optionally its pet) in one frame, cropped to what was drawn. */
function figure(hero: HeroDef, anim: AnimName = "idle", i = 0, pet?: string | null): PixelBuffer {
  const pad = 40;
  const b = new PixelBuffer(HERO_FRAME.w + pad, HERO_FRAME.h);
  const pf = pet ? petFrame(pet, i) : null;
  if (pf) b.blit(pf, pad + HERO_FRAME.anchor[0] + PET_OFFSET[0] - PET_FRAME.anchor[0], HERO_FRAME.anchor[1] + PET_OFFSET[1] - PET_FRAME.anchor[1]);
  b.blit(heroFrame(hero, anim, i).buf, pad, 0);
  const [x, y, w, h] = b.bounds();
  const c = new PixelBuffer(w, h);
  for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) c.px[j * w + k] = b.px[(y + j) * b.w + x + k];
  return c;
}

const img = (b: PixelBuffer, scale = 3) =>
  `<img src="data:image/png;base64,${toPng(b).toString("base64")}" width="${b.w * scale}" height="${b.h * scale}" alt="">`;

const CSS = `body{margin:0;padding:24px;background:#0f0b24;color:#e9e5ff;font:13px/1.3 system-ui,sans-serif}
h1{font-size:18px;margin:0 0 16px} table{border-collapse:collapse} td,th{padding:6px 10px;vertical-align:bottom;text-align:center}
th{font-weight:600;color:#c4b5fd} td.l{text-align:left;max-width:160px;color:#ddd6fe} tr:nth-child(even){background:#151033}
img{image-rendering:pixelated;display:block;margin:0 auto} .r{font-size:11px;color:#a78bfa} .grid{display:flex;flex-wrap:wrap;gap:14px}
.cell{background:#151033;padding:8px;border-radius:6px;text-align:center;width:150px} .cell img{margin-bottom:6px}`;

function page(file: string, title: string, body: string) {
  writeFileSync(join(out, file), `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${CSS}</style><h1>${title}</h1>${body}`);
  console.log("wrote", join(out, file));
}

function matrix(file: string, title: string, rows: Array<[string, Loadout]>, scale = 2) {
  const head = `<tr><th></th>${HEROES.map((h) => `<th>${h.name}</th>`).join("")}</tr>`;
  const body = rows.map(([id, l]) => {
    const label = id ? `${nameOf(id)}<div class="r">${id} · ${rarity(id)}</div>` : "Champion's own look";
    return `<tr><td class="l">${label}</td>${HEROES.map((h) => `<td>${img(figure(dressed(h, l, { weapon: l.weapon ? rarity(l.weapon) : null })), scale)}</td>`).join("")}</tr>`;
  }).join("");
  page(file, title, `<table>${head}${body}</table>`);
}

matrix("1-armor.html", "Armor → outfit palettes (idle)", [["", {}], ...Object.keys(ARMOR_SKINS).map((id) => [id, { armor: id }] as [string, Loadout])]);
matrix("2-headgear.html", "Headgear → head pieces", [["", {}], ...Object.keys(HEAD_SKINS).map((id) => [id, { headgear: id }] as [string, Loadout])], 3);
matrix("3-weapons.html", "Weapons → finishes + rarity glow", [["", {}], ...Object.keys(WEAPON_SKINS).map((id) => [id, { weapon: id }] as [string, Loadout])], 2);

// pets: the idle cycle, and beside a champion
page("4-pets.html", "Pets (4-frame idle, then beside a champion)", `<table>${Object.values(PETS).map((p, n) => `<tr><td class="l">${nameOf(p.id)}<div class="r">${p.id} · ${p.flies ? "flies" : "walks"}</div></td>${
  Array.from({ length: PET_FRAMES }, (_, i) => `<td>${img(petFrame(p.id, i)!, 3)}</td>`).join("")
}<td>${img(figure(HEROES[n % HEROES.length], "idle", 0, p.id), 2)}</td></tr>`).join("")}</table>`);

// item icons (weapons shown per champion)
const icon = (id: string, heroId?: string) => { const b = itemIcon(id, { heroId, rarity: rarity(id) }); return b ? img(b, Math.max(1, Math.floor(72 / b.w))) : "—"; };
const iconCells = (ids: string[]) => `<div class="grid">${ids.map((id) => `<div class="cell">${icon(id)}<div>${nameOf(id)}</div><div class="r">${id}</div></div>`).join("")}</div>`;
const allIds = Object.keys(items);
page("5-icons.html", "Item icons (shop & inventory cards)", [
  "<h2>Armor</h2>", iconCells(allIds.filter((i) => i.startsWith("armor_"))),
  "<h2>Headgear</h2>", iconCells(allIds.filter((i) => i.startsWith("hat_"))),
  "<h2>Pets</h2>", iconCells(allIds.filter((i) => i.startsWith("pet_"))),
  "<h2>Potions &amp; titles</h2>", iconCells(allIds.filter((i) => items[i] && !/^(armor_|hat_|pet_|weapon_)/.test(i))),
  `<h2>Weapons (each champion sees their own weapon)</h2><table><tr><th></th>${HEROES.map((h) => `<th>${h.name}</th>`).join("")}</tr>${
    allIds.filter((i) => i.startsWith("weapon_")).map((id) => `<tr><td class="l">${nameOf(id)}<div class="r">${rarity(id)}</div></td>${HEROES.map((h) => `<td>${icon(id, h.id)}</td>`).join("")}</tr>`).join("")
  }</table>`,
].join(""));

// full loadouts in motion
const kits: Loadout[] = [
  { armor: "armor_knight_gold", headgear: "hat_crown_gold", weapon: "weapon_sword_excalibur", pet: "pet_lion_golden" },
  { armor: "armor_dragon_scale", headgear: "hat_samurai", weapon: "weapon_staff_legendary", pet: "pet_dragon_baby" },
  { armor: "armor_wizard_purple", headgear: "hat_wizard", weapon: "weapon_staff_crystal", pet: "pet_owl" },
  { armor: "armor_jacket_cool", headgear: "hat_ninja", weapon: "weapon_sword_silver", pet: "pet_fox" },
  { armor: "armor_legends_mantle", headgear: "hat_crown_silver", weapon: "weapon_hammer", pet: "pet_dragon_ancient" },
  { armor: "armor_gi_red", headgear: "hat_headband_red", weapon: "weapon_sword_bronze", pet: "pet_cat_orange" },
];
const anims: AnimName[] = ["idle", "attack", "win"];
page("6-loadouts.html", "Full loadouts with pets: idle · attack · win", `<table>${HEROES.map((h, n) => {
  const l = kits[n];
  const d = dressed(h, l, { weapon: l.weapon ? rarity(l.weapon) : null });
  const cells = anims.map((a) => { const poses = heroAnims(h.style)[a]; const i = a === "attack" ? Math.min(2, poses.length - 1) : 0; return `<td>${img(figure(d, a, i, l.pet), 2)}<div class="r">${a}</div></td>`; });
  return `<tr><td class="l">${h.name}<div class="r">${[l.armor, l.headgear, l.weapon, l.pet].map((x) => nameOf(x ?? "")).join("<br>")}</div></td>${cells.join("")}</tr>`;
}).join("")}</table>`);

// mastery skins (champion Lv 3 / 6 / 10): each champion in each, then all three
page("7-mastery.html", "Mastery skins (Lv 3 outfit · Lv 6 head piece · Lv 10 weapon · all three)", `<table>${HEROES.map((h) => {
  const ids = ["outfit", "head", "weapon"].map((p) => `mastery_${h.id}_${p}`);
  const looks: Loadout[] = [{}, { armor: ids[0] }, { headgear: ids[1] }, { weapon: ids[2] }, { armor: ids[0], headgear: ids[1], weapon: ids[2] }];
  return `<tr><td class="l">${h.name}<div class="r">${ids.map(nameOf).join("<br>")}</div></td>${looks.map((l, i) => `<td>${img(figure(dressed(h, l), i === 4 ? "win" : "idle", 0), 2)}<div class="r">${["own", "Lv 3", "Lv 6", "Lv 10", "full"][i]}</div></td>`).join("")}</tr>`;
}).join("")}</table>`);
