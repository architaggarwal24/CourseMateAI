/** @vitest-environment node */
// The legal and trust pass (BreakingBreach launch checklist, items 03 and 04): the box at sign-up, and a record of
// which Terms / Privacy Policy version each account accepted, and when.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as terms from "@/app/api/v1/account/terms/route";
import * as exportRoute from "@/app/api/v1/account/export/route";
import { TERMS_VERSION } from "@/lib/legal";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let ip = 40;

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

async function person(email: string, username: string, extra: Record<string, unknown> = {}): Promise<Browser> {
  const b = new Browser(`198.51.100.${ip++}`);
  const r = await authRoute.POST(b.request("/api/auth/sign-up/email", { body: { email, password: "correct-horse-1", name: username, username, ...extra } }));
  expect(r.status).toBe(200);
  b.keep(await authRoute.POST(b.request("/api/auth/email-otp/verify-email", { body: { email, otp: mail.lastCode(email) } })));
  return b;
}
const stored = (email: string) => p.env.DB.prepare("SELECT terms_version AS v, terms_accepted_at AS at FROM user WHERE email = ?").bind(email).first<{ v: string | null; at: number | null }>();

describe("accepting the Terms and Privacy Policy", () => {
  it("the box at sign-up is recorded with its version and the time", async () => {
    const before = Date.now();
    const b = await person("ticked@example.com", "ticked", { termsVersion: TERMS_VERSION });
    expect(await json(await me.GET(b.request("/api/v1/auth/me")))).toMatchObject({ terms_version: TERMS_VERSION, terms_current: TERMS_VERSION });
    const row = await stored("ticked@example.com");
    expect(row!.v).toBe(TERMS_VERSION);
    expect(row!.at).toBeGreaterThanOrEqual(before - 1000);
  });

  it("no box (a Google sign-up, an old account) or an old version counts as not accepted: the app asks", async () => {
    const b = await person("plain@example.com", "plain");
    await person("old@example.com", "oldver", { termsVersion: "2020-01-01" });
    expect((await json(await me.GET(b.request("/api/v1/auth/me")))).terms_version).toBeNull();
    expect(await stored("old@example.com")).toEqual({ v: null, at: null });
    // the date can't be sent in: only the server sets it (an attempt is refused, or overwritten with now)
    const before = Date.now();
    const faked = await authRoute.POST(new Browser("198.51.100.99").request("/api/auth/sign-up/email", {
      body: { email: "faker@example.com", password: "correct-horse-1", name: "f", username: "faker", termsVersion: TERMS_VERSION, termsAcceptedAt: 0 },
    }));
    if (faked.status === 200) expect((await stored("faker@example.com"))!.at).toBeGreaterThanOrEqual(before - 1000);
    else expect(faked.status).toBe(400);
  });

  it("accepting in the app records the current version only", async () => {
    const b = await person("later@example.com", "later");
    const wrong = await terms.POST(b.request("/api/v1/account/terms", { body: { version: "2020-01-01" } }));
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).error.code).toBe("terms_outdated");
    const ok = await json(await terms.POST(b.request("/api/v1/account/terms", { body: { version: TERMS_VERSION } })));
    expect(ok).toMatchObject({ ok: true, terms_version: TERMS_VERSION });
    expect((await stored("later@example.com"))!.v).toBe(TERMS_VERSION);
    expect((await terms.POST(new Browser().request("/api/v1/account/terms", { body: { version: TERMS_VERSION } }))).status).toBe(401);
  });
});

describe("a copy of your data (launch checklist 13)", () => {
  it("is one JSON download of your own rows: profile, terms accepted, study and game data; no secrets", async () => {
    const b = await person("mine@example.com", "mine", { termsVersion: TERMS_VERSION });
    const other = await person("other@example.com", "other");
    const res = await exportRoute.GET(b.request("/api/v1/account/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="coursemateai-data-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.profile).toMatchObject({ email: "mine@example.com", username: "mine", terms_version: TERMS_VERSION });
    for (const key of ["documents", "courses", "review_cards", "progress", "achievements", "deletion_log"]) expect(Array.isArray(data[key])).toBe(true);
    expect(text).not.toContain("other@example.com");
    const hash = await p.env.DB.prepare("SELECT password FROM account WHERE user_id = (SELECT id FROM user WHERE email = 'mine@example.com')").first<string>("password");
    expect(text).not.toContain(hash!);
    expect(data).not.toHaveProperty("session");
    expect((await exportRoute.GET(new Browser().request("/api/v1/account/export"))).status).toBe(401);
    void other;
  });
});
