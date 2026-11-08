/** @vitest-environment node */
// Accounts through the real Better Auth handler on a local D1 (Stage 4.1).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { Browser, fakeMailer, json, SETTINGS, testAuth } from "../test/auth-helpers";

let p: LocalPlatform;
beforeEach(async () => { p = await localPlatform(); }, 60_000);
afterEach(async () => { await p?.dispose(); });

const signUp = (b: Browser, email: string, extra: Record<string, unknown> = {}) =>
  b.request("/api/auth/sign-up/email", { body: { email, password: "correct-horse-1", name: "Asha Rao", username: "asha_r", ...extra } });

describe("sign-up and sign-in", () => {
  it("with an email service: sign-up sends a code, and only a verified account can sign in", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    const r = await auth.handler(signUp(b, "Asha@Example.com"));
    expect(r.status).toBe(200);
    expect(mail.sent[0]).toMatchObject({ to: "asha@example.com", subject: "Your CourseMateAI verification code" });

    const before = await auth.handler(b.request("/api/auth/sign-in/email", { body: { email: "asha@example.com", password: "correct-horse-1" } }));
    expect(before.status).toBe(403);                                  // EMAIL_NOT_VERIFIED

    const v = b.keep(await auth.handler(b.request("/api/auth/email-otp/verify-email", { body: { email: "asha@example.com", otp: mail.lastCode() } })));
    expect(v.status).toBe(200);
    const s = await json(await auth.handler(b.request("/api/auth/get-session")));
    expect(s.user).toMatchObject({ email: "asha@example.com", emailVerified: true, username: "asha_r", role: "user" });
    expect(Number(s.user.id)).toBeGreaterThan(0);
  });

  it("without an email service the account works straight away, and can still be verified from the log", async () => {
    const mail = fakeMailer(false);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    b.keep(await auth.handler(signUp(b, "ravi@example.com", { username: "ravi" })));
    const s = await json(await auth.handler(b.request("/api/auth/get-session")));
    expect(s.user).toMatchObject({ email: "ravi@example.com", emailVerified: false });
    const send = await auth.handler(b.request("/api/auth/email-otp/send-verification-otp", { body: { email: "ravi@example.com", type: "email-verification" } }));
    expect(send.status).toBe(200);
    b.keep(await auth.handler(b.request("/api/auth/email-otp/verify-email", { body: { email: "ravi@example.com", otp: mail.lastCode() } })));
    expect((await json(await auth.handler(b.request("/api/auth/get-session")))).user.emailVerified).toBe(true);
  });

  it("wrong passwords are refused, and signing in again is throttled", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    const b = new Browser("203.0.113.9");
    await auth.handler(signUp(b, "t@example.com", { username: "tester" }));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await auth.handler(b.request("/api/auth/sign-in/email", { body: { email: "t@example.com", password: "nope-nope-1" } }))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("usernames are unique and well-formed", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    await auth.handler(signUp(new Browser(), "a@example.com", { username: "same" }));
    const dup = await auth.handler(signUp(new Browser("198.51.100.8"), "b@example.com", { username: "SAME" }));
    expect(dup.status).toBe(400);
    const bad = await auth.handler(signUp(new Browser("198.51.100.9"), "c@example.com", { username: "no spaces!" }));
    expect(bad.status).toBe(400);
  });

  it("a password can be reset with an emailed code", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    await auth.handler(signUp(b, "r@example.com", { username: "resetter" }));
    await auth.handler(b.request("/api/auth/email-otp/verify-email", { body: { email: "r@example.com", otp: mail.lastCode() } }));
    expect((await auth.handler(b.request("/api/auth/forget-password/email-otp", { body: { email: "r@example.com" } }))).status).toBe(200);
    const reset = await auth.handler(b.request("/api/auth/email-otp/reset-password", {
      body: { email: "r@example.com", otp: mail.lastCode(), password: "brand-new-pass-2" },
    }));
    expect(reset.status).toBe(200);
    const ok = await auth.handler(new Browser("198.51.100.20").request("/api/auth/sign-in/email", { body: { email: "r@example.com", password: "brand-new-pass-2" } }));
    expect(ok.status).toBe(200);
  });
});

describe("the owner", () => {
  it("is an admin once OWNER_EMAIL is verified, and not before", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    await auth.handler(signUp(b, "owner@example.com", { username: "boss" }));
    const row = await p.env.DB.prepare("SELECT role FROM user WHERE email = ?").bind("owner@example.com").first<{ role: string }>();
    expect(row?.role).toBe("user");
    b.keep(await auth.handler(b.request("/api/auth/email-otp/verify-email", { body: { email: "owner@example.com", otp: mail.lastCode() } })));
    const s = await json(await auth.handler(b.request("/api/auth/get-session")));
    expect(s.user.role).toBe("admin");
  });
});

describe("two-step sign-in", () => {
  it("can be turned on with an authenticator app and then asks for a code", async () => {
    const mail = fakeMailer(false);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser();
    b.keep(await auth.handler(signUp(b, "z@example.com", { username: "zed" })));
    const en = await json(await auth.handler(b.request("/api/auth/two-factor/enable", { body: { password: "correct-horse-1" } })));
    expect(en.totpURI).toMatch(/^otpauth:\/\/totp\/CourseMateAI/);
    expect(en.backupCodes.length).toBeGreaterThan(5);
    const { createOTP } = await import("@better-auth/utils/otp");
    const { base32 } = await import("@better-auth/utils/base32");
    const raw = new TextDecoder().decode(base32.decode(new URL(en.totpURI).searchParams.get("secret")!));
    const code = await createOTP(raw).totp();
    expect((await auth.handler(b.request("/api/auth/two-factor/verify-totp", { body: { code } }))).status).toBe(200);

    const fresh = new Browser("198.51.100.30");
    const r = fresh.keep(await auth.handler(fresh.request("/api/auth/sign-in/email", { body: { email: "z@example.com", password: "correct-horse-1" } })));
    expect((await json(r)).twoFactorRedirect).toBe(true);
    expect(await json(await auth.handler(fresh.request("/api/auth/get-session")))).toBeNull();
    const backup = await auth.handler(fresh.request("/api/auth/two-factor/verify-backup-code", { body: { code: en.backupCodes[0] } }));
    fresh.keep(backup);
    expect(backup.status).toBe(200);
    expect((await json(await auth.handler(fresh.request("/api/auth/get-session")))).user.email).toBe("z@example.com");
  });
});

describe("switched off", () => {
  it("the admin plugin's own endpoints and code-only sign-in", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    const b = new Browser();
    b.keep(await auth.handler(signUp(b, "x@example.com", { username: "xx" })));
    for (const path of ["/api/auth/admin/list-users", "/api/auth/admin/set-role", "/api/auth/sign-in/email-otp"]) {
      const res = await auth.handler(b.request(path, { body: {} }));
      expect([404, 405]).toContain(res.status);
    }
  });
});

// Security fix #5: a per-account pause on top of the per-IP limits, and breached passwords refused.
describe("credential stuffing defences", () => {
  const signInEmail = (ip: string, email: string, password: string) =>
    new Browser(ip).request("/api/auth/sign-in/email", { body: { email, password } });
  const signInName = (ip: string, username: string, password: string) =>
    new Browser(ip).request("/api/auth/sign-in/username", { body: { username, password } });

  it("ten wrong passwords from different IPs pause that account (email and username share the count); a reset clears it", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser("192.0.2.1");
    await auth.handler(signUp(b, "victim@example.com", { username: "victim" }));
    await auth.handler(b.request("/api/auth/email-otp/verify-email", { body: { email: "victim@example.com", otp: mail.lastCode() } }));
    for (let i = 0; i < 10; i++) {
      const res = i % 2
        ? await auth.handler(signInEmail(`192.0.2.${10 + i}`, "victim@example.com", "wrong-guess-1"))
        : await auth.handler(signInName(`192.0.2.${10 + i}`, "Victim", "wrong-guess-1"));
      expect(res.status).toBe(401);
    }
    // the right password, from a fresh IP: still paused
    const paused = await auth.handler(signInEmail("192.0.2.99", "victim@example.com", "correct-horse-1"));
    expect(paused.status).toBe(429);
    expect((await json(paused)).code).toBe("ACCOUNT_SIGN_IN_PAUSED");
    expect(Number(paused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await auth.handler(signInName("192.0.2.98", "victim", "correct-horse-1"))).status).toBe(429);

    await auth.handler(new Browser("192.0.2.50").request("/api/auth/forget-password/email-otp", { body: { email: "victim@example.com" } }));
    const reset = await auth.handler(new Browser("192.0.2.50").request("/api/auth/email-otp/reset-password", {
      body: { email: "victim@example.com", otp: mail.lastCode(), password: "brand-new-pass-3" },
    }));
    expect(reset.status).toBe(200);
    expect((await auth.handler(signInEmail("192.0.2.51", "victim@example.com", "brand-new-pass-3"))).status).toBe(200);
  });

  it("a right password clears the count", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    await auth.handler(signUp(new Browser("192.0.2.2"), "k@example.com", { username: "kay" }));
    for (let i = 0; i < 9; i++) expect((await auth.handler(signInEmail(`198.51.100.${30 + i}`, "k@example.com", "nope-nope-1"))).status).toBe(401);
    expect((await auth.handler(signInEmail("198.51.100.60", "k@example.com", "correct-horse-1"))).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await auth.handler(signInEmail(`198.51.100.${70 + i}`, "k@example.com", "nope-nope-1"))).status).toBe(401);
    expect((await auth.handler(signInEmail("198.51.100.90", "k@example.com", "correct-horse-1"))).status).toBe(200);
  });

  it("an email with no account pauses the same way (the pause doesn't reveal who has an account)", async () => {
    const auth = testAuth(p.env.DB, fakeMailer(false));
    for (let i = 0; i < 10; i++) expect((await auth.handler(signInEmail(`203.0.113.${20 + i}`, "nobody@example.com", "x-x-x-x-1"))).status).toBe(401);
    expect((await auth.handler(signInEmail("203.0.113.90", "nobody@example.com", "x-x-x-x-1"))).status).toBe(429);
  });

  it("a breached password is refused at sign-up and reset; if the check can't run, the password is allowed", async () => {
    const breached = new Set(["password1234"]);
    const auth = testAuth(p.env.DB, fakeMailer(false), undefined, { breachCheck: async (pw) => breached.has(pw) });
    const bad = await auth.handler(signUp(new Browser("192.0.2.3"), "p@example.com", { username: "pee", password: "password1234" }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).code).toBe("PASSWORD_COMPROMISED");
    expect((await auth.handler(signUp(new Browser("192.0.2.4"), "p@example.com", { username: "pee" }))).status).toBe(200);

    const down = testAuth(p.env.DB, fakeMailer(false), undefined, { breachCheck: async () => { throw new Error("offline"); } });
    expect((await down.handler(signUp(new Browser("192.0.2.5"), "q@example.com", { username: "queue" }))).status).toBe(200);
  });
});

// Security fix #8: codes per address and per day.
describe("how many codes go out", () => {
  it("at most 5 an hour to one address, however many IPs ask; the reply doesn't change", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    const b = new Browser("192.0.2.200");
    await auth.handler(signUp(b, "inbox@example.com", { username: "inbox" }));          // code 1 (verification)
    for (let i = 0; i < 8; i++) {
      const r = await auth.handler(new Browser(`192.0.2.${210 + i}`).request("/api/auth/forget-password/email-otp", { body: { email: "inbox@example.com" } }));
      expect(r.status).toBe(200);
    }
    expect(mail.sent.filter((m) => m.to === "inbox@example.com")).toHaveLength(5);
  });

  it("stops at the site's daily cap (EMAIL_DAILY_CAP)", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail, { ...SETTINGS, EMAIL_DAILY_CAP: "2" });
    for (let i = 0; i < 4; i++) {
      const r = await auth.handler(signUp(new Browser(`192.0.2.${230 + i}`), `n${i}@example.com`, { username: `newbie${i}` }));
      expect(r.status).toBe(200);
    }
    expect(mail.sent).toHaveLength(2);
  });
});

// Security fix #20: asking for a code takes as long whether or not the account exists.
describe("codes are sent after the reply", () => {
  it("a reset for a real account doesn't wait for the email (the Worker's waitUntil finishes it)", async () => {
    const mail = fakeMailer(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = { ...mail, send: async (m: Parameters<typeof mail.send>[0]) => { await gate; await mail.send(m); } };
    const later: Promise<unknown>[] = [];
    const setup = testAuth(p.env.DB, mail);
    await setup.handler(signUp(new Browser("192.0.2.240"), "slow@example.com", { username: "slowpoke" }));
    const auth = testAuth(p.env.DB, slow, undefined, { runInBackground: (w) => { later.push(w); } });
    const before = mail.sent.length;
    const r = await Promise.race([
      auth.handler(new Browser("192.0.2.241").request("/api/auth/forget-password/email-otp", { body: { email: "slow@example.com" } })),
      new Promise<"blocked">((res) => setTimeout(() => res("blocked"), 2000)),
    ]);
    expect(r).not.toBe("blocked");
    expect((r as Response).status).toBe(200);
    expect(mail.sent.length).toBe(before);                 // not sent yet
    release();
    await Promise.all(later);
    expect(mail.sent.length).toBe(before + 1);
    expect(mail.sent.at(-1)!.to).toBe("slow@example.com");
  });
});
