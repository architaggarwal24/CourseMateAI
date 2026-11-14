"use client";

// Account -> Trash (data-loss safety): deleted PDFs and courses, each with its days left, Restore, and Delete forever
// (which asks first). Restoring puts a PDF back in its courses and a course back with its PDFs.
import { useCallback, useEffect, useState } from "react";
import { BookMarked, FileText, RotateCcw, Trash2 } from "@/components/ui/icons";
import { Badge, Button, EmptyState, Modal, Skeleton, toast } from "@/components/ui";
import { useCourses } from "@/hooks/useCourses";
import { useSessionStore } from "@/hooks/useSessions";
import { deleteForever, fetchTrash, restoreItem, type TrashItem } from "@/lib/study/trash";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function detail(i: TrashItem): string {
  if (i.kind === "course") return `Course · ${i.documents ?? 0} ${i.documents === 1 ? "PDF" : "PDFs"}`;
  return `PDF${i.pages ? ` · ${i.pages} ${i.pages === 1 ? "page" : "pages"}` : ""}${i.courses ? ` · in ${i.courses} ${i.courses === 1 ? "course" : "courses"}` : ""}`;
}

export default function TrashPanel() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TrashItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchTrash();
      setItems(r.items);
      setDays(r.days);
    } catch (e) { toast.apiError(e); setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function restore(i: TrashItem) {
    setBusy(i.id);
    try {
      await restoreItem(i.id);
      setItems((all) => all?.filter((x) => x.id !== i.id) ?? null);
      // the library and the course list changed: read them again next time they're shown
      useSessionStore.setState({ documentsLoaded: false });
      void useCourses.getState().load(true).catch(() => {});
      toast.success(`${i.name} is back`);
    } catch (e) { toast.apiError(e); }
    setBusy(null);
  }

  async function removeForGood(i: TrashItem) {
    setBusy(i.id);
    try {
      await deleteForever(i.id);
      setItems((all) => all?.filter((x) => x.id !== i.id) ?? null);
      toast.success(`${i.name} deleted for good`);
    } catch (e) { toast.apiError(e); }
    setBusy(null);
    setConfirming(null);
  }

  return (
    <section className="trash" aria-labelledby="trash-title">
      <header className="trash__head">
        <h1 id="trash-title" className="trash__title">Trash</h1>
        <p className="trash__lead">Deleted PDFs and courses stay here for {days} days, then they&apos;re deleted for good.</p>
      </header>

      {items === null ? (
        <div className="trash__list" aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={22} />} title="Nothing in the Trash" description="When you delete a PDF or a course, it waits here so you can bring it back." />
      ) : (
        <ul className="trash__list" aria-label="Deleted items">
          {items.map((i) => (
            <li key={i.id} className="trash__item">
              <span className="trash__icon" aria-hidden="true">{i.kind === "course" ? <BookMarked size={18} /> : <FileText size={18} />}</span>
              <span className="trash__text">
                <span className="trash__name">{i.name}</span>
                <span className="trash__meta">{detail(i)} · deleted {when(i.deleted_at)}</span>
              </span>
              <Badge tone={i.days_left <= 3 ? "danger" : "neutral"}>{i.days_left === 0 ? "Goes today" : `${i.days_left} ${i.days_left === 1 ? "day" : "days"} left`}</Badge>
              <span className="trash__actions">
                <Button size="sm" onClick={() => restore(i)} loading={busy === i.id && !confirming} disabled={!!busy}>
                  <RotateCcw size={14} aria-hidden="true" />Restore
                </Button>
                <Button size="sm" variant="ghost" icon onClick={() => setConfirming(i)} disabled={!!busy} aria-label={`Delete ${i.name} forever`} title="Delete forever">
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <Modal open onClose={() => setConfirming(null)} title="Delete forever?"
          actions={<>
            <Button variant="ghost" onClick={() => setConfirming(null)}>Keep it</Button>
            <Button variant="danger" onClick={() => removeForGood(confirming)} loading={busy === confirming.id}>Delete forever</Button>
          </>}>
          <p className="m-0">
            <strong>{confirming.name}</strong> will be gone for good{confirming.kind === "document" ? ", with its pages and search index" : ""}. This can&apos;t be undone.
          </p>
        </Modal>
      )}
    </section>
  );
}
