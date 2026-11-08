"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { FightScene, type Beat, type IntentTint } from "@/lib/pixel/fight";
import type { HeroDef } from "@/lib/pixel/heroes";

export interface Floater { id: string; text: string; sub?: string; side: "boss" | "hero"; kind: "hit" | "crit" | "hurt" | "pet" | "block" | "shield" | "heal" | "focus" }

/**
 * The fight as a side-view pixel stage: the hero on the left, the mythic boss on the right, on the boss's home stage.
 * Everything it shows is ALSO said in words by the HUD and the verdict around it - this is the spectacle.
 *
 * `beats` (with a changing `beatKey`) are what just happened; the scene plays them in order. Damage numbers for a
 * side appear when the blow on that side actually lands.
 */
function PixelArena({ hero, pet = null, bossId, stageId, rage, intent, shield, beats, beatKey, floaters, speech, label, introText = "FIGHT!",
  heroSpeech, callout, calloutKey, intro }: {
  hero: HeroDef;
  /** The pet idling behind the champion. */
  pet?: string | null;
  bossId: string;
  stageId?: string;
  rage: boolean;
  intent: IntentTint;
  shield: number;
  beats: Beat[];
  beatKey: string | number;
  floaters: Floater[];
  speech?: string;
  /** What the picture shows, for screen readers (e.g. "Kaien faces the Hydra"). */
  label: string;
  /** The entrance banner ("FIGHT!", or "NEMESIS" for a Nemesis). */
  introText?: string;
  /** Stage A2: what the champion just said (a taunt), in a bubble over them. */
  heroSpeech?: { text: string; key: number };
  /** The announcer: "COMBO x5!", "BANE!" (keyed on the answer). */
  callout?: string;
  calloutKey?: string | number;
  /** The boss's title card, shown as the fight opens. */
  intro?: { name: string; title: string; tier: number; origin: string };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<FightScene | null>(null);
  const reduced = !!useReducedMotionConfig();
  const [landed, setLanded] = useState<{ key: string | number; sides: Set<string> }>({ key: "", sides: new Set() });
  const [banner, setBanner] = useState<{ text: string; tone: string; id: number } | null>(null);
  const keyRef = useRef(beatKey);
  keyRef.current = beatKey;

  // One scene per boss (a new fight); hero / rage / intent / shield are pushed into it.
  useEffect(() => {
    if (!canvas.current?.getContext?.("2d")) return;     // no canvas (tests): the words around it carry the fight
    const s = new FightScene(canvas.current, {
      hero, pet, bossId, stageId, reduced,
      // only blows of the turn on screen reveal its numbers (a late blow of the last turn reveals nothing)
      onImpact: (side, key) => {
        if (key === undefined || key !== keyRef.current) return;
        setLanded((l) => (l.key === key ? { key, sides: new Set([...l.sides, side]) } : { key, sides: new Set([side]) }));
      },
      onBanner: (text, tone) => setBanner({ text, tone, id: Date.now() }),
    });
    scene.current = s;
    s.play({ kind: "intro", text: introText });
    return () => { s.destroy(); scene.current = null; };
  }, [bossId, stageId, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scene.current?.setHero(hero); }, [hero]);
  useEffect(() => { scene.current?.setPet(pet); }, [pet]);
  useEffect(() => { scene.current?.setRage(rage); }, [rage]);
  useEffect(() => { scene.current?.setIntent(intent); }, [intent]);
  useEffect(() => { scene.current?.setShield(shield); }, [shield]);

  // New beats: play them. Damage numbers wait for the impact (or appear anyway after a moment).
  // Keyed on beatKey alone (the beats array is rebuilt every render): each turn plays once.
  const beatsRef = useRef(beats);
  beatsRef.current = beats;
  const played = useRef(new Set<string | number>());
  useEffect(() => {
    const list = beatsRef.current;
    if (!beatKey || !list.length || played.current.has(beatKey)) return;   // a key coming back (after a spell) is not replayed
    played.current.add(beatKey);
    setLanded({ key: beatKey, sides: new Set() });
    scene.current?.reset();
    for (const b of list) scene.current?.play({ ...b, key: beatKey });
    // no scene (no canvas) or a blow that never lands: the numbers show anyway, after the longest sequence
    const fallback = setTimeout(() => setLanded((l) => (l.key === beatKey ? { key: beatKey, sides: new Set(["hero", "boss"]) } : l)), scene.current ? 4000 : 0);
    return () => clearTimeout(fallback);
  }, [beatKey]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), banner.tone === "ko" || banner.tone === "lose" ? 2200 : 1100);
    return () => clearTimeout(t);
  }, [banner]);

  const visible = floaters.filter((f) => landed.key === beatKey && landed.sides.has(f.side));
  // the boss's title card: once, as the fight opens
  const [card, setCard] = useState(!!intro);
  useEffect(() => { if (!card) return; const t = setTimeout(() => setCard(false), reduced ? 1200 : 2200); return () => clearTimeout(t); }, [card, reduced]);
  const [said, setSaid] = useState<{ text: string; key: number } | null>(null);
  useEffect(() => {
    if (!heroSpeech) return;
    setSaid(heroSpeech);
    const t = setTimeout(() => setSaid((s) => (s?.key === heroSpeech.key ? null : s)), 2200);
    return () => clearTimeout(t);
  }, [heroSpeech?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // the announcer waits for the blow to land
  const shout = callout && landed.key === beatKey && landed.sides.has("boss") ? callout : null;

  return (
    <div className="px-arena" data-rage={rage || undefined}>
      <canvas ref={canvas} className="px-arena__canvas" role="img" aria-label={label} />
      {speech && <p className="px-arena__speech" key={speech}>&ldquo;{speech}&rdquo;</p>}
      {said && <p className="px-arena__speech px-arena__speech--hero" key={`h${said.key}`}>&ldquo;{said.text}&rdquo;</p>}
      <AnimatePresence>
        {card && intro && (
          <motion.div key="card" className="px-arena__card" aria-hidden="true"
            initial={{ x: "-110%" }} animate={{ x: 0 }} exit={{ x: "110%" }} transition={{ type: "tween", ease: [0.7, 0, 0.3, 1], duration: reduced ? 0 : 0.35 }}>
            <span className="px-arena__card-tier pixel-font">Tier {["", "I", "II", "III", "IV"][intro.tier] ?? intro.tier} · {intro.origin}</span>
            <span className="px-arena__card-name pixel-font">{intro.name}</span>
            <span className="px-arena__card-title">{intro.title}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {shout && (
          <motion.p key={`c${calloutKey}`} className="px-arena__callout pixel-font" aria-hidden="true"
            initial={{ scale: 0.3, rotate: -8, opacity: 0 }} animate={{ scale: [1.4, 1], rotate: [-8, 3, 0], opacity: 1 }} exit={{ opacity: 0, y: -16 }}
            transition={{ duration: reduced ? 0 : 0.35 }}>{shout}</motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {banner && (
          <motion.p
            key={banner.id} className="px-arena__banner pixel-font" data-tone={banner.tone} aria-hidden="true"
            initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
          >{banner.text}</motion.p>
        )}
      </AnimatePresence>
      <div className="px-arena__floaters" aria-hidden="true">
        <AnimatePresence>
          {visible.map((f) => (
            <motion.span
              key={f.id} className="arena-floater" data-side={f.side} data-kind={f.kind}
              initial={{ opacity: 0, y: 12, scale: 0.4 }} animate={{ opacity: 1, y: -34, scale: f.kind === "crit" ? [0.4, 1.5, 1] : [0.4, 1.2, 1] }} exit={{ opacity: 0, y: -70 }}
              transition={reduced ? { duration: 0 } : { y: { type: "spring", stiffness: 320, damping: 18 }, scale: { duration: 0.4, times: [0, 0.55, 1] }, opacity: { duration: 0.15 } }}
            >
              <b className="pixel-font">{f.text}</b>
              {f.sub && <small>{f.sub}</small>}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default memo(PixelArena);
