// Password hashing for the Worker (Phase 4.1). Better Auth's default (scrypt in JavaScript) needs far more CPU than
// the Workers Free plan's 10 ms a request, so passwords use PBKDF2-SHA256 from Web Crypto, which runs natively.
//   format: pbkdf2-sha256$<iterations>$<salt, base64url>$<hash, base64url>
// The iteration count is kept in each hash: raise PASSWORD_HASH_ITERATIONS (Workers allows at most 100,000) after
// moving to Workers Paid and each password is re-hashed at its next sign-in (needsRehash).

export const MAX_ITERATIONS = 100_000;            // Cloudflare's limit for PBKDF2
export const DEFAULT_ITERATIONS = 20_000;         // about 5-10 ms of CPU: inside the free plan's budget

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export function iterationsFrom(env: Record<string, unknown> = process.env): number {
  const n = Number(env.PASSWORD_HASH_ITERATIONS);
  return Number.isInteger(n) && n >= 10_000 && n <= MAX_ITERATIONS ? n : DEFAULT_ITERATIONS;
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  if (iterations > MAX_ITERATIONS) throw new Error(`PBKDF2 iterations must be at most ${MAX_ITERATIONS} on Workers`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(await derive(password, salt, iterations))}`;
}

function parse(hash: string): { iterations: number; salt: Uint8Array<ArrayBuffer>; digest: Uint8Array } | null {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return null;
  try {
    return { iterations, salt: fromB64url(parts[2]), digest: fromB64url(parts[3]) };
  } catch {
    return null;
  }
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const parsed = parse(hash);
  if (!parsed || parsed.digest.length !== 32) return false;
  const got = await derive(password, parsed.salt, parsed.iterations);
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ parsed.digest[i];       // constant time
  return diff === 0;
}

export function needsRehash(hash: string, iterations: number): boolean {
  const parsed = parse(hash);
  return !parsed || parsed.iterations < iterations;
}
