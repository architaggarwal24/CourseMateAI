import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { frame, json, sseBody, bodyOf, urlOf } from "@/test/sse";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/useSessions", () => ({
  useDocument: () => ({ document: { id: "d1", filename: "bio.pdf", status: "ready" }, loaded: true }),
}));
vi.mock("@/components/ui/Toast", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/Toast")>()),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() },
}));

import ChatView from "@/components/ChatView";

const FINAL = { mode: "chat", sources: ["bio.pdf · p.4", "bio.pdf · p.9"], blocked: false, needs_clarification: false, rewards: null };
const sse = (b: ReturnType<typeof sseBody>) => new Response(b.stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });

/** Server stub: each call to /chat/stream gets the next prepared reply; /chat is the plain fallback. */
function server(opts: { streams?: Array<() => Response>; plain?: () => Response } = {}) {
  const queue = [...(opts.streams ?? [])];
  const log = { paths: [] as string[], bodies: [] as any[], signals: [] as Array<AbortSignal | undefined> };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(urlOf(input)).pathname;
    log.paths.push(path);
    if (path.endsWith("/chat/stream")) {
      log.bodies.push(await bodyOf(input, init));
      log.signals.push(init?.signal ?? undefined);
      const next = queue.shift();
      if (!next) throw new Error("no stream prepared");
      return next();
    }
    if (path.endsWith("/chat")) {
      log.bodies.push(await bodyOf(input, init));
      return opts.plain ? opts.plain() : json(200, { mode: "chat", content: "Fallback answer.", sources: ["bio.pdf · p.1"], rewards: null });
    }
    throw new Error(`unexpected ${path}`);
  }));
  return log;
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const ask = (text: string) => { fireEvent.change(box(), { target: { value: text } }); fireEvent.keyDown(box(), { key: "Enter" }); };
const conversation = () => screen.getByRole("log", { name: "Conversation" });
const answers = () => screen.getAllByRole("article", { name: "Assistant" });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ChatView: streaming", () => {
  it("renders the answer as it arrives, with markdown, and adds sources when it is complete", async () => {
    const body = sseBody();
    const log = server({ streams: [() => sse(body)] });
    render(<ChatView documentId="d1" />);

    ask("What is ATP?");
    expect(screen.getByRole("article", { name: "You" }).textContent).toBe("What is ATP?");
    await waitFor(() => expect(log.paths).toEqual(["/api/v1/chat/stream"]));
    expect(log.bodies[0]).toMatchObject({ question: "What is ATP?", session_id: "d1" });
    expect(screen.getByRole("status", { name: "Waiting for the answer" })).toBeTruthy();

    await act(async () => { body.push(frame("token", { text: "## ATP\n\nIt is the **energy" })); });
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "ATP" })).toBeTruthy());   // text is on screen before the answer ends
    expect(screen.queryByRole("status", { name: "Waiting for the answer" })).toBeNull();
    expect(answers()[0].getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("list", { name: "Sources" })).toBeNull();                                // no sources until the end
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);

    await act(async () => { body.push(frame("token", { text: " currency**.\n\n- step one\n- step two" }) + frame("sources", FINAL)); body.close(); });
    await waitFor(() => expect(screen.getByRole("list", { name: "Sources" })).toBeTruthy());

    const answer = answers()[0];
    expect(answer.querySelector("strong")?.textContent).toBe("energy currency");
    expect(within(answer).getAllByRole("listitem").filter((li) => !li.closest("[aria-label=Sources]")).map((li) => li.textContent)).toEqual(["step one", "step two"]);
    expect(within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["bio.pdf · p.4", "bio.pdf · p.9"]);
    expect(answer.getAttribute("aria-busy")).toBeNull();
    expect(log.paths).toEqual(["/api/v1/chat/stream"]);                                                // no second request
  });

  it("renders a full markdown answer: heading, list, code and a table", async () => {
    const body = sseBody();
    server({ streams: [() => sse(body)] });
    render(<ChatView documentId="d1" />);
    ask("Give me a summary");
    await act(async () => {
      body.push(frame("token", { text: "# Summary\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n" }) + frame("sources", FINAL));
      body.close();
    });
    await waitFor(() => expect(screen.getByRole("list", { name: "Sources" })).toBeTruthy());
    const answer = answers()[0];
    expect(within(answer).getByRole("heading", { level: 1, name: "Summary" })).toBeTruthy();
    expect(answer.querySelector("pre code")?.textContent).toContain("const a = 1;");
    expect(answer.querySelector(".chat-table table")).toBeTruthy();
    expect(within(answer).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["A", "B"]);
  });

  it("makes the user's message visually distinct from the answer", async () => {
    server({ streams: [() => { const b = sseBody(); b.push(frame("token", { text: "Hi." }) + frame("sources", FINAL)); b.close(); return sse(b); }] });
    render(<ChatView documentId="d1" />);
    ask("hello");
    await waitFor(() => expect(answers()).toHaveLength(1));
    const mine = screen.getByRole("article", { name: "You" });
    expect(mine.className).toContain("justify-end");
    expect(answers()[0].className).not.toContain("justify-end");
  });
});

describe("ChatView: not found", () => {
  const notFound = () => {
    const b = sseBody();
    b.push(frame("token", { text: 'I cannot find "What is quantum gravity?" in the uploaded PDF.' }) + frame("sources", { ...FINAL, sources: [], blocked: true }));
    b.close();
    return sse(b);
  };

  it("shows a calm 'couldn't find that' state with a rephrase suggestion instead of the raw reply", async () => {
    server({ streams: [notFound] });
    render(<ChatView documentId="d1" />);
    ask("What is quantum gravity?");
    const card = await screen.findByTestId("not-found");
    expect(within(card).getByRole("heading", { name: "I couldn't find that in your document" })).toBeTruthy();
    expect(card.textContent).toContain("What is quantum gravity?");
    expect(screen.queryByText(/I cannot find/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Sources" })).toBeNull();
    expect(within(card).getByRole("button", { name: "What does the document say about quantum gravity?" })).toBeTruthy();
  });

  it("asks the suggested question when it is clicked", async () => {
    const log = server({ streams: [notFound, () => { const b = sseBody(); b.push(frame("token", { text: "Found it." }) + frame("sources", FINAL)); b.close(); return sse(b); }] });
    render(<ChatView documentId="d1" />);
    ask("What is quantum gravity?");
    fireEvent.click(await within(await screen.findByTestId("not-found")).findByRole("button", { name: "What does the document say about quantum gravity?" }));
    await waitFor(() => expect(log.bodies).toHaveLength(2));
    expect(log.bodies[1].question).toBe("What does the document say about quantum gravity?");
    await waitFor(() => expect(screen.getByText("Found it.")).toBeTruthy());
  });
});

describe("ChatView: input", () => {
  it("Enter sends; Shift+Enter only adds a new line", async () => {
    const log = server({ streams: [() => { const b = sseBody(); b.push(frame("token", { text: "Ok." }) + frame("sources", FINAL)); b.close(); return sse(b); }] });
    render(<ChatView documentId="d1" />);
    fireEvent.change(box(), { target: { value: "line one" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(log.paths).toEqual([]);
    expect(box().value).toBe("line one");

    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(log.paths).toEqual(["/api/v1/chat/stream"]));
    expect(box().value).toBe("");
    expect(log.bodies[0].question).toBe("line one");
  });

  it("does not send an empty message", () => {
    const log = server();
    render(<ChatView documentId="d1" />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(log.paths).toEqual([]);
  });

  it("keeps the input outside the scrolling list", () => {
    server();
    render(<ChatView documentId="d1" />);
    expect(screen.getByTestId("chat-scroll").contains(box())).toBe(false);
  });
});

describe("ChatView: leaving and failing", () => {
  it("cancels the request when the user leaves, and does not fall back to the plain endpoint", async () => {
    const body = sseBody();
    const log = server({ streams: [() => sse(body)] });
    const { unmount } = render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    await waitFor(() => expect(log.signals).toHaveLength(1));
    expect(log.signals[0]?.aborted).toBe(false);
    unmount();
    expect(log.signals[0]?.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(log.paths).toEqual(["/api/v1/chat/stream"]);
  });

  it("falls back to the plain endpoint when the stream fails, and shows the full answer", async () => {
    const log = server({ streams: [() => json(500, { error: { code: "internal", message: "boom", action: null, details: null } })] });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    await waitFor(() => expect(screen.getByText("Fallback answer.")).toBeTruthy());
    expect(log.paths).toEqual(["/api/v1/chat/stream", "/api/v1/chat"]);
    expect(within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["bio.pdf · p.1"]);
  });

  it("drops the partial text when the stream dies midway and the full answer replaces it", async () => {
    const body = sseBody();
    server({ streams: [() => sse(body)] });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    await act(async () => { body.push(frame("token", { text: "Partial answ" })); });
    await waitFor(() => expect(screen.getByText("Partial answ")).toBeTruthy());
    await act(async () => { body.push(frame("error", { error: { code: "ai_request_failed", message: "failed", action: "retry", details: null } })); body.close(); });
    await waitFor(() => expect(screen.getByText("Fallback answer.")).toBeTruthy());
    expect(screen.queryByText(/Partial answ/)).toBeNull();
  });

  it("shows an error message in place of the answer when both endpoints fail", async () => {
    server({
      streams: [() => json(500, { error: { code: "internal", message: "boom", action: null, details: null } })],
      plain: () => json(500, { error: { code: "internal", message: "Still broken.", action: null, details: null } }),
    });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    await waitFor(() => expect(conversation().textContent).toContain("Still broken."));
    expect(box().hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);      // empty input, not stuck loading
  });
});

describe("ChatView: live regions", () => {
  it("the conversation is busy while an answer streams (no per-token announcements) and a status line says when it starts and ends", async () => {
    const body = sseBody();
    server({ streams: [() => sse(body)] });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    await waitFor(() => expect(conversation().getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByText("The assistant is answering.").getAttribute("role")).toBe("status");
    await act(async () => {
      body.push(frame("token", { text: "ATP is energy." }));
      body.push(frame("sources", { sources: [], blocked: false, needs_clarification: false }));
      body.close();
    });
    await waitFor(() => expect(screen.getByText("Answer complete.")).toBeTruthy());
    expect(conversation().hasAttribute("aria-busy")).toBe(false);
  });
});

describe("ChatView: errors", () => {
  const failing = (code: string, message: string, action: string | null, details: object | null = null, headers: Record<string, string> = {}) =>
    () => new Response(JSON.stringify({ error: { code, message, action, details } }), {
      status: code === "unauthenticated" ? 401 : code === "rate_limited" || code === "provider_quota" ? 429 : 400,
      headers: { "Content-Type": "application/json", ...headers },
    });

  it("a provider_key_rejected answer is an inline error with Open Settings - not a chat message, not saved", async () => {
    const stream = failing("provider_key_rejected", "Your API key was rejected.", "settings");
    server({ streams: [stream], plain: stream });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your API key was rejected.");
    expect(screen.getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe("/account/settings");
    expect(screen.queryAllByRole("article", { name: "Assistant" })).toHaveLength(0);      // no ⚠️ pseudo-answer
    expect(JSON.stringify(localStorage)).not.toContain("API key was rejected");
  });

  it("provider_unreachable offers Retry, which asks the same question again (once in the history)", async () => {
    const log = server({
      streams: [failing("provider_unreachable", "The AI provider can't be reached.", "retry"), () => new Response("", { status: 500 })],
      plain: failing("provider_unreachable", "The AI provider can't be reached.", "retry"),
    });
    render(<ChatView documentId="d1" />);
    ask("What is ATP?");
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(log.bodies.filter((b) => b.question === "What is ATP?").length).toBeGreaterThan(1));
    const retried = log.bodies[log.bodies.length - 1];
    expect(retried.history ?? []).toEqual([]);                                  // the failed question is not its own history
    expect(screen.getAllByText("What is ATP?")).toHaveLength(1);
  });

  it("session_expired offers Re-upload, unauthenticated offers Log in", async () => {
    const expired = failing("session_expired", "Your document has expired.", "reupload");
    server({ streams: [expired], plain: expired });
    const { unmount } = render(<ChatView documentId="d1" />);
    ask("q1");
    expect((await screen.findByRole("link", { name: "Re-upload" })).getAttribute("href")).toBe("/study");
    unmount();

    const loggedOut = failing("unauthenticated", "Please log in to continue.", "relogin");
    server({ streams: [loggedOut], plain: loggedOut });
    vi.stubGlobal("location", { href: "/" });
    render(<ChatView documentId="d1" />);
    ask("q2");
    expect((await screen.findByRole("link", { name: "Log in" })).getAttribute("href")).toBe("/login");
  });

  it("provider_quota links to the provider's usage page; rate_limited counts down from Retry-After", async () => {
    const quota = failing("provider_quota", "Quota used up.", "settings", { usage_url: "https://aistudio.google.com/usage", provider: "gemini" });
    server({ streams: [quota], plain: quota });
    const { unmount } = render(<ChatView documentId="d1" />);
    ask("q1");
    expect((await screen.findByRole("link", { name: "Check usage" })).getAttribute("href")).toBe("https://aistudio.google.com/usage");
    unmount();

    const limited = failing("rate_limited", "Too many requests.", "retry", null, { "Retry-After": "30" });
    server({ streams: [limited], plain: limited });
    render(<ChatView documentId="d1" />);
    ask("q2");
    const wait = (await screen.findByRole("button", { name: /Retry in \d+s/ })) as HTMLButtonElement;
    expect(wait.disabled).toBe(true);
    expect(wait.textContent).toMatch(/Retry in (30|29)s/);
  });
});

describe("ChatView: auto-scroll", () => {
  /** A scroll box of 400px showing a list `height` px tall; the test moves scrollTop like a user would. */
  function geometry(el: HTMLElement, state: { height: number; top: number }) {
    Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 400 });
    Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => state.height });
    Object.defineProperty(el, "scrollTop", { configurable: true, get: () => state.top, set: (v: number) => { state.top = v; } });
  }

  it("follows new text at the bottom, leaves a reader who scrolled up alone, and returns on 'Latest'", async () => {
    const body = sseBody();
    server({ streams: [() => sse(body)] });
    render(<ChatView documentId="d1" />);
    const scroller = screen.getByTestId("chat-scroll");
    const state = { height: 1000, top: 600 };                       // at the bottom (1000 - 600 - 400 = 0)
    geometry(scroller, state);

    ask("Explain everything");
    await act(async () => { body.push(frame("token", { text: "First part. " })); });
    state.height = 1200;
    await act(async () => { body.push(frame("token", { text: "More text. " })); });
    expect(state.top).toBe(1200);                                   // followed to the end

    state.top = 300;                                                // the reader scrolls up
    fireEvent.scroll(scroller);
    expect(await screen.findByRole("button", { name: "Jump to latest" })).toBeTruthy();
    state.height = 1500;
    await act(async () => { body.push(frame("token", { text: "Even more text. " })); });
    expect(state.top).toBe(300);                                    // not dragged back down

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(state.top).toBe(1500);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();

    state.height = 1800;
    await act(async () => { body.push(frame("token", { text: "And again." })); });
    expect(state.top).toBe(1800);                                   // following again

    await act(async () => { body.push(frame("sources", FINAL)); body.close(); });
  });
});
