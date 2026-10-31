"use client";

// Dev-only (next dev): every hero and creature in every animation, for checking sprites by eye.
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { BOSSES, BOSS_ANIMS } from "@/lib/pixel/bosses";
import { HEROES, heroAnims } from "@/lib/pixel/heroes";
import "@/components/arena/pixel/pixel.css";

export default function Page() {
  return (
    <div data-theme="play" style={{ background: "#0f0b24", padding: 24, minHeight: "100vh", display: "grid", gap: 24 }}>
      {HEROES.map((h) => (
        <div key={h.id} style={{ display: "flex", gap: 16, alignItems: "end" }}>
          {Object.keys(heroAnims(h.style)).map((a) => <PixelSprite key={a} hero={h} anim={a as never} label={`${h.name} ${a}`} className="" />)}
        </div>
      ))}
      {Object.values(BOSSES).map((b) => (
        <div key={b.id} style={{ display: "flex", gap: 16, alignItems: "end" }}>
          {Object.keys(BOSS_ANIMS).map((a) => <PixelSprite key={a} boss={b.id} anim={a as never} label={`${b.name} ${a}`} />)}
        </div>
      ))}
    </div>
  );
}
