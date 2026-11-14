"use client";

import { useState } from "react";
import { Trash2 } from "@/components/ui/icons";
import { Button, Modal, toast } from "@/components/ui";
import { useSessionStore } from "@/hooks/useSessions";
import { useCourses } from "@/hooks/useCourses";
import type { Course } from "@/lib/study/courses";
import { restoreItem } from "@/lib/study/trash";

/** Undo, in the toast after a delete: the PDF comes straight back (with its courses). */
function UndoDelete({ id, name }: { id: string; name: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" disabled={done} onClick={async () => {
      setDone(true);
      try {
        await restoreItem(id);
        useSessionStore.setState({ documentsLoaded: false });
        await useSessionStore.getState().refreshDocument(id).catch(() => null);
        void useCourses.getState().load(true).catch(() => {});
        toast.success(`${name} is back`);
      } catch (e) { toast.apiError(e); setDone(false); }
    }}>Undo</Button>
  );
}

/**
 * "Delete PDF?" - a deleted document goes to the Trash for 30 days (Account -> Trash): it leaves its courses, and
 * Restore brings it back with its pages, search index and courses. The toast has Undo. Saved chats and quizzes stay
 * in History. With `course` (the bin in the course switcher) the PDF comes out of that course only: it goes to the
 * Trash only when no other course has it (Study works inside courses, so it would be left with nowhere to be studied).
 */
export default function DeleteDocument({ doc, course, onClose, onDeleted }: {
  doc: { id: string; filename: string }; course?: Course | null; onClose: () => void;
  /** `deleted`: the PDF itself is gone (false: it only left `course`). */
  onDeleted: (id: string, deleted: boolean) => void;
}) {
  const remove = useSessionStore((s) => s.removeDocument);
  const courses = useCourses((s) => s.courses);
  const update = useCourses((s) => s.update);
  const [busy, setBusy] = useState(false);
  const elsewhere = course ? courses.filter((c) => c.id !== course.id && c.documents.some((d) => d.id === doc.id)) : [];
  const onlyLeaves = !!course && elsewhere.length > 0;

  async function confirm() {
    setBusy(true);
    try {
      if (onlyLeaves) {
        await update(course!.id, { document_ids: course!.documents.filter((d) => d.id !== doc.id).map((d) => d.id) });
        toast.success(`Removed ${doc.filename} from ${course!.name}`);
      } else {
        await remove(doc.id);
        toast.success(`${doc.filename} moved to the Trash`, { duration: 8000, action: <UndoDelete id={doc.id} name={doc.filename} /> });
      }
      onDeleted(doc.id, !onlyLeaves);
    } catch (e) {
      toast.apiError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} role="alertdialog" title={onlyLeaves ? `Remove from ${course!.name}?` : "Delete this PDF?"}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => { void confirm(); }} loading={busy}>
            <Trash2 size={14} aria-hidden="true" />{onlyLeaves ? "Remove" : "Move to Trash"}
          </Button>
        </>
      }>
      {onlyLeaves ? (
        <p className="m-0"><strong className="break-words">{doc.filename}</strong> leaves {course!.name}. It stays in {elsewhere.map((c) => c.name).join(", ")}.</p>
      ) : (
        <>
          <p className="m-0">
            <strong className="break-words">{doc.filename}</strong>
            {course ? ` leaves ${course.name} and, since it's in no other course, moves to the Trash.` : " moves to the Trash and leaves any course it's in."}
          </p>
          <p className="mt-2 mb-0 text-sm text-fg-muted">You can restore it from Account → Trash for 30 days. Your saved chats and quizzes stay in History.</p>
        </>
      )}
    </Modal>
  );
}
