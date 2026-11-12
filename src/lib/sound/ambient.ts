// Ambient sound for Study's focus mode (the two worlds, Stage 6): rain, a quiet library, or soft lo-fi chords. All of
// it is made here (noise and oscillators), so there is nothing to download and nothing anyone else wrote.
export type Ambient = "off" | "rain" | "library" | "lofi";
export const AMBIENTS: { id: Ambient; label: string }[] = [
  { id: "off", label: "Silence" }, { id: "rain", label: "Rain" }, { id: "library", label: "Library" }, { id: "lofi", label: "Lo-fi" },
];

let audio: AudioContext | null = null;
let playing: { kind: Ambient; stop: () => void } | null = null;

function ctx(): AudioContext | null {
  if (audio && audio.state !== "closed") return audio;
  const C = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!C) return null;
  try { audio = new C(); } catch { return null; }
  return audio;
}

/** Two seconds of noise, looped: white, pink (softer highs) or brown (deep). */
function noise(a: AudioContext, color: "white" | "pink" | "brown"): AudioBufferSourceNode {
  const len = a.sampleRate * 2;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w;
    else if (color === "pink") { b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.05) * 1.6; }
    else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function start(kind: Exclude<Ambient, "off">): { kind: Ambient; stop: () => void } | null {
  const a = ctx();
  if (!a) return null;
  if (a.state === "suspended") void a.resume().catch(() => {});
  const out = a.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(1, a.currentTime + 1.2);       // fades in
  out.connect(a.destination);
  const stops: (() => void)[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  const blip = (f: number, d: number, v: number, type: OscillatorType = "sine") => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, a.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + d);
    o.connect(g); g.connect(out); o.start(); o.stop(a.currentTime + d + 0.05);
  };
  const bed = (color: "white" | "pink" | "brown", lo: number, hi: number, v: number) => {
    const n = noise(a, color), hp = a.createBiquadFilter(), lp = a.createBiquadFilter(), g = a.createGain();
    hp.type = "highpass"; hp.frequency.value = lo; lp.type = "lowpass"; lp.frequency.value = hi; g.gain.value = v;
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); n.start();
    stops.push(() => { try { n.stop(); } catch { /* already stopped */ } });
  };
  if (kind === "rain") {
    bed("pink", 400, 7000, 0.22);
    timers.push(setInterval(() => { if (Math.random() < 0.6) blip(1800 + Math.random() * 2400, 0.04, 0.03); }, 140));
  } else if (kind === "library") {
    bed("brown", 40, 450, 0.3);
    timers.push(setInterval(() => { if (Math.random() < 0.15) blip(300 + Math.random() * 200, 0.25, 0.012, "triangle"); }, 4000));   // a page, a chair
  } else {
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 311.1]];
    let i = 0;
    const play = () => { for (const f of chords[i % chords.length]) blip(f, 3.1, 0.05, "triangle"); i++; };
    play();
    timers.push(setInterval(play, 3200));
    bed("white", 2500, 9000, 0.012);                                // vinyl hiss
    timers.push(setInterval(() => { if (Math.random() < 0.3) blip(3000 + Math.random() * 2000, 0.01, 0.02, "square"); }, 300));
  }
  return {
    kind,
    stop: () => {
      timers.forEach(clearInterval);
      try { out.gain.cancelScheduledValues(a.currentTime); out.gain.linearRampToValueAtTime(0, a.currentTime + 0.4); } catch { /* closed */ }
      setTimeout(() => { stops.forEach((s) => s()); try { out.disconnect(); } catch { /* gone */ } }, 450);
    },
  };
}

export const ambient = {
  /** Play one ambience (replacing the last); "off" stops it. */
  play(kind: Ambient) {
    if (playing?.kind === kind) return;
    playing?.stop();
    playing = kind === "off" ? null : start(kind);
  },
  stop() { playing?.stop(); playing = null; },
  get current(): Ambient { return playing?.kind ?? "off"; },
};
