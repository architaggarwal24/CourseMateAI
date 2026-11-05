import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), claimQuest: vi.fn(), fetchHUD: vi.fn() }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  rawApi: { GET: api.GET, POST: api.POST },
  claimQuest: api.claimQuest,
  fetchHUD: api.fetchHUD,
}));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));

import { useHUDStore } from "./useHUD";
import {
  INVENTORY_TABS, afterEquipToggle, afterPurchase, afterUnequip, afterUse, ownedItems, previewEquipped, useHeroStore,
  type ShopState,
} from "./useHero";

const item = (over: Record<string, any>) => ({
  id: "x", category: "headgear", name: "X", price: 100, level_required: 1, consumable: false,
  owned: false, equipped: false, can_afford: true, locked: false, quantity: null, ...over,
});

const makeShop = (coins = 250): ShopState => ({
  shop_unlocked: true, level: 6, coins, owned: ["hat_old"], equipped: { headgear: "hat_old" },
  items: [
    item({ id: "hat_old", name: "Old Hat", price: 0, owned: true, equipped: true }),
    item({ id: "hat_new", name: "New Hat", price: 200 }),
    item({ id: "sword", name: "Sword", category: "weapon", price: 500, can_afford: coins >= 500 }),
    item({ id: "potion", name: "Potion", category: "potion", price: 60, consumable: true, quantity: 0, effect: "xp_boost_1h" }),
  ],
});

const res = (data: any, ok = true, status = 200) => ({ data: ok ? data : undefined, error: ok ? undefined : data, response: { ok, status } });
const hudBody = (coins: number, quests: any[] = []) => ({
  progress: { current_level: 6, total_xp: 900, coins, xp_into_level: 40, xp_to_next: 100, streak_days: 3, streak_freezes: 0 },
  quests, shop: { shop_unlocked: true, items: [] }, buffs: {}, consumable_inventory: {}, guest_mode: false,
});

/** The fake server: one balance and one inventory, answering /shop, /hud and the actions. */
function fakeServer(shop: ShopState) {
  let state = structuredClone(shop);
  api.GET.mockImplementation(async (path: string) => {
    if (path === "/shop") return res(structuredClone(state));
    throw new Error(`unexpected GET ${path}`);
  });
  api.fetchHUD.mockImplementation(async () => hudBody(state.coins));
  api.POST.mockImplementation(async (path: string, { body }: any) => {
    if (path === "/shop/purchase") {
      const it = state.items.find((i) => i.id === body.item_id)!;
      state.coins -= it.price;
      it.owned = true; state.owned.push(it.id);
      if (it.consumable) it.quantity = (it.quantity ?? 0) + 1;
      return res({ ok: true, message: "Purchased" });
    }
    if (path === "/shop/equip") {
      const it = state.items.find((i) => i.id === body.item_id)!;
      state.items.forEach((i) => { if (i.category === it.category) i.equipped = i.id === it.id; });
      state.equipped[it.category] = it.id;
      return res({ ok: true });
    }
    if (path === "/shop/unequip") {
      state.items.forEach((i) => { if (i.category === body.slot) i.equipped = false; });
      delete state.equipped[body.slot];
      return res({ ok: true });
    }
    if (path === "/items/use") {
      const it = state.items.find((i) => i.id === body.item_id)!;
      it.quantity = Math.max(0, (it.quantity ?? 0) - 1);
      return res({ ok: true, message: "Effect applied." });
    }
    throw new Error(`unexpected POST ${path}`);
  });
  return { get state() { return state; } };
}

const settle = () => vi.waitFor(() => expect(useHeroStore.getState().pending).toEqual({}));
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  vi.clearAllMocks();
  useHeroStore.getState().reset();
  useHUDStore.setState({ guestMode: false, coins: 250, level: 6, quests: [], xp: 900, xpInto: 40, xpToNext: 100, _epoch: 0, _seq: 0 });
});

describe("pure shop updates", () => {
  it("buying takes the coins, owns the item and redoes what is still affordable", () => {
    const after = afterPurchase(makeShop(250), "hat_new", 200);
    expect(after.coins).toBe(50);
    expect(after.owned).toContain("hat_new");
    const hat = after.items.find((i) => i.id === "hat_new")!;
    expect(hat.owned).toBe(true);
    expect(hat.can_afford).toBe(false);                       // a non-consumable can't be bought twice
    expect(after.items.find((i) => i.id === "potion")!.can_afford).toBe(false);   // 60 > 50
    expect(afterPurchase(makeShop(250), "hat_new", 200, false).coins).toBe(250);  // "Already owned": not charged
  });

  it("a consumable adds one to what is held", () => {
    const after = afterPurchase(makeShop(250), "potion", 60);
    expect(after.items.find((i) => i.id === "potion")).toMatchObject({ owned: true, quantity: 1, can_afford: true });
    expect(afterUse(after, "potion").items.find((i) => i.id === "potion")!.quantity).toBe(0);
  });

  it("wearing replaces the item in the slot; taking off empties it", () => {
    const shop = makeShop();
    const worn = afterEquipToggle(shop, shop.items[1], true);
    expect(worn.equipped.headgear).toBe("hat_new");
    expect(worn.items.filter((i) => i.category === "headgear" && i.equipped).map((i) => i.id)).toEqual(["hat_new"]);
    expect(afterUnequip(worn, "headgear").equipped).toEqual({});
  });

  it("the preview shows an item in its slot without wearing it", () => {
    const shop = makeShop();
    expect(previewEquipped(shop, null)).toEqual({ headgear: "hat_old" });
    expect(previewEquipped(shop, "sword")).toEqual({ headgear: "hat_old", weapon: "sword" });
    expect(previewEquipped(shop, "nope")).toEqual({ headgear: "hat_old" });
    expect(previewEquipped(null, "sword")).toEqual({});
  });

  it("the inventory lists what is owned, by tab", () => {
    const shop = afterPurchase(makeShop(), "potion", 60);
    const tab = (id: string) => ownedItems(shop).filter(INVENTORY_TABS.find((t) => t.id === id)!.match).map((i) => i.id);
    expect(tab("equipment")).toEqual(["hat_old"]);
    expect(tab("consumables")).toEqual(["potion"]);
  });
});

describe("buying (the Done-when: coins, inventory and avatar preview update with no reload)", () => {
  it("updates coins, the inventory and the preview at once, from the answer, before any re-read", async () => {
    const server = fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    expect(useHUDStore.getState().coins).toBe(250);

    // Try the hat on, then buy it.
    useHeroStore.getState().setPreview("hat_new");
    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    api.GET.mockClear(); api.fetchHUD.mockClear();
    const bought = useHeroStore.getState().purchase(hat);

    // Hold the re-read back: everything below must already be true without it.
    await vi.waitFor(() => expect(api.POST).toHaveBeenCalledWith("/shop/purchase", { body: { item_id: "hat_new" } }));
    await bought;
    const { shop, previewId } = useHeroStore.getState();
    expect(useHUDStore.getState().coins).toBe(50);                                   // header coins
    expect(shop!.coins).toBe(50);                                                    // shop sidebar coins
    expect(ownedItems(shop).map((i) => i.id)).toContain("hat_new");                   // inventory
    expect(previewEquipped(shop, previewId)).toEqual({ headgear: "hat_new" });        // avatar preview keeps the item on
    expect(toasts.success).toHaveBeenCalledWith("New Hat purchased! 🎉");

    await flush();
    expect(api.GET).toHaveBeenCalledWith("/shop");                                    // then the quiet confirmation ...
    expect(server.state.coins).toBe(50);
    expect(useHUDStore.getState().coins).toBe(50);                                    // ... agrees, no flicker back
  });

  it("an old answer arriving late never puts the old balance back", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();

    // A read that started BEFORE the purchase, and is answered after it, with the old coins.
    let answerOld!: (v: unknown) => void;
    api.GET.mockImplementationOnce(() => new Promise((r) => { answerOld = r; }));
    const slowRead = useHeroStore.getState().loadShop();

    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    await useHeroStore.getState().purchase(hat);
    expect(useHUDStore.getState().coins).toBe(50);

    answerOld(res(makeShop(250)));
    await slowRead;
    expect(useHUDStore.getState().coins).toBe(50);
    expect(useHeroStore.getState().shop!.coins).toBe(50);
    expect(ownedItems(useHeroStore.getState().shop).map((i) => i.id)).toContain("hat_new");
  });

  it("refuses without calling the server when it can't be afforded, or for a guest", async () => {
    fakeServer(makeShop(100));
    await useHeroStore.getState().loadShop();
    const sword = useHeroStore.getState().shop!.items.find((i) => i.id === "sword")!;
    useHUDStore.setState({ coins: 100 });
    expect(await useHeroStore.getState().purchase(sword)).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith("Not enough coins! Need 400 more 🪙");
    useHUDStore.setState({ guestMode: true });
    expect(await useHeroStore.getState().purchase(sword)).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith("Please login to purchase items");
    expect(api.POST).not.toHaveBeenCalled();
  });

  it("when the game says no (HTTP 200, ok: false) nothing changes and the reason is shown", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    api.POST.mockResolvedValueOnce(res({ ok: false, reason: "Locked until Level 9" }));
    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    expect(await useHeroStore.getState().purchase(hat)).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith("Locked until Level 9");
    expect(useHUDStore.getState().coins).toBe(250);
    expect(useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!.owned).toBe(false);
  });

  it("a failed request is a toast with the right action, not a raw message", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    api.POST.mockResolvedValueOnce(res({ error: { code: "internal_error", message: "boom", action: "retry" } }, false, 500));
    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    expect(await useHeroStore.getState().purchase(hat)).toBe(false);
    expect(toasts.apiError).toHaveBeenCalledWith(expect.objectContaining({ code: "internal_error", status: 500 }));
    expect(useHUDStore.getState().coins).toBe(250);
  });
});

describe("equipping", () => {
  it("shows the change at once and the avatar everywhere follows", async () => {
    const server = fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    await useHeroStore.getState().purchase(hat);
    await flush();

    const owned = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    useHeroStore.getState().setPreview("hat_new");
    const done = useHeroStore.getState().toggleEquip(owned);
    expect(useHeroStore.getState().shop!.equipped.headgear).toBe("hat_new");          // before the server has answered
    expect(useHeroStore.getState().previewId).toBeNull();                              // the try-on is now the real thing
    await done;
    await flush();
    expect(server.state.equipped.headgear).toBe("hat_new");
    expect(toasts.success).toHaveBeenCalledWith("New Hat equipped! ⚡");

    const worn = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    await useHeroStore.getState().toggleEquip(worn);                                   // and take it off again
    await flush();
    expect(useHeroStore.getState().shop!.equipped).toEqual({});
    expect(toasts.success).toHaveBeenCalledWith("New Hat unequipped!");
  });

  it("puts the old look back when the server refuses", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    api.POST.mockResolvedValueOnce(res({ ok: false, reason: "You don't own this item" }));
    const hat = useHeroStore.getState().shop!.items.find((i) => i.id === "hat_new")!;
    expect(await useHeroStore.getState().equip(hat)).toBe(false);
    expect(useHeroStore.getState().shop!.equipped).toEqual({ headgear: "hat_old" });
    expect(toasts.error).toHaveBeenCalledWith("You don't own this item");
  });

  it("unequip names the slot's item", async () => {
    const server = fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    await useHeroStore.getState().unequip("headgear");
    await flush();
    expect(api.POST).toHaveBeenCalledWith("/shop/unequip", { body: { slot: "headgear" } });
    expect(server.state.equipped).toEqual({});
    expect(toasts.success).toHaveBeenCalledWith("Old Hat unequipped!");
  });
});

describe("using an item and claiming a quest", () => {
  it("using a consumable takes one from the inventory at once", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    await useHeroStore.getState().purchase(useHeroStore.getState().shop!.items.find((i) => i.id === "potion")!);
    await flush();
    const potion = useHeroStore.getState().shop!.items.find((i) => i.id === "potion")!;
    expect(potion.quantity).toBe(1);
    api.POST.mockClear();
    await useHeroStore.getState().useItem(potion);
    expect(api.POST).toHaveBeenCalledWith("/items/use", { body: { item_id: "potion" } });
    expect(useHeroStore.getState().shop!.items.find((i) => i.id === "potion")!.quantity).toBe(0);
    expect(toasts.success).toHaveBeenCalledWith("Potion used! Effect applied.");
  });

  it("claiming marks the quest and adds the reward to the header before the re-read", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    useHUDStore.setState({ quests: [{ quest_type: "q1", completed: 1, claimed: 0 }] });
    api.claimQuest.mockResolvedValueOnce({ ok: true, xp_gained: 30, coins_gained: 20 });
    api.fetchHUD.mockImplementation(async () => hudBody(270, [{ quest_type: "q1", completed: 1, claimed: 1 }]));
    api.GET.mockImplementation(async () => res({ ...makeShop(270) }));

    const claimed = useHeroStore.getState().claim("q1");
    expect(useHeroStore.getState().pending["quest:q1"]).toBe(true);                    // the button shows "Claiming..."
    await claimed;
    expect(useHUDStore.getState().coins).toBe(270);
    expect(useHeroStore.getState().shop!.coins).toBe(270);                              // same balance in the shop
    expect(useHUDStore.getState().quests[0].claimed).toBe(1);
    expect(useHeroStore.getState().pending).toEqual({});
    expect(toasts.success).toHaveBeenCalledWith("🎉 Claimed! +30 XP | +20 🪙", expect.anything());
  });

  it("'Already claimed' is a success with the same end state", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    useHUDStore.setState({ quests: [{ quest_type: "q1", completed: 1, claimed: 0 }] });
    api.claimQuest.mockResolvedValueOnce({ ok: false, reason: "Already claimed" });
    api.fetchHUD.mockImplementation(async () => hudBody(250, [{ quest_type: "q1", completed: 1, claimed: 1 }]));
    expect(await useHeroStore.getState().claim("q1")).toBe(true);
    expect(useHUDStore.getState().quests[0].claimed).toBe(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("any other refusal is shown and the quest stays claimable", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    useHUDStore.setState({ quests: [{ quest_type: "q1", completed: 0, claimed: 0 }] });
    api.claimQuest.mockResolvedValueOnce({ ok: false, reason: "Quest not completed" });
    expect(await useHeroStore.getState().claim("q1")).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith("Quest not completed");
    expect(useHUDStore.getState().quests[0].claimed).toBe(0);
  });

  it("a request error is a toast with a Retry that claims again", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    api.claimQuest.mockRejectedValueOnce(new Error("net"));
    expect(await useHeroStore.getState().claim("q1")).toBe(false);
    expect(toasts.apiError).toHaveBeenCalledWith(expect.any(Error), { onRetry: expect.any(Function) });
  });
});

describe("reconcile", () => {
  it("overlapping calls share one pass plus at most one more", async () => {
    fakeServer(makeShop(250));
    await useHeroStore.getState().loadShop();
    api.GET.mockClear();
    await Promise.all([1, 2, 3, 4].map(() => useHeroStore.getState().reconcile()));
    expect(api.GET.mock.calls.length).toBeLessThanOrEqual(2);
    await settle();
  });
});

describe("the HUD store drops a refresh that a local change has outdated", () => {
  it("a refresh answered after markChanged does not overwrite the screen", async () => {
    let answer!: (v: unknown) => void;
    api.fetchHUD.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const refreshing = useHUDStore.getState().refresh();
    useHUDStore.setState({ coins: 5 });
    useHUDStore.getState().markChanged();
    answer(hudBody(999));
    await refreshing;
    expect(useHUDStore.getState().coins).toBe(5);
    expect(useHUDStore.getState().loading).toBe(false);
  });

  it("the newest refresh wins over an older one that answers later", async () => {
    const answers: Array<(v: unknown) => void> = [];
    api.fetchHUD.mockImplementation(() => new Promise((r) => { answers.push(r); }));
    const first = useHUDStore.getState().refresh();
    const second = useHUDStore.getState().refresh();
    answers[1](hudBody(70));
    await second;
    answers[0](hudBody(10));
    await first;
    expect(useHUDStore.getState().coins).toBe(70);
  });
});
