"use client";

// A free tool on its public page (SEO pass, stage 3): paste notes, press one button, get flashcards, a quiz or a
// summary right here (POST /api/v1/tools/run), then an invitation to do it with a whole PDF.
import { useState } from "react";
import { Check, RotateCcw, Sparkles, X } from "@/components/ui/icons";
import { Button, ButtonLink, Textarea } from "@/components/ui";
import { SAMPLE_NOTES, type ToolKind } from "@/lib/landing/tools";
import { ROUTES } from "@/lib/routes";

const MIN = 150, MAX = 4000;
type Card = { front: string; back: string };
type Question = { question: string; options: string[]; answer: number; explanation: string };
type Summary = { title: string; points: string[]; terms: { term: string; meaning: string }[]; takeaway: string };
type Result = { cards?: Card[]; questions?: Question[]; summary?: Summary; remaining: number };

const ACTION: Record<Exclude<ToolKind, "planner">, { button: string; busy: string; what: string }> = {
  flashcards: { button: "Make flashcards", busy: "Writing your flashcards", what: "flashcards" },
  quiz: { button: "Make a quiz", busy: "Writing your quiz", what: "quizzes" },
  summary: { button: "Summarise", busy: "Summarising your notes", what: "summaries" },
};

function Flashcards({ cards }: { cards: Card[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <ul className="tool-cards" aria-label="Your flashcards">
      {cards.map((c, i) => (
        <li key={i}>
          <button type="button" className="tool-card" aria-pressed={!!open[i]} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
            <span className="tool-card__side">{open[i] ? "Answer" : `Card ${i + 1} of ${cards.length}`}</span>
            <span className="tool-card__text">{open[i] ? c.back : c.front}</span>
            <span className="tool-card__hint">{open[i] ? "Tap to see the question" : "Tap to see the answer"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Quiz({ questions }: { questions: Question[] }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const done = Object.keys(picked).length;
  const right = questions.filter((q, i) => picked[i] === q.answer).length;
  return (
    <div className="tool-quiz">
      <ol className="tool-quiz__list" aria-label="Your quiz">
        {questions.map((q, i) => {
          const p = picked[i];
          return (
            <li key={i} className="tool-quiz__q">
              <p className="tool-quiz__text">{q.question}</p>
              <div className="tool-quiz__options" role="group" aria-label={`Question ${i + 1} options`}>
                {q.options.map((o, j) => {
                  const state = p === undefined ? undefined : j === q.answer ? "right" : j === p ? "wrong" : undefined;
                  return (
                    <button key={j} type="button" className="tool-quiz__opt" data-state={state} disabled={p !== undefined}
                      onClick={() => setPicked((x) => ({ ...x, [i]: j }))}>
                      {state === "right" && <Check size={14} aria-label="correct answer" />}{state === "wrong" && <X size={14} aria-label="your answer, wrong" />}{o}
                    </button>
                  );
                })}
              </div>
              {p !== undefined && <p className="tool-quiz__why" role="status">{p === q.answer ? "Right. " : "Not quite. "}{q.explanation}</p>}
            </li>
          );
        })}
      </ol>
      {done === questions.length && <p className="tool-quiz__score" role="status">You got {right} of {questions.length} right.</p>}
    </div>
  );
}

function SummaryView({ s }: { s: Summary }) {
  return (
    <article className="tool-summary" aria-label="Your summary">
      <h3 className="tool-summary__title">{s.title}</h3>
      <ul className="tool-summary__points">{s.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
      {s.terms.length > 0 && (
        <dl className="tool-summary__terms">{s.terms.map((t) => <div key={t.term}><dt>{t.term}</dt><dd>{t.meaning}</dd></div>)}</dl>
      )}
      {s.takeaway && <p className="tool-summary__takeaway"><strong>In one line:</strong> {s.takeaway}</p>}
    </article>
  );
}

export default function FreeTool({ kind }: { kind: Exclude<ToolKind, "planner"> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const a = ACTION[kind];
  const len = text.trim().length;

  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/tools/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: kind, text }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.error?.message ?? "Something went wrong. Please try again."); return; }
      setResult(body as Result);
    } catch {
      setError("You seem to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tool" data-testid="free-tool">
      {!result ? (
        <form className="tool__form" onSubmit={(e) => { e.preventDefault(); if (len >= MIN && len <= MAX && !busy) void run(); }}>
          <Textarea label="Your notes" value={text} onChange={(e) => setText(e.target.value)} rows={10} maxLength={MAX + 500}
            placeholder="Paste a page of notes: a textbook section, your class notes or a summary."
            hint={`${len.toLocaleString("en-IN")} / ${MAX.toLocaleString("en-IN")} characters${len > 0 && len < MIN ? ` (at least ${MIN})` : ""}`}
            error={len > MAX ? `That's more than a page. Shorten it to ${MAX.toLocaleString("en-IN")} characters, or sign up free to use whole PDFs.` : undefined} />
          <div className="tool__actions">
            <Button type="submit" variant="primary" loading={busy} disabled={len < MIN || len > MAX}>
              <Sparkles size={16} aria-hidden="true" />{busy ? a.busy : a.button}
            </Button>
            {!text && <Button type="button" variant="ghost" onClick={() => setText(SAMPLE_NOTES)}>Try sample notes</Button>}
          </div>
          {error && <p className="tool__error" role="alert">{error}</p>}
        </form>
      ) : (
        <div className="tool__result">
          {result.cards && <Flashcards cards={result.cards} />}
          {result.questions && <Quiz questions={result.questions} />}
          {result.summary && <SummaryView s={result.summary} />}
          <p className="tool__note">Made by AI from your notes: check anything important against your textbook.</p>
          <div className="tool__next">
            <div>
              <p className="tool__next-title">Do this with your whole PDF</p>
              <p className="tool__next-text">A free account makes {a.what} from any part of your PDFs, keeps them, and brings them back for review on the right days.</p>
            </div>
            <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
          </div>
          <div className="tool__actions">
            <Button variant="ghost" onClick={() => { setResult(null); setText(""); }}><RotateCcw size={14} aria-hidden="true" />Try other notes</Button>
            <span className="tool__left">{result.remaining} free {result.remaining === 1 ? "run" : "runs"} left today</span>
          </div>
        </div>
      )}
    </div>
  );
}
