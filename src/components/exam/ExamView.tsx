"use client";

import { usePlanChanged } from "@/hooks/usePlanChanged";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, GraduationCap, Plus, Repeat, X, XCircle } from "@/components/icons";
import StudyToolbar from "@/components/study/StudyToolbar";
import UpgradeCard from "@/components/study/UpgradeCard";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, Skeleton, toast } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { useReview } from "@/hooks/useReview";
import { ApiError } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import {
  DIFFICULTY_LABEL, clock, fetchActiveExam, fetchExam, fetchExamHistory, fetchExamOptions, startExam,
  submitExam, type Exam, type ExamDifficulty, type ExamOptions, type ExamSummary,
} from "@/lib/study/exam";
import ExamRunner from "./ExamRunner";
import "./exam.css";

type Phase = "loading" | "setup" | "writing" | "taking" | "results" | "locked";
const DEFAULT_SECONDS: Record<string, number> = { easy: 60, medium: 75, hard: 90, mixed: 75 };

/**
 * Exam mode (Phase 3 Stage 3A): a timed mock test written from the document. Choose length, difficulty and topics;
 * answer with no hints and no feedback; the server grades it once and returns a per-concept breakdown, every
 * answer with its explanation, and a score report the browser prints or saves as a PDF. Missed questions go to the review queue on their own.
 */
export default function ExamView({ documentId }: { documentId?: string }) {
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [phase, setPhase] = useState<Phase>("loading");
  const [exam, setExam] = useState<Exam | null>(null);
  const [options, setOptions] = useState<ExamOptions | null>(null);
  const [history, setHistory] = useState<ExamSummary[]>([]);
  const [length, setLength] = useState(20);
  const [difficulty, setDifficulty] = useState<ExamDifficulty>("mixed");
  const [topics, setTopics] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lockPlan, setLockPlan] = useState("Sage");
  const [tries, setTries] = useState(0);

  const locked = (e: unknown) => {
    if (e instanceof ApiError && e.code === "feature_locked") {
      setLockPlan(String(e.details?.required_tier_name ?? "Sage"));
      setPhase("locked");
      return true;
    }
    return false;
  };

  // An exam in progress (any document) comes back after a refresh; otherwise the setup for this document.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const active = await fetchActiveExam();
        if (!alive) return;
        if (active) { setExam(active); setPhase("taking"); return; }
        const [opts, past] = await Promise.all([documentId ? fetchExamOptions(documentId) : Promise.resolve(null), fetchExamHistory()]);
        if (!alive) return;
        setOptions(opts);
        setHistory(past);
        setPhase("setup");
      } catch (e) {
        if (alive && !locked(e)) { toast.apiError(e); setPhase("setup"); }
      }
    })();
    return () => { alive = false; };
  }, [documentId, tries]);
  usePlanChanged(() => { setPhase("loading"); setTries((n) => n + 1); }, phase === "locked");   // upgraded while looking at the lock

  const begin = async () => {
    if (!documentId) return;
    setPhase("writing");
    try {
      const e = await startExam(documentId, length, difficulty, topics);
      setExam(e);
      setPhase("taking");
    } catch (e) {
      if (e instanceof ApiError && e.code === "exam_in_progress" && e.details?.exam_id) {
        setExam(await fetchExam(String(e.details.exam_id)));
        setPhase("taking");
        return;
      }
      if (!locked(e)) { toast.apiError(e, { onRetry: () => { void begin(); } }); setPhase("setup"); }
    }
  };

  const submit = useCallback(async () => {
    if (!exam || submitting) return;
    setSubmitting(true);
    try {
      const graded = await submitExam(exam.id);
      setExam(graded);
      setPhase("results");
      if (graded.rewards?.ok) toast.success(`Exam complete: +${graded.rewards.xp_gained} XP | +${graded.rewards.coins_gained} Coins`, { icon: "🎓" });
      void refreshIfStale(5_000);
      void useReview.getState().load();               // the misses joined the review queue
    } catch (e) {
      toast.apiError(e, { onRetry: () => { void submit(); } });
    } finally {
      setSubmitting(false);
    }
  }, [exam, submitting, refreshIfStale]);

  const openPast = async (id: string) => {
    try { setExam(await fetchExam(id)); setPhase("results"); } catch (e) { toast.apiError(e); }
  };

  const addTopic = (t: string) => {
    const v = t.trim();
    if (!v || topics.length >= (options?.max_topics ?? 5) || topics.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setTopics((list) => [...list, v]);
  };
  const toggleTopic = (t: string) =>
    topics.includes(t) ? setTopics((list) => list.filter((x) => x !== t)) : addTopic(t);

  const subtitle = phase === "taking" && exam ? `${exam.doc_name} · ${DIFFICULTY_LABEL[exam.difficulty as ExamDifficulty] ?? exam.difficulty}`
    : "A timed mock test from your document";
  const frame = (body: React.ReactNode, wide = false) => (
    <div className="ws-pane flex flex-col h-full overflow-hidden">
      <StudyToolbar title="Exam" subtitle={subtitle} />
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8" tabIndex={0} role="region" aria-label="Exam">
        <div className={`mx-auto w-full ${wide ? "max-w-[84ch]" : "max-w-[72ch]"}`}>{body}</div>
      </div>
    </div>
  );

  if (phase === "loading") return frame(<Skeleton className="h-[360px] w-full rounded-[var(--radius-xl)]" />);
  if (phase === "locked") {
    return frame(
      <UpgradeCard feature="Exam mode" plan={lockPlan}
                   description="Timed mock tests written from your document, graded with a per-concept breakdown and a score report you can save as a PDF. Every miss goes to your review queue.">
        <ButtonLink href={ROUTES.studyTab("quiz", undefined, documentId)} size="sm">Take a quiz instead</ButtonLink>
      </UpgradeCard>,
    );
  }
  if (phase === "writing") {
    return frame(
      <div className="exam-writing" role="status" aria-live="polite">
        <span className="exam-writing__orb" aria-hidden="true" />
        <h3>Writing your exam…</h3>
        <p>{length} questions from your document. This can take a minute on a slow model; the clock starts when it is ready.</p>
      </div>,
    );
  }
  if (phase === "taking" && exam) return frame(<ExamRunner key={exam.id} exam={exam} onSubmit={submit} submitting={submitting} />, true);
  if (phase === "results" && exam?.result) return frame(<ExamResults exam={exam} documentId={documentId} onNew={() => { setExam(null); setPhase("setup"); }} />, true);

  // ── setup ────────────────────────────────────────────────────────────────
  if (!documentId) {
    return frame(<EmptyState icon={<GraduationCap size={30} />} title="Upload a PDF to take an exam"
                             description="An exam is written from one of your documents." />);
  }
  const perQ = options?.seconds_per_question?.[difficulty] ?? DEFAULT_SECONDS[difficulty];
  const suggestions = (options?.suggested_topics ?? []).filter((t) => !topics.includes(t));
  return frame(
    <>
      <div className="study-intro">
        <span className="study-intro__icon" aria-hidden="true"><GraduationCap size={26} /></span>
        <div>
          <h3>Mock exam</h3>
          <p>A timed test with no hints. You get a score report, and every miss joins your review queue.</p>
        </div>
      </div>

      <div className="exam-setup">
        <fieldset className="exam-field">
          <legend>Length</legend>
          <div className="exam-choices">
            {(options?.lengths ?? [10, 20, 30]).map((n) => (
              <Button key={n} pressed={length === n} onClick={() => setLength(n)}>{n} questions</Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="exam-field">
          <legend>Difficulty</legend>
          <div className="exam-choices">
            {(["easy", "medium", "hard", "mixed"] as ExamDifficulty[]).map((d) => (
              <Button key={d} pressed={difficulty === d} onClick={() => setDifficulty(d)}>{DIFFICULTY_LABEL[d]}</Button>
            ))}
          </div>
        </fieldset>
        <fieldset className="exam-field">
          <legend>Topics <span className="exam-field__opt">optional · up to {options?.max_topics ?? 5}; none = the whole document</span></legend>
          {topics.length > 0 && (
            <ul className="exam-topics" aria-label="Chosen topics">
              {topics.map((t) => (
                <li key={t}><Button size="sm" variant="secondary" pressed onClick={() => toggleTopic(t)} aria-label={`Remove topic ${t}`}>{t}<X size={13} aria-hidden="true" /></Button></li>
              ))}
            </ul>
          )}
          <form className="exam-topic-form" onSubmit={(e) => { e.preventDefault(); addTopic(custom); setCustom(""); }}>
            <Input aria-label="Add a topic" placeholder="Add a topic, e.g. Krebs cycle" value={custom} maxLength={200}
                   onChange={(e) => setCustom(e.target.value)} />
            <Button type="submit" disabled={!custom.trim()}><Plus size={15} aria-hidden="true" />Add</Button>
          </form>
          {suggestions.length > 0 && (
            <div className="exam-suggest">
              <p className="study-suggest-label">From what you've practised (weakest first)</p>
              <div className="exam-choices">
                {suggestions.slice(0, 8).map((t) => <Button key={t} size="sm" variant="ghost" onClick={() => addTopic(t)}><Plus size={13} aria-hidden="true" />{t}</Button>)}
              </div>
            </div>
          )}
        </fieldset>

        <Card pad="sm" className="exam-summary">
          <span>{length} questions · {DIFFICULTY_LABEL[difficulty]} · <b>{clock(length * perQ)}</b> on the clock ({perQ}s a question)</span>
          <Button variant="primary" onClick={() => void begin()}>Start exam</Button>
        </Card>
      </div>

      {history.length > 0 && (
        <section className="exam-history" aria-labelledby="exam-history-title">
          <h3 id="exam-history-title" className="study-suggest-label">Past exams</h3>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <Button variant="ghost" block className="exam-history__row" onClick={() => void openPast(h.id)} disabled={h.status !== "graded"}>
                  <span className="min-w-0 flex-1 truncate text-left">{h.doc_name}</span>
                  <span className="text-fg-muted">{DIFFICULTY_LABEL[h.difficulty as ExamDifficulty] ?? h.difficulty}</span>
                  <b className="exam-history__score">{h.status === "graded" ? `${h.score}/${h.total}` : "In progress"}</b>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>,
  );
}

function ExamResults({ exam, documentId, onNew }: { exam: Exam; documentId?: string; onNew: () => void }) {
  const r = exam.result!;
  const pct = Math.round(r.accuracy * 100);
  const tone = pct >= 80 ? "success" : pct >= 60 ? "warning" : "danger";
  const missed = exam.questions.filter((q) => !q.correct);
  const bar = (acc: number) => (
    <span className="exam-bar" aria-hidden="true"><span data-tone={acc >= 0.8 ? "good" : acc >= 0.6 ? "ok" : "low"} style={{ width: `${Math.round(acc * 100)}%` }} /></span>
  );
  return (
    <section aria-labelledby="exam-results-title" className="exam-results" data-print="report">
      <div className="exam-results__head">
        <div>
          <h3 id="exam-results-title">Exam results</h3>
          <p>{exam.doc_name} · {DIFFICULTY_LABEL[exam.difficulty as ExamDifficulty] ?? exam.difficulty}{r.auto_submitted ? " · handed in when the time ran out" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2 exam-noprint">
          <Button size="sm" onClick={() => window.print()} title="Print the report, or choose Save as PDF in the print dialog">
            <Download size={15} aria-hidden="true" />Save as PDF
          </Button>
          <Button size="sm" variant="primary" onClick={onNew}>New exam</Button>
        </div>
      </div>

      <dl className="exam-tiles">
        <Card pad="sm" tone={tone}><dd>{r.score}<small> / {r.total}</small></dd><dt>Score</dt></Card>
        <Card pad="sm"><dd>{pct}%</dd><dt>Accuracy</dt></Card>
        <Card pad="sm"><dd>{clock(r.time_used_s)}<small> / {clock(exam.time_limit_s)}</small></dd><dt>Time used</dt></Card>
      </dl>

      <h4 className="exam-h">By concept <span>(weakest first)</span></h4>
      <table className="exam-table">
        <thead><tr><th scope="col">Concept</th><th scope="col">Right</th><th scope="col">Accuracy</th></tr></thead>
        <tbody>
          {r.concepts.map((c) => (
            <tr key={String(c.concept)}>
              <th scope="row">{String(c.concept)}</th>
              <td>{String(c.correct)} / {String(c.total)}</td>
              <td><span className="exam-table__acc">{Math.round(Number(c.accuracy) * 100)}%{bar(Number(c.accuracy))}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="exam-h">By difficulty</h4>
      <div className="exam-levels">
        {r.difficulties.map((d) => (
          <Badge key={String(d.difficulty)} tone={Number(d.accuracy) >= 0.8 ? "success" : Number(d.accuracy) >= 0.6 ? "warning" : "danger"}>
            {String(d.difficulty)}: {String(d.correct)}/{String(d.total)}
          </Badge>
        ))}
      </div>

      {missed.length > 0 && (
        <Card pad="sm" className="exam-next">
          <span><Repeat size={15} aria-hidden="true" /> {missed.length} missed {missed.length === 1 ? "question is" : "questions are"} now in your review queue
            {r.weak_concepts.length ? <>; study next: <b>{r.weak_concepts.join(", ")}</b></> : null}.</span>
          <ButtonLink size="sm" href={ROUTES.studyTab("review", undefined, documentId)}>Review them</ButtonLink>
        </Card>
      )}

      <h4 className="exam-h">Every question</h4>
      <ol className="exam-answers">
        {exam.questions.map((q) => (
          <li key={q.index} data-correct={q.correct || undefined}>
            <p className="exam-answers__q">
              {q.correct ? <CheckCircle2 size={16} className="text-ink-green" aria-hidden="true" /> : <XCircle size={16} className="text-ink-red" aria-hidden="true" />}
              <span><span className="sr-only">{q.correct ? "Right. " : "Wrong. "}</span>{q.index + 1}. {q.question}</span>
            </p>
            <p className="exam-answers__line">Your answer: <b>{q.answer ?? "(no answer)"}</b></p>
            {!q.correct && <p className="exam-answers__line">Correct answer: <b>{q.correct_answer}</b></p>}
            {q.explanation && <p className="exam-answers__why">{q.explanation}</p>}
            <p className="exam-answers__meta">{q.concept} · {q.difficulty}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
