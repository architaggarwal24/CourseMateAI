"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Swords } from "@/components/ui/icons";
import { ButtonLink, Card, toast } from "@/components/ui";
import ActiveBuffsSidebar from "@/components/play/ActiveBuffsSidebar";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { heroById } from "@/lib/pixel/heroes";
import { BOSSES } from "@/lib/pixel/bosses";
import { claimScroll, dailyScroll, fetchBoard, type Board, type Scroll } from "@/lib/quests/board";
import { ROUTES } from "@/lib/routes";
import QuestScroll from "./QuestScroll";
import DailyChest from "./DailyChest";
import { announceAchievements, coinRain, type Achievement } from "@/lib/fx/celebrate";
import "./quests.css";

function Section({ id, title, note, children, empty }: { id: string; title: string; note?: React.ReactNode; children: React.ReactNode[]; empty: string }) {
  return (
    <section className="qboard__section" aria-labelledby={`qboard-${id}`}>
      <h3 id={`qboard-${id}`} className="qboard__title pixel-font">{title}</h3>
      {note && <p className="qboard__note">{note}</p>}
      {children.length ? <ul className="qboard__list">{children}</ul> : <p className="qboard__empty">{empty}</p>}
    </section>
  );
}

/**
 * The quest board (Stage Q1): every quest is a sealed scroll. Today's quests, this week's trials, Bestiary hunts (each
 * finds a creature's lost page) and the story of the champion you fight as. Level, XP, coins and streak are in the header.
 */
export default function QuestsTab() {
  const quests = useHUDStore((s) => s.quests);
  const guest = useHUDStore((s) => s.guestMode);
  const refreshHud = useHUDStore((s) => s.refresh);
  const claimDaily = useHeroStore((s) => s.claim);
  const pending = useHeroStore((s) => s.pending);
  const [board, setBoard] = useState<Board | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (guest) return;
    fetchBoard().then(setBoard).catch(() => { /* the daily quests still show */ });
  }, [guest]);
  useEffect(() => { load(); }, [load]);
  // what was done elsewhere shows up without a reload
  useEffect(() => {
    if (guest) return;
    const t = setInterval(() => { void refreshHud(); load(); }, 30_000);
    return () => clearInterval(t);
  }, [guest, refreshHud, load]);

  const claim = async (s: Scroll) => {
    if (s.kind === "daily") { await claimDaily(s.id.slice("daily:".length)); return; }
    setBusy(s.id);
    try {
      const r = await claimScroll(s.id);
      const page = r.lost_page ? BOSSES[r.lost_page]?.name ?? r.lost_page : null;
      toast.success(
        <span>
          Seal broken: +{r.reward.xp} XP, +{r.reward.coins} coins.
          {page && <> A lost page of the {page} is in your <Link href={ROUTES.heroTab("bestiary")} className="underline">Bestiary</Link>.</>}
        </span>,
      );
      useHUDStore.setState({ coins: r.totals.coins });
      coinRain(r.reward.coins);
      announceAchievements((r as { new_achievements?: Achievement[] }).new_achievements);
      void refreshHud();
      load();
    } catch (e) {
      toast.apiError(e, { onRetry: () => { void claim(s); } });
    } finally { setBusy(null); }
  };

  const daily = (quests ?? []).map(dailyScroll);
  const story = board?.story;
  const champ = story ? heroById(story.champion) : null;

  return (
    <div className="qboard max-w-5xl mx-auto p-4 md:p-6">
      <div className="qboard__main">
        {!guest && <DailyChest />}
        <Section id="daily" title="Today's quests" empty={guest ? "Sign in to get daily quests." : "No quests today."}>
          {daily.map((s) => <QuestScroll key={s.id} scroll={s} onClaim={claim} busy={!!pending[`quest:${s.id.slice(6)}`]} />)}
        </Section>
        {!guest && (
          <>
            <Section id="weekly" title="Weekly trials" note="Three trials, Monday to Sunday." empty="The trials are being posted…">
              {(board?.weekly ?? []).map((s) => <QuestScroll key={s.id} scroll={s} onClaim={claim} busy={busy === s.id} />)}
            </Section>
            <Section id="hunts" title="Hunts" note="Hunt a creature from the Bestiary. Each hunt finds one of its lost pages." empty="No hunts posted. Open a new Bestiary tier to find more prey.">
              {(board?.hunts ?? []).map((s) => <QuestScroll key={s.id} scroll={s} onClaim={claim} busy={busy === s.id} creature={s.lost_page ? BOSSES[s.lost_page]?.name : undefined} />)}
            </Section>
            {story && champ && (
              <Section id="story" title={`${champ.name}'s story`} note={`Chapter ${Math.min(story.chapters_done + 1, story.chapters)} of ${story.chapters}. Each champion's story moves on while you fight as them.`}
                empty={story.chapters_done >= story.chapters ? `${champ.name}'s story is told. Pick another champion to read theirs.` : "The next chapter is being written…"}>
                {story.scroll ? [<QuestScroll key={story.scroll.id} scroll={story.scroll} onClaim={claim} busy={busy === story.scroll.id} />] : []}
              </Section>
            )}
          </>
        )}
      </div>

      <div className="qboard__side">
        {/* Draws nothing while no timed buff is running. */}
        <ActiveBuffsSidebar />
        <Card title="Arena">
          <p className="text-sm text-fg-2">Summon a creature on any topic and battle it with what you have learned.</p>
          <ButtonLink href={ROUTES.heroArena} variant="primary" className="self-start">
            <Swords size={16} aria-hidden="true" />Enter the arena
          </ButtonLink>
        </Card>
      </div>
    </div>
  );
}
