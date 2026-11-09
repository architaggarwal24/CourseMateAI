// The plans' names and which plan each feature starts on: plain constants, shared by the server (src/server/plans.ts)
// and the public feature pages (src/lib/features.ts), which mustn't pull in the database code.
export const TIERS = ["apprentice", "scholar", "sage", "archmage"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_NAMES: Record<Tier, string> = { apprentice: "Apprentice", scholar: "Scholar", sage: "Sage", archmage: "Archmage" };

/** feature -> the lowest tier that has it */
export const FEATURES = {
  review_queue: "scholar",
  exam_mode: "sage",
  courses: "apprentice",                     // every plan: Study needs a course (round 7)
  concept_map: "sage",
  pdf_viewer: "sage",
} as const satisfies Record<string, Tier>;
export type Feature = keyof typeof FEATURES;
export const FEATURE_NAMES: Record<Feature, string> = {
  review_queue: "Spaced-repetition review", exam_mode: "Exam mode", courses: "Courses",
  concept_map: "The concept map", pdf_viewer: "The PDF page viewer",
};
