"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock, Flag, Send } from "lucide-react";
import { Button, Modal, toast } from "@/components/ui";
import { useCountdown } from "@/hooks/useCountdown";
import { ApiError } from "@/lib/api";
import { shortcutBlocked } from "@/lib/keys";
import { clock, saveExamAnswer, type Exam, type ExamQuestion } from "@/lib/study/exam";

const MAX_KEY = 4;

/**
 * Taking an exam: one question at a time, a clock that never stops, no hints and no feedback. Answers are saved on
 * the server as they are picked (and can be changed); a question can be flagged to come back to. The grid jumps to
 * any question. Keys: 1-4 pick an option, ← → move, F flags. When the clock hits zero the exam is submitted.
 */
export default function ExamRunner({ exam, onSubmit, submitting }: { exam: Exam; onSubmit: () => void; submitting: boolean }) {
  const [questions, setQuestions] = useState<ExamQuestion[]>(exam.questions);
  const [index, setIndex] = useState(() => Math.max(0, exam.questions.findIndex((q) => q.answer == null)));
  const [confirm, setConfirm] = useState(false);
  const left = useCountdown(exam.seconds_left);
  const q = questions[index];
  const answered = questions.filter((x) => x.answer != null).length;
  const flagged = questions.filter((x) => x.flagged).length;
  const heading = useRef<HTMLHeadingElement>(null);

  // the clock ran out: hand it in (the server grades whatever is saved even if this never arrives)
  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && exam.seconds_left > 0 && !fired.current) {
      fired.current = true;
      toast.info("Time's up. Your exam was handed in.");
      onSubmit();
    }
  }, [left, exam.seconds_left, onSubmit]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);

  const patch = (i: number, change: Partial<ExamQuestion>) =>
    setQuestions((list) => list.map((x) => (x.index === i ? { ...x, ...change } : x)));

  const save = async (i: number, change: { answer?: string; clear?: boolean; flagged?: boolean }, undo: Partial<ExamQuestion>) => {
    try {
      await saveExamAnswer(exam.id, i, change);
    } catch (e) {
      patch(i, undo);
      if (e instanceof ApiError && e.code === "exam_closed") { onSubmit(); return; }
      toast.apiError(e);
    }
  };

  const pick = (option: string) => {
    if (!q || submitting) return;
    const before = { answer: q.answer };
    if (q.answer === option) { patch(q.index, { answer: null }); void save(q.index, { clear: true }, before); }
    else { patch(q.index, { answer: option }); void save(q.index, { answer: option }, before); }
  };
  const toggleFlag = () => {
    if (!q || submitting) return;
    patch(q.index, { flagged: !q.flagged });
    void save(q.index, { flagged: !q.flagged }, { flagged: q.flagged });
  };
  const go = (i: number) => setIndex(Math.max(0, Math.min(questions.length - 1, i)));

  const live = useRef({ pick, toggleFlag, go, index, q, confirm });
  live.current = { pick, toggleFlag, go, index, q, confirm };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (l.confirm || shortcutBlocked(e) || !l.q) return;
      const n = ["1", "2", "3", "4"].indexOf(e.key);
      if (n >= 0 && n < l.q.options.length) { e.preventDefault(); l.pick(l.q.options[n]); }
      else if (e.key === "ArrowRight") { e.preventDefault(); l.go(l.index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); l.go(l.index - 1); }
      else if (e.key.toLowerCase() === "f") { e.preventDefault(); l.toggleFlag(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!q) return null;
  const low = left <= 60;
  return (
    <div className="exam-run">
      <div className="exam-run__bar">
        <span className="exam-clock" data-low={low || undefined} role="timer" aria-live={low ? "polite" : "off"}
              aria-label={`Time left: ${clock(left)}`}>
          <Clock size={15} aria-hidden="true" />{clock(left)}
        </span>
        <span className="text-sm text-fg-muted">{answered} of {questions.length} answered{flagged ? ` · ${flagged} flagged` : ""}</span>
        <Button size="sm" variant="primary" onClick={() => setConfirm(true)} loading={submitting}>
          <Send size={15} aria-hidden="true" />Submit
        </Button>
      </div>

      <nav className="exam-grid" aria-label="Questions">
        {questions.map((x) => (
          <Button key={x.index} size="sm" className="exam-grid__cell" aria-current={x.index === index ? "step" : undefined}
                  data-answered={x.answer != null || undefined} data-flagged={x.flagged || undefined}
                  aria-label={`Question ${x.index + 1}${x.answer != null ? ", answered" : ", not answered"}${x.flagged ? ", flagged" : ""}`}
                  onClick={() => go(x.index)}>
            {x.index + 1}
            {x.flagged && <Flag size={10} className="exam-grid__flag" aria-hidden="true" />}
          </Button>
        ))}
      </nav>

      <section className="exam-q" aria-labelledby="exam-q-title">
        <p className="exam-q__count">Question {index + 1} of {questions.length}</p>
        <h3 id="exam-q-title" ref={heading} tabIndex={-1} style={{ outline: "none" }} className="exam-q__text">{q.question}</h3>
        <div role="radiogroup" aria-labelledby="exam-q-title" className="exam-q__options">
          {q.options.map((opt, i) => (
            <button key={opt} type="button" role="radio" aria-checked={q.answer === opt} className="quiz-opt"
                    data-state={q.answer === opt ? "picked" : undefined} disabled={submitting}
                    aria-keyshortcuts={i < MAX_KEY ? String(i + 1) : undefined} onClick={() => pick(opt)}>
              <span aria-hidden="true" className="quiz-opt__key">{i < MAX_KEY ? i + 1 : ""}</span>
              <span className="min-w-0 flex-1 text-sm text-fg">{opt}</span>
            </button>
          ))}
        </div>
        <div className="exam-q__nav">
          <Button size="sm" onClick={() => go(index - 1)} disabled={index === 0}><ArrowLeft size={15} aria-hidden="true" />Previous</Button>
          <Button size="sm" variant="ghost" pressed={!!q.flagged} onClick={toggleFlag} aria-keyshortcuts="F">
            <Flag size={15} aria-hidden="true" />{q.flagged ? "Flagged" : "Flag for review"}
          </Button>
          {index < questions.length - 1
            ? <Button size="sm" variant="secondary" onClick={() => go(index + 1)}>Next<ArrowRight size={15} aria-hidden="true" /></Button>
            : <Button size="sm" variant="primary" onClick={() => setConfirm(true)}>Review &amp; submit</Button>}
        </div>
        <p className="exam-q__keys">1–{Math.min(MAX_KEY, q.options.length)} answer · ← → move · F flag · picking the same answer again clears it</p>
      </section>

      <Modal open={confirm} onClose={() => setConfirm(false)} title="Submit your exam?"
             actions={<>
               <Button onClick={() => setConfirm(false)}>Keep going</Button>
               <Button variant="primary" loading={submitting} onClick={() => { setConfirm(false); onSubmit(); }}>Submit exam</Button>
             </>}>
        <p className="m-0 text-fg-2">
          {answered === questions.length ? "Every question has an answer." : `${questions.length - answered} of ${questions.length} questions have no answer yet.`}
          {flagged ? ` ${flagged} ${flagged === 1 ? "is" : "are"} flagged.` : ""} You can't change answers after submitting.
        </p>
      </Modal>
    </div>
  );
}
