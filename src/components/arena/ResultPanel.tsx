"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Coins, Crown, Sparkles, Trophy } from "@/components/ui/icons";
import ItemArt from "@/components/champion/ItemArt";
import ChampionCeremony from "@/components/champion/ChampionCeremony";
import { ceremonyDue, useChampion } from "@/hooks/useChampion";
import { useForge } from "@/hooks/useForge";
import { useHeroStore } from "@/hooks/useHero";
import { heroById, fighterLabel } from "@/lib/pixel/heroes";
import { ROUTES } from "@/lib/routes";
import { Badge, Button } from "@/components/ui";
import PixelSprite from "./pixel/PixelSprite";
import EmoteWheel from "./EmoteWheel";
import { GauntletOutcome } from "./GauntletBar";
import { announceAchievements } from "@/lib/fx/celebrate";
import { sfx } from "@/lib/sound/chip";
import { useFighter, useFighterPet } from "./pixel/useFighter";
import { fetchLeaderboard } from "@/lib/arena/api";
import type { Battle, BattleResult, BattleRewards, LeaderboardEntry } from "@/lib/arena/types";
import { DIFFICULTY_LABEL } from "@/lib/arena/types";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

function totals(rewards: BattleRewards | null) {
  let xp = 0, coins = 0;
  for (const award of rewards ? [rewards.arena_round_complete, rewards.boss_defeat] : []) {
    xp += Number(award?.xp_gained ?? 0);
    coins += Number(award?.coins_gained ?? 0);
  }
  return { xp, coins };
}

/** How the battle ended - win, loss or retreat - with the server's grade, accuracy and time and what it paid. */
export default function ResultPanel({ battle, rewards, retreated, bossName, onAgain, againLabel }: {
  battle: Battle;
  rewards: BattleRewards | null;
  retreated: boolean;
  bossName: string;
  onAgain: () => void;
  againLabel?: string;
}) {
  const won = battle.status === "won";
  const fighter = useFighter();
  const pet = useFighterPet();
  const result = battle.result ?? {};
  const { xp, coins } = totals(rewards);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  // achievements this fight unlocked get their banner (Stage R3)
  useEffect(() => { sfx(won ? "win" : "lose"); announceAchievements(result.new_achievements); }, [battle.battle_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!won) return;
    const controller = new AbortController();
    fetchLeaderboard(battle.topic, battle.difficulty, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setEntries(r.entries ?? []); })
      .catch(() => { /* the board is a bonus */ });
    return () => controller.abort();
  }, [won, battle.topic, battle.difficulty]);

  const headline = won ? "Victory!" : retreated ? "Retreated" : "Defeated";
  const line = won
    ? `You defeated ${bossName}.`
    : retreated ? `You retreated from ${bossName}.` : `${bossName} was too strong this time.`;
  const accuracy = result.accuracy ?? (battle.answered ? Math.round((battle.correct / battle.answered) * 100) : 0);

  return (
    <section className="arena-result" data-outcome={won ? "won" : "lost"} aria-labelledby="arena-result-title">
      {won ? <EmoteWheel hero={fighter} pet={pet} /> : (
        <div className="arena-result__figure"><PixelSprite hero={fighter} pet={pet} anim="hit" label={`${fighter.name}, beaten`} className="arena-result__sprite" /></div>
      )}
      <h2 id="arena-result-title" ref={heading} tabIndex={-1} className="arena-result__headline pixel-font">{headline}</h2>
      <p className="arena__text">{line} <span className="text-muted">({battle.topic}, {DIFFICULTY_LABEL[battle.difficulty]})</span></p>
      {result.gauntlet && <GauntletOutcome step={result.gauntlet} />}
      {won && result.grade && !result.score && <span className="arena-result__grade pixel-font" role="img" aria-label={`Grade ${result.grade}`}>{result.grade}</span>}
      {result.new_personal_best && <Badge tone="reward"><Trophy size={12} aria-hidden="true" />New best</Badge>}

      {result.score && <ScoreCardView card={result.score} />}

      <dl className="arena-result__stats">
        <div><dt>Accuracy</dt><dd className="pixel-font">{accuracy}%</dd></div>
        <div><dt>Correct</dt><dd className="pixel-font">{battle.correct}/{battle.answered}</dd></div>
        <div><dt>Best combo</dt><dd className="pixel-font">x{battle.max_combo}</dd></div>
        {typeof result.time_seconds === "number" && <div><dt>Time</dt><dd className="pixel-font">{mmss(result.time_seconds)}</dd></div>}
      </dl>

      {(xp > 0 || coins > 0) && (
        <p className="arena-result__rewards" aria-label="Rewards">
          {xp > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{xp} XP</Badge>}
          {coins > 0 && <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{coins} coins</Badge>}
        </p>
      )}

      {result.taunt_bonus && (
        <p className="arena-result__rewards" aria-label="Taunt bonus">
          <Badge tone="danger">Taunt bonus</Badge>
          {result.taunt_bonus.xp > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{result.taunt_bonus.xp} XP</Badge>}
          {result.taunt_bonus.coins > 0 && <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{result.taunt_bonus.coins} coins</Badge>}
        </p>
      )}
      {/* the two worlds: the weekly invasion repelled (Stage 5), a season's boss beaten (Stage 7) */}
      {result.invasion && (
        <p className="arena-result__rewards">
          <Badge tone="danger">Invasion repelled</Badge>
          <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{result.invasion.xp} XP</Badge>
          <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{result.invasion.coins} coins</Badge>
        </p>
      )}
      {result.season && (
        <p className="arena-result__rewards">
          <Badge tone="reward">{result.season.name}</Badge>
          <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{result.season.xp} XP</Badge>
          <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{result.season.coins} coins</Badge>
        </p>
      )}
      <ChampionXpLine battle={battle} />
      <BestiaryLine battle={battle} />
      <JoinedLine battle={battle} />

      {entries.length > 0 && (
        <ol className="arena-board w-full text-left">
          {entries.slice(0, 5).map((e) => (
            <li key={`${e.rank}-${e.username}`} className="arena-board__row" data-me={e.is_me ? "true" : undefined}>
              <span>{e.rank}.</span><span className="arena-board__name">{e.username}</span>
              <span className="arena-board__grade pixel-font">{e.grade}</span><span>{e.accuracy}%</span><span>{mmss(e.time)}</span>
            </li>
          ))}
        </ol>
      )}

      {(result.missed?.length ?? 0) > 0 && (
        <section className="arena-loot" aria-labelledby="arena-loot-title">
          <h3 id="arena-loot-title" className="arena-loot__title"><BookOpen size={16} aria-hidden="true" />Study scrolls · {result.missed!.length} to review</h3>
          <ul className="arena-loot__list">
            {result.missed!.slice(0, 4).map((m, i) => (
              <li key={i} className="arena-loot__item">
                <span className="arena-loot__concept">{m.concept}</span>
                <span className="arena-loot__q">{m.question}</span>
                <span className="arena-loot__a">Answer: {m.correct_answer}</span>
              </li>
            ))}
          </ul>
          <Link href={`${ROUTES.studyTab("flashcards")}&review=1`} className="ui-btn ui-btn--secondary ui-btn--sm">
            <BookOpen size={14} aria-hidden="true" />Review them as flashcards
          </Link>
        </section>
      )}

      <Button variant="primary" onClick={onAgain}>{againLabel ?? "Battle again"}</Button>
    </section>
  );
}

/** What the champion earned: XP toward its next level, a level-up, and the mastery skins it unlocked. */
function ChampionXpLine({ battle }: { battle: Battle }) {
  const champ = battle.result?.champion;
  const shop = useHeroStore((s) => s.shop);
  const done = battle.result?.challenges_done ?? [];
  useEffect(() => {
    if (battle.result?.forge) void useForge.getState().load(true);              // the gear's new XP, the materials
    if (champ?.leveled_up || done.length) {
      void useChampion.getState().load({ signedIn: true, force: true });       // the new level and mastery, on every screen
      void useHeroStore.getState().reconcile();                                 // the unlocked skin, owned
    }
  }, [champ?.leveled_up, done.length]);
  if (!champ) return null;
  const name = fighterLabel(champ.id).name;
  const nextAt = champ.next_level_xp;
  return (
    <section className="arena-result__champion" aria-label={`${name}'s progress`}>
      <p className="arena__text">
        <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{champ.xp_gained} {name} XP</Badge>{" "}
        {champ.leveled_up
          ? <Badge tone="reward"><Crown size={12} aria-hidden="true" />{name} reached Lv {champ.level}!</Badge>
          : <span className="text-muted">{name} Lv {champ.level}{nextAt ? ` · ${champ.xp}/${nextAt} XP` : " · max level"}</span>}
      </p>
      {battle.result?.forge && battle.result.forge.items.length > 0 && (
        <p className="arena__text text-sm" data-testid="result-forge">
          <Badge tone="neutral">Gear +{battle.result.forge.item_xp} XP</Badge>{" "}
          {battle.result.forge.materials.map((m) => <Badge key={m.id} tone={m.rare ? "epic" : "accent"} className="mr-1">{m.name} x{m.count}</Badge>)}
        </p>
      )}
      {done.length > 0 && (
        <ul className="arena-result__challenges" aria-label={`${name}'s mastery challenges done`}>
          {done.map((t) => <li key={t}><Badge tone="reward"><Check size={12} aria-hidden="true" />Challenge done: {t}</Badge></li>)}
        </ul>
      )}
      {champ.unlocked.length > 0 && (
        <ul className="arena-result__unlocks" aria-label="Mastery skins unlocked">
          {champ.unlocked.map((id) => (
            <li key={id} className="arena-result__unlock">
              <ItemArt itemId={id} size={40} />
              <span>New mastery skin: <b>{shop?.items.find((i) => i.id === id)?.name ?? id}</b></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ROMAN = ["", "I", "II", "III", "IV"];
const MASTERY = { none: "", bronze: "Bronze", silver: "Silver", gold: "Gold" } as const;

/** A champion this win brought (a Bestiary tier finished): their ceremony, when the player is ready for it. */
function JoinedLine({ battle }: { battle: Battle }) {
  const joined = battle.result?.champions_unlocked ?? [];
  const load = useChampion((s) => s.load);
  const due = useChampion((s) => ceremonyDue(s.progress));
  const [meet, setMeet] = useState(false);
  // the roster learns about the new champion (the ceremony reads it from there)
  useEffect(() => { if (joined.length) void load({ signedIn: true, force: true }); }, [joined.length, load]);
  if (!joined.length) return null;
  const names = joined.map((id) => heroById(id).name).join(" and ");
  return (
    <section className="arena-result__joined" aria-label="A champion joins you">
      <p className="pixel-font">{names} {joined.length > 1 ? "join" : "joins"} you!</p>
      {due && <Button variant="primary" size="sm" onClick={() => setMeet(true)}>Meet {heroById(due).name}</Button>}
      {meet && due && <ChampionCeremony />}
    </section>
  );
}

/** What the fight wrote in the Bestiary: a first defeat, a mastery step, a newly opened tier. */
function BestiaryLine({ battle }: { battle: Battle }) {
  const b = battle.result?.bestiary;
  if (!b || (!b.first_win && !b.mastery_up && !b.tier_opened)) return null;
  const name = battle.boss.name;
  return (
    <section className="arena-result__bestiary" aria-label="Bestiary">
      {b.first_win && <p>A new page: the {name} is written in your Bestiary, and its bane revealed.</p>}
      {b.mastery_up && b.mastery_up !== "bronze" && <p>{MASTERY[b.mastery_up]} mastery of the {name}.</p>}
      {b.tier_opened && <p className="pixel-font">Tier {ROMAN[b.tier_opened]} awakens: new creatures answer your summons.</p>}
      {(b.rewards.xp > 0 || b.rewards.coins > 0) && (
        <p className="arena-result__rewards">
          {b.rewards.xp > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{b.rewards.xp} XP</Badge>}
          {b.rewards.coins > 0 && <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{b.rewards.coins} coins</Badge>}
        </p>
      )}
    </section>
  );
}

/**
 * The score card (Stage 4): the points from right answers (speed and the combo already in them), the finisher, the
 * hearts left, the best combo, then the total and its rank. Each continue keeps 75% of the score.
 */
function ScoreCardView({ card }: { card: NonNullable<BattleResult["score"]> }) {
  const rows: [string, string][] = [
    ["Answers", String(card.points)],
    ["Speed bonus (in answers)", String(card.speed)],
    ...(card.finisher ? [["Final move", `+${card.finisher}`] as [string, string]] : []),
    ...(card.hearts ? [["Hearts left", `+${card.hearts}`] as [string, string]] : []),
    ["Best combo", `${card.best_combo} (x${card.best_level})`],
    ...(card.specials ? [["Combo specials", String(card.specials)] as [string, string]] : []),
    ...(card.continues ? [["Continues", `${card.continues} (-25% each)`] as [string, string]] : []),
  ];
  return (
    <section className="arena-score-card" aria-label="Score card">
      <span className="arena-score-card__rank pixel-font" role="img" aria-label={`Rank ${card.rank}`}>{card.rank}</span>
      <dl className="arena-score-card__rows">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="pixel-font">{v}</dd></div>)}
        <div className="arena-score-card__total"><dt>Score</dt><dd className="pixel-font">{card.total}</dd></div>
      </dl>
    </section>
  );
}
