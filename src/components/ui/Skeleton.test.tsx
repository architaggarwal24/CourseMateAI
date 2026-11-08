import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Skeleton from "./Skeleton";

// Performance pass (Stage P4): the skeleton's default inline height (1rem) beat a size class such as h-[360px], so
// the exam, review, concept map, plan and PDF skeletons were 16 px tall and the page jumped when content arrived.
describe("Skeleton size", () => {
  it("a size class wins: no inline height or width fights it", () => {
    const { container } = render(<Skeleton className="h-[360px] w-full rounded-lg" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.height).toBe("");
    expect(el.style.width).toBe("");
  });

  it("without a size class it keeps its defaults, and explicit props still apply", () => {
    const plain = render(<Skeleton />).container.firstElementChild as HTMLElement;
    expect([plain.style.width, plain.style.height]).toEqual(["100%", "1rem"]);
    const sized = render(<Skeleton height="92px" width="50%" />).container.firstElementChild as HTMLElement;
    expect([sized.style.width, sized.style.height]).toEqual(["50%", "92px"]);
  });
});
