import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSidebarCollapsed, setSidebarCollapsed, SIDEBAR_SCRIPT, toggleSidebar } from "./sidebar";

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.sidebar; });
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar's collapsed state", () => {
  it("shows on <html> (so CSS lays it out before React runs), is remembered, and toggles", () => {
    expect(isSidebarCollapsed()).toBe(false);
    setSidebarCollapsed(true);
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    expect(localStorage.getItem("cmai_sidebar")).toBe("collapsed");
    expect(toggleSidebar()).toBe(false);
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
    expect(localStorage.getItem("cmai_sidebar")).toBe("expanded");
  });

  it("before first paint: the saved choice, else collapsed on screens narrower than 1280px (tablets)", () => {
    vi.stubGlobal("innerWidth", 1024);
    new Function(SIDEBAR_SCRIPT)();
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
    vi.stubGlobal("innerWidth", 1440);
    new Function(SIDEBAR_SCRIPT)();
    expect(document.documentElement.dataset.sidebar).toBe("expanded");
    localStorage.setItem("cmai_sidebar", "collapsed");
    new Function(SIDEBAR_SCRIPT)();
    expect(document.documentElement.dataset.sidebar).toBe("collapsed");
  });
});
