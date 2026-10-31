import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "@/components/ui/Toast";
import FileUploader from "@/components/FileUploader";
import { stopDocumentPolling, useSessionStore } from "@/hooks/useSessions";
import type { DocumentInfo } from "@/lib/api";

const doc = (status: DocumentInfo["status"], extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: "s1", filename: "notes.pdf", file_hash: "h", status, error: null, chunks: null,
  embedding_model: null, created_at: "t", last_used_at: "t", ...extra,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Server stub: `list` is what GET /documents returns, `statuses` the successive GET /documents/s1 answers. */
function server(list: DocumentInfo[], statuses: DocumentInfo[] = []) {
  const queue = [...statuses];
  vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/v1/documents") return json(200, { documents: list });
    if (pathname === "/api/v1/upload") return json(202, { ok: true, message: "m", session_id: "s1", reused: false, document: doc("queued") });
    if (pathname === "/api/v1/documents/s1") return json(200, queue.shift() ?? statuses[statuses.length - 1]);
    throw new Error(`unexpected ${pathname}`);
  }));
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(1000); });

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.getState().clearDocuments();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  cleanup();
  stopDocumentPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FileUploader", () => {
  it("offers an upload when the server has no document, and follows the stages after choosing a file", async () => {
    server([], [doc("reading"), doc("indexing"), doc("ready", { chunks: 9 })]);
    const { container } = render(<FileUploader sessionId="s1" />);
    expect(screen.getByText("Checking...")).toBeTruthy();            // not offered until the server has been asked
    await settle();
    expect(screen.getByText("Upload PDF")).toBeTruthy();

    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" })] } }); });
    const status = () => screen.getByRole("status").textContent;
    expect(status()).toContain("Queued");                            // shown the moment the upload is accepted

    await tick(); expect(status()).toContain("Reading PDF");
    await tick(); expect(status()).toContain("Indexing");
    await tick();
    expect(screen.queryByRole("status")).toBeNull();                 // the stage tracker is gone...
    expect(screen.getByText("notes.pdf")).toBeTruthy();              // ...replaced by the finished file
    expect(screen.getByLabelText("Replace PDF")).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith("✅ notes.pdf ready!");
  });

  it("shows a document that is already ready on the server after a reload (no client-side memory involved)", async () => {
    server([doc("ready", { filename: "lecture.pdf" })]);
    render(<FileUploader sessionId="s1" />);
    await settle();
    expect(screen.getByText("lecture.pdf")).toBeTruthy();
    expect(screen.queryByText("Upload PDF")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();                    // nothing was processed in front of the user
  });

  it("resumes the stage display for a document still being processed on the server", async () => {
    server([doc("indexing")], [doc("ready")]);
    render(<FileUploader sessionId="s1" />);
    await settle();
    expect(within(screen.getByRole("status")).getByText("Indexing…")).toBeTruthy();
    await tick();
    expect(screen.queryByRole("status")).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("✅ notes.pdf ready!");
  });

  it("shows why processing failed and lets the user try again", async () => {
    server([doc("failed", { error: "No readable text was found in this PDF." })]);
    render(<FileUploader sessionId="s1" />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("No readable text was found in this PDF.");
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("asks for a re-upload when the embedding model changed", async () => {
    server([doc("needs_reindex")]);
    render(<FileUploader sessionId="s1" />);
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/needs re-indexing/i);
    expect(screen.getByText("Re-upload")).toBeTruthy();
  });

  it("announces a failure it watched happen", async () => {
    server([doc("reading")], [doc("failed", { error: "No readable text was found." })]);
    render(<FileUploader sessionId="s1" />);
    await settle();
    await tick();
    expect(toast.error).toHaveBeenCalledWith("No readable text was found.");
  });
});
