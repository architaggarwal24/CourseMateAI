// Pure helpers for showing a document's processing stages. The server decides the status; this only
// turns it into labels and steps.
import type { DocumentInfo, DocumentStatus } from "@/lib/api";

/** The happy path, in order. `failed` and `needs_reindex` are side exits, not steps. */
export const STAGES: { status: DocumentStatus; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "reading", label: "Reading PDF" },
  { status: "indexing", label: "Indexing" },
  { status: "ready", label: "Ready" },
];

export const POLL_INTERVAL_MS = 1000;
export const SLOW_POLL_INTERVAL_MS = 3000;   // after a while, big PDFs don't need a request every second
export const SLOW_POLL_AFTER = 30;           // polls

/** Still being processed - keep polling. */
export function isInFlight(status: DocumentStatus | undefined): boolean {
  return status === "queued" || status === "reading" || status === "indexing";
}

export function isUsable(doc: Pick<DocumentInfo, "status"> | null | undefined): boolean {
  return doc?.status === "ready";
}

export function stageIndex(status: DocumentStatus): number {
  return STAGES.findIndex((s) => s.status === status);
}

export function stageLabel(status: DocumentStatus): string {
  switch (status) {
    case "failed":
      return "Failed";
    case "needs_reindex":
      return "Needs re-indexing";
    default:
      return STAGES.find((s) => s.status === status)?.label ?? status;
  }
}

/** One short line for the current state, e.g. for a tooltip or a screen reader. */
export function describeDocument(doc: DocumentInfo): string {
  switch (doc.status) {
    case "ready":
      return `${doc.filename} is ready`;
    case "failed":
      return doc.error || `${doc.filename} could not be processed`;
    case "needs_reindex":
      return `${doc.filename} was indexed with a different embedding model - upload it again to re-index`;
    default:
      return `${doc.filename}: ${stageLabel(doc.status).toLowerCase()}…`;
  }
}
