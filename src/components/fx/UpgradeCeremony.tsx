"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Crown, Sparkles } from "@/components/icons";
import PixelConfetti from "@/components/fx/PixelConfetti";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { lookFor, useMyHeroLook } from "@/components/champion/useChampionLook";
import ThemeScope from "@/components/ThemeScope";
import { Badge, Button, ButtonLink, Modal } from "@/components/ui";
import { useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { useRevalidate } from "@/hooks/useRevalidate";
import { markPlanNoticeSeen } from "@/lib/api";
import { PLAN_CHANGED_EVENT, TIER_RARITY, noticeTexts, type PlanNotice } from "@/lib/planNotice";
import { areaOf } from "@/lib/routes";
import { sfx } from "@/lib/sound/chip";
import { useCeremonyQueue } from "./ceremonyQueue";

/** Notices already opened in this tab: a HUD answer that was in flight when one was marked seen can't reopen it. */
const opened = new Set<number>();

/**
 * "Congratulations, you've been upgraded" (an admin gave a plan, an invite code worked, or a payment went through).
 * The server keeps the notice until it has been shown once, on any device; it arrives with GET /hud, which the app
 * asks at start-up, after study and game actions, and when the user comes back to the tab. In the Hero area it's a
 * pixel celebration; everywhere else a calm card. It waits for the level-up screen if that's open.
 */
export default function UpgradeCeremony() {
  const notice = useHUDStore((s) => s.planNotice);
  const guest = useHUDStore((s) => s.guestMode);
  const levelUp = useCeremonyQueue((s) => s.levelUpOpen);
  const play = areaOf(usePathname()) === "hero";
  const [shown, setShown] = useState<PlanNotice | null>(null);

  // Coming back to the tab after a while: ask again, so a plan given meanwhile shows without a reload.
  useRevalidate(() => { void useHUDStore.getState().refreshIfStale(60_000); }, !guest);

  useEffect(() => {
    if (!notice || shown || levelUp || opened.has(notice.id)) return;
    opened.add(notice.id);
    setShown(notice);
    useHUDStore.setState({ planNotice: null });
    void markPlanNoticeSeen(notice.id);                                   // once, everywhere: marked as it opens
    window.dispatchEvent(new CustomEvent(PLAN_CHANGED_EVENT, { detail: { tier: notice.tier } }));
    if (play) sfx("levelup");
  }, [notice, shown, levelUp, play]);

  if (!shown) return null;
  return <UpgradeWindow notice={shown} variant={play ? "play" : "study"} onClose={() => setShown(null)} />;
}

/** The window itself (also the admin page's preview: then its button goes nowhere and it says it's a preview). */
export function UpgradeWindow({ notice, variant, onClose, preview = false }: {
  notice: PlanNotice; variant: "play" | "study"; onClose: () => void; preview?: boolean;
}) {
  const t = noticeTexts(notice);
  const rarity = TIER_RARITY[notice.tier];
  const actions = (
    <>
      <Button variant="ghost" onClick={onClose}>{variant === "play" ? "Onward" : "Done"}</Button>
      {preview
        ? <Button variant="primary" onClick={onClose}>{t.cta.label}</Button>
        : <ButtonLink href={t.cta.href} onClick={onClose} variant="primary">{t.cta.label}</ButtonLink>}
    </>
  );
  const previewTag = preview && <p className="fx-up__preview">Preview: this is what they&apos;ll see. Nothing is saved.</p>;
  const note = notice.note && (
    <blockquote className="fx-up__note">
      <p>{notice.note}</p>
      {notice.from_name && <footer>{notice.from_name}</footer>}
    </blockquote>
  );
  const list = (
    <ul className="fx-up__list" aria-label={notice.kind === "upgrade" ? "What's new for you" : "Your plan"}>
      {t.lines.map((l) => <li key={l}><Check size={16} aria-hidden="true" />{l}</li>)}
    </ul>
  );

  if (variant === "play") return <PlayWindow notice={notice} t={t} rarity={rarity} actions={actions} note={note} list={list} tag={previewTag} onClose={onClose} />;

  return (
    <ThemeScope theme="study">
      <Modal open onClose={onClose} title={t.title} actions={actions} className="fx-up fx-up--study">
        <div className="fx-up__body" data-testid="upgrade-window" data-variant="study">
          {previewTag}
          <div className="fx-up__crest" data-tier={notice.tier} aria-hidden="true">
            <Crown size={30} />
            <span className="fx-up__spark fx-up__spark--a" /><span className="fx-up__spark fx-up__spark--b" /><span className="fx-up__spark fx-up__spark--c" />
          </div>
          <p className="fx-up__from">{t.from}</p>
          <p className="fx-up__plan">
            <Badge tone={rarity}><Sparkles size={12} aria-hidden="true" />{notice.tier_name}</Badge>
            <span className="fx-up__until">{t.until}</span>
          </p>
          {note}
          {list}
        </div>
      </Modal>
    </ThemeScope>
  );
}

function PlayWindow({ notice, t, rarity, actions, note, list, tag, onClose }: {
  notice: PlanNotice; t: ReturnType<typeof noticeTexts>; rarity: (typeof TIER_RARITY)[PlanNotice["tier"]]; actions: React.ReactNode;
  note: React.ReactNode; list: React.ReactNode; tag: React.ReactNode; onClose: () => void;
}) {
  const shop = useHeroStore((s) => s.shop);
  const championId = useChampion((s) => s.championId);
  const mine = useMyHeroLook();
  const hero = lookFor(championId, shop, null, mine).hero;
  return (
    <ThemeScope theme="play">
      <Modal open onClose={onClose} title={<span className="pixel-font">{t.shout}</span>} actions={actions} className="fx-up fx-up--play">
        <div className="fx-up__body fx-level" data-testid="upgrade-window" data-variant="play">
          <PixelConfetti burst={rarity} className="fx-level__confetti" />
          {tag}
          <div className="fx-level__stage" style={{ "--hero-accent": hero.accent } as React.CSSProperties}>
            <PixelSprite hero={hero} anim="win" label={`${hero.name} celebrates`} className="fx-level__sprite" />
          </div>
          <p className="fx-up__title pixel-font">{t.title}</p>
          <p className="fx-up__from">{t.from}</p>
          <p className="fx-up__plan">
            <Badge tone={rarity}><Crown size={12} aria-hidden="true" />{notice.tier_name}</Badge>
            <span className="fx-up__until">{t.until}</span>
          </p>
          {note}
          {list}
        </div>
      </Modal>
    </ThemeScope>
  );
}
