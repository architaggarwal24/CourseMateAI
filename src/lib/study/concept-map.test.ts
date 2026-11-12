import { describe, expect, it } from "vitest";
import { heatLabel, layoutMindMap, MIND_MORE, MIND_ROOT, mindLabel, neighbours, type MapConcept, type MapRelation, type MindNode } from "./concept-map";

const c = (id: string, importance = 2, heat: MapConcept["heat"] = "new"): MapConcept => ({
  id, name: id.toUpperCase(), summary: "", importance, pages: [], docs: [], heat, seen: 0, correct: 0,
});
const CONCEPTS = [c("atp", 3), c("mito", 3), c("glyco"), c("krebs"), c("etc"), c("nadh", 1), c("osmo", 1), c("membrane")];
const REL: MapRelation[] = [
  { source: "mito", target: "atp", label: "makes" }, { source: "glyco", target: "atp", label: "yields" },
  { source: "krebs", target: "nadh", label: "makes" }, { source: "etc", target: "atp", label: "drives" },
  { source: "krebs", target: "mito", label: "inside" }, { source: "osmo", target: "membrane", label: "crosses" },
];
const byId = (nodes: MindNode[]) => new Map(nodes.map((n) => [n.id, n]));
const overlap = (a: MindNode, b: MindNode) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

describe("mind map layout", () => {
  it("puts the subject in the middle and the central concepts as its main ideas", () => {
    const m = byId(layoutMindMap("Biology", CONCEPTS, REL).nodes);
    expect(m.get(MIND_ROOT)).toMatchObject({ depth: 0, name: "Biology", parent: null });
    expect(m.get("atp")).toMatchObject({ depth: 1, parent: MIND_ROOT });
    expect(m.get("mito")).toMatchObject({ depth: 1, parent: MIND_ROOT });
    // each concept hangs off the main idea it is linked to
    expect(m.get("glyco")!.parent).toBe("atp");
    expect(m.get("krebs")!.parent).toBe("mito");
    expect(m.get("nadh")).toMatchObject({ parent: "krebs", depth: 3, branch: m.get("mito")!.branch });
    // a group linked to no central concept gets its own main idea
    expect(m.get("membrane")).toMatchObject({ depth: 1 });
    expect(m.get("osmo")!.parent).toBe("membrane");
  });

  it("uses both sides, keeps every pill apart, and keeps each detail outward of its parent", () => {
    const { nodes, width, height } = layoutMindMap("Biology", CONCEPTS, REL);
    const m = byId(nodes);
    const root = m.get(MIND_ROOT)!;
    expect(new Set(nodes.filter((n) => n.depth === 1).map((n) => n.side))).toEqual(new Set([1, -1]));
    for (const a of nodes) for (const b of nodes) if (a !== b) expect(overlap(a, b), `${a.id} / ${b.id}`).toBe(false);
    for (const n of nodes) {
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(width);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(height);
      if (n.parent) {
        const p = m.get(n.parent)!;
        expect(Math.sign(n.x - (n.parent === MIND_ROOT ? root.x : p.x))).toBe(n.side);
      }
    }
  });

  it("is the same whatever order the relations come in", () => {
    const strip = (nodes: MindNode[]) => nodes.map((n) => `${n.id}:${n.parent}:${n.x},${n.y}`).sort();
    expect(strip(layoutMindMap("B", CONCEPTS, REL).nodes)).toEqual(strip(layoutMindMap("B", CONCEPTS, [...REL].reverse()).nodes));
  });

  it("gathers concepts linked to nothing under 'More ideas' when there are several", () => {
    const m = byId(layoutMindMap("B", [c("a", 3), c("b"), c("x", 1), c("y", 1), c("z", 1)], [{ source: "a", target: "b", label: "" }]).nodes);
    expect(m.get(MIND_MORE)).toMatchObject({ depth: 1, name: "More ideas" });
    expect(["x", "y", "z"].map((id) => m.get(id)!.parent)).toEqual([MIND_MORE, MIND_MORE, MIND_MORE]);
    const few = byId(layoutMindMap("B", [c("a", 3), c("x", 1)], []).nodes);
    expect(few.has(MIND_MORE)).toBe(false);
    expect(few.get("x")!.depth).toBe(1);
  });

  it("an umbrella idea linked to most main ideas goes in the middle, and its other links become main ideas", () => {
    const list = [c("unsup", 3), c("clust", 3), c("dimred", 3), c("assoc", 3), c("kmeans"), c("pca"), c("anomaly")];
    const rel = [["unsup", "clust"], ["unsup", "dimred"], ["unsup", "assoc"], ["clust", "kmeans"], ["dimred", "pca"], ["unsup", "anomaly"]]
      .map(([source, target]) => ({ source, target, label: "" }));
    const layout = layoutMindMap("Machine Learning", list, rel);
    const m = byId(layout.nodes);
    expect(layout.rootConcept).toBe("unsup");
    expect(m.get(MIND_ROOT)!.name).toBe("UNSUP");
    expect(m.has("unsup")).toBe(false);
    expect(["clust", "dimred", "assoc", "anomaly"].map((id) => m.get(id)!.depth)).toEqual([1, 1, 1, 1]);
    expect(m.get("kmeans")!.parent).toBe("clust");
    expect(layout.tree.has(["clust", "unsup"].sort().join("|"))).toBe(true);     // a branch, not a cross-link
    expect(layoutMindMap("B", CONCEPTS, REL).rootConcept).toBeNull();
  });

  it("copes with no concepts, and shortens very long names", () => {
    expect(layoutMindMap("B", [], []).nodes.map((n) => n.id)).toEqual([MIND_ROOT]);
    expect(mindLabel("x".repeat(60))).toHaveLength(34);
    expect(mindLabel("ATP")).toBe("ATP");
  });

  it("lists a concept's links", () => {
    expect(neighbours("atp", REL).sort()).toEqual(["etc", "glyco", "mito"]);
  });
});

it("names each heat in words", () => {
  expect(["new", "weak", "learning", "strong"].map((h) => heatLabel(h as MapConcept["heat"]))).toEqual(["Not tried yet", "Weak", "Learning", "Strong"]);
});
