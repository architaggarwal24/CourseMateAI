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
    expect(dialog.textContent).toContain("Its PDFs stay in your library, and you can restore the course for 30 days");
    expect(log.deletes).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete course" }));
    await waitFor(() => expect(deleted).toHaveBeenCalled());
    expect(log.deletes).toBe(1);
    expect(useCourses.getState().courses).toEqual([]);
  });
});

describe("library menu", () => {
  const openMenu = () => {
    const trigger = screen.getByRole("button", { name: /switch course or PDF/ });
    fireEvent.keyDown(trigger, { key: "Enter" });
    return screen.getByRole("menu");
  };

  it("lists each course with its PDFs under it, then PDFs in no course; picking one says which kind it is", async () => {
    const pick = vi.fn(), create = vi.fn();
    render(<LibraryMenu current="d1" courses={[course()]} documents={DOCS} onPick={pick} onNewCourse={create}>
      <span>biology.pdf</span></LibraryMenu>);
    const menu = openMenu();
    const items = within(menu).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).toEqual(["Life sciences2 PDFs", "biology.pdf", "chemistry.pdf", "New course…", "physics.pdf"]);
    expect(within(menu).getByText("Not in a course")).toBeTruthy();
    expect(within(menu).getAllByLabelText("Current")).toHaveLength(1);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Life sciences/ }));
    expect(pick).toHaveBeenCalledWith("c1", "course");
  });

  it("a PDF of a course is picked as a document (to focus on it)", () => {
    const pick = vi.fn();
    render(<LibraryMenu current="c1" courses={[course()]} documents={DOCS.slice(0, 2)} onPick={pick} onNewCourse={vi.fn()}>
      <span>Life sciences</span></LibraryMenu>);
    const menu = openMenu();
    expect(within(menu).queryByText("Not in a course")).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "chemistry.pdf" }));
    expect(pick).toHaveBeenCalledWith("d2", "document");
  });

  it("lists only the open course's PDFs, and each has a bin that takes it out of that course", () => {
    const del = vi.fn();
    const other = course({ id: "c2", name: "Physics", documents: [{ id: "d3", filename: "physics.pdf", status: "ready", chunks: 3 }] as Course["documents"] });
    render(<LibraryMenu current="d2" courses={[course(), other]} documents={DOCS} onPick={vi.fn()} onNewCourse={vi.fn()} onDelete={del}>
      <span>chemistry.pdf</span></LibraryMenu>);
    const menu = openMenu();
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent || i.getAttribute("aria-label"))).toEqual([
      "Life sciences2 PDFs", "biology.pdf", "Remove biology.pdf from Life sciences", "chemistry.pdf", "Remove chemistry.pdf from Life sciences",
      "Physics1 PDF", "New course…",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove chemistry.pdf from Life sciences" }));
    expect(del).toHaveBeenCalledWith("d2", "c1");
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

  it("an empty course asks for its first PDF: upload one, or pick from PDFs you have", () => {
    server();
    const edit = vi.fn(), upload = vi.fn();
    render(<CourseOverview course={course({ documents: [], ready: 0 })} onEdit={edit} onUpload={upload} hasOtherPdfs />);
    expect(screen.getByRole("heading", { name: "Add your PDFs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upload PDFs" }));
    expect(upload).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Pick from your PDFs" }));
    expect(edit).toHaveBeenCalled();
  });
});

describe("DeleteDocument from a course", () => {
  it("a PDF that is also in another course only leaves this one; otherwise it moves to the Trash", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
      calls.push(`${method} ${path}${method === "PUT" ? ` ${JSON.stringify((await bodyOf(input, init)).document_ids)}` : ""}`);
      if (method === "PUT") return json(200, course({ documents: [{ id: "d1", filename: "biology.pdf", status: "ready", chunks: 12 }] as Course["documents"] }));
      return json(200, { ok: true });
    }));
    const other = course({ id: "c2", name: "Physics", documents: [{ id: "d2", filename: "chemistry.pdf", status: "ready", chunks: 3 }] as Course["documents"] });
    useCourses.setState({ courses: [course(), other], loaded: true });
    const done = vi.fn();
    const { default: DeleteDocument } = await import("./DeleteDocument");
    render(<DeleteDocument doc={{ id: "d2", filename: "chemistry.pdf" }} course={course()} onClose={vi.fn()} onDeleted={done} />);
    expect(screen.getByRole("alertdialog", { name: "Remove from Life sciences?" }).textContent).toContain("It stays in Physics");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("d2", false));
    expect(calls).toEqual(['PUT /courses/c1 ["d1"]']);
    cleanup();

    useCourses.setState({ courses: [course()], loaded: true });
    render(<DeleteDocument doc={{ id: "d2", filename: "chemistry.pdf" }} course={course()} onClose={vi.fn()} onDeleted={done} />);
    expect(screen.getByRole("alertdialog", { name: "Delete this PDF?" }).textContent).toMatch(/leaves Life sciences and, since it's in no other course, moves to the Trash[\s\S]*restore it from Account → Trash for 30 days/);
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("d2", true));
    expect(calls.at(-1)).toBe("DELETE /documents/d2");
  });
});
