import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DEFAULT_LOOK, BODY_TYPES, SKIN_TONES, HAIR_COLORS, lookFromEquipped } from "@/lib/avatar/look";
import { gearChips, totalGear } from "@/lib/gear";
import { GearChips, HeroFace, HeroFigure, ItemIcon, kindOf } from ".";

const shop = JSON.parse(readFileSync(resolve(process.cwd(), "../backend/content/shop.json"), "utf8"));
const allItems: Array<{ id: string; category: string; battle?: Record<string, number> }> = [];
for (const tier of shop.tiers) for (const it of tier.items) allItems.push({ ...it, category: tier.category });

describe("the vector hero", () => {
  it("draws every body type in every skin and hair colour, as an accessible image", () => {
    for (const b of BODY_TYPES) for (const s of SKIN_TONES) for (const h of HAIR_COLORS) {
      const { container, unmount } = render(<HeroFigure look={{ ...DEFAULT_LOOK, bodyTypeId: b.id, skinId: s.id, hairId: h.id }} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.querySelectorAll("path,ellipse,rect,circle").length).toBeGreaterThan(10);
      unmount();
    }
  });

  it("wears every piece of gear the shop sells", () => {
    const worn = allItems.filter((i) => ["armor", "headgear", "weapon", "pet"].includes(i.category));
    expect(worn.length).toBeGreaterThan(30);
    for (const item of worn) {
      const slot = { armor: "armorId", headgear: "headId", weapon: "weaponId", pet: "petId" }[item.category]!;
      const { container, unmount } = render(<HeroFigure look={{ ...DEFAULT_LOOK, [slot]: item.id }} />);
      const base = render(<HeroFigure look={DEFAULT_LOOK} />);
      expect(container.innerHTML, item.id).not.toBe(base.container.innerHTML);
      base.unmount();
      unmount();
    }
  });

  it("has a picture for every item that can have one, and none for titles", () => {
    for (const item of allItems) {
      const { container, unmount } = render(<ItemIcon itemId={item.id} />);
      const drawn = container.querySelectorAll("path,ellipse,rect,circle,polygon").length;
      if (item.id.startsWith("title_")) expect(kindOf(item.id)).toBe("none");
      else if (!["quest", "scroll", "hint", "gem", "coin"].some((w) => item.id.includes(w))) expect(drawn, item.id).toBeGreaterThan(0);
      unmount();
    }
  });

  it("changes the posture and the face with the pose", () => {
    for (const pose of ["idle", "attack", "hurt", "victory", "defeat"] as const) {
      const { container, unmount } = render(<HeroFigure look={DEFAULT_LOOK} pose={pose} />);
      expect(container.querySelector("svg")!.getAttribute("data-pose")).toBe(pose);
      unmount();
    }
  });

  it("shows a round head-and-shoulders portrait", () => {
    const { container } = render(<HeroFace look={DEFAULT_LOOK} diameter={40} />);
    expect((container.firstElementChild as HTMLElement).style.width).toBe("40px");
  });

  it("maps the API's equipped slots to a look, with defaults", () => {
    expect(lookFromEquipped({})).toEqual(DEFAULT_LOOK);
    expect(lookFromEquipped({ armor: "armor_dragon_scale", headgear: "hat_wizard", weapon: "weapon_bow", pet: "pet_fox", hair_id: "silver" })).toMatchObject({
      armorId: "armor_dragon_scale", headId: "hat_wizard", weaponId: "weapon_bow", petId: "pet_fox", hairId: "silver",
    });
  });
});

describe("gear stats", () => {
  it("lists only the effects an item has", () => {
    expect(gearChips({ damage_pct: 0.12 }).map((c) => c.value)).toEqual(["+12%"]);
    expect(gearChips({}).length).toBe(0);
    const { container } = render(<GearChips stats={{ hp: 3, time_sec: 5 }} />);
    expect(container.textContent).toContain("Hearts+3");
    expect(container.textContent).toContain("Time+5s");
    expect(render(<GearChips stats={undefined} />).container.innerHTML).toBe("");
  });

  it("adds a loadout up the way the server does", () => {
    expect(totalGear([{ battle: { damage_pct: 0.1, hp: 1 } }, { battle: { damage_pct: 0.05, strike: 4 } }, undefined])).toEqual({ damage_pct: 0.15, hp: 1, time_sec: 0, strike: 4 });
  });
});
