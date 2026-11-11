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
import { BOSS_ANIMS, BOSS_FPS, BOSS_IMPACT_FRAME, bossById, type BossAnim, type BossDef } from "./bosses";
import { ANIM_FPS, ANIM_LOOP, HERO_IMPACT_FRAME, heroAnims, type AnimName, type HeroDef } from "./heroes";
import { sheetFor, sheetFrame, stageImageFor, type LoadedSheet } from "./sheets";
import { MOUNT_FRAME, PET_FPS, PET_FRAME, PET_OFFSET, mountFrame, petById, petFrame } from "./pets";
import { solve } from "./rig";
import { bossFrame, heroFrame, HERO_FRAME, type Frame } from "./sprites";
import { GROUND_Y, STAGES, STAGE_H, STAGE_W, stageBackdrop, type ParticleKind } from "./stages";
import type { PixelBuffer } from "./buffer";
import { sfx, type Sfx } from "../sound/chip";

export type BeatKind =
  | "intro" | "hero-strike" | "hero-cast" | "boss-strike" | "boss-shield" | "boss-heal" | "boss-drain"
  | "boss-ko" | "hero-ko" | "rage"
  // Phase 3 Stage 2: creature mechanics and champion kits
  | "mechanic" | "ultimate" | "riposte" | "dodge"
  // Stage C1: a champion with their own mastery weapon ends the fight with a finisher
  | "finisher"
  // Stage A2: the champion taunts the boss (it rages)
  | "taunt";

/**
 * What a creature's mechanic or a champion's kit did on a turn, one per server event type (backend
 * core_brains/mechanics.py and kits.py `t.event(...)`). A dodge ("dodged", "shadowstep", "vanish") is its own beat.
 */
export type MechanicEffect =
  | "regrowth" | "cauterized" | "grabbed" | "broke_free" | "riddle_solved" | "riddle_failed" | "illusion" | "illusion_seen"
  | "chained" | "feather" | "devour" | "stunned" | "drum" | "drum_broken" | "shapeshift" | "venom" | "poisoned"
  | "treasure" | "wisdom" | "plucked" | "squeeze" | "uncoil" | "uncoiled" | "refund" | "ultimate_hit" | "fortress"
  | "weakness" | "focus_flow" | "thick_skin" | "last_stand" | "second_wind";

/** How an effect looks: who acts (and in which pose), the colour, the motion, an optional banner, how long it takes. */
export type EffectMotion =
  | "motes" | "to-boss" | "to-hero" | "ring" | "burst" | "orb-to-hero" | "orb-to-boss" | "chains" | "stars" | "coils" | "drum" | "flash";
export interface EffectSpec {
  on: "hero" | "boss"; anim?: "cast" | "attack" | "hit" | "guard" | "win"; color: string; motion: EffectMotion;
  banner?: string; ms: number; shake?: number;
}

/** The look of every mechanic and kit effect. Pure data, so a test can check every server event has one. */
export const MECHANIC_FX: Record<MechanicEffect, EffectSpec> = {
  // Hydra: a head regrows (green motes rise on the boss) / a heavy blow cauterizes (embers burst)
  regrowth: { on: "boss", anim: "cast", color: "#4ade80", motion: "motes", ms: 650 },
  cauterized: { on: "boss", anim: "hit", color: "#fb923c", motion: "burst", ms: 450, shake: 2 },
  // Kraken: a tentacle flies at the hero and pins them / the hero slips out
  grabbed: { on: "boss", anim: "attack", color: "#0ea5e9", motion: "orb-to-hero", banner: "GRABBED", ms: 750, shake: 3 },
  broke_free: { on: "hero", anim: "guard", color: "#7dd3fc", motion: "burst", ms: 450 },
  // Sphinx: a golden ring of a solved riddle / it devours your certainty
  riddle_solved: { on: "boss", anim: "hit", color: "#facc15", motion: "ring", ms: 500 },
  riddle_failed: { on: "boss", anim: "cast", color: "#facc15", motion: "to-boss", ms: 650 },
  // Kitsune: the fake option bursts in pink on the hero / the illusion shatters
  illusion: { on: "hero", anim: "hit", color: "#f0abfc", motion: "to-boss", banner: "ILLUSION", ms: 700 },
  illusion_seen: { on: "boss", color: "#f0abfc", motion: "burst", ms: 450 },
  // Fenrir: chains snap shut round the wolf
  chained: { on: "boss", anim: "hit", color: "#cbd5e1", motion: "chains", banner: "CHAINED", ms: 800, shake: 3 },
  // Ammit: the heart is lighter than the feather (gold falls on the hero) / it devours a repeated mistake
  feather: { on: "hero", anim: "cast", color: "#fde68a", motion: "motes", ms: 500 },
  devour: { on: "boss", anim: "attack", color: "#a3e635", motion: "to-boss", ms: 700, shake: 2 },
  // Minotaur: it crashes into the guard and staggers (stars)
  stunned: { on: "boss", anim: "hit", color: "#fde047", motion: "stars", banner: "STUNNED", ms: 800, shake: 4 },
  // Oni: the war drum booms / a heavy blow splits it
  drum: { on: "boss", anim: "cast", color: "#ef4444", motion: "drum", ms: 650, shake: 4 },
  drum_broken: { on: "boss", anim: "hit", color: "#fca5a5", motion: "burst", banner: "DRUM BROKEN", ms: 600, shake: 3 },
  // Rakshasa: it changes form (a flash and a purple ring)
  shapeshift: { on: "boss", anim: "cast", color: "#c084fc", motion: "flash", ms: 700 },
  // Naga: venom bites / a treasure is stolen from the hoard
  venom: { on: "hero", anim: "hit", color: "#84cc16", motion: "motes", ms: 500 },
  poisoned: { on: "boss", anim: "attack", color: "#84cc16", motion: "orb-to-hero", ms: 650 },
  treasure: { on: "hero", anim: "win", color: "#fbbf24", motion: "to-hero", ms: 700 },
  // Simurgh: it gathers wisdom while you think / you pluck a feather
  wisdom: { on: "boss", anim: "cast", color: "#93c5fd", motion: "motes", ms: 650 },
  plucked: { on: "hero", color: "#fde68a", motion: "orb-to-hero", ms: 600 },
  // Jormungandr: the coils squeeze the hero / they come off
  squeeze: { on: "hero", anim: "hit", color: "#22c55e", motion: "coils", ms: 700, shake: 3 },
  uncoil: { on: "hero", anim: "guard", color: "#86efac", motion: "burst", ms: 400 },
  uncoiled: { on: "hero", anim: "win", color: "#86efac", motion: "ring", banner: "FREE", ms: 600 },
  // Kits: Mira's Focus comes back / an ultimate's blow lands / Thorne's Last Chapter holds
  refund: { on: "hero", color: "#67e8f9", motion: "motes", ms: 450 },
  ultimate_hit: { on: "hero", anim: "cast", color: "#facc15", motion: "ring", ms: 400 },
  fortress: { on: "hero", anim: "guard", color: "#93c5fd", motion: "ring", ms: 600 },
  // weaknesses and your hero's passives: a miss that costs a heart, Focus flowing in, a forgiven miss, a held line, a second wind
  weakness: { on: "hero", anim: "hit", color: "#ef4444", motion: "burst", ms: 400, shake: 2 },
  focus_flow: { on: "hero", color: "#67e8f9", motion: "motes", ms: 450 },
  thick_skin: { on: "hero", anim: "guard", color: "#d6d3d1", motion: "ring", ms: 450 },
  last_stand: { on: "hero", anim: "guard", color: "#fbbf24", motion: "ring", banner: "LAST STAND", ms: 650 },
  second_wind: { on: "hero", anim: "win", color: "#86efac", motion: "motes", banner: "SECOND WIND", ms: 650 },
};

export interface Beat {
  kind: BeatKind;
  /** hero-strike: a heavy blow / a weakness crit (bigger hit). */
  heavy?: boolean;
  crit?: boolean;
  /** boss-strike: the hero guarded it (no hurt, a shield flash instead). */
  blocked?: boolean;
  /** hero-strike: the blow was absorbed by the boss's shield. */
  shielded?: boolean;
  /** intro / ultimate: the banner text. */
  text?: string;
  /** mechanic: what the creature's mechanic or the champion's kit did. */
  effect?: MechanicEffect;
  /** boss-strike / dodge: a charge (a long, fast rush) or a thrown projectile (a boulder) instead of a swing. */
  charge?: boolean;
  projectile?: boolean;
  /** hero-strike / ultimate: the champion fights with their own mastery weapon (their own animation). */
  signature?: boolean;
  /** taunt: the boss was not raging before (it goes into rage now). */
  enraged?: boolean;
  /** The turn this beat belongs to - echoed back by onImpact. */
  key?: string | number;
}

export type IntentTint =
  | "attack" | "heavy" | "shield" | "drain" | "heal"
  | "grab" | "riddle" | "illusion" | "charge" | "aim" | "throw" | "hoard" | "stunned" | null;

const HERO_X = 128;
const BOSS_X = 352;
const INTENT_COLOR: Record<Exclude<IntentTint, null>, string> = {
  attack: "#ef4444", heavy: "#f97316", shield: "#38bdf8", drain: "#a855f7", heal: "#4ade80",
  grab: "#0ea5e9", riddle: "#facc15", illusion: "#f0abfc", charge: "#f97316", aim: "#fbbf24", throw: "#f97316",
  hoard: "#34d399", stunned: "#e2e8f0",
};

interface Tween { from: number; to: number; start: number; dur: number }
interface Actor {
  anim: string; start: number; hold: boolean;
  dx: Tween; flashUntil: number; hidden: boolean;
  /** Drawn see-through until then (a dodge / Vanish). */
  ghostUntil: number;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number; kind?: ParticleKind | "spark" | "mote" | "dust" }
interface Fx { kind: "slash" | "ring" | "orb" | "banner-flash" | "bolt" | "star" | "burst"; x: number; y: number; start: number; dur: number; color: string; size: number; tx?: number; ty?: number; flip?: boolean }

export interface FightOptions {
  hero: HeroDef;
  /** The pet idling behind the champion (a pet id from pets.ts), if one is worn. */
  pet?: string | null;
  /** A saddled pet the fighter rides in on (pets.ts mountFrame); it carries them in, then trots off. */
  mount?: string | null;
  /** How grown the pet is (forge tiers): baby, young or adult. */
  petStage?: "baby" | "young" | "adult";
  bossId: string;
  stageId?: string;
  reduced: boolean;
  onImpact?: (side: "hero" | "boss", key: string | number | undefined) => void;
  onBanner?: (text: string, tone: "fight" | "ko" | "rage" | "lose" | "mech" | "ult") => void;
}

const BANNER_SFX: Record<"fight" | "ko" | "rage" | "lose" | "mech" | "ult", Sfx> = { fight: "fight", ko: "ko", rage: "rage", lose: "lose", mech: "cast", ult: "ult" };

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
  private pet: string | null = null;
  private mount: string | null = null;
  private mountLeave = { start: 0, dur: 0 };
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
  // Stage A2 juice: hit-stop (time stands still a moment), slow motion, a white crit flash, a camera punch
  private lastReal = 0;
  private hitstopUntil = 0;
  private slowmoUntil = 0;
  private critFlashUntil = 0;
  private punchUntil = 0;
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
    this.pet = opts.pet ?? null;
    this.mount = opts.mount ?? null;
    this.boss = bossById(opts.bossId);
    this.stageId = opts.stageId ?? this.boss.stage;
    this.reduced = opts.reduced;
    const t = performance.now();
    this.now = t;
    this.h = { anim: "idle", start: t, hold: false, dx: { from: 0, to: 0, start: t, dur: 1 }, flashUntil: 0, hidden: false, ghostUntil: 0 };
    this.b = { anim: "idle", start: t, hold: false, dx: { from: 0, to: 0, start: t, dur: 1 }, flashUntil: 0, hidden: false, ghostUntil: 0 };
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

  setPet(pet: string | null | undefined) { this.pet = pet ?? null; }

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

  /** A banner over the stage, with its sound. */
  private banner(text: string, tone: "fight" | "ko" | "rage" | "lose" | "mech" | "ult") {
    sfx(BANNER_SFX[tone]);
    this.opts.onBanner?.(text, tone);
  }

  private heroFps(anim: string) { return ANIM_FPS[anim as AnimName] ?? 8; }
  private impactAfterFrames(n: number, fps: number) { return Math.round((n * 1000) / fps); }

  private run(beat: Beat): number {
    const style = this.hero.style;
    switch (beat.kind) {
      case "intro": {
        this.h.dx = { from: -150, to: 0, start: this.now, dur: this.reduced ? 1 : 650 };
        // riding in: the mount carries the fighter to their mark, then trots back off the stage
        const riding = !!this.mount && !!mountFrame(this.mount, 0) && !this.reduced;
        this.setAnim(this.h, riding ? "ride" : "dash");
        if (riding) this.mountLeave = { start: this.now + 650, dur: 700 };
        this.b.flashUntil = this.now + 300;
        this.after(650, () => { this.setAnim(this.h, "idle"); });
        this.banner(beat.text ?? "FIGHT!", beat.text === "NEMESIS" ? "rage" : "fight");
        this.after(250, () => this.shake(3, 250));
        return 900;
      }
      case "hero-strike": {
        if (style === "mage") return this.heroProjectile(beat);
        const reach = Math.max(30, this.bossFront - HERO_X - (style === "lance" ? 62 : 38));
        // wind-up: a small step back, then the dash (dust at the feet)
        const wind = this.reduced ? 0 : 90;
        if (wind) { this.setAnim(this.h, "guard"); this.move(this.h, -8, wind); }
        this.after(wind, () => { this.setAnim(this.h, "dash"); this.move(this.h, reach, 200); this.dust(HERO_X, -1); sfx("swing"); });
        const fps = this.heroFps("attack");
        this.after(wind + 200, () => { this.setAnim(this.h, "attack"); this.dust(HERO_X + reach + 8, 1); });
        const hit = wind + 200 + this.impactAfterFrames(HERO_IMPACT_FRAME, fps);
        this.after(hit, () => { this.bossHurt(beat); if (beat.signature && !beat.shielded) this.signatureStrike(); });
        if (style === "twin" || style === "fist") this.after(hit + 120, () => this.bossHurt({ ...beat, heavy: false }, true));
        this.after(hit + 380, () => { this.setAnim(this.h, "dash"); this.move(this.h, 0, 260); });
        this.after(hit + 640, () => { this.setAnim(this.h, "idle"); this.dust(HERO_X + 6, 1); });
        return hit + 700;
      }
      case "hero-cast": {
        this.setAnim(this.h, "cast");
        sfx("cast");
        if (!this.reduced) for (let i = 0; i < 18; i++) this.mote(HERO_X + (Math.random() - 0.5) * 30, GROUND_Y - 10 - Math.random() * 50, "#67e8f9");
        this.after(260, () => this.fx.push({ kind: "burst", x: HERO_X + 6, y: GROUND_Y - 58, start: this.now, dur: 380, color: "#67e8f9", size: 30 }));
        this.after(700, () => this.setAnim(this.h, "idle"));
        return 600;
      }
      case "boss-strike": {
        if (beat.projectile) return this.bossThrow(() => this.heroHurt(beat));
        if (beat.charge) return this.bossCharge(() => this.heroHurt(beat));
        this.setAnim(this.b, "attack"); this.move(this.b, -46, 260);
        const hit = this.impactAfterFrames(BOSS_IMPACT_FRAME, BOSS_FPS.attack) + 40;
        this.after(hit, () => this.heroHurt(beat));
        this.after(hit + 260, () => this.move(this.b, 0, 320));
        this.after(hit + 340, () => this.setAnim(this.h, "idle"));
        return hit + 600;
      }
      case "boss-shield": {
        this.setAnim(this.b, "cast");
        sfx("shield");
        this.fx.push({ kind: "ring", x: this.bossCenter()[0], y: this.bossCenter()[1], start: this.now, dur: 500, color: "#38bdf8", size: 70 });
        this.after(600, () => this.setAnim(this.b, "idle"));
        return 600;
      }
      case "boss-heal": {
        this.setAnim(this.b, "cast");
        sfx("heal");
        if (!this.reduced) for (let i = 0; i < 22; i++) { const [x, y] = this.bossCenter(); this.mote(x + (Math.random() - 0.5) * 80, y + 30 + Math.random() * 30, "#4ade80"); }
        this.after(650, () => this.setAnim(this.b, "idle"));
        return 650;
      }
      case "boss-drain": {
        this.setAnim(this.b, "cast");
        sfx("cast");
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
        this.banner("ENRAGED", "rage");
        this.after(900, () => this.setAnim(this.b, "idle"));
        return 1000;
      }
      case "boss-ko": {
        this.setAnim(this.b, "ko", true);
        this.b.flashUntil = this.now + 120;
        this.shake(6, 500);
        this.slowmo(650);
        this.critFlash();
        this.banner("K.O.", "ko");
        this.after(750, () => this.dissolve());
        this.after(1000, () => this.setAnim(this.h, "win", true));
        return 1400;
      }
      case "mechanic": return beat.effect && MECHANIC_FX[beat.effect] ? this.effect(MECHANIC_FX[beat.effect]) : 0;
      case "ultimate": {
        const accent = this.hero.accent;
        const [x, y] = this.heroCenter();
        this.setAnim(this.h, "cast");
        this.flashSky = this.now;
        this.fx.push({ kind: "ring", x, y, start: this.now, dur: 600, color: accent, size: 90 });
        this.after(200, () => this.fx.push({ kind: "ring", x, y, start: this.now, dur: 500, color: "#facc15", size: 60 }));
        if (!this.reduced) for (let i = 0; i < 30; i++) this.mote(x + (Math.random() - 0.5) * 40, GROUND_Y - Math.random() * 60, i % 3 ? accent : "#ffffff");
        this.shake(3, 300);
        this.banner(beat.text ?? "ULTIMATE", "ult");
        if (beat.signature) { this.after(300, () => this.signatureUltimate()); this.after(1300, () => this.setAnim(this.h, "idle")); return 1400; }
        this.after(900, () => this.setAnim(this.h, "idle"));
        return 1000;
      }
      case "taunt": {
        // the champion beckons (a hop and a pose); the boss answers in rage
        const [x, y] = this.heroCenter();
        this.setAnim(this.h, "win");
        sfx("taunt");
        if (!this.reduced) {
          this.h.dx = { from: 0, to: 10, start: this.now, dur: 120 };
          this.after(120, () => { this.h.dx = { from: 10, to: 0, start: this.now, dur: 160 }; this.dust(HERO_X, 1); });
          for (let i = 0; i < 16; i++) this.mote(x + (Math.random() - 0.5) * 30, GROUND_Y - Math.random() * 50, this.hero.accent);
        }
        this.after(420, () => {
          const [bx, by] = this.bossCenter();
          this.setAnim(this.b, "cast");
          this.b.flashUntil = this.now + 160;
          this.fx.push({ kind: "ring", x: bx, y: by, start: this.now, dur: 600, color: "#ef4444", size: 120 });
          this.after(120, () => this.fx.push({ kind: "ring", x: bx, y: by, start: this.now, dur: 500, color: "#f97316", size: 80 }));
          this.burst(bx, by - 20, "#ef4444", 24, 2);
          this.shake(6, 500);
          this.banner(beat.enraged === false ? "TAUNTED!" : "ENRAGED!", "rage");
        });
        this.after(1200, () => { this.setAnim(this.h, "idle"); this.setAnim(this.b, "idle"); });
        void y;
        return 1300;
      }
      case "finisher": {
        // the champion's own last blow, then the KO as usual
        const reach = Math.max(30, this.bossFront - HERO_X - (style === "lance" ? 62 : 38));
        this.banner(beat.text ?? "FINISHER", "ult");
        this.flashSky = this.now;
        if (style !== "mage") { this.setAnim(this.h, "dash"); this.move(this.h, reach, 220); }
        else this.setAnim(this.h, "cast");
        const blows = 6;
        for (let i = 0; i < blows; i++) {
          this.after(240 + i * 110, () => {
            this.setAnim(this.h, style === "mage" ? "cast" : "attack");
            this.signatureStrike(i === blows - 1);
            sfx(i === blows - 1 ? "crit" : "hit");
            this.b.flashUntil = this.now + 70;
            this.setAnim(this.b, "hit");
          });
        }
        const end = 240 + blows * 110 + 200;
        this.after(end, () => {
          this.setAnim(this.b, "ko", true);
          this.shake(8, 600);
          this.slowmo(650);
          this.critFlash();
          this.banner("K.O.", "ko");
          if (style !== "mage") { this.move(this.h, 0, 300); this.setAnim(this.h, "dash"); }
        });
        this.after(end + 650, () => this.dissolve());
        this.after(end + 900, () => this.setAnim(this.h, "win", true));
        return end + 1300;
      }
      case "riposte": {
        // a quick counter from the guard: a short lunge, one light blow, back on the mark
        this.setAnim(this.h, "attack"); this.move(this.h, 46, 140);
        this.after(140, () => this.bossHurt({ kind: "hero-strike" }));
        this.after(360, () => { this.move(this.h, 0, 200); this.setAnim(this.h, "idle"); });
        return 520;
      }
      case "dodge": {
        // the blow comes as usual and finds nothing: the hero hops back, see-through for a moment
        const sidestep = () => {
          this.opts.onImpact?.("hero", this.turn);
          sfx("dodge");
          this.h.ghostUntil = this.now + 420;
          this.setAnim(this.h, "dash");
          this.h.dx = { from: 0, to: this.reduced ? 0 : -28, start: this.now, dur: this.reduced ? 1 : 140 };
          this.after(220, () => { this.move(this.h, 0, 220); this.setAnim(this.h, "idle"); });
          this.burst(HERO_X + 20, GROUND_Y - 40, "#e2e8f0", 8, 1);
        };
        if (beat.projectile) return this.bossThrow(sidestep);
        if (beat.charge) return this.bossCharge(sidestep);
        this.setAnim(this.b, "attack"); this.move(this.b, -46, 260);
        const hit = this.impactAfterFrames(BOSS_IMPACT_FRAME, BOSS_FPS.attack) + 40;
        this.after(hit, sidestep);
        this.after(hit + 260, () => this.move(this.b, 0, 320));
        return hit + 600;
      }
      case "hero-ko": {
        this.setAnim(this.h, "ko", true);
        this.h.flashUntil = this.now + 120;
        this.shake(5, 400);
        this.banner("DEFEATED", "lose");
        this.after(700, () => this.setAnim(this.b, "cast"));
        this.after(1400, () => this.setAnim(this.b, "idle"));
        return 1400;
      }
    }
  }

  private heroProjectile(beat: Beat): number {
    this.setAnim(this.h, "attack");
    sfx("cast");
    const fps = this.heroFps("attack");
    const launch = this.impactAfterFrames(HERO_IMPACT_FRAME, fps);
    const flight = 320;
    this.after(launch, () => {
      const [tx, ty] = this.bossCenter();
      this.fx.push({ kind: "orb", x: HERO_X + 30, y: GROUND_Y - 62, tx, ty, start: this.now, dur: this.reduced ? 1 : flight, color: beat.crit ? "#facc15" : "#67e8f9", size: beat.heavy ? 7 : 5 });
    });
    this.after(launch + flight, () => { this.bossHurt(beat); if (beat.signature && !beat.shielded) this.signatureStrike(); });
    this.after(launch + flight + 300, () => this.setAnim(this.h, "idle"));
    return launch + flight + 450;
  }

  private bossCenter(): [number, number] { return [this.bossFront + 50, GROUND_Y - 80]; }
  private heroCenter(): [number, number] { return [HERO_X + 10, GROUND_Y - 46]; }

  /** A Minotaur-style charge: a long fast rush with dust behind, then the blow. */
  private bossCharge(land: () => void): number {
    this.setAnim(this.b, "attack");
    const rush = Math.max(60, this.bossFront - HERO_X - 40);
    this.move(this.b, -rush, 300);
    if (!this.reduced) for (let i = 0; i < 14; i++) this.particles.push({ x: this.bossFront + 70 + Math.random() * 30, y: GROUND_Y - Math.random() * 6, vx: 1 + Math.random() * 2, vy: -0.4 - Math.random() * 0.6, life: 26, max: 26, color: "#a8a29e", size: 2, g: 0.04, kind: "dust" });
    this.after(300, () => { land(); this.shake(5, 260); });
    this.after(560, () => this.move(this.b, 0, 380));
    this.after(940, () => this.setAnim(this.h, "idle"));
    return 1000;
  }

  /** A Cyclops-style throw: the boss hurls a boulder in an arc at the hero. */
  private bossThrow(land: () => void): number {
    this.setAnim(this.b, "cast");
    const [bx, by] = this.bossCenter();
    const [hx, hy] = this.heroCenter();
    const flight = 420;
    this.after(180, () => this.fx.push({ kind: "orb", x: bx - 20, y: by - 30, tx: hx, ty: hy, start: this.now, dur: this.reduced ? 1 : flight, color: "#78716c", size: 9 }));
    this.after(180 + flight, () => { land(); this.burst(hx, hy, "#a8a29e", 16, 2); });
    this.after(180 + flight + 300, () => { this.setAnim(this.b, "idle"); this.setAnim(this.h, "idle"); });
    return 180 + flight + 450;
  }

  /** A mechanic or kit effect, from its spec in MECHANIC_FX. */
  private effect(spec: EffectSpec): number {
    const actor = spec.on === "boss" ? this.b : this.h;
    const [x, y] = spec.on === "boss" ? this.bossCenter() : this.heroCenter();
    const [bx, by] = this.bossCenter();
    const [hx, hy] = this.heroCenter();
    if (spec.anim && !actor.hold) { this.setAnim(actor, spec.anim); this.after(spec.ms, () => { if (!actor.hold) this.setAnim(actor, "idle"); }); }
    if (spec.on === "hero" && spec.anim === "hit") this.h.flashUntil = this.now + 90;
    if (spec.on === "boss" && spec.anim === "hit") this.b.flashUntil = this.now + 90;
    const stream = (fx: number, fy: number, tx: number, ty: number) => {
      if (this.reduced) return;
      for (let i = 0; i < 16; i++) {
        const sx = fx + (Math.random() - 0.5) * 24, sy = fy + (Math.random() - 0.5) * 30;
        this.particles.push({ x: sx, y: sy, vx: (tx - sx) / 40, vy: (ty - sy) / 40, life: 40, max: 40, color: spec.color, size: 2, g: 0, kind: "mote" });
      }
    };
    const ring = (rx: number, ry: number, size: number, delay = 0, dur = 450) =>
      this.after(delay, () => this.fx.push({ kind: "ring", x: rx, y: ry, start: this.now, dur, color: spec.color, size }));
    switch (spec.motion) {
      case "motes": if (!this.reduced) for (let i = 0; i < 20; i++) this.mote(x + (Math.random() - 0.5) * (spec.on === "boss" ? 80 : 30), y + 20 + Math.random() * 30, spec.color); break;
      case "to-boss": stream(hx, hy, bx, by); break;
      case "to-hero": stream(bx, by, hx, hy); break;
      case "ring": ring(x, y, spec.on === "boss" ? 80 : 50); break;
      case "burst": this.burst(x, y, spec.color, 20, 2); break;
      case "orb-to-hero":
      case "orb-to-boss": {
        const [fx, fy, tx, ty] = spec.motion === "orb-to-hero" ? [bx - 20, by, hx, hy] : [hx + 20, hy, bx, by];
        this.fx.push({ kind: "orb", x: fx, y: fy, tx, ty, start: this.now, dur: this.reduced ? 1 : 320, color: spec.color, size: 6 });
        this.after(320, () => { this.burst(tx, ty, spec.color, 14, 2); if (spec.motion === "orb-to-hero" && spec.anim === "attack") { this.setAnim(this.h, "hit"); this.h.flashUntil = this.now + 90; } });
        break;
      }
      case "chains": for (let i = 0; i < 3; i++) ring(bx, by - 10 + i * 24, 70 - i * 10, i * 120, 520); this.burst(bx, by, spec.color, 12, 2); break;
      case "stars": for (let i = 0; i < 3; i++) ring(bx + (i - 1) * 16, by - 64, 14, i * 140, 600); if (!this.reduced) for (let i = 0; i < 10; i++) this.mote(bx + (Math.random() - 0.5) * 40, by - 60, spec.color); break;
      case "coils": for (let i = 0; i < 3; i++) ring(hx, hy - 16 + i * 18, 38 - i * 6, i * 110, 480); break;
      case "drum": ring(bx, by, 90, 0, 400); ring(bx, by, 120, 220, 400); break;
      case "flash": this.b.flashUntil = this.now + 220; ring(bx, by, 110, 0, 600); if (!this.reduced) for (let i = 0; i < 18; i++) this.mote(bx + (Math.random() - 0.5) * 90, by + Math.random() * 60, spec.color); break;
    }
    if (spec.shake) this.shake(spec.shake, 220);
    if (spec.banner) this.banner(spec.banner, "mech");
    return spec.ms;
  }

  private bossHurt(beat: Beat, followUp = false) {
    const [x, y] = this.bossCenter();
    const sx = this.bossFront + 18 + (Math.random() - 0.5) * 16, sy = y + (Math.random() - 0.5) * 30;
    if (!followUp) this.opts.onImpact?.("boss", this.turn);
    sfx(beat.shielded ? "block" : beat.crit ? "crit" : "hit");
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
    this.fx.push({ kind: "star", x: sx, y: sy, start: this.now, dur: beat.heavy || beat.crit ? 170 : 120, color: beat.crit ? "#fde68a" : "#ffffff", size: beat.heavy || beat.crit ? 22 : 15 });
    if (this.hero.style === "mage" && !followUp) this.fx.push({ kind: "burst", x: sx, y: sy, start: this.now, dur: 440, color: beat.crit ? "#facc15" : "#67e8f9", size: beat.heavy ? 46 : 38 });
    if (beat.heavy || beat.crit) this.dust(this.bossFront + 30, 1);
    if (beat.crit) this.fx.push({ kind: "ring", x: sx, y: sy, start: this.now, dur: 260, color: "#facc15", size: 46 });
    this.shake(beat.heavy || beat.crit ? 6 : 3, beat.heavy ? 260 : 160);
    if (!followUp && (beat.heavy || beat.crit)) this.hitstop(beat.crit ? 110 : 70);
    if (!followUp && beat.crit) this.critFlash();
    this.after(380, () => { if (this.b.anim === "hit") this.setAnim(this.b, "idle"); });
    void x;
  }

  private heroHurt(beat: Beat) {
    const sx = HERO_X + 14, sy = GROUND_Y - 52;
    this.opts.onImpact?.("hero", this.turn);
    sfx(beat.blocked ? "block" : "hurt");
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

  // ── signature weapon (Stage C1) ────────────────────────────────────────────
  /** The extra flourish of a blow struck with the champion's own mastery weapon, in the champion's colours. */
  private signatureStrike(big = false) {
    const accent = this.hero.accent;
    const [bx, by] = this.bossCenter();
    const x = this.bossFront + 18, y = by;
    const size = big ? 1.5 : 1;
    switch (this.hero.style) {
      case "blade":       // two crossing cuts
        this.fx.push({ kind: "slash", x, y: y - 6, start: this.now, dur: 220, color: accent, size: 40 * size });
        this.fx.push({ kind: "slash", x, y: y + 6, start: this.now + 40, dur: 220, color: "#ffffff", size: 40 * size, flip: true });
        break;
      case "lance":       // a line of dawn light along the thrust
        if (!this.reduced) for (let i = 0; i < 16; i++) this.particles.push({ x: HERO_X + 30 + i * ((x - HERO_X - 30) / 16), y: y + (Math.random() - 0.5) * 4, vx: 1.5, vy: 0, life: 14 + i, max: 30, color: i % 2 ? accent : "#fde68a", size: 2, g: 0, kind: "spark" });
        this.fx.push({ kind: "ring", x, y, start: this.now, dur: 300, color: "#fde68a", size: 36 * size });
        break;
      case "fist":        // the ground answers the blow
        this.fx.push({ kind: "ring", x, y: GROUND_Y - 6, start: this.now, dur: 360, color: accent, size: 70 * size });
        this.shake(big ? 7 : 4, 200);
        break;
      case "mage":        // two smaller orbs follow the first
        for (let k = 0; k < 2; k++) this.fx.push({ kind: "orb", x: HERO_X + 30, y: GROUND_Y - 70 - k * 10, tx: bx, ty: by, start: this.now + k * 60, dur: this.reduced ? 1 : 280, color: k ? "#67e8f9" : accent, size: 4 });
        break;
      case "twin":        // a shadow strikes from the other side
        this.h.ghostUntil = this.now + 220;
        this.fx.push({ kind: "slash", x: x + 24, y, start: this.now, dur: 200, color: accent, size: 30 * size, flip: true });
        this.fx.push({ kind: "slash", x: x + 12, y: y + 10, start: this.now + 60, dur: 200, color: "#e11d48", size: 26 * size });
        break;
      default:            // a shield bash that rings like a bell
        this.fx.push({ kind: "ring", x, y, start: this.now, dur: 320, color: accent, size: 48 * size });
        this.fx.push({ kind: "ring", x, y, start: this.now + 80, dur: 320, color: "#e2e8f0", size: 30 * size });
    }
    this.burst(x, y, accent, big ? 30 : 12, 2);
  }

  /** The ultimate with the champion's own weapon: a bigger, champion-shaped version. */
  private signatureUltimate() {
    const accent = this.hero.accent;
    const [bx, by] = this.bossCenter();
    const [hx, hy] = this.heroCenter();
    switch (this.hero.style) {
      case "blade":
        for (let i = 0; i < 9; i++) this.after(i * 70, () => this.fx.push({ kind: "slash", x: bx - 30 + (i % 3) * 12, y: by - 20 + Math.floor(i / 3) * 18, start: this.now, dur: 200, color: i === 8 ? "#facc15" : accent, size: 30, flip: i % 2 === 1 }));
        break;
      case "lance":
        for (let i = 0; i < 3; i++) this.after(i * 120, () => this.fx.push({ kind: "bolt", x: bx - 20 + i * 20, y: 0, start: this.now, dur: 220, color: i === 1 ? "#fde68a" : accent, size: 0 }));
        break;
      case "fist":
        for (let i = 0; i < 4; i++) this.after(i * 110, () => { this.fx.push({ kind: "ring", x: hx + 40 + i * 50, y: GROUND_Y - 4, start: this.now, dur: 320, color: accent, size: 40 }); this.shake(3, 120); });
        break;
      case "mage":
        for (let i = 0; i < 6; i++) this.after(i * 70, () => this.fx.push({ kind: "orb", x: hx + Math.cos(i) * 30, y: hy - 30 + Math.sin(i) * 20, tx: bx, ty: by, start: this.now, dur: this.reduced ? 1 : 360, color: i % 2 ? "#67e8f9" : accent, size: 5 }));
        break;
      case "twin":
        this.h.ghostUntil = this.now + 900;
        for (let i = 0; i < 5; i++) this.after(i * 90, () => this.fx.push({ kind: "slash", x: bx - 20 + i * 10, y: by - 10 + (i % 2) * 20, start: this.now, dur: 180, color: i % 2 ? "#e11d48" : accent, size: 28, flip: i % 2 === 0 }));
        break;
      default:
        this.fx.push({ kind: "ring", x: hx, y: hy, start: this.now, dur: 800, color: accent, size: 70 });
        this.after(200, () => this.fx.push({ kind: "ring", x: hx, y: hy, start: this.now, dur: 700, color: "#e2e8f0", size: 54 }));
    }
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
    const real = Math.min(50, t - (this.last || t));
    this.last = t;
    this.lastReal = t;
    // the scene's own clock: it stops during a hit-stop and crawls in slow motion (everything reads this.now)
    const dt = t < this.hitstopUntil ? 0 : t < this.slowmoUntil ? real * 0.35 : real;
    this.now += dt;
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.at <= this.now);
      this.timers = this.timers.filter((x) => x.at > this.now);
      for (const d of due) d.fn();
    }
    this.step(dt / 16.67);
    this.draw();
  }

  /** Freeze the scene for a moment on a big hit (real milliseconds). */
  private hitstop(ms: number) { if (!this.reduced) this.hitstopUntil = Math.max(this.hitstopUntil, (this.lastReal || performance.now()) + ms); }
  /** Slow the scene down (the final blow). */
  private slowmo(ms: number) { if (!this.reduced) this.slowmoUntil = (this.lastReal || performance.now()) + ms; }
  /** A crit: the screen flashes white and the camera punches in. */
  private critFlash() { if (!this.reduced) { this.critFlashUntil = this.now + 70; this.punchUntil = this.now + 140; } }
  /** Dust kicked up from the ground. */
  private dust(x: number, dir: 1 | -1) {
    if (this.reduced) return;
    for (let i = 0; i < 12; i++) {
      const out = i % 2 ? dir : -dir;                       // a puff that spreads both ways, more forward
      this.particles.push({ x: x + (Math.random() - 0.5) * 10, y: GROUND_Y - 1 - Math.random() * 3, vx: out * (0.3 + Math.random() * (out === dir ? 1.4 : 0.6)), vy: -0.2 - Math.random() * 0.5, life: 20 + Math.random() * 14, max: 34, color: i % 3 ? "#a8a29e" : "#d6d3d1", size: 2, g: 0.015, kind: "dust" });
    }
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
    if (now < this.punchUntil) {
      const k = 1 + 0.05 * ((this.punchUntil - now) / 140);
      ctx.translate(STAGE_W / 2, STAGE_H / 2); ctx.scale(k, k); ctx.translate(-STAGE_W / 2, -STAGE_H / 2);
    }
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
    const pf = this.pet ? petFrame(this.pet, this.reduced ? 0 : Math.floor((now / 1000) * PET_FPS), this.opts.petStage ?? "young") : null;
    const petX = HERO_X + PET_OFFSET[0];
    if (pf && !petById(this.pet)?.flies) this.shadow(petX, 9);
    if (!this.b.hidden) this.shadow(this.bossFront + 55 + bxOff, 60);

    // boss
    if (!this.b.hidden) this.drawBoss(bxOff);
    // the pet stays on its mark behind the champion; then the champion
    if (pf) ctx.drawImage(toCanvas(pf), petX - PET_FRAME.anchor[0], GROUND_Y + PET_OFFSET[1] - PET_FRAME.anchor[1]);
    if (this.mount && this.h.anim !== "ride") this.drawMountLeaving(hx);
    this.drawHero(hx);

    // fx
    for (const f of this.fx) this.drawFx(f);
    for (const p of this.particles) this.dot(p, Math.min(1, p.life / (p.max * 0.4)));
    for (const p of this.ambient) if (!(p.kind === "fireflies" || p.kind === "wisps" || p.kind === "embers")) this.dot(p, p.kind === "rain" ? 0.55 : 0.9, p.kind === "rain");
    if (now < this.critFlashUntil) { ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(0, 0, STAGE_W, STAGE_H); }
    ctx.restore();
  }

  private dot(p: Particle, alpha: number, streak = false) {
    const ctx = this.ctx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = p.color;
    if (streak) ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 4);
    else if (p.kind === "spark" && Math.hypot(p.vx, p.vy) > 1.2) {
      // a fast spark is a short streak along its flight, its head brighter
      const n = Math.min(4, Math.round(Math.hypot(p.vx, p.vy)));
      for (let i = n; i >= 0; i--) {
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * (1 - i / (n + 1));
        ctx.fillRect(Math.round(p.x - p.vx * i * 0.5), Math.round(p.y - p.vy * i * 0.5), p.size, p.size);
      }
    } else if (p.kind === "dust") {
      const grow = Math.round((1 - p.life / p.max) * 2);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.7;
      ctx.fillRect(Math.round(p.x) - (grow >> 1), Math.round(p.y) - (grow >> 1), p.size + grow, p.size + grow);
    } else ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
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
    const ghost = this.now < this.h.ghostUntil;
    if (ghost) ctx.globalAlpha = this.reduced ? 0.6 : 0.35;
    try { this.drawHeroFrame(x); } finally { ctx.globalAlpha = 1; }
  }

  /** The mount trotting back off the stage after it carried the fighter in (fading as it goes). */
  private drawMountLeaving(hx: number) {
    const t = (this.now - this.mountLeave.start) / Math.max(1, this.mountLeave.dur);
    if (!this.mountLeave.dur || t < 0 || t >= 1) return;
    const m = mountFrame(this.mount!, Math.floor((this.now / 1000) * PET_FPS * 1.5));
    if (!m) return;
    const x = hx - 30 - easeOut(t) * 200;
    const ctx = this.ctx;
    ctx.globalAlpha = 1 - t;
    ctx.save(); ctx.translate(Math.round(x + m.buf.w - MOUNT_FRAME.anchor[0]), GROUND_Y - MOUNT_FRAME.anchor[1]); ctx.scale(-1, 1);
    ctx.drawImage(toCanvas(m.buf), 0, 0); ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawHeroFrame(x: number) {
    const ctx = this.ctx;
    const { anim, i } = this.heroAnimIndex();
    if (anim === "ride" && this.mount) {
      // the mount under the fighter; the fighter's hips on its saddle
      const m = mountFrame(this.mount, Math.floor((this.now / 1000) * PET_FPS * 1.5));
      if (m) {
        const mx = x - MOUNT_FRAME.anchor[0], my = GROUND_Y - MOUNT_FRAME.anchor[1];
        ctx.drawImage(toCanvas(m.buf), mx, my);
        const f = heroFrame(this.hero, "ride", i);
        const hip = solve(this.hero.look.build, heroAnims(this.hero.style).ride[i % heroAnims(this.hero.style).ride.length], HERO_FRAME.anchor, this.hero.look.scale).hip;
        ctx.drawImage(toCanvas(f.buf), Math.round(mx + m.seat[0] - hip[0]), Math.round(my + m.seat[1] - hip[1]));
        return;
      }
    }
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
      // a crescent sweeping across the target: thick in the middle, a white core inside a coloured rim
      const n = 40, head = Math.min(1, t * 1.8), tail = Math.max(0, t * 1.8 - 0.8);
      for (let i = Math.floor(n * tail); i < n * head; i++) {
        const u = i / n, ang = (f.flip ? 0.9 : -0.9) + u * (f.flip ? -2.0 : 2.0);
        const r = f.size * (0.7 + u * 0.3);
        const thick = Math.max(1, Math.round(Math.sin(u * Math.PI) * 3.4));
        const x = f.x + Math.cos(ang) * r * 0.6 - f.size * 0.3, y = f.y + Math.sin(ang) * r * 0.9;
        const nx = Math.cos(ang) * 0.6, ny = Math.sin(ang) * 0.9;
        for (let k = 0; k < thick; k++) {
          ctx.globalAlpha = (1 - t) * (k === 0 ? 0.6 : 1);
          ctx.fillStyle = k >= thick - 1 && thick > 1 ? "#ffffff" : f.color;
          ctx.fillRect(Math.round(x - nx * k), Math.round(y - ny * k), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    } else if (f.kind === "star") {
      // the impact flash: four long rays and four short ones, shooting out and thinning
      const u = easeOut(t), len = f.size * (0.4 + u * 0.8);
      ctx.globalAlpha = 1 - t * t;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.2, L = k % 2 ? len * 0.45 : len;
        for (let d = Math.floor(L * u * 0.5); d < L; d++) ctx.fillRect(Math.round(f.x + Math.cos(ang) * d), Math.round(f.y + Math.sin(ang) * d), 1, 1);
      }
      const c = Math.round(4 * (1 - t));
      if (c > 0) { ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(f.x) - c, Math.round(f.y) - c, c * 2, c * 2); }
      ctx.globalAlpha = 1;
    } else if (f.kind === "burst") {
      // a magic burst: a bright core that pops, a ring of runes flying out, a second ring trailing it
      const u = easeOut(t);
      ctx.globalAlpha = 1 - t;
      const core = Math.round(f.size * 0.3 * (1 - t));
      if (core > 0) {
        ctx.fillRect(Math.round(f.x) - core, Math.round(f.y) - core, core * 2, core * 2);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.round(f.x) - (core >> 1), Math.round(f.y) - (core >> 1), core, core);
        ctx.fillStyle = f.color;
      }
      for (const [rk, sz] of [[1, 2], [0.65, 1]] as const) {
        const r = f.size * u * rk;
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2 + t * 1.5 * (rk === 1 ? 1 : -1);
          ctx.fillRect(Math.round(f.x + Math.cos(ang) * r), Math.round(f.y + Math.sin(ang) * r * 0.8), sz, sz);
        }
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
