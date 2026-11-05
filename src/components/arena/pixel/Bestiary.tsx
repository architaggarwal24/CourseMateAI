"use client";

import { BOSSES } from "@/lib/pixel/bosses";
import PixelSprite from "./PixelSprite";

const LORE: Record<string, string> = {
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

/** Every creature a document can summon, which subjects call it, and where it fights. */
export function Bestiary() {
  return (
    <section className="px-bestiary" aria-labelledby="px-bestiary-title">
      <h3 id="px-bestiary-title" className="px-section-title pixel-font">Bestiary</h3>
      <p className="arena__sub">Your topic decides which legend answers the summon.</p>
      <ul className="px-bestiary__grid">
        {Object.values(BOSSES).map((b) => (
          <li key={b.id} className="px-beast" style={{ "--beast-accent": b.accent } as React.CSSProperties} data-stage={b.stage}>
            <span className="px-beast__stage" aria-hidden="true"><PixelSprite boss={b.id} flip className="px-beast__sprite" /></span>
            <span className="px-beast__name pixel-font">{b.name}</span>
            <span className="px-beast__origin">{b.origin} myth</span>
            <span className="px-beast__lore">{LORE[b.id]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
