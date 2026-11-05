import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { KitHud, MechanicHud as Mech, Outcome } from "@/lib/arena/types";
import Intent from "./Intent";
import MechanicHud from "./MechanicHud";
import UltimateMeter from "./UltimateMeter";
import { mechanicLines } from "./verdict";

afterEach(cleanup);

const base: Outcome = { question_id: 1, correct: true, timed_out: false, answer: "A", correct_answer: "A", damage_dealt: 10, damage_taken: 0, combo: 1 };
const KIT: KitHud = {
  champion: "vex", meter: 50, max: 100, ready: false, active: false, effects: {},
  passive: { name: "Slip", text: "Dodges some blows." }, ultimate: { name: "Shadowstep", text: "Vanish for two blows." },
};

describe("verdict lines for mechanics and kits", () => {
  it("says nothing extra on a plain answer", () => {
    expect(mechanicLines(base)).toEqual([]);
  });
  it("puts riposte first, then the creature's events and hearts, then the kit's", () => {
    const o: Outcome = {
      ...base, riposte: 4,
      mechanic: { id: "hydra", events: [{ type: "regrow", text: "A new head grows." }], boss_healed: 5, damage: 0, hearts: 1, focus: 0, shield: 0, illusion_picked: false, hud: null },
      kit: { events: [{ type: "combo", text: "Brak's rage builds." }], refund: 0, hud: KIT },
    };
    expect(mechanicLines(o)).toEqual(["Riposte! You hit back for 4.", "A new head grows.", "+1 heart.", "Brak's rage builds."]);
  });
  it("says a dodge once: by itself only when no event already says it", () => {
    expect(mechanicLines({ ...base, dodged: true })).toEqual(["You dodged the blow."]);
    const said: Outcome = { ...base, dodged: true, kit: { events: [{ type: "shadowstep", text: "You vanish." }], refund: 0, hud: KIT } };
    expect(mechanicLines(said)).toEqual(["You vanish."]);
  });
});

describe("<MechanicHud />", () => {
  const mech: Mech = {
    id: "fenrir", name: "Unchained Fury", summary: "Fury grows each wrong answer; right answers chain it.",
    counters: [{ label: "Fury", value: 2, max: 3, hint: "+1 damage each" }, { label: "Chains", text: "Loose" }], locked_moves: ["guard"],
  };
  it("names the mechanic, its rule and every counter in words and numbers", () => {
    render(<MechanicHud mechanic={mech} />);
    const hud = screen.getByRole("group", { name: "Creature mechanic: Unchained Fury" });
    expect(within(hud).getByText(mech.summary)).toBeTruthy();
    const counters = within(hud).getByRole("list", { name: "Unchained Fury counters" });
    expect(within(counters).getByText("2/3")).toBeTruthy();
    expect(within(counters).getByText("Loose")).toBeTruthy();
    expect(within(counters).getByText(": +1 damage each")).toBeTruthy();       // the hint, for screen readers
    expect(within(counters).getByText("Guard locked")).toBeTruthy();
  });
  it("compact mode drops the rule but keeps the counters; no mechanic renders nothing", () => {
    render(<MechanicHud mechanic={mech} compact />);
    expect(screen.queryByText(mech.summary)).toBeNull();
    expect(screen.getByText("2/3")).toBeTruthy();
    cleanup();
    const { container } = render(<MechanicHud mechanic={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("<UltimateMeter />", () => {
  it("shows the charge in words, and the button waits for a full meter", () => {
    const onCast = vi.fn();
    render(<UltimateMeter kit={KIT} onCast={onCast} />);
    const bar = screen.getByRole("progressbar", { name: "Ultimate: Shadowstep" });
    expect(bar.getAttribute("aria-valuetext")).toBe("50% charged");
    const btn = screen.getByRole("button", { name: /Shadowstep/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-keyshortcuts")).toBe("U");
  });
  it("ready: the button casts; active: it says on and is off", () => {
    const onCast = vi.fn();
    render(<UltimateMeter kit={{ ...KIT, meter: 100, ready: true }} onCast={onCast} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("Shadowstep ready");
    fireEvent.click(screen.getByRole("button", { name: /Shadowstep/ }));
    expect(onCast).toHaveBeenCalledTimes(1);
    cleanup();
    render(<UltimateMeter kit={{ ...KIT, meter: 0, ready: false, active: true }} onCast={onCast} />);
    const btn = screen.getByRole("button", { name: /Shadowstep/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("on");
  });
  it("compact mode is the bar alone", () => {
    render(<UltimateMeter kit={KIT} compact />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("<Intent /> for the creatures' special turns", () => {
  it("says the special move, how big it is and its counter", () => {
    render(<Intent intent={{ kind: "grab", name: "Tentacle Grab", value: 3, description: "", special: true }} />);
    const s = screen.getByRole("status");
    expect(s.getAttribute("aria-label")).toBe("Boss intent: Tentacle Grab, 3 ♥. ");
    expect(s.getAttribute("data-special")).toBe("true");
    expect(screen.getByText(/the move you used is locked/)).toBeTruthy();
  });
  it("a stunned boss and an aim show no damage", () => {
    render(<Intent intent={{ kind: "stunned", name: "Stunned", value: 0, description: "" }} />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Boss intent: Stunned. ");
    cleanup();
    render(<Intent intent={{ kind: "aim", name: "Takes Aim", value: 5, description: "Next turn it throws." }} />);
    expect(screen.getByRole("status").getAttribute("aria-label")).toBe("Boss intent: Takes Aim. Next turn it throws.");
  });
});
