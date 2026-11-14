// The server's logs, scrubbed (the speed and reliability pass, after the BreakingBreach AI security checklist,
// control 24: "redact sensitive values before they are stored"). Cloudflare keeps Worker logs and anyone with the
// dashboard can read them, so an email address, a key or a token never reaches them: an error message from a
// provider or a library can quote one.
//
// Use warn / error from here instead of console.* in server code (src/server/log.test.ts keeps it that way).

const PATTERNS: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b(?:sk|pk|rk|nvapi|AIza|ghp|gho|ghs|xox[abp]|rzp_(?:live|test))[-_A-Za-z0-9]{8,}/g, "[key]"],
  [/\bBearer\s+[-._~+/A-Za-z0-9]+=*/gi, "Bearer [token]"],
  [/\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)["']?[^\s"',;]+/gi, (_m, name: string, sep: string) => `${name}${sep}[redacted]`],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[hex]"],
];

/** The text with emails, keys, tokens and long secrets replaced by placeholders. */
export function redact(text: string): string {
  let out = text;
  for (const [re, to] of PATTERNS) out = out.replace(re, to as never);
  return out;
}

const scrub = (v: unknown): unknown => {
  if (typeof v === "string") return redact(v);
  if (v instanceof Error) return redact(`${v.name}: ${v.message}`);
  if (v && typeof v === "object") { try { return redact(JSON.stringify(v)); } catch { return "[object]"; } }
  return v;
};

export const warn = (...parts: unknown[]) => console.warn(...parts.map(scrub));
export const error = (...parts: unknown[]) => console.error(...parts.map(scrub));
export const info = (...parts: unknown[]) => console.log(...parts.map(scrub));
