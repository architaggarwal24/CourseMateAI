import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/study", query: "tab=chat" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/UserMenu", () => ({ default: () => <button type="button">Alice: account menu</button> }));

import NavSidebar from "./NavSidebar";
import { useCourses } from "@/hooks/useCourses";
import { useReview } from "@/hooks/useReview";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.sidebar = "expanded";
  nav.path = "/study"; nav.query = "tab=chat";
  useCourses.setState({ loaded: true, locked: false, courses: [
    { id: "course-1", name: "Cell Biology", documents: [{}, {}, {}], ready: 3 } as never,
  ] });
  useReview.setState({ stats: { due: 7, new: 0, total: 20 } as never });
});
afterEach(cleanup);

const main = () => screen.getByRole("navigation", { name: "Main" });
const link = (name: RegExp) => within(main()).getByRole("link", { name });

describe("the sidebar", () => {
  it("groups the app: Study (with Review and Mock exam), your Courses, and Hero", () => {
    render(<NavSidebar />);
    for (const g of ["Study", "Courses", "Hero"]) expect(within(main()).getByRole("group", { name: g })).toBeTruthy();
    expect(link(/^Review/).getAttribute("href")).toBe("/study?tab=review");
    expect(link(/^Review/).textContent).toContain("7 cards to review");          // the due count lives on Review
    expect(link(/^Mock exam/).getAttribute("href")).toBe("/study?tab=exam");
    expect(link(/^Cell Biology/).getAttribute("href")).toBe("/study?tab=overview&doc=course-1");
    for (const h of ["Arena", "Quests", "Shop", "Champion"]) expect(link(new RegExp(`^${h}`))).toBeTruthy();
    expect(screen.getByRole("button", { name: /Go to/ })).toBeTruthy();
  });

  it("marks where you are, including tabs that live in the query string", () => {
    render(<NavSidebar />);
    expect(link(/^Study/).getAttribute("aria-current")).toBe("page");
    cleanup();
    nav.query = "tab=review";
    render(<NavSidebar />);
    expect(link(/^Review/).getAttribute("aria-current")).toBe("page");
    expect(link(/^Study/).getAttribute("aria-current")).toBeNull();
    cleanup();
    nav.path = "/hero"; nav.query = "tab=shop";
    render(<NavSidebar />);
    expect(link(/^Shop/).getAttribute("aria-current")).toBe("page");
    cleanup();
    nav.path = "/study"; nav.query = "tab=overview&doc=course-1";
    render(<NavSidebar />);
    expect(link(/^Cell Biology/).getAttribute("aria-current")).toBe("page");
  });

  it("hides the Courses group when the plan has no courses", () => {
    useCourses.setState({ locked: true, courses: [] });
    render(<NavSidebar />);
    expect(within(main()).queryByRole("group", { name: "Courses" })).toBeNull();
  });

  it("collapses to an icon rail with its button or Ctrl+B, keeps every link's name, and remembers it", () => {
    render(<NavSidebar />);
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    expect(screen.getByRole("button", { name: "Expand sidebar" }).getAttribute("aria-expanded")).toBe("false");
    expect(link(/^Review/)).toBeTruthy();                                          // names stay for screen readers
    expect(link(/^Review/).getAttribute("data-tip")).toBe("Review");              // and show as a tooltip
    expect(localStorage.getItem("cmai_sidebar")).toBe("collapsed");
    act(() => { fireEvent.keyDown(window, { key: "b", ctrlKey: true }); });
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
  });

  it("Ctrl+B does nothing while typing", () => {
    render(<><NavSidebar /><input aria-label="note" /></>);
    const input = screen.getByLabelText("note");
    input.focus();
    act(() => { fireEvent.keyDown(input, { key: "b", ctrlKey: true }); });
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
  });
});
