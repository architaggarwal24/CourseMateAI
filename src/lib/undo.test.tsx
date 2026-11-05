import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastHost } from "@/components/ui/Toast";
import { toast } from "@/components/ui/Toast";
import { flushUndoables, undoable, UNDO_MS } from "./undo";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { act(() => toast.dismiss()); cleanup(); vi.useRealTimers(); });

describe("undoable", () => {
  it("runs the change after the undo window, with an Undo toast (role=status) until then", async () => {
    const commit = vi.fn(async () => {});
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => { undoable({ message: "biology.pdf deleted", commit, undo }); });
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("biology.pdf deleted");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(UNDO_MS).toBeGreaterThanOrEqual(5000);
    expect(UNDO_MS).toBeLessThanOrEqual(10000);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS - 100); });
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("Undo puts it back and never sends the change", async () => {
    const commit = vi.fn(async () => {});
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => { undoable({ message: "Card removed", commit, undo }); });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_MS * 2); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("a failed change is put back and reported; leaving the page sends what is pending", async () => {
    const err = new Error("nope");
    const undo = vi.fn();
    const onError = vi.fn();
    act(() => { undoable({ message: "x", commit: async () => { throw err; }, undo, onError }); });
    const later = vi.fn(async () => {});
    act(() => { undoable({ message: "y", commit: later, undo: () => {} }); });
    await act(async () => { flushUndoables(); await Promise.resolve(); await Promise.resolve(); });
    expect(later).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err);
  });
});
