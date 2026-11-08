"use client";

import { useEffect, useState } from "react";
import { Lock } from "@/components/icons";
import ItemArt from "@/components/champion/ItemArt";
import PixelSprite from "./pixel/PixelSprite";
import { fetchEmotes } from "@/lib/arena/api";
import { EMOTES, EMOTE_ORDER } from "@/lib/arena/emotes";
import type { EmoteEntry } from "@/lib/arena/types";
import type { HeroDef } from "@/lib/pixel/heroes";
import { sfx } from "@/lib/sound/chip";
import "./emotes.css";

/** Before the server answers (or offline): the three free ones. */
const FREE: EmoteEntry[] = ["emote_gg", "emote_bow", "emote_flex"].map((id) => ({ id, name: EMOTES[id].name, owned: true, how: "Free" }));

/**
 * After a win (Stage A2): the champion stands over the beaten creature and the player picks an emote from a wheel;
 * the champion acts it out (pose, bubble, a hop or a sway). Locked ones show how to get them.
 */
export default function EmoteWheel({ hero, pet }: { hero: HeroDef; pet?: string | null }) {
  const [list, setList] = useState<EmoteEntry[]>(FREE);
  const [playing, setPlaying] = useState<{ id: string; key: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetchEmotes().then((r) => { if (alive) setList(r.emotes); }).catch(() => { /* the free ones stay */ });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setPlaying((p) => (p?.key === playing.key ? null : p)), 2600);
    return () => clearTimeout(t);
  }, [playing]);

  const sorted = [...list].sort((a, b) => EMOTE_ORDER.indexOf(a.id) - EMOTE_ORDER.indexOf(b.id));
  const def = playing ? EMOTES[playing.id] : null;
  const n = sorted.length;

  return (
    <section className="emote" aria-labelledby="emote-title">
      <h3 id="emote-title" className="emote__title pixel-font">Victory emote</h3>
      <div className="emote__ring">
      <div className="emote__stage" data-motion={def?.motion ?? undefined} key={playing?.key ?? "idle"}>
        {def && <p className="emote__bubble pixel-font" role="status">{def.bubble}</p>}
        {def?.sparkle && <span className="emote__sparkles" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</span>}
        <PixelSprite hero={hero} pet={pet} anim={def?.anim ?? "win"} label={def ? `${hero.name}: ${def.name}` : `${hero.name} stands victorious`} className="emote__sprite" />
      </div>
      <ul className="emote__wheel" aria-label="Emotes">
        {sorted.map((e, i) => {
          const angle = (i / n) * 360 - 90;
          return (
            <li key={e.id} style={{ "--a": `${angle}deg` } as React.CSSProperties}>
              <button type="button" className="emote__btn" disabled={!e.owned} data-on={playing?.id === e.id || undefined}
                aria-label={e.owned ? e.name : `${e.name}, locked: ${e.how}`} title={e.owned ? e.name : `${e.name}: ${e.how}`}
                onClick={() => { sfx("emote"); setPlaying({ id: e.id, key: Date.now() }); }}>
                <ItemArt itemId={e.id} size={34} />
                {!e.owned && <Lock size={10} className="emote__lock" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      </div>
    </section>
  );
}
