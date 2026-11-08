// Victory emotes (Stage A2): what a champion can act out over a beaten creature. Three are free, three are in the
// shop (category "emote", owned like any item), and four come with achievements.
import { inArray, and, eq } from "drizzle-orm";
import type { RequestContext } from "../context";
import { userAchievements } from "../db/schema";
import { CATALOG } from "./content";
import { getAvatar } from "./store";

/** The emotes an achievement brings (the achievement's id). */
export const EMOTE_ACHIEVEMENTS: Record<string, { name: string; achievement: string; how: string }> = {
  emote_heart: { name: "Heart", achievement: "first_boss", how: "Defeat your first boss" },
  emote_book: { name: "Lore Nod", achievement: "lorekeeper", how: "Find a bane on your own" },
  emote_crown: { name: "Crown", achievement: "boss_10", how: "Defeat 10 bosses" },
  emote_skull: { name: "Skull", achievement: "nightmare_clear", how: "Win on nightmare" },
};
const SHOP_EMOTES = CATALOG.filter((it) => it.type === "emote");

/** Every emote and whether this player has it (free ones always; shop ones owned; achievement ones unlocked). */
export async function emotes(ctx: RequestContext, userId: number) {
  const [avatar, unlocked] = await Promise.all([
    getAvatar(ctx, userId),
    ctx.db.select({ id: userAchievements.achievementId }).from(userAchievements)
      .where(and(eq(userAchievements.userId, userId), inArray(userAchievements.achievementId, Object.values(EMOTE_ACHIEVEMENTS).map((e) => e.achievement)))).all(),
  ]);
  const got = new Set(unlocked.map((r) => r.id));
  return {
    emotes: [
      ...SHOP_EMOTES.map((it) => ({ id: it.id, name: it.name, owned: it.price === 0 || avatar.owned.includes(it.id), how: it.price === 0 ? "Free" : `Shop · ${it.price} coins` })),
      ...Object.entries(EMOTE_ACHIEVEMENTS).map(([id, e]) => ({ id, name: e.name, owned: got.has(e.achievement), how: e.how })),
    ],
  };
}
