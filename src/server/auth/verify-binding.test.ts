/** @vitest-environment node */
// Security audit run 1 (auth findings): an emailed code proves the mailbox, never the account. Verifying an address
// signs nobody in, an already-verified address can't be "verified" again, a first verification needs the password
// chosen at sign-up (so an address someone else registered first can't be taken over in either direction), and
// Better Auth's own delete-user door is closed (the app's /api/v1/auth/delete-account is the only one).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { Browser, fakeMailer, json, testAuth, SETTINGS } from "../test/auth-helpers";

let p: LocalPlatform;
beforeEach(async () => { p = await localPlatform(); }, 60_000);
afterEach(async () => { await p?.dispose(); });

const PW = "correct-horse-1";
const signUp = (b: Browser, email: string, password = PW, username = "asha_r") =>
  b.request("/api/auth/sign-up/email", { body: { email, password, name: "Asha Rao", username } });
const verify = (b: Browser, email: string, otp: string, password?: string) =>
  b.request("/api/auth/email-otp/verify-email", { body: { email, otp, ...(password ? { password } : {}) } });
const signIn = (b: Browser, email: string, password: string) =>
  b.request("/api/auth/sign-in/email", { body: { email, password } });
const session = async (auth: ReturnType<typeof testAuth>, b: Browser) => (await json(await auth.handler(b.request("/api/auth/get-session"))))?.user ?? null;

describe("verifying an email", () => {
  it("with the sign-up password confirms the address but signs nobody in; the password then signs in", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    await auth.handler(signUp(b, "asha@example.com"));
    const v = b.keep(await auth.handler(verify(b, "asha@example.com", mail.lastCode(), PW)));
    expect(v.status).toBe(200);
    expect(await session(auth, b)).toBeNull();
    b.keep(await auth.handler(signIn(b, "asha@example.com", PW)));
    expect(await session(auth, b)).toMatchObject({ email: "asha@example.com", emailVerified: true });
  });

  it("an already-verified address can't be verified again (no email-only sign-in, so two-step stays in the way)", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const owner = new Browser();
    await auth.handler(signUp(owner, "asha@example.com"));
    await auth.handler(verify(owner, "asha@example.com", mail.lastCode(), PW));

    const attacker = new Browser("203.0.113.50");
    const send = await auth.handler(attacker.request("/api/auth/email-otp/send-verification-otp", { body: { email: "asha@example.com", type: "email-verification" } }));
    expect(send.status).toBe(200);
    const r = attacker.keep(await auth.handler(verify(attacker, "asha@example.com", mail.lastCode())));
    expect(r.status).toBe(400);
    expect(await session(auth, attacker)).toBeNull();
  });

  it("an address someone registered first can't be taken by verifying it: the real owner is sent to reset, which locks the first registrant out", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const attacker = new Browser("203.0.113.51");
    await auth.handler(signUp(attacker, "newstudent@example.com", "attacker-pass-9", "squatter"));

    const victim = new Browser();
    await auth.handler(signUp(victim, "newstudent@example.com", "victim-pass-7", "realowner"));   // generic 200
    await auth.handler(victim.request("/api/auth/email-otp/send-verification-otp", { body: { email: "newstudent@example.com", type: "email-verification" } }));
    const v = victim.keep(await auth.handler(verify(victim, "newstudent@example.com", mail.lastCode(), "victim-pass-7")));
    expect(v.status).toBe(400);
    expect((await json(v)).code).toBe("EMAIL_REGISTERED_BEFORE");
    const row = await p.env.DB.prepare("SELECT email_verified AS v FROM user WHERE email = ?").bind("newstudent@example.com").first<{ v: number }>();
    expect(row?.v).toBe(0);                                                        // still unverified: the squatter can't sign in

    // the reset path proves the mailbox, replaces the password and ends every session
    await auth.handler(victim.request("/api/auth/forget-password/email-otp", { body: { email: "newstudent@example.com" } }));
    const reset = await auth.handler(victim.request("/api/auth/email-otp/reset-password", {
      body: { email: "newstudent@example.com", otp: mail.lastCode(), password: "victim-new-pass-8" },
    }));
    expect(reset.status).toBe(200);
    expect((await auth.handler(signIn(new Browser("203.0.113.52"), "newstudent@example.com", "attacker-pass-9"))).status).toBe(401);
  });

  it("verifying without the sign-up password is refused for a password account, but a signed-in user can verify a changed email", async () => {
    const mail = fakeMailer(false);                                                // no email service: signed in at once
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    b.keep(await auth.handler(signUp(b, "ravi@example.com", PW, "ravi")));
    await auth.handler(b.request("/api/auth/email-otp/send-verification-otp", { body: { email: "ravi@example.com", type: "email-verification" } }));
    const v = await auth.handler(verify(b, "ravi@example.com", mail.lastCode()));   // the session is the proof
    expect(v.status).toBe(200);

    const mail2 = fakeMailer(true);
    const auth2 = testAuth(p.env.DB, mail2);
    const c = new Browser("203.0.113.53");
    await auth2.handler(signUp(c, "mo@example.com", PW, "mohan"));
    const bare = await auth2.handler(verify(c, "mo@example.com", mail2.lastCode()));
    expect(bare.status).toBe(400);
    expect((await json(bare)).code).toBe("EMAIL_REGISTERED_BEFORE");
  });
});

describe("the owner address", () => {
  it("can't be claimed by registering it first: nobody gets owner rights until its real owner proves both mailbox and password", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail, { ...SETTINGS });
    const attacker = new Browser("203.0.113.54");
    await auth.handler(signUp(attacker, "owner@example.com", "attacker-pass-9", "fakeboss"));
    const realOwner = new Browser();
    await auth.handler(realOwner.request("/api/auth/email-otp/send-verification-otp", { body: { email: "owner@example.com", type: "email-verification" } }));
    expect((await auth.handler(verify(realOwner, "owner@example.com", mail.lastCode(), "owner-pass-1"))).status).toBe(400);
    const row = await p.env.DB.prepare("SELECT role, email_verified AS v FROM user WHERE email = ?").bind("owner@example.com").first<{ role: string; v: number }>();
    expect(row).toMatchObject({ role: "user", v: 0 });
    expect((await auth.handler(signIn(attacker, "owner@example.com", "attacker-pass-9"))).status).toBe(403);
  });
});

describe("account deletion", () => {
  it("Better Auth's own delete-user door is closed", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    const b = new Browser();
    b.keep(await auth.handler(signUp(b, "del@example.com", PW, "del")));
    const r = await auth.handler(b.request("/api/auth/delete-user", { body: {} }));
    expect(r.status).toBe(404);
    const n = await p.env.DB.prepare("SELECT COUNT(*) AS n FROM user").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
