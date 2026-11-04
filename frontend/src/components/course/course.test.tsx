import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import CourseEditor from "./CourseEditor";
import CourseOverview from "./CourseOverview";
import LibraryMenu from "./LibraryMenu";
import { useCourses } from "@/hooks/useCourses";
import type { DocumentInfo } from "@/lib/api";
import type { Course } from "@/lib/study/courses";

const doc = (id: string, filename: string, extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id, filename, file_hash: `h-${id}`, status: "ready", error: null, chunks: 12, embedding_model: "m",
  created_at: "2026-11-01T00:00:00Z", last_used_at: "2026-11-01T00:00:00Z", ...extra,
});
const DOCS = [doc("d1", "biology.pdf"), doc("d2", "chemistry.pdf"), doc("d3", "physics.pdf", { status: "indexing", chunks: null })];
const course = (over: Partial<Course> = {}): Course => ({
  id: "c1", name: "Life sciences", description: null, created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z",
  ready: 2, documents: [{ id: "d1", filename: "biology.pdf", status: "ready", chunks: 12 }, { id: "d2", filename: "chemistry.pdf", status: "ready", chunks: 12 }],
  ...over,
} as Course);

function server() {
  const log = { posts: [] as any[], puts: [] as any[], deletes: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    if (path === "/courses" && method === "POST") {
      const b = await bodyOf(input, init);
      log.posts.push(b);
      return json(200, course({ id: "new", name: b.name, documents: b.document_ids.map((id: string) => ({ id, filename: id, status: "ready" })) }));
    }
    if (path === "/courses/c1" && method === "PUT") { const b = await bodyOf(input, init); log.puts.push(b); return json(200, course({ name: b.name })); }
    if (path === "/courses/c1" && method === "DELETE") { log.deletes += 1; return json(200, { ok: true }); }
    if (path === "/courses/c1/progress") {
      return json(200, { course_id: "c1", mastery: 0.5, concepts: { seen: 4, strong: 2, weak: 1, weakest: ["ATP"] },
        answers: { total: 10, correct: 7, accuracy: 0.7 }, review: { cards: 9, due: 3 },
        exams: [{ id: "e1", accuracy: 0.8, submitted_at: "2026-11-03T00:00:00Z" }],
        documents: [{ id: "d1", filename: "biology.pdf", concepts: 3, answered: 6, accuracy: 0.5 },
                    { id: "d2", filename: "chemistry.pdf", concepts: 0, answered: 0, accuracy: null }] });
    }
    throw new Error(`unexpected ${method} ${path}`);
  }));
  return log;
}

beforeEach(() => { useCourses.getState().reset(); Object.values(toasts).forEach((f) => f.mockClear()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("course editor", () => {
  it("creates a course from the documents picked, in the order set", async () => {
    const log = server();
    const saved = vi.fn();
    render(<CourseEditor open onClose={() => {}} documents={DOCS} onSaved={saved} />);
    const dialog = screen.getByRole("dialog", { name: "New course" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create course" }));
    expect(await within(dialog).findByText("Give the course a name.")).toBeTruthy();       // no name: nothing sent
    expect(log.posts).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Life sciences" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /biology\.pdf/ }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /chemistry\.pdf/ }));
    expect(within(dialog).getByText("(2 of 3)")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move chemistry.pdf up" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create course" }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(log.posts).toEqual([{ name: "Life sciences", document_ids: ["d2", "d1"], description: null }]);
    expect(useCourses.getState().courses.map((c) => c.id)).toEqual(["new"]);
  });

  it("edits a course and deletes it only after asking (its documents stay)", async () => {
    const log = server();
    useCourses.setState({ courses: [course()], loaded: true });
    const deleted = vi.fn();
    render(<CourseEditor open onClose={() => {}} course={course()} documents={DOCS} onDeleted={deleted} />);
    const dialog = screen.getByRole("dialog", { name: "Edit course" });
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("Life sciences");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /chemistry\.pdf/ }));     // take one out
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Biology" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(log.puts).toHaveLength(1));
    expect(log.puts[0]).toEqual({ name: "Biology", description: "", document_ids: ["d1"] });

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(dialog.textContent).toContain("Its documents stay in your library");
    expect(log.deletes).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete course" }));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(log.deletes).toBe(1);
    expect(useCourses.getState().courses).toEqual([]);
  });
});

describe("library menu", () => {
  const openMenu = () => {
    const trigger = screen.getByRole("button", { name: /switch document or course/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.getByRole("menu");
  };

  it("lists courses then documents; picking one says which kind it is", async () => {
    const pick = vi.fn(), create = vi.fn();
    render(<LibraryMenu current="d1" courses={[course()]} documents={DOCS} coursesLocked={false} onPick={pick} onNewCourse={create}>
      <span>biology.pdf</span></LibraryMenu>);
    const menu = openMenu();
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Life sciences2 PDFs", "New course…", "biology.pdf", "chemistry.pdf", "physics.pdfindexing"]);
    expect(within(menu).getAllByLabelText("Current")).toHaveLength(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Life sciences/ }));
    expect(pick).toHaveBeenCalledWith("c1", "course");
  });

  it("without courses on the plan, says which plan has them", () => {
    render(<LibraryMenu current="d1" courses={[]} documents={DOCS} coursesLocked onPick={vi.fn()} onNewCourse={vi.fn()}>
      <span>biology.pdf</span></LibraryMenu>);
    const menu = openMenu();
    const locked = within(menu).getByRole("menuitem", { name: "Courses come with Sage" });
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).queryByText("New course…")).toBeNull();
  });
});

describe("course overview", () => {
  it("shows the stored progress and studies the whole course from one place", async () => {
    server();
    const edit = vi.fn();
    render(<CourseOverview course={course()} onEdit={edit} />);
    const tiles = await screen.findByText("Concepts mastered", { exact: false });
    const dl = tiles.closest("dl")!;
    expect(dl.textContent).toContain("50%");
    expect(dl.textContent).toContain("70%");
    expect(dl.textContent).toContain("(7 of 10)");
    expect(dl.textContent).toContain("Cards due (9 in review)3");
    expect(dl.textContent).toContain("80%");
    expect(screen.getByText("ATP")).toBeTruthy();                                           // the weakest concept
    expect(screen.getByRole("link", { name: "Ask the course" }).getAttribute("href")).toBe("/study?tab=chat&doc=c1");
    expect(screen.getByRole("link", { name: "Mock exam" }).getAttribute("href")).toBe("/study?tab=exam&doc=c1");
    expect(screen.getByText("3 concepts · 50% right")).toBeTruthy();
    expect(screen.getByText("Not studied yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();                      // the header's "Edit course" does that
  });

  it("an empty course asks for documents", () => {
    server();
    const edit = vi.fn();
    render(<CourseOverview course={course({ documents: [], ready: 0 })} onEdit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "Add documents" }));
    expect(edit).toHaveBeenCalled();
  });
});
