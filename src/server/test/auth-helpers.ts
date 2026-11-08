// Helpers for tests that sign people up and in through the real Better Auth handler on a local D1.
import { createAuth, type AuthSettings, type CreateAuthOptions } from "../auth";
import type { Mail, Mailer } from "../auth/mailer";

export const ORIGIN = "https://study.example.com";

/** A mailer that keeps what it "sent", so a test can read the code. */
export function fakeMailer(canSend = true): Mailer & { sent: Mail[]; lastCode: (to?: string) => string } {
  const sent: Mail[] = [];
  return {
    canSend,
    via: canSend ? "resend" : "log",
    sent,
    async send(m) { sent.push(m); },
    lastCode(to?: string) {
      const m = [...sent].reverse().find((x) => !to || x.to === to);
      const code = m?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) throw new Error(`no code sent${to ? ` to ${to}` : ""}`);
      return code;
    },
  };
}

export const SETTINGS: AuthSettings = {
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
  OWNER_EMAIL: "owner@example.com",
  PASSWORD_HASH_ITERATIONS: "10000",
  PASSWORD_BREACH_CHECK: "off",
};

export function testAuth(db: D1Database, mailer: Mailer, settings: AuthSettings = SETTINGS, opts: Pick<CreateAuthOptions, "breachCheck" | "runInBackground"> = {}) {
  return createAuth(db, settings, { origin: ORIGIN, mailer, ...opts });
}

/** A tiny cookie jar for one browser. */
export class Browser {
  cookies = new Map<string, string>();
  constructor(public ip = "198.51.100.7") {}
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  keep(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name); else this.cookies.set(name, value);
    }
    return res;
  }
  request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
    const headers: Record<string, string> = { origin: ORIGIN, "cf-connecting-ip": this.ip, ...init.headers };
    if (this.cookies.size) headers.cookie = this.header();
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return new Request(`${ORIGIN}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  }
}

export async function json(res: Response): Promise<any> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
