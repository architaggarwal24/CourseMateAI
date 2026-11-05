"use client";

import { DropdownMenu } from "radix-ui";
import { BookMarked, Check, ChevronsUpDown, FileText, FolderPlus, Lock } from "lucide-react";
import ThemeScope from "@/components/ThemeScope";
import type { DocumentInfo } from "@/lib/api";
import type { Course } from "@/lib/study/courses";

/**
 * The document switcher at the top of the Study workspace: your courses, then your documents. Picking one makes it
 * the workspace's subject (every tab works on a whole course too). "New course…" groups documents into one.
 */
export default function LibraryMenu({ current, courses, documents, coursesLocked, onPick, onNewCourse, children }: {
  current: string | undefined; courses: Course[]; documents: DocumentInfo[]; coursesLocked: boolean;
  onPick: (id: string, kind: "course" | "document") => void; onNewCourse: () => void; children: React.ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="lib-trigger">
        {children}
        <span className="sr-only">: switch document or course</span>
        <ChevronsUpDown size={14} className="lib-trigger__chev" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <ThemeScope theme="study">
          <DropdownMenu.Content side="bottom" align="start" sideOffset={6} className="umenu__menu lib-menu">
            <DropdownMenu.Label className="lib-menu__label">Courses</DropdownMenu.Label>
            {coursesLocked ? (
              <DropdownMenu.Item className="umenu__item" disabled>
                <Lock size={15} aria-hidden="true" />Courses come with Sage
              </DropdownMenu.Item>
            ) : (
              <>
                {courses.map((c) => (
                  <DropdownMenu.Item key={c.id} className="umenu__item" onSelect={() => onPick(c.id, "course")}>
                    <BookMarked size={15} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="lib-menu__meta">{c.documents.length} PDF{c.documents.length === 1 ? "" : "s"}</span>
                    {current === c.id && <Check size={14} aria-label="Current" />}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Item className="umenu__item" onSelect={onNewCourse}>
                  <FolderPlus size={15} aria-hidden="true" />New course…
                </DropdownMenu.Item>
              </>
            )}
            <DropdownMenu.Separator className="umenu__sep" />
            <DropdownMenu.Label className="lib-menu__label">Documents</DropdownMenu.Label>
            {documents.length === 0 && <p className="lib-menu__empty">No documents yet.</p>}
            {documents.map((d) => (
              <DropdownMenu.Item key={d.id} className="umenu__item" onSelect={() => onPick(d.id, "document")}>
                <FileText size={15} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                {d.status !== "ready" && <span className="lib-menu__meta">{d.status === "failed" ? "failed" : "indexing"}</span>}
                {current === d.id && <Check size={14} aria-label="Current" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </ThemeScope>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
