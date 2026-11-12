"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookMarked, BookOpen, CheckCircle, Coins, Flame, Plus, Repeat, ScrollText, Swords, Upload } from "@/components/ui/icons";
import { useAuth } from "@/contexts/AuthContext";
import { useReview } from "@/hooks/useReview";
import { useHUDStore } from "@/hooks/useHUD";
import { useCourses } from "@/hooks/useCourses";
import { useDocumentUpload } from "@/hooks/useDocumentUpload";
import { loadMetadata } from "@/lib/study/sessions";
import { greeting, lastSession, reviewProgress, todaySummary, type LastSession } from "@/lib/study/today";
import { ROUTES, type StudyTab } from "@/lib/routes";
import { cn } from "@/lib/utils";
import "./today.css";

/** A card on the Today grid: a labelled region (Law of Common Region), one of them filled with the accent. */
function Tile({ id, title, icon, emphasis, className, children }: {
  id: string; title: string; icon: ReactNode; emphasis?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("today-tile", className)} data-emphasis={emphasis || undefined}>
      <h2 id={id} className="today-tile__title"><span aria-hidden="true">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="today-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

const firstName = (u: { full_name?: unknown; username?: unknown } | null) =>
  String(u?.full_name || u?.username || "").trim().split(/\s+/)[0] || "there";

/**
 * Today: the landing page. The next thing to do comes first and is the one card filled with the accent (the review,
 * with how far through today's cards you are); then where you left off, the streak, the day's quests, your hero, and
 * your PDFs. Everything comes from data the app already loads; nothing here costs an AI call.
 */
export default function TodayView() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const stats = useReview((s) => s.stats);
  const { level, coins, xpInto, xpToNext, streakDays, streakFreezes, quests } = useHUDStore();
  // Study works inside courses (round 7): Today lists them, and a new PDF goes into the latest one.
  const { courses, loaded: coursesLoaded, load: loadCourses } = useCourses();
  useEffect(() => { if (user) loadCourses().catch(() => {}); }, [user, loadCourses]);
  const latest = courses[0];
  const upload = useDocumentUpload(undefined, latest?.id);
  const [session, setSession] = useState<LastSession | null>(null);

  useEffect(() => { if (!loading && !user) router.replace(ROUTES.login); }, [loading, user, router]);
  // Saved sessions live in this browser (localStorage): read after mount so the server render matches.
  useEffect(() => { setSession(lastSession(loadMetadata())); }, []);

  const review = reviewProgress(stats);
  const questList = (quests ?? []) as { completed?: boolean | number }[];
  const questsDone = questList.filter((q) => q.completed === true || q.completed === 1).length;
  const questsLeft = questList.length - questsDone;
  const now = useMemo(() => new Date(), []);
  const xpPct = xpToNext > 0 ? Math.min(100, Math.round((xpInto / xpToNext) * 100)) : 0;

  const continueHref = session
    ? ROUTES.studyTab(session.type as StudyTab, session.id)
    : latest ? ROUTES.studyTab("overview", undefined, latest.id) : null;

  return (
    <div className="today">
      <header className="today__hello">
        <h1>{greeting(now)}, {firstName(user)}</h1>
        <p>{todaySummary({ due: review.locked ? 0 : review.due, questsLeft })}</p>
      </header>

      <div className="today__grid">
        <Tile id="today-review" title="Review" icon={<Repeat size={18} />} emphasis={!review.locked && review.due > 0} className="today-tile--wide">
          {review.locked ? (
            <>
              <p className="today-tile__text">Spaced review brings back what you got wrong, just before you forget it.</p>
              <Link href={ROUTES.accountUsage} className="ui-btn ui-btn--secondary today-tile__cta">See plans<ArrowRight size={16} /></Link>
            </>
          ) : review.due > 0 ? (
            <>
              <p className="today-big"><span className="num">{review.due}</span> {review.due === 1 ? "card" : "cards"} due</p>
              <Bar pct={review.pct} label="Today's review" />
              <p className="today-tile__meta num">{review.done} of {review.total} done today · about {review.minutes} min left</p>
              <Link href={ROUTES.studyTab("review")} className="ui-btn today-tile__cta today-tile__cta--on-accent">Start review</Link>
            </>
          ) : (
            <>
              <p className="today-big today-big--done"><CheckCircle size={26} />All caught up</p>
              <p className="today-tile__meta num">{review.done > 0 ? `${review.done} cards reviewed today.` : "Nothing is due. Cards come back here as they are due."}</p>
            </>
          )}
        </Tile>

        <Tile id="today-continue" title="Continue" icon={<BookOpen size={18} />} className="today-tile--wide">
          {continueHref ? (
            <>
              <p className="today-tile__lead">{session ? `${session.label} · ${session.title ?? "your document"}` : latest?.name}</p>
              <p className="today-tile__text">{session ? session.preview || "Pick up where you stopped." : "Ask it anything, or make a quiz from it."}</p>
              <Link href={continueHref} className="ui-btn ui-btn--primary today-tile__cta">Continue<ArrowRight size={16} /></Link>
            </>
          ) : (
            <>
              <p className="today-tile__text">Make a course for a subject and add its PDFs: then chat with it, quiz yourself, and make flashcards.</p>
              <Link href={ROUTES.study} className="ui-btn ui-btn--primary today-tile__cta"><Plus size={16} />Create a course</Link>
            </>
          )}
        </Tile>

        <Tile id="today-streak" title="Streak" icon={<Flame size={18} />}>
          <p className="today-big"><span className="num">{streakDays}</span>-day streak</p>
          <p className="today-tile__meta">{streakFreezes > 0 ? `${streakFreezes} streak ${streakFreezes === 1 ? "freeze" : "freezes"} saved` : "Study once a day to keep it."}</p>
        </Tile>

        <Tile id="today-quests" title="Daily quests" icon={<ScrollText size={18} />}>
          <p className="today-big"><span className="num">{questsDone}</span> of {questList.length} done</p>
          <Bar pct={questList.length ? Math.round((questsDone / questList.length) * 100) : 0} label="Daily quests" />
          <Link href={ROUTES.heroQuests} className="today-tile__link">See quests<ArrowRight size={16} /></Link>
        </Tile>

        <Tile id="today-hero" title="Hero" icon={<Swords size={18} />}>
          <p className="today-big">Lv <span className="num">{level}</span></p>
          <Bar pct={xpPct} label="XP to the next level" />
          <p className="today-tile__meta num"><Coins size={16} /> {coins.toLocaleString("en-IN")} coins</p>
          <Link href={ROUTES.heroArena} className="today-tile__link">Enter the arena<ArrowRight size={16} /></Link>
        </Tile>

        <Tile id="today-courses" title="Your courses" icon={<BookMarked size={18} />} className="today-tile--wide">
          {courses.length ? (
            <ul className="today-list">
              {courses.slice(0, 4).map((c) => (
                <li key={c.id}>
                  <Link href={ROUTES.studyTab("overview", undefined, c.id)} className="today-list__item">
                    <BookMarked size={16} /><span className="today-list__name">{c.name}</span>
                    <span className="today-tile__meta num">{c.documents.length} PDF{c.documents.length === 1 ? "" : "s"}</span>
                    <ArrowRight size={16} className="today-list__go" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="today-tile__text">{coursesLoaded ? "Your courses show up here once you make one." : "Loading your courses…"}</p>}
        </Tile>

        <Tile id="today-add" title="Add" icon={<Upload size={18} />} className="today-tile--wide">
          {latest ? (
            <>
              <p className="today-tile__text">Drop in lecture notes, a textbook chapter or past papers for <strong>{latest.name}</strong>. It is ready to study in about a minute.</p>
              <button type="button" className="ui-btn ui-btn--secondary today-tile__cta" onClick={upload.pick} disabled={upload.uploading} aria-busy={upload.uploading || undefined}>
                <Upload size={16} />{upload.uploading ? "Uploading…" : `Add PDFs to ${latest.name}`}
              </button>
            </>
          ) : (
            <>
              <p className="today-tile__text">PDFs go into a course: one per subject.</p>
              <Link href={ROUTES.study} className="ui-btn ui-btn--secondary today-tile__cta"><Plus size={16} />Create a course</Link>
            </>
          )}
          <input ref={upload.inputRef} type="file" accept=".pdf" className="hidden" aria-label="Choose PDFs" multiple
            onChange={async (e) => {
              const docs = await upload.uploadMany(Array.from(e.currentTarget.files ?? []));
              if (docs.length === 1) router.push(ROUTES.studyTab("chat", undefined, docs[0].id));
              else if (docs.length > 1 && latest) router.push(ROUTES.studyTab("overview", undefined, latest.id));
            }} />
        </Tile>
      </div>
    </div>
  );
}
