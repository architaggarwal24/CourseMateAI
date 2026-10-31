"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FileX } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { DOCUMENT_GONE_EVENT } from "@/lib/api/client";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { useDocuments, useSessionStore } from "@/hooks/useSessions";
import { DEFAULT_STUDY_TAB, ROUTES, STUDY_TABS, isStudyTab, type StudyTab } from "@/lib/routes";
import DocumentHeader from "./DocumentHeader";
import SubNav from "./SubNav";
import "@/components/study/study.css";

const ChatView = dynamic(() => import("@/components/ChatView"), { ssr: false });
const QuizView = dynamic(() => import("@/components/QuizView"), { ssr: false });
const NotesView = dynamic(() => import("@/components/NotesView"), { ssr: false });
const FlashcardView = dynamic(() => import("@/components/FlashcardView"), { ssr: false });

const LABELS: Record<StudyTab, string> = { chat: "Chat", quiz: "Quiz", notes: "Notes", flashcards: "Flashcards" };

/**
 * The document workspace. The document comes first: a header shows the active document (from the server's list)
 * and chat, quiz, notes and flashcards are tabs over it. The URL holds the state - `?tab=` the active tab,
 * `?doc=` the active document, `?session=` a saved session to reopen (Account > History) - so a refresh keeps all of it.
 */
export default function StudyWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab") ?? undefined;
  const tab: StudyTab = isStudyTab(tabParam) ? tabParam : DEFAULT_STUDY_TAB;
  const restoreSessionId = params.get("session") || undefined;
  const requestedDocId = params.get("doc") || undefined;

  const { documents, list, loaded } = useDocuments();
  const refreshDocument = useSessionStore((s) => s.refreshDocument);

  // Which document: the one in the URL; else the one an older saved session was made on (its id is the document's);
  // else the most recently used one on the server.
  const documentId =
    requestedDocId ?? (restoreSessionId && documents[restoreSessionId] ? restoreSessionId : undefined) ?? list[0]?.id;
  const doc = documentId ? documents[documentId] ?? null : null;
  // The URL names a document the server no longer has (expired, or removed): one clear state, not failing screens.
  const gone = loaded && !!requestedDocId && !doc;

  const upload = useDocumentUpload(documentId);

  // Keep the document in the URL once it is known, so a refresh or a shared link opens the same one.
  useEffect(() => {
    if (loaded && documentId && requestedDocId !== documentId) {
      router.replace(ROUTES.studyTab(tab, restoreSessionId, documentId));
    }
  }, [loaded, documentId, requestedDocId, tab, restoreSessionId, router]);

  // Ask the server again whether the document is still there: on opening a tab, when the window is focused again
  // and when a request fails because its document is gone. (A document that vanished is dropped from the list.)
  useEffect(() => {
    if (!loaded || !documentId || !documents[documentId]) return;
    const recheck = () => { refreshDocument(documentId).catch(() => { /* offline: keep what we know */ }); };
    const onVisible = () => { if (document.visibilityState === "visible") recheck(); };
    recheck();
    window.addEventListener("focus", recheck);
    window.addEventListener(DOCUMENT_GONE_EVENT, recheck);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener(DOCUMENT_GONE_EVENT, recheck);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, documentId, tab, !!doc, refreshDocument]);

  const items = STUDY_TABS.map((t) => ({
    href: ROUTES.studyTab(t, undefined, documentId),
    label: LABELS[t],
    current: t === tab,
  }));
  const key = `${tab}:${restoreSessionId ?? ""}`;

  return (
    <div className="ws">
      <DocumentHeader doc={doc} gone={gone} loaded={loaded} upload={upload}
        tabs={<SubNav label="Study tools" items={items} className="!px-[3px]" />} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {gone ? (
          <div className="flex-1 flex items-center justify-center px-6">
            <EmptyState
              icon={<FileX size={32} />}
              title="This document is no longer available"
              description="It expired or was removed from the server. Upload the PDF again to keep studying."
              action={<Button variant="primary" onClick={upload.pick} loading={upload.uploading} disabled={!upload.signedIn}>Upload PDF</Button>}
            />
          </div>
        ) : (
          <>
            {tab === "chat"       && <ChatView      key={key} documentId={documentId} restoreSessionId={restoreSessionId} />}
            {tab === "quiz"       && <QuizView      key={key} documentId={documentId} restoreSessionId={restoreSessionId} />}
            {tab === "notes"      && <NotesView     key={key} documentId={documentId} restoreSessionId={restoreSessionId} />}
            {tab === "flashcards" && <FlashcardView key={key} documentId={documentId} restoreSessionId={restoreSessionId} />}
          </>
        )}
      </div>
    </div>
  );
}
