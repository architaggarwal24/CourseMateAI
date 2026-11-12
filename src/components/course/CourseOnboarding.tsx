"use client";

import { useState } from "react";
import { BookMarked, FileText, MessageSquare, Sparkles } from "@/components/ui/icons";
import { Button, Input, toast } from "@/components/ui";
import { useCourses } from "@/hooks/useCourses";
import type { Course } from "@/lib/study/courses";

const IDEAS = ["Biology 101", "Contract law", "Thermodynamics", "UPSC: Polity"];

/**
 * Study starts with a course (round 7): one per subject, holding its PDFs, so every tool (chat, notes, quizzes,
 * review, exams) studies the whole subject at once. Shown when someone has no course yet.
 */
export default function CourseOnboarding({ onCreated }: { onCreated: (c: Course) => void }) {
  const create = useCourses((s) => s.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Give your course a name, like the subject it's for."); return; }
    setBusy(true);
    try {
      const c = await create(name.trim(), []);
      toast.success(`Course "${c.name}" created. Now add its PDFs.`);
      onCreated(c);
    } catch (err) {
      toast.apiError(err);
    } finally { setBusy(false); }
  }

  return (
    <div className="course-onboard">
      <div className="course-onboard__card">
        <span className="course-onboard__icon" aria-hidden="true"><BookMarked size={26} /></span>
        <h2 className="course-onboard__title">Start with a course</h2>
        <p className="course-onboard__lede">A course is one subject and its PDFs. Chat, notes, quizzes and review then study all of it together.</p>
        <ol className="course-onboard__steps" aria-label="How it works">
          <li><span aria-hidden="true">1</span><BookMarked size={15} aria-hidden="true" />Name your course</li>
          <li><span aria-hidden="true">2</span><FileText size={15} aria-hidden="true" />Add its PDFs</li>
          <li><span aria-hidden="true">3</span><MessageSquare size={15} aria-hidden="true" />Ask, quiz, review</li>
        </ol>
        <form onSubmit={submit} className="course-onboard__form" noValidate>
          <Input label="Course name" value={name} placeholder="e.g. Biology 101" autoFocus maxLength={80}
            error={error ?? undefined} onChange={(e) => { setName(e.currentTarget.value); setError(null); }} />
          <div className="course-onboard__ideas" aria-label="Ideas">
            {IDEAS.map((i) => (
              <Button key={i} type="button" size="sm" variant="ghost" onClick={() => { setName(i); setError(null); }}>{i}</Button>
            ))}
          </div>
          <Button type="submit" variant="primary" loading={busy} block><Sparkles size={15} aria-hidden="true" />Create course</Button>
        </form>
      </div>
    </div>
  );
}
