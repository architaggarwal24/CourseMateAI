"use client";

import { useState } from "react";
import { Trash2 } from "@/components/icons";
import { Button, Modal, toast } from "@/components/ui";
import { useSessionStore } from "@/hooks/useSessions";
import type { DocumentInfo } from "@/lib/api";

/**
 * "Delete PDF?" - deleting a document can't be undone: the file, its pages and its search index go, and it leaves
 * any course it was in. Saved chats and quizzes stay in History.
 */
export default function DeleteDocument({ doc, onClose, onDeleted }: { doc: DocumentInfo; onClose: () => void; onDeleted: (id: string) => void }) {
  const remove = useSessionStore((s) => s.removeDocument);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await remove(doc.id);
      toast.success(`Deleted ${doc.filename}`);
      onDeleted(doc.id);
    } catch (e) {
      toast.apiError(e);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} role="alertdialog" title="Delete this PDF?"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => { void confirm(); }} loading={busy}>
            <Trash2 size={14} aria-hidden="true" />Delete PDF
          </Button>
        </>
      }>
      <p className="m-0"><strong className="break-words">{doc.filename}</strong> will be deleted for good: the file, its pages and its search index. It also leaves any course it&apos;s in.</p>
      <p className="mt-2 mb-0 text-sm text-fg-muted">Your saved chats and quizzes stay in History. This can&apos;t be undone.</p>
    </Modal>
  );
}
