import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/study", query: "tab=chat" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.query) }));

import BottomNav from "./BottomNav";
import { useReview } from "@/hooks/useReview";

beforeEach(() => { nav.path = "/study"; nav.query = "tab=chat"; useReview.setState({ stats: { due: 3 } as never }); });
afterEach(cleanup);

describe("the phone bottom bar", () => {
  it("Study: Today, Study, Review (with the due count), the portal into Hero, and Me, at the thumb", () => {
    render(<BottomNav />);
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/[,:].*$/, "").replace(/\d+$/, ""))).toEqual(["Today", "Study", "Review", "Hero", "Me"]);
    expect(links[0].getAttribute("href")).toBe("/today");
    expect(links[2].getAttribute("href")).toBe("/study?tab=review");
    expect(links[2].textContent).toContain("3 cards to review");
    expect(links[3].getAttribute("href")).toBe("/arena");
    expect(links[3].textContent).toContain("enter the Hero world");
    expect(links[4].getAttribute("href")).toBe("/account");
  });

  it("Hero: Arena, Quests, Bestiary, Champion and the portal back to Study; the page you're on is marked", () => {
    for (const [path, current] of [["/arena", "Arena"], ["/champion", "Champion"], ["/quests", "Quests"], ["/bestiary", "Bestiary"]]) {
      nav.path = path; nav.query = "";
      render(<BottomNav />);
      const bar = screen.getByRole("navigation", { name: "Main" });
      expect(bar.getAttribute("data-world")).toBe("hero");
      expect(within(bar).getAllByRole("link").map((l) => l.textContent?.replace(/:.*$/, ""))).toEqual(["Arena", "Quests", "Bestiary", "Champion", "Study"]);
      expect(within(bar).getByRole("link", { current: "page" }).textContent, path).toBe(current);
      expect(within(bar).getByRole("link", { name: /return to Study/ }).getAttribute("href")).toBe("/today");
      cleanup();
    }
  });

  it("marks the current one (Review is a Study tab, so it wins over Study there)", () => {
    nav.query = "tab=review";
    render(<BottomNav />);
    const nav_ = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav_).getByRole("link", { name: /^Review/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav_).getByRole("link", { name: /^Study/ }).getAttribute("aria-current")).toBeNull();
    cleanup();
    nav.path = "/account/settings"; nav.query = "";
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: /^Me/ }).getAttribute("aria-current")).toBe("page");
  });
});
