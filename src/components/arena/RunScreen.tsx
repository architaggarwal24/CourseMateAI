"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  BedDouble, BookOpen, Coins, Crown, Flag, Gem, Heart, Map as MapIcon, Skull, Sparkles, Store, Swords, Target, Trophy,
} from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/errors";
import { useHeroStore } from "@/hooks/useHero";
import { abandonRun, chooseRun, fetchActiveRun, startRun, travel } from "@/lib/arena/api";
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type NodeKind, type Run, type RunNode } from "@/lib/arena/types";

const KIND: Record<NodeKind, { label: string; Icon: typeof Swords; blurb: string }> = {
  battle: { label: "Battle", Icon: Swords, blurb: "A boss on this act's topic." },
  elite: { label: "Elite", Icon: Skull, blurb: "A tougher boss. Win a relic." },
  nemesis: { label: "Nemesis", Icon: Target, blurb: "A boss made of what you keep missing." },
  rest: { label: "Rest", Icon: BedDouble, blurb: "Heal, or study a weak concept." },
  shop: { label: "Shop", Icon: Store, blurb: "Spend gold on relics and potions." },
  treasure: { label: "Treasure", Icon: Gem, blurb: "A free relic." },
  boss: { label: "Act boss", Icon: Crown, blurb: "Beat it to reach the next act." },
};

/** The run as the server holds it, plus the three things the player can do to it. */
function useExpedition(sessionId: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setRun(await fetchActiveRun(sessionId || undefined)); } catch (e) { toast.apiError(e); }
    setLoaded(true);
  }, [sessionId]);
  useEffect(() => { void reload(); }, [reload]);

  const act = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    try { return await fn(); } catch (e) {
      if (e instanceof ApiError && (e.code === "choice_pending" || e.code === "node_unreachable" || e.code === "battle_in_progress")) void reload();
      toast.apiError(e);
      return null;
    } finally { setBusy(null); }
  }, [reload]);

  return { run, setRun, loaded, busy, reload, act };
}

/**
 * Expedition: a roguelite run through the document. Three acts (chapters); each a branching map of fights, rests,
 * shops and treasure ending in an act boss. Hearts carry over between fights; relics change the rules; one loss ends
 * the run. The server holds the run - this screen shows the map and sends where the player goes and what they pick.
 */
export default function RunScreen({ sessionId, onBattle, onBack }: { sessionId: string; onBattle: (battleId: string) => void; onBack: () => void }) {
  const { run, setRun, loaded, busy, reload, act } = useExpedition(sessionId);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const refreshGame = () => { void useHeroStore.getState().reconcile(); };

  // A fight already running inside this run: straight back into it - once per fight, so an error opening it can't loop.
  const entered = useRef(new Set<string>());
  useEffect(() => {
    const id = run?.status === "active" ? run.battle_id : null;
    if (!id || entered.current.has(id)) return;
    entered.current.add(id);
    onBattle(id);
  }, [run?.battle_id, run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return <p className="arena__status" role="status">Looking for your expedition…</p>;

  if (!run || run.status !== "active") {
    return (
      <div className="arena">
        {run && run.status !== "active" && <RunOver run={run} />}
        <section className="run-start glass" aria-labelledby="run-start-title">
          <div className="run-start__icon" aria-hidden="true"><MapIcon size={28} /></div>
          <h2 id="run-start-title" className="arena__title">{run ? "Another expedition?" : "Expedition"}</h2>
          <p className="arena__sub max-w-[52ch]">
            Three acts from your document, each a branching path of bosses, rests, shops and treasure. Your hearts carry
            over. Relics bend the rules. Fall once and the run ends - the deeper you get, the bigger the reward.
          </p>
          <fieldset className="border-0 p-0 m-0">
            <legend className="sr-only">Difficulty</legend>
            <div className="run-start__diffs">
              {DIFFICULTIES.map((d) => (
                <Button key={d} size="sm" pressed={difficulty === d} onClick={() => setDifficulty(d)}>{DIFFICULTY_LABEL[d]}</Button>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="ghost" onClick={onBack}>Back</Button>
            <Button variant="reward" size="lg" disabled={!sessionId} loading={busy === "start"}
              onClick={async () => { const r = await act("start", () => startRun(sessionId, difficulty)); if (r) setRun(r.run); }}>
              <Sparkles size={16} aria-hidden="true" />{busy === "start" ? "Charting the acts…" : "Begin expedition"}
            </Button>
          </div>
          {!sessionId && <p className="arena__sub">Upload a PDF first: the acts come from your document.</p>}
        </section>
      </div>
    );
  }

  const go = async (node: RunNode) => {
    const r = await act(node.id, () => travel(run.run_id, node.id));
    if (!r) return;
    if (r.battle_id) entered.current.add(r.battle_id);
    setRun(r.run);
    if (r.battle_id) onBattle(r.battle_id);
    else if (r.gained) { toast.success("Treasure found!", { icon: "✨" }); refreshGame(); }
  };
  const choose = async (action: string, target?: string) => {
    const r = await act(`${action}:${target ?? ""}`, () => chooseRun(run.run_id, action, target));
    if (r) { setRun(r.run); if (r.run.status !== "active") refreshGame(); }
  };

  return (
    <div className="arena run">
      <RunStatusBar run={run} onAbandon={() => setConfirmAbandon(true)} onBack={onBack} />
      {run.battle_id && (
        <div className="run-choice glass flex flex-wrap items-center justify-between gap-3">
          <span>A fight is waiting for you on this path.</span>
          <Button variant="primary" onClick={() => onBattle(run.battle_id!)}>Return to the fight</Button>
        </div>
      )}
      <RunMap run={run} busy={busy} onTravel={go} />
      {run.pending && <PendingChoice run={run} busy={busy} onChoose={choose} />}

      <Modal open={confirmAbandon} onClose={() => setConfirmAbandon(false)} role="alertdialog" title="Abandon the expedition?"
        actions={<>
          <Button onClick={() => setConfirmAbandon(false)}>Keep going</Button>
          <Button variant="danger" loading={busy === "abandon"} onClick={async () => {
            const r = await act("abandon", () => abandonRun(run.run_id));
            setConfirmAbandon(false);
            if (r) { setRun(r.run); refreshGame(); void reload(); }
          }}>Abandon</Button>
        </>}>
        The run ends here. You keep the reward for how deep you got.
      </Modal>
    </div>
  );
}

/** Hearts, gold, relics, act and score: the run's state at a glance. */
export function RunStatusBar({ run, onAbandon, onBack }: { run: Run; onAbandon?: () => void; onBack?: () => void }) {
  return (
    <header className="run-bar glass" aria-label="Expedition status">
      <div className="run-bar__act">
        <span className="arena-stat__label">Act {run.act} of {run.acts_total}</span>
        <h2 className="run-bar__title">{run.act_title}</h2>
      </div>
      <div className="run-bar__stats">
        <span className="run-stat" aria-label={`${run.hearts} of ${run.max_hearts} hearts`}><Heart size={15} aria-hidden="true" /><span className="pixel-font">{run.hearts}/{run.max_hearts}</span></span>
        <span className="run-stat run-stat--gold" aria-label={`${run.gold} gold`}><Coins size={15} aria-hidden="true" /><span className="pixel-font">{run.gold}</span></span>
        <span className="run-stat" aria-label={`Score ${run.score}`}><Trophy size={15} aria-hidden="true" /><span className="pixel-font">{run.score}</span></span>
        <Badge>{DIFFICULTY_LABEL[run.difficulty]}</Badge>
      </div>
      {run.relics.length > 0 && (
        <ul className="run-relics" aria-label="Relics">
          {run.relics.map((r) => (
            <li key={r.id} className="run-relic" data-rarity={r.rarity} title={`${r.name}: ${r.description}`}>
              <Gem size={13} aria-hidden="true" />{r.name}
            </li>
          ))}
        </ul>
      )}
      {(onAbandon || onBack) && (
        <div className="run-bar__actions">
          {onBack && <Button size="sm" variant="ghost" onClick={onBack}>Arena</Button>}
          {onAbandon && <Button size="sm" variant="ghost" onClick={onAbandon}><Flag size={14} aria-hidden="true" />Abandon</Button>}
        </div>
      )}
    </header>
  );
}

/** The act's map: layers left to right, the boss at the end. Reachable nodes glow; the path walked is lit. */
function RunMap({ run, busy, onTravel }: { run: Run; busy: string | null; onTravel: (n: RunNode) => void }) {
  const nodes = run.map.nodes;
  const layers = Math.max(...nodes.map((n) => n.layer)) + 1;
  const pos = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) {
      const size = nodes.filter((m) => m.layer === n.layer).length;
      out[n.id] = { x: ((n.layer + 0.5) / layers) * 100, y: ((n.index + 0.5) / size) * 100 };
    }
    return out;
  }, [nodes, layers]);
  const visited = new Set(run.visited);
  const reachable = new Set(run.reachable);

  return (
    <section className="run-map glass" aria-label={`Map of act ${run.act}`}>
      <svg className="run-map__edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {nodes.flatMap((n) => n.edges.map((to) => {
          const a = pos[n.id], b = pos[to];
          if (!a || !b) return null;
          const walked = visited.has(n.id) && (visited.has(to) || run.node_id === to);
          const open = run.node_id === n.id && reachable.has(to);
          return <path key={`${n.id}>${to}`} d={`M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`}
                       className="run-map__edge" data-walked={walked || undefined} data-open={open || undefined} vectorEffect="non-scaling-stroke" />;
        }))}
      </svg>
      <ol className="run-map__nodes">
        {nodes.map((n, i) => {
          const { Icon, label, blurb } = KIND[n.kind];
          const state = run.node_id === n.id ? "current" : visited.has(n.id) ? "visited" : reachable.has(n.id) ? "open" : "locked";
          return (
            <motion.li key={n.id} className="run-node" style={{ left: `${pos[n.id].x}%`, top: `${pos[n.id].y}%`, x: "-50%", y: "-50%" }}
                       initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.025, type: "spring", stiffness: 300, damping: 20 }}>
              <button type="button" className="run-node__btn" data-kind={n.kind} data-state={state}
                      disabled={state !== "open" || busy !== null} onClick={() => onTravel(n)}
                      aria-label={`${label}${state === "open" ? "" : state === "current" ? " (you are here)" : state === "visited" ? " (visited)" : " (out of reach)"}. ${blurb}`}>
                <Icon size={n.kind === "boss" ? 26 : 18} aria-hidden="true" />
              </button>
              <span className="run-node__label" aria-hidden="true">{label}</span>
            </motion.li>
          );
        })}
      </ol>
      {run.reachable.length > 0 && <p className="run-map__hint">Choose your path: glowing places are in reach.</p>}
    </section>
  );
}

/** A rest, a shop or a relic offer waiting for the player's pick. */
function PendingChoice({ run, busy, onChoose }: { run: Run; busy: string | null; onChoose: (action: string, target?: string) => void }) {
  const p = run.pending!;
  return (
    <motion.section className="run-choice glass" aria-labelledby="run-choice-title" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      {p.kind === "rest" && (
        <>
          <h3 id="run-choice-title" className="run-choice__title"><BedDouble size={18} aria-hidden="true" />A quiet campfire</h3>
          <div className="run-choice__grid">
            <button type="button" className="run-card" disabled={busy !== null} onClick={() => onChoose("heal")}>
              <Heart size={22} aria-hidden="true" /><b>Rest</b><span>Recover {p.heal} {p.heal === 1 ? "heart" : "hearts"}.</span>
            </button>
            {p.options.includes("study") && p.concepts.map((c) => (
              <button key={c} type="button" className="run-card" disabled={busy !== null} onClick={() => onChoose("study", c)}>
                <BookOpen size={22} aria-hidden="true" /><b>Study: {c}</b><span>Review it. +1 Focus at the start of every fight this act.</span>
              </button>
            ))}
          </div>
        </>
      )}
      {p.kind === "shop" && (
        <>
          <h3 id="run-choice-title" className="run-choice__title"><Store size={18} aria-hidden="true" />A travelling merchant <span className="run-stat run-stat--gold ml-auto"><Coins size={14} aria-hidden="true" />{run.gold}</span></h3>
          <div className="run-choice__grid">
            {p.stock.map((item) => (
              <button key={item.id} type="button" className="run-card" data-rarity={item.rarity} disabled={item.sold || item.price > run.gold || busy !== null}
                      onClick={() => onChoose("buy", item.id)}>
                {item.kind === "potion" ? <Heart size={22} aria-hidden="true" /> : <Gem size={22} aria-hidden="true" />}
                <b>{item.name}</b><span>{item.description}</span>
                <span className="run-card__price">{item.sold ? "Sold" : <><Coins size={13} aria-hidden="true" />{item.price}</>}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-end"><Button onClick={() => onChoose("leave")} loading={busy === "leave:"}>Leave the shop</Button></div>
        </>
      )}
      {p.kind === "relic" && (
        <>
          <h3 id="run-choice-title" className="run-choice__title"><Gem size={18} aria-hidden="true" />Choose a relic</h3>
          <div className="run-choice__grid">
            {p.relics.map((r) => (
              <button key={r.id} type="button" className="run-card run-card--relic fx-beam" data-rarity={r.rarity} disabled={busy !== null} onClick={() => onChoose("take", r.id)}>
                <Gem size={26} aria-hidden="true" /><b>{r.name}</b><span>{r.description}</span><Badge tone={r.rarity}>{r.rarity}</Badge>
              </button>
            ))}
          </div>
          <div className="flex justify-end"><Button variant="ghost" onClick={() => onChoose("skip")}>Skip</Button></div>
        </>
      )}
    </motion.section>
  );
}

/** How the last run ended. */
function RunOver({ run }: { run: Run }) {
  const won = run.status === "won";
  return (
    <section className="run-over glass" data-outcome={run.status} aria-label="Expedition result">
      <h2 className="arena-result__headline pixel-font">{won ? "Expedition complete!" : run.status === "abandoned" ? "Expedition abandoned" : "The expedition ends"}</h2>
      <dl className="arena-result__stats">
        <div><dt>Score</dt><dd className="pixel-font">{run.score}</dd></div>
        <div><dt>Depth</dt><dd className="pixel-font">{run.depth}</dd></div>
        <div><dt>Bosses beaten</dt><dd className="pixel-font">{run.battles_won}</dd></div>
        <div><dt>Act</dt><dd className="pixel-font">{run.act}/{run.acts_total}</dd></div>
      </dl>
    </section>
  );
}
