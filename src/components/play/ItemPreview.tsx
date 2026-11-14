"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Play, X } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import GearChips from "@/components/champion/GearChips";
import ItemArt from "@/components/champion/ItemArt";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Badge, Button } from "@/components/ui";
import { isWearable, useHeroStore, type ShopItem } from "@/hooks/useHero";
import { EMOTES } from "@/lib/arena/emotes";
import { studyBonuses } from "@/lib/game/bonuses";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/game/rarity";
import type { AnimName } from "@/lib/pixel/heroes";
import { sfx } from "@/lib/sound/chip";
import "@/components/arena/emotes.css";

const ANIMS: { id: AnimName; label: string }[] = [{ id: "idle", label: "Idle" }, { id: "attack", label: "Attack" }, { id: "win", label: "Win" }];

/** The item on the champion: worn gear and pets on the sprite, a title over it, an emote acted out, a potion on its own. */
function Stage({ item }: { item: ShopItem }) {
  const { hero, petId, petStage } = useChampionLook({ preview: true });
  const [anim, setAnim] = useState<AnimName>("idle");
  const [take, setTake] = useState(0);
  useEffect(() => { setTake(Date.now()); setAnim(item.category === "weapon" ? "attack" : "idle"); }, [item.id, item.category]);

  if (item.category === "emote") {
    const def = EMOTES[item.id];
    return (
      <>
        <div className="ipv__stage emote" data-kind="emote">
          <div className="emote__stage" data-motion={def?.motion} key={take}>
            {def && <p className="emote__bubble pixel-font">{def.bubble}</p>}
            {def?.sparkle && <span className="emote__sparkles" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</span>}
            <PixelSprite hero={hero} pet={petId} petStage={petStage} anim={def?.anim ?? "win"} label={`${hero.name} acting out ${item.name}`} className="emote__sprite" />
          </div>
        </div>
        <Button size="sm" onClick={() => { sfx("emote"); setTake(Date.now()); }}><Play size={14} aria-hidden="true" />Play again</Button>
      </>
    );
  }
  if (item.consumable || item.category === "potion") {
    return <div className="ipv__stage" data-kind="item"><ItemArt itemId={item.id} size={128} rarity={rarityOf(item)} /></div>;
  }
  return (
    <>
      <div className="ipv__stage" data-kind="worn">
        {item.category === "title" && <p className="ipv__titlebar pixel-font">{item.name}</p>}
        <PixelSprite key={`${anim}-${take}`} hero={hero} pet={petId} petStage={petStage} anim={anim} fidget={anim === "idle"}
          label={`${hero.name}${item.category === "title" ? `, titled ${item.name}` : `, wearing ${item.name}`}`} className="ipv__sprite" />
      </div>
      <div className="champ-anims" role="group" aria-label="Animation">
        {ANIMS.map((a) => (
          <button key={a.id} type="button" className="champ-anims__btn" aria-pressed={anim === a.id} onClick={() => { setAnim(a.id); setTake(Date.now()); }}>{a.label}</button>
        ))}
      </div>
    </>
  );
}

/** What this item would add to study rewards, given what else is worn (only the best item for each stat counts). */
function StudyBonus({ item }: { item: ShopItem }) {
  const shop = useHeroStore((s) => s.shop);
  if (!item.bonus || !Object.values(item.bonus).some(Boolean)) return null;
  const others = Object.entries(shop?.equipped ?? {})
    .filter(([slot, id]) => id && id !== item.id && slot !== item.category)
    .map(([, id]) => shop?.items.find((i) => i.id === id))
    .filter((i): i is ShopItem => !!i);
  const mine = studyBonuses([item]).stats;
  const together = studyBonuses([item, ...others]);
  return (
    <div className="ipv__block">
      <p className="hero-label">Study bonus</p>
      <ul className="ipv__bonus" aria-label="Study bonus">
        {mine.map((s) => {
          const counts = together.best[s.key] === item.id;
          const beaten = together.stats.find((t) => t.key === s.key);
          return (
            <li key={s.key} data-counts={counts || undefined}>
              <span className="hero-bonus"><span>{s.label}</span><strong className="pixel-font">{s.value}</strong></span>
              <span className="ipv__note">{counts ? "Your best: it counts" : `${beaten?.from} gives more (${beaten?.value})`}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The left panel's preview of one item (click any item in the shop or the inventory): the champion wearing it,
 * animated (an emote acted out, a potion on its own), what it does in the arena and for study, and what you can do
 * with it. Esc or the close button goes back to the panel's usual content.
 */
export default function ItemPreview({ item, status, children }: { item: ShopItem; status?: ReactNode; children?: ReactNode }) {
  const setPreview = useHeroStore((s) => s.setPreview);
  useEffect(() => {
    // Esc closes the preview (and is used up, so the pause menu doesn't open as well)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) { e.preventDefault(); setPreview(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPreview]);
  // on a phone the panel sits above the grid: bring it into view when an item is opened
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 767.98px)").matches) ref.current?.scrollIntoView?.({ block: "start" });
  }, [item.id]);
  const rarity = rarityOf(item);
  return (
    <section ref={ref} className={`ipv ${rarityClass(rarity)}`} aria-label={`Preview: ${item.name}`} data-testid="item-preview" data-rarity={rarity}>
      <div className="ipv__head">
        <p className="hero-label m-0">{isWearable(item) ? "Try it on" : item.category === "emote" ? "Victory emote" : "Item"}</p>
        <Button size="sm" variant="ghost" icon aria-label="Close preview" title="Close (Esc)" onClick={() => setPreview(null)}><X size={16} aria-hidden="true" /></Button>
      </div>
      <Stage item={item} />
      <div className="ipv__info">
        <p className="ipv__tags">
          <Badge tone={rarity}>{RARITY_LABEL[rarity]}</Badge>
          {item.equipped && <Badge tone="success"><Check size={10} aria-hidden="true" />Equipped</Badge>}
          {status}
        </p>
        <h2 className="ipv__name">{item.name}</h2>
        <p className="ipv__desc">{item.description}</p>
      </div>
      {item.battle && Object.values(item.battle).some(Boolean) && (
        <div className="ipv__block"><p className="hero-label">In the arena</p><GearChips stats={item.battle} /></div>
      )}
      <StudyBonus item={item} />
      {children && <div className="ipv__actions">{children}</div>}
    </section>
  );
}
