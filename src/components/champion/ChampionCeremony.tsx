"use client";

import { useState } from "react";
import { Coins, Sparkles } from "@/components/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { Badge, Button, Modal, toast } from "@/components/ui";
import { lookFor } from "@/components/champion/useChampionLook";
import { ceremonyDue, useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import "./ceremony.css";

const ROMAN = ["", "I", "II", "III", "IV"];

/** Why the champion joined, in one line. */
export function joinedBecause(source: string | null): string {
  const tier = source?.match(/^tier([1-4])$/)?.[1];
  if (tier) return `You finished Bestiary tier ${ROMAN[Number(tier)]}.`;
  if (source === "level") return "You reached level 25.";
  return "They answered your call.";
}

/**
 * The unlock ceremony (Stage C1): a champion who just joined steps out of the light, with their kit and the reward.
 * It shows once per champion, wherever the Hero area is open; closing it (or "Fight as ...") claims the reward.
 */
export default function ChampionCeremony() {
  const progress = useChampion((s) => s.progress);
  const celebrate = useChampion((s) => s.celebrate);
  const choose = useChampion((s) => s.choose);
  const shop = useHeroStore((s) => s.shop);
  const refreshHud = useHUDStore((s) => s.refresh);
  const due = ceremonyDue(progress);
  const [busy, setBusy] = useState(false);
  if (!due) return null;
  const hero = lookFor(due, shop).hero;
  const p = progress[due];
  const lock = p.unlock!;

  const finish = async (fight: boolean) => {
    if (busy) return;
    setBusy(true);
    const reward = await celebrate(due);
    if (fight) await choose(due);
    if (reward && (reward.xp > 0 || reward.coins > 0)) {
      toast.success(`${hero.name} joined you: +${reward.xp} XP, +${reward.coins} coins`);
      void refreshHud();
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      onClose={() => { void finish(false); }}
      title={<span className="pixel-font">{hero.name} joins you</span>}
      className="champ-ceremony"
      actions={
        <>
          <Button onClick={() => { void finish(false); }} disabled={busy}>Claim reward</Button>
          <Button variant="primary" onClick={() => { void finish(true); }} disabled={busy}>Fight as {hero.name}</Button>
        </>
      }
    >
      <div className="champ-ceremony__stage" style={{ "--hero-accent": hero.accent } as React.CSSProperties} data-testid="champion-ceremony">
        <svg className="champ-ceremony__rays" viewBox="-100 -100 200 200" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => <path key={i} d="M0 0 L-9 -100 L9 -100 Z" transform={`rotate(${i * 30})`} />)}
        </svg>
        <PixelSprite hero={hero} anim="win" label={`${hero.name}, ${hero.title}`} className="champ-ceremony__sprite" />
      </div>
      <p className="champ-ceremony__title">{hero.title}</p>
      <p className="m-0 text-sm text-fg-2 text-center">{joinedBecause(lock.source)}</p>
      <dl className="champ-ceremony__kit">
        <div><dt>Passive · {p.kit.passive.name}</dt><dd>{p.kit.passive.text}</dd></div>
        <div><dt>Ultimate · {p.kit.ultimate.name}</dt><dd>{p.kit.ultimate.text}</dd></div>
      </dl>
      {(lock.reward.xp > 0 || lock.reward.coins > 0) && (
        <p className="champ-ceremony__reward" aria-label={`Reward: ${lock.reward.xp} XP and ${lock.reward.coins} coins`}>
          {lock.reward.xp > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{lock.reward.xp} XP</Badge>}
          {lock.reward.coins > 0 && <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{lock.reward.coins} coins</Badge>}
        </p>
      )}
    </Modal>
  );
}
