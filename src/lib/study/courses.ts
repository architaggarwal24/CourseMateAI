// Courses (backend routers/courses.py): several PDFs studied together. A course id works wherever a document id does.
import { api } from "@/lib/api/client";
import { idempotencyKey } from "@/lib/api/idempotency";
import type { components } from "@/lib/api/generated/schema";

export type Course = components["schemas"]["Course"];
/** backend CourseProgressService.progress(): the loose dicts of the OpenAPI schema, spelled out. */
export interface CourseProgress {
  course_id: string;
  mastery: number;
  concepts: { seen: number; strong: number; weak: number; weakest: string[] };
  answers: { total: number; correct: number; accuracy: number | null };
  review: { cards: number; due: number };
  exams: { accuracy: number | null; [key: string]: unknown }[];
  documents: { id: string; filename: string; concepts: number; answered: number; accuracy: number | null }[];
}

export async function fetchCourses(): Promise<Course[]> {
  const { data } = await api.GET("/courses");
  return ((data as { courses?: Course[] } | undefined)?.courses) ?? [];
}

export async function createCourse(name: string, documentIds: string[], description?: string) {
  const body = { name, document_ids: documentIds, description: description || null };
  const once = idempotencyKey("courses", body);
  const { data } = await api.POST("/courses", { body, headers: once.headers });
  once.done();
  return data as Course;
}

export async function updateCourse(id: string, change: { name?: string; description?: string; document_ids?: string[] }) {
  const { data } = await api.PUT("/courses/{course_id}", { params: { path: { course_id: id } }, body: change });
  return data as Course;
}

export async function deleteCourse(id: string) {
  await api.DELETE("/courses/{course_id}", { params: { path: { course_id: id } } });
}

export async function fetchCourseProgress(id: string) {
  const { data } = await api.GET("/courses/{course_id}/progress", { params: { path: { course_id: id } } });
  return data as unknown as CourseProgress;
}
