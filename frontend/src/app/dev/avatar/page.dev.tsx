"use client";
// Dev only (a "page.dev.tsx" is a route only while `next dev` runs): every piece of hero art on one page.
import { HeroFigure, ItemIcon } from "@/components/avatar";
import ThemeScope from "@/components/ThemeScope";
import { DEFAULT_LOOK, BODY_TYPES, type Look } from "@/lib/avatar/look";

const OUTFITS = ["armor_gi_white", "armor_gi_red", "armor_gi_blue", "armor_shirt_basic", "armor_hoodie_gray", "armor_robe_blue", "armor_jacket_cool", "armor_wizard_purple", "armor_knight_silver", "armor_knight_gold", "armor_dragon_scale", "armor_legends_mantle"];
const HATS = ["hat_headband_red", "hat_headband_blue", "hat_headband_white", "hat_baseball_red", "hat_beanie_blue", "hat_headphones", "hat_wizard", "hat_crown_bronze", "hat_crown_silver", "hat_crown_gold", "hat_ninja", "hat_samurai"];
const WEAPONS = ["weapon_pencil", "weapon_ruler", "weapon_sword_bronze", "weapon_sword_silver", "weapon_sword_excalibur", "weapon_bow", "weapon_staff_wood", "weapon_hammer", "weapon_staff_crystal", "weapon_staff_legendary"];
const PETS = ["pet_cat_orange", "pet_dog_brown", "pet_owl", "pet_panda", "pet_fox", "pet_unicorn", "pet_dragon_baby", "pet_phoenix", "pet_lion_golden", "pet_dragon_ancient"];
const POTIONS = ["potion_health_small", "fifty_fifty", "potion_xp_boost", "potion_coin_boost", "potion_streak_shield", "potion_xp_boost_2h", "potion_quest_reset"];

const look = (o: Partial<Look>): Look => ({ ...DEFAULT_LOOK, ...o });

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ marginBottom: 24 }}><h2 style={{ fontSize: 14, margin: "0 0 8px", color: "#9ba2af" }}>{title}</h2><div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{children}</div></section>;
}

export default function AvatarGallery() {
  return (
    <ThemeScope theme="play">
      <div style={{ padding: 24, background: "#15122a", color: "#eceef2", minHeight: "100vh" }}>
        <Row title="body types × skin / hair / eyes">
          {BODY_TYPES.map((t, i) => <HeroFigure key={t.id} look={look({ bodyTypeId: t.id, skinId: ["ivory", "tan", "brown", "deep"][i], hairId: ["black", "honey", "violet", "scarlet"][i], eyeColorId: ["blue", "green", "amber", "violet"][i] })} size={170} />)}
        </Row>
        <Row title="poses">
          {(["idle", "attack", "hurt", "victory", "defeat"] as const).map((p) => <HeroFigure key={p} pose={p} look={look({ armorId: "armor_knight_silver", weaponId: "weapon_sword_silver", headId: "hat_samurai", petId: "pet_fox" })} size={170} />)}
        </Row>
        <Row title="outfits (male_default / female_elegant)">
          {OUTFITS.map((o, i) => <HeroFigure key={o} look={look({ armorId: o, bodyTypeId: i % 2 ? "female_elegant" : i % 3 ? "male_athletic" : "male_default" })} size={130} />)}
        </Row>
        <Row title="outfit icons">{OUTFITS.map((o) => <ItemIcon key={o} itemId={o} size={80} />)}</Row>
        <Row title="hats on heroes">{HATS.map((h, i) => <HeroFigure key={h} look={look({ headId: h, bodyTypeId: i % 2 ? "female_sporty" : "male_default" })} size={120} />)}</Row>
        <Row title="hat icons">{HATS.map((h) => <ItemIcon key={h} itemId={h} size={80} />)}</Row>
        <Row title="weapons held">{WEAPONS.map((w, i) => <HeroFigure key={w} look={look({ weaponId: w, armorId: "armor_gi_white", bodyTypeId: i % 2 ? "female_elegant" : "male_athletic" })} size={130} />)}</Row>
        <Row title="weapon icons">{WEAPONS.map((w) => <ItemIcon key={w} itemId={w} size={80} />)}</Row>
        <Row title="pets">{PETS.map((p) => <HeroFigure key={p} look={look({ petId: p, armorId: "armor_hoodie_gray" })} size={130} />)}</Row>
        <Row title="pet icons">{PETS.map((p) => <ItemIcon key={p} itemId={p} size={80} />)}</Row>
        <Row title="potions">{POTIONS.map((p) => <ItemIcon key={p} itemId={p} size={64} />)}</Row>
      </div>
    </ThemeScope>
  );
}
