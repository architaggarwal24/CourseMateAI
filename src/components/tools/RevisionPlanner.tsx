"use client";

// The revision planner (free tool, SEO pass stage 3): exam date + chapters -> a day-by-day plan, worked out in the
// browser (src/lib/landing/revision-plan.ts). Nothing typed here leaves the page.
import { useState } from "react";
import { CalendarClock, Printer } from "@/components/ui/icons";
import { Button, ButtonLink, Input, Textarea } from "@/components/ui";
import { makePlan, parseChapters, type Plan } from "@/lib/landing/revision-plan";
import { ROUTES } from "@/lib/routes";

// the CBSE Class 10 Science (086) chapters for 2026-27
const SAMPLE = "Chemical Reactions and Equations\nAcids, Bases and Salts\nMetals and Non-Metals\nCarbon and its Compounds\nLife Processes\nControl and Coordination\nReproduction\nHeredity\nLight: Reflection and Refraction\nThe Human Eye and the Colourful World\nElectricity\nMagnetic Effects of Current\nOur Environment";
const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

export default function RevisionPlanner() {
  const [exam, setExam] = useState("");
  const [chapters, setChapters] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const make = () => setPlan(makePlan({ chapters: parseChapters(chapters), today: new Date(), exam: new Date(`${exam}T00:00:00`) }));

  return (
    <div className="tool" data-testid="free-tool">
      <form className="tool__form" onSubmit={(e) => { e.preventDefault(); make(); }}>
        <Input label="Exam date" type="date" value={exam} onChange={(e) => setExam(e.target.value)} required />
        <Textarea label="Your chapters, one per line" value={chapters} onChange={(e) => setChapters(e.target.value)} rows={8}
          hint="Or just type how many chapters there are, like 13." placeholder="Chapter 1&#10;Chapter 2&#10;Chapter 3" />
        <div className="tool__actions">
          <Button type="submit" variant="primary" disabled={!exam || !chapters.trim()}><CalendarClock size={16} aria-hidden="true" />Make my plan</Button>
          {!chapters && <Button type="button" variant="ghost" onClick={() => setChapters(SAMPLE)}>Use Class 10 Science chapters</Button>}
        </div>
        {plan?.error && <p className="tool__error" role="alert">{plan.error}</p>}
      </form>

      {plan && !plan.error && (
        <div className="tool__result">
          <div className="tool__actions tool__actions--split">
            <p className="tool__left" role="status">{plan.days.length} days · {plan.perDay > 1 ? `${plan.perDay} chapters a day` : "a chapter at a time"} · each chapter reviewed 3 times</p>
            <Button variant="ghost" onClick={() => window.print()}><Printer size={14} aria-hidden="true" />Print</Button>
          </div>
          <ol className="plan" aria-label="Your revision plan">
            {plan.days.map((d) => (
              <li key={d.date} className="plan__day" data-mock={d.mock || undefined} data-done={done[d.date] || undefined}>
                <label className="plan__check">
                  <input type="checkbox" checked={!!done[d.date]} onChange={(e) => setDone((x) => ({ ...x, [d.date]: e.target.checked }))} />
                  <span className="plan__date">{fmt(d.date)}</span>
                </label>
                <div className="plan__what">
                  {d.study.length > 0 && <p><strong>Study:</strong> {d.study.join(", ")}</p>}
                  {d.review.length > 0 && <p><strong>Review:</strong> {d.review.join(", ")}</p>}
                  {d.mock && <p><strong>Mock test:</strong> a timed paper, then revise what you got wrong</p>}
                  {!d.study.length && !d.review.length && !d.mock && <p className="plan__rest">Light day: catch up or rest</p>}
                </div>
              </li>
            ))}
          </ol>
          <div className="tool__next">
            <div>
              <p className="tool__next-title">Let the reviews come to you</p>
              <p className="tool__next-text">Upload your chapters to CourseMateAI and the flashcards from your own notes come back on the right days, in a short daily review.</p>
            </div>
            <ButtonLink href={ROUTES.signup} variant="primary">Start studying free</ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
