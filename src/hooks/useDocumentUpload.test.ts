import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }));
const store = vi.hoisted(() => ({ uploadDocument: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ toast: toasts }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));
vi.mock("@/hooks/useSessions", () => ({ useSessionStore: (sel: (s: unknown) => unknown) => sel(store) }));
vi.mock("@/hooks/useCourses", () => ({ useCourses: { getState: () => ({ load: vi.fn(async () => {}) }) } }));

import { useDocumentUpload } from "./useDocumentUpload";

const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
const doc = (id: string) => ({ id, filename: `${id}.pdf`, status: "queued" });

beforeEach(() => { store.uploadDocument.mockReset(); Object.values(toasts).forEach((f) => f.mockClear()); });

describe("useDocumentUpload", () => {
  it("adds several PDFs to a course one after another", async () => {
    store.uploadDocument.mockImplementation(async (_id: unknown, f: File) => doc(f.name.replace(".pdf", "")));
    const { result } = renderHook(() => useDocumentUpload(undefined, "course-1"));
    expect(result.current.multiple).toBe(true);
    let docs: unknown[] = [];
    await act(async () => { docs = await result.current.uploadMany([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")]); });
    expect(docs.map((d: any) => d.id)).toEqual(["a", "b", "c"]);
    expect(store.uploadDocument.mock.calls.map((c) => [c[0], c[1].name, c[2]])).toEqual([
      [undefined, "a.pdf", "course-1"], [undefined, "b.pdf", "course-1"], [undefined, "c.pdf", "course-1"],
    ]);
    expect(result.current.uploading).toBe(false);
  });

  it("skips files a course can't hold (with a way forward) and stops at the first one the server refuses (a plan limit)", async () => {
    store.uploadDocument.mockResolvedValueOnce(doc("a")).mockRejectedValueOnce(new Error("limit"));
    const { result } = renderHook(() => useDocumentUpload(undefined, "course-1"));
    const old = new File(["x"], "essay.doc", { type: "application/msword" });
    const notes = new File(["x"], "notes.txt", { type: "text/plain" });
    let docs: unknown[] = [];
    await act(async () => { docs = await result.current.uploadMany([pdf("a.pdf"), old, notes, pdf("c.pdf")]); });
    expect(docs).toHaveLength(1);
    expect(store.uploadDocument.mock.calls.map((c) => c[1].name)).toEqual(["a.pdf", "notes.txt"]);   // text is fine; c.pdf never sent
    expect(toasts.error).toHaveBeenCalledWith("essay.doc is an old Word file. Save it as .docx (or PDF) first. Skipped.");
    expect(toasts.apiError).toHaveBeenCalledTimes(1);
  });

  it("replacing a document takes one file only", async () => {
    store.uploadDocument.mockResolvedValue(doc("d1"));
    const { result } = renderHook(() => useDocumentUpload("d1", "course-1"));
    expect(result.current.multiple).toBe(false);
    await act(async () => { await result.current.uploadMany([pdf("a.pdf"), pdf("b.pdf")]); });
    expect(store.uploadDocument).toHaveBeenCalledTimes(1);
    expect(store.uploadDocument.mock.calls[0][0]).toBe("d1");
  });
});
