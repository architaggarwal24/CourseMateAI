// Idempotency keys for record-creating requests (server: src/server/idempotency.ts). One key per user action: the
// same action with the same input reuses its key until it succeeds, so a retry after a timeout or a dropped answer
// gets the first answer back instead of a second course, exam, code, potion or checkout. After success the next
// action gets a new key. (The buttons are also disabled while their request runs.)

const open = new Map<string, string>();

function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID is missing outside secure contexts (http on a LAN address); getRandomValues is not.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The key for `action` with this input, as a header, and `done()` to call once it has succeeded. */
export function idempotencyKey(action: string, input: unknown): { headers: { "Idempotency-Key": string }; done: () => void } {
  const id = `${action}\n${JSON.stringify(input ?? null)}`;
  let key = open.get(id);
  if (!key) { key = newKey(); open.set(id, key); }
  return { headers: { "Idempotency-Key": key }, done: () => { if (open.get(id) === key) open.delete(id); } };
}
