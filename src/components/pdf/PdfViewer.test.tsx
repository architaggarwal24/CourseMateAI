import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { frame, json, sseBody, urlOf } from "@/test/sse";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/hooks/useSessions", () => ({ useDocument: () => ({ document: { id: "d1", filename: "bio.pdf", status: "ready" }, loaded: true }) }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() } }));
const pdfjs = vi.hoisted(() => ({ opened: [] as unknown[] }));
vi.mock("@/lib/study/pdf", async (orig) => ({
  ...(await orig<typeof import("@/lib/study/pdf")>()),
  loadPdfJs: async () => ({
    getDocument: (src: unknown) => { pdfjs.opened.push(src); return { promise: Promise.resolve({ numPages: 9, getPage: async () => ({
      getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0], scale: 1 }),
      render: () => ({ promise: Promise.resolve(), cancel: () => {} }), getTextContent: async () => ({ items: [] }) }) }) }; },
    Util: { transform: (a: number[]) => a },
  }),
}));

import ChatView from "@/components/chat/ChatView";
import { resetPdfCache } from "./PdfViewer";

const CITES = [
  { n: 1, doc_id: "d1", doc_name: "bio.pdf", page: 4, label: "bio.pdf · p.4", snippet: "Mitochondria produce ATP…", text: "Mitochondria produce ATP through respiration." },
  { n: 2, doc_id: "d2", doc_name: "chem.pdf", page: 2, label: "chem.pdf · p.2", snippet: "Bonds…", text: "Covalent bonds share electrons." },
];

function server(file: () => Response) {
  const log: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(urlOf(input)).pathname;
    log.push(path);
    if (path.endsWith("/chat/stream")) {
      const b = sseBody();
      b.push(frame("token", { text: "ATP comes from mitochondria [1], bonds from electrons [2]." }));
      b.push(frame("sources", { mode: "chat", sources: ["bio.pdf · p.4", "chem.pdf · p.2"], citations: CITES, blocked: false,
                                needs_clarification: false, rewards: null }));
      b.close();
      return new Response(b.stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (path.endsWith("/file")) return file();
    throw new Error(`unexpected ${path}`);
  }));
  return log;
}

const ask = async (text: string) => {
  const box = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByRole("list", { name: "Sources" });
};

beforeEach(() => { localStorage.clear(); resetPdfCache(); pdfjs.opened.length = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("page-linked citations", () => {
  it("the answer's [n] markers and the source list open the PDF beside the chat, at the cited page", async () => {
    const log = server(() => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "Content-Type": "application/pdf" } }));
    render(<ChatView documentId="d1" />);
    await ask("Where does ATP come from?");
    expect(screen.getByRole("button", { name: "Source 1" }).textContent).toBe("1");
    expect(screen.getAllByRole("button", { name: /^Open source/ }).map((b) => b.textContent))
      .toEqual(["Open source [1]bio.pdf · p.4", "Open source [2]chem.pdf · p.2"]);
    const marker = screen.getByRole("button", { name: "Source 1" });
    marker.focus();
    fireEvent.click(marker);
    const panel = await screen.findByRole("complementary", { name: "bio.pdf" });
    await screen.findByText("Page 4 of 9");
    expect(log).toContain("/api/v1/documents/d1/file");
    expect(pdfjs.opened).toHaveLength(1);
    expect(panel.textContent).toContain("Mitochondria produce ATP through respiration.");       // the passage, in words
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 5 of 9")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to page 4" }));
    expect(await screen.findByText("Page 4 of 9")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "bio.pdf" })).toBeNull());
  });

  it("a PDF from before pages were kept says how to get it back, and still shows the passage", async () => {
    server(() => json(404, { error: { code: "pdf_unavailable", message: "Upload it again.", action: "reupload", details: null } }));
    render(<ChatView documentId="d1" />);
    await ask("Bonds?");
    fireEvent.click(screen.getByRole("button", { name: /Open source ?\[2\]/ }));
    expect(await screen.findByText(/Upload the same file again to open them/)).toBeTruthy();
    expect(screen.getByText("Covalent bonds share electrons.")).toBeTruthy();
  });

  it("a plan without the viewer is told so, with the passage", async () => {
    server(() => json(403, { error: { code: "feature_locked", message: "Sage.", action: null, details: {} } }));
    render(<ChatView documentId="d1" />);
    await ask("ATP?");
    fireEvent.click(screen.getByRole("button", { name: "Source 1" }));
    expect(await screen.findByText(/comes with the Sage plan/)).toBeTruthy();
  });
});
