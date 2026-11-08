import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchHUD: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchHUD: api.fetchHUD }));

import { resetHudForTests, useHUDStore } from "./useHUD";

const body = (coins: number) => ({
  progress: { current_level: 6, total_xp: 900, coins, xp_into_level: 40, xp_to_next: 100, streak_days: 3, streak_freezes: 0 },
  quests: [], shop: { shop_unlocked: true, items: [] }, buffs: {}, consumable_inventory: {}, guest_mode: false,
});

/** A fetchHUD that answers only when the test says so. */
function deferred() {
  let resolve!: (v: unknown) => void;
  const p = new Promise((r) => { resolve = r; });
  return { p, resolve };
}

beforeEach(() => {
  api.fetchHUD.mockReset();
  resetHudForTests();
});

// Performance pass (Stage P1): opening the app asked GET /hud three times, one after another, before the screen
// showed (AppShell on mount, then AuthProvider twice). Start-up now asks once; a signed-out visitor never asks.
describe("HUD start-up loading", () => {
  it("load() shares one request between callers while it is in flight", async () => {
    const d = deferred();
    api.fetchHUD.mockReturnValueOnce(d.p);
    const a = useHUDStore.getState().load();
    const b = useHUDStore.getState().load();
    d.resolve(body(320));
    await Promise.all([a, b]);
    expect(api.fetchHUD).toHaveBeenCalledTimes(1);
    expect(useHUDStore.getState().coins).toBe(320);
  });

  it("load() does not ask again right after a load", async () => {
    api.fetchHUD.mockResolvedValue(body(10));
    await useHUDStore.getState().load();
    await useHUDStore.getState().load();
    expect(api.fetchHUD).toHaveBeenCalledTimes(1);
  });

  it("the first sign-in answer reuses the request AppShell already started (same cookie, same answer)", async () => {
    const d = deferred();
    api.fetchHUD.mockReturnValueOnce(d.p);
    const shell = useHUDStore.getState().load();             // AppShell mounts first
    const auth = useHUDStore.getState().setUserIdAsync("7");  // then GET /auth/me answers
    d.resolve(body(50));
    await Promise.all([shell, auth]);
    expect(api.fetchHUD).toHaveBeenCalledTimes(1);
    expect(useHUDStore.getState().guestMode).toBe(false);
    expect(useHUDStore.getState().coins).toBe(50);
  });

  it("a signed-out visitor never asks: the guest HUD is the defaults", async () => {
    await useHUDStore.getState().setUserIdAsync("guest");
    expect(api.fetchHUD).not.toHaveBeenCalled();
    const s = useHUDStore.getState();
    expect(s.guestMode).toBe(true);
    expect([s.level, s.coins, s.quests.length]).toEqual([1, 0, 0]);
  });

  it("signing in as someone else asks again, and an older answer cannot overwrite the new account", async () => {
    api.fetchHUD.mockResolvedValueOnce(body(1));
    await useHUDStore.getState().setUserIdAsync("7");
    const old = deferred();
    api.fetchHUD.mockReturnValueOnce(old.p);
    const stale = useHUDStore.getState().refresh();           // something refreshes for account 7 ...
    api.fetchHUD.mockResolvedValueOnce(body(999));
    await useHUDStore.getState().setUserIdAsync("8");         // ... and then account 8 signs in
    old.resolve(body(2));
    await stale;
    expect(api.fetchHUD).toHaveBeenCalledTimes(3);
    expect(useHUDStore.getState().coins).toBe(999);
  });

  it("signing out clears the HUD without asking, and drops an answer still on its way", async () => {
    api.fetchHUD.mockResolvedValueOnce(body(1));
    await useHUDStore.getState().setUserIdAsync("7");
    const late = deferred();
    api.fetchHUD.mockReturnValueOnce(late.p);
    const pending = useHUDStore.getState().refresh();
    await useHUDStore.getState().setUserIdAsync("guest");
    late.resolve(body(500));
    await pending;
    expect(api.fetchHUD).toHaveBeenCalledTimes(2);
    expect(useHUDStore.getState().coins).toBe(0);
    expect(useHUDStore.getState().guestMode).toBe(true);
  });

  it("refresh() still always asks (after a purchase or a reward the screen needs the server's new numbers)", async () => {
    api.fetchHUD.mockResolvedValue(body(5));
    const a = useHUDStore.getState().refresh();
    const b = useHUDStore.getState().refresh();
    await Promise.all([a, b]);
    expect(api.fetchHUD).toHaveBeenCalledTimes(2);
  });
});
