"use client";

import { useEffect, useState } from "react";
import { Coins, Sparkles } from "@/components/icons";
import PixelConfetti from "@/components/fx/PixelConfetti";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { lookFor } from "@/components/champion/useChampionLook";
import { Badge, Button, ButtonLink, Modal } from "@/components/ui";
import { useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { ROUTES } from "@/lib/routes";
import { sfx } from "@/lib/sound/chip";
import ThemeScope from "@/components/ThemeScope";
import { useCeremonyQueue } from "./ceremonyQueue";

const KEY = (uid: string) => `cmai_level_seen:${uid}`;
/** The coins a level-up pays (server rewards.json level_up_bonus_coins_per_level). */
export const LEVEL_BONUS_PER_LEVEL = 50;

function seen(uid: string): number | null {
  try { const v = localStorage.getItem(KEY(uid)); return v ? Number(v) : null; } catch { return null; }
}
function remember(uid: string, level: number) { try { localStorage.setItem(KEY(uid), String(level)); } catch { /* private mode */ } }

/**
 * The level-up screen (Stage R3): whenever the server's level goes up (a quiz, a fight, a quest, anywhere), the
 * champion celebrates the new level, with the bonus it paid and what it unlocked in the shop. The level last
 * celebrated is kept in this browser, so it shows once (and not on the first visit).
 */
export default function LevelUpCeremony() {
  const uid = useHUDStore((s) => s.userId);
  const guest = useHUDStore((s) => s.guestMode);
  const level = useHUDStore((s) => s.level);
  const refreshed = useHUDStore((s) => s._lastRefresh);
  const shop = useHeroStore((s) => s.shop);
  const championId = useChampion((s) => s.championId);
  const [up, setUp] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    if (guest || uid === "guest" || !refreshed) return;
    const last = seen(uid);
    if (last === null) { remember(uid, level); return; }
    if (level > last) { setUp({ from: last, to: level }); sfx("levelup"); }
    if (level !== last) remember(uid, level);
  }, [uid, guest, level, refreshed]);

  // the upgrade window waits while this one is open
  const setOpen = useCeremonyQueue((s) => s.setLevelUpOpen);
  useEffect(() => { setOpen(!!up); return () => setOpen(false); }, [up, setOpen]);

  if (!up) return null;
  const hero = lookFor(championId, shop).hero;
  const unlocked = (shop?.items ?? []).filter((i) => i.price > 0 && i.level_required > up.from && i.level_required <= up.to && !i.mastery);
  const bonus = Array.from({ length: up.to - up.from }, (_, k) => (up.from + k + 1) * LEVEL_BONUS_PER_LEVEL).reduce((a, b) => a + b, 0);

  // the Play look wherever it shows up (the modal takes the theme of the scope it is called from)
  return (
    <ThemeScope theme="play">
    <Modal open onClose={() => setUp(null)} title={<span className="pixel-font">Level up!</span>}
      actions={
        <>
          {unlocked.length > 0 && <ButtonLink href={ROUTES.heroShop} onClick={() => setUp(null)}>See the shop</ButtonLink>}
          <Button variant="primary" onClick={() => setUp(null)}>Onward</Button>
        </>
      }>
      <div className="fx-level" data-testid="level-up">
        <PixelConfetti burst={up.to % 10 === 0 ? "legendary" : up.to % 5 === 0 ? "epic" : "rare"} className="fx-level__confetti" />
        <div className="fx-level__stage" style={{ "--hero-accent": hero.accent } as React.CSSProperties}>
          <PixelSprite hero={hero} anim="win" label={`${hero.name} celebrates`} className="fx-level__sprite" />
        </div>
        <p className="fx-level__num pixel-font" aria-label={`Level ${up.to}`}>
          <span className="fx-level__from">{up.from}</span><span aria-hidden="true"> ▶ </span><span className="fx-level__to">{up.to}</span>
        </p>
        <p className="fx-level__reward">
          <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{bonus} coins</Badge>
          {unlocked.length > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />{unlocked.length} new in the shop</Badge>}
        </p>
        {unlocked.length > 0 && (
          <p className="m-0 text-sm text-fg-2 text-center">Now unlocked: {unlocked.slice(0, 4).map((i) => i.name).join(", ")}{unlocked.length > 4 ? "…" : ""}</p>
        )}
      </div>
    </Modal>
    </ThemeScope>
  );
}
