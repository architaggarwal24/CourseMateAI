"use client";
// The attachment cards (Files stage 3): above the chat box while writing (each with a remove ×), and small chips on a
// sent question showing what went with it.
import { FileText, ImageIcon, X } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import type { Attachment } from "@/lib/chat/attachments";

export function AttachmentTray({ items, reading, onRemove }: { items: Attachment[]; reading: boolean; onRemove: (id: string) => void }) {
  if (!items.length && !reading) return null;
  return (
    <ul className="chat-attach mx-auto w-full max-w-[72ch]" aria-label="Attached to your next question">
      {items.map((a) => (
        <li key={a.id} className="chat-attach__card" title={a.name}>
          {a.kind === "image"
            ? <img src={a.preview} alt="" className="chat-attach__thumb" />
            : <span className="chat-attach__icon" aria-hidden="true"><FileText size={16} /></span>}
          <span className="chat-attach__name">{a.name}</span>
          <Button size="sm" icon variant="ghost" className="chat-attach__remove" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.name}`}><X size={14} /></Button>
        </li>
      ))}
      {reading && <li className="chat-attach__card chat-attach__card--reading" aria-live="polite">Reading…</li>}
    </ul>
  );
}

/** What went with a sent question: names only (the files themselves aren't kept in the conversation). */
export function SentAttachments({ items }: { items: { name: string; kind: "image" | "text" }[] }) {
  return (
    <ul className="chat-sent-attach" aria-label="Attached">
      {items.map((a, i) => (
        <li key={`${a.name}-${i}`}>{a.kind === "image" ? <ImageIcon size={13} aria-hidden="true" /> : <FileText size={13} aria-hidden="true" />}{a.name}</li>
      ))}
    </ul>
  );
}
