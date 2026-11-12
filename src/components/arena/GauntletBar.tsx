"use client";

import { Coins, Crown, Flag, Gauge, Heart, HeartPulse, Package, Sparkles, Trophy } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import type { Gauntlet, GauntletChest, GauntletStep } from "@/lib/arena/types";

/** Where a Boss Rush / Survival stands (Stage 6): which boss, hearts carried, score, the next chest. */
export function GauntletBar({ gauntlet, onAbandon }: { gauntlet: Gauntlet; onAbandon?: () => void }) {
  const rush = gauntlet.kind === "rush";
  const boss = Math.min(gauntlet.stage + 1, gauntlet.bosses_total ?? Infinity);
  return (
    <section className="run-bar gauntlet-bar" aria-label={rush ? "Boss Rush status" : "Survival status"}>
      <div className="run-bar__act">
        <span className="arena-stat__label">{rush ? "Boss Rush" : "Survival"} · {gauntlet.topic}</span>
        <h2 className="run-bar__title">{rush ? `Boss ${boss} of ${gauntlet.bosses_total}` : `Boss ${boss}`}</h2>
      </div>
      <div className="run-bar__stats">
        <span className="run-stat"><Heart size={15} aria-hidden="true" /><span className="pixel-font" aria-hidden="true">{gauntlet.hearts}/{gauntlet.max_hearts}</span><span className="sr-only">{`${gauntlet.hearts} of ${gauntlet.max_hearts} hearts carried`}</span></span>
        <span className="run-stat"><Trophy size={15} aria-hidden="true" /><span className="pixel-font" aria-hidden="true">{gauntlet.score}</span><span className="sr-only">{`Score ${gauntlet.score}`}</span></span>
        <span className="run-stat"><Gauge size={15} aria-hidden="true" /><span className="pixel-font" aria-hidden="true">{gauntlet.power}</span><span className="sr-only">{`Power level ${gauntlet.power}`}</span></span>
        {!rush && gauntlet.next_chest_at && <span className="run-stat"><Package size={15} aria-hidden="true" /><span className="text-xs">Chest at boss {gauntlet.next_chest_at}</span></span>}
      </div>
      {onAbandon && <div className="run-bar__actions"><Button size="sm" variant="ghost" onClick={onAbandon}><Flag size={14} aria-hidden="true" />Give up</Button></div>}
    </section>
  );
}

/** A chest opening: what was in it. */
export function ChestReveal({ chest }: { chest: GauntletChest }) {
  return (
    <section className="gauntlet-chest" data-size={chest.size} aria-labelledby="gauntlet-chest-title">
      <span className="gauntlet-chest__icon" aria-hidden="true">{chest.size === "big" ? <Crown size={30} /> : <Package size={28} />}</span>
      <h3 id="gauntlet-chest-title" className="gauntlet-chest__title pixel-font">{chest.size === "big" ? "The big chest!" : `Chest! Boss ${chest.at}`}</h3>
      <ul className="gauntlet-chest__loot">
        <li><Coins size={14} aria-hidden="true" />{chest.coins} coins</li>
        <li><Sparkles size={14} aria-hidden="true" />{chest.xp} XP</li>
        {chest.items.map((i) => <li key={i.id + i.kind}><HeartPulse size={14} aria-hidden="true" />{i.name}{i.kind === "skin" ? " (new look)" : ""}</li>)}
      </ul>
    </section>
  );
}

/** What a fight did to its run, on the result screen: a chest, how far it went, what comes next or how it ended. */
export function GauntletOutcome({ step }: { step: GauntletStep }) {
  const rush = step.kind === "rush";
  const line = step.over
    ? step.status === "won" ? "Boss Rush cleared! All three fell."
      : rush ? `The Boss Rush ends at boss ${step.stage + 1}.` : `Survival over: you beat ${step.stage} ${step.stage === 1 ? "boss" : "bosses"}.`
    : rush ? `Boss ${step.stage} of 3 down. Next: ${step.next?.name ?? "the next boss"} (power ${step.next?.power}).`
    : `Boss ${step.stage} down. The next one comes at power ${step.next?.power}${step.next_chest_at ? `; chest at boss ${step.next_chest_at}` : ""}.`;
  return (
    <div className="gauntlet-outcome">
      <p className="gauntlet-outcome__line pixel-font">{line}</p>
      {step.over && step.result && <p className="m-0 text-sm text-fg-2">Run score {step.result.score} · {step.result.accuracy}% right · {step.result.chests} {step.result.chests === 1 ? "chest" : "chests"}</p>}
      {step.chest && <ChestReveal chest={step.chest} />}
    </div>
  );
}
