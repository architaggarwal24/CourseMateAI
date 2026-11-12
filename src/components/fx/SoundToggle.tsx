"use client";

import { useEffect } from "react";
import { Music, Volume2, VolumeX } from "@/components/ui/icons";
import { useSound } from "@/lib/sound/chip";

/**
 * The sound switch (Stage S1): `all` turns every sound on or off (the Hero header), `music` only the arena music
 * (the fight's HUD). Kept in this browser. Off by default for people who asked for reduced motion.
 */
export default function SoundToggle({ kind = "all", className = "" }: { kind?: "all" | "music"; className?: string }) {
  const loaded = useSound((s) => s.loaded);
  const on = useSound((s) => s.on);
  const music = useSound((s) => s.music);
  const load = useSound((s) => s.load);
  const setOn = useSound((s) => s.setOn);
  const setMusic = useSound((s) => s.setMusic);
  useEffect(() => { load(); }, [load]);

  const value = kind === "all" ? on : on && music;
  const label = kind === "all" ? "Sound" : "Music";
  const toggle = () => {
    const now = useSound.getState();
    if (kind === "all") setOn(!now.on);
    else if (!now.on) { setMusic(true); setOn(true); }
    else setMusic(!now.music);
  };
  return (
    <button type="button" className={`sound-toggle ${className}`} aria-pressed={value} aria-label={label} data-kind={kind} data-off={!value || undefined}
      title={`${label}: ${value ? "on" : "off"}`} onClick={toggle} disabled={!loaded} data-testid={`sound-${kind}`}>
      {kind === "all" ? (value ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />) : <Music size={16} aria-hidden="true" />}
    </button>
  );
}
