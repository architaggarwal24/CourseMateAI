"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, useMotionValue, useTransform } from "motion/react";
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, CheckCircle2, XCircle, Sparkles, Minus, Plus, Layers } from "lucide-react";
import HistoryPanel from "./HistoryPanel";
import StudyToolbar from "./study/StudyToolbar";
import { Badge, Button, Card, Input } from "@/components/ui";
import { fetchReviewDeck, generateFlashcards, reviewFlashcard, type ReviewCard } from "@/lib/api";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { useHUDStore } from "@/hooks/useHUD";
import { toast } from "@/components/ui/Toast";
import { shortcutBlocked } from "@/lib/keys";

interface Card {
  id: number;
  front: string;
  back: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
}

type CardResult = "correct" | "wrong" | null;

interface SavedFlashcardSession {
  cards: Card[];
  results: Record<number, CardResult>;
  currentIndex: number;
  topic: string;
}

/** `documentId` is the workspace's active document (what the cards are about); `historyId` is just this saved deck. */
export default function FlashcardView({ documentId, restoreSessionId }: { documentId?: string; restoreSessionId?: string }) {
  const [historyId] = useState(() => restoreSessionId || crypto.randomUUID());
  const sessionId = documentId ?? historyId;
  const [showHistory, setShowHistory] = useState(false);
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [topic, setTopic] = useState("");
  const [numCards, setNumCards] = useState(10);
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<number, CardResult>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [pendingRewards, setPendingRewards] = useState<{xp_gained:number;coins_gained:number}|null>(null);

  // Open a saved deck (on mount when reopened from history, or picked in the history panel).
  const openDeck = useCallback((id: string) => {
    const saved = loadSessionData<SavedFlashcardSession>(id);
    if (!saved?.cards?.length) return;
    setCards(saved.cards);
    setTopic(saved.topic || "");
    setCurrentIndex(saved.currentIndex ?? 0);
    setResults(saved.results ?? {});
    setFlipped(false);
    setDone(false);
    setShowHistory(false);
  }, []);
  useEffect(() => {
    if (restoreSessionId) openDeck(restoreSessionId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save progress on every card flip/result
  useEffect(() => {
    if (!cards.length || !topic) return;
    saveSessionData(
      historyId,
      "flashcards",
      `${topic} · ${currentIndex + 1}/${cards.length}`,
      { cards, results, currentIndex, topic } as SavedFlashcardSession,
      topic
    );
  }, [results, currentIndex, cards, topic, historyId]);

  // Missed questions from the arena and quizzes, as a ready-made deck ("Study scrolls"). ?review=1 opens it at once.
  const [reviewDeck, setReviewDeck] = useState<ReviewCard[]>([]);
  useEffect(() => {
    if (!documentId || restoreSessionId) return;
    let alive = true;
    fetchReviewDeck(documentId).then((deck) => {
      if (!alive) return;
      setReviewDeck(deck);
      if (deck.length && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("review") === "1") startReview(deck);
    }).catch(() => { /* optional */ });
    return () => { alive = false; };
  }, [documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startReview = (deck: ReviewCard[] = reviewDeck) => {
    if (!deck.length) return;
    setCards(deck.map((c, i) => ({
      id: i + 1, front: c.front, back: c.explanation ? `${c.back}\n\n${c.explanation}` : c.back,
      topic: c.concept, difficulty: (c.difficulty === "easy" || c.difficulty === "hard" ? c.difficulty : "medium") as Card["difficulty"],
    })));
    setTopic("Missed questions");
    setCurrentIndex(0); setFlipped(false); setResults({}); setDone(false); setPendingRewards(null);
  };

  const handleGenerate = async () => {
    if (!topic.trim()) { toast.error("Enter a topic first"); return; }
    setLoading(true);
    try {
      const data = await generateFlashcards(topic.trim(), sessionId, numCards);
      if (data?.cards?.length) {
        setCards(data.cards);
        setCurrentIndex(0);
        setFlipped(false);
        setResults({});
        setDone(false);
        setPendingRewards(data.rewards?.ok ? data.rewards : null);
      } else {
        toast.error("No flashcards generated. Make sure a PDF is uploaded.");
      }
    } catch (e) {
      toast.apiError(e, { onRetry: handleGenerate });
    }
    setLoading(false);
  };

  const flip = () => setFlipped((f) => !f);

  // Fire reward toast when deck is finished
  useEffect(() => {
    if (done && pendingRewards) {
      toast.success(`+${pendingRewards.xp_gained} XP | +${pendingRewards.coins_gained} Coins`, { icon: "🃏" });
      if ((pendingRewards as any).new_achievements?.length) {
        for (const ach of (pendingRewards as any).new_achievements) {
          toast.success(`🏆 Achievement Unlocked: ${ach.name}`, { description: ach.description, duration: 5000 });
        }
      }
      refreshIfStale(5_000);
      setPendingRewards(null);
    }
  }, [done, pendingRewards, refreshIfStale]);

  // One mark per card: a swipe plus a click (or a double click) during the short advance must not count twice or skip.
  const marking = useRef(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);
  const markResult = (result: "correct" | "wrong") => {
    const card = cards[currentIndex];
    if (!card || marking.current) return;
    marking.current = true;
    setResults((r) => ({ ...r, [card.id]: result }));
    if (sessionId) reviewFlashcard(sessionId, card.topic || topic, result === "correct");
    // Auto-advance
    const last = currentIndex >= cards.length - 1;
    advanceTimer.current = setTimeout(() => {
      marking.current = false;
      if (!last) {
        setCurrentIndex((i) => Math.min(i + 1, cards.length - 1));
        setFlipped(false);
        requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));   // focus stays on the deck
      } else {
        setDone(true);
      }
    }, 300);
  };

  const next = () => {
    if (currentIndex < cards.length - 1) { setCurrentIndex((i) => i + 1); setFlipped(false); }
  };
  const prev = () => {
    if (currentIndex > 0) { setCurrentIndex((i) => i - 1); setFlipped(false); }
  };

  const shuffle = useCallback(() => {
    setCards((c) => [...c].sort(() => Math.random() - 0.5));
    setCurrentIndex(0); setFlipped(false); setResults({});
  }, []);

  const restart = () => { setCurrentIndex(0); setFlipped(false); setResults({}); setDone(false); };

  const restartWrong = () => {
    const wrong = cards.filter((c) => results[c.id] === "wrong");
    if (!wrong.length) { toast.info("No wrong answers to review!"); return; }
    setCards(wrong);
    setCurrentIndex(0); setFlipped(false); setResults({}); setDone(false);
  };

  const correct = Object.values(results).filter((r) => r === "correct").length;
  const wrong = Object.values(results).filter((r) => r === "wrong").length;
  const card = cards[currentIndex];
  const reviewing = cards.length > 0 && !done;

  // Keyboard: Space flips the card, ← / → move between cards. (Not while a field has the keyboard, and Space on a
  // focused button does what that button does.)
  const cardRef = useRef<HTMLDivElement>(null);
  // Swipe: the card follows the pointer horizontally, leans as it goes, and stamps "Got it" / "Missed" as it nears the edge.
  const dragX = useMotionValue(0);
  const dragRotate = useTransform(dragX, [-240, 240], [-14, 14]);
  const yesOpacity = useTransform(dragX, [20, 120], [0, 1]);
  const noOpacity = useTransform(dragX, [-120, -20], [1, 0]);
  const dragged = useRef(false);
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName ?? "";
      if (e.key === " " || e.key === "Spacebar") {
        if (t && t !== cardRef.current && /^(BUTTON|A|SUMMARY)$/.test(tag)) return;   // a focused button keeps its own Space
        e.preventDefault();
        flip();
      } else if (e.key === "Enter" && t === cardRef.current) {
        e.preventDefault();
        flip();
      } else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const difficultyTone = { easy: "success", medium: "warning", hard: "danger" } as const;

  // ── Setup screen ──────────────────────────────────────────────────────────
  if (!cards.length) {
    return (
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <HistoryPanel
            activeMode="flashcards"
            onSelect={(id) => openDeck(id)}
            onNew={() => setShowHistory(false)}
            onClose={() => setShowHistory(false)}
          />
        )}
        <div className="ws-pane flex flex-col flex-1 min-w-0 overflow-hidden">
          <StudyToolbar title="Flashcards" subtitle="Practice cards from your document"
            historyLabel="Flashcard history" historyOpen={showHistory} onToggleHistory={() => setShowHistory((v) => !v)} />
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
            <div className="mx-auto w-full max-w-[72ch]">
              <div className="study-intro">
                <span className="study-intro__icon" aria-hidden="true"><Layers size={26} /></span>
                <div>
                  <h3>Generate flashcards</h3>
                  <p>Pick a topic from your document and flip through the cards.</p>
                </div>
              </div>
              <form className="study-card space-y-5" onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }}>
                <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}
                       placeholder="e.g. Machine learning, The French Revolution" />
                <div>
                  <label htmlFor="card-count" className="block text-sm font-medium text-fg-2 mb-2">
                    Cards
                  </label>
                  <div className="study-count">
                    <Button size="sm" icon aria-label="Fewer cards" onClick={() => setNumCards(Math.max(5, numCards - 1))}><Minus size={14} /></Button>
                    <input id="card-count" type="range" min={5} max={30} value={numCards} onChange={(e) => setNumCards(parseInt(e.target.value))}
                           className="flex-1 cursor-pointer" style={{ ["--fill" as string]: `${((numCards - 5) / 25) * 100}%` }} />
                    <span className="study-count__value" aria-hidden="true">{numCards}</span>
                    <Button size="sm" icon aria-label="More cards" onClick={() => setNumCards(Math.min(30, numCards + 1))}><Plus size={14} /></Button>
                  </div>
                </div>
                <Button type="submit" variant="primary" block loading={loading} disabled={!topic.trim()}>
                  {loading ? "Generating cards…" : <><Sparkles size={16} aria-hidden="true" />Generate {numCards} cards</>}
                </Button>
              </form>
              {reviewDeck.length > 0 && (
                <div className="mt-6">
                  <p className="study-suggest-label">Or review what you got wrong:</p>
                  <button type="button" className="study-prompt" onClick={() => startReview()}>
                    <RotateCcw size={16} aria-hidden="true" />Review {reviewDeck.length} missed {reviewDeck.length === 1 ? "question" : "questions"} from quizzes and the arena
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Done screen ───────────────────────────────────────────────────────────
  if (done) {
    const accuracy = Math.round((correct / cards.length) * 100);
    return (
      <div className="ws-pane flex flex-col h-full overflow-y-auto px-6 py-10">
        <div className="mx-auto w-full max-w-[72ch]">
          <h2 className="text-2xl font-semibold text-fg mb-1">Session complete</h2>
          <p className="text-fg-muted mb-6">You went through all {cards.length} cards.</p>

          <dl className="grid grid-cols-3 gap-3 mb-8">
            <Card pad="sm"><dd className="m-0 text-2xl font-semibold text-fg">{accuracy}%</dd><dt className="text-xs text-fg-muted mt-1">Accuracy</dt></Card>
            <Card pad="sm" tone="success"><dd className="m-0 text-2xl font-semibold text-fg">{correct}</dd><dt className="text-xs text-fg-muted mt-1">Got it</dt></Card>
            <Card pad="sm" tone={wrong > 0 ? "danger" : "default"}><dd className="m-0 text-2xl font-semibold text-fg">{wrong}</dd><dt className="text-xs text-fg-muted mt-1">Missed</dt></Card>
          </dl>

          <div className="flex flex-col gap-3">
            {wrong > 0 && <Button variant="primary" block onClick={restartWrong}>Review {wrong} missed {wrong === 1 ? "card" : "cards"}</Button>}
            <Button variant={wrong > 0 ? "secondary" : "primary"} block onClick={restart}><RotateCcw size={16} aria-hidden="true" />Restart all</Button>
            <Button block onClick={() => { setCards([]); setDone(false); }}>New topic</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Card screen ───────────────────────────────────────────────────────────
  const cardResult = results[card.id];
  const faceBorder = cardResult === "correct" ? "border-ink-green" : cardResult === "wrong" ? "border-ink-red" : "border-line";

  return (
    <div className="flex h-full overflow-hidden">
      <div className="ws-pane flex flex-col flex-1 min-w-0 overflow-hidden">
        <StudyToolbar title="Flashcards" subtitle={topic} onNew={() => setCards([])} newLabel="New topic">
          <Button size="sm" icon onClick={shuffle} aria-label="Shuffle" title="Shuffle"><Shuffle size={16} /></Button>
          <Button size="sm" icon onClick={restart} aria-label="Restart" title="Restart"><RotateCcw size={16} /></Button>
        </StudyToolbar>

        <div role="progressbar" aria-label="Deck progress" aria-valuemin={1} aria-valuemax={cards.length} aria-valuenow={currentIndex + 1}
             aria-valuetext={`Card ${currentIndex + 1} of ${cards.length}`} className="study-progress mx-6 shrink-0">
          <div className="study-progress__fill" style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }} />
        </div>

        <div className="mx-auto flex w-full max-w-[72ch] shrink-0 items-center justify-between px-6 py-2 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5 text-fg-2"><CheckCircle2 size={14} className="text-ink-green" aria-hidden="true" />Got it: {correct}</span>
          <span>Card {currentIndex + 1} of {cards.length}</span>
          <span className="inline-flex items-center gap-1.5 text-fg-2"><XCircle size={14} className="text-ink-red" aria-hidden="true" />Missed: {wrong}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          <div className="mx-auto flex w-full max-w-[72ch] flex-col items-center">
            {/* The card: one focusable control; Space / Enter / click turn it over. Once the answer shows it can be
                flung right ("got it") or left ("missed it") - the buttons below do the same. */}
            <motion.div
              ref={cardRef} role="button" tabIndex={0} onClick={() => { if (!dragged.current) flip(); }}
              aria-pressed={flipped}
              aria-label={flipped ? `Answer: ${card.back}. Press Space to see the question` : `Question: ${card.front}. Press Space to reveal the answer`}
              className="fc-stage cursor-pointer select-none rounded-[var(--radius-xl)] touch-pan-y"
              drag={flipped ? "x" : false} dragSnapToOrigin dragElastic={0.6}
              style={{ x: dragX, rotate: dragRotate }}
              onDragStart={() => { dragged.current = true; }}
              onDragEnd={(_, info) => {
                setTimeout(() => { dragged.current = false; }, 0);
                if (info.offset.x > 120) markResult("correct");
                else if (info.offset.x < -120) markResult("wrong");
              }}
              initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              key={card.id}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
            >
              <motion.div className="fc-card" animate={{ rotateY: flipped ? 180 : 0 }}
                          transition={{ type: "spring", stiffness: 180, damping: 22 }}>
                <div aria-hidden={flipped} className="fc-face" data-result={cardResult}>
                  <div className="fc-meta mb-4">Question · <kbd className="kbd">Space</kbd> to reveal</div>
                  <p className="text-center text-2xl font-semibold leading-[1.5] tracking-tight text-fg">{card.front}</p>
                  <div className="mt-6 flex items-center gap-3 text-xs text-fg-muted">
                    <Badge tone={difficultyTone[card.difficulty] ?? "neutral"}>{card.difficulty}</Badge>
                    {card.topic && <span>{card.topic}</span>}
                  </div>
                  {cardResult && (
                    <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                      {cardResult === "correct"
                        ? <><CheckCircle2 size={16} className="text-ink-green" aria-hidden="true" />Got it</>
                        : <><XCircle size={16} className="text-ink-red" aria-hidden="true" />Missed</>}
                    </div>
                  )}
                </div>
                <div aria-hidden={!flipped} className="fc-face fc-face--back">
                  <motion.span className="fc-stamp fc-stamp--yes" style={{ opacity: yesOpacity }} aria-hidden="true">Know it</motion.span>
                  <motion.span className="fc-stamp fc-stamp--no" style={{ opacity: noOpacity }} aria-hidden="true">Again</motion.span>
                  <div className="fc-meta mb-4">Answer · drag → got it, ← missed</div>
                  <p className="text-center text-lg leading-[1.65] text-fg whitespace-pre-line">{card.back}</p>
                </div>
              </motion.div>
            </motion.div>

            {/* Mark the card: only once the answer is showing (invisible = out of the Tab order too) */}
            <div className={`mt-6 flex gap-3 ${flipped ? "" : "invisible"}`}>
              <Button variant="danger" onClick={() => markResult("wrong")}><XCircle size={18} aria-hidden="true" />Missed it</Button>
              <Button variant="primary" onClick={() => markResult("correct")}><CheckCircle2 size={18} aria-hidden="true" />Got it</Button>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <Button size="sm" icon onClick={prev} disabled={currentIndex === 0} aria-label="Previous card"><ChevronLeft size={20} /></Button>
              <span className="text-xs text-fg-muted">Space flips · ← → change card</span>
              <Button size="sm" icon onClick={next} disabled={currentIndex === cards.length - 1} aria-label="Next card"><ChevronRight size={20} /></Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
