"use client";

import { useEffect } from "react";
import { Music, Volume2 } from "@/components/icons";
import { Checkbox } from "@/components/ui";
import { useSound } from "@/lib/sound/chip";

/** Settings → Appearance: the game's 8-bit sounds and the arena music (saved right away, in this browser). */
export default function SoundSettings() {
  const { loaded, on, music, load, setOn, setMusic } = useSound();
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <Checkbox appearance="switch" checked={on} disabled={!loaded} onChange={(e) => setOn(e.target.checked)}
        label={<span className="flex items-center gap-2"><Volume2 size={14} aria-hidden="true" />Game sounds: {on ? "on" : "off"}</span>}
        description="8-bit sounds in the Hero area: hits, coins, chests, level-ups. Saved right away, on this device." />
      <Checkbox appearance="switch" checked={on && music} disabled={!loaded || !on} onChange={(e) => setMusic(e.target.checked)}
        label={<span className="flex items-center gap-2"><Music size={14} aria-hidden="true" />Arena music: {on && music ? "on" : "off"}</span>}
        description="A chiptune loop while you fight." />
    </>
  );
}
