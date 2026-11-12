"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Crown, Gauge, HeartPulse, Lock, Package } from "@/components/ui/icons";
import FileUploader from "@/components/pdf/FileUploader";
import { Badge, Button, Input } from "@/components/ui";
import { fetchPower } from "@/lib/arena/api";
import type { GauntletKind, PowerOverview } from "@/lib/arena/types";
import ForgingWait from "./ForgingWait";
import PixelSprite from "./pixel/PixelSprite";

/** Survival's numbers, as the server plays them (gauntlet.ts). */
const SURVIVAL_START = 0.7, CHEST_EVERY = 5;

/**
 * Start a Boss Rush or a Survival (Stage 6): your power level, what the run holds (Boss Rush: your three strongest
 * hunted creatures; Survival: bosses without end that climb from 70% of your power, a chest every 5), and a topic
 * from your document for every fight's questions.
 */
export default function GauntletPanel({ kind, sessionId, starting, onStart, onBack }: {
  kind: GauntletKind; sessionId: string; starting: boolean; onStart: (topic: string) => void; onBack: () => void;
}) {
  const [info, setInfo] = useState<PowerOverview | null>(null);
  const [topic, setTopic] = useState("");
  useEffect(() => {
    let alive = true;
    fetchPower(sessionId).then((r) => { if (alive) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);
  const rush = kind === "rush";
  const locked = rush && info !== null && !info.rush.unlocked;
  const can = !!topic.trim() && !starting && !locked && info !== null;
  const power = info?.power.power ?? null;
  const best = rush ? info?.rush.best : info?.survival.best;

  return (
    <section className="arena-gauntlet" aria-labelledby="arena-gauntlet-title">
      <div className="arena-summon__head">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1"><ArrowLeft size={14} aria-hidden="true" />Arena</Button>
          <h2 id="arena-gauntlet-title" className="arena__title">{rush ? "Boss Rush" : "Survival"}</h2>
          <p className="arena__sub">{rush
            ? "Your three strongest hunted creatures, one after another, each stronger than the last. Your hearts carry over. Beat all three for the big chest."
            : "Boss after boss, matched to your power and climbing. Your hearts carry over; a chest every 5 bosses. How far can you go?"}</p>
        </div>
        <FileUploader sessionId={sessionId} />
      </div>

      <div className="arena-gauntlet__power">
        <Gauge size={18} aria-hidden="true" />
        <span>Power level</span>
        <span className="arena-gauntlet__power-num pixel-font">{power ?? "…"}</span>
        {info && <span className="text-xs text-fg-2">({info.power.from_score} from your best scores, {info.power.from_hunts} from {info.power.hunted.length} creatures hunted)</span>}
        {best && <Badge tone="reward">Best: {rush ? `${best.stage}/3` : `${best.stage} bosses`}</Badge>}
      </div>

      {rush ? (
        locked ? (
          <p className="arena-gauntlet__locked"><Lock size={14} aria-hidden="true" />Hunt {info!.rush.need} different creatures to open Boss Rush ({info!.rush.hunted}/{info!.rush.need}). The Bestiary shows who is out there.</p>
        ) : (
          <ol className="arena-gauntlet__lineup" aria-label="The three bosses">
            {[...(info?.rush.bosses ?? [])].reverse().map((b, i) => (
              <li key={b.species} className="arena-gauntlet__boss">
                <PixelSprite boss={b.species} portrait flip className="arena-gauntlet__face" />
                <span className="pixel-font">{i + 1}. {b.name}</span>
              </li>
            ))}
            <li className="arena-gauntlet__boss arena-gauntlet__boss--chest"><Crown size={22} aria-hidden="true" /><span className="pixel-font">Big chest</span></li>
          </ol>
        )
      ) : (
        <ul className="arena-gauntlet__facts">
          <li><HeartPulse size={14} aria-hidden="true" />The first boss at power {power === null ? "…" : Math.round(power * SURVIVAL_START)}; each next one 12% stronger.</li>
          <li><Package size={14} aria-hidden="true" />A chest every {CHEST_EVERY} bosses, and every boss pays like a fight.</li>
        </ul>
      )}

      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (can) onStart(topic.trim()); }}>
        <Input label="Topic for every fight" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Photosynthesis, World War II" maxLength={200} autoComplete="off" />
        <Button type="submit" variant="primary" block loading={starting} disabled={!can}>
          {rush ? <Crown size={16} aria-hidden="true" /> : <HeartPulse size={16} aria-hidden="true" />}{rush ? "Start the Boss Rush" : "Start Survival"}
        </Button>
        {starting && <ForgingWait />}
      </form>
    </section>
  );
}
