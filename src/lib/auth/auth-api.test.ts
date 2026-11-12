import { afterEach, describe, expect, it, vi } from "vitest";
import { failureFrom, providerErrorMessage, signIn, signInWithProvider, signUp } from "./auth-api";

const res = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("failureFrom: Better Auth's refusals in CourseMateAI's words", () => {
  it("names the field and says it plainly", async () => {
    expect(await failureFrom(res({ code: "USERNAME_IS_ALREADY_TAKEN", message: "Username is already taken. Please try another." }, 400)))
      .toMatchObject({ field: "username", message: "That username is already taken" });
    expect(await failureFrom(res({ code: "USER_ALREADY_EXISTS", message: "x" }, 422))).toMatchObject({ field: "email" });
    expect(await failureFrom(res({ code: "INVALID_OTP", message: "x" }, 400))).toMatchObject({ field: "code" });
    expect((await failureFrom(res({ code: "INVALID_EMAIL_OR_PASSWORD", message: "x" }, 401))).message).toMatch(/don't match/);
  });
  it("too many tries, with the wait", async () => {
    expect(await failureFrom(res({ message: "Too many requests" }, 429, { "x-retry-after": "42" }))).toMatchObject({ code: "RATE_LIMITED", retryAfter: 42 });
    expect(await failureFrom(res({ code: "ACCOUNT_SIGN_IN_PAUSED", message: "x" }, 429, { "retry-after": "300" })))
      .toMatchObject({ code: "ACCOUNT_SIGN_IN_PAUSED", retryAfter: 300, message: expect.stringMatching(/reset your password/) });
    expect(await failureFrom(res({ code: "PASSWORD_COMPROMISED", message: "x" }, 400))).toMatchObject({ field: "password", message: expect.stringMatching(/data breach/) });
  });
  it("our own error shape too, and anything else", async () => {
    expect((await failureFrom(res({ error: { code: "x", message: "Nope" } }, 400))).message).toBe("Nope");
    expect((await failureFrom(new Response("<html>", { status: 500 }))).message).toMatch(/went wrong/);
  });
});

describe("signIn", () => {
  const answer = (r: Response) => vi.stubGlobal("fetch", vi.fn(async () => r));
  it("signed in, two-step, unverified, refused", async () => {
    answer(res({ token: "t" }, 200));
    expect(await signIn("a@x.io", "pw")).toEqual({ status: "signed-in" });
    answer(res({ twoFactorRedirect: true }, 200));
    expect(await signIn("a@x.io", "pw")).toEqual({ status: "two-factor" });
    answer(res({ code: "EMAIL_NOT_VERIFIED", message: "x" }, 403));
    expect(await signIn("a@x.io", "pw")).toEqual({ status: "verify-email" });
    answer(res({ code: "BANNED_USER", message: "x" }, 403));
    expect(await signIn("a@x.io", "pw")).toMatchObject({ status: "failed", failure: { message: expect.stringMatching(/suspended/) } });
  });
  it("offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await signIn("a@x.io", "pw")).toMatchObject({ status: "failed", failure: { message: expect.stringMatching(/Couldn't reach/) } });
  });
});

describe("signUp", () => {
  it("sends the account and says whether it is signed in yet", async () => {
    const f = vi.fn(async () => res({ token: null, user: {} }, 200));
    vi.stubGlobal("fetch", f);
    expect(await signUp({ email: " a@x.io ", password: "pw-12345678", username: "ada", fullName: " Ada " })).toEqual({ ok: true, signedIn: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-up/email");
    expect(JSON.parse(String(init.body))).toMatchObject({ email: "a@x.io", name: "Ada", username: "ada", displayUsername: "ada" });
  });
});

describe("Google and GitHub sign-in", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("asks the server for the provider's page and comes back to the login page on a failure", async () => {
    const f = vi.fn(async () => res({ url: "https://github.com/login/oauth/authorize?x=1", redirect: true }, 200));
    vi.stubGlobal("fetch", f);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    expect(await signInWithProvider("github")).toBeNull();
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/sign-in/social");
    expect(JSON.parse(String(init.body))).toEqual({ provider: "github", callbackURL: "/study", errorCallbackURL: "/login?sso=github" });
    expect(assign).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?x=1");
  });

  it("explains what came back", () => {
    expect(providerErrorMessage("github", "account_not_linked")).toBe(
      "There's already a CourseMateAI account with this email. Log in the way you signed up (your email and password, or Google).");
    expect(providerErrorMessage("github", "email_not_found")).toMatch(/^GitHub didn't share an email address/);
    expect(providerErrorMessage("github", "access_denied")).toBe("GitHub sign-in was cancelled.");
    expect(providerErrorMessage("github", "invalid_code")).toBe("GitHub sign-in didn't finish. Please try again.");
    expect(providerErrorMessage("microsoft", "invalid_code")).toBeNull();                                   // not offered
    expect(providerErrorMessage(null, "google")).toBe("Google sign-in didn't finish. Please try again.");   // the old link
    expect(providerErrorMessage("evil", "x")).toBeNull();
    expect(providerErrorMessage("github", null)).toBeNull();
  });
});
