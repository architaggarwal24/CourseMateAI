/**
 * The sprite clock: one timer for every animated sprite on screen, instead of one requestAnimationFrame loop each.
 *
 * Pixel sprites change frame 8-28 times a second, not 60. A loop per sprite woke the page every display frame for
 * every sprite (a dozen loops on the arena hub), so the browser never rested. Here each sprite says when its next
 * frame is due; one timer sleeps until the earliest of those, then draws every sprite due within a few ms of it.
 * With nothing on screen (sprites scrolled away, the tab hidden) there is no timer at all.
 */
type Run = (now: number) => number | null;
interface Entry { due: number; run: Run }

const entries = new Set<Entry>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = Infinity;
/** Sprites due within one display frame of each other share one wake-up (and so one paint). */
export const BATCH_MS = 16;

function arm() {
  let next = Infinity;
  for (const e of entries) next = Math.min(next, e.due);
  if (next === timerAt && timer) return;
  if (timer) { clearTimeout(timer); timer = null; }
  timerAt = next;
  if (next === Infinity) return;
  timer = setTimeout(fire, Math.max(0, next - performance.now()));
}

function fire() {
  timer = null; timerAt = Infinity;
  const now = performance.now();
  for (const e of [...entries]) {
    if (!entries.has(e) || e.due > now + BATCH_MS) continue;
    const next = e.run(Math.max(now, e.due));                         // a little early: it draws the frame it was due
    if (next === null) entries.delete(e);
    else e.due = Math.max(next, now + 1);
  }
  arm();
}

/** Run `run` at `due` (a performance.now() time); it returns when it next wants to run, or null when done. */
export function tick(due: number, run: Run): () => void {
  const e: Entry = { due, run };
  entries.add(e);
  arm();
  return () => { if (entries.delete(e)) arm(); };
}

/** How many sprites are on the clock (tests). */
export const activeTicks = () => entries.size;

/**
 * When an animation started at `start` at `fps` next changes frame after `now`: the next whole frame on its own
 * clock; null once a one-shot (not `loop`) shows its last of `count` frames.
 */
export function nextFrameAt(start: number, fps: number, now: number, count: number, loop: boolean): number | null {
  const frame = Math.floor(((now - start) / 1000) * fps);
  if (!loop && frame >= count - 1) return null;
  return start + ((frame + 1) * 1000) / fps;
}
