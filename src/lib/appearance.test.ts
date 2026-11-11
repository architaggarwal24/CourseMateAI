// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CLOTH_COLORS, STARTER_LOOKS, appearanceKey, cleanAppearance, cleanLooks, starterLook } from "./appearance";

const CHAMPS = ["kaien", "asha", "brak", "mira", "vex", "thorne"];

describe("build your own: looks", () => {
  it("every champion has a starter look, and each one is valid", () => {
    expect(Object.keys(STARTER_LOOKS).sort()).toEqual([...CHAMPS].sort());
    for (const id of CHAMPS) expect(cleanAppearance(STARTER_LOOKS[id])).toEqual(STARTER_LOOKS[id]);
    expect(starterLook("nobody")).toEqual(STARTER_LOOKS.kaien);
    expect(starterLook("mira")).not.toBe(STARTER_LOOKS.mira);          // a copy: editing it can't change the original
  });

  it("refuses anything the engine can't draw, and drops extra fields", () => {
    const ok = { ...STARTER_LOOKS.vex, sneaky: "<script>" };
    expect(cleanAppearance(ok)).toEqual(STARTER_LOOKS.vex);
    expect(cleanAppearance({ ...STARTER_LOOKS.vex, hair: "mohawk" })).toBeNull();
    expect(cleanAppearance({ ...STARTER_LOOKS.vex, main: "#ff00ff" })).toBeNull();
    expect(cleanAppearance({ ...STARTER_LOOKS.vex, cape: "none", gloves: "none", scarf: "none" })).not.toBeNull();
    expect(cleanAppearance({ ...STARTER_LOOKS.vex, main: "none" })).toBeNull();      // "none" only where a piece is optional
    const { skin: _skin, ...missing } = STARTER_LOOKS.vex;
    expect(cleanAppearance(missing)).toBeNull();
    for (const bad of [null, "kaien", [], 7, { toString: 1 }]) expect(cleanAppearance(bad)).toBeNull();
    expect(cleanAppearance({ ...STARTER_LOOKS.vex, main: "constructor" })).toBeNull();
  });

  it("saved looks keep only real champions with valid looks", () => {
    const raw = { kaien: STARTER_LOOKS.mira, ghost: STARTER_LOOKS.mira, asha: { hair: "x" } };
    expect(cleanLooks(raw, CHAMPS)).toEqual({ kaien: STARTER_LOOKS.mira });
    expect(cleanLooks("nope", CHAMPS)).toEqual({});
  });

  it("the signature changes with any choice", () => {
    const a = STARTER_LOOKS.thorne;
    expect(appearanceKey(a)).toBe(appearanceKey({ ...a }));
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      const other = k === "cape" ? "none" : k === "main" ? "red" : undefined;
      if (other) expect(appearanceKey({ ...a, [k]: other })).not.toBe(appearanceKey(a));
    }
    expect(Object.keys(CLOTH_COLORS).length).toBeGreaterThanOrEqual(20);
  });
});
