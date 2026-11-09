"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { CalendarClock, CheckCircle2, FileText, Layers, Repeat, Trash2 } from "@/components/icons";
import StudyToolbar from "@/components/study/StudyToolbar";
import UpgradeCard from "@/components/study/UpgradeCard";
import { Badge, Button, ButtonLink, Card, EmptyState, Skeleton, toast } from "@/components/ui";
import { useHUDStore } from "@/hooks/useHUD";
import { useReview } from "@/hooks/useReview";
import { ApiError } from "@/lib/api";
import { shortcutBlocked } from "@/lib/keys";
import { UNDO_MS } from "@/lib/undo";
import { ROUTES } from "@/lib/routes";
import {
  RATINGS, SOURCE_LABEL, fetchReviewQueue, formatInterval, gradeReview, removeFromReview, restoreToReview,
  type Rating, type ReviewItem, type ReviewStats,
} from "@/lib/study/review";
import "./review.css";

type Phase = "loading" | "reviewing" | "done" | "empty" | "locked" | "error";

const STATE_LABEL: Record<string, string> = { new: "New", learning: "Learning", review: "Review", relearning: "Relearning" };

function nextDueText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  return secs <= 0 ? "now" : `in ${formatInterval(secs)}`;
}

/**
 * The daily review (Phase 3 Stage 3A): one spaced-repetition queue of flashcards, study scrolls (missed arena
 * questions) and quiz / exam mistakes, scheduled by FSRS on the server. Keyboard first: Space shows the answer,
 * 1-4 grade it (Again, Hard, Good, Easy - each button says when the card comes back). On a phone: tap to reveal,
 * then swipe right for Good, left for Again.
 */
export default function ReviewView({ documentId }: { documentId?: string }) {
  const setStats = useReview((s) => s.setStats);
  const stats = useReview((s) => s.stats);
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thisDocOnly, setThisDocOnly] = useState(false);
  const [done, setDone] = useState(0);
  const [lockInfo, setLockInfo] = useState<{ plan: string } | null>(null);
  const shownAt = useRef(Date.now());
  const cardRef = useRef<HTMLElement>(null);
  const scope = thisDocOnly ? documentId : undefined;

  const removing = useRef(new Set<ReviewItem["id"]>());               // removed, still inside the undo window
  const load = useCallback(async () => {
    setPhase((p) => (p === "reviewing" ? p : "loading"));
    try {
      const q = await fetchReviewQueue({ sessionId: scope, limit: 20 });
      setStats(q.stats as ReviewStats);
      setItems(q.items.filter((i) => !removing.current.has(i.id)));       // (a card waiting out its undo window)
      setRevealed(false);
      shownAt.current = Date.now();
      const left = q.items.filter((i) => !removing.current.has(i.id)).length;
      setPhase(left ? "reviewing" : q.stats.total ? "done" : "empty");
    } catch (e) {
      if (e instanceof ApiError && e.code === "feature_locked") {
        setLockInfo({ plan: String(e.details?.required_tier_name ?? "Scholar") });
        setPhase("locked");
      } else {
        setPhase("error");
        toast.apiError(e, { onRetry: () => { void load(); } });
      }
    }
  }, [scope, setStats]);
  useEffect(() => { void load(); }, [load]);

  const item = items[0];
  const reveal = () => { if (item && !revealed) setRevealed(true); };
  // Keyboard first: the card takes the focus when the review starts (so Space is the card's, not the tab link's).
  useEffect(() => { if (phase === "reviewing") cardRef.current?.focus({ preventScroll: true }); }, [phase]);

  const grade = async (rating: Rating) => {
    if (!item || !revealed || busy) return;
    setBusy(true);
    try {
      const r = await gradeReview(item, rating, Date.now() - shownAt.current);
      setStats(r.stats as ReviewStats);
      setDone((n) => n + 1);
      if (r.rewards?.ok) {
        toast.success(`Review cleared: +${r.rewards.xp_gained} XP | +${r.rewards.coins_gained} Coins`, { icon: "✅" });
      }
      void refreshIfStale(5_000);                     // streak + quest counters
      advance();
    } catch (e) {
      if (e instanceof ApiError && e.code === "review_stale") advance();      // graded elsewhere: move on
      else toast.apiError(e);
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setRevealed(false);
    shownAt.current = Date.now();
    setItems((list) => {
      const rest = list.slice(1);
      if (!rest.length) void load();                  // the next batch (learning cards come back within minutes)
      return rest;
    });
    requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
  };

  // Remove: out of the queue at once (until its question is missed again), with an Undo toast that puts it back.
  // The request goes straight away, so leaving the page or reloading can't lose it.
  const remove = () => {
    if (!item || busy) return;
    const card = item;
    removing.current.add(card.id);
    advance();
    const bump = (d: number) => {                         // the counts and the nav badge follow at once
      const now = useReview.getState().stats;
      if (now) setStats({ ...now, total: Math.max(0, now.total + d), due: Math.max(0, now.due + d) });
    };
    bump(-1);
    const sent = removeFromReview(card.id).then(() => true, (e) => {
      removing.current.delete(card.id);
      setItems((list) => [card, ...list.filter((i) => i.id !== card.id)]);
      setPhase("reviewing");
      bump(1);
      toast.apiError(e);
      return false;
    });
    let id = 0;
    id = toast.success("Card removed. It comes back only if you miss that question again.", {
      duration: UNDO_MS,
      action: (
        <Button size="sm" variant="secondary" onClick={async () => {
          toast.dismiss(id);
          if (!(await sent)) return;
          try {
            await restoreToReview(card.id);
            removing.current.delete(card.id);
            setItems((list) => [card, ...list.filter((i) => i.id !== card.id)]);
            setRevealed(false);
            shownAt.current = Date.now();
            setPhase("reviewing");
            bump(1);
          } catch (e) { toast.apiError(e); }
        }}>Undo</Button>
      ),
    });
  };

  // Keyboard: Space / Enter reveal; 1-4 grade once the answer shows.
  const live = useRef({ reveal, grade, revealed, phase });
  live.current = { reveal, grade, revealed, phase };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (l.phase !== "reviewing" || shortcutBlocked(e)) return;
      const t = e.target as HTMLElement | null;
      if ((e.key === " " || e.key === "Enter") && !l.revealed) {
        if (t && t !== cardRef.current && /^(BUTTON|A|SUMMARY)$/.test(t.tagName)) return;
        e.preventDefault();
        l.reveal();
        return;
      }
      const r = RATINGS.find((x) => x.key === e.key);
      if (r && l.revealed) { e.preventDefault(); void l.grade(r.rating); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Swipe (after reveal): right = Good, left = Again.
  const dragX = useMotionValue(0);
  const rotate = useTransform(dragX, [-240, 240], [-10, 10]);
  const goodOpacity = useTransform(dragX, [20, 120], [0, 1]);
  const againOpacity = useTransform(dragX, [-120, -20], [1, 0]);
  const dragged = useRef(false);

  const subtitle = stats
    ? `${stats.due} due${stats.reviewed_today ? ` · ${stats.reviewed_today} reviewed today` : ""}`
    : "Spaced repetition across your documents";
  const toolbar = (
    <StudyToolbar title="Review" subtitle={subtitle}>
      {documentId && phase !== "locked" && (
        <Button size="sm" pressed={thisDocOnly} onClick={() => setThisDocOnly((v) => !v)}
                title="Review only this document's cards">
          <FileText size={15} aria-hidden="true" />This document
        </Button>
      )}
    </StudyToolbar>
  );

  const frame = (body: React.ReactNode) => (
    <div className="ws-pane flex flex-col h-full overflow-hidden">
      {toolbar}
      {/* focusable, so a keyboard can scroll it on a small screen even when it holds no control */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8" tabIndex={0} role="region" aria-label="Review">
        <div className="mx-auto w-full max-w-[72ch]">{body}</div>
      </div>
    </div>
  );

  if (phase === "loading") {
    return frame(<div aria-busy="true" aria-label="Loading your review queue"><Skeleton className="h-[320px] w-full rounded-[var(--radius-xl)]" /></div>);
  }
  if (phase === "locked") {
    return frame(
      <UpgradeCard feature="Spaced-repetition review" plan={lockInfo?.plan ?? "Scholar"}
                   description="One daily queue of your flashcards, missed arena questions and quiz mistakes, scheduled so you review each one just before you would forget it.">
        <ButtonLink href={ROUTES.studyTab("flashcards", undefined, documentId)} size="sm"><Layers size={15} aria-hidden="true" />Practise flashcards</ButtonLink>
      </UpgradeCard>,
    );
  }
  if (phase === "error") {
    return frame(<EmptyState icon={<Repeat size={30} />} title="The review queue didn't load"
                             action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />);
  }
  if (phase === "empty") {
    return frame(
      <EmptyState icon={<Repeat size={30} />} title="Your review queue is empty"
        description="Cards join it on their own: every flashcard you grade, every arena question you miss (study scrolls) and every quiz or exam mistake. Then they come back right before you'd forget them."
        action={<ButtonLink variant="primary" href={ROUTES.studyTab("flashcards", undefined, documentId)}><Layers size={16} aria-hidden="true" />Make flashcards</ButtonLink>} />,
    );
  }
  if (phase === "done" || !item) {
    const next = nextDueText(stats?.next_due_at);
    return frame(
      <section className="review-done" aria-labelledby="review-done-title">
        <span className="review-done__icon" aria-hidden="true"><CheckCircle2 size={30} /></span>
        <h3 id="review-done-title">All caught up</h3>
        <p>{done ? `You reviewed ${done} ${done === 1 ? "card" : "cards"} this session.` : "Nothing is due right now."}
          {next && <> Next card {next}.</>}</p>
        <dl className="review-done__stats">
          <Card pad="sm"><dd>{stats?.reviewed_today ?? 0}</dd><dt>Reviewed today</dt></Card>
          <Card pad="sm"><dd>{stats?.total ?? 0}</dd><dt>Cards in your queue</dt></Card>
          <Card pad="sm"><dd>{stats?.new_waiting ?? 0}</dd><dt>New, waiting</dt></Card>
        </dl>
        {!!stats?.new_waiting && !stats.new_left_today && (
          <p className="review-done__note">You've met today's limit of new cards. More tomorrow.</p>
        )}
      </section>,
    );
  }

  const sourceLabel = SOURCE_LABEL[item.source] ?? item.source;
  return (
    <div className="ws-pane flex flex-col h-full overflow-hidden">
      {toolbar}
      <div role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={done + (stats?.due ?? items.length)}
           aria-valuenow={done} aria-valuetext={`${done} reviewed, ${stats?.due ?? items.length} to go`} className="study-progress mx-6 shrink-0">
        <div className="study-progress__fill" style={{ width: `${(done / Math.max(1, done + (stats?.due ?? items.length))) * 100}%` }} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[72ch] flex-col items-center">
          <motion.section
            ref={cardRef} key={item.id} tabIndex={-1} style={{ x: dragX, rotate, outline: "none" }} data-testid="review-card" data-revealed={revealed || undefined}
            aria-label={`Review card ${done + 1}`} aria-live="polite"
            onClick={() => { if (!dragged.current) reveal(); }}
            className="review-card touch-pan-y"
            drag={revealed && !busy ? "x" : false} dragSnapToOrigin dragElastic={0.6}
            onDragStart={() => { dragged.current = true; }}
            onDragEnd={(_, info) => {
              setTimeout(() => { dragged.current = false; }, 0);
              if (info.offset.x > 120) void grade(3);
              else if (info.offset.x < -120) void grade(1);
            }}
            initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
          >
            <motion.span className="review-stamp review-stamp--good" style={{ opacity: goodOpacity }} aria-hidden="true">Good</motion.span>
            <motion.span className="review-stamp review-stamp--again" style={{ opacity: againOpacity }} aria-hidden="true">Again</motion.span>
            <div className="review-card__meta">
              <Badge tone={item.state === "new" ? "accent" : item.state === "review" ? "success" : "warning"}>{STATE_LABEL[item.state] ?? item.state}</Badge>
              <span>{sourceLabel}</span>
              {item.concept && <><span aria-hidden="true">·</span><span>{item.concept}</span></>}
              {item.document?.name && <span className="review-card__doc" title={item.document.name}>{item.document.name}</span>}
            </div>
            <p className="review-card__front">{item.front}</p>
            {revealed ? (
              <div className="review-card__back">
                <p className="review-card__answer">{item.back}</p>
                {item.explanation && <p className="review-card__why">{item.explanation}</p>}
              </div>
            ) : (
              <p className="review-card__hint"><kbd className="kbd">Space</kbd> or tap to show the answer</p>
            )}
          </motion.section>

          {revealed ? (
            <div className="review-grades" role="group" aria-label="How well did you know it?">
              {RATINGS.map((r) => (
                <Button key={r.rating} variant={r.rating === 3 ? "primary" : r.rating === 1 ? "danger" : "secondary"}
                        className="review-grade" data-rating={r.rating} disabled={busy} aria-keyshortcuts={r.key}
                        title={r.hint} onClick={() => void grade(r.rating)}>
                  <span className="review-grade__label">{r.label}</span>
                  <span className="review-grade__when">{item.intervals ? formatInterval(item.intervals[String(r.rating)] ?? 0) : r.hint}</span>
                  <kbd className="kbd review-grade__key" aria-hidden="true">{r.key}</kbd>
                </Button>
              ))}
            </div>
          ) : (
            <Button variant="primary" className="mt-6" onClick={reveal} aria-keyshortcuts="Space">Show answer</Button>
          )}

          <div className="mt-5 flex items-center gap-3 text-xs text-fg-muted">
            <CalendarClock size={14} aria-hidden="true" />
            <span>{revealed ? "1-4 grade · swipe → Good, ← Again" : "Space shows the answer"}</span>
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy} title="Remove this card from your review queue (you can undo it)">
              <Trash2 size={14} aria-hidden="true" />Remove
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
