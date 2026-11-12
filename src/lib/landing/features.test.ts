import { describe, expect, it } from "vitest";
import { FEATURE_PAGES, featureBySlug } from "./features";
import { FEATURES, TIER_NAMES } from "../account/plan-tiers";

describe("the feature pages", () => {
  it("each have a distinct slug, title, description and H1, and a few real sections and questions", () => {
    for (const key of ["slug", "title", "description", "h1", "h1Short"] as const) {
      expect(new Set(FEATURE_PAGES.map((f) => f[key])).size, key).toBe(FEATURE_PAGES.length);
    }
    for (const f of FEATURE_PAGES) {
      expect(f.description.length, f.slug).toBeLessThanOrEqual(160);
      expect(f.sections.length, f.slug).toBeGreaterThanOrEqual(2);
      expect(f.faq.length, f.slug).toBeGreaterThanOrEqual(2);
    }
    expect(featureBySlug("nope")).toBeUndefined();
  });

  it("name the plan each gated feature is really on, and claim nothing the app doesn't do", () => {
    const text = JSON.stringify(FEATURE_PAGES);
    expect(text).toContain(`The concept map and the PDF page viewer come with ${TIER_NAMES[FEATURES.concept_map]}`);
    expect(text).toContain(`Mock exams come with ${TIER_NAMES[FEATURES.exam_mode]}`);
    expect(text).toContain(`The review queue comes with ${TIER_NAMES[FEATURES.review_queue]}`);
    expect(text).not.toMatch(/short answer|testimonial|\bratings?\b|\d+\s*(students|users)|guarantee/i);
  });
});
