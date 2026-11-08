"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FileX } from "@/components/icons";
import { Button, EmptyState } from "@/components/ui";
import { DOCUMENT_GONE_EVENT } from "@/lib/api/client";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { useDocuments, useSessionStore } from "@/hooks/useSessions";
import { useAuth } from "@/contexts/AuthContext";
import { dueBadge, useReview } from "@/hooks/useReview";
import { courseById, useCourses } from "@/hooks/useCourses";
import { useRevalidate } from "@/hooks/useRevalidate";
import type { Course } from "@/lib/study/courses";
import LibraryMenu from "@/components/course/LibraryMenu";
import "@/components/course/course.css";
import { DEFAULT_STUDY_TAB, ROUTES, isStudyTab, type StudyTab } from "@/lib/routes";
import DocumentHeader from "./DocumentHeader";
import SubNav from "./SubNav";
import "@/components/study/study.css";

const ChatView = dynamic(() => import("@/components/ChatView"), { ssr: false });
const QuizView = dynamic(() => import("@/components/QuizView"), { ssr: false });
const NotesView = dynamic(() => import("@/components/NotesView"), { ssr: false });
const FlashcardView = dynamic(() => import("@/components/FlashcardView"), { ssr: false });
const ReviewView = dynamic(() => import("@/components/review/ReviewView"), { ssr: false });
const ExamView = dynamic(() => import("@/components/exam/ExamView"), { ssr: false });
const ConceptMapView = dynamic(() => import("@/components/map/ConceptMapView"), { ssr: false });
const CourseOverview = dynamic(() => import("@/components/course/CourseOverview"), { ssr: false });
const CourseEditor = dynamic(() => import("@/components/course/CourseEditor"), { ssr: false });

const LABELS: Record<StudyTab, string> = {
  chat: "Chat", quiz: "Quiz", notes: "Notes", flashcards: "Flashcards", map: "Map", review: "Review", exam: "Exam", overview: "Overview",
};
/** The tabs over one document in two groups (read and explore, then test yourself), and over a course (its page first). */
const GROUP: Partial<Record<StudyTab, string>> = { overview: "Course", chat: "Learn", notes: "Learn", map: "Learn", quiz: "Practice", flashcards: "Practice", review: "Practice", exam: "Practice" };
const DOCUMENT_TABS: StudyTab[] = ["chat", "notes", "map", "quiz", "flashcards", "review", "exam"];
const COURSE_TABS: StudyTab[] = ["overview", ...DOCUMENT_TABS];

/**
 * The document workspace. The document comes first: a header shows the active document (from the server's list)
 * and chat, quiz, notes, flashcards, the daily review and exam mode are tabs over it (the review spans every document). The URL holds the state - `?tab=` the active tab,
 * `?doc=` the active document, `?session=` a saved session to reopen (Account > History) - so a refresh keeps all of it.
 * `?doc=` can also be a course (several PDFs studied together): every tab then works on the whole course, and an
 * Overview tab shows its progress. The name in the header is the switcher between courses and documents.
 */
export default function StudyWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab") ?? undefined;
  const restoreSessionId = params.get("session") || undefined;
  const requestedDocId = params.get("doc") || undefined;
  const topic = params.get("topic") || undefined;                     // a tool opened on one concept (the map)

  const { documents, list, loaded } = useDocuments();
  const refreshDocument = useSessionStore((s) => s.refreshDocument);
  const { courses, loaded: coursesLoaded, locked: coursesLocked, load: loadCourses } = useCourses();
  const [editor, setEditor] = useState<{ course: Course | null } | null>(null);

  // The courses load alongside the documents (not after them): a course link (?doc=<course>) waited for both in turn.
  const { user } = useAuth();
  useEffect(() => { if (user) loadCourses().catch(() => {}); }, [user, loadCourses]);
  const course = courseById(courses, requestedDocId) ?? null;
  const tab: StudyTab = isStudyTab(tabParam) && (tabParam !== "overview" || course) ? tabParam : DEFAULT_STUDY_TAB;

  // Which document: the one in the URL; else the one an older saved session was made on (its id is the document's);
  // else the most recently used one on the server.
  const documentId =
    requestedDocId ?? (restoreSessionId && documents[restoreSessionId] ? restoreSessionId : undefined) ?? list[0]?.id;
  const doc = documentId ? documents[documentId] ?? null : null;
  // The URL names a document (or course) the server no longer has (expired, or removed): one clear state, not
  // failing screens. A course id is only "gone" once the courses have loaded without it.
  const gone = loaded && !!requestedDocId && !doc && !course && coursesLoaded;

  // A course is seen by the tools through the documents API (its record: name, status, chunks over its PDFs).
  // When each document was last asked about: the course's record arriving flips `doc` on, and the open-a-tab recheck
  // below would ask for the same record again straight away.
  const checkedAt = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    if (!course) return;
    checkedAt.current = { id: course.id, at: Date.now() };
    refreshDocument(course.id).catch(() => { /* offline: the overview still shows */ });
  }, [course?.id, course?.updated_at, refreshDocument]); // eslint-disable-line react-hooks/exhaustive-deps

  // On a course a dropped PDF becomes a new document (a course isn't replaced by one file).
  const upload = useDocumentUpload(course ? undefined : documentId);

  // Keep the document in the URL once it is known, so a refresh or a shared link opens the same one.
  useEffect(() => {
    if (loaded && documentId && requestedDocId !== documentId) {
      router.replace(ROUTES.studyTab(tab, restoreSessionId, documentId));
    }
  }, [loaded, documentId, requestedDocId, tab, restoreSessionId, router]);

  // Ask the server again whether the document is still there: on opening a tab, when the user comes back to the
  // tab, when the network comes back, and when a request fails because its document is gone. (A document that
  // vanished is dropped from the list.)
  const canRecheck = loaded && !!documentId && !!documents[documentId];
  const recheckDocument = () => {
    if (documentId) refreshDocument(documentId).catch(() => { /* offline: keep what we know */ });
  };
  useEffect(() => {
    if (!canRecheck) return;
    const last = checkedAt.current;
    const justAsked = !!last && last.id === documentId && Date.now() - last.at < 2000;
    checkedAt.current = { id: documentId!, at: Date.now() };
    if (!justAsked) recheckDocument();
    window.addEventListener(DOCUMENT_GONE_EVENT, recheckDocument);
    return () => window.removeEventListener(DOCUMENT_GONE_EVENT, recheckDocument);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, documentId, tab, !!doc, refreshDocument]);
  useRevalidate(recheckDocument, canRecheck);

  const due = useReview((s) => dueBadge(s.stats));
  const items = (course ? COURSE_TABS : DOCUMENT_TABS).map((t) => ({
    href: ROUTES.studyTab(t, undefined, documentId),
    label: LABELS[t],
    group: GROUP[t],
    current: t === tab,
    ...(t === "review" && due ? { badge: { count: due, label: `${due} ${due === 1 ? "card" : "cards"} due` } } : {}),
  }));
  const key = `${tab}:${restoreSessionId ?? ""}:${topic ?? ""}`;

  return (
    <div className="ws">
      <DocumentHeader doc={doc} gone={gone} loaded={loaded} upload={upload} course={course}
        onEditCourse={() => setEditor({ course })}
        switcher={loaded && upload.signedIn ? (name) => (
          <LibraryMenu current={documentId} courses={courses} documents={list} coursesLocked={coursesLocked}
            onPick={(id, kind) => router.push(ROUTES.studyTab(kind === "course" ? "overview" : tab === "overview" ? DEFAULT_STUDY_TAB : tab, undefined, id))}
            onNewCourse={() => setEditor({ course: null })}>{name}</LibraryMenu>
        ) : undefined}
        tabs={<SubNav label="Study tools" items={items} className="!px-[3px]" />} />
      {editor && (
        <CourseEditor open onClose={() => setEditor(null)} course={editor.course} documents={list}
          onSaved={(c) => { if (!editor.course) router.push(ROUTES.studyTab("overview", undefined, c.id)); }}
          onDeleted={() => router.push(ROUTES.studyTab(DEFAULT_STUDY_TAB))} />
      )}
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
            {tab === "quiz"       && <QuizView      key={key} documentId={documentId} restoreSessionId={restoreSessionId} initialTopic={topic} />}
            {tab === "notes"      && <NotesView     key={key} documentId={documentId} restoreSessionId={restoreSessionId} />}
            {tab === "flashcards" && <FlashcardView key={key} documentId={documentId} restoreSessionId={restoreSessionId} initialTopic={topic} />}
            {tab === "map"        && <ConceptMapView key={key} documentId={documentId} />}
            {tab === "review"     && <ReviewView    key={key} documentId={documentId} />}
            {tab === "exam"       && <ExamView      key={key} documentId={documentId} />}
            {tab === "overview"   && course && <CourseOverview key={course.id} course={course} onEdit={() => setEditor({ course })} />}
          </>
        )}
      </div>
    </div>
  );
}
