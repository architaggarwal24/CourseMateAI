"use client";

import Link from "next/link";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import type { BestiaryEntry } from "@/lib/arena/types";
import type { HuntTotals, TierStop } from "@/lib/bestiary/desk";
import { ROUTES } from "@/lib/routes";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The candle, the inkwell and quill, a loose page: the Scholar's desk the book lies on. Decoration only. */
export function DeskProps() {
  return (
    <div className="desk-props" aria-hidden="true">
      <div className="desk-candle"><span className="desk-candle__flame" /><span className="desk-candle__wax" /><span className="desk-candle__dish" /></div>
      <div className="desk-loose"><span /><span /><span /><span /></div>
      <div className="desk-ink"><span className="desk-ink__pot" /><span className="desk-ink__quill" /></div>
    </div>
  );
}

/**
 * The tier map: the four tiers as stops along a road, open or sealed, and where you are. Choosing a stop turns the
 * book to that tier's first page.
 */
export function TierMapPanel({ stops, onPick }: { stops: TierStop[]; onPick: (tier: number) => void }) {
  return (
    <nav className="desk-card desk-map" aria-labelledby="desk-map-title">
      <h3 id="desk-map-title" className="desk-card__title">The road through the book</h3>
      <ol className="desk-map__road">
        {stops.map((s) => (
          <li key={s.tier} className="desk-map__stop" data-open={s.open || undefined} data-here={s.here || undefined}>
            <button type="button" className="desk-map__btn" onClick={() => onPick(s.tier)}
              aria-label={`Tier ${s.roman}: ${s.open ? `${s.name}, ${s.beaten} of ${s.total} beaten` : "sealed"}${s.here ? ", you are here" : ""}. Turn to it.`}>
              <span className="desk-map__mark" aria-hidden="true">{s.open ? s.roman : "✠"}</span>
              <span className="desk-map__text" aria-hidden="true">
                <span className="desk-map__name">Tier {s.roman} · {s.name}</span>
                <span className="desk-map__count">
                  {s.open ? `${s.beaten} of ${s.total} beaten` : "Sealed in wax"}
                  {s.here && <span className="desk-map__here"> · you are here</span>}
                </span>
              </span>
            </button>
            {s.hint && <p className="desk-map__hint">{s.hint}</p>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The hunt record: every fight in the book, the seals and banes won, your best times, and what to hunt next. */
export function HuntRecordPanel({ totals: t, quarry, canHunt, onTurnTo }: {
  totals: HuntTotals; quarry: BestiaryEntry | null; canHunt: boolean; onTurnTo: (species: string) => void;
}) {
  return (
    <section className="desk-card desk-ledger" aria-labelledby="desk-ledger-title">
      <h3 id="desk-ledger-title" className="desk-card__title">Hunt record</h3>
      <dl className="desk-ledger__grid">
        <div><dt>Hunts</dt><dd>{t.hunts}</dd></div>
        <div><dt>Victories</dt><dd>{t.victories}</dd></div>
        <div><dt>Flawless</dt><dd>{t.flawless}</dd></div>
        <div><dt>Elder forms</dt><dd>{t.elder}</dd></div>
        <div><dt>Pages written</dt><dd>{t.written}<small> of {t.total}</small></dd></div>
        <div><dt>Banes known</dt><dd>{t.banes}</dd></div>
      </dl>
      <p className="desk-ledger__seals">
        <span className="sr-only">{`Seals: ${t.seals.gold} gold, ${t.seals.silver} silver, ${t.seals.bronze} bronze`}</span>
        <span data-seal="gold" aria-hidden="true">{t.seals.gold}</span>
        <span data-seal="silver" aria-hidden="true">{t.seals.silver}</span>
        <span data-seal="bronze" aria-hidden="true">{t.seals.bronze}</span>
        <span className="desk-ledger__seal-label" aria-hidden="true">seals</span>
      </p>
      <ul className="desk-ledger__bests">
        <li><span>Fastest kill</span>{t.fastest ? <b>{mmss(t.fastest.seconds)} · {t.fastest.name}</b> : <b>-</b>}</li>
        <li><span>Sharpest aim</span>{t.sharpest ? <b>{t.sharpest.accuracy}% · {t.sharpest.name}</b> : <b>-</b>}</li>
        <li><span>Lost pages found</span><b>{t.lostPages}</b></li>
        {t.last && <li><span>Last hunted</span><b>{t.last.name}, {t.last.when}</b></li>}
      </ul>
      {quarry && (
        <div className="desk-quarry">
          <PixelSprite boss={quarry.species} flip className="desk-quarry__sprite" />
          <div className="min-w-0">
            <p className="desk-quarry__over">Next quarry</p>
            <button type="button" className="desk-quarry__name" onClick={() => onTurnTo(quarry.species)}>{quarry.name}</button>
          </div>
          {canHunt && <Link className="tome-hunt tome-hunt--small" href={ROUTES.heroHunt(quarry.species)}>Hunt</Link>}
        </div>
      )}
    </section>
  );
}
