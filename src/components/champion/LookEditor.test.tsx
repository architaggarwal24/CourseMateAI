import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useChampion } from "@/hooks/useChampion";
import { useMyHero } from "@/hooks/useMyHero";
import { DEFAULT_HERO_LOOK, STARTER_LOOKS, cleanAppearance } from "@/lib/game/appearance";
import LookEditor, { randomLook } from "./LookEditor";
import { heroView } from "./hero-fixture";

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); useChampion.getState().reset(); useMyHero.getState().reset(); });

describe("your hero's look", () => {
  it("starts from the default look; nothing saves until Save, and Save stores the draft", async () => {
    const saveLook = vi.fn().mockResolvedValue(true);
    useMyHero.setState({ view: heroView(), saveLook });
    const onClose = vi.fn();
    render(<LookEditor open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Your hero's look" });
    const save = within(dialog).getByRole("button", { name: "Save look" });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("tab", { name: "Hair" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Topknot" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Outfit" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Main colour: Crimson" }));
    fireEvent.click(within(dialog).getByRole("tab", { name: "Extras" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cape: Royal" }));
    expect(saveLook).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(saveLook).toHaveBeenCalledWith({ ...DEFAULT_HERO_LOOK, hair: "topknot", main: "crimson", cape: "royal" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a champion's look is locked until that champion is mastered; then it can be copied", async () => {
    const saveLook = vi.fn().mockResolvedValue(true);
    useChampion.setState({ progress: { kaien: { mastery_pct: 42 } as never } });
    useMyHero.setState({ view: heroView({ look: { ...STARTER_LOOKS.mira, hair: "spiky" }, looks_unlocked: ["mira"] }), saveLook });
    render(<LookEditor open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Start" }));
    const kaien = within(dialog).getByRole("button", { name: "Kaien: unlocks at 100% mastery (42%)" });
    expect(kaien.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mira" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save look" }));
    await waitFor(() => expect(saveLook).toHaveBeenCalledWith(STARTER_LOOKS.mira));
  });

  it("every colour and choice is a labelled toggle (no colour-only meaning)", () => {
    useMyHero.setState({ view: heroView() });
    render(<LookEditor open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    for (const tab of ["Start", "Body", "Hair", "Outfit", "Extras"]) {
      fireEvent.click(within(dialog).getByRole("tab", { name: tab }));
      const toggles = within(dialog).getAllByRole("button").filter((x) => x.hasAttribute("aria-pressed"));
      expect(toggles.length).toBeGreaterThan(2);
      for (const b of toggles) expect(b.getAttribute("aria-label") || b.textContent).toBeTruthy();
    }
  });

  it("Surprise me always makes a look the server accepts", () => {
    for (let i = 0; i < 200; i++) {
      const a = randomLook();
      expect(cleanAppearance(a)).toEqual(a);
      expect(a.main).not.toBe(a.second);
    }
  });
});
