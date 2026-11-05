import { describe, expect, it } from "vitest";
import { heatLabel, layoutConstellation, neighbours, starInDirection, type MapConcept, type MapRelation } from "./conceptMap";

const c = (id: string, importance = 2, heat: MapConcept["heat"] = "new"): MapConcept => ({
  id, name: id.toUpperCase(), summary: "", importance, pages: [], docs: [], heat, seen: 0, correct: 0,
});
const CONCEPTS = [c("atp", 3), c("mito", 3), c("glyco"), c("krebs"), c("etc"), c("nadh", 1), c("osmo", 1)];
const REL: MapRelation[] = [
  { source: "mito", target: "atp", label: "makes" }, { source: "glyco", target: "atp", label: "yields" },
  { source: "krebs", target: "nadh", label: "makes" }, { source: "etc", target: "atp", label: "drives" },
  { source: "krebs", target: "mito", label: "inside" },
];

describe("constellation layout", () => {
  it("is deterministic: the same map always draws the same sky", () => {
    expect(layoutConstellation(CONCEPTS, REL)).toEqual(layoutConstellation([...CONCEPTS].reverse(), [...REL].reverse()));
  });

  it("keeps every star inside the frame and apart from the others", () => {
    const at = layoutConstellation(CONCEPTS, REL);
    const pts = Object.values(at);
    expect(pts).toHaveLength(CONCEPTS.length);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0.06); expect(p.x).toBeLessThanOrEqual(0.94);
      expect(p.y).toBeGreaterThanOrEqual(0.08); expect(p.y).toBeLessThanOrEqual(0.92);
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.09);
    }
  });

  it("puts the central concepts nearer the middle than the supporting ones", () => {
    const at = layoutConstellation(CONCEPTS, REL);
    const r = (id: string) => Math.hypot(at[id].x - 0.5, at[id].y - 0.5);
    expect(Math.max(r("atp"), r("mito"))).toBeLessThan(Math.min(r("nadh"), r("osmo")));
  });

  it("fits a full map (24 concepts, 40 links) without crowding", () => {
    const many = Array.from({ length: 24 }, (_, i) => c(`k${i}`, [3, 2, 2, 1][i % 4]));
    const links = Array.from({ length: 40 }, (_, i) => ({ source: `k${i % 24}`, target: `k${(i * 7 + 3) % 24}`, label: "" }));
    const pts = Object.values(layoutConstellation(many, links));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(0.09);
    }
  });

  it("handles one star and none", () => {
    expect(layoutConstellation([], [])).toEqual({});
    expect(layoutConstellation([c("solo", 3)], [])).toEqual({ solo: { x: 0.5, y: 0.5 } });
  });
});

describe("moving between stars with the arrow keys", () => {
  const at = { a: { x: 0.5, y: 0.5 }, right: { x: 0.8, y: 0.52 }, up: { x: 0.48, y: 0.2 }, far: { x: 0.9, y: 0.9 }, left: { x: 0.1, y: 0.5 } };
  const links: MapRelation[] = [{ source: "a", target: "right", label: "" }, { source: "up", target: "a", label: "" }];

  it("lists a star's linked stars", () => {
    expect(neighbours("a", links).sort()).toEqual(["right", "up"]);
  });

  it("prefers a linked star in that direction, then any star there, else stays", () => {
    expect(starInDirection("a", "ArrowRight", at, links)).toBe("right");
    expect(starInDirection("a", "ArrowUp", at, links)).toBe("up");
    expect(starInDirection("a", "ArrowLeft", at, links)).toBe("left");          // not linked, but the only one left
    expect(starInDirection("left", "ArrowLeft", at, links)).toBe("left");       // nothing further: stays
    expect(starInDirection("a", "ArrowDown", at, links)).toBe("far");
  });
});

it("names each heat in words", () => {
  expect(["new", "weak", "learning", "strong"].map((h) => heatLabel(h as MapConcept["heat"]))).toEqual(["Not tried yet", "Weak", "Learning", "Strong"]);
});
