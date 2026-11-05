import { describe, expect, it } from "vitest";
import { emptyAccountForm, fieldForFailure, validateAccount, validateField } from "@/lib/signup";

const form = (over: Partial<typeof emptyAccountForm> = {}) => ({
  fullName: "Ada Lovelace", username: "ada_l", email: "ada@example.com", password: "correct-horse", confirmPassword: "correct-horse", inviteCode: "", ...over,
});

describe("account rules (the server's own messages)", () => {
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

  it("password: 8 to 128 characters, and the confirmation matches", () => {
    expect(validateField("password", form({ password: "short" }))).toBe("Password must be at least 8 characters");
    expect(validateField("password", form({ password: "x".repeat(129) }))).toBe("Password must be at most 128 characters");
    expect(validateField("password", form({ password: "é".repeat(60) }))).toBeNull();
    expect(validateField("confirmPassword", form({ confirmPassword: "different" }))).toBe("Passwords do not match");
  });
});

describe("where a refused sign-up goes", () => {
  it("beside the field it is about, else on the form", () => {
    expect(fieldForFailure({ message: "taken", field: "email" })).toBe("email");
    expect(fieldForFailure({ message: "taken", field: "username" })).toBe("username");
    expect(fieldForFailure({ message: "short", field: "password" })).toBe("password");
    expect(fieldForFailure({ message: "bad code", field: "code" })).toBeNull();
    expect(fieldForFailure({ message: "offline" })).toBeNull();
  });
});
