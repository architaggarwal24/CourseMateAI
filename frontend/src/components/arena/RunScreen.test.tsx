import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

vi.mock("@/hooks/useHero", () => ({ useHeroStore: Object.assign(() => null, { getState: () => ({ reconcile: vi.fn() }) }) }));
import RunScreen from "./RunScreen";

const RUN = {
  run_id: "r1", status: "active", session_id: "s1", difficulty: "medium", act: 1, acts_total: 3,
  acts: [{ title: "Cells", topic: "cells" }, { title: "Genes", topic: "genes" }, { title: "Energy", topic: "energy" }], act_title: "Cells",
  map: { act: 1, boss: "1-boss", nodes: [
    { id: "1-0-0", layer: 0, index: 0, kind: "battle", edges: ["1-boss"] },
    { id: "1-0-1", layer: 0, index: 1, kind: "battle", edges: ["1-boss"] },
    { id: "1-boss", layer: 1, index: 0, kind: "boss", edges: [] },
  ] },
  node_id: null, visited: [], reachable: ["1-0-0", "1-0-1"], hearts: 10, max_hearts: 10, gold: 0, relics: [],
  focus_cap: 5, act_focus_bonus: 0, pending: null, battle_id: null, depth: 0, battles_won: 0, score: 0,
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Expedition", () => {
  it("shows the act's map; reachable places can be travelled to, and a fight node opens its battle", async () => {
    const travelled: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      if (path === "/arena/runs/active") return json(200, { ok: true, run: RUN });
      if (path === "/arena/runs/r1/travel") {
        travelled.push(await bodyOf(input, init));
        return json(200, { ok: true, run: { ...RUN, node_id: "1-0-0", reachable: [], battle_id: "b9" }, node: RUN.map.nodes[0], battle_id: "b9" });
      }
      return json(404, { error: { code: "not_found", message: path, action: null, details: null } });
    }));
    const onBattle = vi.fn();
    render(<RunScreen sessionId="s1" onBattle={onBattle} onBack={() => {}} />);
    await screen.findByRole("heading", { name: "Cells" });
    const boss = screen.getByRole("button", { name: /Act boss \(out of reach\)/ }) as HTMLButtonElement;
    expect(boss.disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^Battle\. / })[0]);
    await waitFor(() => expect(onBattle).toHaveBeenCalledWith("b9"));
    expect(travelled).toEqual([{ node_id: "1-0-0" }]);
  });

  it("offers a relic choice and sends the pick", async () => {
    const chosen: unknown[] = [];
    const pending = { kind: "relic", node_id: "1-0-0", options: ["aegis", "quill"], then: null,
      relics: [{ id: "aegis", name: "Aegis", description: "Blocks a wrong answer.", rarity: "rare" }, { id: "quill", name: "Quill", description: "Jab +2 Focus.", rarity: "common" }] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      if (path === "/arena/runs/active") return json(200, { ok: true, run: { ...RUN, reachable: [], pending } });
      if (path === "/arena/runs/r1/choose") { chosen.push(await bodyOf(input, init)); return json(200, { ok: true, run: { ...RUN, relics: [pending.relics[0]] }, outcome: {} }); }
      return json(404, { error: { code: "not_found", message: path, action: null, details: null } });
    }));
    render(<RunScreen sessionId="s1" onBattle={() => {}} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Aegis/ }));
    await waitFor(() => expect(chosen).toEqual([{ action: "take", target: "aegis" }]));
    await screen.findByRole("list", { name: "Relics" });
  });
});
