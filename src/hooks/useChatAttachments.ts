"use client";
// The cards above the chat box (lib/chat/attachments.ts): files picked, dropped or pasted for the next question, and
// long pasted text. At most MAX_ATTACHMENTS; each is read as it arrives (pictures shrunk, documents read for text),
// and a file that can't be attached says why in a toast instead of becoming a card.
import { useCallback, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { MAX_ATTACHMENTS, pastedText, tryPrepareFile, type Attachment } from "@/lib/chat/attachments";

export function useChatAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(0);

  const add = useCallback(async (files: File[]) => {
    const room = MAX_ATTACHMENTS - items.length - reading;
    if (room <= 0) { toast.error(`A question takes up to ${MAX_ATTACHMENTS} files. Remove one to add another.`); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast.error(`A question takes up to ${MAX_ATTACHMENTS} files: ${files.length - room} left out.`);
    setReading((n) => n + take.length);
    for (const file of take) {
      const got = await tryPrepareFile(file);
      setReading((n) => n - 1);
      if (!got.ok) { toast.error(got.message); continue; }
      const a = got.item;
      setItems((list) => [...list, a]);
      if (a.kind === "text" && a.cut) toast.info(`${a.name} is long: only its first part is attached.`);
    }
  }, [items.length, reading]);

  const addText = useCallback((text: string) => {
    if (items.length + reading >= MAX_ATTACHMENTS) { toast.error(`A question takes up to ${MAX_ATTACHMENTS} files. Remove one to add another.`); return false; }
    setItems((list) => [...list, pastedText(text, list.filter((a) => a.kind === "text" && a.pasted).length + 1)]);
    return true;
  }, [items.length, reading]);

  const remove = useCallback((id: string) => setItems((list) => list.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  return { items, reading: reading > 0, add, addText, remove, clear, setItems };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
