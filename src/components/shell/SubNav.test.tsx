import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/study" }));
import SubNav from "./SubNav";

afterEach(cleanup);

describe("SubNav groups", () => {
  it("labels each group once, before its first tab (decorative: the links keep their own names)", () => {
    render(<SubNav label="Study tools" items={[
      { href: "/a", label: "Chat", group: "Learn", current: true },
      { href: "/b", label: "Notes", group: "Learn" },
      { href: "/c", label: "Quiz", group: "Practice" },
    ]} />);
    const nav = screen.getByRole("navigation", { name: "Study tools" });
    const labels = nav.querySelectorAll(".ui-tabs__group");
    expect([...labels].map((l) => l.textContent)).toEqual(["Learn", "Practice"]);
    expect([...labels].every((l) => l.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Chat", "Notes", "Quiz"]);
  });
});
