// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFX, TRACKS, __resetSound, freq, music, sfx, useSound } from "./chip";

/** A fake AudioContext that counts the sounds started. */
class FakeParam { value = 0; setValueAtTime() { return this; } linearRampToValueAtTime() { return this; } exponentialRampToValueAtTime(v: number) { if (v <= 0) throw new RangeError("exp ramp to 0"); return this; } }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam(); type = ""; buffer: unknown = null; loop = false; onended: (() => void) | null = null; connect() { return this; } disconnect() {} start() { started.n++; } stop() {} setPeriodicWave() {} }
const started = { n: 0, contexts: 0 };
class FakeAudioContext {
  state = "running"; currentTime = 0; sampleRate = 8000; destination = new FakeNode();
  constructor() { started.contexts++; }
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBuffer(_c: number, len: number) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  createPeriodicWave() { return {}; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}

beforeEach(() => {
  started.n = 0; started.contexts = 0;
  vi.stubGlobal("AudioContext", FakeAudioContext);
  localStorage.clear();
  document.documentElement.classList.remove("reduce-animations");
  __resetSound();
});
afterEach(() => { music.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("chiptune sound", () => {
  it("names notes", () => {
    expect(freq("A4")).toBeCloseTo(440);
    expect(freq("C4")).toBeCloseTo(261.63, 1);
    expect(freq("G#5")).toBeCloseTo(830.61, 1);
  });

  it("plays an effect: one voice per note", () => {
    sfx("coin");
    expect(started.n).toBe(SFX.coin.length);
  });

  it("every effect plays without errors (no ramps to zero, no bad notes)", () => {
    for (const name of Object.keys(SFX) as (keyof typeof SFX)[]) expect(() => sfx(name)).not.toThrow();
  });

  it("is silent when sound is off, and remembers it", () => {
    useSound.getState().setOn(false);
    started.n = 0;
    sfx("hit");
    expect(started.n).toBe(0);
    expect(JSON.parse(localStorage.getItem("cmai_sound")!)).toEqual({ on: false, music: true });
  });

  it("starts off for people who asked for reduced motion (until they turn it on)", () => {
    document.documentElement.classList.add("reduce-animations");
    sfx("hit");
    expect(started.contexts).toBe(0);
    expect(useSound.getState().on).toBe(false);
    useSound.getState().setOn(true);
    expect(started.n).toBeGreaterThan(0);
  });

  it("a saved choice wins over the default", () => {
    document.documentElement.classList.add("reduce-animations");
    localStorage.setItem("cmai_sound", JSON.stringify({ on: true, music: false }));
    useSound.getState().load();
    expect(useSound.getState()).toMatchObject({ on: true, music: false });
  });

  it("the same effect twice at once plays once", () => {
    sfx("hit"); sfx("hit");
    expect(started.n).toBe(SFX.hit.length);
  });

  it("the arena track: every part lines up in 16th notes and every note is real", () => {
    const t = TRACKS.arena;
    const lead = t.lead.trim().split(/\s+/), bass = t.bass.trim().split(/\s+/);
    expect(lead.length).toBe(t.drums.length);
    expect(bass.length).toBe(t.drums.length);
    expect(t.drums.length % 16).toBe(0);
    for (const x of [...lead, ...bass]) if (x !== "-" && x !== ".") expect(freq(x)).toBeGreaterThan(40);
    expect(t.drums).toMatch(/^[ksh.]+$/);
  });

  it("music plays while music is on, stops when it is turned off or the fight ends", () => {
    vi.useFakeTimers();
    music.play("arena");
    expect(music.playing).toBe("arena");
    vi.advanceTimersByTime(60);
    expect(started.n).toBeGreaterThan(0);
    useSound.getState().setMusic(false);
    expect(music.playing).toBe(null);
    useSound.getState().setMusic(true);
    expect(music.playing).toBe("arena");
    music.stop();
    expect(music.playing).toBe(null);
  });

  it("no music while all sound is off", () => {
    useSound.getState().setOn(false);
    music.play("arena");
    expect(music.playing).toBe(null);
  });
});
