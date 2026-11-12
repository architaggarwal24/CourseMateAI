"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Coins, Lock, Minus, Plus, RotateCcw, Shirt, Sparkles, Swords, Zap } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { Badge, Button, Tabs } from "@/components/ui";
import { useMyHero, type HeroBuild, type HeroView } from "@/hooks/useMyHero";
import { heroFighter } from "@/lib/pixel/appearance";
import { cn } from "@/lib/utils";

const BRANCH: Record<"o" | "d" | "m", string> = { o: "Offense", d: "Defense", m: "Mind" };

/** Points a build costs, the same sum the server makes (game/build.ts buildCost). */
export function costOf(v: HeroView, b: HeroBuild): number {
  const c = v.catalog;
  return (c.passives.find((p) => p.id === b.passive)?.cost ?? 0) + (c.ultimates.find((u) => u.id === b.ultimate)?.cost ?? 0)
    + b.perks.reduce((a, id) => a + (c.perks.find((p) => p.id === id)?.cost ?? 0), 0)
    - b.weaknesses.reduce((a, id) => a + (c.weaknesses.find((w) => w.id === id)?.points ?? 0), 0);
}

/** Can this node take another point under the tree's rules (tiers open top-down, tier 6 after 5 in its branch)? */
export function canRaise(v: HeroView, tree: Record<string, number>, id: string): boolean {
  const n = v.catalog.tree.find((x) => x.id === id)!;
  const spent = Object.values(tree).reduce((a, x) => a + x, 0);
  if ((tree[id] ?? 0) >= n.ranks || spent >= v.skill_points) return false;
  const branch = v.catalog.tree.filter((x) => x.branch === n.branch);
  if (n.tier > 1 && !(tree[branch[n.tier - 2].id] ?? 0)) return false;
  if (n.tier === 6 && branch.slice(0, 5).reduce((a, x) => a + (tree[x.id] ?? 0), 0) < 5) return false;
  return true;
}

/** Can this node give a point back without stranding a node below it? */
export function canLower(v: HeroView, tree: Record<string, number>, id: string): boolean {
  if (!(tree[id] ?? 0)) return false;
  const next = { ...tree, [id]: (tree[id] ?? 0) - 1 };
  const n = v.catalog.tree.find((x) => x.id === id)!;
  const branch = v.catalog.tree.filter((x) => x.branch === n.branch);
  return branch.every((x) => {
    if (!(next[x.id] ?? 0)) return true;
    if (x.tier > 1 && !(next[branch[x.tier - 2].id] ?? 0)) return false;
    if (x.tier === 6 && branch.slice(0, 5).reduce((a, y) => a + (next[y.id] ?? 0), 0) < 5) return false;
    return true;
  });
}

function Styles({ v }: { v: HeroView }) {
  const saveBuild = useMyHero((s) => s.saveBuild);
  const buy = useMyHero((s) => s.buy);
  return (
    <ul className="hb-styles" aria-label="Fighting styles">
      {v.catalog.styles.map((st) => {
        const on = v.build.style === st.id;
        return (
          <li key={st.id} className="hb-style" data-on={on || undefined} data-locked={!st.owned || undefined}>
            <PixelSprite hero={heroFighter({ style: st.id, look: v.look })} still className="hb-style__art" />
            <div className="min-w-0 grid gap-1">
              <p className="m-0 font-semibold text-fg">{st.name}{on && <Badge tone="success" className="ml-2">Equipped</Badge>}</p>
              <p className="m-0 text-sm text-fg-2"><Zap size={12} className="inline" aria-hidden="true" /> {st.bonus}</p>
              <p className="m-0 text-sm text-fg-muted"><AlertTriangle size={12} className="inline" aria-hidden="true" /> {st.weakness.name}: {st.weakness.text}</p>
              {!st.owned && <p className="m-0 text-xs text-fg-muted"><Lock size={10} className="inline" aria-hidden="true" /> {st.how}{st.progress !== null ? ` (${st.progress}%)` : ""}</p>}
              <div className="flex flex-wrap gap-2 mt-1">
                {st.owned && !on && <Button size="sm" onClick={() => void saveBuild({ ...v.build, style: st.id })}><Swords size={14} aria-hidden="true" />Fight with {st.name}</Button>}
                {st.for_sale && (
                  <Button size="sm" variant="reward" disabled={!st.for_sale.can_buy} onClick={() => void buy(`style:${st.id}`)}>
                    <Coins size={14} aria-hidden="true" />{st.for_sale.can_buy ? `Buy for ${st.for_sale.coins}` : `Player Lv ${st.for_sale.level}`}
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Choice<T extends { id: string; name: string; text: string; owned?: boolean; cost?: number; how?: string; points?: number }>({
  item, on, kind, disabled, onToggle,
}: { item: T; on: boolean; kind: "radio" | "check"; disabled?: boolean; onToggle: () => void }) {
  const locked = item.owned === false;
  return (
    <button
      type="button" role={kind === "radio" ? "radio" : "checkbox"} aria-checked={on} aria-disabled={locked || disabled || undefined}
      className={cn("hb-choice", locked && "hb-choice--locked")} onClick={() => { if (!locked && !disabled) onToggle(); }}
    >
      <span className="hb-choice__head">
        <span className="font-semibold text-fg">{locked && <Lock size={11} className="inline mr-1" aria-hidden="true" />}{item.name}</span>
        <span className="hb-choice__cost pixel-font">{item.points ? `+${item.points}` : item.cost}</span>
      </span>
      <span className="text-xs text-fg-2">{item.text}</span>
      {locked && item.how && <span className="text-xs text-fg-muted">{item.how}</span>}
    </button>
  );
}

function Loadout({ v }: { v: HeroView }) {
  const saveBuild = useMyHero((s) => s.saveBuild);
  const [draft, setDraft] = useState<HeroBuild>(v.build);
  useEffect(() => setDraft(v.build), [v.build]);
  const cost = costOf(v, draft);
  const over = cost > v.loadout_budget;
  const changed = JSON.stringify(draft) !== JSON.stringify(v.build);
  const toggle = (k: "perks" | "weaknesses", id: string, max: number) =>
    setDraft((d) => ({ ...d, [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : d[k].length < max ? [...d[k], id] : d[k] }));
  return (
    <div className="grid gap-4">
      <div className="hb-points" data-over={over || undefined} role="status">
        <span>Loadout points</span>
        <span className="pixel-font">{cost} / {v.loadout_budget}</span>
        <span className="hb-points__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (100 * cost) / v.loadout_budget)}%` }} /></span>
      </div>
      <fieldset className="hb-group"><legend>Passive</legend>
        <div role="radiogroup" aria-label="Passive" className="hb-choices">
          {v.catalog.passives.map((p) => <Choice key={p.id} item={p} kind="radio" on={draft.passive === p.id} onToggle={() => setDraft((d) => ({ ...d, passive: p.id }))} />)}
        </div>
      </fieldset>
      <fieldset className="hb-group"><legend>Ultimate</legend>
        <div role="radiogroup" aria-label="Ultimate" className="hb-choices">
          {v.catalog.ultimates.map((u) => <Choice key={u.id} item={u} kind="radio" on={draft.ultimate === u.id} onToggle={() => setDraft((d) => ({ ...d, ultimate: u.id }))} />)}
        </div>
      </fieldset>
      <fieldset className="hb-group"><legend>Perks (up to 3)</legend>
        <div className="hb-choices">
          {v.catalog.perks.map((p) => <Choice key={p.id} item={p} kind="check" on={draft.perks.includes(p.id)} disabled={!draft.perks.includes(p.id) && draft.perks.length >= 3} onToggle={() => toggle("perks", p.id, 3)} />)}
        </div>
      </fieldset>
      <fieldset className="hb-group"><legend>Extra weaknesses (up to 2, each gives points back)</legend>
        <div className="hb-choices">
          {v.catalog.weaknesses.map((w) => <Choice key={w.id} item={w} kind="check" on={draft.weaknesses.includes(w.id)} disabled={!draft.weaknesses.includes(w.id) && draft.weaknesses.length >= 2} onToggle={() => toggle("weaknesses", w.id, 2)} />)}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2 items-center">
        <Button variant="primary" disabled={!changed || over} onClick={() => void saveBuild(draft)}>Save loadout</Button>
        {changed && <Button variant="ghost" onClick={() => setDraft(v.build)}>Undo changes</Button>}
        {over && <span className="text-sm text-ink-red" role="alert">That's {cost - v.loadout_budget} points over. Drop something or take a weakness.</span>}
      </div>
    </div>
  );
}

function SkillTree({ v }: { v: HeroView }) {
  const saveTree = useMyHero((s) => s.saveTree);
  const [tree, setTree] = useState<Record<string, number>>(v.tree);
  useEffect(() => setTree(v.tree), [v.tree]);
  const spent = Object.values(tree).reduce((a, x) => a + x, 0);
  const changed = JSON.stringify(tree) !== JSON.stringify(v.tree);
  const bump = (id: string, d: 1 | -1) => setTree((t) => {
    const next = { ...t, [id]: (t[id] ?? 0) + d };
    if (!next[id]) delete next[id];
    return next;
  });
  return (
    <div className="grid gap-4">
      <div className="hb-points" role="status">
        <span>Skill points</span>
        <span className="pixel-font">{v.skill_points - spent} left of {v.skill_points}</span>
        <span className="text-xs text-fg-muted">One a level. Reset any time, free.</span>
      </div>
      <div className="hb-tree">
        {(["o", "d", "m"] as const).map((br) => (
          <section key={br} className="hb-branch" aria-label={BRANCH[br]}>
            <h4 className="hb-branch__title pixel-font">{BRANCH[br]}</h4>
            <ol className="hb-nodes">
              {v.catalog.tree.filter((n) => n.branch === br).map((n) => {
                const r = tree[n.id] ?? 0;
                return (
                  <li key={n.id} className="hb-node" data-on={r > 0 || undefined}>
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-fg">{n.name} <span className="text-xs text-fg-muted">{r}/{n.ranks}</span></p>
                      <p className="m-0 text-xs text-fg-2">{n.text}</p>
                    </div>
                    <div className="hb-node__btns">
                      <button type="button" className="hb-node__btn" aria-label={`Take a point out of ${n.name}`} disabled={!canLower(v, tree, n.id)} onClick={() => bump(n.id, -1)}><Minus size={12} /></button>
                      <button type="button" className="hb-node__btn" aria-label={`Put a point in ${n.name}`} disabled={!canRaise(v, tree, n.id)} onClick={() => bump(n.id, 1)}><Plus size={12} /></button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!changed} onClick={() => void saveTree(tree)}>Save skills</Button>
        <Button variant="ghost" disabled={!spent} onClick={() => setTree({})}><RotateCcw size={14} aria-hidden="true" />Reset all points</Button>
        {changed && <Button variant="ghost" onClick={() => setTree(v.tree)}>Undo changes</Button>}
      </div>
    </div>
  );
}

/**
 * Your hero's workshop in the Champion tab: its level, fighting styles, loadout and skill tree. The look has its
 * own editor (LookEditor), opened from the stage.
 */
export default function HeroBuilder({ onEditLook }: { onEditLook: () => void }) {
  const v = useMyHero((s) => s.view);
  const load = useMyHero((s) => s.load);
  const [tab, setTab] = useState("style");
  useEffect(() => { void load(); }, [load]);
  const style = useMemo(() => v?.catalog.styles.find((s) => s.id === v.build.style), [v]);
  if (!v) return <p role="status" className="text-fg-muted">Getting your hero ready…</p>;
  const pct = v.next_level_xp ? Math.round((100 * v.level_xp) / v.next_level_xp) : 100;
  return (
    <div className="hb mb-6" data-testid="hero-builder">
      <div className="champ-kit__head">
        <p className="hero-label m-0">Your hero</p>
        <span className="champ-kit__level">
          <span className="sr-only">{`Hero level ${v.level}${v.next_level_xp ? `, ${v.level_xp} of ${v.next_level_xp} XP` : ", max level"}`}</span>
          <span className="pixel-font" aria-hidden="true">Lv {v.level}</span>
          <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
          <span className="text-xs text-fg-muted" aria-hidden="true">{v.next_level_xp ? `${v.level_xp}/${v.next_level_xp} XP` : "Max"}</span>
        </span>
      </div>
      <p className="m-0 mt-1 text-sm text-fg-2">
        Fighting with <strong>{style?.name}</strong> · {v.catalog.passives.find((p) => p.id === v.build.passive)?.name} · {v.catalog.ultimates.find((u) => u.id === v.build.ultimate)?.name}.
        {" "}Fights you fight as your hero give it full XP; everything else you do gives it a quarter.
      </p>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button size="sm" onClick={onEditLook}><Shirt size={14} aria-hidden="true" />Change your look</Button>
      </div>
      <Tabs
        label="Your hero" value={tab} onChange={setTab} className="mt-4"
        tabs={[
          { id: "style", label: <><Swords size={14} aria-hidden="true" /> Styles</>, content: <div className="pt-4"><Styles v={v} /></div> },
          { id: "loadout", label: <><Sparkles size={14} aria-hidden="true" /> Loadout</>, content: <div className="pt-4"><Loadout v={v} /></div> },
          { id: "skills", label: <><Zap size={14} aria-hidden="true" /> Skills</>, content: <div className="pt-4"><SkillTree v={v} /></div> },
        ]}
      />
    </div>
  );
}
