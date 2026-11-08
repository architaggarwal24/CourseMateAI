"use client";

import { useEffect, useState } from "react";
import { BookMarked, Brain, FileText, GraduationCap, Layers, MessageSquare, Repeat, Upload } from "@/components/icons";
import StudyToolbar from "@/components/study/StudyToolbar";
import { Badge, Button, ButtonLink, Card, EmptyState, Skeleton, toast } from "@/components/ui";
import { ROUTES, type StudyTab } from "@/lib/routes";
import { fetchCourseProgress, type Course, type CourseProgress } from "@/lib/study/courses";

const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);

/**
 * A course's page: how it is going (concepts mastered, accuracy, review cards due, exams), its documents, and
 * every study tool on the whole course at once. All of it is stored data: no AI call.
 */
export default function CourseOverview({ course, onEdit, onUpload, uploading, hasOtherPdfs }: {
  course: Course; onEdit: () => void;
  /** Upload a PDF into this course (the workspace's file picker). */
  onUpload?: () => void; uploading?: boolean;
  /** The user has PDFs outside this course that could be added. */
  hasOtherPdfs?: boolean;
}) {
  const [p, setP] = useState<CourseProgress | null>(null);
  useEffect(() => {
    let alive = true;
    setP(null);
    fetchCourseProgress(course.id).then((x) => { if (alive) setP(x); }).catch((e) => toast.apiError(e));
    return () => { alive = false; };
  }, [course.id, course.updated_at]);

  const link = (tab: StudyTab) => ROUTES.studyTab(tab, undefined, course.id);
  const tools: { tab: StudyTab; label: string; Icon: typeof Brain }[] = [
    { tab: "chat", label: "Ask the course", Icon: MessageSquare }, { tab: "quiz", label: "Quiz", Icon: Brain },
    { tab: "flashcards", label: "Flashcards", Icon: Layers }, { tab: "exam", label: "Mock exam", Icon: GraduationCap },
    { tab: "review", label: "Review", Icon: Repeat },
  ];
  return (
    <div className="ws-pane flex flex-col h-full overflow-hidden">
      <StudyToolbar title={course.name} subtitle={course.description || `${course.documents.length} documents studied together`} />
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8" tabIndex={0} role="region" aria-label="Course overview">
        <div className="mx-auto w-full max-w-[84ch] course-overview">
          {course.documents.length === 0 ? (
            <EmptyState icon={<BookMarked size={30} />} title="Add your first PDF"
                        description="Lecture slides, chapters, past papers: everything this course covers. Chat, notes, quizzes, review and exams then use all of it together. Or drop a PDF anywhere on this page."
                        action={
                          <div className="flex flex-wrap justify-center gap-2">
                            {onUpload && <Button variant="primary" onClick={onUpload} loading={uploading}><Upload size={15} aria-hidden="true" />Upload a PDF</Button>}
                            {(hasOtherPdfs || !onUpload) && <Button onClick={onEdit}>Pick from your PDFs</Button>}
                          </div>
                        } />
          ) : (
            <>
              <section aria-labelledby="course-progress-title">
                <h3 id="course-progress-title" className="course-h">Progress</h3>
                {/* The same grid as the tiles (4 across, 2 on a phone) at a tile's height, so nothing below moves when
                    the numbers arrive. (Skeleton's own inline height wins over a class: it is passed as a prop.) */}
                {!p ? (
                  <div className="course-tiles" aria-label="Loading progress" role="status">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} height="var(--course-tile-h)" className="rounded-[var(--radius-lg)]" />)}
                  </div>
                ) : (
                  <dl className="course-tiles">
                    <Card pad="sm" className="course-tile"><dt>Concepts mastered <span>({p.concepts.strong ?? 0} of {p.concepts.seen ?? 0})</span></dt><dd>{pct(p.mastery)}</dd></Card>
                    <Card pad="sm" className="course-tile"><dt>Right answers <span>({p.answers.correct ?? 0} of {p.answers.total ?? 0})</span></dt><dd>{pct(p.answers.accuracy)}</dd></Card>
                    <Card pad="sm" className="course-tile"><dt>Cards due <span>({p.review.cards} in review)</span></dt><dd>{p.review.due}</dd></Card>
                    <Card pad="sm" className="course-tile"><dt>Last exam <span>({p.exams.length} taken)</span></dt><dd>{p.exams[0] ? pct(p.exams[0].accuracy) : "–"}</dd></Card>
                  </dl>
                )}
                {p && p.concepts.weakest?.length ? (
                  <p className="course-weak">Weakest so far: {p.concepts.weakest.map((c) => <Badge key={c} tone="warning">{c}</Badge>)}</p>
                ) : null}
              </section>

              <section aria-labelledby="course-tools-title">
                <h3 id="course-tools-title" className="course-h">Study the whole course</h3>
                <div className="course-tools">
                  {tools.map(({ tab, label, Icon }) => (
                    <ButtonLink key={tab} href={link(tab)}><Icon size={15} aria-hidden="true" />{label}</ButtonLink>
                  ))}
                </div>
              </section>

              <section aria-labelledby="course-docs-title">
                <h3 id="course-docs-title" className="course-h">Documents</h3>
                <ul className="course-docs">
                  {course.documents.map((d) => {
                    const stats = p?.documents.find((x) => x.id === d.id);
                    return (
                      <li key={d.id}>
                        <FileText size={16} aria-hidden="true" />
                        <a className="course-docs__name" href={ROUTES.studyTab("chat", undefined, d.id)}>{d.filename}</a>
                        {d.status !== "ready" && <Badge tone={d.status === "failed" ? "danger" : "accent"}>{d.status === "failed" ? "Failed" : "Indexing"}</Badge>}
                        <span className="course-docs__meta">
                          {stats?.answered ? `${stats.concepts} concepts · ${pct(stats.accuracy)} right` : "Not studied yet"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
