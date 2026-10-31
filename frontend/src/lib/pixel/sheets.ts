/**
 * Swappable art. Drop PNG sprite sheets into /public/sprites and list them in /public/sprites/manifest.json; any
 * hero, boss or stage listed there is drawn from the sheet instead of the hand-coded sprite. Nothing listed (the
 * default) = the procedural art. Format: docs/pixel-sprites.md.
 *
 *   { "heroes": { "kaien": { "src": "/sprites/kaien.png", "frameWidth": 96, "frameHeight": 112, "anchor": [48, 108],
 *                             "anims": { "idle": { "row": 0, "frames": 4, "fps": 6 }, "attack": { "row": 1, ... } } } },
 *     "bosses": { "hydra": { ... } },
 *     "stages": { "swamp": { "src": "/sprites/stage-swamp.png" } } }
 *
 * Sheet frames face RIGHT, like the procedural ones. An animation the sheet lacks falls back to its idle row.
 */
export interface SheetAnim { row: number; frames: number; fps?: number; loop?: boolean }
export interface SheetEntry { src: string; frameWidth: number; frameHeight: number; anchor: [number, number]; anims: Record<string, SheetAnim> }
export interface Manifest { heroes?: Record<string, SheetEntry>; bosses?: Record<string, SheetEntry>; stages?: Record<string, { src: string }> }

export interface LoadedSheet { entry: SheetEntry; image: HTMLImageElement }

let manifest: Promise<Manifest> | null = null;
const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    manifest = fetch("/sprites/manifest.json", { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return manifest;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** The sheet for a hero / boss id, or null (use the procedural sprite). */
export async function sheetFor(kind: "heroes" | "bosses", id: string): Promise<LoadedSheet | null> {
  const entry = (await loadManifest())[kind]?.[id];
  if (!entry) return null;
  const image = await loadImage(entry.src);
  return image ? { entry, image } : null;
}

export async function stageImageFor(id: string): Promise<HTMLImageElement | null> {
  const entry = (await loadManifest()).stages?.[id];
  return entry ? loadImage(entry.src) : null;
}

/** Source rectangle for one frame of a sheet animation. */
export function sheetFrame(s: LoadedSheet, anim: string, index: number) {
  const a = s.entry.anims[anim] ?? s.entry.anims.idle;
  const i = ((index % a.frames) + a.frames) % a.frames;
  return { sx: i * s.entry.frameWidth, sy: a.row * s.entry.frameHeight, sw: s.entry.frameWidth, sh: s.entry.frameHeight, frames: a.frames };
}
