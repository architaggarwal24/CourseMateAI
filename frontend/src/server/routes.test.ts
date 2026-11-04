/** @vitest-environment node */
// The Worker's account, plan and admin routes end to end on a local D1 (Stage 4.1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as config from "@/app/api/v1/auth/config/route";
import * as logout from "@/app/api/v1/auth/logout/route";
import * as checkUsername from "@/app/api/v1/auth/check-username/route";
import * as updateProfile from "@/app/api/v1/auth/update-profile/route";
import * as deleteAccount from "@/app/api/v1/auth/delete-account/route";
import * as plans from "@/app/api/v1/plans/route";
import * as entitlements from "@/app/api/v1/entitlements/route";
import * as usage from "@/app/api/v1/account/usage/route";
import * as redeem from "@/app/api/v1/account/redeem/route";
import * as adminUsers from "@/app/api/v1/admin/users/route";
import * as adminPlan from "@/app/api/v1/admin/users/[id]/plan/route";
import * as adminRole from "@/app/api/v1/admin/users/[id]/role/route";
import * as adminBan from "@/app/api/v1/admin/users/[id]/ban/route";
import * as adminInvites from "@/app/api/v1/admin/invites/route";
import * as adminInvite from "@/app/api/v1/admin/invites/[code]/route";
import { setMailerForTests } from "./context";
import { setEnvForTests } from "./env";
import { Browser, fakeMailer, json, SETTINGS } from "./test/auth-helpers";
import { localPlatform, type LocalPlatform } from "./test/platform";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let ip = 10;

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null);
  setMailerForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const params = <T,>(v: T) => ({ params: Promise.resolve(v) });

/** Sign up and verify through the real handler: a signed-in browser. */
async function person(email: string, username: string): Promise<Browser> {
  const b = new Browser(`198.51.100.${ip++}`);
  const r = await authRoute.POST(b.request("/api/auth/sign-up/email", { body: { email, password: "correct-horse-1", name: username.toUpperCase(), username } }));
  expect(r.status).toBe(200);
  b.keep(await authRoute.POST(b.request("/api/auth/email-otp/verify-email", { body: { email, otp: mail.lastCode(email) } })));
  return b;
}
async function idOf(b: Browser): Promise<number> {
  return (await json(await me.GET(b.request("/api/v1/auth/me")))).user_id;
}

describe("/auth/me and friends", () => {
  it("me is 401 signed out, and the account with its plan signed in", async () => {
    expect((await me.GET(new Browser().request("/api/v1/auth/me"))).status).toBe(401);
    const b = await person("asha@example.com", "asha");
    const body = await json(await me.GET(b.request("/api/v1/auth/me")));
    expect(body).toMatchObject({ email: "asha@example.com", username: "asha", full_name: "ASHA", email_verified: true,
      is_admin: false, is_owner: false, tier: "apprentice", has_password: true, two_factor_enabled: false });
    expect(typeof body.user_id).toBe("number");
  });

  it("config says how sign-in works here", async () => {
    expect(await json(await config.GET(new Browser().request("/api/v1/auth/config"))))
      .toEqual({ google: false, email_delivery: true, verification_required: true, invite_only: false });
    vi.stubEnv("GOOGLE_CLIENT_ID", "id"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    expect((await json(await config.GET(new Browser().request("/api/v1/auth/config")))).google).toBe(true);
  });

  it("logout ends the session", async () => {
    const b = await person("l@example.com", "leaver");
    b.keep(await logout.POST(b.request("/api/v1/auth/logout", { method: "POST" })));
    expect((await me.GET(b.request("/api/v1/auth/me"))).status).toBe(401);
  });

  it("check-username answers taken, free and malformed", async () => {
    await person("a@example.com", "taken_name");
    const ask = async (name: string) => json(await checkUsername.GET(new Browser().request(`/api/v1/auth/check-username?username=${encodeURIComponent(name)}`)));
    expect(await ask("Taken_Name")).toMatchObject({ available: false, reason: null });
    expect(await ask("free.one")).toMatchObject({ available: true });
    expect((await ask("x")).reason).toMatch(/at least 3/);
  });

  it("refuses changes from another site", async () => {
    const b = await person("o@example.com", "origin");
    const res = await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { full_name: "X" }, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });
});

describe("update-profile and delete-account", () => {
  it("changes the name and username, refusing a taken one", async () => {
    await person("other@example.com", "other");
    const b = await person("me@example.com", "mine");
    const ok = await json(await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { full_name: "Meera K", username: "meera" } })));
    expect(ok.user).toMatchObject({ full_name: "Meera K", username: "meera" });
    const taken = await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { username: "OTHER" } }));
    expect(taken.status).toBe(409);
    expect((await json(taken)).error.details.field).toBe("username");
  });

  it("a new password needs the current one", async () => {
    const b = await person("pw@example.com", "pwuser");
    expect((await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { new_password: "another-pass-9" } }))).status).toBe(400);
    const ok = await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { new_password: "another-pass-9", current_password: "correct-horse-1" } }));
    expect(ok.status).toBe(200);
    const signIn = await authRoute.POST(new Browser("198.51.100.200").request("/api/auth/sign-in/email", { body: { email: "pw@example.com", password: "another-pass-9" } }));
    expect(signIn.status).toBe(200);
  });

  it("a new email needs the password and is verified again", async () => {
    const b = await person("old@example.com", "mover");
    const wrong = await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { email: "new@example.com", current_password: "nope-nope-1" } }));
    expect((await json(wrong)).error.details.field).toBe("current_password");
    const ok = await json(await updateProfile.POST(b.request("/api/v1/auth/update-profile", { body: { email: "New@Example.com", current_password: "correct-horse-1" } })));
    expect(ok).toMatchObject({ email_verification_sent: true, user: { email: "new@example.com", email_verified: false } });
    expect(mail.sent.at(-1)?.to).toBe("new@example.com");
  });

  it("deletes the account with the password, but never the owner's", async () => {
    const b = await person("bye@example.com", "bye");
    expect((await deleteAccount.DELETE(b.request("/api/v1/auth/delete-account", { method: "DELETE", body: { password: "wrong-wrong-1" } }))).status).toBe(400);
    const ok = b.keep(await deleteAccount.DELETE(b.request("/api/v1/auth/delete-account", { method: "DELETE", body: { password: "correct-horse-1" } })));
    expect(ok.status).toBe(200);
    expect((await me.GET(b.request("/api/v1/auth/me"))).status).toBe(401);
    expect(await p.env.DB.prepare("SELECT COUNT(*) AS n FROM user WHERE email = 'bye@example.com'").first("n")).toBe(0);

    const owner = await person("owner@example.com", "boss");
    const refused = await deleteAccount.DELETE(owner.request("/api/v1/auth/delete-account", { method: "DELETE", body: { password: "correct-horse-1" } }));
    expect((await json(refused)).error.code).toBe("owner_account");
  });
});

describe("plans", () => {
  it("lists the four plans in INR without a login", async () => {
    const body = await json(await plans.GET(new Browser().request("/api/v1/plans")));
    expect(body.plans.map((x: { tier: string }) => x.tier)).toEqual(["apprentice", "scholar", "sage", "archmage"]);
    expect(body.plans[1]).toMatchObject({ price_month: 149, price_year: 1490, currency: "INR" });
  });

  it("everyone starts on Free; the owner is always on Archmage", async () => {
    const b = await person("free@example.com", "free");
    expect((await json(await usage.GET(b.request("/api/v1/account/usage"))))).toMatchObject({ tier: "apprentice", source: "default" });
    expect((await json(await entitlements.GET(b.request("/api/v1/entitlements")))).features.exam_mode.enabled).toBe(false);
    const owner = await person("owner@example.com", "boss");
    expect((await json(await usage.GET(owner.request("/api/v1/account/usage"))))).toMatchObject({ tier: "archmage", source: "owner" });
    expect((await json(await me.GET(owner.request("/api/v1/auth/me"))))).toMatchObject({ is_owner: true, is_admin: true });
  });
});

describe("admin", () => {
  it("is for admins only", async () => {
    const b = await person("nobody@example.com", "nobody");
    expect((await adminUsers.GET(b.request("/api/v1/admin/users"))).status).toBe(403);
    expect((await adminUsers.GET(new Browser().request("/api/v1/admin/users"))).status).toBe(401);
  });

  it("the owner finds a user and gives them any plan, for some days or for good, and back to Free", async () => {
    const owner = await person("owner@example.com", "boss");
    const student = await person("student@example.com", "student");
    const sid = await idOf(student);
    const found = await json(await adminUsers.GET(owner.request("/api/v1/admin/users?q=STUD")));
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({ user_id: sid, tier: "apprentice", plan: null });

    const sage = await json(await adminPlan.PUT(owner.request(`/api/v1/admin/users/${sid}/plan`, { method: "PUT", body: { tier: "sage", days: 30 } }), params({ id: String(sid) })));
    expect(sage).toMatchObject({ tier: "sage", plan: { tier: "sage", source: "admin" } });
    expect(new Date(sage.plan.expires_at).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await json(await usage.GET(student.request("/api/v1/account/usage"))))).toMatchObject({ tier: "sage", source: "admin" });

    const forever = await json(await adminPlan.PUT(owner.request(`/api/v1/admin/users/${sid}/plan`, { method: "PUT", body: { tier: "archmage", days: null } }), params({ id: String(sid) })));
    expect(forever.plan).toMatchObject({ tier: "archmage", expires_at: null });

    const free = await json(await adminPlan.DELETE(owner.request(`/api/v1/admin/users/${sid}/plan`, { method: "DELETE" }), params({ id: String(sid) })));
    expect(free).toMatchObject({ tier: "apprentice", plan: null });
  });

  it("only the owner makes admins, and an admin can manage plans but not the owner", async () => {
    const owner = await person("owner@example.com", "boss");
    const helper = await person("helper@example.com", "helper");
    const hid = await idOf(helper);
    const oid = await idOf(owner);
    expect((await json(await adminRole.PUT(owner.request(`/api/v1/admin/users/${hid}/role`, { method: "PUT", body: { role: "admin" } }), params({ id: String(hid) })))).role).toBe("admin");
    expect((await json(await me.GET(helper.request("/api/v1/auth/me")))).is_admin).toBe(true);

    const s = await person("s2@example.com", "second");
    const s2 = await idOf(s);
    expect((await adminPlan.PUT(helper.request(`/api/v1/admin/users/${s2}/plan`, { method: "PUT", body: { tier: "scholar", days: 7 } }), params({ id: String(s2) }))).status).toBe(200);
    expect((await adminRole.PUT(helper.request(`/api/v1/admin/users/${s2}/role`, { method: "PUT", body: { role: "admin" } }), params({ id: String(s2) }))).status).toBe(403);
    expect((await adminBan.POST(helper.request(`/api/v1/admin/users/${oid}/ban`, { body: {} }), params({ id: String(oid) }))).status).toBe(400);
    expect((await adminRole.PUT(owner.request(`/api/v1/admin/users/${oid}/role`, { method: "PUT", body: { role: "user" } }), params({ id: String(oid) }))).status).toBe(400);
  });

  it("a ban signs the person out everywhere and keeps them out until lifted", async () => {
    const owner = await person("owner@example.com", "boss");
    const bad = await person("bad@example.com", "bad");
    const bid = await idOf(bad);
    const banned = await json(await adminBan.POST(owner.request(`/api/v1/admin/users/${bid}/ban`, { body: { reason: "spam", days: 7 } }), params({ id: String(bid) })));
    expect(banned).toMatchObject({ banned: true, ban_reason: "spam" });
    expect((await me.GET(bad.request("/api/v1/auth/me"))).status).toBe(401);
    const again = await authRoute.POST(new Browser("198.51.100.250").request("/api/auth/sign-in/email", { body: { email: "bad@example.com", password: "correct-horse-1" } }));
    expect(again.status).toBe(403);
    await adminBan.DELETE(owner.request(`/api/v1/admin/users/${bid}/ban`, { method: "DELETE" }), params({ id: String(bid) }));
    const back = await authRoute.POST(new Browser("198.51.100.251").request("/api/auth/sign-in/email", { body: { email: "bad@example.com", password: "correct-horse-1" } }));
    expect(back.status).toBe(200);
  });
});

describe("invite codes", () => {
  it("the admin makes a code, a student redeems it once, and it can be revoked", async () => {
    const owner = await person("owner@example.com", "boss");
    const made = await json(await adminInvites.POST(owner.request("/api/v1/admin/invites", { body: { tier: "sage", days: 30, max_uses: 2, code: "beta-sage" } })));
    expect(made).toMatchObject({ code: "BETA-SAGE", tier: "sage", uses: 0, usable: true });

    const s = await person("s@example.com", "redeemer");
    const r = await json(await redeem.POST(s.request("/api/v1/account/redeem", { body: { code: " beta-sage " } })));
    expect(r).toMatchObject({ tier: "sage", source: "invite" });
    const twice = await redeem.POST(s.request("/api/v1/account/redeem", { body: { code: "BETA-SAGE" } }));
    expect((await json(twice)).error).toMatchObject({ code: "invite_invalid", message: "You've already used this invite code." });

    const list = await json(await adminInvites.GET(owner.request("/api/v1/admin/invites")));
    expect(list.invites[0]).toMatchObject({ code: "BETA-SAGE", uses: 1 });
    expect((await adminInvite.DELETE(owner.request("/api/v1/admin/invites/BETA-SAGE", { method: "DELETE" }), params({ code: "BETA-SAGE" }))).status).toBe(200);
    const late = await person("late@example.com", "late");
    expect((await redeem.POST(late.request("/api/v1/account/redeem", { body: { code: "BETA-SAGE" } }))).status).toBe(400);
  });

  it("never lowers a plan, and redeeming is rate limited", async () => {
    const owner = await person("owner@example.com", "boss");
    await adminInvites.POST(owner.request("/api/v1/admin/invites", { body: { tier: "scholar", max_uses: 5, code: "LOW-CODE" } }));
    const s = await person("high@example.com", "high");
    const sid = await idOf(s);
    await adminPlan.PUT(owner.request(`/api/v1/admin/users/${sid}/plan`, { method: "PUT", body: { tier: "sage" } }), params({ id: String(sid) }));
    const low = await json(await redeem.POST(s.request("/api/v1/account/redeem", { body: { code: "LOW-CODE" } })));
    expect(low.error.message).toMatch(/already on Sage/);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await redeem.POST(s.request("/api/v1/account/redeem", { body: { code: "NOPE-NOPE" } }))).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
