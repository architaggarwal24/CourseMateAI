"use client";

import { useState, useCallback, useEffect } from "react";
import { Layers, ChevronLeft, ChevronRight, RotateCcw, Shuffle, CheckCircle2, XCircle, Sparkles, History, Plus } from "lucide-react";
import FileUploader from "./FileUploader";
import HistoryPanel from "./HistoryPanel";
import { generateFlashcards } from "@/lib/api";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { useHUDStore } from "@/hooks/useHUD";
import { toast } from "sonner";

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

export default function FlashcardView({ restoreSessionId }: { restoreSessionId?: string }) {
  const [sessionId] = useState(() => restoreSessionId || crypto.randomUUID());
  const [showHistory, setShowHistory] = useState(false);
  const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));
  const [topic, setTopic] = useState("");
  const [numCards, setNumCards] = useState(10);
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<number, CardResult>>({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [pendingRewards, setPendingRewards] = useState<{xp_gained:number;coins_gained:number}|null>(null);

  // Restore session from history on mount
  useEffect(() => {
    if (!restoreSessionId) return;
    const saved = loadSessionData<SavedFlashcardSession>(restoreSessionId);
    if (!saved?.cards?.length) return;
    setCards(saved.cards);
    setTopic(saved.topic || "");
    setCurrentIndex(saved.currentIndex ?? 0);
    setResults(saved.results ?? {});
    setDone(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save progress on every card flip/result
  useEffect(() => {
    if (!cards.length || !topic) return;
    saveSessionData(
      sessionId,
      "flashcards",
      `${topic} · ${currentIndex + 1}/${cards.length}`,
      { cards, results, currentIndex, topic } as SavedFlashcardSession,
      topic
    );
  }, [results, currentIndex, cards, topic, sessionId]);

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
    } catch (e: any) {
      toast.error(e.message || "Failed to generate flashcards");
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
  }, [done, pendingRewards, refresh]);

  const markResult = (result: "correct" | "wrong") => {
    const card = cards[currentIndex];
    setResults((r) => ({ ...r, [card.id]: result }));
    // Auto-advance
    setTimeout(() => {
      if (currentIndex < cards.length - 1) {
        setCurrentIndex((i) => i + 1);
        setFlipped(false);
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
  const diffColor = { easy: "text-green-400", medium: "text-yellow-400", hard: "text-red-400" };

  const card = cards[currentIndex];

  // ── Setup screen ──────────────────────────────────────────────────────────
  if (!cards.length) {
    return (
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <HistoryPanel
            activeMode="flashcards"
            onSelect={(id) => {
              const saved = loadSessionData<SavedFlashcardSession>(id);
              if (!saved?.cards?.length) return;
              setShowHistory(false);
            }}
            onNew={() => setShowHistory(false)}
            onClose={() => setShowHistory(false)}
          />
        )}
        <div className="flex flex-col flex-1 overflow-y-auto panel-scroll bg-bg-primary">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-gold/10 border border-accent-gold/20">
              <Layers size={18} className="text-accent-gold" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Flashcards</h2>
              <p className="text-xs text-text-muted">Spaced repetition from your PDF</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-gold text-accent-gold bg-accent-gold/10" : "border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold"}`}
              title="Flashcard history"
            ><History size={16} /></button>
            <FileUploader sessionId={sessionId} />
          </div>
        </div>

        {/* Setup form */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-xl mx-auto w-full">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-gold/20 to-accent-purple/20 flex items-center justify-center mb-6">
            <Layers size={40} className="text-accent-gold" />
          </div>
          <h3 className="text-2xl font-bold text-text-primary mb-2">Generate Flashcards</h3>
          <p className="text-text-muted text-sm mb-8 text-center">Upload a PDF and generate cards to study any topic</p>

          <div className="w-full space-y-4">
            <div>
              <label className="text-xs text-text-muted uppercase tracking-widest mb-2 block">Topic</label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                placeholder="e.g. Machine Learning, French Revolution..."
                className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-gold focus:ring-2 focus:ring-accent-gold/20 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-2">Cards: <span className="text-accent-gold font-bold">{numCards}</span></label>
              <div className="flex items-center gap-2 mt-1">
                <button onClick={() => setNumCards(Math.max(5, numCards - 1))} className="w-7 h-7 rounded bg-bg-card border border-border flex items-center justify-center text-text-secondary hover:text-accent-gold hover:border-accent-gold/50 transition-all text-sm font-bold">−</button>
                <input type="range" min={5} max={30} value={numCards} onChange={(e) => setNumCards(parseInt(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ background: `linear-gradient(to right, #D4AF37 0%, #D4AF37 ${((numCards - 5) / 25) * 100}%, #2a2a2a ${((numCards - 5) / 25) * 100}%, #2a2a2a 100%)` }} />
                <button onClick={() => setNumCards(Math.min(30, numCards + 1))} className="w-7 h-7 rounded bg-bg-card border border-border flex items-center justify-center text-text-secondary hover:text-accent-gold hover:border-accent-gold/50 transition-all text-sm font-bold">+</button>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !topic.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-gold to-accent-purple text-white font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" />
                  <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{ animationDelay: "0.2s" }} />
                  <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{ animationDelay: "0.4s" }} />
                  Generating...
                </>
              ) : (
                <><Sparkles size={16} /> Generate {numCards} Cards</>
              )}
            </button>
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
      <div className="flex flex-col h-full bg-bg-primary items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">{accuracy >= 80 ? "🏆" : accuracy >= 60 ? "📚" : "💪"}</div>
          <h2 className="text-2xl font-bold text-text-primary mb-2">Session Complete!</h2>
          <p className="text-text-muted mb-8">You went through all {cards.length} cards</p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            <div className="bg-bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-accent-gold">{accuracy}%</div>
              <div className="text-xs text-text-muted mt-1">Accuracy</div>
            </div>
            <div className="bg-bg-card border border-green-500/20 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{correct}</div>
              <div className="text-xs text-text-muted mt-1">Got it</div>
            </div>
            <div className="bg-bg-card border border-red-500/20 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400">{wrong}</div>
              <div className="text-xs text-text-muted mt-1">Review</div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {wrong > 0 && (
              <button onClick={restartWrong} className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500/80 to-red-700/80 text-white font-semibold text-sm hover:opacity-90 transition-all">
                🔁 Review {wrong} Missed Cards
              </button>
            )}
            <button onClick={restart} className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-gold to-accent-purple text-white font-semibold text-sm hover:opacity-90 transition-all">
              <RotateCcw size={16} className="inline mr-2" />Restart All
            </button>
            <button onClick={() => { setCards([]); setDone(false); }} className="w-full py-3 rounded-xl border border-border text-text-muted hover:border-accent-gold/40 hover:text-text-primary text-sm transition-all">
              New Topic
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Card screen ───────────────────────────────────────────────────────────
  const cardResult = results[card.id];

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent-gold/10 border border-accent-gold/20">
            <Layers size={18} className="text-accent-gold" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Flashcards</h2>
            <p className="text-xs text-text-muted">{topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={shuffle} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all" title="Shuffle">
            <Shuffle size={16} />
          </button>
          <button onClick={restart} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all" title="Restart">
            <RotateCcw size={16} />
          </button>
          <button onClick={() => setCards([])} className="px-3 py-2 rounded-lg border border-border text-text-muted hover:border-accent-purple/50 hover:text-accent-purple transition-all text-xs">
            New Topic
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-bg-card flex-shrink-0">
        <div
          className="h-full bg-gradient-to-r from-accent-gold to-accent-purple transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / cards.length) * 100}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between px-6 py-2 text-xs text-text-muted flex-shrink-0">
        <span className="text-green-400 font-medium">✓ {correct}</span>
        <span>{currentIndex + 1} / {cards.length}</span>
        <span className="text-red-400 font-medium">✗ {wrong}</span>
      </div>

      {/* Card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
        {/* Flip card */}
        <div
          onClick={flip}
          className="w-full max-w-2xl cursor-pointer select-none"
          style={{ perspective: "1200px" }}
        >
          <div
            style={{
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              transition: "transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
              position: "relative",
              minHeight: "280px",
            }}
          >
            {/* Front */}
            <div
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
              className={`absolute inset-0 flex flex-col items-center justify-center p-8 rounded-2xl border-2 ${
                cardResult === "correct" ? "border-green-500/50 bg-green-500/5" :
                cardResult === "wrong"   ? "border-red-500/50 bg-red-500/5" :
                "border-accent-gold/30 bg-bg-card"
              }`}
            >
              <div className="text-xs text-text-muted uppercase tracking-widest mb-4">Tap to reveal</div>
              <p className="text-xl font-semibold text-text-primary text-center leading-relaxed">{card.front}</p>
              <div className="mt-6 flex items-center gap-3">
                <span className={`text-xs font-medium ${diffColor[card.difficulty]}`}>
                  {card.difficulty.toUpperCase()}
                </span>
                <span className="text-xs text-text-muted">·</span>
                <span className="text-xs text-text-muted">{card.topic}</span>
              </div>
            </div>

            {/* Back */}
            <div
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              className="absolute inset-0 flex flex-col items-center justify-center p-8 rounded-2xl border-2 border-accent-purple/30 bg-gradient-to-br from-accent-purple/5 to-accent-blue/5"
            >
              <div className="text-xs text-text-muted uppercase tracking-widest mb-4">Answer</div>
              <p className="text-lg text-text-primary text-center leading-relaxed">{card.back}</p>
            </div>
          </div>
        </div>

        {/* Know it / Missed it buttons — only shown when card is flipped */}
        <div className={`flex gap-4 mt-6 transition-all duration-300 ${flipped ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}>
          <button
            onClick={() => markResult("wrong")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border-2 border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/70 font-semibold text-sm transition-all"
          >
            <XCircle size={18} /> Missed it
          </button>
          <button
            onClick={() => markResult("correct")}
            className="flex items-center gap-2 px-6 py-3 rounded-xl border-2 border-green-500/40 bg-green-500/10 text-green-400 hover:bg-green-500/20 hover:border-green-500/70 font-semibold text-sm transition-all"
          >
            <CheckCircle2 size={18} /> Got it!
          </button>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-4 mt-4">
          <button onClick={prev} disabled={currentIndex === 0} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <ChevronLeft size={20} />
          </button>
          <span className="text-xs text-text-muted">or use arrow keys</span>
          <button onClick={next} disabled={currentIndex === cards.length - 1} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold disabled:opacity-30 disabled:cursor-not-allowed transition-all">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}