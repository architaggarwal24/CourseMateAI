import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
const auth = vi.hoisted(() => ({ loading: false, user: { full_name: "Alice Example", username: "alice", email: "a@example.com" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/account/ProfileHero", () => ({ default: ({ name }: { name: string }) => <section aria-label="Your progress">{name}</section> }));

import ProfilePage from "./page";

afterEach(cleanup);

describe("the profile", () => {
  it("shows who you are and your progress, with no second copy of the Settings form", () => {
    render(<ProfilePage />);
    expect(screen.getByRole("region", { name: "Your progress" }).textContent).toContain("Alice Example");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelector("input[type=password]")).toBeNull();
  });

  it("lists what you can change, each one link to where it lives", () => {
    render(<ProfilePage />);
    const list = screen.getByRole("list", { name: "Your account" });
    const hrefs = within(list).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/account/settings#account", "/account/security", "/account/usage", "/account/history", "/account/trash"]);
    expect(within(list).getByRole("link", { name: /Name, username and email/ })).toBeTruthy();
    expect(within(list).getByRole("link", { name: /a@example.com/ })).toBeTruthy();   // shown, so you can recognise it
  });
});
