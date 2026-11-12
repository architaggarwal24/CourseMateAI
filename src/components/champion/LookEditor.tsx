"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices, Lock, RotateCcw } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampionLook } from "@/components/champion/useChampionLook";
import { Button, Modal, Tabs, toast } from "@/components/ui";
import { useChampion } from "@/hooks/useChampion";
import { useMyHero } from "@/hooks/useMyHero";
import {
  BUILDS, CLOTH_COLORS, DEFAULT_HERO_LOOK, EYE_COLORS, HAIR_COLORS, HAIR_STYLES, OUTFITS, SKIN_TONES, SLEEVES, STARTER_LOOKS,
  sameAppearance, starterLook, type Appearance, type ClothColor,
} from "@/lib/game/appearance";
import { HERO_FIGHTER_ID, heroFighter } from "@/lib/pixel/appearance";
import { HEROES } from "@/lib/pixel/heroes";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = {
  spiky: "Spiky", ponytail: "Ponytail", bob: "Bob", wild: "Wild", slick: "Slicked back", topknot: "Topknot", hood: "Hood",
  slim: "Slim", standard: "Standard", broad: "Broad",
  coat: "Long coat", gi: "Gi", armor: "Armour", robe: "Robe", jacket: "Jacket", tank: "Vest",
  long: "Long", short: "Short", none: "None",
};
const nice = (id: string) => LABEL[id] ?? id[0].toUpperCase() + id.slice(1);

type Field = keyof Appearance;
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random look that still reads well: outfit colours from the palette, never the same main and second. */
export function randomLook(): Appearance {
  const cloth = Object.keys(CLOTH_COLORS) as ClothColor[];
  const main = pick(cloth);
  const second = pick(cloth.filter((c) => c !== main));
  return {
    skin: pick(Object.keys(SKIN_TONES)) as Appearance["skin"], eyes: pick(Object.keys(EYE_COLORS)) as Appearance["eyes"],
    hair: pick(HAIR_STYLES), hairColor: pick(Object.keys(HAIR_COLORS)) as Appearance["hairColor"], build: pick(BUILDS),
    outfit: pick(OUTFITS), sleeves: pick(SLEEVES), main, second, trim: pick(cloth), pants: pick(cloth), boots: pick(cloth),
    gloves: Math.random() < 0.4 ? pick(cloth) : "none", cape: Math.random() < 0.25 ? pick(cloth) : "none", scarf: Math.random() < 0.25 ? pick(cloth) : "none",
  };
}

/** A row of colour swatches (a radio group): `none` adds a "None" choice first. */
function Swatches({ label, field, colors, value, onPick, none }: {
  label: string; field: Field; colors: Record<string, string>; value: string; onPick: (f: Field, v: string) => void; none?: boolean;
}) {
  const ids = [...(none ? ["none"] : []), ...Object.keys(colors)];
  return (
    <fieldset className="look-field">
      <legend className="look-field__label">{label} <span className="look-field__value">{nice(value)}</span></legend>
      <div className="look-swatches">
        {ids.map((id) => (
          <button
            key={id} type="button" className={cn("look-swatch", id === "none" && "look-swatch--none")}
            style={id === "none" ? undefined : { background: colors[id] }}
            aria-pressed={value === id} aria-label={`${label}: ${nice(id)}`} title={nice(id)}
            onClick={() => onPick(field, id)}
          >{id === "none" ? <span aria-hidden="true">None</span> : null}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** A row of text choices (a radio group). */
function Choices({ label, field, options, value, onPick }: { label: string; field: Field; options: readonly string[]; value: string; onPick: (f: Field, v: string) => void }) {
  return (
    <fieldset className="look-field">
      <legend className="look-field__label">{label}</legend>
      <div className="look-chips">
        {options.map((id) => (
          <button key={id} type="button" className="look-chip" aria-pressed={value === id} onClick={() => onPick(field, id)}>{nice(id)}</button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Your hero's look: everything about how it looks, with a live animated preview. Nothing is saved until Save. A
 * champion's look can be copied once that champion reaches 100% mastery; until then its tile is locked.
 */
export default function LookEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const view = useMyHero((s) => s.view);
  const saveLook = useMyHero((s) => s.saveLook);
  const progress = useChampion((s) => s.progress);
  const saved = view?.look ?? null;
  const style = view?.build.style ?? "apprentice";
  const base = useMemo(() => heroFighter({ style }), [style]);
  const [draft, setDraft] = useState<Appearance>(() => saved ?? DEFAULT_HERO_LOOK);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState("start");

  // a fresh draft every time the editor opens
  useEffect(() => { if (open) { setDraft(saved ?? DEFAULT_HERO_LOOK); setSection(saved ? "body" : "start"); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { hero } = useChampionLook({ preview: true, championId: HERO_FIGHTER_ID, appearance: draft });
  const set = (f: Field, v: string) => setDraft((d) => ({ ...d, [f]: v }));
  const own = DEFAULT_HERO_LOOK;
  const changed = !sameAppearance(draft, saved ?? own);
  const unlocked = new Set(view?.looks_unlocked ?? []);

  // small still previews for the hair styles and outfits: the draft with just that one choice changed
  const hairTiles = useMemo(() => HAIR_STYLES.map((h) => ({ id: h, hero: heroFighter({ style, look: { ...draft, hair: h } }) })), [style, draft]);
  const outfitTiles = useMemo(() => OUTFITS.map((o) => ({ id: o, hero: heroFighter({ style, look: { ...draft, outfit: o } }) })), [style, draft]);

  const save = async () => {
    setSaving(true);
    const ok = await saveLook(sameAppearance(draft, own) ? null : draft);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open} onClose={onClose} size="wide" title="Your hero's look" className="look-editor"
      actions={(
        <>
          <Button variant="ghost" onClick={() => setDraft(own)} disabled={sameAppearance(draft, own)}>
            <RotateCcw size={14} aria-hidden="true" />Default look
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!changed || saving}>{saving ? "Saving…" : "Save look"}</Button>
        </>
      )}
    >
      <div className="look-editor__body">
        <div className="look-editor__stage" style={{ "--hero-accent": base.accent } as React.CSSProperties}>
          <PixelSprite hero={hero} anim="idle" label="Preview: your hero in the new look" className="look-editor__figure" />
          <p className="m-0 text-xs text-fg-muted text-center">Looks only. Your style ({base.title}) decides your weapon and moves.</p>
        </div>

        <div className="look-editor__options">
          <Tabs
            label="Parts of the look" value={section} onChange={setSection} className="look-editor__tabs"
            tabs={[
              { id: "start", label: "Start", content: (
                <div className="look-panel">
                  <fieldset className="look-field">
                    <legend className="look-field__label">Copy a champion&apos;s look</legend>
                    <div className="look-tiles">
                      {HEROES.map((h) => {
                        const ok = unlocked.has(h.id);
                        const pct = progress[h.id]?.mastery_pct ?? 0;
                        return (
                          <button
                            key={h.id} type="button" className="look-tile" aria-pressed={ok && sameAppearance(draft, STARTER_LOOKS[h.id])}
                            aria-disabled={!ok || undefined} data-locked={!ok || undefined}
                            aria-label={ok ? h.name : `${h.name}: unlocks at 100% mastery (${pct}%)`}
                            onClick={() => (ok ? setDraft(starterLook(h.id)) : toast.info(`${h.name}'s look unlocks at 100% mastery. ${h.name} is at ${pct}%.`))}
                          >
                            <PixelSprite hero={h} portrait still className="look-tile__art" />
                            <span>{ok ? h.name : <><Lock size={10} aria-hidden="true" /> {pct}%</>}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <p className="m-0 text-sm text-fg-2">A champion&apos;s look unlocks when you master them. Build your own in the other tabs, or let the dice decide.</p>
                  <div><Button size="sm" onClick={() => setDraft(randomLook())}><Dices size={14} aria-hidden="true" />Surprise me</Button></div>
                </div>
              ) },
              { id: "body", label: "Body", content: (
                <div className="look-panel">
                  <Swatches label="Skin" field="skin" colors={SKIN_TONES} value={draft.skin} onPick={set} />
                  <Choices label="Build" field="build" options={BUILDS} value={draft.build} onPick={set} />
                  <Swatches label="Eyes" field="eyes" colors={EYE_COLORS} value={draft.eyes} onPick={set} />
                </div>
              ) },
              { id: "hair", label: "Hair", content: (
                <div className="look-panel">
                  <fieldset className="look-field">
                    <legend className="look-field__label">Hair style <span className="look-field__value">{nice(draft.hair)}</span></legend>
                    <div className="look-tiles">
                      {hairTiles.map((t) => (
                        <button key={t.id} type="button" className="look-tile" aria-pressed={draft.hair === t.id} onClick={() => set("hair", t.id)}>
                          <PixelSprite hero={t.hero} portrait still className="look-tile__art" />
                          <span>{nice(t.id)}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <Swatches label="Hair colour" field="hairColor" colors={HAIR_COLORS} value={draft.hairColor} onPick={set} />
                </div>
              ) },
              { id: "outfit", label: "Outfit", content: (
                <div className="look-panel">
                  <fieldset className="look-field">
                    <legend className="look-field__label">Style <span className="look-field__value">{nice(draft.outfit)}</span></legend>
                    <div className="look-tiles look-tiles--tall">
                      {outfitTiles.map((t) => (
                        <button key={t.id} type="button" className="look-tile" aria-pressed={draft.outfit === t.id} onClick={() => set("outfit", t.id)}>
                          <PixelSprite hero={t.hero} still className="look-tile__art look-tile__art--body" />
                          <span>{nice(t.id)}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <Choices label="Sleeves" field="sleeves" options={SLEEVES} value={draft.sleeves} onPick={set} />
                  <Swatches label="Main colour" field="main" colors={CLOTH_COLORS} value={draft.main} onPick={set} />
                  <Swatches label="Second colour" field="second" colors={CLOTH_COLORS} value={draft.second} onPick={set} />
                  <Swatches label="Trim and belt" field="trim" colors={CLOTH_COLORS} value={draft.trim} onPick={set} />
                </div>
              ) },
              { id: "extras", label: "Extras", content: (
                <div className="look-panel">
                  <Swatches label="Trousers" field="pants" colors={CLOTH_COLORS} value={draft.pants} onPick={set} />
                  <Swatches label="Boots" field="boots" colors={CLOTH_COLORS} value={draft.boots} onPick={set} />
                  <Swatches label="Gloves" field="gloves" colors={CLOTH_COLORS} value={draft.gloves} onPick={set} none />
                  <Swatches label="Cape" field="cape" colors={CLOTH_COLORS} value={draft.cape} onPick={set} none />
                  <Swatches label="Scarf" field="scarf" colors={CLOTH_COLORS} value={draft.scarf} onPick={set} none />
                  <p className="m-0 text-xs text-fg-muted">An outfit skin from the shop recolours your outfit while you wear it.</p>
                </div>
              ) },
            ]}
          />
        </div>
      </div>
    </Modal>
  );
}
