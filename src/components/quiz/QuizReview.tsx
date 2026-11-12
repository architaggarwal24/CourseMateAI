"use client";

import { CheckCircle2, MinusCircle, Repeat, RotateCcw, Target, XCircle } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { AnimatedNumber } from "@/components/fx";
import type { QuizFeedback, QuizQuestion } from "@/types";

interface Props {
  topic: string;
  questions: QuizQuestion[];
  answers: Record<number, string>;
  /** The verdict for each question, by question id (undefined where it was never answered). */
  verdict: (q: QuizQuestion) => QuizFeedback | undefined;
  onNewQuiz: () => void;
  /** From the server once the quiz is scored: missed questions went to the review queue; the ideas to work on. */
  summary?: { missed: number[]; added_to_review: number; weak_concepts: string[] } | null;
  onRetryMissed?: () => void;
  retrying?: boolean;
}

/** The final screen: the score, then every question with the user's answer and the correct one. */
export default function QuizReview({ topic, questions, answers, verdict, onNewQuiz, summary, onRetryMissed, retrying }: Props) {
  const rows = questions.map((q) => ({ q, picked: answers[q.id], fb: verdict(q) }));
  const score = rows.filter((r) => r.fb?.correct).length;
  const total = rows.length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-[72ch] space-y-6">
        <div className="study-card flex flex-wrap items-center gap-6">
          <ScoreRing pct={pct} />
          <div className="min-w-0">
            <p className="study-suggest-label !mb-1">{pct >= 80 ? "Excellent work" : pct >= 50 ? "Good effort" : "Keep practising"}</p>
            <h3 className="text-2xl font-bold tracking-tight text-fg">{score} of {total} correct</h3>
            <p className="mt-1 text-sm text-fg-muted">{topic}</p>
          </div>
        </div>

        {summary && summary.missed.length > 0 && (
          <section className="study-card quiz-next" aria-label="What next">
            <p className="quiz-next__line"><Repeat size={16} aria-hidden="true" />
              {summary.added_to_review} missed {summary.added_to_review === 1 ? "question is" : "questions are"} in your Review now: they come back just before you&apos;d forget them.</p>
            {summary.weak_concepts.length > 0 && (
              <p className="quiz-next__line"><Target size={16} aria-hidden="true" />Work on: {summary.weak_concepts.join(", ")}</p>
            )}
            {onRetryMissed && (
              <Button onClick={onRetryMissed} loading={retrying}><RotateCcw size={15} aria-hidden="true" />Retry the {summary.missed.length === 1 ? "one" : summary.missed.length} I missed</Button>
            )}
          </section>
        )}

        <ol aria-label="Review" className="m-0 list-none space-y-4 p-0">
          {rows.map(({ q, picked, fb }, i) => (
            <li key={q.id} className="review-item" data-result={!picked ? undefined : fb?.correct ? "correct" : "wrong"}>
              <p className="text-xs text-fg-muted">Question {i + 1} of {total}</p>
              <p className="mt-1 text-base leading-[1.6] text-fg">{q.question}</p>
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-fg">
                {!picked ? <><MinusCircle size={16} className="text-fg-muted" aria-hidden="true" />Not answered</>
                  : fb?.correct ? <><CheckCircle2 size={16} className="text-ink-green" aria-hidden="true" />Correct</>
                  : <><XCircle size={16} className="text-ink-red" aria-hidden="true" />Incorrect</>}
              </p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex gap-2"><dt className="text-fg-muted">Your answer:</dt><dd className="text-fg">{picked ?? "—"}</dd></div>
                {fb && <div className="flex gap-2"><dt className="text-fg-muted">Correct answer:</dt><dd className="text-fg">{fb.correct_answer}</dd></div>}
              </dl>
              {fb?.explanation && (
                <details className="mt-3 text-sm text-fg-2">
                  <summary className="cursor-pointer text-fg-muted">Explanation</summary>
                  <p className="mt-1 leading-[1.6]">{fb.explanation}</p>
                  {fb.source && <p className="mt-1 text-xs text-fg-muted">Read again: {fb.source}</p>}
                </details>
              )}
            </li>
          ))}
        </ol>

        <Button variant="primary" block onClick={onNewQuiz}>New quiz</Button>
      </div>
    </div>
  );
}

/** The score as a ring that fills on arrival, with the percentage counting up in the middle. */
function ScoreRing({ pct }: { pct: number }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="score-ring" data-tone={pct >= 80 ? "good" : pct < 50 ? "bad" : undefined} aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <circle className="score-ring__track" cx="60" cy="60" r={r} fill="none" strokeWidth="10" />
        <circle className="score-ring__fill" cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="score-ring__label"><span className="score-ring__pct"><AnimatedNumber value={pct} />%</span></div>
    </div>
  );
}
