import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
const auth = vi.hoisted(() => ({ user: { user_id: 1, is_admin: false } as Record<string, unknown>, logout: vi.fn(async () => {}) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

import CommandPalette from "./CommandPalette";
import { modKey, shortcutLabel } from "@/lib/keys";

beforeEach(() => {
  // jsdom has neither: cmdk measures its list and scrolls the selected item into view
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { cleanup(); nav.push.mockReset(); auth.logout.mockClear(); vi.unstubAllGlobals(); });

const open = () => act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });

describe("shortcut labels", () => {
  it("say ⌘ on a Mac and Ctrl elsewhere", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel", userAgent: "Macintosh" });
    expect(modKey()).toBe("⌘");
    expect(shortcutLabel(["mod", "K"])).toBe("⌘K");
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32", userAgent: "Windows NT 10.0" });
    expect(modKey()).toBe("Ctrl");
    expect(shortcutLabel(["mod", "K"])).toBe("Ctrl+K");
  });
});

describe("the command menu", () => {
  it("Ctrl+K opens every page, including the concept map, and actions like logging out", async () => {
    render(<CommandPalette />);
    open();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Concept map")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Plan & usage")).toBeTruthy();
    expect(screen.queryByText("Admin")).toBeNull();                    // admins only
    expect(screen.queryByText(/API key/)).toBeNull();                  // the server holds the keys now
    fireEvent.click(screen.getByText("Log out"));
    await act(async () => {});
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("shows its own shortcut, and Ctrl+K closes it again", () => {
    render(<CommandPalette />);
    open();
    expect(screen.getByText(/Ctrl\+K/)).toBeTruthy();
    open();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists Admin for admins", () => {
    auth.user = { user_id: 1, is_admin: true };
    render(<CommandPalette />);
    open();
    fireEvent.click(screen.getByText("Admin"));
    expect(nav.push).toHaveBeenCalledWith("/account/admin");
    auth.user = { user_id: 1, is_admin: false };
  });

  it("switches between light and dark from anywhere", () => {
    document.documentElement.dataset.mode = "dark";
    render(<CommandPalette />);
    open();
    fireEvent.click(screen.getByText("Switch to light mode"));
    expect(document.documentElement.dataset.mode).toBe("light");
    open();
    expect(screen.getByText("Switch to dark mode")).toBeTruthy();
    localStorage.clear();
  });
});

// Performance pass (Stage P3): the palette's code (cmdk, the dialog) left the first load of every page. A small
// loader listens for ⌘K / the search button and mounts the palette already open.
describe("the palette loader", () => {
  it("the first Ctrl+K loads the palette and opens it; the search button does the same", async () => {
    const { default: CommandPaletteLoader, openCommandPalette } = await import("./CommandPaletteLoader");
    const first = render(<CommandPaletteLoader />);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Concept map")).toBeTruthy();
    first.unmount();
    render(<CommandPaletteLoader />);
    act(() => openCommandPalette());
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("the app frame imports only the loader, never the palette itself", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["AppShell.tsx", "NavSidebar.tsx"]) {
      expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/from "\.\/CommandPalette"/);
    }
  });
});
