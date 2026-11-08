"use client";

import { DropdownMenu } from "radix-ui";
import { BookMarked, Check, ChevronsUpDown, FileText, FolderPlus } from "@/components/icons";
import ThemeScope from "@/components/ThemeScope";
import type { DocumentInfo } from "@/lib/api";
import type { Course } from "@/lib/study/courses";

/**
 * The switcher at the top of the Study workspace: your courses, each with its PDFs under it (pick a course to study
 * all of it, or one of its PDFs to focus on that one). "New course…" starts another. A PDF that isn't in any course
 * (rare: from before courses were needed) is listed at the end so it can be found and added to one.
 */
export default function LibraryMenu({ current, courses, documents, onPick, onNewCourse, children }: {
  current: string | undefined; courses: Course[]; documents: DocumentInfo[];
  onPick: (id: string, kind: "course" | "document") => void; onNewCourse: () => void; children: React.ReactNode;
}) {
  const inACourse = new Set(courses.flatMap((c) => c.documents.map((d) => d.id)));
  const loose = documents.filter((d) => !inACourse.has(d.id));
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="lib-trigger">
        {children}
        <span className="sr-only">: switch course or PDF</span>
        <ChevronsUpDown size={14} className="lib-trigger__chev" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <ThemeScope theme="study">
          <DropdownMenu.Content side="bottom" align="start" sideOffset={6} className="umenu__menu lib-menu">
            <DropdownMenu.Label className="lib-menu__label">Courses</DropdownMenu.Label>
            {courses.map((c) => (
              <DropdownMenu.Group key={c.id} className="lib-menu__course">
                <DropdownMenu.Item className="umenu__item" onSelect={() => onPick(c.id, "course")}>
                  <BookMarked size={15} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="lib-menu__meta">{c.documents.length} PDF{c.documents.length === 1 ? "" : "s"}</span>
                  {current === c.id && <Check size={14} aria-label="Current" />}
                </DropdownMenu.Item>
                {c.documents.map((d) => (
                  <DropdownMenu.Item key={d.id} className="umenu__item lib-menu__doc" onSelect={() => onPick(d.id, "document")}>
                    <FileText size={14} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                    {d.status !== "ready" && <span className="lib-menu__meta">{d.status === "failed" ? "failed" : "indexing"}</span>}
                    {current === d.id && <Check size={14} aria-label="Current" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Group>
            ))}
            <DropdownMenu.Item className="umenu__item" onSelect={onNewCourse}>
              <FolderPlus size={15} aria-hidden="true" />New course…
            </DropdownMenu.Item>
            {loose.length > 0 && (
              <>
                <DropdownMenu.Separator className="umenu__sep" />
                <DropdownMenu.Label className="lib-menu__label">Not in a course</DropdownMenu.Label>
                {loose.map((d) => (
                  <DropdownMenu.Item key={d.id} className="umenu__item" onSelect={() => onPick(d.id, "document")}>
                    <FileText size={15} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                    {current === d.id && <Check size={14} aria-label="Current" />}
                  </DropdownMenu.Item>
                ))}
              </>
            )}
          </DropdownMenu.Content>
        </ThemeScope>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
