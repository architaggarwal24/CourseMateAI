import { Suspense, lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The router: the test sets the URL's query string and watches router.replace.
const nav = vi.hoisted(() => ({ query: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => "/study",
}));

// The four tabs are stubs that show which document they were given.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
    const Lazy = lazy(loader);
    return (props: any) => <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  },
}));
for (const [file, name] of [["ChatView", "chat"], ["QuizView", "quiz"], ["NotesView", "notes"], ["FlashcardView", "flashcards"]]) {
  vi.doMock(`@/components/${file}`, () => ({
    default: (p: { documentId?: string; restoreSessionId?: string }) =>
      <div data-testid={`tab-${name}`}>{name}|{p.documentId ?? "none"}|{p.restoreSessionId ?? ""}</div>,
  }));
}

import StudyWorkspace from "@/components/shell/StudyWorkspace";
import { stopDocumentPolling, useSessionStore } from "@/hooks/useSessions";
import type { DocumentInfo } from "@/lib/api";

const doc = (status: DocumentInfo["status"], extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: "d1", filename: "lecture.pdf", file_hash: "h", status, error: null, chunks: 42,
  embedding_model: "m", created_at: "2026-10-01T00:00:00Z", last_used_at: "2026-10-01T00:00:00Z", ...extra,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const gone = () => json(404, { error: { code: "document_not_found", message: "That document couldn't be found.", action: null, details: null } });

/** The server: `docs` is what it holds (mutable, so a test can delete a document behind the page's back). */
function server(docs: DocumentInfo[]) {
  const uploads: FormData[] = [];
  const spy = vi.fn(async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/v1/documents") return json(200, { documents: [...docs] });
    if (pathname === "/api/v1/upload") {
      const form = await req.formData();
      uploads.push(form);
      const id = String(form.get("session_id") || "new-id");
      const created = doc("queued", { id, filename: (form.get("file") as File).name });
      docs.push(created);
      return json(202, { ok: true, message: "ok", session_id: id, reused: false, document: created });
    }
    const m = pathname.match(/^\/api\/v1\/documents\/(.+)$/);
    if (m) { const found = docs.find((d) => d.id === m[1]); return found ? json(200, found) : gone(); }
    throw new Error(`unexpected ${pathname}`);
  });
  vi.stubGlobal("fetch", spy);
  return { docs, uploads };
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  useSessionStore.getState().clearDocuments();
  nav.query = "";
  nav.replace.mockClear();
});
afterEach(() => {
  cleanup();
  stopDocumentPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A tab's stub (the views are lazy-loaded: let the import finish first). */
const tabView = async (name: string) => {
  for (let i = 0; i < 5 && !screen.queryByTestId(`tab-${name}`); i++) await settle();
  return screen.getByTestId(`tab-${name}`);
};

const open = async (query: string) => {
  nav.query = query;
  render(<StudyWorkspace />);
  await settle();
};

describe("Study workspace: the document comes first", () => {
  it("lists the server's document in a persistent header (name, chunks, status) and puts it in the URL", async () => {
    server([doc("ready")]);
    await open("tab=quiz");
    const header = screen.getByRole("banner", { name: "Active document" });
    expect(header.textContent).toContain("lecture.pdf");
    expect(header.textContent).toContain("42 chunks");
    expect(header.textContent).toContain("Ready");
    expect(screen.getByLabelText("Replace PDF")).toBeTruthy();
    expect((await tabView("quiz")).textContent).toBe("quiz|d1|");   // the tab got the document
    expect(nav.replace).toHaveBeenCalledWith("/study?tab=quiz&doc=d1");
  });

  it("shows a document that is still being indexed, then a failed one with its reason", async () => {
    server([doc("indexing", { chunks: null })]);
    await open("tab=chat&doc=d1");
    expect(screen.getByRole("banner").textContent).toContain("Indexing");
    cleanup();

    useSessionStore.getState().clearDocuments();
    server([doc("failed", { error: "No readable text was found in this PDF." })]);
    await open("tab=chat&doc=d1");
    expect(screen.getByRole("banner").textContent).toContain("Failed");
    expect(screen.getByRole("alert").textContent).toContain("No readable text was found in this PDF.");
  });

  it("offers an upload when the server has no documents (no 'gone' state for a new user)", async () => {
    server([]);
    await open("");
    expect(screen.getByRole("banner").textContent).toContain("No document yet");
    expect(screen.getByText("Upload PDF")).toBeTruthy();
    expect(screen.queryByText(/no longer available/i)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
    expect((await tabView("chat")).textContent).toBe("chat|none|");
  });

  it("Replace uploads over the same document id", async () => {
    const s = server([doc("ready")]);
    await open("tab=chat&doc=d1");
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "v2.pdf", { type: "application/pdf" })] } }); });
    await vi.waitFor(() => expect(s.uploads).toHaveLength(1));        // the server stub reads the multipart body asynchronously
    expect(s.uploads[0].get("session_id")).toBe("d1");
    expect(screen.getByRole("banner").textContent).toContain("Indexing");     // the replaced document is being processed
  });
});

describe("Study workspace: a document the server no longer has", () => {
  it("shows one clear re-upload state instead of the tab (after a restart / expiry, on load)", async () => {
    server([]);
    await open("tab=chat&doc=d1");
    expect(screen.getByText("This document is no longer available")).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("Expired");
    expect(screen.queryByTestId("tab-chat")).toBeNull();                     // chat is not left to fail
    expect(screen.getAllByText("Upload PDF")).toHaveLength(1);                    // one action, in the state itself
  });

  it("notices a document deleted while the page is open (window focus) and lets the user re-upload it under the same id", async () => {
    const s = server([doc("ready")]);
    await open("tab=notes&doc=d1");
    expect((await tabView("notes")).textContent).toBe("notes|d1|");

    s.docs.length = 0;                                                       // deleted on the server
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("This document is no longer available")).toBeTruthy();

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "lecture.pdf", { type: "application/pdf" })] } }); });
    await vi.waitFor(() => expect(s.uploads).toHaveLength(1));
    expect(s.uploads[0].get("session_id")).toBe("d1");
    expect(screen.queryByText("This document is no longer available")).toBeNull();
    expect(screen.getByRole("banner").textContent).toContain("Indexing");
  });

  it("re-checks when a request reports its document gone", async () => {
    const s = server([doc("ready")]);
    await open("tab=chat&doc=d1");
    s.docs.length = 0;
    await act(async () => { window.dispatchEvent(new CustomEvent("cmai:document-gone")); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("This document is no longer available")).toBeTruthy();
  });
});

describe("Study workspace: the tab lives in the URL", () => {
  it("renders the tab named by ?tab= and falls back to chat for a missing or unknown one", async () => {
    server([doc("ready")]);
    for (const [query, tab] of [["tab=flashcards&doc=d1", "flashcards"], ["tab=notes&doc=d1", "notes"], ["doc=d1", "chat"], ["tab=bogus&doc=d1", "chat"]]) {
      await open(query);
      expect(await tabView(tab), query).toBeTruthy();
      cleanup();
    }
  });

  it("tab links are plain URLs that keep the document and drop a reopened session", async () => {
    server([doc("ready")]);
    await open("tab=chat&doc=d1&session=s9");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/study?tab=chat&doc=d1", "/study?tab=quiz&doc=d1", "/study?tab=notes&doc=d1", "/study?tab=flashcards&doc=d1"]);
    expect(screen.getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Quiz" }).getAttribute("aria-current")).toBeNull();
    expect((await tabView("chat")).textContent).toBe("chat|d1|s9");   // history reopens the saved session
  });

  it("a saved session made on a document (older sessions share its id) selects that document", async () => {
    server([doc("ready", { id: "a", last_used_at: "2026-10-02T00:00:00Z" }), doc("ready", { id: "b", filename: "other.pdf" })]);
    await open("tab=chat&session=b");
    expect(screen.getByRole("banner").textContent).toContain("other.pdf");
    expect(nav.replace).toHaveBeenCalledWith("/study?tab=chat&doc=b&session=b");
  });
});
