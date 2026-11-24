// Files dropped anywhere or pasted (hooks/useFileDrop): the latest screen to ask takes them, a dialog over a page
// takes them while open, a paste inside a text box stays a normal paste, and nothing is taken when nobody asks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { isEditable, resetFileDropForTests, useFileDrop, type FileArrival } from "./useFileDrop";

const pdf = (name = "notes.pdf") => new File(["%PDF-1.4"], name, { type: "application/pdf" });

/** A drag event carrying files (jsdom has no DataTransfer, so a stand-in). */
function drag(type: string, files: File[] = [pdf()]) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } });
  return e;
}
function paste(target: EventTarget, files: File[]) {
  const e = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(e, "clipboardData", { value: { files } });
  target.dispatchEvent(e);
  return e;
}

function Taker({ name, onFiles, enabled = true }: { name: string; onFiles: (f: File[], how: FileArrival) => void; enabled?: boolean }) {
  const { dragging } = useFileDrop(onFiles, { enabled });
  return <p data-testid={name}>{dragging ? "dragging" : "idle"}</p>;
}

afterEach(() => { cleanup(); resetFileDropForTests(); });

describe("useFileDrop", () => {
  it("shows dragging while files are over the page and takes them on drop", () => {
    const got = vi.fn();
    render(<Taker name="page" onFiles={got} />);
    act(() => { window.dispatchEvent(drag("dragenter")); });
    expect(screen.getByTestId("page").textContent).toBe("dragging");
    const over = drag("dragover");
    act(() => { window.dispatchEvent(over); });
    expect(over.defaultPrevented).toBe(true);                        // or the browser would open the PDF
    const drop = drag("drop", [pdf("a.pdf"), pdf("b.pdf")]);
    act(() => { window.dispatchEvent(drop); });
    expect(drop.defaultPrevented).toBe(true);
    expect(got).toHaveBeenCalledWith([expect.objectContaining({ name: "a.pdf" }), expect.objectContaining({ name: "b.pdf" })], "drop");
    expect(screen.getByTestId("page").textContent).toBe("idle");
  });

  it("takes a pasted file outside text boxes; inside one, Ctrl+V stays a normal paste", () => {
    const got = vi.fn();
    render(<><Taker name="page" onFiles={got} /><textarea aria-label="Ask" /></>);
    const outside = paste(document.body, [pdf()]);
    expect(outside.defaultPrevented).toBe(true);
    expect(got).toHaveBeenCalledWith([expect.objectContaining({ name: "notes.pdf" })], "paste");
    got.mockClear();
    const inside = paste(screen.getByLabelText("Ask"), [pdf()]);
    expect(inside.defaultPrevented).toBe(false);
    expect(got).not.toHaveBeenCalled();
    expect(paste(document.body, []).defaultPrevented).toBe(false);   // text, not files: left alone
    expect(isEditable(document.createElement("input"))).toBe(true);
  });

  it("the latest screen to ask takes the files; when it goes, the one below gets them back", () => {
    const page = vi.fn();
    const dialog = vi.fn();
    const { rerender } = render(<><Taker name="page" onFiles={page} /><Taker name="dialog" onFiles={dialog} /></>);
    act(() => { window.dispatchEvent(drag("dragenter")); });
    expect(screen.getByTestId("dialog").textContent).toBe("dragging");
    expect(screen.getByTestId("page").textContent).toBe("idle");
    act(() => { window.dispatchEvent(drag("drop")); });
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
    rerender(<><Taker name="page" onFiles={page} /><Taker name="dialog" onFiles={dialog} enabled={false} /></>);
    act(() => { window.dispatchEvent(drag("drop")); });
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("with nobody asking, the browser's own behaviour is left alone", () => {
    const over = drag("dragover");
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
  });
});
