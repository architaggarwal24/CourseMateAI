// Chiptune sound (Stage S1): 8-bit effects and arena music, synthesized with WebAudio (no audio files to download).
// Pulse waves (12.5% / 25% / 50%), a triangle bass and filtered noise, like an old handheld. Two switches, kept in
// this browser: sound on/off (everything) and music on/off. Off by default for people who asked for reduced motion.
// Nothing plays before the first tap or key press (browsers block audio until then) or while the tab is hidden.
import { create } from "zustand";

export type Wave = "pulse12" | "pulse25" | "square" | "triangle" | "saw" | "noise";
/** One note of an effect: starts at `t` s, lasts `d` s, pitch `f` Hz (sliding to `to`). For noise, `f` is the filter. */
export interface Note { t: number; f: number; to?: number; d: number; w: Wave; v?: number }

export type Sfx =
  | "swing" | "hit" | "crit" | "block" | "hurt" | "cast" | "heal" | "shield" | "rage" | "taunt" | "ko" | "fight" | "ult" | "dodge"
  | "win" | "lose" | "coin" | "chest" | "buy" | "levelup" | "quest" | "achievement" | "click" | "select" | "emote";

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** "A4" → 440, "G#5", "Bb3". */
export function freq(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const semis = NOTE_INDEX[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semis - 69) / 12);
}
const n = freq;
const arp = (notes: string[], step: number, d: number, w: Wave, v = 0.22, t0 = 0): Note[] => notes.map((x, i) => ({ t: t0 + i * step, f: n(x), d, w, v }));

export const SFX: Record<Sfx, Note[]> = {
  swing: [{ t: 0, f: 2400, to: 500, d: 0.09, w: "noise", v: 0.16 }],
  hit: [{ t: 0, f: 3200, to: 900, d: 0.07, w: "noise", v: 0.35 }, { t: 0, f: 220, to: 90, d: 0.08, w: "square", v: 0.18 }],
  crit: [{ t: 0, f: 1760, to: 220, d: 0.14, w: "pulse12", v: 0.22 }, { t: 0, f: 4000, to: 600, d: 0.12, w: "noise", v: 0.4 }, { t: 0.02, f: 110, to: 45, d: 0.18, w: "triangle", v: 0.5 }],
  block: [{ t: 0, f: 1568, d: 0.03, w: "pulse25", v: 0.18 }, { t: 0.035, f: 1175, d: 0.07, w: "pulse25", v: 0.14 }],
  hurt: [{ t: 0, f: 320, to: 70, d: 0.2, w: "saw", v: 0.2 }, { t: 0, f: 1500, to: 300, d: 0.12, w: "noise", v: 0.25 }],
  cast: arp(["C5", "E5", "G5", "C6", "E6"], 0.035, 0.06, "pulse12", 0.16),
  heal: [{ t: 0, f: n("C5"), to: n("C6"), d: 0.22, w: "triangle", v: 0.35 }, ...arp(["E6", "G6"], 0.07, 0.08, "pulse25", 0.1, 0.12)],
  shield: [{ t: 0, f: 660, to: 990, d: 0.1, w: "pulse25", v: 0.16 }, { t: 0.1, f: 990, to: 1320, d: 0.12, w: "pulse25", v: 0.12 }],
  rage: [{ t: 0, f: 140, to: 50, d: 0.45, w: "saw", v: 0.26 }, { t: 0, f: 500, to: 150, d: 0.45, w: "noise", v: 0.3 }, ...arp(["E3", "F3", "E3", "F3", "E3"], 0.06, 0.05, "square", 0.12)],
  taunt: arp(["G5", "E5", "G5", "C5"], 0.08, 0.07, "pulse25", 0.2),
  ko: [{ t: 0, f: 4000, to: 200, d: 0.35, w: "noise", v: 0.35 }, { t: 0, f: 440, to: 40, d: 0.6, w: "square", v: 0.2 }],
  fight: [{ t: 0, f: n("C5"), d: 0.08, w: "pulse25", v: 0.2 }, { t: 0.1, f: n("G5"), d: 0.18, w: "pulse25", v: 0.22 }, { t: 0.1, f: n("C3"), d: 0.2, w: "triangle", v: 0.35 }],
  ult: [{ t: 0, f: 220, to: 1760, d: 0.32, w: "pulse12", v: 0.2 }, { t: 0.05, f: 800, to: 6000, d: 0.3, w: "noise", v: 0.18 }, { t: 0.3, f: n("A5"), d: 0.2, w: "pulse25", v: 0.18 }],
  dodge: [{ t: 0, f: 7000, to: 2000, d: 0.1, w: "noise", v: 0.12 }, { t: 0, f: 1500, to: 2600, d: 0.06, w: "pulse12", v: 0.1 }],
  win: [...arp(["C5", "E5", "G5"], 0.11, 0.1, "pulse25", 0.22), { t: 0.33, f: n("C6"), d: 0.45, w: "pulse25", v: 0.24 },
    ...arp(["C3", "G3"], 0.11, 0.1, "triangle", 0.4), { t: 0.33, f: n("C4"), d: 0.45, w: "triangle", v: 0.4 }],
  lose: [...arp(["G4", "F#4", "F4"], 0.2, 0.18, "pulse25", 0.2), { t: 0.6, f: n("E4"), to: n("D4"), d: 0.6, w: "pulse25", v: 0.2 },
    { t: 0, f: n("C3"), d: 0.6, w: "triangle", v: 0.3 }, { t: 0.6, f: n("B2"), d: 0.6, w: "triangle", v: 0.3 }],
  coin: [{ t: 0, f: n("B5"), d: 0.06, w: "pulse25", v: 0.18 }, { t: 0.06, f: n("E6"), d: 0.22, w: "pulse25", v: 0.18 }],
  chest: [{ t: 0, f: 300, to: 120, d: 0.16, w: "noise", v: 0.2 }, ...arp(["C5", "E5", "G5", "C6", "E6", "G6"], 0.05, 0.08, "pulse25", 0.16, 0.16), { t: 0.46, f: n("C7"), d: 0.3, w: "pulse12", v: 0.12 }],
  buy: [{ t: 0, f: n("B5"), d: 0.06, w: "pulse25", v: 0.18 }, { t: 0.06, f: n("E6"), d: 0.12, w: "pulse25", v: 0.18 }, ...arp(["G6", "C7"], 0.07, 0.1, "pulse12", 0.12, 0.18)],
  levelup: [...arp(["C5", "E5", "G5", "C6"], 0.07, 0.07, "pulse25", 0.2), ...arp(["G5", "C6", "E6"], 0.0, 0.5, "pulse12", 0.1, 0.3), { t: 0.3, f: n("G6"), d: 0.5, w: "pulse25", v: 0.18 },
    ...arp(["C3", "G3", "C4"], 0.1, 0.1, "triangle", 0.35), { t: 0.3, f: n("C3"), d: 0.5, w: "triangle", v: 0.35 }],
  quest: arp(["G5", "C6", "E6"], 0.06, 0.1, "pulse25", 0.16),
  achievement: [...arp(["E5", "G5", "E6", "C6", "D6"], 0.07, 0.07, "pulse25", 0.18), { t: 0.35, f: n("G6"), d: 0.35, w: "pulse25", v: 0.2 }],
  click: [{ t: 0, f: 1200, d: 0.02, w: "pulse12", v: 0.1 }],
  select: [{ t: 0, f: 660, d: 0.03, w: "pulse25", v: 0.12 }, { t: 0.035, f: 990, d: 0.05, w: "pulse25", v: 0.12 }],
  emote: [{ t: 0, f: 330, to: 660, d: 0.1, w: "pulse25", v: 0.18 }, { t: 0.11, f: 660, to: 440, d: 0.12, w: "pulse25", v: 0.16 }],
};

// ── music ───────────────────────────────────────────────────────────────────────────────────────────────────────
// One token per 16th note: a note name, "-" (hold), "." (rest). Drums: k kick, s snare, h hat, "." rest.
export interface Track { bpm: number; lead: string; bass: string; drums: string; harmony?: string }

const bar = (root: string, oct: string, fifth: string) => `${root} . ${root} . ${oct} . ${root} . ${root} . ${oct} . ${fifth} . ${oct} .`;
export const TRACKS = {
  arena: {
    bpm: 150,
    lead: [
      "E5 - A5 - C6 - B5 A5 B5 - G5 - E5 - - -", "F5 - A5 - C6 - D6 C6 A5 - F5 - C5 - - -",
      "E5 - G5 - C6 - E6 D6 C6 - G5 - E5 - G5 -", "D5 - G5 - B5 - D6 - B5 - G5 - D5 - . .",
      "A5 . A5 . C6 . A5 . E6 - D6 - C6 - B5 -", "C6 . C6 . A5 . F5 . A5 - C6 - F6 - E6 -",
      "D6 . D6 . B5 . G5 . B5 - D6 - G6 - F6 -", "E6 - - - B5 - G#5 - E5 - G#5 - B5 - D6 -",
    ].join(" "),
    bass: [bar("A2", "A3", "E3"), bar("F2", "F3", "C3"), bar("C3", "C4", "G3"), bar("G2", "G3", "D3"),
      bar("A2", "A3", "E3"), bar("F2", "F3", "C3"), bar("G2", "G3", "D3"), bar("E2", "E3", "B2")].join(" "),
    drums: "k.h.s.hkk.h.s.h.".repeat(7) + "k.h.s.hks.s.ssss",
  },
} satisfies Record<string, Track>;
export type TrackName = keyof typeof TRACKS;

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────
const KEY = "cmai_sound";
interface SoundState {
  /** false until read from this browser (the server renders with the defaults). */
  loaded: boolean;
  on: boolean;
  music: boolean;
  load: () => void;
  setOn: (on: boolean) => void;
  setMusic: (music: boolean) => void;
}
function prefersQuiet(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true || document.documentElement.classList.contains("reduce-animations");
}
function save(s: { on: boolean; music: boolean }) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export const useSound = create<SoundState>((set, get) => ({
  loaded: false,
  on: true,
  music: true,
  load: () => {
    if (get().loaded || typeof window === "undefined") return;
    let saved: Partial<{ on: boolean; music: boolean }> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* */ }
    const quiet = prefersQuiet();
    set({ loaded: true, on: typeof saved.on === "boolean" ? saved.on : !quiet, music: typeof saved.music === "boolean" ? saved.music : !quiet });
  },
  setOn: (on) => { get().load(); set({ on }); save({ on, music: get().music }); if (on) sfx("select"); },
  setMusic: (music) => { get().load(); set({ music }); save({ on: get().on, music }); },
}));

// ── engine ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Engine { ctx: AudioContext; sfx: GainNode; music: GainNode; noise: AudioBuffer; waves: Map<number, PeriodicWave> }
let engine: Engine | null = null;

function audio(create = true): Engine | null {
  if (typeof window === "undefined") return null;
  if (!engine && create) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const master = ctx.createGain(); master.gain.value = 0.4; master.connect(ctx.destination);
      const fx = ctx.createGain(); fx.gain.value = 1; fx.connect(master);
      const mu = ctx.createGain(); mu.gain.value = 0.42; mu.connect(master);
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      engine = { ctx, sfx: fx, music: mu, noise, waves: new Map() };
      unlockOnGesture();
    } catch { return null; }
  }
  if (engine && engine.ctx.state === "suspended" && !document.hidden) void engine.ctx.resume().catch(() => { /* needs a gesture */ });
  return engine;
}

let unlocking = false;
/** Browsers start audio suspended until the page is tapped or a key is pressed. */
function unlockOnGesture() {
  if (unlocking) return;
  unlocking = true;
  const go = () => { if (engine?.ctx.state === "suspended" && !document.hidden) void engine.ctx.resume().catch(() => { /* */ }); };
  window.addEventListener("pointerdown", go, { capture: true });
  window.addEventListener("keydown", go, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!engine) return;
    if (document.hidden) void engine.ctx.suspend().catch(() => { /* */ }); else go();
  });
}

/** A pulse wave with this duty cycle (its Fourier series). */
function pulse(e: Engine, duty: number): PeriodicWave {
  const hit = e.waves.get(duty);
  if (hit) return hit;
  const N = 32, real = new Float32Array(N), imag = new Float32Array(N);
  for (let k = 1; k < N; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  const w = e.ctx.createPeriodicWave(real, imag);
  e.waves.set(duty, w);
  return w;
}

function voice(e: Engine, bus: AudioNode, note: Note, t0: number, gain = 1) {
  const { ctx } = e;
  const start = t0 + note.t, end = start + Math.max(0.015, note.d);
  const peak = Math.max(0.0002, (note.v ?? 0.2) * gain);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.004);
  g.gain.setValueAtTime(peak, Math.max(start + 0.004, end - Math.min(0.05, note.d * 0.5)));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(bus);
  let src: AudioScheduledSourceNode;
  if (note.w === "noise") {
    const b = ctx.createBufferSource(); b.buffer = e.noise; b.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.Q.value = 1;
    f.frequency.setValueAtTime(note.f, start);
    if (note.to) f.frequency.exponentialRampToValueAtTime(note.to, end);
    b.connect(f); f.connect(g); src = b;
  } else {
    const o = ctx.createOscillator();
    if (note.w === "pulse12") o.setPeriodicWave(pulse(e, 0.125));
    else if (note.w === "pulse25") o.setPeriodicWave(pulse(e, 0.25));
    else o.type = note.w === "saw" ? "sawtooth" : note.w;
    o.frequency.setValueAtTime(note.f, start);
    if (note.to) o.frequency.exponentialRampToValueAtTime(note.to, end);
    o.connect(g); src = o;
  }
  src.start(start);
  src.stop(end + 0.02);
  src.onended = () => { try { g.disconnect(); } catch { /* */ } };
}

const lastPlayed = new Map<Sfx, number>();
/** Play an effect (if sound is on). The same effect twice within 40 ms plays once. */
export function sfx(name: Sfx) {
  const s = useSound.getState();
  if (!s.loaded) s.load();
  if (!useSound.getState().on) return;
  const e = audio();
  if (!e || e.ctx.state === "closed") return;
  const now = e.ctx.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < 0.04) return;
  lastPlayed.set(name, now);
  for (const note of SFX[name]) voice(e, e.sfx, note, now + 0.01);
}

// ── the music player ────────────────────────────────────────────────────────────────────────────────────────────
const tokens = (s: string) => s.trim().split(/\s+/);
interface Playing { name: TrackName; lead: string[]; bass: string[]; drums: string; step: number; next: number; timer: ReturnType<typeof setInterval> }
let playing: Playing | null = null;
let wanted: TrackName | null = null;
let intense = false;

function len(tok: string[], i: number) { let k = 1; while (tok[(i + k) % tok.length] === "-" && k < tok.length) k++; return k; }

function schedule(e: Engine, p: Playing, step: number, t: number, sixteenth: number) {
  const lead = p.lead[step % p.lead.length];
  if (lead !== "-" && lead !== ".") voice(e, e.music, { t: 0, f: freq(lead), d: sixteenth * len(p.lead, step % p.lead.length) * 0.92, w: "pulse25", v: 0.14 }, t);
  const bass = p.bass[step % p.bass.length];
  if (bass !== "-" && bass !== ".") voice(e, e.music, { t: 0, f: freq(bass), d: sixteenth * 0.9, w: "triangle", v: 0.42 }, t);
  const d = p.drums[step % p.drums.length];
  if (d === "k") voice(e, e.music, { t: 0, f: 160, to: 40, d: 0.11, w: "triangle", v: 0.6 }, t);
  if (d === "s") { voice(e, e.music, { t: 0, f: 2400, to: 800, d: 0.09, w: "noise", v: 0.26 }, t); voice(e, e.music, { t: 0, f: 190, to: 120, d: 0.05, w: "triangle", v: 0.2 }, t); }
  if (d === "h" || (intense && d === "." && step % 2 === 1)) voice(e, e.music, { t: 0, f: 9000, d: 0.025, w: "noise", v: d === "h" ? 0.08 : 0.05 }, t);
}

function startPlaying(name: TrackName) {
  const e = audio();
  if (!e) return;
  const track: Track = TRACKS[name];
  const p: Playing = { name, lead: tokens(track.lead), bass: tokens(track.bass), drums: track.drums, step: 0, next: e.ctx.currentTime + 0.08, timer: 0 as unknown as ReturnType<typeof setInterval> };
  p.timer = setInterval(() => {
    if (e.ctx.state !== "running") { p.next = e.ctx.currentTime + 0.05; return; }
    const sixteenth = 60 / (track.bpm * (intense ? 1.12 : 1)) / 4;
    if (p.next < e.ctx.currentTime - 0.2) p.next = e.ctx.currentTime + 0.05;   // the timer stalled: skip ahead, no burst
    while (p.next < e.ctx.currentTime + 0.12) { schedule(e, p, p.step, p.next, sixteenth); p.next += sixteenth; p.step = (p.step + 1) % p.drums.length; }
  }, 25);
  playing = p;
}

function stopPlaying() {
  if (!playing) return;
  clearInterval(playing.timer);
  playing = null;
}

function sync() {
  const s = useSound.getState();
  const should = wanted && s.on && s.music ? wanted : null;
  if (playing && playing.name !== should) stopPlaying();
  if (should && !playing) startPlaying(should);
}
useSound.subscribe(sync);

export const music = {
  /** Play this track (looped) while sound and music are on; again with the same name does nothing. */
  play(name: TrackName) { useSound.getState().load(); wanted = name; sync(); },
  stop() { wanted = null; intense = false; sync(); },
  /** Faster, busier drums (the boss is raging). */
  intensity(on: boolean) { intense = on; },
  get playing() { return playing?.name ?? null; },
};

/** Tests only: forget the audio engine (a fresh fake AudioContext next time). */
export function __resetSound() { stopPlaying(); wanted = null; intense = false; engine = null; lastPlayed.clear(); useSound.setState({ loaded: false, on: true, music: true }); }
