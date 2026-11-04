/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "./password";

describe("password hashing (PBKDF2-SHA256 through Web Crypto: fits the Workers CPU limit)", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct-horse-1", 1000);
    expect(hash).toMatch(/^pbkdf2-sha256\$1000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword({ hash, password: "correct-horse-1" })).toBe(true);
    expect(await verifyPassword({ hash, password: "correct-horse-2" })).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same", 1000)).not.toBe(await hashPassword("same", 1000));
  });

  it("keeps the iteration count in the hash, so it can be raised later", async () => {
    const old = await hashPassword("pw-12345678", 1000);
    expect(await verifyPassword({ hash: old, password: "pw-12345678" })).toBe(true);
    expect(needsRehash(old, 20_000)).toBe(true);
    expect(needsRehash(await hashPassword("pw-12345678", 20_000), 20_000)).toBe(false);
  });

  it("caps the work at what Cloudflare allows and refuses junk", async () => {
    await expect(hashPassword("x", 200_000)).rejects.toThrow(/100000/);
    expect(await verifyPassword({ hash: "garbage", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "pbkdf2-sha256$0$AAAA$AAAA", password: "x" })).toBe(false);
  });
});
