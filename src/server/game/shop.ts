// The shop, equipment and potions (Stage 4.5; port of backend/services/progression/shop_service.py + routers/shop.py).
// A purchase is one ledger event with negative coins: it can't overdraw, and a replay of a one-time item can't pay
// twice. Free items are granted when the shop is opened.
import { HttpError } from "../http";
import type { RequestContext } from "../context";
import { CATALOG, CATEGORY_INFO, CATEGORY_UNLOCK_LEVELS, DEFAULT_CHAMPION, ITEMS, isChampion } from "./content";
import { canEquipInSlot, SLOT_BY_TYPE } from "./items";
import { activeBuffs, applyBuff, BUFF_DURATION } from "./progression";
import {
  addInventory, consumeInventory, countRewardEvents, dailyCount, getAvatar, getProgress, inventory, localDate, modifyAvatar, recordRewardEvent,
  takeDailySlot, type Player, type Progress,
} from "./store";

export const SHOP_LEVEL = 5;
const STACK_LIMITS: Record<string, number> = { potion_health_small: 3, fifty_fifty: 2 };
const ITEM_TO_BUFF: Record<string, string> = { potion_health_small: "heal_1", fifty_fifty: "fifty_fifty" };
const ONCE_A_DAY = new Set(["potion_streak_shield", "potion_quest_reset"]);
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function shopState(ctx: RequestContext, p: Player, progress?: Progress) {
  const prog = progress ?? await getProgress(ctx, p.id);
  let avatar = await getAvatar(ctx, p.id);
  const free = CATALOG.filter((it) => it.price === 0 && !it.consumable && !it.mastery).map((it) => it.id);
  if (free.some((id) => !avatar.owned.includes(id))) {
    avatar = await modifyAvatar(ctx, p.id, (_e, owned) => { for (const id of free) if (!owned.includes(id)) owned.push(id); });
  }
  const inv = await inventory(ctx, p.id);
  const buffs = await activeBuffs(ctx, p.id);
  const buffCounts = Object.fromEntries(Object.entries(ITEM_TO_BUFF).map(([item, key]) => [item, Number(buffs[key]?.count ?? 0)]));
  const level = prog.currentLevel, coins = prog.coins;
  const items = CATALOG.map((it) => {
    const consumable = it.consumable;
    const max = STACK_LIMITS[it.id] ?? null;
    const held = (inv[it.id] ?? 0) + (buffCounts[it.id] ?? 0);
    return {
      ...it, owned: avatar.owned.includes(it.id), equipped: avatar.equipped[it.type] === it.id, can_afford: coins >= it.price,
      locked: it.price > 0 && level < it.level_required, bonus: it.bonus, battle: it.battle, arena_only: it.arena_only ?? false,
      quantity: consumable ? inv[it.id] ?? 0 : null, total_available: consumable ? held : null, buff_count: consumable ? buffCounts[it.id] ?? 0 : null,
      max_stack: max, at_max: max !== null && consumable ? held >= max : false,
    };
  });
  const category_status = Object.fromEntries(Object.entries(CATEGORY_UNLOCK_LEVELS).map(([cat, lv]) => [cat, { unlocked: level >= lv, unlock_level: lv, ...CATEGORY_INFO[cat] }]));
  return {
    shop_unlocked: level >= SHOP_LEVEL, champion_id: isChampion(avatar.championId) ? avatar.championId : DEFAULT_CHAMPION,
    level, coins, owned: avatar.owned, equipped: avatar.equipped, items, category_status,
  };
}

export async function purchase(ctx: RequestContext, p: Player, itemId: string) {
  const prog = await getProgress(ctx, p.id);
  const level = prog.currentLevel, coins = prog.coins;
  if (level < SHOP_LEVEL) return { ok: false, reason: `Shop locked until Level ${SHOP_LEVEL}` };
  const it = ITEMS.get(itemId);
  if (!it) return { ok: false, reason: "Item not found" };
  if (it.mastery) return { ok: false, reason: `A mastery skin: reach ${title(it.mastery.champion)} Lv ${it.mastery.level} to unlock it.` };
  if (level < it.level_required) return { ok: false, reason: `Locked until Level ${it.level_required}` };
  const avatar = await getAvatar(ctx, p.id);
  if (avatar.owned.includes(itemId) && !it.consumable) return { ok: true, message: "Already owned" };
  if (coins < it.price) return { ok: false, reason: "Not enough coins", need: it.price - coins };
  let onceKey: string | null = null;
  const today = localDate(p.tz);
  if (it.consumable) {
    if (itemId in STACK_LIMITS) {
      const held = ((await inventory(ctx, p.id))[itemId] ?? 0) + Number((await activeBuffs(ctx, p.id))[ITEM_TO_BUFF[itemId]]?.count ?? 0);
      if (held >= STACK_LIMITS[itemId]) return { ok: false, reason: `Max stack of ${STACK_LIMITS[itemId]} reached — use one in arena first!` };
    } else if (it.effect && it.effect in BUFF_DURATION) {
      if ((await activeBuffs(ctx, p.id))[it.effect]) return { ok: false, reason: "This effect is already active — wait for it to expire first!" };
    } else if (ONCE_A_DAY.has(itemId)) {
      onceKey = `buy_${itemId}`;
      if (await dailyCount(ctx, p.id, today, onceKey) >= 1) return { ok: false, reason: "You can only buy this once per day!" };
    }
  }
  const key = it.consumable ? `u${p.id}:purchase:${itemId}:${await countRewardEvents(ctx, p.id, "shop_purchase", itemId) + 1}` : `u${p.id}:purchase:${itemId}`;
  const paid = await recordRewardEvent(ctx, p.id, "shop_purchase", 0, -it.price, itemId, key);
  if (!paid.applied) return paid.reason === "duplicate" ? { ok: true, message: "Already owned" } : { ok: false, reason: "Not enough coins", need: Math.max(0, it.price - coins) };
  if (onceKey) await takeDailySlot(ctx, p.id, today, onceKey);
  if (it.consumable) await addInventory(ctx, p.id, itemId);
  await modifyAvatar(ctx, p.id, (_e, owned) => { if (!owned.includes(itemId)) owned.push(itemId); });
  return { ok: true, message: "Purchased", item: it };
}

export async function equip(ctx: RequestContext, p: Player, itemId: string) {
  const it = ITEMS.get(itemId);
  if (!it) return { ok: false, reason: "Item not found" };
  const slot = SLOT_BY_TYPE[it.type];
  if (!slot) return { ok: false, reason: "This item can't be equipped" };
  const champion = (await getAvatar(ctx, p.id)).championId || "kaien";
  let err: string | null = null;
  const a = await modifyAvatar(ctx, p.id, (equipped, owned) => {
    if (!canEquipInSlot(itemId, slot, owned, champion)) {
      err = it.mastery && owned.includes(itemId) ? `Only ${title(it.mastery.champion)} can wear this` : "You don't own this item";
      return;
    }
    equipped[slot] = itemId;
  });
  return err ? { ok: false, reason: err } : { ok: true, equipped: a.equipped };
}

export async function unequip(ctx: RequestContext, p: Player, slot: string) {
  const valid = ["headgear", "armor", "weapon", "pet", "title"];
  if (!valid.includes(slot)) return { ok: false, reason: `Invalid slot. Must be one of: ${JSON.stringify(valid).replace(/"/g, "'").replace(/,/g, ", ")}` };
  let err: string | null = null;
  let removed: string | undefined;
  const a = await modifyAvatar(ctx, p.id, (equipped) => {
    if (!equipped[slot]) { err = `No item equipped in ${slot} slot`; return; }
    removed = equipped[slot];
    delete equipped[slot];
  });
  return err ? { ok: false, reason: err } : { ok: true, message: "Item unequipped", item: removed ? ITEMS.get(removed) ?? null : null, equipped: a.equipped };
}

/** Use a potion from the inventory: its effect applies now. */
export async function useItem(ctx: RequestContext, p: Player, itemId: string) {
  const it = ITEMS.get(itemId);
  if (!it) throw new HttpError(404, "item_not_found", "That item doesn't exist.");
  if (!it.consumable || !it.effect) throw new HttpError(400, "item_not_usable", "That item can't be used.");
  if (((await inventory(ctx, p.id))[itemId] ?? 0) < 1) throw new HttpError(400, "item_not_owned", "You don't have that item in your inventory.");
  // take it first, so two parallel uses can't both apply one potion
  if (!await consumeInventory(ctx, p.id, itemId)) throw new HttpError(400, "item_not_owned", "You don't have that item in your inventory.");
  const result = await applyBuff(ctx, p, it.effect);
  if (!result.ok) {
    await addInventory(ctx, p.id, itemId);                       // give it back
    throw new HttpError(400, "item_not_usable", result.reason || "You can't use that item right now.");
  }
  const buffs = await activeBuffs(ctx, p.id);
  return {
    ok: true, item_id: itemId, item_name: it.name, effect: it.effect, message: (result.message as string) ?? "Item used!",
    expires_at: (result.expires_at as string | undefined) ?? null, active_buffs: buffs,
    hint_charges: it.effect === "hint_charge" ? Number(buffs.hint_charges?.count ?? 0) : null,
  };
}
