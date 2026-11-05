/** @vitest-environment node */
// Accounts through the real Better Auth handler on a local D1 (Stage 4.1).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { Browser, fakeMailer, json, testAuth } from "../test/auth-helpers";

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
