"use client";
import { announceAchievements } from "@/lib/fx/celebrate";
import { useState, useEffect, useCallback } from "react";
import { HelpCircle, Brain, Zap, Target, TrendingUp, History, Plus, Minus, ListChecks } from "@/components/icons";
import HistoryPanel from "./HistoryPanel";
import QuizQuestionView from "./quiz/QuizQuestionView";
import QuizReview from "./quiz/QuizReview";
import Writing from "./study/Writing";
import { normalizeAnswer } from "./quiz/answers";
import { Button, Input, Select } from "@/components/ui";
import { generateQuiz, answerQuizQuestion, finishQuiz, retryMissedQuiz } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { QuizData, QuizFeedback, QuizQuestion } from "@/types";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { forgetSession, rememberSession, useDraft } from "@/lib/study/memory";
import { NothingMade, clearJob, jobErrorToast, startJob, useJob } from "@/lib/study/background";
import { toast } from "@/components/ui/Toast";

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
  quizId?: string;                          // absent on quizzes saved before answers moved to the server
  feedback?: Record<number, QuizFeedback>;
}

/** `documentId` is the workspace's active document (what the quiz is about); `historyId` is just this saved quiz. */
export default function QuizView({ documentId, restoreSessionId, initialTopic }: {
  documentId?: string; restoreSessionId?: string;
  /** A topic to start from (the concept map's "Quick quiz" / "Flashcards" on one concept). */
  initialTopic?: string;
}) {
  const [historyId, setHistoryId] = useState(() => restoreSessionId || crypto.randomUUID());
  const sessionId = documentId ?? historyId;
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [topic, setTopic] = useDraft("quiz", documentId, initialTopic);
  const [qType, setQType] = useState("MCQ");
  const [numQ, setNumQ] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  // after finishing: what was missed went to Review, and the weak spots (round 7)
  const [summary, setSummary] = useState<{ missed: number[]; added_to_review: number; weak_concepts: string[] } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [quizId, setQuizId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<number, QuizFeedback>>({});
  const [checking, setChecking] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [rewarded, setRewarded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Restore from history navigation
  useEffect(() => {
    if (restoreSessionId) loadHistorySession(restoreSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isComplete = quiz !== null && currentQ >= quiz.questions.length;

  // The server grades every answer. Quizzes saved in the browser before that change still carry their
  // correct answers, so those (and only those) are graded locally for review.
  const feedbackFor = useCallback((q: QuizQuestion): QuizFeedback | undefined => {
    if (feedback[q.id]) return feedback[q.id];
    const picked = answers[q.id];
    if (!picked || !q.correct_answer) return undefined;
    return {
      correct: normalizeAnswer(picked) === normalizeAnswer(q.correct_answer),
      correct_answer: q.correct_answer,
      explanation: q.explanation,
    };
  }, [feedback, answers]);

  const computeScore = useCallback(() => {
    if (!quiz) return { score: 0, total: 0 };
    let score = 0;
    for (const q of quiz.questions) {
      if (feedbackFor(q)?.correct) score++;
    }
    return { score, total: quiz.questions.length };
  }, [quiz, feedbackFor]);

  // Auto-save progress whenever answers change
  useEffect(() => {
    if (!quiz || !topic) return;
    const { score } = computeScore();
    saveSessionData(historyId, "quiz", `${topic} · ${Object.keys(answers).length}/${quiz.questions.length} answered`, {
      quiz, topic, answers, currentQ, score, quizId: quizId ?? undefined, feedback,
    } as SavedQuiz, topic);
    rememberSession("quiz", documentId, historyId);       // reopens here, on this question, next time
  }, [answers, currentQ, quiz, topic, historyId, computeScore, quizId, feedback, documentId]);

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
        // The server grades the finished quiz itself and pays out once per quiz; a quiz saved before that
        // change has no id on the server, so it earns nothing.
        const done = quizId ? await finishQuiz(quizId) : null;
        if (done && Array.isArray(done.missed)) setSummary({ missed: done.missed, added_to_review: done.added_to_review ?? 0, weak_concepts: done.weak_concepts ?? [] });
        const res = done?.rewards;
        if (res?.ok) {
          toast.success(`+${res.xp_gained} XP | +${res.coins_gained} Coins`, { icon: "🎉" });
          announceAchievements(res.new_achievements);
          refreshIfStale(5_000);
        }
      } catch (e) {
        console.error("Award rewards failed:", e);
      }
      // Save completed state
      saveSessionData(historyId, "quiz", `${topic} · ${score}/${total} (${Math.round(acc * 100)}%)`, {
        quiz, topic, answers, currentQ, score, quizId: quizId ?? undefined, feedback,
      } as SavedQuiz, topic);
    };
    doAward();
  }, [isComplete, rewarded, quiz, computeScore, refreshIfStale, topic, historyId, answers, currentQ, quizId, feedback]);

  const loadHistorySession = (id: string) => {
    const data = loadSessionData<SavedQuiz>(id);
    if (!data?.quiz?.questions?.length) return;
    setHistoryId(id);
    rememberSession("quiz", documentId, id);
    setQuiz(data.quiz);
    setTopic(data.topic || "");
    setAnswers(data.answers || {});
    setQuizId(data.quizId ?? null);
    setFeedback(data.feedback || {});
    setCurrentQ(data.currentQ ?? 0);
    setShowExplanation(false);
    setRewarded(!!data.score);
    setShowHistory(false);
  };

  // Writing a quiz carries on when you leave this screen (lib/study/background.ts): the job saves it as a new quiz in
  // History and remembers it as this tool's open quiz; this view opens it when it finishes (now, or when you return).
  const job = useJob("quiz", documentId);
  const loading = job?.status === "running";
  const handleGenerate = async (customTopic?: string, customType?: string, customNum?: number) => {
    const finalTopic = customTopic || topic;
    const finalType = TYPE_MAP[customType || qType] || "MCQ";
    const finalNum = customNum || numQ;
    if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
    const scope = documentId, level = difficulty;
    startJob("quiz", scope, finalTopic, async () => {
      // Use existing sessionId so the PDF uploaded to this session is found on the backend
      const data = await generateQuiz(finalTopic, finalNum, finalType, sessionId, level);
      if (!data?.content?.questions?.length) throw new NothingMade("Quiz generation failed. Make sure a PDF is uploaded.");
      const id = crypto.randomUUID();
      saveSessionData(id, "quiz", `${finalTopic} · 0/${data.content.questions.length} answered`, {
        quiz: data.content, topic: finalTopic, answers: {}, currentQ: 0, score: 0, quizId: data.quiz_id ?? undefined, feedback: {},
      } as SavedQuiz, finalTopic);
      rememberSession("quiz", scope, id);
      return id;
    }, {
      onError: (e) => jobErrorToast(e, toast, () => handleGenerate(finalTopic, customType, customNum)),
      ready: (label) => toast.success(`Your quiz on “${label}” is ready. Open Quiz to start it.`),
    });
  };
  useEffect(() => {
    if (job?.status === "done" && job.sessionId) { setSummary(null); loadHistorySession(job.sessionId); clearJob("quiz", documentId); }
    else if (job?.status === "failed") clearJob("quiz", documentId);
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnswer = useCallback(async (option: string) => {
    if (!quiz || checking) return;
    const question = quiz.questions[currentQ];
    // Quizzes saved before answers moved to the server have no id there: they are graded locally.
    if (!quizId) {
      setAnswers((prev) => ({ ...prev, [question.id]: option }));
      setShowExplanation(true);
      return;
    }
    setChecking(true);
    try {
      const res = await answerQuizQuestion(quizId, question.id, option);
      setAnswers((prev) => ({ ...prev, [question.id]: res.answer }));
      setFeedback((prev) => ({ ...prev, [question.id]: {
        correct: !!res.correct, correct_answer: res.correct_answer, explanation: res.explanation, source: res.source ?? null, concept: res.concept ?? null } }));
      setShowExplanation(true);
    } catch (e) {
      toast.apiError(e, { onRetry: () => handleAnswer(option) });
    } finally {
      setChecking(false);
    }
  }, [quiz, checking, currentQ, quizId]);

  const handleNext = () => { setShowExplanation(false); setCurrentQ((c) => c + 1); };

  const handleRestart = () => {
    forgetSession("quiz", documentId);
    setHistoryId(crypto.randomUUID());                    // the next quiz is a new entry in History, not this one overwritten
    setQuiz(null); setTopic(""); setCurrentQ(0);
    setQuizId(null); setFeedback({}); setSummary(null);
    setAnswers({}); setShowExplanation(false); setRewarded(false);
  };

  /** A new quiz of just the questions missed (no AI call): the same questions, options in a new order. */
  const handleRetryMissed = async () => {
    if (!quizId) return;
    setRetrying(true);
    try {
      const data = await retryMissedQuiz(quizId);
      setHistoryId(crypto.randomUUID());
      setQuiz(data.content as QuizData);
      setQuizId(data.quiz_id);
      setTopic(data.topic);
      setFeedback({}); setAnswers({}); setCurrentQ(0); setShowExplanation(false); setRewarded(false); setSummary(null);
    } catch (e) {
      toast.apiError(e);
    } finally { setRetrying(false); }
  };



  const toolbar = (title: string, subtitle: string, newQuiz?: boolean) => (
    <div className="ws-toolbar">
      <div className="min-w-0">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" icon pressed={showHistory} onClick={() => setShowHistory((v) => !v)} aria-label="Quiz history" title="Quiz history">
          <History size={16} />
        </Button>
        {newQuiz && (
          <Button size="sm" icon onClick={handleRestart} aria-label="New quiz" title="New quiz"><Plus size={16} /></Button>
        )}
      </div>
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <div className="flex h-full overflow-hidden">
      {showHistory && (
        <HistoryPanel activeMode="quiz" onSelect={(id) => loadHistorySession(id)}
          onNew={() => { handleRestart(); setShowHistory(false); }} onClose={() => setShowHistory(false)} />
      )}
      <div className="ws-pane flex flex-col flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  );

  // ── SETUP ────────────────────────────────────────────────────────────────
  if (!quiz) {
    return shell(
      <>
        {toolbar("Quiz", "Test your understanding of your document")}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
          <div className="mx-auto w-full max-w-[72ch]">
            <div className="study-intro">
              <span className="study-intro__icon" aria-hidden="true"><ListChecks size={26} /></span>
              <div>
                <h3>Create a quiz</h3>
                <p>Pick a topic from your document and answer one question at a time.</p>
              </div>
            </div>

            {loading && job && (
              <Writing what="a quiz" topic={job.label} startedAt={job.startedAt}
                steps={["Finding the passages about it in your PDFs…", "Writing the questions…", "Checking every answer against your PDFs…", "Shuffling the options…", "Almost done…"]} />
            )}
            <form hidden={loading} className="study-card space-y-5 mb-8" onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }}>
              <Input label="What topic would you like to be quizzed on?" value={topic} onChange={(e) => setTopic(e.target.value)}
                     placeholder="e.g. Machine learning basics, Chapter 5, Neural networks" />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Select label="Question type" value={qType} onChange={(e) => setQType(e.target.value)}>
                  <option value="MCQ">Multiple choice</option>
                  <option value="True/False">True/False</option>
                  <option value="Mixed">Mixed</option>
                </Select>
                <Select label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
                  hint="Hard asks you to apply and compare, not just remember.">
                  <option value="mixed">Mixed (easy to hard)</option>
                  <option value="easy">Easy: key facts</option>
                  <option value="medium">Medium: understand and apply</option>
                  <option value="hard">Hard: analyse and compare</option>
                </Select>
                <div>
                  <label htmlFor="quiz-count" className="block text-sm font-medium text-fg-2 mb-2">
                    Questions
                  </label>
                  <div className="study-count">
                    <Button size="sm" icon aria-label="Fewer questions" onClick={() => setNumQ(Math.max(3, numQ - 1))}><Minus size={14} /></Button>
                    <input id="quiz-count" type="range" min={3} max={20} value={numQ} onChange={(e) => setNumQ(parseInt(e.target.value))}
                           className="flex-1 cursor-pointer" style={{ ["--fill" as string]: `${((numQ - 3) / 17) * 100}%` }} />
                    <span className="study-count__value" aria-hidden="true">{numQ}</span>
                    <Button size="sm" icon aria-label="More questions" onClick={() => setNumQ(Math.min(20, numQ + 1))}><Plus size={14} /></Button>
                  </div>
                </div>
              </div>
              <Button type="submit" variant="primary" block loading={loading} disabled={!topic.trim()}>
                {loading ? "Generating quiz…" : <><Zap size={16} aria-hidden="true" />Generate quiz</>}
              </Button>
            </form>
            <div hidden={loading}>
              <p className="study-suggest-label">Or start with a ready-made quiz:</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {QUIZ_SUGGESTIONS.map((s) => (
                  <button type="button" key={s.label} disabled={loading} onClick={() => void handleGenerate(s.topic, s.type, s.num)} className="study-prompt">
                    <span className="text-ink-blue" aria-hidden="true">{s.icon}</span>{s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </>,
    );
  }

  // ── REVIEW (after the last question) ─────────────────────────────────────
  if (isComplete) {
    return shell(
      <>
        {toolbar("Quiz complete", `${topic} · ${quiz.questions.length} ${quiz.questions.length === 1 ? "question" : "questions"}`)}
        <QuizReview topic={topic} questions={quiz.questions} answers={answers} verdict={feedbackFor} onNewQuiz={handleRestart}
          summary={summary} onRetryMissed={quizId && summary?.missed.length ? () => { void handleRetryMissed(); } : undefined} retrying={retrying} />
      </>,
    );
  }

  // ── ONE QUESTION ─────────────────────────────────────────────────────────
  const q = quiz.questions[currentQ];
  return shell(
    <>
      {toolbar("Quiz", topic, true)}
      <QuizQuestionView
        key={q.id}
        index={currentQ}
        total={quiz.questions.length}
        question={q}
        picked={answers[q.id]}
        result={feedbackFor(q)}
        revealed={showExplanation}
        checking={checking}
        onAnswer={handleAnswer}
        onNext={handleNext}
      />
    </>,
  );
}
