import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), rawApi: { GET: api.GET, PUT: api.PUT } }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

import { CHAMPION_CACHE_KEY, LEGACY_HERO_KEY, useChampion } from "./useChampion";

const res = (data: any, ok = true, status = 200) => ({ data: ok ? data : undefined, error: ok ? undefined : data, response: { ok, status } });
const server = (over: Record<string, any> = {}) => ({
  champion_id: "kaien", chosen: false, champions: ["kaien", "asha", "brak", "mira", "vex", "thorne"],
  loadout: { armor: null, headgear: null, weapon: null, pet: null }, ...over,
});

beforeEach(() => {
  localStorage.clear();
  api.GET.mockReset(); api.PUT.mockReset();
  Object.values(toasts).forEach((f) => f.mockReset());
  useChampion.getState().reset();
});

describe("useChampion", () => {
  it("shows the default champion until the server answers, then the account's champion", async () => {
    expect(useChampion.getState().championId).toBe("kaien");
    api.GET.mockResolvedValue(res(server({ champion_id: "mira", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(api.GET).toHaveBeenCalledWith("/avatar/champion");
    expect(useChampion.getState()).toMatchObject({ championId: "mira", chosen: true, loaded: true });
  });

  it("keeps the champion in localStorage only as a cache", async () => {
    api.GET.mockResolvedValue(res(server({ champion_id: "vex", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(JSON.parse(localStorage.getItem(CHAMPION_CACHE_KEY)!).state.championId).toBe("vex");
    // the server wins over a stale cache on the next load
    api.GET.mockResolvedValue(res(server({ champion_id: "thorne", chosen: true })));
    await useChampion.getState().load({ signedIn: true, force: true });
    expect(useChampion.getState().championId).toBe("thorne");
  });

  it("moves a Phase-2 browser pick to the account once, if the account has not chosen yet", async () => {
    localStorage.setItem(LEGACY_HERO_KEY, JSON.stringify({ state: { heroId: "asha" }, version: 0 }));
    api.GET.mockResolvedValue(res(server({ champion_id: "brak", chosen: false })));
    api.PUT.mockResolvedValue(res(server({ champion_id: "asha", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(api.PUT).toHaveBeenCalledWith("/avatar/champion", { body: { champion_id: "asha" } });
    expect(useChampion.getState()).toMatchObject({ championId: "asha", chosen: true });
    expect(localStorage.getItem(LEGACY_HERO_KEY)).toBeNull();
  });

  it("never lets an old browser pick override a champion the player chose on the server", async () => {
    localStorage.setItem(LEGACY_HERO_KEY, JSON.stringify({ state: { heroId: "asha" }, version: 0 }));
    api.GET.mockResolvedValue(res(server({ champion_id: "mira", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(api.PUT).not.toHaveBeenCalled();
    expect(useChampion.getState().championId).toBe("mira");
    expect(localStorage.getItem(LEGACY_HERO_KEY)).toBeNull();
  });

  it("saves a choice on the server, at once on screen, and puts it back if the server refuses", async () => {
    api.GET.mockResolvedValue(res(server({ champion_id: "kaien", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    let release!: (v: unknown) => void;
    api.PUT.mockReturnValue(new Promise((r) => { release = r; }));
    const saving = useChampion.getState().choose("thorne");
    expect(useChampion.getState().championId).toBe("thorne");          // optimistic
    release(res({ error: { code: "unknown_champion", message: "no" } }, false, 422));
    expect(await saving).toBe(false);
    expect(useChampion.getState().championId).toBe("kaien");
    expect(toasts.apiError).toHaveBeenCalled();
  });

  it("works locally for a visitor (no account to save to)", async () => {
    await useChampion.getState().load({ signedIn: false });
    expect(api.GET).not.toHaveBeenCalled();
    expect(await useChampion.getState().choose("vex")).toBe(true);
    expect(api.PUT).not.toHaveBeenCalled();
    expect(useChampion.getState().championId).toBe("vex");
  });

  it("a pick made before the app knows who is logged in is saved once it does", async () => {
    expect(await useChampion.getState().choose("brak")).toBe(true);
    expect(api.PUT).not.toHaveBeenCalled();
    expect(useChampion.getState().championId).toBe("brak");
    api.PUT.mockResolvedValue(res(server({ champion_id: "brak", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(api.PUT).toHaveBeenCalledWith("/avatar/champion", { body: { champion_id: "brak" } });
    expect(api.GET).not.toHaveBeenCalled();
    expect(useChampion.getState()).toMatchObject({ championId: "brak", chosen: true });
  });

  it("ignores ids that are not champions", async () => {
    expect(await useChampion.getState().choose("naruto")).toBe(false);
    expect(useChampion.getState().championId).toBe("kaien");
    api.GET.mockResolvedValue(res(server({ champion_id: "zzz", chosen: true })));
    await useChampion.getState().load({ signedIn: true });
    expect(useChampion.getState().championId).toBe("kaien");
  });

  it("asks the server once for overlapping loads", async () => {
    api.GET.mockResolvedValue(res(server()));
    await Promise.all([useChampion.getState().load({ signedIn: true }), useChampion.getState().load({ signedIn: true })]);
    expect(api.GET).toHaveBeenCalledTimes(1);
  });

  it("keeps each champion's progress from the server's answer (not in the browser cache), and reset clears it", async () => {
    const p = { xp: 120, level: 2, level_xp: 100, next_level_xp: 250, battles: 3, wins: 1, mastery: [], kit: { passive: { name: "a", text: "b" }, ultimate: { name: "c", text: "d" } } };
    api.GET.mockResolvedValue(res(server({ champion_id: "kaien", chosen: true, progress: { kaien: p } })));
    await useChampion.getState().load({ signedIn: true });
    expect(useChampion.getState().progress.kaien).toMatchObject({ level: 2, xp: 120 });
    expect(JSON.parse(localStorage.getItem(CHAMPION_CACHE_KEY)!).state.progress).toBeUndefined();
    // an answer without progress (an older server) keeps what we had
    api.PUT.mockResolvedValue(res(server({ champion_id: "mira", chosen: true })));
    await useChampion.getState().choose("mira");
    expect(useChampion.getState().progress.kaien.level).toBe(2);
    useChampion.getState().reset();
    expect(useChampion.getState().progress).toEqual({});
  });
});
