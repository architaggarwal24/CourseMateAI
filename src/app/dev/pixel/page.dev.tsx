"use client";

// Dev-only (next dev): every hero and creature in every animation, every champion skin and every pet, for checking
// sprites by eye. (Static contact sheets of the skins: `npx jiti scripts/pixel-preview.ts`.)
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { BOSSES, BOSS_ANIMS } from "@/lib/pixel/bosses";
import { HEROES, heroAnims } from "@/lib/pixel/heroes";
import { PETS } from "@/lib/pixel/pets";
import { ARMOR_SKINS, HEAD_SKINS, WEAPON_SKINS, dressed } from "@/lib/pixel/skins";
import "@/components/arena/pixel/pixel.css";

const row = { display: "flex", gap: 16, alignItems: "end", flexWrap: "wrap" } as const;

export default function Page() {
  return (
    <div data-theme="play" style={{ background: "#0f0b24", padding: 24, minHeight: "100vh", display: "grid", gap: 24, color: "#ddd6fe" }}>
      {HEROES.map((h) => (
        <div key={h.id} style={row}>
          {Object.keys(heroAnims(h.style)).map((a) => <PixelSprite key={a} hero={h} anim={a as never} label={`${h.name} ${a}`} />)}
        </div>
      ))}
      {([["armor", ARMOR_SKINS], ["headgear", HEAD_SKINS], ["weapon", WEAPON_SKINS]] as const).map(([slot, skins]) => (
        <section key={slot}>
          <h2>{slot}</h2>
          {Object.keys(skins).map((id) => (
            <div key={id} style={row}>
              <code style={{ width: 180 }}>{id}</code>
              {HEROES.map((h) => <PixelSprite key={h.id} hero={dressed(h, { [slot]: id }, { weapon: slot === "weapon" ? "legendary" : null })} label={`${h.name} in ${id}`} />)}
            </div>
          ))}
        </section>
      ))}
      <section>
        <h2>pets</h2>
        <div style={row}>{Object.keys(PETS).map((id, i) => <PixelSprite key={id} hero={HEROES[i % HEROES.length]} pet={id} label={id} />)}</div>
      </section>
      {Object.values(BOSSES).map((b) => (
        <div key={b.id} style={row}>
          {Object.keys(BOSS_ANIMS).map((a) => <PixelSprite key={a} boss={b.id} anim={a as never} label={`${b.name} ${a}`} />)}
        </div>
      ))}
    </div>
  );
}
