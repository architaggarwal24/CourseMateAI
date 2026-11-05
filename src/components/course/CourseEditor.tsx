"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "@/components/icons";
import { Button, Checkbox, Input, Modal, Textarea, toast } from "@/components/ui";
import { useCourses } from "@/hooks/useCourses";
import type { DocumentInfo } from "@/lib/api";
import type { Course } from "@/lib/study/courses";

/**
 * Create or edit a course: its name, a line about it, and which documents it holds, in order (the order the
 * overview lists them). Deleting a course keeps its documents.
 */
export default function CourseEditor({ open, onClose, course, documents, onSaved, onDeleted }: {
  open: boolean; onClose: () => void; course?: Course | null; documents: DocumentInfo[];
  onSaved?: (c: Course) => void; onDeleted?: () => void;
}) {
  const create = useCourses((s) => s.create);
  const update = useCourses((s) => s.update);
  const remove = useCourses((s) => s.remove);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(course?.name ?? "");
    setDescription(course?.description ?? "");
    setPicked(course?.documents.map((d) => d.id) ?? []);
    setError(null);
    setConfirmDelete(false);
  }, [open, course]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const move = (id: string, by: number) => setPicked((p) => {
    const i = p.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    if (!name.trim()) { setError("Give the course a name."); return; }
    setSaving(true);
    try {
      const c = course
        ? await update(course.id, { name, description, document_ids: picked })
        : await create(name, picked, description);
      toast.success(course ? "Course saved" : `Course "${c.name}" created`);
      onSaved?.(c);
      onClose();
    } catch (e) {
      toast.apiError(e);
    } finally {
      setSaving(false);
    }
  };

  const destroy = async () => {
    if (!course) return;
    setSaving(true);
    try {
      await remove(course.id);
      toast.success("Course deleted. Its documents are still in your library.");
      onDeleted?.();
      onClose();
    } catch (e) {
      toast.apiError(e);
    } finally {
      setSaving(false);
    }
  };

  const byId = new Map(documents.map((d) => [d.id, d]));
  const inCourse = picked.map((id) => byId.get(id)).filter(Boolean) as DocumentInfo[];
  return (
    <Modal open={open} onClose={onClose} title={course ? "Edit course" : "New course"} size="wide"
           actions={confirmDelete ? (
             <>
               <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
               <Button variant="danger" loading={saving} onClick={() => void destroy()}>Delete course</Button>
             </>
           ) : (
             <>
               {course && <Button variant="ghost" className="mr-auto" onClick={() => setConfirmDelete(true)}><Trash2 size={15} aria-hidden="true" />Delete</Button>}
               <Button onClick={onClose}>Cancel</Button>
               <Button variant="primary" loading={saving} onClick={() => void save()}>{course ? "Save" : "Create course"}</Button>
             </>
           )}>
      {confirmDelete ? (
        <p className="m-0 text-fg-2">Delete <b>{course?.name}</b>? Its documents stay in your library; only the grouping goes.</p>
      ) : (
        <div className="course-editor">
          <Input label="Name" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setError(null); }}
                 placeholder="e.g. Biology 101" error={error} autoFocus />
          <Textarea label="About (optional)" value={description} maxLength={500} rows={2}
                    onChange={(e) => setDescription(e.target.value)} placeholder="What the course covers, the exam date…" />
          <fieldset className="course-editor__docs">
            <legend>Documents <span>({picked.length} of {documents.length})</span></legend>
            {documents.length === 0 && <p className="text-sm text-fg-muted m-0">Upload a PDF first: courses group your documents.</p>}
            <ul>
              {documents.map((d) => (
                <li key={d.id}>
                  <Checkbox label={d.filename} checked={picked.includes(d.id)} onChange={() => toggle(d.id)}
                            description={d.status === "ready" ? `${d.chunks ?? 0} chunks` : d.status === "failed" ? "Failed to index" : "Still indexing"} />
                </li>
              ))}
            </ul>
          </fieldset>
          {inCourse.length > 1 && (
            <section aria-labelledby="course-order" className="course-editor__order">
              <h3 id="course-order">Order</h3>
              <ol>
                {inCourse.map((d, i) => (
                  <li key={d.id}>
                    <span className="min-w-0 flex-1 truncate">{i + 1}. {d.filename}</span>
                    <Button size="sm" icon variant="ghost" disabled={i === 0} onClick={() => move(d.id, -1)} aria-label={`Move ${d.filename} up`}><ArrowUp size={14} /></Button>
                    <Button size="sm" icon variant="ghost" disabled={i === inCourse.length - 1} onClick={() => move(d.id, 1)} aria-label={`Move ${d.filename} down`}><ArrowDown size={14} /></Button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
