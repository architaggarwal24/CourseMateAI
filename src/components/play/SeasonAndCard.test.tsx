import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/arena", useSearchParams: () => new URLSearchParams("") }));

import SeasonBanner, { SeasonTeaser } from "./SeasonBanner";
import AdventurerCard, { cardLines } from "./AdventurerCard";
import { activeSeason, SEASONS } from "@/lib/game/seasons";

const SEASON = { ok: true, season: { id: "finals", name: "Finals Week", tagline: "The Exam Warden rises.", boss: "sphinx", boss_name: "The Exam Warden", stage: "exam-hall", tint: "#fde68a", reward: { xp: 200, coins: 250 } },
  ready: true, concepts: ["ATP", "DNA", "RNA"], needed: 3, beaten: false };
const CARD = { ok: true, name: "archit", champion: "kaien", level: 7, streak: 4, power: 58, survival_best: 7, rush_wins: 1,
  bestiary: { beaten: 5, total: 13 }, achievements: { unlocked: 9, total: 30, recent: ["First Blood", "Scholar"] } };
let body: unknown = SEASON;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("seasonal events (two worlds, Stage 7)", () => {
  it("the dates: Finals Week in December and late April to May, Lantern Night at the end of October; none in between", () => {
    expect(activeSeason(new Date(2026, 11, 5))?.id).toBe("finals");
    expect(activeSeason(new Date(2027, 4, 1))?.id).toBe("finals");
    expect(activeSeason(new Date(2026, 9, 31))?.id).toBe("lanterns");
    expect(activeSeason(new Date(2026, 10, 12))).toBeNull();
    expect(SEASONS.find((s) => s.id === "finals")!.stage).toBe("exam-hall");
  });

  it("the hub's banner: the event, its boss, and Face it when you've studied enough this month", async () => {
    body = SEASON;
    const onFace = vi.fn();
    render(<SeasonBanner sessionId="d1" onFace={onFace} />);
    expect(await screen.findByRole("region", { name: "Finals Week" })).toBeTruthy();
    expect(screen.getByText(/The Exam Warden waits\. Win for \+200 XP and 250 coins/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Face The Exam Warden/ }));
    expect(onFace).toHaveBeenCalled();
    cleanup();
    body = { ...SEASON, ready: false, concepts: ["ATP"] };
    render(<SeasonBanner sessionId="d1" onFace={onFace} />);
    expect(await screen.findByText(/Study at least 3 concepts this month \(1\/3\)/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    body = { ok: true, season: null };
    render(<><SeasonBanner sessionId="d1" onFace={onFace} /><SeasonTeaser sessionId="d1" /></>);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("the Adventurer card (two worlds, Stage 7)", () => {
  it("shows who you are in the Hero world, and downloads as an image", async () => {
    body = CARD;
    expect(cardLines(CARD).map(([k]) => k)).toEqual(["Level", "Power", "Best Survival", "Boss Rush", "Bestiary", "Achievements", "Streak"]);
    render(<AdventurerCard />);
    const card = await screen.findByTestId("adventurer-card");
    expect(card.textContent).toContain("archit");
    expect(card.textContent).toContain("7 bosses");
    expect(card.textContent).toContain("5/13 hunted");
    expect(card.textContent).toContain("Latest: First Blood · Scholar");
    // drawing: a 2D context that records what it drew, and a blob for the file
    const drawn: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : k === "fillText" ? (s: string) => drawn.push(s)
      : k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => undefined), set: (t, k, v) => { t[k as string] = v; return true; } });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) { cb(new Blob(["png"], { type: "image/png" })); });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:card", revokeObjectURL: () => {} }));
    fireEvent.click(screen.getByRole("button", { name: /Download as image/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(drawn).toEqual(expect.arrayContaining(["ADVENTURER", "archit", "LEVEL", "7", "BEST SURVIVAL", "7 bosses"]));
  });
});
