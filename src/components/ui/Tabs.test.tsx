import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Tabs, { type TabItem } from "./Tabs";

afterEach(cleanup);

const TABS: TabItem[] = [
  { id: "a", label: "Alpha", content: <p>panel a</p> },
  { id: "b", label: "Beta", content: <p>panel b</p> },
  { id: "c", label: "Gamma", disabled: true, content: <p>panel c</p> },
  { id: "d", label: "Delta", content: <p>panel d</p> },
];
const tab = (name: string) => screen.getByRole("tab", { name });
const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });

describe("Tabs", () => {
  it("exposes tablist / tab / tabpanel with linked ids and one selected tab", () => {
    render(<Tabs label="Sections" tabs={TABS} />);
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeTruthy();
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
    expect(tab("Beta").getAttribute("aria-selected")).toBe("false");
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toBe("panel a");
    expect(tab("Alpha").getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Alpha").id);
  });

  it("roving tabindex: only the selected tab is in the Tab order", () => {
    render(<Tabs label="S" tabs={TABS} />);
    expect(tab("Alpha").tabIndex).toBe(0);
    expect(tab("Beta").tabIndex).toBe(-1);
    expect(tab("Delta").tabIndex).toBe(-1);
  });

  it("ArrowRight selects and focuses the next tab, skipping disabled ones, and wraps", () => {
    const onChange = vi.fn();
    render(<Tabs label="S" tabs={TABS} onChange={onChange} />);
    tab("Alpha").focus();
    press("ArrowRight");
    expect(document.activeElement).toBe(tab("Beta"));
    expect(tab("Beta").getAttribute("aria-selected")).toBe("true");
    press("ArrowRight");                       // Gamma is disabled
    expect(document.activeElement).toBe(tab("Delta"));
    press("ArrowRight");                       // wraps to the first
    expect(document.activeElement).toBe(tab("Alpha"));
    expect(onChange.mock.calls.map(c => c[0])).toEqual(["b", "d", "a"]);
    expect(screen.getByRole("tabpanel").textContent).toBe("panel a");
  });

  it("ArrowLeft goes back, skipping disabled ones, and wraps to the last", () => {
    render(<Tabs label="S" tabs={TABS} />);
    tab("Alpha").focus();
    press("ArrowLeft");
    expect(document.activeElement).toBe(tab("Delta"));
    press("ArrowLeft");
    expect(document.activeElement).toBe(tab("Beta"));
  });

  it("Home and End jump to the first and last enabled tab", () => {
    render(<Tabs label="S" tabs={TABS} defaultValue="b" />);
    tab("Beta").focus();
    press("End");
    expect(document.activeElement).toBe(tab("Delta"));
    expect(screen.getByRole("tabpanel").textContent).toBe("panel d");
    press("Home");
    expect(document.activeElement).toBe(tab("Alpha"));
  });

  it("ignores other keys and does not select a disabled tab by click", () => {
    const onChange = vi.fn();
    render(<Tabs label="S" tabs={TABS} onChange={onChange} />);
    tab("Alpha").focus();
    press("ArrowDown"); press("a");
    fireEvent.click(tab("Gamma"));
    expect(onChange).not.toHaveBeenCalled();
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");
  });

  it("clicking selects; controlled value is followed", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Tabs label="S" tabs={TABS} value="a" onChange={onChange} />);
    fireEvent.click(tab("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(tab("Alpha").getAttribute("aria-selected")).toBe("true");   // parent has not changed `value` yet
    rerender(<Tabs label="S" tabs={TABS} value="b" onChange={onChange} />);
    expect(screen.getByRole("tabpanel").textContent).toBe("panel b");
  });
});
