// Pictures shrunk in the browser before they go anywhere (a chat attachment, Files stage 3; a photo or a scanned page
// for the AI to read, stage 4): at most IMAGE_MAX_PX on the long side, as JPEG on white. Cheaper, faster, and still
// sharp enough to read.
export const IMAGE_MAX_PX = 1600;

export class ImageReadError extends Error {}

export interface ShrunkImage { mime: string; data: string; preview: string }

/** A canvas as JPEG: base64 data (no "data:" prefix) and the data URL for a preview. */
export function canvasJpeg(canvas: HTMLCanvasElement): ShrunkImage {
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { mime: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1), preview };
}

async function shrink(file: File): Promise<ShrunkImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageReadError(`${file.name} couldn't be read as a picture.`);
  ctx.fillStyle = "#fff";                                             // transparent PNGs on white, not black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvasJpeg(canvas);
}

let impl = shrink;
/** Tests replace how pictures are shrunk (jsdom has no canvas). */
export function setImageShrinkForTests(f: ((file: File) => Promise<ShrunkImage>) | null) { impl = f ?? shrink; }

export const shrinkImage = (file: File) => impl(file);
