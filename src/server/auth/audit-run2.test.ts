/** @vitest-environment node */
// Security audit run 2 (auth findings), each kept as a regression test:
//   * the password a first verification is checked against is the one that came with the code, never one another
//     request for the same address slipped in at the same moment;
//   * a reset that is the first proof of an address drops Google and GitHub logins added by whoever held it before;
//   * email codes come from two budgets, so throwaway sign-ups can't use up the codes real accounts need;
//   * no "sign-in" code is ever sent (email sign-in is off), and asking for a reset again re-sends the same code.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { Browser, fakeMailer, json, testAuth, SETTINGS } from "../test/auth-helpers";

let p: LocalPlatform;
beforeEach(async () => { p = await localPlatform(); }, 60_000);
afterEach(async () => { await p?.dispose(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const signUp = (b: Browser, email: string, password: string, username: string) =>
  b.request("/api/auth/sign-up/email", { body: { email, password, name: "Test Person", username } });
const forgot = (b: Browser, email: string) => b.request("/api/auth/forget-password/email-otp", { body: { email } });

describe("first verification under concurrency", () => {
  it("a codeless request for the same address can't swap its password in while the real one is checked", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    await auth.handler(signUp(new Browser("203.0.113.80"), "owner@example.com", "attacker-pass-9", "fakeboss"));
    const owner = new Browser("198.51.100.20");
    await auth.handler(owner.request("/api/auth/email-otp/send-verification-otp", { body: { email: "owner@example.com", type: "email-verification" } }));
    const pending = auth.handler(owner.request("/api/auth/email-otp/verify-email", {
      body: { email: "owner@example.com", otp: mail.lastCode("owner@example.com"), password: "owner-pass-1" },
    }));
    const spray: Promise<Response>[] = [];
    for (let i = 0; i < 12; i++) {
      if (i) await sleep(3);
      spray.push(auth.handler(new Browser(`203.0.113.${100 + i}`).request("/api/auth/email-otp/verify-email", {
        body: { email: "owner@example.com", password: "attacker-pass-9" },
      })));
    }
    const res = await pending;
    await Promise.all(spray);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe("EMAIL_REGISTERED_BEFORE");
    expect(await p.env.DB.prepare("SELECT role, email_verified AS v FROM user WHERE email = 'owner@example.com'").first())
      .toMatchObject({ role: "user", v: 0 });
    const squatter = await auth.handler(new Browser("203.0.113.90").request("/api/auth/sign-in/email", { body: { email: "owner@example.com", password: "attacker-pass-9" } }));
    expect(squatter.status).toBe(403);                               // still unverified: no session
  });
});

describe("taking an address over by reset", () => {
  it("drops the social logins of whoever set the address first, and keeps a verified account's", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    await auth.handler(signUp(new Browser("203.0.113.81"), "owner@example.com", "attacker-pass-9", "fakeboss"));
    const id = await p.env.DB.prepare("SELECT id FROM user WHERE email = 'owner@example.com'").first<number>("id");
    await p.env.DB.prepare("INSERT INTO account (account_id, provider_id, user_id, created_at, updated_at) VALUES ('g-attacker', 'google', ?, 0, 0)").bind(id).run();

    const real = new Browser("198.51.100.30");
    await auth.handler(forgot(real, "owner@example.com"));
    const reset = await auth.handler(real.request("/api/auth/email-otp/reset-password", {
      body: { email: "owner@example.com", otp: mail.lastCode("owner@example.com"), password: "owner-new-pass-2" },
    }));
    expect(reset.status).toBe(200);
    const providers = (await p.env.DB.prepare("SELECT provider_id FROM account WHERE user_id = ?").bind(id).all()).results.map((r) => r.provider_id);
    expect(providers).toEqual(["credential"]);

    // a verified account's own reset leaves its links alone
    await p.env.DB.prepare("INSERT INTO account (account_id, provider_id, user_id, created_at, updated_at) VALUES ('g-owner', 'google', ?, 0, 0)").bind(id).run();
    await auth.handler(forgot(real, "owner@example.com"));
    await auth.handler(real.request("/api/auth/email-otp/reset-password", {
      body: { email: "owner@example.com", otp: mail.lastCode("owner@example.com"), password: "owner-new-pass-3" },
    }));
    expect((await p.env.DB.prepare("SELECT COUNT(*) AS n FROM account WHERE user_id = ? AND provider_id = 'google'").bind(id).first("n"))).toBe(1);
  });
});

describe("email budgets", () => {
  it("sign-up codes use at most their share of the daily cap; a verified account's reset still goes out", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail, { ...SETTINGS, EMAIL_DAILY_CAP: "5" });   // 3 for sign-ups, the rest for accounts
    const v = new Browser("192.0.2.10");
    await auth.handler(signUp(v, "real@example.com", "correct-horse-1", "realone"));
    expect((await auth.handler(v.request("/api/auth/email-otp/verify-email", {
      body: { email: "real@example.com", otp: mail.lastCode(), password: "correct-horse-1" },
    }))).status).toBe(200);
    for (let i = 0; i < 6; i++) await auth.handler(signUp(new Browser(`192.0.2.${20 + i}`), `junk${i}@example.com`, "correct-horse-1", `junk${i}`));
    expect(mail.sent).toHaveLength(3);
    await auth.handler(forgot(new Browser("192.0.2.40"), "real@example.com"));
    expect(mail.sent.at(-1)?.to).toBe("real@example.com");
  });

  it("never sends a sign-in code, to an account or to an address without one", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    await auth.handler(signUp(new Browser("192.0.2.50"), "has@example.com", "correct-horse-1", "hasone"));
    const before = mail.sent.length;
    for (const email of ["has@example.com", "nobody@example.com"]) {
      const r = await auth.handler(new Browser("192.0.2.51").request("/api/auth/email-otp/send-verification-otp", { body: { email, type: "sign-in" } }));
      expect(r.status).toBe(200);                                     // same reply either way
    }
    expect(mail.sent).toHaveLength(before);
  });

  it("asking for a reset again re-sends the code already in the inbox instead of voiding it", async () => {
    const mail = fakeMailer(true);
    const auth = testAuth(p.env.DB, mail);
    await auth.handler(signUp(new Browser("192.0.2.60"), "keep@example.com", "correct-horse-1", "keeper"));
    await auth.handler(forgot(new Browser("192.0.2.61"), "keep@example.com"));
    const first = mail.lastCode("keep@example.com");
    await auth.handler(forgot(new Browser("192.0.2.62"), "keep@example.com"));          // someone else asks again
    expect(mail.lastCode("keep@example.com")).toBe(first);
    const reset = await auth.handler(new Browser("192.0.2.63").request("/api/auth/email-otp/reset-password", {
      body: { email: "keep@example.com", otp: first, password: "brand-new-pass-4" },
    }));
    expect(reset.status).toBe(200);
  });
});
