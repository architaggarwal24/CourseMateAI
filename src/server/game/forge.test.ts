/** @vitest-environment node */
// The forge: item XP from fights, tiers I-V with capped bonuses, materials from Bestiary wins, saddles and mounts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as forgeRoute from "@/app/api/v1/forge/route";
import * as upgradeRoute from "@/app/api/v1/forge/upgrade/route";
import * as saddleRoute from "@/app/api/v1/forge/saddle/route";
import * as mountRoute from "@/app/api/v1/forge/mount/route";
import { requestContext, setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { person } from "../test/flows";
import * as forge from "./forge";
import { modifyAvatar } from "./store";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => { setEnvForTests(null); setMailerForTests(null); vi.unstubAllEnvs(); await p?.dispose(); });

const db = () => p.env.DB;
const uid = async (b: Browser) => {
  const req = b.request("/api/v1/forge");
  const ctx = await requestContext(req);
  return Number((await ctx.auth.api.getSession({ headers: req.headers }))!.user.id);
};
const view = async (b: Browser) => json(await forgeRoute.GET(b.request("/api/v1/forge")));
const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, b: Browser, body: unknown) => route.POST(b.request(path, { body }));

describe("the rules", () => {
  it("+5% a tier up to +20%; XP per fight; growth stages", () => {
    expect([1, 2, 3, 4, 5, 9].map(forge.bonusFor)).toEqual([0, 0.05, 0.1, 0.15000000000000002, 0.2, 0.2]);
    expect(forge.itemXp(8, true)).toBe(10 + 16 + 15);
    expect([1, 2, 3, 4, 5].map(forge.petStage)).toEqual(["baby", "young", "young", "adult", "adult"]);
    expect(forge.wornItems({ weapon: "w", pet: "p" }, null)).toEqual(["w", "p"]);
    expect(forge.wornItems({ pet: "p" }, "katana")).toEqual(["p", "style:katana"]);
  });
});

describe("the forge in play", () => {
  it("items fill their bar in fights; an upgrade takes the bar, coins and materials; materials drop by land", async () => {
    const b = await person(mail, "f@example.com", "forger");
    await view(b);
    const me = await uid(b);
    const ctx = await requestContext(b.request("/api/v1/forge"));
    await modifyAvatar(ctx, me, (eq, owned) => { owned.push("pet_owl"); eq.pet = "pet_owl"; });
    expect((await view(b)).items.find((i: { id: string }) => i.id === "pet_owl")).toMatchObject({ tier: 1, xp: 0, ready: false, stage: "baby", mount_kind: "bird" });

    expect((await json(await post(upgradeRoute, "/api/v1/forge/upgrade", b, { item: "pet_owl" }))).error).toMatchObject({ code: "not_ready" });
    await forge.fightXp(ctx, me, ["pet_owl"], 30, true);                                           // 10 + 60 + 15 = 85
    await forge.fightXp(ctx, me, ["pet_owl"], 5, false);                                           // + 20 = 105
    expect((await view(b)).items.find((i: { id: string }) => i.id === "pet_owl")).toMatchObject({ xp: 105, ready: true });

    expect((await json(await post(upgradeRoute, "/api/v1/forge/upgrade", b, { item: "pet_owl" }))).error).toMatchObject({ code: "not_enough_materials" });
    await db().prepare("UPDATE user_progress SET coins = 5000 WHERE user_id = ?").bind(me).run();
    const coins = async () => Number((await db().prepare("SELECT coins FROM user_progress WHERE user_id = ?").bind(me).first<{ coins: number }>())!.coins);
    expect(await coins()).toBe(5000);                                                              // nothing paid

    const got = await forge.dropMaterials(ctx, me, "minotaur", "nightmare", true, 1, () => 0.1);
    expect(got).toEqual([{ id: "bronze_ore", name: "Bronze ore", count: 3, rare: false }, { id: "labyrinth_heart", name: "Labyrinth heart", count: 4, rare: true }]);
    expect(await forge.dropMaterials(ctx, me, "minotaur", "easy", false, 0)).toEqual([]);
    const up = await json(await post(upgradeRoute, "/api/v1/forge/upgrade", b, { item: "pet_owl" }));
    expect(up.items.find((i: { id: string }) => i.id === "pet_owl")).toMatchObject({ tier: 2, xp: 5, stage: "young" });
    expect(up.materials).toEqual([{ id: "labyrinth_heart", name: "Labyrinth heart", count: 4, rare: true }]);
    expect(await coins()).toBe(5000 - 150);
    expect((await post(upgradeRoute, "/api/v1/forge/upgrade", b, { item: "nope" })).status).toBe(404);
  }, 60_000);

  it("an adult pet can be saddled and ridden; riding takes it out of the pet slot", async () => {
    const b = await person(mail, "s@example.com", "saddler");
    await view(b);
    const me = await uid(b);
    const ctx = await requestContext(b.request("/api/v1/forge"));
    await modifyAvatar(ctx, me, (eq, owned) => { owned.push("pet_fox"); eq.pet = "pet_fox"; });
    expect((await json(await post(saddleRoute, "/api/v1/forge/saddle", b, { pet: "pet_fox" }))).error).toMatchObject({ code: "not_grown" });
    await db().prepare("INSERT INTO item_progress (user_id, item_id, xp, tier, saddled, updated_at) VALUES (?, 'pet_fox', 0, 4, 0, 'x')").bind(me).run();
    await db().prepare("UPDATE user_progress SET coins = 1000 WHERE user_id = ?").bind(me).run();
    await db().prepare("INSERT INTO forge_materials (user_id, material_id, quantity) VALUES (?, 'sun_plume', 2)").bind(me).run();
    const s = await json(await post(saddleRoute, "/api/v1/forge/saddle", b, { pet: "pet_fox" }));
    expect(s.items.find((i: { id: string }) => i.id === "pet_fox")).toMatchObject({ saddled: true, can_saddle: false });
    const m = await json(await mountRoute.PUT(b.request("/api/v1/forge/mount", { method: "PUT", body: { pet: "pet_fox" } })));
    expect(m.mount).toBe("pet_fox");
    expect(m.items.find((i: { id: string }) => i.id === "pet_fox").worn).toBe(true);
    const row = await db().prepare("SELECT equipped_json FROM user_avatar WHERE user_id = ?").bind(me).first<{ equipped_json: string }>();
    expect(JSON.parse(row!.equipped_json)).toEqual({ mount: "pet_fox" });
    expect((await json(await mountRoute.PUT(b.request("/api/v1/forge/mount", { method: "PUT", body: { pet: null } })))).mount).toBeNull();
  }, 60_000);
});
