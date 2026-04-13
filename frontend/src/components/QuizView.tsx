"use client";
import { useState, useEffect, useCallback } from "react";
import { Loader2, RotateCcw, CheckCircle2, XCircle, HelpCircle, Brain, Zap, Target, TrendingUp, History, Plus } from "lucide-react";
import FileUploader from "./FileUploader";
import HistoryPanel from "./HistoryPanel";
import { generateQuiz, awardRewards } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { QuizData } from "@/types";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { toast } from "sonner";

// FIX BUG 44: Quick-suggestion type strings must map through TYPE_MAP to reach
// the backend. "multiple_choice" and "true_false" were not in the TYPE_MAP, so
// they fell through to the default "MCQ" — making the True/False button useless.
// The suggestion types are now set to the backend-recognised values directly.
const QUIZ_SUGGESTIONS = [
  { label: "Quick Quiz",  icon: <Zap size={16} />,       topic: "key concepts",      type: "MCQ",       num: 5  },
  { label: "Full Test",   icon: <Target size={16} />,     topic: "all topics",        type: "MCQ",       num: 10 },
  { label: "True/False",  icon: <Brain size={16} />,      topic: "main concepts",     type: "True/False", num: 8  },
  { label: "Deep Dive",   icon: <TrendingUp size={16} />, topic: "advanced concepts", type: "Mixed",     num: 15 },
];

const TYPE_MAP: Record<string, string> = {
  "MCQ": "MCQ", "True/False": "True/False", "Mixed": "Mixed",
};

interface SavedQuiz {
  quiz: QuizData;
  topic: string;
  answers: Record<number, string>;
  currentQ: number;
  score?: number;
}

export default function QuizView({ restoreSessionId }: { restoreSessionId?: string }) {
  const [sessionId, setSessionId] = useState(() => restoreSessionId || crypto.randomUUID());
  const userId = useHUDStore((s) => s.userId);
  const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));
  const [topic, setTopic] = useState("");
  const [qType, setQType] = useState("MCQ");
  const [numQ, setNumQ] = useState(5);
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showExplanation, setShowExplanation] = useState(false);
  const [rewarded, setRewarded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Restore from history navigation
  useEffect(() => {
    if (restoreSessionId) loadHistorySession(restoreSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isComplete = quiz !== null && currentQ >= quiz.questions.length;

  const normalizeAnswer = (answer: string): string =>
    answer.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, "");

  const computeScore = useCallback(() => {
    if (!quiz) return { score: 0, total: 0 };
    let score = 0;
    for (const q of quiz.questions) {
      if (normalizeAnswer(answers[q.id] || "") === normalizeAnswer(q.correct_answer || "")) score++;
    }
    return { score, total: quiz.questions.length };
  }, [quiz, answers]);

  // Auto-save progress whenever answers change
  useEffect(() => {
    if (!quiz || !topic) return;
    const { score } = computeScore();
    saveSessionData(sessionId, "quiz", `${topic} · ${Object.keys(answers).length}/${quiz.questions.length} answered`, {
      quiz, topic, answers, currentQ, score,
    } as SavedQuiz, topic);
  }, [answers, currentQ, quiz, topic, sessionId, computeScore]);

  // Award on completion
  useEffect(() => {
    if (!isComplete || rewarded || !quiz) return;
    const doAward = async () => {
      setRewarded(true);
      const { score, total } = computeScore();
      const acc = score / Math.max(total, 1);
      // FIX BUG 45: Wrap in try/catch. Without it, a network error leaves
      // loading state stuck and the reward toast never appears.
      try {
        const res = await awardRewards(userId, "quiz_complete", acc, 1.2, 1);
        if (res?.ok) {
          toast.success(`+${res.xp_gained} XP | +${res.coins_gained} Coins`, { icon: "🎉" });
          if (res.new_achievements?.length) {
            for (const ach of res.new_achievements) {
              toast.success(`🏆 Achievement Unlocked: ${ach.name}`, { description: ach.description, duration: 5000 });
            }
          }
          refreshIfStale(5_000);
        }
      } catch (e) {
        console.error("Award rewards failed:", e);
      }
      // Save completed state
      saveSessionData(sessionId, "quiz", `${topic} · ${score}/${total} (${Math.round(acc * 100)}%)`, {
        quiz, topic, answers, currentQ, score,
      } as SavedQuiz, topic);
    };
    doAward();
  }, [isComplete, rewarded, quiz, userId, computeScore, refresh, topic, sessionId, answers, currentQ]);

  const loadHistorySession = (id: string) => {
    const data = loadSessionData<SavedQuiz>(id);
    if (!data?.quiz) return;
    setSessionId(id);
    setQuiz(data.quiz);
    setTopic(data.topic || "");
    setAnswers(data.answers || {});
    setCurrentQ(data.currentQ ?? 0);
    setShowExplanation(false);
    setRewarded(!!data.score);
    setShowHistory(false);
  };

  const handleGenerate = async (customTopic?: string, customType?: string, customNum?: number) => {
    const finalTopic = customTopic || topic;
    const finalType = TYPE_MAP[customType || qType] || "MCQ";
    const finalNum = customNum || numQ;
    if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
    // FIX BUG-F01: Wrap in try/catch so setLoading(false) always runs.
    // Without this, any thrown error (network, 500, quota) leaves the spinner
    // spinning forever and the button permanently disabled.
    setLoading(true);
    try {
      // Use existing sessionId so the PDF uploaded to this session is found on the backend
      const data = await generateQuiz(finalTopic, finalNum, finalType, sessionId);
      setLoading(false);
      if (data?.content) {
        setQuiz(data.content);
        setTopic(finalTopic);
        setCurrentQ(0);
        setAnswers({});
        setShowExplanation(false);
        setRewarded(false);
      } else {
        toast.error("Quiz generation failed. Make sure a PDF is uploaded.");
      }
    } catch (e: any) {
      setLoading(false);
      toast.error(e?.message || "Quiz generation failed.");
    }
  };

  const handleAnswer = (option: string) => {
    if (!quiz) return;
    setAnswers((prev) => ({ ...prev, [quiz.questions[currentQ].id]: option }));
    setShowExplanation(true);
  };

  const handleNext = () => { setShowExplanation(false); setCurrentQ((c) => c + 1); };

  const handleRestart = () => {
    setQuiz(null); setTopic(""); setCurrentQ(0);
    setAnswers({}); setShowExplanation(false); setRewarded(false);
  };



  // ── EMPTY STATE ──────────────────────────────────────────────────────────
  if (!quiz) {
    return (
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <HistoryPanel activeMode="quiz" onSelect={(id) => loadHistorySession(id)}
            onNew={() => { handleRestart(); setShowHistory(false); }} onClose={() => setShowHistory(false)} />
        )}
        <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-blue/10 border border-accent-blue/20">
                <HelpCircle size={18} className="text-accent-blue" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Knowledge Check</h2>
                <p className="text-xs text-text-muted">Test your understanding with AI-generated quizzes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-blue text-accent-blue bg-accent-blue/10" : "border-border text-text-muted hover:border-accent-blue/50 hover:text-accent-blue"}`}
                title="Quiz history"
              ><History size={16} /></button>
              <FileUploader sessionId={sessionId} />
            </div>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-accent-blue/10 border border-accent-blue/20 mb-4">
                  <HelpCircle size={40} className="text-accent-blue" />
                </div>
                <h3 className="text-2xl font-bold text-text-primary mb-2">Create a Quiz</h3>
                <p className="text-text-muted text-sm max-w-md mx-auto">Upload a PDF and generate custom quizzes to test your knowledge.</p>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">What topic would you like to be quizzed on?</label>
                  <input
                    className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20 transition-all"
                    placeholder="e.g., Machine Learning Basics, Chapter 5, Neural Networks..."
                    value={topic} onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-2">Question Type</label>
                    <select className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue focus:ring-2 focus:ring-accent-blue/20 transition-all"
                      value={qType} onChange={(e) => setQType(e.target.value)}>
                      <option value="MCQ">Multiple Choice</option>
                      <option value="True/False">True/False</option>
                      <option value="Mixed">Mixed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-muted mb-2">Questions: <span className="text-accent-gold font-bold">{numQ}</span></label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setNumQ(Math.max(3, numQ - 1))} className="w-7 h-7 rounded bg-bg-card border border-border flex items-center justify-center text-text-secondary hover:text-accent-gold hover:border-accent-gold/50 transition-all text-sm font-bold">−</button>
                      <input type="range" min={3} max={20} value={numQ} onChange={(e) => setNumQ(parseInt(e.target.value))}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
                        style={{ background: `linear-gradient(to right, #D4AF37 0%, #D4AF37 ${((numQ - 3) / 17) * 100}%, #2a2a2a ${((numQ - 3) / 17) * 100}%, #2a2a2a 100%)` }} />
                      <button onClick={() => setNumQ(Math.min(20, numQ + 1))} className="w-7 h-7 rounded bg-bg-card border border-border flex items-center justify-center text-text-secondary hover:text-accent-gold hover:border-accent-gold/50 transition-all text-sm font-bold">+</button>
                    </div>
                  </div>
                </div>
                <button onClick={() => handleGenerate()} disabled={loading || !topic.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-blue to-accent-purple text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent-blue/20 flex items-center justify-center gap-2">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" />
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.2s'}} />
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.4s'}} />
                      Generating Quiz...
                    </span>
                  ) : <><Zap size={18} />Generate Quiz</>}
                </button>
              </div>

              <div>
                <p className="text-xs text-text-muted text-center mb-3">Or try these quick quizzes:</p>
                <div className="grid grid-cols-2 gap-3">
                  {QUIZ_SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => handleGenerate(s.topic, s.type, s.num)} disabled={loading}
                      className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bg-card border border-border-subtle hover:border-accent-blue/50 text-text-secondary hover:text-text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <span className="text-accent-blue">{s.icon}</span>
                      <span className="text-sm font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── COMPLETION SCREEN ────────────────────────────────────────────────────
  if (isComplete) {
    const { score, total } = computeScore();
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const grade = pct >= 90 ? "🌟 Excellent!" : pct >= 70 ? "✨ Great Job!" : pct >= 50 ? "👍 Good Effort!" : "📚 Keep Practicing!";
    return (
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <HistoryPanel activeMode="quiz" onSelect={(id) => loadHistorySession(id)}
            onNew={() => { handleRestart(); setShowHistory(false); }} onClose={() => setShowHistory(false)} />
        )}
        <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent-blue/10 border border-accent-blue/20">
                <HelpCircle size={18} className="text-accent-blue" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Knowledge Check</h2>
                <p className="text-xs text-text-muted">{topic} · {score}/{total} ({pct}%)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-blue text-accent-blue bg-accent-blue/10" : "border-border text-text-muted hover:border-accent-blue/50 hover:text-accent-blue"}`}
                title="Quiz history"
              ><History size={16} /></button>
              <button onClick={handleRestart} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all" title="New quiz">
                <Plus size={16} />
              </button>
              <FileUploader sessionId={sessionId} />
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="w-full max-w-md text-center space-y-6">
              <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-accent-blue/10 border border-accent-blue/20">
                {pct >= 70 ? <CheckCircle2 size={48} className="text-accent-green" /> : <Target size={48} className="text-accent-blue" />}
              </div>
              <div>
                <h3 className="text-4xl font-bold text-text-primary mb-2">{score} / {total}</h3>
                <p className="text-text-muted text-sm">{pct}% Correct</p>
                <p className="text-lg font-semibold text-accent-gold mt-2">{grade}</p>
              </div>
              <div className="space-y-3">
                <button onClick={() => { setCurrentQ(0); setShowExplanation(false); }}
                  className="w-full py-3 rounded-xl bg-accent-blue/10 border border-accent-blue/30 text-accent-blue font-medium text-sm hover:bg-accent-blue/20 transition-all">
                  📖 Review Answers
                </button>
                <button onClick={handleRestart}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-blue to-accent-purple text-white font-semibold text-sm hover:opacity-90 transition-all">
                  <RotateCcw size={16} className="inline mr-2" />New Quiz
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── QUIZ IN PROGRESS ─────────────────────────────────────────────────────
  const q = quiz.questions[currentQ];
  const userAnswer = answers[q.id];
  const isCorrect = userAnswer ? normalizeAnswer(userAnswer) === normalizeAnswer(q.correct_answer) : false;

  return (
    <div className="flex h-full overflow-hidden">
      {showHistory && (
        <HistoryPanel activeMode="quiz" onSelect={(id) => loadHistorySession(id)}
          onNew={() => { handleRestart(); setShowHistory(false); }} onClose={() => setShowHistory(false)} />
      )}
      <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
        <div className="px-6 py-4 border-b border-border-subtle bg-bg-secondary/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-text-muted">Question {currentQ + 1} of {quiz.questions.length}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">{Object.keys(answers).length} answered</span>
              <button onClick={() => setShowHistory((v) => !v)}
                className={`p-1.5 rounded-lg border transition-all ${showHistory ? "border-accent-blue text-accent-blue" : "border-border text-text-muted hover:text-accent-blue"}`}>
                <History size={14} />
              </button>
            </div>
          </div>
          <div className="w-full bg-bg-primary rounded-full h-2">
            <div className="bg-gradient-to-r from-accent-blue to-accent-purple h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentQ + 1) / quiz.questions.length) * 100}%` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="p-6 bg-bg-card border border-border rounded-xl">
              <p className="text-lg text-text-primary leading-relaxed">{q.question}</p>
            </div>
            <div className="space-y-3">
              {(q.options || []).map((opt: string, i: number) => {
                const isSelected = userAnswer === opt;
                const isCorrectOption = normalizeAnswer(opt) === normalizeAnswer(q.correct_answer);
                return (
                  <button key={i} onClick={() => !showExplanation && handleAnswer(opt)} disabled={showExplanation}
                    className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all ${
                      showExplanation && isCorrectOption ? "border-accent-green bg-accent-green/10"
                        : showExplanation && isSelected && !isCorrect ? "border-accent-red bg-accent-red/10"
                        : isSelected ? "border-accent-blue bg-accent-blue/10"
                        : "border-border bg-bg-card hover:border-accent-blue/50"}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-primary">{opt}</span>
                      {showExplanation && isCorrectOption && <CheckCircle2 size={20} className="text-accent-green" />}
                      {showExplanation && isSelected && !isCorrect && <XCircle size={20} className="text-accent-red" />}
                    </div>
                  </button>
                );
              })}
            </div>
            {showExplanation && q.explanation && (
              <div className={`p-4 rounded-xl border-2 ${isCorrect ? "bg-accent-green/5 border-accent-green/30" : "bg-accent-blue/5 border-accent-blue/30"}`}>
                <p className="text-sm font-semibold text-text-primary mb-2">{isCorrect ? "✅ Correct!" : "💡 Explanation:"}</p>
                <p className="text-sm text-text-secondary">{q.explanation}</p>
              </div>
            )}
            {showExplanation && (
              <button onClick={handleNext}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-blue to-accent-purple text-white font-semibold text-sm hover:opacity-90 transition-all">
                {currentQ < quiz.questions.length - 1 ? "Next Question →" : "Finish Quiz"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}