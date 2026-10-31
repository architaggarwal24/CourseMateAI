/** Browser bridge: PixelBuffers become canvases (once each - frames are cached, so are their canvases). */
import type { PixelBuffer } from "./buffer";

const canvases = new WeakMap<PixelBuffer, HTMLCanvasElement>();

export function toCanvas(buf: PixelBuffer): HTMLCanvasElement {
  let c = canvases.get(buf);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = buf.w; c.height = buf.h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(buf.w, buf.h);
  new Uint32Array(img.data.buffer).set(buf.px);
  ctx.putImageData(img, 0, 0);
  canvases.set(buf, c);
  return c;
}
