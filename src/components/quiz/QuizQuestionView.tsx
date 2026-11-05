"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { Button, Card } from "@/components/ui";
import type { QuizFeedback, QuizQuestion } from "@/types";
import { sameAnswer } from "./answers";
import { shortcutBlocked } from "@/lib/keys";

const MAX_KEY = 4;

interface Props {
  /** Zero-based position of this question and the number of questions the quiz actually has. */
  index: number;
  total: number;
  question: QuizQuestion;
  /** The option the user picked, once they have. */
  picked?: string;
  /** The server's verdict for this question (known once it is answered). */
  result?: QuizFeedback;
  /** The question has been answered: show the verdict, the explanation and "Next". */
  revealed: boolean;
  /** An answer is being checked on the server. */
  checking: boolean;
  onAnswer: (option: string) => void;
  onNext: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
}

/** One question on its own screen: "n of N", the options (click, or keys 1-4), then the verdict and explanation. */
export default function QuizQuestionView({ index, total, question, picked, result, revealed, checking, onAnswer, onNext }: Props) {
  const options = question.options ?? [];
  const nextRef = useRef<HTMLButtonElement>(null);
  const isLast = index >= total - 1;
  const canAnswer = !revealed && !checking;

  // Answer with the number keys. One listener for the life of the question, reading the latest state through a ref,
  // so a key pressed the instant the question appears is never lost between renders.
  const live = useRef({ canAnswer, options, onAnswer });
  live.current = { canAnswer, options, onAnswer };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (!l.canAnswer || e.shiftKey || shortcutBlocked(e)) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const n = Number(e.key);
      if (n > MAX_KEY || n > l.options.length) return;
      e.preventDefault();
      l.onAnswer(l.options[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After answering, "Next" has the focus, so Enter carries on.
  useEffect(() => { if (revealed) nextRef.current?.focus(); }, [revealed]);

  const correct = !!result?.correct;
  const progress = ((index + (revealed ? 1 : 0)) / Math.max(total, 1)) * 100;
  const keyCount = Math.min(options.length, MAX_KEY);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8">
      <div className="mx-auto w-full max-w-[72ch] space-y-6">
        <div>
          <p className="mb-2 flex items-baseline justify-between text-sm text-fg-muted"><span>Question {index + 1} of {total}</span><span className="font-num text-xs">{Math.round(progress)}%</span></p>
          <div role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total}
               aria-valuenow={index + (revealed ? 1 : 0)} aria-valuetext={`Question ${index + 1} of ${total}`}
               className="study-progress">
            <div className="study-progress__fill" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <h3 className="text-xl font-semibold leading-[1.5] tracking-tight text-fg">{question.question}</h3>

        <ul aria-label="Answers" className="m-0 list-none space-y-3 p-0">
          {options.map((opt, i) => {
            const isPicked = picked === opt;
            const isCorrectOption = revealed && !!result && sameAnswer(opt, result.correct_answer);
            const isWrongPick = revealed && isPicked && !correct && !isCorrectOption;
            const state = isCorrectOption ? "correct" : isWrongPick ? "wrong" : isPicked ? "picked" : revealed ? "dim" : undefined;
            return (
              <motion.li key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                         transition={{ delay: 0.08 + i * 0.05, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
                <button type="button" disabled={!canAnswer} onClick={() => onAnswer(opt)}
                        aria-keyshortcuts={i < MAX_KEY ? String(i + 1) : undefined}
                        data-state={state} className="quiz-opt">
                  <span aria-hidden="true" className="quiz-opt__key">
                    {state === "correct" ? <CheckCircle2 size={14} /> : state === "wrong" ? <XCircle size={14} /> : i < MAX_KEY ? i + 1 : ""}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-fg">{opt}</span>
                  {isCorrectOption && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink-green">
                      <CheckCircle2 size={18} aria-hidden="true" />{isPicked ? "Your answer · Correct" : "Correct answer"}
                    </span>
                  )}
                  {isWrongPick && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-ink-red">
                      <XCircle size={18} aria-hidden="true" />Your answer · Incorrect
                    </span>
                  )}
                </button>
              </motion.li>
            );
          })}
        </ul>

        {!revealed && keyCount > 1 && (
          <p className="text-xs text-fg-muted">Press 1–{keyCount} to answer</p>
        )}

        <div role="status" aria-live="polite">
          {revealed && (
            <Card tone={result ? (correct ? "success" : "danger") : "default"} pad="sm" className="quiz-verdict space-y-1">
              {result && (
                <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                  {correct
                    ? <><CheckCircle2 size={18} className="text-ink-green" aria-hidden="true" />Correct</>
                    : <><XCircle size={18} className="text-ink-red" aria-hidden="true" />Incorrect. The correct answer is {result.correct_answer}</>}
                </p>
              )}
              {(result?.explanation ?? question.explanation) && (
                <p className="text-sm leading-[1.6] text-fg-2">{result?.explanation ?? question.explanation}</p>
              )}
            </Card>
          )}
        </div>

        {revealed && (
          <Button ref={nextRef} variant="primary" block onClick={onNext}>
            {isLast ? "Finish quiz" : <>Next question <ArrowRight size={16} aria-hidden="true" /></>}
          </Button>
        )}
      </div>
    </div>
  );
}
