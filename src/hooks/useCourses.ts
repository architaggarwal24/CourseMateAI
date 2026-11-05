"use client";

import { create } from "zustand";
import { ApiError } from "@/lib/api";
import { createCourse, deleteCourse, fetchCourses, updateCourse, type Course } from "@/lib/study/courses";

/**
 * The signed-in user's courses, for the document switcher and the workspace (a course id stands in for a document
 * id). `locked`: the plan has no courses (the server said feature_locked) - the switcher offers the upgrade instead.
 */
interface CoursesState {
  courses: Course[];
  loaded: boolean;
  locked: boolean;
  load: (force?: boolean) => Promise<void>;
  create: (name: string, documentIds: string[], description?: string) => Promise<Course>;
  update: (id: string, change: { name?: string; description?: string; document_ids?: string[] }) => Promise<Course>;
  remove: (id: string) => Promise<void>;
  reset: () => void;
}

let inflight: Promise<void> | null = null;

export const useCourses = create<CoursesState>()((set, get) => ({
  courses: [],
  loaded: false,
  locked: false,
  load: (force = false) => {
    if (inflight) return inflight;
    if (get().loaded && !force) return Promise.resolve();
    inflight = (async () => {
      try {
        set({ courses: await fetchCourses(), loaded: true, locked: false });
      } catch (e) {
        set({ loaded: true, locked: e instanceof ApiError && e.code === "feature_locked" });
      }
    })().finally(() => { inflight = null; });
    return inflight;
  },
  create: async (name, documentIds, description) => {
    const c = await createCourse(name, documentIds, description);
    set((s) => ({ courses: [c, ...s.courses.filter((x) => x.id !== c.id)] }));
    return c;
  },
  update: async (id, change) => {
    const c = await updateCourse(id, change);
    set((s) => ({ courses: s.courses.map((x) => (x.id === id ? c : x)) }));
    return c;
  },
  remove: async (id) => {
    await deleteCourse(id);
    set((s) => ({ courses: s.courses.filter((x) => x.id !== id) }));
  },
  reset: () => { inflight = null; set({ courses: [], loaded: false, locked: false }); },
}));

export function courseById(courses: Course[], id: string | undefined | null): Course | undefined {
  return id ? courses.find((c) => c.id === id) : undefined;
}
