"use client";
/**
 * PixelAvatar.tsx — Bitmoji-style Hero Forge Builder
 * 4 visually distinct body types, each with unique arm width + torso shape:
 *   male_default   → SKINNY  (2-px slim arms, narrow 6-px torso)
 *   male_athletic  → MUSCULAR (4-px bulging arms, 20-px shoulder-to-shoulder)
 *   female_elegant → HOURGLASS (bust→pinched waist→flared hips)
 *   female_sporty  → SLIM ATHLETIC (lean, even proportions)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { drawFigure } from "@/lib/avatar/render";
import {
  EYE_COLORS as LIB_EYE_COLORS, HAIR_COLORS as LIB_HAIR_COLORS, LAYOUT, LIP_COLORS as LIB_LIP_COLORS,
  SKIN_TONES as LIB_SKIN_TONES, bodyShape,
} from "@/lib/avatar/sprites";
import PixelSprite from "@/components/PixelSprite";
export const SKIN_TONES  = LIB_SKIN_TONES;
export const HAIR_COLORS = LIB_HAIR_COLORS;

const { CW, CH } = LAYOUT;


// ── Body types ────────────────────────────────────────────────────────────────
export const BODY_TYPES = [
  { id: "male_default",   label: "Skinny Male",    emoji: "🧍",  desc: "Lean & lanky build" },
  { id: "male_athletic",  label: "Muscular Male",  emoji: "💪",  desc: "Jacked. Absolutely jacked." },
  { id: "female_elegant", label: "Elegant Female", emoji: "👸",  desc: "Curves in all the right places" },
  { id: "female_sporty",  label: "Sporty Female",  emoji: "🏃",  desc: "Slim, toned & athletic" },
] as const;

export type BodyTypeId = typeof BODY_TYPES[number]["id"];

export interface AvatarConfig {
  bodyTypeId: BodyTypeId | string;
  skinId:     string;
  hairId:     string;
  eyeColorId: string;
  lipColorId: string;
  armorId:    string;
  headId:     string;
  weaponId:   string;
  petId:      string;
}

export const DEFAULT_CONFIG: AvatarConfig = {
  bodyTypeId: "male_default",
  skinId:     "ivory",
  hairId:     "black",
  eyeColorId: "blue",
  lipColorId: "natural",
  armorId:    "armor_shirt_basic",
  headId:     "",
  weaponId:   "",
  petId:      "",
};


const isFemale = (b: string) => bodyShape(b).female;

// The forge's live preview: the shared renderer, with the outfit made for the chosen body type and just a ground shadow.
// (It draws at 5 px per sprite pixel on a canvas sized for PREVIEW_SCALE, as it always has.)
function renderToCtx(ctx: CanvasRenderingContext2D, config: AvatarConfig) {
  drawFigure(ctx, config, { scale: 5, finish: "shadow", bodyTypedOutfit: true });
}

// ── Option lists ──────────────────────────────────────────────────────────────
const OUTFIT_OPTIONS = [
  { id: "armor_gi_white",       label: "White Gi",         emoji: "🥋", hint: "Karate gi, black belt" },
  { id: "armor_gi_red",         label: "Red Fighter",      emoji: "🔴", hint: "Bare chest + red pants" },
  { id: "armor_gi_blue",        label: "Blue Fighter",     emoji: "🔵", hint: "Bare chest + blue pants" },
  { id: "armor_shirt_basic",    label: "Street Tee",       emoji: "👕", hint: "Clean tee + jeans" },
  { id: "armor_hoodie_gray",    label: "Phantom Hoodie",   emoji: "🧥", hint: "Oversized, kangaroo pocket" },
  { id: "armor_robe_blue",      label: "Azure Vestments",  emoji: "📜", hint: "Sapphire robe, gold trim" },
  { id: "armor_jacket_cool",    label: "Midnight Jacket",  emoji: "😎", hint: "Black leather, combat boots" },
  { id: "armor_knight_silver",  label: "Titanfall Plate",  emoji: "🛡️", hint: "Spiked pauldrons & greaves" },
  { id: "armor_knight_gold",    label: "Sol Emperor",      emoji: "⚜️", hint: "Solidified sunlight armor" },
  { id: "armor_wizard_purple",  label: "Void Weaver",      emoji: "🔮", hint: "Arcane robes + rune emblem" },
  { id: "armor_dragon_scale",   label: "Ignis Scale Mail", emoji: "🐉", hint: "Volcano dragon scales" },
  { id: "armor_legends_mantle", label: "Astral Mantle",    emoji: "✨", hint: "Pulsing with starlight" },
];

const HEAD_OPTIONS = [
  { id: "",                     label: "Bare Head",        emoji: "〇" },
  { id: "hat_headband_red",     label: "Red Headband",     emoji: "🔴" },
  { id: "hat_headband_blue",    label: "Blue Headband",    emoji: "🔵" },
  { id: "hat_headband_white",   label: "White Headband",   emoji: "⬜" },
  { id: "hat_baseball_red",     label: "Crimson Cap",      emoji: "🧢" },
  { id: "hat_beanie_blue",    label: "Frostwave Beanie",emoji: "🎿" },
  { id: "hat_wizard",         label: "Archmage Hat",    emoji: "🧙" },
  { id: "hat_crown_bronze",   label: "Verdant Crown",   emoji: "👑" },
  { id: "hat_crown_silver",   label: "Glacial Crown",   emoji: "👑" },
  { id: "hat_crown_gold",     label: "Solaris Crown",   emoji: "👑" },
  { id: "hat_headphones",     label: "Neural Link",     emoji: "🎧" },
  { id: "hat_ninja",          label: "Shadow Veil",     emoji: "🥷" },
  { id: "hat_samurai",        label: "Oni Helm",        emoji: "⛩️" },
];

const WEAPON_OPTIONS = [
  { id: "",                       label: "Unarmed",         emoji: "✊", hint: "" },
  { id: "weapon_pencil",          label: "Scholar Pencil",  emoji: "✏️", hint: "" },
  { id: "weapon_ruler",           label: "Precision Ruler", emoji: "📏", hint: "" },
  { id: "weapon_sword_bronze",    label: "Dawnsteel ✦✦",   emoji: "⚔️", hint: "Dual wield!" },
  { id: "weapon_sword_silver",    label: "Moonblade ✦✦",   emoji: "⚔️", hint: "Dual wield!" },
  { id: "weapon_sword_excalibur", label: "Excalibur ✦✦",   emoji: "✨", hint: "Dual wield!" },
  { id: "weapon_staff_wood",      label: "Emberwood Staff", emoji: "🪄", hint: "" },
  { id: "weapon_staff_crystal",   label: "Aqua Prism",      emoji: "💎", hint: "" },
  { id: "weapon_staff_legendary", label: "Infernal Codex",  emoji: "🌟", hint: "" },
  { id: "weapon_bow",             label: "Ashwood Bow",     emoji: "🏹", hint: "" },
  { id: "weapon_hammer",          label: "Thundercrack",    emoji: "🔨", hint: "" },
];

const PET_OPTIONS = [
  { id: "",                   label: "No Pet",   emoji: "〇",  size: "" as const },
  { id: "pet_cat_orange",     label: "Pyra",     emoji: "🐱",  size: "companion" as const },
  { id: "pet_dog_brown",      label: "Rex",      emoji: "🐶",  size: "companion" as const },
  { id: "pet_owl",            label: "Athena",   emoji: "🦉",  size: "companion" as const },
  { id: "pet_panda",          label: "Kai",      emoji: "🐼",  size: "companion" as const },
  { id: "pet_fox",            label: "Zephyr",   emoji: "🦊",  size: "companion" as const },
  { id: "pet_dragon_baby",    label: "Ignis",    emoji: "🔥",  size: "mount" as const },
  { id: "pet_phoenix",        label: "Solara",   emoji: "🦅",  size: "mount" as const },
  { id: "pet_unicorn",        label: "Lumis",    emoji: "🌈",  size: "mount" as const },
  { id: "pet_dragon_ancient", label: "Erebus",   emoji: "💀",  size: "mount" as const },
  { id: "pet_lion_golden",    label: "Aurum",    emoji: "⭐",  size: "mount" as const },
];

// ── Body type silhouette preview (pure CSS — drawn in the card) ───────────────
function BodySilhouette({ bodyTypeId, selected }: { bodyTypeId: string; selected: boolean }) {
  const c  = selected ? "#FFCC00" : "#AA88EE";
  const c2 = selected ? "#AA8800" : "#6644AA";

  if (bodyTypeId === "male_default") return (
    // SKINNY — tall, narrow, 8px-wide torso
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={5}  ry={6}  fill={c} />
      <rect    x={25.5}  y={13} width={5}  height={3}  fill={c} />
      {/* Narrow torso */}
      <path d="M 22 16 L 34 16 L 33 38 L 23 38 Z" fill={c} opacity={0.9} />
      {/* Slim arms (barely wider than a line) */}
      <rect x={19} y={17} width={3} height={18} rx={1} fill={c2} opacity={0.85} />
      <rect x={34} y={17} width={3} height={18} rx={1} fill={c2} opacity={0.85} />
      {/* Slim legs */}
      <rect x={22} y={38} width={4} height={28} rx={2} fill={c} />
      <rect x={30} y={38} width={4} height={28} rx={2} fill={c} />
    </svg>
  );

  if (bodyTypeId === "male_athletic") return (
    // MUSCULAR — very wide shoulders, thick neck, thick limbs
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={8}  ry={8}  fill={c} />
      <rect    x={23}  y={14} width={10} height={4}  fill={c} />
      {/* Wide V-taper torso */}
      <path d="M 8 18 L 48 18 L 40 42 L 16 42 Z" fill={c} opacity={0.9} />
      {/* Massive arms */}
      <rect x={2}  y={18} width={8} height={22} rx={3} fill={c2} opacity={0.9} />
      <rect x={46} y={18} width={8} height={22} rx={3} fill={c2} opacity={0.9} />
      {/* Thick legs */}
      <rect x={15} y={42} width={10} height={26} rx={3} fill={c} />
      <rect x={31} y={42} width={10} height={26} rx={3} fill={c} />
    </svg>
  );

  if (bodyTypeId === "female_elegant") return (
    // HOURGLASS — wide hips, pinched waist, moderate shoulders
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={6}  ry={7}  fill={c} />
      <rect    x={25.5} y={14} width={5} height={3} fill={c} />
      {/* Hourglass — shoulders, pinch, hips */}
      <path d="M 17 17 C 10 22, 22 30, 21 34 C 20 38, 11 40, 10 48 L 46 48 C 45 40, 36 38, 35 34 C 34 30, 46 22, 39 17 Z" fill={c} opacity={0.9} />
      {/* Delicate arms */}
      <rect x={12} y={18} width={3} height={17} rx={1} fill={c2} opacity={0.8} />
      <rect x={41} y={18} width={3} height={17} rx={1} fill={c2} opacity={0.8} />
      {/* Legs from wide hip base */}
      <rect x={14} y={48} width={7} height={24} rx={3} fill={c} />
      <rect x={35} y={48} width={7} height={24} rx={3} fill={c} />
    </svg>
  );

  // SPORTY FEMALE — lean and toned, slight curves, athletic
  return (
    <svg width={56} height={80} viewBox="0 0 56 80" style={{ display:"block" }}>
      <ellipse cx={28} cy={8}  rx={6}  ry={7}  fill={c} />
      <rect    x={25}  y={14} width={6} height={3}  fill={c} />
      {/* Slim athletic torso — slight taper waist then hips */}
      <path d="M 18 17 L 38 17 L 36 34 L 33 42 L 23 42 L 20 34 Z" fill={c} opacity={0.9} />
      {/* Toned arms */}
      <rect x={14} y={18} width={4} height={17} rx={2} fill={c2} opacity={0.85} />
      <rect x={38} y={18} width={4} height={17} rx={2} fill={c2} opacity={0.85} />
      {/* Athletic legs */}
      <rect x={20} y={42} width={6} height={27} rx={2} fill={c} />
      <rect x={30} y={42} width={6} height={27} rx={2} fill={c} />
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PixelAvatarBuilderProps {
  config:         AvatarConfig;
  onConfigChange: (key: keyof AvatarConfig, val: string) => void;
  ownedItemIds?:  string[];
}

type TabId = "body"|"skin"|"hair"|"face"|"outfit"|"headgear"|"weapon"|"pet";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "body",     icon: "🧑", label: "BODY"   },
  { id: "skin",     icon: "🎨", label: "SKIN"   },
  { id: "hair",     icon: "💇", label: "HAIR"   },
  { id: "face",     icon: "👁️", label: "FACE"   },
  { id: "outfit",   icon: "👕", label: "OUTFIT" },
  { id: "headgear", icon: "🪖", label: "HEAD"   },
  { id: "weapon",   icon: "⚔️", label: "WEAPON" },
  { id: "pet",      icon: "🐾", label: "PET"    },
];

const PREVIEW_SCALE = 6;

export default function PixelAvatarBuilder({ config, onConfigChange, ownedItemIds }: PixelAvatarBuilderProps) {
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const [tab, setTab] = useState<TabId>("body");
  const [hoveredId,   setHoveredId]   = useState<string | null>(null);
  const [flashState,  setFlashState]  = useState<"idle"|"flash"|"settle">("idle");
  const prevConfigRef = useRef(config);

  const owned = ownedItemIds ?? null;
  const filterOpts = <T extends { id: string }>(opts: T[], cur: string): T[] => {
    if (!owned) return opts;
    return opts.filter(o => o.id === "" || o.id === cur || owned.includes(o.id));
  };

  const visOuts    = filterOpts(OUTFIT_OPTIONS,  config.armorId);
  const visHeads   = filterOpts(HEAD_OPTIONS,    config.headId);
  const visWeapons = filterOpts(WEAPON_OPTIONS,  config.weaponId);
  const visPets    = filterOpts(PET_OPTIONS,     config.petId);

  // Build preview config on hover
  const previewCfg = useCallback((): AvatarConfig => {
    if (!hoveredId) return config;
    if (OUTFIT_OPTIONS.some(o => o.id === hoveredId))  return { ...config, armorId:  hoveredId };
    if (HEAD_OPTIONS.some(o => o.id === hoveredId))    return { ...config, headId:   hoveredId };
    if (WEAPON_OPTIONS.some(o => o.id === hoveredId))  return { ...config, weaponId: hoveredId };
    if (PET_OPTIONS.some(o => o.id === hoveredId))     return { ...config, petId:    hoveredId };
    return config;
  }, [config, hoveredId]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    renderToCtx(ctx, previewCfg());
  }, [previewCfg]);

  useEffect(() => { draw(); }, [draw]);

  // Flash on real config change (not hover)
  useEffect(() => {
    if (JSON.stringify(prevConfigRef.current) !== JSON.stringify(config)) {
      prevConfigRef.current = config;
      setFlashState("flash");
      setTimeout(() => setFlashState("settle"), 120);
      setTimeout(() => setFlashState("idle"),   350);
    }
  }, [config]);

  const female = isFemale(config.bodyTypeId);

  // ── Option card component ─────────────────────────────────────────────────
  const Opt = ({ id, selected, onHoverEnter, onHoverLeave, onClick, children }: {
    id: string; selected: boolean;
    onHoverEnter: () => void; onHoverLeave: () => void; onClick: () => void;
    children: React.ReactNode;
  }) => {
    const hovered = hoveredId === id;
    return (
      <button
        onClick={onClick}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        style={{
          position: "relative",
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: 6, padding: "9px 6px", borderRadius: 10, cursor: "pointer",
          border: `2px solid ${selected ? "#F59E0B" : hovered ? "#7C3AED66" : "#0C0C1E"}`,
          background: selected ? "#1C0E00" : hovered ? "#0E0A1E" : "#07070D",
          boxShadow: selected ? "0 0 20px #F59E0B33, inset 0 1px 0 #F59E0B15" : "none",
          fontFamily: "'Press Start 2P', monospace",
          transition: "all .1s",
        }}
      >
        {selected && (
          <div style={{
            position: "absolute", top: 4, right: 5,
            fontSize: 9, color: "#F59E0B", lineHeight: 1,
          }}>✦</div>
        )}
        {children}
      </button>
    );
  };

  const SecHead = ({ title, sub }: { title: string; sub?: string }) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: "#B9A5F0", letterSpacing: 1 }}>{title}</div>
      {sub && <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: "#A8A3C4", lineHeight: 2, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  const spriteBox = (id: string, selected: boolean) => (
    <div style={{
      padding: 3, background: selected ? "#2A1000" : "#080810",
      border: `1px solid ${selected ? "#7C3AED" : "#0C0C1E"}`,
      borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 38, minWidth: 38,
    }}>
      {id ? <PixelSprite itemId={id} size="sm" /> : <span style={{ fontSize: 20 }}>—</span>}
    </div>
  );

  const loadoutLabels = {
    outfit:  visOuts.find(o => o.id === config.armorId)?.label ?? "—",
    head:    visHeads.find(o => o.id === config.headId)?.label ?? "None",
    weapon:  visWeapons.find(o => o.id === config.weaponId)?.label ?? "None",
    pet:     visPets.find(o => o.id === config.petId)?.label ?? "None",
    body:    BODY_TYPES.find(b => b.id === config.bodyTypeId)?.label.replace("\n", " ") ?? "—",
  };

  return (
    <div style={{
      display: "flex", height: "100%",
      maxWidth: 1100, width: "min(1100px, 100%)", borderRadius: 20, overflow: "hidden",
      border: "1px solid #0C0C1E",
      boxShadow: "0 0 100px #7C3AED18, 0 32px 80px rgba(0,0,0,.9)",
    }}>

      {/* ══ LEFT — AVATAR STAGE ══════════════════════════════════════════ */}
      <div style={{
        flexShrink: 0,
        width: CW * PREVIEW_SCALE + 60,
        height: "100%",
        background: "#05030C",
        position: "relative", overflow: "hidden",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>

        {/* Animated aurora bg */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position: "absolute", width: "120%", height: "120%", top: "-10%", left: "-10%",
            background: "radial-gradient(ellipse 60% 40% at 30% 20%, #4C1D9530 0%, transparent 60%)",
            animation: "hf-aurora1 9s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: "120%", height: "120%", top: "-10%", left: "-10%",
            background: "radial-gradient(ellipse 50% 50% at 70% 70%, #06402430 0%, transparent 60%)",
            animation: "hf-aurora2 11s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: "100%", height: "100%",
            background: "radial-gradient(ellipse 70% 60% at 50% 100%, #7C3AED18 0%, transparent 60%)" }} />
        </div>

        {/* Vertical scan lines */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,.015) 39px,rgba(255,255,255,.015) 40px)",
          zIndex: 0,
        }} />

        {/* Circle rune behind avatar */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: 0 }}>
          <svg width={360} height={360} style={{ animation: "hf-runespin 20s linear infinite" }}>
            <circle cx={180} cy={180} r={168} fill="none" stroke="#7C3AED" strokeWidth={1} strokeDasharray="6 14" strokeOpacity={.25} />
            {[...Array(8)].map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              return <circle key={i} cx={180 + 164 * Math.cos(a)} cy={180 + 164 * Math.sin(a)} r={4} fill="#7C3AED" fillOpacity={i % 2 === 0 ? .5 : .2} />;
            })}
          </svg>
        </div>

        {/* Ground glow — anchored to same center as avatar */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400, height: 400,
          background: "radial-gradient(circle, #7C3AED22 0%, transparent 70%)",
          filter: "blur(40px)", pointerEvents: "none", zIndex: 0,
        }} />

        {/* ── THE AVATAR — character-center aligned to stage center ─── */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, calc(-50% + 90px))",
          zIndex: 2,
        }}>
          {/* Flash ring */}
          <div style={{
            position: "absolute", inset: -16, borderRadius: 24, pointerEvents: "none",
            background: "radial-gradient(circle, #F59E0B66, transparent 70%)",
            opacity: flashState === "flash" ? 1 : 0,
            transform: flashState === "flash" ? "scale(1)" : "scale(.85)",
            transition: flashState === "idle" ? "opacity .25s, transform .25s" : "none",
          }} />

          <div style={{ animation: "hf-float 4s ease-in-out infinite" }}>
            <canvas
              ref={canvasRef}
              width={CW * PREVIEW_SCALE}
              height={CH * PREVIEW_SCALE}
              style={{
                imageRendering: "pixelated",
                display: "block",
                filter: `drop-shadow(0 12px 32px #7C3AED66) drop-shadow(0 0 8px #7C3AED44)`,
                transition: "filter .2s",
              }}
            />
          </div>
        </div>

        {/* ── Loadout chips — pinned to bottom of stage ───────────────── */}
        <div style={{ position: "absolute", bottom: 14, left: 0, right: 0, zIndex: 3, display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", padding: "0 12px" }}>
          {([
            ["BODY",   loadoutLabels.body,   "#A78BFA"],
            ["OUTFIT", loadoutLabels.outfit, "#60A5FA"],
            ["HEAD",   loadoutLabels.head,   "#F59E0B"],
            ["WEAPON", loadoutLabels.weapon, "#F87171"],
            ["PET",    loadoutLabels.pet,    "#34D399"],
          ] as [string, string, string][]).map(([k, v, c]) => (
            <div key={k} style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 8,
              color: c, background: c + "12", border: `1px solid ${c}28`,
              borderRadius: 5, padding: "3px 8px",
              maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {k}: {v}
            </div>
          ))}
        </div>

        {/* Hover preview label */}
        {hoveredId && (
          <div style={{
            position: "absolute", top: 14, left: 0, right: 0, textAlign: "center",
            fontFamily: "'Press Start 2P', monospace", fontSize: 8,
            color: "#B9A5F0", letterSpacing: 2, zIndex: 5,
            animation: "hf-pulse 1.2s ease-in-out infinite",
          }}>
            ● PREVIEW
          </div>
        )}
      </div>

      {/* ══ RIGHT — CUSTOMISER ══════════════════════════════════════════ */}
      <div style={{
        flex: 1, minWidth: 0, background: "#040408",
        display: "flex", flexDirection: "column",
        borderLeft: "1px solid #0C0C1E",
        fontFamily: "'Press Start 2P', monospace",
      }}>

        {/* ── Tabs ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexWrap: "wrap", background: "#030306", borderBottom: "1px solid #0C0C1E", flexShrink: 0 }}>
          {TABS.map(t => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                flex: "1 1 auto", minWidth: 44, minHeight: 44, padding: "9px 2px 8px",
                background: on ? "#0A0818" : "transparent",
                border: "none", cursor: "pointer",
                borderBottom: `3px solid ${on ? "#F59E0B" : "transparent"}`,
                color: on ? "#F59E0B" : "#A8A3C4",
                fontSize: 8, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                fontFamily: "inherit", transition: "all .1s",
              }}>
                <span style={{ fontSize: 15, filter: on ? "drop-shadow(0 0 6px #F59E0BAA)" : "none", transition: "filter .1s" }}>{t.icon}</span>
                <span style={{ letterSpacing: 0.5 }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── Panel body ────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

          {/* BODY */}
          {tab === "body" && (
            <div>
              <SecHead title="CHOOSE BUILD" sub="Your silhouette defines your legend" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {BODY_TYPES.map(bt => {
                  const sel = config.bodyTypeId === bt.id;
                  return (
                    <button key={bt.id} onClick={() => onConfigChange("bodyTypeId", bt.id)} style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                      padding: "14px 8px 10px", borderRadius: 12, cursor: "pointer",
                      border: `2px solid ${sel ? "#F59E0B" : "#0C0C1E"}`,
                      background: sel ? "#1A0D00" : "#07070D",
                      boxShadow: sel ? "0 0 22px #F59E0B22" : "none",
                      fontFamily: "inherit", transition: "all .15s",
                    }}>
                      <div style={{ fontSize: 48, lineHeight: 1, filter: sel ? "drop-shadow(0 0 8px #F59E0B88)" : "opacity(.55)", transition: "filter .15s" }}>
                        {bt.emoji}
                      </div>
                      <div style={{ fontSize: 8, color: sel ? "#F59E0B" : "#A8A3C4", textAlign: "center", lineHeight: 1.8, fontFamily: "inherit" }}>{bt.label}</div>
                      <div style={{ fontSize: 8, color: sel ? "#D9A441" : "#A8A3C4", textAlign: "center", lineHeight: 1.5 }}>{bt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SKIN */}
          {tab === "skin" && (
            <div>
              <SecHead title="SKIN TONE" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {LIB_SKIN_TONES.map(s => {
                  const sel = config.skinId === s.id;
                  return (
                    <div key={s.id} onClick={() => onConfigChange("skinId", s.id)} style={{
                      width: 58, height: 58, borderRadius: 10, cursor: "pointer", position: "relative",
                      background: `linear-gradient(145deg,${s.b},${s.d})`,
                      border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                      boxShadow: sel ? "0 0 16px #F59E0B66" : "none",
                      transition: "all .12s",
                    }}>
                      <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 8, color: "#fff", textShadow: "0 1px 3px #000", fontFamily: "inherit" }}>{s.label}</span>
                      {sel && <div style={{ position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#000", fontWeight: 900 }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* HAIR */}
          {tab === "hair" && (
            <div>
              <SecHead title="HAIR COLOR" />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {LIB_HAIR_COLORS.map(h => {
                  const sel = config.hairId === h.id;
                  return (
                    <div key={h.id} onClick={() => onConfigChange("hairId", h.id)} style={{
                      width: 58, height: 58, borderRadius: 10, cursor: "pointer", position: "relative",
                      background: `linear-gradient(145deg,${h.h},${h.c})`,
                      border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                      boxShadow: sel ? "0 0 16px #F59E0B66" : "none",
                      transition: "all .12s",
                    }}>
                      <span style={{ position: "absolute", bottom: 3, left: 0, right: 0, textAlign: "center", fontSize: 8, color: "#fff", textShadow: "0 1px 3px #000", fontFamily: "inherit" }}>{h.label}</span>
                      {sel && <div style={{ position: "absolute", top: -7, right: -7, width: 16, height: 16, borderRadius: "50%", background: "#F59E0B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#000", fontWeight: 900 }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FACE */}
          {tab === "face" && (
            <div>
              <SecHead title="FACE DETAILS" />
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 8, color: "#B9A5F0", marginBottom: 10, letterSpacing: 1 }}>👁 EYE COLOR</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {LIB_EYE_COLORS.map(e => {
                    const sel = config.eyeColorId === e.id;
                    return (
                      <div key={e.id} title={e.label} onClick={() => onConfigChange("eyeColorId", e.id)} style={{
                        width: 42, height: 42, borderRadius: "50%", cursor: "pointer",
                        background: `radial-gradient(circle at 35% 35%,${e.iris}CC,${e.iris})`,
                        border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                        boxShadow: sel ? `0 0 14px ${e.iris}88` : "none",
                        transition: "all .12s",
                      }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 8, color: "#A8A3C4", marginTop: 6 }}>{LIB_EYE_COLORS.find(e => e.id === config.eyeColorId)?.label ?? "Blue"}</div>
              </div>
              <div>
                <div style={{ fontSize: 8, color: "#B9A5F0", marginBottom: 10, letterSpacing: 1 }}>💋 LIP COLOR</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {LIB_LIP_COLORS.map(l => {
                    const sel = config.lipColorId === l.id;
                    return (
                      <div key={l.id} title={l.label} onClick={() => onConfigChange("lipColorId", l.id)} style={{
                        width: 42, height: 42, borderRadius: "50%", cursor: "pointer",
                        background: `radial-gradient(circle at 35% 35%,${l.color}CC,${l.color})`,
                        border: sel ? "3px solid #F59E0B" : "2px solid #0C0C1E",
                        boxShadow: sel ? `0 0 14px ${l.color}88` : "none",
                        transition: "all .12s",
                      }} />
                    );
                  })}
                </div>
                <div style={{ fontSize: 8, color: "#A8A3C4", marginTop: 6 }}>{LIB_LIP_COLORS.find(l => l.id === config.lipColorId)?.label ?? "Natural"}</div>
              </div>
            </div>
          )}

          {/* OUTFIT */}
          {tab === "outfit" && (
            <div>
              <SecHead title="OUTFIT" sub={female ? "♀ Fitted for your body type" : undefined} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visOuts.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.armorId === o.id}
                    onClick={() => onConfigChange("armorId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.armorId === o.id)}
                    <span style={{ fontSize: 8, color: config.armorId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.hint && <span style={{ fontSize: 8, color: config.armorId === o.id ? "#D9A441" : "#A8A3C4", textAlign: "center", lineHeight: 1.4 }}>{o.hint}</span>}
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* HEADGEAR */}
          {tab === "headgear" && (
            <div>
              <SecHead title="HEADGEAR" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visHeads.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.headId === o.id}
                    onClick={() => onConfigChange("headId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.headId === o.id)}
                    <span style={{ fontSize: 8, color: config.headId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* WEAPON */}
          {tab === "weapon" && (
            <div>
              <SecHead title="WEAPON" sub="✦✦ marks dual-wield weapons" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visWeapons.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.weaponId === o.id}
                    onClick={() => onConfigChange("weaponId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.weaponId === o.id)}
                    <span style={{ fontSize: 8, color: config.weaponId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.hint && <span style={{ fontSize: 8, color: "#F0A04B", background: "#1A0800", padding: "2px 5px", borderRadius: 4 }}>{o.hint}</span>}
                  </Opt>
                ))}
              </div>
            </div>
          )}

          {/* PET */}
          {tab === "pet" && (
            <div>
              <SecHead title="PET / MOUNT" sub="Companions walk beside you · Mounts carry you" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {visPets.map(o => (
                  <Opt key={o.id} id={o.id} selected={config.petId === o.id}
                    onClick={() => onConfigChange("petId", o.id)}
                    onHoverEnter={() => setHoveredId(o.id || null)}
                    onHoverLeave={() => setHoveredId(null)}>
                    {spriteBox(o.id, config.petId === o.id)}
                    <span style={{ fontSize: 8, color: config.petId === o.id ? "#F59E0B" : "#5A4A7A", textAlign: "center", lineHeight: 1.6 }}>{o.label}</span>
                    {o.size === "mount" && (
                      <span style={{ fontSize: 8, color: "#E0A83A", background: "#1C1000", padding: "2px 5px", borderRadius: 4, border: "1px solid #3A2000" }}>MOUNT</span>
                    )}
                    {o.size === "companion" && (
                      <span style={{ fontSize: 8, color: "#34D399", background: "#001A0E", padding: "2px 5px", borderRadius: 4, border: "1px solid #003A1A" }}>COMPANION</span>
                    )}
                  </Opt>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes hf-float   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes hf-pulse   { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes hf-runespin { to { transform: rotate(360deg); } }
        @keyframes hf-aurora1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,-30px)} }
        @keyframes hf-aurora2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-50px,40px)} }
        ::-webkit-scrollbar { width:3px }
        ::-webkit-scrollbar-thumb { background:#0E0E1E;border-radius:2px }
      `}</style>
    </div>
  );
}