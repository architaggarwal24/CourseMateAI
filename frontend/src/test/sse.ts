// Test helpers: a Server-Sent Events body the test feeds by hand, and a fetch stub that serves it.
export const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function sseBody() {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    cancel() { cancelled = true; },
  });
  return {
    stream,
    push: (text: string) => controller.enqueue(enc.encode(text)),
    close: () => controller.close(),
    fail: (err: unknown) => controller.error(err),
    get cancelled() { return cancelled; },
  };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** The JSON body a call was made with (fetch(url, init) or fetch(Request)). */
export async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
  if (init?.body) return JSON.parse(String(init.body));
  if (typeof input !== "string" && !(input instanceof URL)) return JSON.parse(await input.clone().text());
  return undefined;
}
