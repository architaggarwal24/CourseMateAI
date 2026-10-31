import { describe, expect, it } from "vitest";
import type { ProviderSpec } from "@/lib/llmProviders";
import { emptyAccountForm, routeSignupFailure, validateAccount, validateField, validateProviderStep } from "@/lib/signup";

const form = (over: Partial<typeof emptyAccountForm> = {}) => ({
  fullName: "Ada Lovelace", username: "ada_l", email: "ada@example.com", password: "correct-horse", confirmPassword: "correct-horse", ...over,
});
const spec = (over: Partial<ProviderSpec> = {}) =>
  ({ id: "gemini", label: "Google Gemini", needs_key: true, base_url_mode: "none", ...over }) as ProviderSpec;

describe("account rules (the backend's own messages)", () => {
  it("accepts a good form", () => expect(validateAccount(form())).toEqual({}));

  it("full name", () => {
    expect(validateField("fullName", form({ fullName: "   " }))).toBe("Full name is required");
    expect(validateField("fullName", form({ fullName: "x".repeat(101) }))).toBe("Full name must be at most 100 characters");
  });

  it("username", () => {
    expect(validateField("username", form({ username: "ab" }))).toBe("Username must be at least 3 characters");
    expect(validateField("username", form({ username: " ab " }))).toBe("Username must be at least 3 characters");   // trimmed, like the server
    expect(validateField("username", form({ username: "x".repeat(33) }))).toBe("Username must be at most 32 characters");
    expect(validateField("username", form({ username: "has space" }))).toBe("Username may only contain letters, numbers, underscores, hyphens and dots");
    expect(validateField("username", form({ username: "a.b-c_9" }))).toBeNull();
  });

  it("email", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.de", "@x.io"]) expect(validateField("email", form({ email: bad })), bad).toBe("Invalid email format");
    expect(validateField("email", form({ email: " Ada@Example.COM " }))).toBeNull();
  });

  it("password: 8 characters, at most 72 bytes, and the confirmation matches", () => {
    expect(validateField("password", form({ password: "short" }))).toBe("Password must be at least 8 characters");
    expect(validateField("password", form({ password: "é".repeat(37) }))).toBe("Password must be at most 72 bytes");   // 74 bytes, 37 characters
    expect(validateField("password", form({ password: "é".repeat(36) }))).toBeNull();
    expect(validateField("confirmPassword", form({ confirmPassword: "different" }))).toBe("Passwords do not match");
  });
});

describe("where a failed registration goes", () => {
  it("account problems go to step 1, beside their field", () => {
    for (const [field, formField] of [["email", "email"], ["username", "username"], ["full_name", "fullName"], ["password", "password"]]) {
      const route = routeSignupFailure({ message: "m", field }, spec());
      expect(route).toMatchObject({ step: 1, accountErrors: { [formField]: "m" }, providerErrors: {} });
      expect(route.general).toBeUndefined();
    }
  });

  it("provider problems stay on step 2, beside the field the picker shows", () => {
    expect(routeSignupFailure({ message: "bad key", field: "api_key" }, spec())).toMatchObject({ step: 2, providerErrors: { api_key: "bad key" } });
    expect(routeSignupFailure({ message: "no such model", field: "llm_model" }, spec())).toMatchObject({ step: 2, providerErrors: { llm_model: "no such model" } });
    expect(routeSignupFailure({ message: "unreachable", field: "llm_base_url" }, spec({ base_url_mode: "required" })))
      .toMatchObject({ step: 2, providerErrors: { llm_base_url: "unreachable" } });
  });

  it("anything else is a message on step 2 - never back at the start", () => {
    // no field, unknown field, or a field this provider's form doesn't show (a base URL for Gemini)
    for (const failure of [{ message: "boom" }, { message: "boom", field: "whatever" }, { message: "boom", field: "llm_base_url" }]) {
      const route = routeSignupFailure(failure, spec());
      expect(route).toMatchObject({ step: 2, accountErrors: {}, providerErrors: {}, general: "boom" });
    }
    expect(routeSignupFailure({ message: "no key", field: "api_key" }, spec({ needs_key: false }))).toMatchObject({ step: 2, general: "no key" });
  });
});

describe("step 2 checks", () => {
  it("names the field that is missing", () => {
    expect(validateProviderStep({ provider: "", model: "", baseUrl: "", apiKey: "" }, undefined)).toEqual({ llm_provider: "Choose an AI provider" });
    expect(validateProviderStep({ provider: "gemini", model: "m", baseUrl: "", apiKey: " " }, spec())).toEqual({ api_key: "Google Gemini API key is required" });
    expect(validateProviderStep({ provider: "x", model: "", baseUrl: "", apiKey: "k" }, spec({ base_url_mode: "required" })))
      .toEqual({ llm_base_url: "Base URL is required", llm_model: "Enter a model name" });
    expect(validateProviderStep({ provider: "gemini", model: "m", baseUrl: "", apiKey: "k" }, spec())).toEqual({});
  });
});
