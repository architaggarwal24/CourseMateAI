/** @vitest-environment node */
// Which sign-in providers are on, and which may sign into an existing account with the same email.
import { describe, expect, it } from "vitest";
import { authOptions, socialProviders } from "./index";
import { SETTINGS } from "../test/auth-helpers";

describe("socialProviders", () => {
  it("only the ones with both an id and a secret", () => {
    expect(Object.keys(socialProviders({}))).toEqual([]);
    expect(Object.keys(socialProviders({ GOOGLE_CLIENT_ID: "g", GITHUB_CLIENT_ID: "x" }))).toEqual([]);
    expect(Object.keys(socialProviders({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", GITHUB_CLIENT_ID: "x", GITHUB_CLIENT_SECRET: "y" })).sort())
      .toEqual(["github", "google"]);
  });

  it("only Google is trusted to sign into an existing account with the same email (GitHub: only verified addresses)", () => {
    const o = authOptions({} as D1Database, { ...SETTINGS, NODE_ENV: "test" });
    expect(o.account.accountLinking).toEqual({ enabled: true, trustedProviders: ["google"] });
  });
});
