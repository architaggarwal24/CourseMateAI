import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";


import ThemeScope from "@/components/ui/ThemeScope";
import Button from "./Button";
import Modal, { sheetShouldClose } from "./Modal";

afterEach(() => { cleanup(); document.body.style.overflow = ""; vi.unstubAllGlobals(); });

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

  it("is a centred dialog on wider screens: no sheet, no grab handle", () => {
    render(<Demo />);
    openIt();
    expect(dialog().className).not.toContain("ui-modal--sheet");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

const phone = () => vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query === "(max-width: 767px)", media: query, addEventListener() {}, removeEventListener() {},
}));

describe("Modal on a phone: a bottom sheet", () => {
  it("slides up from the bottom with a grab handle that is also a Close button (focus still starts on the content)", () => {
    phone();
    render(<Demo />);
    openIt();
    expect(dialog().className).toContain("ui-modal--sheet");
    const handle = screen.getByRole("button", { name: "Close" });
    expect(dialog().contains(handle)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("field"));
  });

  it("closes from the handle, and Escape still works", async () => {
    phone();
    const onClose = vi.fn();
    render(<Demo onClose={onClose} />);
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    openIt();
    esc();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes when dragged down far enough or flicked down fast; otherwise it springs back", () => {
    expect(sheetShouldClose(30, 100, 600)).toBe(false);                    // a nudge
    expect(sheetShouldClose(160, 0, 600)).toBe(true);                      // dragged well down
    expect(sheetShouldClose(80, 0, 200)).toBe(true);                       // a short sheet: a third of its height
    expect(sheetShouldClose(40, 900, 600)).toBe(true);                     // a flick
    expect(sheetShouldClose(-40, 900, 600)).toBe(false);                   // up is never a close
    expect(sheetShouldClose(5, 900, 600)).toBe(false);                     // a twitch, however fast
  });
});
