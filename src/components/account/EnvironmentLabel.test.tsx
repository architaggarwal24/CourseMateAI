import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EnvironmentLabel } from "./AdminPanel";

afterEach(cleanup);

// Data-loss safety, control 02: the live site is unmistakable, in words as well as colour.
describe("the Admin page says which copy of the app it is", () => {
  it("the live site: LIVE production, changes reach real accounts", () => {
    render(<EnvironmentLabel host="coursemateai.architaggarwal.workers.dev" />);
    expect(screen.getByRole("note").textContent).toMatch(/^LIVE production · coursemateai\.architaggarwal\.workers\.dev: changes here affect real accounts$/);
  });
  it("a local copy says so", () => {
    for (const host of ["localhost", "127.0.0.1", "app.test"]) {
      render(<EnvironmentLabel host={host} />);
      expect(screen.getByRole("note").textContent).toMatch(/^Local test copy/);
      cleanup();
    }
  });
});
