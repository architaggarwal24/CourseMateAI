import { describe, expect, it } from "vitest";
import { makePlan, parseChapters } from "./revision-plan";

const day = (s: string) => new Date(`${s}T00:00:00`);

describe("the revision planner", () => {
  it("reads chapters one per line, dropping blanks and numbering; a number means that many chapters", () => {
    expect(parseChapters("1. Light\n\n2) Electricity\n- Magnetism  \n")).toEqual(["Light", "Electricity", "Magnetism"]);
    expect(parseChapters("3")).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(parseChapters("")).toEqual([]);
  });

  it("spreads the chapters over the days before the exam, keeps the last week for mock tests, and reviews each chapter after 1, 3 and 7 days", () => {
    const chapters = Array.from({ length: 10 }, (_, i) => `Ch ${i + 1}`);
    const plan = makePlan({ chapters, today: day("2026-11-15"), exam: day("2027-01-15") });   // 61 days
    expect(plan.days).toHaveLength(61);
    expect(plan.days[0].date).toBe("2026-11-15");
    expect(plan.days.at(-1)!.date).toBe("2027-01-14");                  // the exam day itself isn't a study day
    const studied = plan.days.flatMap((d) => d.study);
    expect(studied).toEqual(chapters);                                  // each chapter once, in the order given
    const first = plan.days.findIndex((d) => d.study.includes("Ch 1"));
    for (const gap of [1, 3, 7]) expect(plan.days[first + gap].review).toContain("Ch 1");
    expect(plan.days.slice(-7).every((d) => d.mock && d.study.length === 0)).toBe(true);
    expect(plan.days.slice(0, -7).some((d) => d.mock)).toBe(false);
  });

  it("with little time, studies more than one chapter a day and still keeps a final review day", () => {
    const chapters = Array.from({ length: 13 }, (_, i) => `Ch ${i + 1}`);
    const plan = makePlan({ chapters, today: day("2026-11-15"), exam: day("2026-11-21") });     // 6 days
    expect(plan.days).toHaveLength(6);
    expect(plan.days.flatMap((d) => d.study)).toHaveLength(13);
    expect(plan.days.at(-1)!.mock).toBe(true);
    expect(plan.perDay).toBeGreaterThan(1);
  });

  it("an exam today, or in the past, or no chapters: no plan, with the reason", () => {
    expect(makePlan({ chapters: ["A"], today: day("2026-11-15"), exam: day("2026-11-15") }).error).toMatch(/after today/);
    expect(makePlan({ chapters: [], today: day("2026-11-15"), exam: day("2026-12-15") }).error).toMatch(/chapter/);
  });
});
