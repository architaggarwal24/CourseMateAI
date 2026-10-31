import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";


import ThemeScope from "@/components/ThemeScope";
import Button from "./Button";
import Modal from "./Modal";

afterEach(() => { cleanup(); document.body.style.overflow = ""; });

const tab = (shift = false) => {
  const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(ev);
  return ev;
};
const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

function Demo({ onClose = () => {}, withCancelFocus = false }: { onClose?: () => void; withCancelFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <Modal open={open} onClose={() => { setOpen(false); onClose(); }} title="Confirm"
        initialFocusRef={withCancelFocus ? cancel : undefined}
        actions={<><Button>First</Button><Button ref={cancel}>Middle</Button><Button>Last</Button></>}>
        <input aria-label="field" />
      </Modal>
    </>
  );
}
const openIt = () => fireEvent.click(screen.getByText("opener"));
const dialog = () => screen.getByRole("dialog");

describe("Modal", () => {
  it("is a labelled, modal dialog and renders nothing while closed", () => {
    render(<Demo />);
    expect(screen.queryByRole("dialog")).toBeNull();
    openIt();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
  });

  it("moves focus to the first control, or to initialFocusRef when given", () => {
    render(<Demo />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    cleanup();
    render(<Demo withCancelFocus />);
    openIt();
    expect(document.activeElement).toBe(screen.getByText("Middle"));
  });

  it("traps Tab: from the last control it wraps to the first", () => {
    render(<Demo />);
    openIt();
    screen.getByText("Last").focus();
    const ev = tab();
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
  });

  it("traps Shift+Tab: from the first control it wraps to the last", () => {
    render(<Demo />);
    openIt();
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
    const ev = tab(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByText("Last"));
  });

  it("lets Tab move normally between controls inside", () => {
    render(<Demo />);
    openIt();
    screen.getByText("First").focus();
    expect(tab().defaultPrevented).toBe(false);
  });

  it("pulls focus back in if it ended up outside the dialog", () => {
    render(<Demo />);
    openIt();
    screen.getByText("opener").focus();
    tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("skips disabled controls when wrapping", () => {
    render(
      <Modal open onClose={() => {}} title="T" actions={<><Button>A</Button><Button disabled>B</Button></>}>text</Modal>,
    );
    expect(document.activeElement).toBe(screen.getByText("A"));
    tab();
    expect(document.activeElement).toBe(screen.getByText("A"));
  });

  it("keeps focus on the dialog itself when it has nothing focusable", () => {
    render(<Modal open onClose={() => {}} title="T">nothing to press</Modal>);
    expect(document.activeElement).toBe(dialog());
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog());
  });

  it("closes on Escape and returns focus to the opener", () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    const opener = screen.getByText("opener");
    opener.focus();
    openIt();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a click on the backdrop but not inside the dialog", () => {
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    openIt();
    const overlay = dialog().parentElement!;
    fireEvent.mouseDown(dialog()); fireEvent.click(dialog());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay); fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks page scroll while open and restores it", () => {
    render(<Demo />);
    openIt();
    expect(document.body.style.overflow).toBe("hidden");
    esc();
    expect(document.body.style.overflow).toBe("");
  });

  it("only the top-most of two stacked modals reacts to Escape", () => {
    const outer = vi.fn(), inner = vi.fn();
    render(
      <>
        <Modal open onClose={outer} title="Outer"><button>o</button></Modal>
        <Modal open onClose={inner} title="Inner"><button>i</button></Modal>
      </>,
    );
    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("re-enters the theme scope of the screen that opened it", () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="Study one">x</Modal>);
    expect(dialog().closest("[data-theme]")?.getAttribute("data-theme")).toBe("study");
    rerender(<ThemeScope theme="play"><Modal open onClose={() => {}} title="Play one">x</Modal></ThemeScope>);
    expect(dialog().closest("[data-theme]")?.getAttribute("data-theme")).toBe("play");
  });
});
