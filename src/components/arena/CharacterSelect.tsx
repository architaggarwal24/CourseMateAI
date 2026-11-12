"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Crown, Lock, Swords } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { lookFor, useMyHeroLook } from "@/components/champion/useChampionLook";
import { isUnlocked, useChampion } from "@/hooks/useChampion";
import { useHeroStore } from "@/hooks/useHero";
import { useMyHero } from "@/hooks/useMyHero";
import { FINISHERS, STYLE_FINISHERS } from "@/lib/arena/finishers";
import { shortcutBlocked } from "@/lib/keys";
import { HERO_FIGHTER_ID } from "@/lib/pixel/appearance";
import { HEROES } from "@/lib/pixel/heroes";
import PixelSprite from "./pixel/PixelSprite";
import { STYLE_LABEL } from "./pixel/Roster";

/**
 * Character select (Stage 5): pick who fights this battle while its questions are written. The roster as an arcade
 * grid (a radio group: arrow keys move, champions who haven't joined yet are skipped), the highlighted champion large
 * with their passive, ultimate and FINAL MOVE. Enter (or Fight!) locks the pick in; the VS screen follows.
 */
export default function CharacterSelect({ ready, failed, onPick, onRetry }: {
  /** The fight's questions are written. */
  ready: boolean;
  failed: boolean;
  onPick: (championId: string) => void;
  onRetry: () => void;
}) {
  const current = useChampion((s) => s.championId);
  const progress = useChampion((s) => s.progress);
  const shop = useHeroStore((s) => s.shop);
  const mine = useMyHeroLook();
  const view = useMyHero((s) => s.view);
  const ids = [...HEROES.map((h) => h.id), HERO_FIGHTER_ID];
  const open = ids.filter((id) => id === HERO_FIGHTER_ID || isUnlocked(progress, id));
  const [sel, setSel] = useState(() => (open.includes(current) ? current : open[0]));
  const grid = useRef<HTMLDivElement>(null);

  const isHero = sel === HERO_FIGHTER_ID;
  const look = lookFor(sel, shop, null, mine).hero;
  const kit = progress[sel]?.kit;
  const styleName = view?.catalog.styles.find((x) => x.id === view.build.style)?.name ?? "Apprentice Blade";
  const finisher = isHero ? STYLE_FINISHERS[view?.build.style ?? "apprentice"] ?? "Final Move"
    : progress[sel]?.signature?.worn ? progress[sel]!.signature!.finisher : FINISHERS[sel] ?? "Final Move";
  const name = isHero ? "Your hero" : look.name;

  const move = (d: number) => {
    const i = open.indexOf(sel);
    const n = open[(i + d + open.length) % open.length];
    setSel(n);
    (grid.current?.querySelector(`[data-hero="${n}"]`) as HTMLElement | null)?.focus();
  };
  const live = useRef({ sel, onPick, move });
  live.current = { sel, onPick, move };
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      if (e.key === "Enter" || e.key === " ") {
        if ((e.target as HTMLElement | null)?.closest?.("button:not([role=radio])")) return;   // a real button handles itself
        e.preventDefault();
        live.current.onPick(live.current.sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // the highlighted card takes focus, so the arrows work at once
  useEffect(() => { (grid.current?.querySelector(`[data-hero="${sel}"]`) as HTMLElement | null)?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="arena-select" aria-labelledby="arena-select-title">
      <h2 id="arena-select-title" className="arena-select__title pixel-font">Select your champion</h2>

      <div className="arena-select__body">
        <figure className="arena-select__fighter" style={{ "--hero-accent": look.accent } as React.CSSProperties}>
          <PixelSprite hero={look} anim="idle" fidget className="arena-select__sprite" label={`${name}, ready to fight`} />
          <figcaption className="arena-select__info">
            <span className="arena-select__name pixel-font">{name}</span>
            <span className="arena-select__style">{isHero ? styleName : `${STYLE_LABEL[look.style]} · ${look.blurb}`}</span>
            {kit && (
              <dl className="arena-select__kit">
                <div><dt>Passive</dt><dd><b>{kit.passive.name}</b> {kit.passive.text}</dd></div>
                <div><dt>Ultimate</dt><dd><b>{kit.ultimate.name}</b> {kit.ultimate.text}</dd></div>
              </dl>
            )}
            <span className="arena-select__finisher"><Crown size={13} aria-hidden="true" />Final move: <b>{finisher}</b></span>
          </figcaption>
        </figure>

        <div ref={grid} className="arena-select__grid" role="radiogroup" aria-labelledby="arena-select-title">
          {ids.map((id) => {
            const locked = !open.includes(id);
            const h = lookFor(id, shop, null, mine).hero;
            const label = id === HERO_FIGHTER_ID ? "Your hero" : h.name;
            return (
              <button
                key={id} type="button" role="radio" data-hero={id} aria-checked={sel === id} tabIndex={sel === id ? 0 : -1}
                aria-disabled={locked || undefined} data-locked={locked || undefined} className="arena-select__card"
                style={{ "--hero-accent": locked ? "var(--color-muted)" : h.accent } as React.CSSProperties}
                aria-label={locked ? `${label}, not joined yet${progress[id]?.unlock?.how ? `: ${progress[id]!.unlock!.how}` : ""}` : label}
                onClick={() => { if (locked) return; if (sel === id) onPick(id); else setSel(id); }}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  move(d);
                }}
              >
                <PixelSprite hero={h} portrait className="arena-select__portrait" />
                <span className="arena-select__card-name pixel-font" aria-hidden="true">{label}</span>
                {locked && <Lock size={14} className="arena-select__lock" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <footer className="arena-select__foot">
        <p className="arena-select__status" role="status" aria-live="polite">
          {failed ? "The questions didn't come. Nothing is lost." : ready ? "The questions are ready." : "Writing the fight's questions from your document…"}
        </p>
        {failed && <Button variant="ghost" onClick={onRetry}>Try again</Button>}
        <Button variant="primary" onClick={() => onPick(sel)} aria-keyshortcuts="Enter">
          <Swords size={16} aria-hidden="true" />Fight as {name}
        </Button>
      </footer>
    </section>
  );
}
