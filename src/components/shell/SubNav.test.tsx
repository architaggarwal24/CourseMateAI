import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/study" }));
import SubNav from "./SubNav";

afterEach(cleanup);

describe("SubNav groups", () => {
  it("puts each group in its own track under a caption that names the group (a heading, not a tab)", () => {
    render(<SubNav label="Study tools" items={[
      { href: "/a", label: "Chat", group: "Learn", current: true },
      { href: "/b", label: "Notes", group: "Learn" },
      { href: "/c", label: "Quiz", group: "Practice" },
    ]} />);
    const nav = screen.getByRole("navigation", { name: "Study tools" });
    const groups = within(nav).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby") && document.getElementById(g.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Learn", "Practice"]);
    expect(within(screen.getByRole("group", { name: "Learn" })).getAllByRole("link").map((l) => l.textContent)).toEqual(["Chat", "Notes"]);
    expect(within(screen.getByRole("group", { name: "Practice" })).getAllByRole("link").map((l) => l.textContent)).toEqual(["Quiz"]);
    // the caption is outside the tab track and isn't a link
    const cap = nav.querySelector(".ui-tabs__cap")!;
    expect(cap.closest(".ui-tabs__list")).toBeNull();
    expect(cap.closest("a")).toBeNull();
  });

  it("without groups: one plain track", () => {
    render(<SubNav label="Hero" items={[{ href: "/a", label: "Quests", current: true }, { href: "/b", label: "Arena" }]} />);
    const nav = screen.getByRole("navigation", { name: "Hero" });
    expect(nav.classList.contains("ui-tabs__list")).toBe(true);
    expect(within(nav).queryAllByRole("group")).toHaveLength(0);
  });
});
