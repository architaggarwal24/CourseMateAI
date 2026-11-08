import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
import { useRef } from "react";
import SectionIndex from "./SectionIndex";

// Settings: the index stays in view and only the sections scroll; the index marks the section you are in.
type Io = { cb: IntersectionObserverCallback; els: Element[] };
function stubObserver() {
  const made: Io[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    io: Io;
    constructor(cb: IntersectionObserverCallback) { this.io = { cb, els: [] }; made.push(this.io); }
    observe(el: Element) { this.io.els.push(el); }
    unobserve() {}
    disconnect() {}
  });
  return made;
}

function Page() {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div>
      <SectionIndex label="Settings sections" items={[{ id: "account", label: "Account" }, { id: "ai", label: "AI" }]} scroller={scroller} />
      <div ref={scroller}>
        <section id="account">A</section>
        <section id="ai">B</section>
      </div>
    </div>
  );
}

describe("SectionIndex", () => {
  it("lists the sections as links and marks the first one at the start", () => {
    stubObserver();
    render(<Page />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const links = nav.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["#account", "#ai"]);
    expect(links[0].getAttribute("aria-current")).toBe("true");
  });

  it("marks the section scrolled into view", () => {
    const made = stubObserver();
    render(<Page />);
    const io = made[0];
    const ai = io.els.find((e) => e.id === "ai")!;
    act(() => io.cb([{ target: ai, isIntersecting: true, intersectionRatio: 0.6 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: "Account" }).getAttribute("aria-current")).toBeNull();
  });

  it("a click scrolls the section into view inside the scroller and marks it", () => {
    stubObserver();
    render(<Page />);
    const into = vi.fn();
    document.getElementById("ai")!.scrollIntoView = into;
    fireEvent.click(screen.getByRole("link", { name: "AI" }));
    expect(into).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "AI" }).getAttribute("aria-current")).toBe("true");
  });
});
