/**
 * The fight scene engine: one 480x270 canvas, scaled up with nearest-neighbour by CSS. It runs the stage (painted
 * backdrop, ambient particles, flickering lights, storms), the two fighters (sprite animations, dashes, knockback,
 * hit flashes, rage aura) and the effects (sparks, slashes, shockwaves, projectiles, shields, heal motes, the KO
 * dissolve). The React side only says WHAT happened (`play(beat)`); this decides how it looks and tells it back
 * when a blow lands (`onImpact`) so damage numbers pop at the right moment.
 *
 * Browser only (canvas). Reduced motion: no shake, flashes, dashes or particles - poses still change.
 */
import { hex, toCss, type RGBA } from "./color";
import { toCanvas } from "./canvas";
import { BOSS_ANIMS, BOSS_FPS, bossById, type BossAnim, type BossDef } from "./bosses";
import { ANIM_FPS, ANIM_LOOP, heroAnims, type AnimName, type HeroDef } from "./heroes";
import { sheetFor, sheetFrame, stageImageFor, type LoadedSheet } from "./sheets";
import { bossFrame, heroFrame, type Frame } from "./sprites";
import { GROUND_Y, STAGES, STAGE_H, STAGE_W, stageBackdrop, type ParticleKind } from "./stages";
import type { PixelBuffer } from "./buffer";

export type BeatKind =
  | "intro" | "hero-strike" | "hero-cast" | "boss-strike" | "boss-shield" | "boss-heal" | "boss-drain"
  | "boss-ko" | "hero-ko" | "rage";

export interface Beat {
  kind: BeatKind;
  /** hero-strike: a heavy blow / a weakness crit (bigger hit). */
  heavy?: boolean;
  crit?: boolean;
  /** boss-strike: the hero guarded it (no hurt, a shield flash instead). */
  blocked?: boolean;
  /** hero-strike: the blow was absorbed by the boss's shield. */
  shielded?: boolean;
  /** intro: the banner text. */
  text?: string;
  /** The turn this beat belongs to - echoed back by onImpact. */
  key?: string | number;
}

export type IntentTint = "attack" | "heavy" | "shield" | "drain" | "heal" | null;

const HERO_X = 128;
const BOSS_X = 352;
const INTENT_COLOR: Record<Exclude<IntentTint, null>, string> = {
  attack: "#ef4444", heavy: "#f97316", shield: "#38bdf8", drain: "#a855f7", heal: "#4ade80",
};

interface Tween { from: number; to: number; start: number; dur: number }
interface Actor {
  anim: string; start: number; hold: boolean;
  dx: Tween; flashUntil: number; hidden: boolean;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number; kind?: ParticleKind | "spark" | "mote" | "dust" }
interface Fx { kind: "slash" | "ring" | "orb" | "banner-flash" | "bolt"; x: number; y: number; start: number; dur: number; color: string; size: number; tx?: number; ty?: number; flip?: boolean }

export interface FightOptions {
  hero: HeroDef;
  bossId: string;
  stageId?: string;
  reduced: boolean;
  onImpact?: (side: "hero" | "boss", key: string | number | undefined) => void;
  onBanner?: (text: string, tone: "fight" | "ko" | "rage" | "lose") => void;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const tweenAt = (tw: Tween, now: number) => {
  const t = Math.max(0, Math.min(1, (now - tw.start) / Math.max(1, tw.dur)));
  return tw.from + (tw.to - tw.from) * easeOut(t);
};

export class FightScene {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private now = 0;
  private last = 0;
  private hero: HeroDef;
  private boss: BossDef;
  private stageId: string;
  private reduced: boolean;
  private h: Actor;
  private b: Actor;
  private particles: Particle[] = [];
  private ambient: Particle[] = [];
  private fx: Fx[] = [];
  private shakeUntil = 0;
  private shakeAmp = 0;
  private timers: { at: number; fn: () => void }[] = [];
  private queue: Beat[] = [];
  private busyUntil = 0;
  private rage = false;
  private intent: IntentTint = null;
  private shield = 0;
  private stormAt = 0;
  private flashSky = 0;
  private heroSheet: LoadedSheet | null = null;
  private bossSheet: LoadedSheet | null = null;
  private stageImg: HTMLImageElement | null = null;
  private bossFront = BOSS_X - 90;
  private silhouettes = new WeakMap<PixelBuffer, Map<RGBA, HTMLCanvasElement>>();
  private opts: FightOptions;
  private destroyed = false;
  /** The turn whose beats are playing (impacts report it). */
  private turn: string | number | undefined;

  constructor(private canvas: HTMLCanvasElement, opts: FightOptions) {
    this.opts = opts;
    canvas.width = STAGE_W; canvas.height = STAGE_H;
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.hero = opts.hero;
    this.boss = bossById(opts.bossId);
    this.stageId = opts.stageId ?? this.boss.stage;
    this.reduced = opts.reduced;
    const t = performance.now();
    this.now = t;
    this.h = { anim: "idle", start: t, hold: false, dx: { from: 0, to: 0, start: t, dur: 1 }, flashUntil: 0, hidden: false };
    this.b = { anim: "idle", start: t, hold: false, dx: { from: 0, to: 0, start: t, dur: 1 }, flashUntil: 0, hidden: false };
    this.measureBoss();
    this.seedAmbient();
    this.loadHeroSheet(this.hero.id);
    void sheetFor("bosses", this.boss.id).then((s) => { if (!this.destroyed) this.bossSheet = s; });
    void stageImageFor(this.stageId).then((img) => { if (!this.destroyed) this.stageImg = img; });
    this.stormAt = t + 4000;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() { this.destroyed = true; cancelAnimationFrame(this.raf); this.timers = []; this.queue = []; }

  /** A sheet that loads late must not land on a hero the player switched away from. */
  private loadHeroSheet(id: string) {
    this.heroSheet = null;
    void sheetFor("heroes", id).then((s) => { if (!this.destroyed && this.hero.id === id) this.heroSheet = s; });
  }

  setHero(hero: HeroDef) {
    const changed = hero.id !== this.hero.id;
    this.hero = hero;
    if (changed) this.loadHeroSheet(hero.id);
  }

  /** A new turn: whatever the last one was still playing is cut short, both fighters back on their marks. */
  reset() {
    this.queue = [];
    this.timers = [];
    this.busyUntil = this.now;
    this.turn = undefined;
    for (const a of [this.h, this.b]) {
      if (a.hold) continue;                     // a KO / victory pose stays
      a.dx = { from: tweenAt(a.dx, this.now), to: 0, start: this.now, dur: this.reduced ? 1 : 160 };
      a.anim = "idle"; a.start = this.now;
    }
  }
  setRage(on: boolean) { this.rage = on; }
  setIntent(i: IntentTint) { this.intent = i; }
  setShield(v: number) { this.shield = v; }

  /** Queue something that happened; beats play one after another. */
  play(beat: Beat) {
    this.queue.push(beat);
    if (this.now >= this.busyUntil) this.next();
  }

  // ── beats ──────────────────────────────────────────────────────────────────
  private next() {
    const beat = this.queue.shift();
    if (!beat) return;
    this.turn = beat.key;
    const dur = this.run(beat);
    this.busyUntil = this.now + dur;
    this.after(dur, () => this.next());
  }

  private after(ms: number, fn: () => void) { this.timers.push({ at: this.now + ms, fn }); }

  private setAnim(a: Actor, anim: string, hold = false) { a.anim = anim; a.start = this.now; a.hold = hold; }

  private move(a: Actor, to: number, dur: number) {
    const from = tweenAt(a.dx, this.now);
    a.dx = { from, to: this.reduced ? to : to, start: this.now, dur: this.reduced ? 1 : dur };
  }

  private shake(amp: number, ms: number) { if (!this.reduced) { this.shakeAmp = amp; this.shakeUntil = this.now + ms; } }

  private heroFps(anim: string) { return ANIM_FPS[anim as AnimName] ?? 8; }
  private impactAfterFrames(n: number, fps: number) { return Math.round((n * 1000) / fps); }

  private run(beat: Beat): number {
    const style = this.hero.style;
    switch (beat.kind) {
      case "intro": {
        this.h.dx = { from: -150, to: 0, start: this.now, dur: this.reduced ? 1 : 650 };
        this.setAnim(this.h, "dash");
        this.b.flashUntil = this.now + 300;
        this.after(650, () => { this.setAnim(this.h, "idle"); });
        this.opts.onBanner?.(beat.text ?? "FIGHT!", beat.text === "NEMESIS" ? "rage" : "fight");
        this.after(250, () => this.shake(3, 250));
        return 900;
      }
      case "hero-strike": {
        if (style === "mage") return this.heroProjectile(beat);
        const reach = Math.max(30, this.bossFront - HERO_X - (style === "lance" ? 62 : 38));
        this.setAnim(this.h, "dash"); this.move(this.h, reach, 200);
        const fps = this.heroFps("attack");
        this.after(200, () => this.setAnim(this.h, "attack"));
        const hit = 200 + this.impactAfterFrames(2, fps);
        this.after(hit, () => this.bossHurt(beat));
        if (style === "twin" || style === "fist") this.after(hit + 120, () => this.bossHurt({ ...beat, heavy: false }, true));
        this.after(hit + 380, () => { this.setAnim(this.h, "dash"); this.move(this.h, 0, 260); });
        this.after(hit + 640, () => this.setAnim(this.h, "idle"));
        return hit + 700;
      }
      case "hero-cast": {
        this.setAnim(this.h, "cast");
        if (!this.reduced) for (let i = 0; i < 18; i++) this.mote(HERO_X + (Math.random() - 0.5) * 30, GROUND_Y - 10 - Math.random() * 50, "#67e8f9");
        this.after(700, () => this.setAnim(this.h, "idle"));
        return 600;
      }
      case "boss-strike": {
        this.setAnim(this.b, "attack"); this.move(this.b, -46, 260);
        const hit = this.impactAfterFrames(2, BOSS_FPS.attack) + 40;
        this.after(hit, () => this.heroHurt(beat));
        this.after(hit + 260, () => this.move(this.b, 0, 320));
        this.after(hit + 340, () => this.setAnim(this.h, "idle"));
        return hit + 600;
      }
      case "boss-shield": {
        this.setAnim(this.b, "cast");
        this.fx.push({ kind: "ring", x: this.bossCenter()[0], y: this.bossCenter()[1], start: this.now, dur: 500, color: "#38bdf8", size: 70 });
        this.after(600, () => this.setAnim(this.b, "idle"));
        return 600;
      }
      case "boss-heal": {
        this.setAnim(this.b, "cast");
        if (!this.reduced) for (let i = 0; i < 22; i++) { const [x, y] = this.bossCenter(); this.mote(x + (Math.random() - 0.5) * 80, y + 30 + Math.random() * 30, "#4ade80"); }
        this.after(650, () => this.setAnim(this.b, "idle"));
        return 650;
      }
      case "boss-drain": {
        this.setAnim(this.b, "cast");
        if (!this.reduced) for (let i = 0; i < 16; i++) {
          const x = HERO_X + (Math.random() - 0.5) * 24, y = GROUND_Y - 30 - Math.random() * 40;
          const [bx, by] = this.bossCenter();
          this.particles.push({ x, y, vx: (bx - x) / 40, vy: (by - y) / 40, life: 40, max: 40, color: "#c084fc", size: 2, g: 0, kind: "mote" });
        }
        this.after(650, () => this.setAnim(this.b, "idle"));
        return 650;
      }
      case "rage": {
        this.setAnim(this.b, "cast");
        this.shake(5, 600);
        this.fx.push({ kind: "ring", x: this.bossCenter()[0], y: this.bossCenter()[1], start: this.now, dur: 700, color: "#ef4444", size: 140 });
        this.opts.onBanner?.("ENRAGED", "rage");
        this.after(900, () => this.setAnim(this.b, "idle"));
        return 1000;
      }
      case "boss-ko": {
        this.setAnim(this.b, "ko", true);
        this.b.flashUntil = this.now + 120;
        this.shake(6, 500);
        this.opts.onBanner?.("K.O.", "ko");
        this.after(750, () => this.dissolve());
        this.after(1000, () => this.setAnim(this.h, "win", true));
        return 1400;
      }
      case "hero-ko": {
        this.setAnim(this.h, "ko", true);
        this.h.flashUntil = this.now + 120;
        this.shake(5, 400);
        this.opts.onBanner?.("DEFEATED", "lose");
        this.after(700, () => this.setAnim(this.b, "cast"));
        this.after(1400, () => this.setAnim(this.b, "idle"));
        return 1400;
      }
    }
  }

  private heroProjectile(beat: Beat): number {
    this.setAnim(this.h, "attack");
    const fps = this.heroFps("attack");
    const launch = this.impactAfterFrames(2, fps);
    const flight = 320;
    this.after(launch, () => {
      const [tx, ty] = this.bossCenter();
      this.fx.push({ kind: "orb", x: HERO_X + 30, y: GROUND_Y - 62, tx, ty, start: this.now, dur: this.reduced ? 1 : flight, color: beat.crit ? "#facc15" : "#67e8f9", size: beat.heavy ? 7 : 5 });
    });
    this.after(launch + flight, () => this.bossHurt(beat));
    this.after(launch + flight + 300, () => this.setAnim(this.h, "idle"));
    return launch + flight + 450;
  }

  private bossCenter(): [number, number] { return [this.bossFront + 50, GROUND_Y - 80]; }

  private bossHurt(beat: Beat, followUp = false) {
    const [x, y] = this.bossCenter();
    const sx = this.bossFront + 18 + (Math.random() - 0.5) * 16, sy = y + (Math.random() - 0.5) * 30;
    if (!followUp) this.opts.onImpact?.("boss", this.turn);
    if (beat.shielded) {
      this.fx.push({ kind: "ring", x, y, start: this.now, dur: 300, color: "#38bdf8", size: 60 });
      this.burst(sx, sy, "#7dd3fc", 10, 2);
      this.shake(2, 150);
      return;
    }
    this.setAnim(this.b, "hit");
    this.b.flashUntil = this.now + (beat.crit ? 140 : 90);
    const kb = beat.heavy || beat.crit ? 16 : 9;
    this.b.dx = { from: kb, to: 0, start: this.now, dur: 320 };
    this.fx.push({ kind: "slash", x: sx, y: sy, start: this.now, dur: 180, color: beat.crit ? "#facc15" : "#ffffff", size: beat.heavy ? 34 : 24, flip: followUp });
    this.burst(sx, sy, beat.crit ? "#facc15" : this.boss.accent, beat.heavy || beat.crit ? 26 : 14, beat.heavy ? 3 : 2);
    if (beat.crit) this.fx.push({ kind: "ring", x: sx, y: sy, start: this.now, dur: 260, color: "#facc15", size: 46 });
    this.shake(beat.heavy || beat.crit ? 6 : 3, beat.heavy ? 260 : 160);
    this.after(380, () => { if (this.b.anim === "hit") this.setAnim(this.b, "idle"); });
    void x;
  }

  private heroHurt(beat: Beat) {
    const sx = HERO_X + 14, sy = GROUND_Y - 52;
    this.opts.onImpact?.("hero", this.turn);
    if (beat.blocked) {
      this.setAnim(this.h, "guard");
      this.fx.push({ kind: "ring", x: sx + 10, y: sy, start: this.now, dur: 320, color: "#93c5fd", size: 40 });
      this.burst(sx + 16, sy, "#bfdbfe", 12, 2);
      this.h.dx = { from: -5, to: 0, start: this.now, dur: 200 };
      this.shake(2, 140);
      return;
    }
    this.setAnim(this.h, "hit");
    this.h.flashUntil = this.now + 90;
    this.h.dx = { from: -14, to: 0, start: this.now, dur: 300 };
    this.burst(sx, sy, "#f87171", 16, 2);
    this.fx.push({ kind: "slash", x: sx, y: sy, start: this.now, dur: 160, color: "#fecaca", size: 26, flip: true });
    this.shake(5, 220);
  }

  // ── particles & fx ─────────────────────────────────────────────────────────
  private burst(x: number, y: number, color: string, n: number, size: number) {
    if (this.reduced) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3.2;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 18 + Math.random() * 14, max: 32, color: i % 3 === 0 ? "#ffffff" : color, size: Math.random() < 0.3 ? size : 1, g: 0.12, kind: "spark" });
    }
  }

  private mote(x: number, y: number, color: string) {
    this.particles.push({ x, y, vx: (Math.random() - 0.5) * 0.3, vy: -0.6 - Math.random() * 0.8, life: 40 + Math.random() * 30, max: 70, color, size: Math.random() < 0.4 ? 2 : 1, g: 0, kind: "mote" });
  }

  /** KO: the boss's current frame crumbles into its own pixels. */
  private dissolve() {
    const f = this.bossFrameNow();
    this.b.hidden = true;
    if (this.reduced || !f) return;
    const { buf, anchor } = f;
    const left = BOSS_X - (buf.w - anchor[0]);
    const top = GROUND_Y - anchor[1];
    for (let y = 0; y < buf.h; y += 2) for (let x = 0; x < buf.w; x += 2) {
      const c = buf.px[y * buf.w + x];
      if (!c) continue;
      if (this.particles.length > 2600) break;
      this.particles.push({
        x: left + (buf.w - 1 - x) + tweenAt(this.b.dx, this.now), y: top + y,
        vx: (Math.random() - 0.3) * 1.2, vy: -0.4 - Math.random() * 1.6, life: 30 + Math.random() * 50, max: 80,
        color: toCss(c), size: 2, g: -0.01, kind: "dust",
      });
    }
  }

  private seedAmbient() {
    if (this.reduced) return;
    const st = STAGES[this.stageId];
    if (!st) return;
    const { kind, count } = st.particles;
    for (let i = 0; i < count; i++) this.ambient.push(this.newAmbient(kind, st.particles.color, true));
  }

  private newAmbient(kind: ParticleKind, color: string, anywhere = false): Particle {
    const x = Math.random() * STAGE_W, y = anywhere ? Math.random() * STAGE_H : -4;
    const p: Particle = { x, y, vx: 0, vy: 0, life: 1e9, max: 1e9, color, size: 1, g: 0, kind };
    switch (kind) {
      case "snow": p.vx = -0.2 + Math.random() * 0.3; p.vy = 0.3 + Math.random() * 0.5; p.size = Math.random() < 0.3 ? 2 : 1; break;
      case "rain": p.vx = -1.2; p.vy = 5 + Math.random() * 2; break;
      case "petals": case "feathers": p.vx = -0.6 - Math.random() * 0.5; p.vy = 0.35 + Math.random() * 0.4; p.size = 2; break;
      case "sand": case "dust": p.x = anywhere ? x : STAGE_W + 4; p.y = 120 + Math.random() * 140; p.vx = -1.5 - Math.random() * 1.5; p.vy = (Math.random() - 0.5) * 0.2; break;
      case "embers": p.y = anywhere ? y : STAGE_H + 4; p.vx = (Math.random() - 0.5) * 0.4; p.vy = -0.4 - Math.random() * 0.6; p.size = Math.random() < 0.3 ? 2 : 1; break;
      case "fireflies": case "wisps": p.y = 120 + Math.random() * 130; p.vx = (Math.random() - 0.5) * 0.3; p.vy = (Math.random() - 0.5) * 0.3; p.size = kind === "wisps" ? 2 : 1; break;
      case "bubbles": p.y = anywhere ? y : STAGE_H + 4; p.vy = -0.5 - Math.random() * 0.5; p.size = 2; break;
    }
    return p;
  }

  // ── frames ─────────────────────────────────────────────────────────────────
  private heroAnimIndex(): { anim: AnimName; i: number } {
    const anim = this.h.anim as AnimName;
    const n = this.heroSheet ? sheetFrame(this.heroSheet, anim, 0).frames : heroAnims(this.hero.style)[anim].length;
    const raw = Math.floor(((this.now - this.h.start) / 1000) * this.heroFps(anim));
    const loop = ANIM_LOOP[anim] && !this.h.hold;
    if (this.reduced && anim === "idle") return { anim, i: 0 };
    return { anim, i: loop ? raw % n : Math.min(n - 1, raw) };
  }

  private bossAnimIndex(): { anim: BossAnim; i: number } {
    const anim = this.b.anim as BossAnim;
    const n = this.bossSheet ? sheetFrame(this.bossSheet, anim, 0).frames : BOSS_ANIMS[anim].length;
    const raw = Math.floor(((this.now - this.b.start) / 1000) * BOSS_FPS[anim]);
    if (this.reduced && anim === "idle") return { anim, i: 0 };
    return { anim, i: anim === "idle" ? raw % n : Math.min(n - 1, raw) };
  }

  private bossFrameNow(): Frame | null {
    const { anim, i } = this.bossAnimIndex();
    return bossFrame(this.boss, anim, i);
  }

  private measureBoss() {
    const f = bossFrame(this.boss, "idle", 0);
    const [bx, , bw] = f.buf.bounds();
    // mirrored: the creature's front (its right edge in the frame) faces the hero
    const left = BOSS_X - (f.buf.w - f.anchor[0]);
    this.bossFront = left + (f.buf.w - (bx + bw));
  }

  private silhouette(buf: PixelBuffer, color: RGBA): HTMLCanvasElement {
    let byColor = this.silhouettes.get(buf);
    if (!byColor) { byColor = new Map(); this.silhouettes.set(buf, byColor); }
    let c = byColor.get(color);
    if (!c) { c = toCanvas(buf.silhouette(color)); byColor.set(color, c); }
    return c;
  }

  // ── the loop ───────────────────────────────────────────────────────────────
  private loop(t: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(50, t - (this.last || t));
    this.last = t;
    this.now = t;
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= t);
      this.timers = this.timers.filter((x) => x.at > t);
      for (const d of due) d.fn();
    }
    this.step(dt / 16.67);
    this.draw();
  }

  private step(k: number) {
    for (const p of this.particles) { p.x += p.vx * k; p.y += p.vy * k; p.vy += p.g * k; p.life -= k; }
    this.particles = this.particles.filter((p) => p.life > 0);
    const st = STAGES[this.stageId];
    for (let i = 0; i < this.ambient.length; i++) {
      const p = this.ambient[i];
      const wob = p.kind === "petals" || p.kind === "feathers" || p.kind === "snow" ? Math.sin((this.now / 600) + i) * 0.3 : 0;
      if (p.kind === "fireflies" || p.kind === "wisps") { p.vx += (Math.random() - 0.5) * 0.05; p.vy += (Math.random() - 0.5) * 0.05; p.vx *= 0.98; p.vy *= 0.98; }
      p.x += (p.vx + wob) * k; p.y += p.vy * k;
      if (p.y > STAGE_H + 6 || p.y < -8 || p.x < -8 || p.x > STAGE_W + 8) this.ambient[i] = this.newAmbient(p.kind as ParticleKind, p.color);
    }
    if (st?.storm && !this.reduced && this.now > this.stormAt) {
      this.flashSky = this.now;
      this.fx.push({ kind: "bolt", x: 40 + Math.random() * 400, y: 0, start: this.now, dur: 160, color: "#e0f2fe", size: 0 });
      this.stormAt = this.now + 5000 + Math.random() * 7000;
    }
    this.fx = this.fx.filter((f) => this.now - f.start < f.dur);
  }

  private draw() {
    const ctx = this.ctx, now = this.now;
    ctx.save();
    if (now < this.shakeUntil) {
      const a = this.shakeAmp * ((this.shakeUntil - now) / 300);
      ctx.translate(Math.round((Math.random() - 0.5) * a), Math.round((Math.random() - 0.5) * a));
    }
    // stage
    if (this.stageImg) ctx.drawImage(this.stageImg, 0, 0, STAGE_W, STAGE_H);
    else ctx.drawImage(toCanvas(stageBackdrop(this.stageId)), 0, 0);
    const st = STAGES[this.stageId];
    if (st && !this.reduced) {
      ctx.globalCompositeOperation = "lighter";
      for (const [lx, ly, r, c] of st.lights) {
        const fl = 0.16 + Math.sin(now / 90 + lx) * 0.03 + Math.random() * 0.02;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
        g.addColorStop(0, c + Math.round(fl * 255).toString(16).padStart(2, "0")); g.addColorStop(1, c + "00");
        ctx.fillStyle = g; ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (now - this.flashSky < 120) { ctx.fillStyle = "rgba(224,242,254,0.35)"; ctx.fillRect(0, 0, STAGE_W, STAGE_H); }
    // ambient behind fighters (rain / snow drawn after, in front)
    for (const p of this.ambient) if (p.kind === "fireflies" || p.kind === "wisps" || p.kind === "embers") this.dot(p, p.kind === "fireflies" ? 0.5 + Math.sin(now / 200 + p.x) * 0.5 : 1);

    // shadows
    const hx = Math.round(HERO_X + tweenAt(this.h.dx, now));
    const bxOff = Math.round(tweenAt(this.b.dx, now));
    this.shadow(hx, 18);
    if (!this.b.hidden) this.shadow(this.bossFront + 55 + bxOff, 60);

    // boss
    if (!this.b.hidden) this.drawBoss(bxOff);
    // hero
    this.drawHero(hx);

    // fx
    for (const f of this.fx) this.drawFx(f);
    for (const p of this.particles) this.dot(p, Math.min(1, p.life / (p.max * 0.4)));
    for (const p of this.ambient) if (!(p.kind === "fireflies" || p.kind === "wisps" || p.kind === "embers")) this.dot(p, p.kind === "rain" ? 0.55 : 0.9, p.kind === "rain");
    ctx.restore();
  }

  private dot(p: Particle, alpha: number, streak = false) {
    const ctx = this.ctx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = p.color;
    if (streak) ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 4);
    else ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    ctx.globalAlpha = 1;
  }

  private shadow(cx: number, rx: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    for (let y = -3; y <= 3; y++) {
      const w = Math.round(rx * Math.sqrt(1 - (y * y) / 12));
      ctx.fillRect(cx - w, GROUND_Y + y, w * 2, 1);
    }
  }

  private drawHero(x: number) {
    const ctx = this.ctx;
    const { anim, i } = this.heroAnimIndex();
    if (this.heroSheet) {
      const fr = sheetFrame(this.heroSheet, anim, i), a = this.heroSheet.entry.anchor;
      ctx.drawImage(this.heroSheet.image, fr.sx, fr.sy, fr.sw, fr.sh, x - a[0], GROUND_Y - a[1], fr.sw, fr.sh);
      return;
    }
    const f = heroFrame(this.hero, anim, i);
    const left = x - f.anchor[0], top = GROUND_Y - f.anchor[1];
    ctx.drawImage(toCanvas(f.buf), left, top);
    if (this.now < this.h.flashUntil && !this.reduced) ctx.drawImage(this.silhouette(f.buf, hex("#ffffff")), left, top);
  }

  private drawBoss(dx: number) {
    const ctx = this.ctx;
    const f = this.bossFrameNow();
    if (!f) return;
    const left = BOSS_X - (f.buf.w - f.anchor[0]) + dx, top = GROUND_Y - f.anchor[1];
    const mirrored = (img: CanvasImageSource, ox = 0, oy = 0) => {
      ctx.save(); ctx.translate(left + f.buf.w + ox, top + oy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0); ctx.restore();
    };
    // aura: rage (red, flickering) or the telegraphed intent's colour, a pixel ring around the silhouette
    const auraColor = this.rage ? "#ef4444" : this.intent ? INTENT_COLOR[this.intent] : null;
    if (auraColor && !this.reduced) {
      const on = this.rage ? Math.random() > 0.25 : Math.sin(this.now / 220) > -0.2;
      if (on) {
        const sil = this.silhouette(f.buf, hex(auraColor));
        ctx.globalAlpha = this.rage ? 0.85 : 0.55;
        for (const [ox, oy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) mirrored(sil, ox, oy);
        ctx.globalAlpha = 1;
      }
    }
    if (this.bossSheet) {
      const fr = sheetFrame(this.bossSheet, this.b.anim, this.bossAnimIndex().i), a = this.bossSheet.entry.anchor;
      const l = BOSS_X + dx - (fr.sw - a[0]);
      ctx.save(); ctx.translate(l + fr.sw, GROUND_Y - a[1]); ctx.scale(-1, 1);
      ctx.drawImage(this.bossSheet.image, fr.sx, fr.sy, fr.sw, fr.sh, 0, 0, fr.sw, fr.sh); ctx.restore();
    } else mirrored(toCanvas(f.buf));
    if (this.now < this.b.flashUntil && !this.reduced) mirrored(this.silhouette(f.buf, hex("#ffffff")));
    // shield: a hex-ish bubble of pixels
    if (this.shield > 0) {
      const [cx, cy] = this.bossCenter();
      ctx.fillStyle = "rgba(56,189,248,0.55)";
      for (let a = 0; a < 64; a++) {
        const ang = (a / 64) * Math.PI * 2 + this.now / 1500;
        const r = 78 + Math.sin(ang * 6 + this.now / 300) * 2;
        ctx.fillRect(Math.round(cx + dx + Math.cos(ang) * r * 0.8), Math.round(cy + Math.sin(ang) * r), 2, 2);
      }
    }
  }

  private drawFx(f: Fx) {
    const ctx = this.ctx;
    const t = (this.now - f.start) / f.dur;
    ctx.fillStyle = f.color;
    if (f.kind === "slash") {
      // a crescent of pixels sweeping across the target
      const n = 26;
      for (let i = 0; i < n * Math.min(1, t * 1.6); i++) {
        const u = i / n, ang = (f.flip ? 0.9 : -0.9) + u * (f.flip ? -2.0 : 2.0);
        const r = f.size * (0.7 + u * 0.3);
        const w = u > 0.2 && u < 0.8 ? 2 : 1;
        ctx.globalAlpha = 1 - t;
        ctx.fillRect(Math.round(f.x + Math.cos(ang) * r * 0.6 - f.size * 0.3), Math.round(f.y + Math.sin(ang) * r * 0.9), w, w);
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === "ring") {
      const r = f.size * easeOut(t);
      ctx.globalAlpha = 1 - t;
      for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2;
        ctx.fillRect(Math.round(f.x + Math.cos(ang) * r), Math.round(f.y + Math.sin(ang) * r * 0.7), 2, 2);
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === "orb") {
      const u = easeOut(Math.min(1, t));
      const x = f.x + ((f.tx ?? f.x) - f.x) * u, y = f.y + ((f.ty ?? f.y) - f.y) * u - Math.sin(u * Math.PI) * 18;
      for (let k = 0; k < 6; k++) {
        const v = Math.max(0, u - k * 0.04);
        const tx = f.x + ((f.tx ?? f.x) - f.x) * v, ty = f.y + ((f.ty ?? f.y) - f.y) * v - Math.sin(v * Math.PI) * 18;
        ctx.globalAlpha = 0.6 - k * 0.1;
        ctx.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 3, 3);
      }
      ctx.globalAlpha = 1;
      ctx.fillRect(Math.round(x) - f.size / 2, Math.round(y) - f.size / 2, f.size, f.size);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    } else if (f.kind === "bolt") {
      let x = f.x;
      ctx.globalAlpha = 1 - t;
      for (let y = 0; y < 140; y += 4) { const nx = x + Math.round((Math.random() - 0.5) * 10); ctx.fillRect(Math.min(x, nx), y, Math.abs(nx - x) + 2, 4); x = nx; }
      ctx.globalAlpha = 1;
    }
  }
}
