"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { BOSSES } from "@/lib/pixel/bosses";
import { fetchBestiary } from "@/lib/arena/api";
import type { BestiaryEntry, BestiaryResponse, BestiaryTier, Move } from "@/lib/arena/types";
import { useHUDStore } from "@/hooks/useHUD";
import PixelSprite from "./PixelSprite";

export const LORE: Record<string, string> = {
  hydra: "Cut one head, two grow back. Feeds on half-learned biology.",
  minotaur: "Lord of the labyrinth. Algorithms, graphs, every maze of logic.",
  cyclops: "Smith of thunder. Physics, engineering, machines.",
  fenrir: "The wolf no chain could hold. Economics, power, war.",
  jormungandr: "The serpent that circles the world. Earth, climate, cycles.",
  kraken: "From the deep. Chemistry, fluids, pressure.",
  naga: "Guardian of hidden treasure. Philosophy, culture, language.",
  rakshasa: "Master of illusion. Psychology, the mind, deception.",
  oni: "The club that breaks scholars. Business, health, exams.",
  kitsune: "Nine tails, nine tricks. Mathematics and puzzles.",
  sphinx: "Answer or be devoured. Logic, reasoning, history.",
  simurgh: "Has watched for three thousand years. Knowledge itself.",
  ammit: "Devourer of the unworthy. Your Nemesis: made of your mistakes.",
};

const ROMAN = ["", "I", "II", "III", "IV"];
/** The champion each finished tier brings (Stage C1, server roster.ts). */
export const TIER_CHAMPION = ["", "Asha", "Brak", "Mira", "Vex"];
const MOVE_LABEL: Record<Move, string> = { strike: "Strike", jab: "Jab", heavy: "Heavy", guard: "Guard" };
const MASTERY_LABEL = { none: "", bronze: "Bronze", silver: "Silver", gold: "Gold" } as const;

/** Before the Bestiary answers (or for a visitor): every creature, tier I open. */
function fallback(): BestiaryResponse {
  const TIER: Record<string, number> = { minotaur: 1, cyclops: 1, oni: 1, kitsune: 1, naga: 2, rakshasa: 2, sphinx: 2, fenrir: 2, hydra: 3, kraken: 3, ammit: 3, simurgh: 4, jormungandr: 4 };
  const names = ["", "Beasts of the Wilds", "Tricksters and Hunters", "Ancient Horrors", "World-Enders"];
  return {
    tiers: [1, 2, 3, 4].map((t) => ({ tier: t, name: names[t], open: t === 1, beaten: 0, total: Object.values(TIER).filter((x) => x === t).length, opens_next_at: t < 4 ? 2 : null })),
    creatures: Object.keys(TIER).map((s) => ({
      species: s, tier: TIER[s], open: TIER[s] === 1, met: false, defeated: false, name: TIER[s] === 1 ? BOSSES[s]?.name ?? s : null,
      origin: TIER[s] === 1 ? BOSSES[s]?.origin ?? null : null, teaser_topic: null, mastery: "none", record: null, bane: null,
    })),
  };
}

function Card({ c }: { c: BestiaryEntry }) {
  const def = BOSSES[c.species];
  if (!c.open) {
    return (
      <li className="px-beast px-beast--locked" style={{ "--beast-accent": "var(--color-muted)" } as React.CSSProperties} aria-label="A locked creature">
        <span className="px-beast__stage" aria-hidden="true"><PixelSprite boss={c.species} flip className="px-beast__sprite px-beast__sprite--silhouette" /></span>
        <span className="px-beast__name pixel-font">???</span>
        <span className="px-beast__lore">
          {c.teaser_topic ? <>Something stirs when you study <b>{c.teaser_topic}</b>…</> : "Its page is still dark."}
        </span>
      </li>
    );
  }
  return (
    <li className="px-beast" style={{ "--beast-accent": def?.accent } as React.CSSProperties} data-stage={def?.stage}>
      <span className="px-beast__stage" aria-hidden="true"><PixelSprite boss={c.species} flip className="px-beast__sprite" /></span>
      <span className="px-beast__name pixel-font">{c.name}</span>
      <span className="px-beast__origin">{c.origin} myth{c.mastery !== "none" ? ` · ${MASTERY_LABEL[c.mastery]}` : ""}</span>
      <span className="px-beast__lore">{LORE[c.species]}</span>
      {c.record && c.record.fights > 0 && (
        <span className="px-beast__record">{c.record.wins} {c.record.wins === 1 ? "win" : "wins"} of {c.record.fights}{c.record.best_accuracy !== null ? ` · best ${c.record.best_accuracy}%` : ""}</span>
      )}
      {c.bane && (c.bane.moves ? (
        <span className="px-beast__bane"><span className="sr-only">Bane: </span>{c.bane.moves.map((m) => MOVE_LABEL[m]).join(" > ")}</span>
      ) : (
        <span className="px-beast__clue">“{c.bane.clue}”{c.bane.found_alone ? " · found" : ""}</span>
      ))}
    </li>
  );
}

function TierHead({ t, next }: { t: BestiaryTier; next?: BestiaryTier }) {
  return (
    <h4 className="px-tier__head">
      <span className="pixel-font">Tier {ROMAN[t.tier]}</span> · {t.open ? t.name : "Sealed"}
      <span className="px-tier__count">
        {t.open ? ` ${t.beaten} of ${t.total} beaten` : ""}
        {t.open && next && !next.open && t.opens_next_at ? ` · beat ${t.opens_next_at} to open tier ${ROMAN[next.tier]}` : ""}
        {t.open && TIER_CHAMPION[t.tier] ? ` · finish the tier to free ${TIER_CHAMPION[t.tier]}` : ""}
      </span>
    </h4>
  );
}

/** Every creature by tier: a sealed tier's pages are silhouettes until two of the tier before it fall. */
export function Bestiary() {
  // a visitor (or before sign-in is known) sees the fallback: asking would only answer 401
  const guest = useHUDStore((s) => s.guestMode);
  const [data, setData] = useState<BestiaryResponse>(fallback);
  useEffect(() => {
    if (guest) return;
    let alive = true;
    fetchBestiary().then((d) => { if (alive) setData(d); }).catch(() => { /* the fallback stays */ });
    return () => { alive = false; };
  }, [guest]);

  return (
    <section className="px-bestiary" aria-labelledby="px-bestiary-title">
      <h3 id="px-bestiary-title" className="px-section-title pixel-font">Bestiary</h3>
      <p className="arena__sub">
        Your topic calls a legend. Beat two of a tier to open the next; each creature has a bane to find.{" "}
        <Link href={ROUTES.heroTab("bestiary")} className="underline">Open the book</Link>
      </p>
      {data.tiers.map((t, i) => (
        <div key={t.tier} className="px-tier" data-open={t.open || undefined}>
          <TierHead t={t} next={data.tiers[i + 1]} />
          <ul className="px-bestiary__grid">
            {data.creatures.filter((c) => c.tier === t.tier).map((c) => <Card key={c.species} c={c} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}
