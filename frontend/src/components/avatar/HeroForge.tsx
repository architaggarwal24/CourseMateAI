"use client";
// The Hero Forge: build the look. A live stage (the vector hero, with the item under the cursor tried on) beside option
// grids for body, skin, hair, face, outfit, headgear, weapon and pet. Colours are swatches, gear is its own picture
// (ItemIcon) with its name and its arena effects; nothing here is an emoji.
import { useMemo, useState } from "react";
import { Crown, Eye, Palette, PawPrint, Scissors, Shield, Swords, User } from "lucide-react";
import { Tabs } from "@/components/ui";
import { BODY_TYPES, EYE_COLORS, HAIR_COLORS, LIP_COLORS, SKIN_TONES, type Look } from "@/lib/avatar/look";
import { RARITY_LABEL, rarityClass, rarityOf } from "@/lib/rarity";
import { gearChips, totalGear } from "@/lib/gear";
import { cn } from "@/lib/utils";
import GearChips from "./GearChips";
import HeroFigure from "./HeroFigure";
import ItemIcon from "./ItemIcon";
import "./forge.css";

export interface ForgeItem { id: string; name: string; category: string; price?: number; battle?: Record<string, number>; description?: string }

interface Props {
  look: Look;
  onChange: (key: keyof Look, value: string) => void;
  /** Everything the shop sells; the Forge offers the owned ones (and the free outfit). */
  items: ForgeItem[];
  owned: string[];
}

type SlotKey = "armorId" | "headId" | "weaponId" | "petId";
const SLOTS: Array<{ key: SlotKey; category: string; none?: string }> = [
  { key: "armorId", category: "armor" },
  { key: "headId", category: "headgear", none: "Bare head" },
  { key: "weaponId", category: "weapon", none: "Unarmed" },
  { key: "petId", category: "pet", none: "No pet" },
];

function Swatch({ color, label, selected, onClick, onHover }: { color: string; label: string; selected: boolean; onClick: () => void; onHover?: (on: boolean) => void }) {
  return (
    <button type="button" className="forge-swatch" aria-pressed={selected} aria-label={label} title={label} onClick={onClick}
      onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}>
      <span style={{ background: color }} />
    </button>
  );
}

export default function HeroForge({ look, onChange, items, owned }: Props) {
  const [hover, setHover] = useState<Partial<Look> | null>(null);
  const shown: Look = hover ? { ...look, ...hover } : look;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const gearOf = (l: Look) => totalGear([byId.get(l.armorId), byId.get(l.headId), byId.get(l.weaponId), byId.get(l.petId)] as never);
  const totals = gearOf(look);

  const gearGrid = ({ key, category, none }: (typeof SLOTS)[number]) => {
    const list = items.filter((i) => i.category === category && (i.id === look[key] || owned.includes(i.id) || (category === "armor" && i.id === "armor_shirt_basic")));
    const hint = (patch: Partial<Look> | null) => () => setHover(patch);
    return (
      <ul className="forge-grid" aria-label={category}>
        {none !== undefined && (
          <li>
            <button type="button" className="forge-opt" aria-pressed={look[key] === ""} onClick={() => onChange(key, "")}
              onMouseEnter={hint({ [key]: "" })} onMouseLeave={hint(null)} onFocus={hint({ [key]: "" })} onBlur={hint(null)}>
              <span className="forge-opt__none" aria-hidden="true">—</span>
              <span className="forge-opt__name">{none}</span>
            </button>
          </li>
        )}
        {list.map((it) => (
          <li key={it.id}>
            <button type="button" className={cn("forge-opt", rarityClass(rarityOf(it)))} aria-pressed={look[key] === it.id}
              onClick={() => onChange(key, it.id)}
              onMouseEnter={hint({ [key]: it.id })} onMouseLeave={hint(null)} onFocus={hint({ [key]: it.id })} onBlur={hint(null)}>
              <ItemIcon itemId={it.id} size={60} />
              <span className="forge-opt__name">{it.name}</span>
              <span className="forge-opt__rarity">{RARITY_LABEL[rarityOf(it)]}</span>
              {gearChips(it.battle).length > 0 && (
                <span className="forge-opt__fx">{gearChips(it.battle).map((c) => `${c.label} ${c.value}`).join(" · ")}</span>
              )}
            </button>
          </li>
        ))}
        {list.length <= (none !== undefined ? 0 : 1) && <li className="forge-empty">Nothing owned yet. Visit the shop.</li>}
      </ul>
    );
  };

  const swatches = (list: ReadonlyArray<{ id: string; label: string }>, current: string, key: keyof Look, color: (x: any) => string) => (
    <div className="forge-swatches" role="group" aria-label={String(key)}>
      {list.map((x) => (
        <Swatch key={x.id} color={color(x)} label={x.label} selected={current === x.id}
          onClick={() => onChange(key, x.id)} onHover={(on) => setHover(on ? { [key]: x.id } : null)} />
      ))}
    </div>
  );

  const tabs = [
    { id: "body", label: <span className="forge-tab"><User size={15} aria-hidden="true" />Body</span>, content: (
      <div>
        <h3 className="forge-h">Build</h3>
        <ul className="forge-grid forge-grid--wide" aria-label="Body type">
          {BODY_TYPES.map((b) => (
            <li key={b.id}>
              <button type="button" className="forge-opt forge-opt--body" aria-pressed={look.bodyTypeId === b.id} onClick={() => onChange("bodyTypeId", b.id)}
                onMouseEnter={() => setHover({ bodyTypeId: b.id })} onMouseLeave={() => setHover(null)} onFocus={() => setHover({ bodyTypeId: b.id })} onBlur={() => setHover(null)}>
                <HeroFigure look={{ ...look, bodyTypeId: b.id, headId: "", weaponId: "", petId: "" }} size={104} withPet={false} withWeapon={false} />
                <span className="forge-opt__name">{b.label}</span>
                <span className="forge-opt__rarity">{b.desc}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>) },
    { id: "skin", label: <span className="forge-tab"><Palette size={15} aria-hidden="true" />Skin</span>, content: (<div><h3 className="forge-h">Skin tone</h3>{swatches(SKIN_TONES, look.skinId, "skinId", (x) => x.b)}</div>) },
    { id: "hair", label: <span className="forge-tab"><Scissors size={15} aria-hidden="true" />Hair</span>, content: (<div><h3 className="forge-h">Hair colour</h3>{swatches(HAIR_COLORS, look.hairId, "hairId", (x) => x.c)}</div>) },
    { id: "face", label: <span className="forge-tab"><Eye size={15} aria-hidden="true" />Face</span>, content: (
      <div className="grid gap-6">
        <div><h3 className="forge-h">Eye colour</h3>{swatches(EYE_COLORS, look.eyeColorId, "eyeColorId", (x) => x.iris)}</div>
        <div><h3 className="forge-h">Lip colour</h3>{swatches(LIP_COLORS, look.lipColorId, "lipColorId", (x) => x.color)}</div>
      </div>) },
    { id: "outfit", label: <span className="forge-tab"><Shield size={15} aria-hidden="true" />Outfit</span>, content: gearGrid(SLOTS[0]) },
    { id: "head", label: <span className="forge-tab"><Crown size={15} aria-hidden="true" />Head</span>, content: gearGrid(SLOTS[1]) },
    { id: "weapon", label: <span className="forge-tab"><Swords size={15} aria-hidden="true" />Weapon</span>, content: gearGrid(SLOTS[2]) },
    { id: "pet", label: <span className="forge-tab"><PawPrint size={15} aria-hidden="true" />Pet</span>, content: gearGrid(SLOTS[3]) },
  ];

  const shownTotals = gearOf(shown);
  const name = (id: string, fallback: string) => byId.get(id)?.name ?? fallback;

  return (
    <div className="forge">
      <section className="forge__stage" aria-label="Preview">
        <div className="forge__spot">
          <HeroFigure look={shown} size="min(100%, 17rem)" animate title="Your hero, as built" />
        </div>
        <dl className="forge__loadout">
          <div><dt>Outfit</dt><dd>{name(shown.armorId, "Plain clothes")}</dd></div>
          <div><dt>Head</dt><dd>{name(shown.headId, "Bare head")}</dd></div>
          <div><dt>Weapon</dt><dd>{name(shown.weaponId, "Unarmed")}</dd></div>
          <div><dt>Pet</dt><dd>{name(shown.petId, "No pet")}</dd></div>
        </dl>
        <div className="forge__fx">
          <p className="forge__fx-title">In the arena{hover ? " (preview)" : ""}</p>
          {gearChips(hover ? shownTotals : totals).length ? <GearChips stats={hover ? shownTotals : totals} /> : <p className="forge__fx-none">No gear bonuses yet.</p>}
        </div>
      </section>

      <section className="forge__options" aria-label="Options">
        <Tabs label="Forge categories" tabs={tabs} defaultValue="body" />
      </section>
    </div>
  );
}
