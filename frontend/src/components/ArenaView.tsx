"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Swords, Skull, Zap, Heart, Flag, ChevronDown, History, Loader2 } from "lucide-react";
import FileUploader from "./FileUploader";
import HistoryPanel from "./HistoryPanel";
import { summonBoss, generateArenaQuiz } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// FIX #16/#22: Read env var — supports both names for backwards-compat.
// Make sure .env.local has: NEXT_PUBLIC_API_URL=https://your-backend.com
const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";
const BOSS_STORAGE_KEY = "cmai_active_boss";

// Maps shop title item IDs → arena display label
const TITLE_LABELS: Record<string, string> = {
  title_scholar:       "SCHOLAR",
  title_quiz_master:   "QUIZ MASTER",
  title_dragon_slayer: "DRAGON SLAYER",
  title_legend:        "LEGEND",
};


// ─── DIFFICULTY CONFIG ─────────────────────────────────────────────────────────
type Difficulty = "easy" | "medium" | "hard" | "nightmare";

interface DifficultyDef {
  id: Difficulty;
  label: string;
  hearts: number;
  emoji: string;
  // UI theme for the arena window
  primaryColor: string;
  bgGradient: string;
  borderColor: string;
  textColor: string;
  buttonGradient: string;
  headerBg: string;
  // Boss logo / icon above summon title
  bossIcon: React.ReactNode;
  description: string;
}

// Pixel avatar smiling with teeth (happy) for easy
const HappyFaceIcon = () => (
  <div style={{
    width: 52, height: 52, borderRadius: "12px",
    background: "linear-gradient(135deg, #22cc44, #44ff66)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 20px #22cc4466",
  }}>
    <svg width="32" height="32" viewBox="0 0 16 16" style={{ imageRendering: "pixelated" }}>
      {/* face */}
      <rect x="4" y="2" width="8" height="12" fill="#FFDBB4" />
      {/* eyes */}
      <rect x="5" y="5" width="2" height="2" fill="#222" />
      <rect x="9" y="5" width="2" height="2" fill="#222" />
      {/* big smile with teeth */}
      <rect x="5" y="9" width="6" height="3" fill="#CC3322" rx="1" />
      <rect x="5" y="9" width="6" height="1" fill="white" />
      {/* cheek blush */}
      <rect x="3" y="7" width="2" height="1" fill="#FFAAAA" opacity="0.7" />
      <rect x="11" y="7" width="2" height="1" fill="#FFAAAA" opacity="0.7" />
    </svg>
  </div>
);

// Small smile (no teeth) for medium
const SmileFaceIcon = () => (
  <div style={{
    width: 52, height: 52, borderRadius: "12px",
    background: "linear-gradient(135deg, #ee8800, #ffaa22)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 20px #ee880066",
  }}>
    <svg width="32" height="32" viewBox="0 0 16 16" style={{ imageRendering: "pixelated" }}>
      <rect x="4" y="2" width="8" height="12" fill="#FFDBB4" />
      <rect x="5" y="5" width="2" height="2" fill="#222" />
      <rect x="9" y="5" width="2" height="2" fill="#222" />
      {/* small closed smile */}
      <rect x="5" y="9" width="6" height="2" fill="#CC3322" rx="1" />
      <rect x="6" y="9" width="4" height="1" fill="#EE6655" />
    </svg>
  </div>
);

// Serious/no smile for hard
const SeriousFaceIcon = () => (
  <div style={{
    width: 52, height: 52, borderRadius: "12px",
    background: "linear-gradient(135deg, #cc2244, #9933aa)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 20px #cc224466",
  }}>
    <svg width="32" height="32" viewBox="0 0 16 16" style={{ imageRendering: "pixelated" }}>
      <rect x="4" y="2" width="8" height="12" fill="#FFDBB4" />
      {/* serious eyes (narrowed) */}
      <rect x="5" y="5" width="2" height="1" fill="#222" />
      <rect x="9" y="5" width="2" height="1" fill="#222" />
      {/* furrowed brow */}
      <rect x="5" y="4" width="2" height="1" fill="#554433" />
      <rect x="9" y="4" width="2" height="1" fill="#554433" />
      {/* flat/neutral mouth */}
      <rect x="6" y="9" width="4" height="1" fill="#884422" />
    </svg>
  </div>
);

// Nightmare: retro pixel skull
const NightmareSkullIcon = () => (
  <div style={{
    width: 52, height: 52, borderRadius: "8px",
    background: "linear-gradient(135deg, #220000, #550000)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 24px #ff000055",
    border: "2px solid #880000",
    animation: "nmPulse 1.5s ease-in-out infinite",
  }}>
    <style>{`@keyframes nmPulse { 0%,100%{box-shadow:0 0 24px #ff000055} 50%{box-shadow:0 0 40px #ff0000aa} }`}</style>
    <svg width="32" height="32" viewBox="0 0 16 16" style={{ imageRendering: "pixelated" }}>
      {/* skull dome */}
      <rect x="4" y="1" width="8" height="8" fill="#CC0000" />
      <rect x="3" y="3" width="10" height="6" fill="#CC0000" />
      <rect x="2" y="4" width="12" height="5" fill="#CC0000" />
      {/* eye sockets */}
      <rect x="3" y="4" width="3" height="3" fill="#000" />
      <rect x="10" y="4" width="3" height="3" fill="#000" />
      {/* red eye glow */}
      <rect x="4" y="5" width="1" height="1" fill="#FF0000" />
      <rect x="11" y="5" width="1" height="1" fill="#FF0000" />
      {/* nose cavity */}
      <rect x="7" y="6" width="2" height="2" fill="#000" />
      {/* teeth */}
      <rect x="4" y="9" width="8" height="3" fill="#AA0000" />
      <rect x="4" y="9" width="1" height="2" fill="#EEE" />
      <rect x="6" y="9" width="1" height="2" fill="#EEE" />
      <rect x="8" y="9" width="1" height="2" fill="#EEE" />
      <rect x="10" y="9" width="1" height="2" fill="#EEE" />
      {/* jaw */}
      <rect x="3" y="9" width="10" height="4" fill="#AA0000" />
    </svg>
  </div>
);

const DIFFICULTIES: DifficultyDef[] = [
  {
    id: "easy", label: "Easy", hearts: 5, emoji: "😄",
    primaryColor: "#22cc44", bgGradient: "from-green-900/20 to-green-800/10",
    borderColor: "border-green-500/30", textColor: "text-green-400",
    buttonGradient: "from-green-500 to-emerald-600",
    headerBg: "bg-green-900/20",
    bossIcon: <HappyFaceIcon />,
    description: "A warm-up challenge. 5 hearts, friendly questions!",
  },
  {
    id: "medium", label: "Medium", hearts: 4, emoji: "🙂",
    primaryColor: "#ee8800", bgGradient: "from-orange-900/20 to-yellow-900/10",
    borderColor: "border-orange-500/30", textColor: "text-orange-400",
    buttonGradient: "from-orange-500 to-amber-600",
    headerBg: "bg-orange-900/20",
    bossIcon: <SmileFaceIcon />,
    description: "A real test. 4 hearts — think before you answer.",
  },
  {
    id: "hard", label: "Hard", hearts: 3, emoji: "😐",
    primaryColor: "#cc2244", bgGradient: "from-red-900/20 to-purple-900/10",
    borderColor: "border-red-500/30", textColor: "text-red-400",
    buttonGradient: "from-red-600 to-purple-700",
    headerBg: "bg-red-900/20",
    bossIcon: <SeriousFaceIcon />,
    description: "No mercy. 3 hearts. The boss fights back hard.",
  },
  {
    id: "nightmare", label: "Nightmare", hearts: 1, emoji: "💀",
    primaryColor: "#ff0000", bgGradient: "from-red-950/60 to-black",
    borderColor: "border-red-900/50", textColor: "text-red-500",
    buttonGradient: "from-red-900 to-black",
    headerBg: "bg-red-950/40",
    bossIcon: <NightmareSkullIcon />,
    description: "One heart. One mistake ends it. GOOD LUCK.",
  },
];

const DIFF_MAP: Record<Difficulty, DifficultyDef> = Object.fromEntries(
  DIFFICULTIES.map(d => [d.id, d])
) as Record<Difficulty, DifficultyDef>;

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function ArenaView() {
  // Persist sessionId in sessionStorage so navigating away and back reuses
  // the same session (and boss prefetch). Without this every mount generates
  // a new UUID, orphaning the old PDF session in server memory.
  const [sessionId] = useState(() => {
    try {
      const stored = sessionStorage.getItem("cmai_arena_session");
      if (stored) return stored;
      const fresh = crypto.randomUUID();
      sessionStorage.setItem("cmai_arena_session", fresh);
      return fresh;
    } catch {
      return crypto.randomUUID();
    }
  });
  const { user } = useAuth();
  const userId = useHUDStore((s) => s.userId);
  const level  = useHUDStore((s) => s.level);
  const coins  = useHUDStore((s) => s.coins);
  const buffs  = useHUDStore((s) => s.buffs);
  const refresh = useHUDStore((s) => s.refresh);
  const [equippedTitle, setEquippedTitle] = useState<string>("");
  const [equippedAvatar, setEquippedAvatar] = useState<Record<string,string>>({});
  /** true once phase-1 questions are ready → enables Open Battle Arena button */
  const [questionsReady, setQuestionsReady] = useState(false);
  /** Debounced boss prefetch: keyed by {topic, difficulty} */
  const pendingBossRef  = useRef<{ topic: string; difficulty: string; data: any } | null>(null);
  const prefetchTokenRef = useRef(0);

  const [topic, setTopic]       = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [boss,  setBoss]        = useState<any>(null);
  const [bossHP, setBossHP]     = useState(100);
  // FIX BUG-F14: Initialize from DIFF_MAP so the starting HP matches "hard" (3 hearts),
  // and will correctly reflect any difficulty (easy=5, medium=4, hard=3, nightmare=1).
  const [playerHP, setPlayerHP] = useState(() => DIFF_MAP["medium"].hearts);
  const [phase, setPhase]       = useState(1);
  const [loading, setLoading]   = useState(false);
  const [healing, setHealing]   = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [personalBest, setPersonalBest] = useState<{grade:string,accuracy:number,time:number}|null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  // Nightmare unlock: requires hard mode cleared on this topic

  // Fetch the user's equipped title so arena shows the purchased title
  useEffect(() => {
    if (!userId || userId === "guest") return;
    fetch(`${BACKEND_URL}/avatar`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        const titleId = data?.equipped?.title || "";
        setEquippedTitle(TITLE_LABELS[titleId] || "");
        setEquippedAvatar(data?.equipped || {});
      })
      .catch(() => {});
  }, [userId]);

  /**
   * OPT-1: Debounced boss pre-fetch.
   * While the user types their topic, silently summon the boss in the background.
   * By the time they click "Summon", the boss is already ready → zero LLM wait.
   */
  useEffect(() => {
    const trimmed = topic.trim();
    if (trimmed.length < 3) { pendingBossRef.current = null; return; }
    const token = ++prefetchTokenRef.current;
    const timer = setTimeout(async () => {
      // Already have a valid prefetch for this exact topic+difficulty
      if (pendingBossRef.current?.topic === trimmed && pendingBossRef.current?.difficulty === difficulty) return;
      try {
        const data = await summonBoss(trimmed, sessionId, difficulty);
        // Only store if still the latest request (topic didn't change again)
        if (data?.name && prefetchTokenRef.current === token) {
          pendingBossRef.current = { topic: trimmed, difficulty, data };
        }
      } catch { /* silent — main path will retry */ }
    }, 700);
    return () => clearTimeout(timer);
  }, [topic, difficulty, sessionId]);

  /** OPT-2: Push boss+questions into server-side prefetch cache so game.js skips its own LLM calls */
  const savePrefetch = useCallback((bossData: any, p1: any[], p2: any[]) => {
    fetch(`${BACKEND_URL}/arena/prefetch`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, bossData, prefetchedPhase1: p1, prefetchedPhase2: p2 }),
    }).catch(() => {});
  }, [sessionId]);

  const diff = DIFF_MAP[difficulty];

  const handleHeal = async () => {
    if (playerHP >= diff.hearts) { toast.info("HP is already full!"); return; }
    if (!buffs?.heal_1) { toast.error("No Health Potion ready."); return; }
    setHealing(true);
    try {
      const res = await fetch(`${BACKEND_URL}/arena/heal`, { method:"POST", credentials:"include" });
      const result = await res.json();
      if (result.ok) {
        setPlayerHP(hp => Math.min(diff.hearts, hp + 1));
        toast.success("❤️ Healed +1 HP!");
        await refresh();
      } else toast.error(result.reason || "Heal failed");
    } catch { toast.error("Heal failed"); }
    setHealing(false);
  };

  /**
   * OPT-3: Progressive boss summon.
   * Step 1 — boss data (instant if pre-fetched via debounce, otherwise 1 LLM call)
   *   → boss card appears, spinner shown on the Open Arena button
   * Step 2 — phase-1 questions finish (parallel with phase-2, usually faster)
   *   → "Open Battle Arena" button enabled immediately
   * Step 3 — phase-2 questions finish in background
   *   → server prefetch cache updated silently, user never waits for it
   */
  const handleSummonBoss = async () => {
    if (!topic.trim()) { toast.error("Enter a topic to summon a boss!"); return; }
    setLoading(true);
    setQuestionsReady(false);

    // ── Step 1: Boss data (use debounced pre-fetch if topic matches) ──
    const cached = pendingBossRef.current;
    let bossData: any;
    if (cached?.topic === topic.trim() && cached?.difficulty === difficulty) {
      bossData = cached.data;
      pendingBossRef.current = null;
    } else {
      try { bossData = await summonBoss(topic, sessionId, difficulty); }
      catch { toast.error("Failed to summon boss"); setLoading(false); return; }
    }
    if (!bossData) { toast.error("Failed to summon boss"); setLoading(false); return; }

    // ── Step 2: Reveal boss card immediately, kill main spinner ──
    const makePayload = (p1: any[], p2: any[]) => ({
      ...bossData, bossData,   // nested bossData key so game.js can find it in cache
      sessionId, topic, userId, level, difficulty,
      prefetchedPhase1: p1,
      prefetchedPhase2: p2,
    });

    const initialPayload = makePayload([], []);
    setBoss(initialPayload);
    setBossHP((bossData.max_hp || 100) + (level * 20));
    setPlayerHP(diff.hearts);
    setPhase(1);
    setLoading(false);
    // Push boss (no questions yet) to server cache — game.js can start loading now
    savePrefetch(bossData, [], []);

    // ── Step 3: Fire both question batches in parallel ──
    const phase1Promise = generateArenaQuiz(topic, sessionId, "normal", 8, 1, []).catch(() => null);
    const phase2Promise = generateArenaQuiz(topic, sessionId, "hard",   8, 2, []).catch(() => null);

    // Enable button the moment phase-1 arrives (no need to wait for phase-2)
    const phase1Data = await phase1Promise;
    const p1 = phase1Data?.questions ?? [];
    const payloadP1 = makePayload(p1, []);
    localStorage.setItem(BOSS_STORAGE_KEY, JSON.stringify(payloadP1));
    setBoss(payloadP1);
    savePrefetch(bossData, p1, []);
    setQuestionsReady(true);   // ← "Open Battle Arena" unlocks here

    // ── Step 4: Phase-2 finishes in the background, user is never blocked ──
    phase2Promise.then(phase2Data => {
      const p2 = phase2Data?.questions ?? [];
      if (!p2.length) return;
      const final = makePayload(p1, p2);
      localStorage.setItem(BOSS_STORAGE_KEY, JSON.stringify(final));
      setBoss(final);
      savePrefetch(bossData, p1, p2);
    });
  };

  const handleOpenBattleArena = () => {
    // FIX #22: pass backend_url so game.js can connect even outside localhost
    const url =
      `${BACKEND_URL}/static/arena.html` +
      `?session=${encodeURIComponent(sessionId)}` +
      `&topic=${encodeURIComponent(topic)}` +
      `&level=${level || 1}` +
      `&user=${encodeURIComponent(userId || "")}` +
      `&difficulty=${encodeURIComponent(difficulty)}` +
      `&backend_url=${encodeURIComponent(BACKEND_URL)}` +
      `&username=${encodeURIComponent(user?.username || user?.full_name || "")}` +
      `&title=${encodeURIComponent(equippedTitle)}` +
      `&coins=${encodeURIComponent(coins.toString())}` +
      `&avatar=${encodeURIComponent(JSON.stringify(equippedAvatar))}`;
    window.open(url, "_blank");
  };

  // Load personal best when topic changes
  useEffect(() => {
    const trimmed = topic.trim();
    if (!trimmed) { setPersonalBest(null); return; }
    try {
      const raw = localStorage.getItem(`cmai_pb_${trimmed}_${difficulty}`.replace(/\s/g,'_'));
      setPersonalBest(raw ? JSON.parse(raw) : null);
    } catch { setPersonalBest(null); }
  }, [topic, difficulty]);

  // Fetch leaderboard when topic + difficulty are set
  useEffect(() => {
    const trimmed = topic.trim();
    if (!trimmed) { setLeaderboard([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/arena/leaderboard?topic=${encodeURIComponent(trimmed)}&difficulty=${encodeURIComponent(difficulty)}`,
          { credentials: "include", signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          setLeaderboard(data.entries ?? []);
        }
      } catch { /* ignore */ }
    }, 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [topic, difficulty]);

  const handleForfeit = () => {
    localStorage.removeItem(BOSS_STORAGE_KEY);
    try { sessionStorage.removeItem("cmai_arena_session"); } catch {}
    setBoss(null); setTopic(""); setPhase(1);
    setPlayerHP(diff.hearts);
    setQuestionsReady(false);
    // Generate a new sessionId for the next battle
    window.location.reload();
  };

  // ─── SUMMON SCREEN ───────────────────────────────────────────────────────────
  if (!boss) {
    const isNightmare = difficulty === "nightmare";
    return (
      <div className="flex h-full overflow-hidden">
        {showHistory && (
          <HistoryPanel
            activeMode="battle"
            onSelect={() => setShowHistory(false)}
            onNew={() => setShowHistory(false)}
            onClose={() => setShowHistory(false)}
          />
        )}
        <div className={`flex flex-col flex-1 overflow-hidden ${isNightmare ? "nightmare-arena" : ""}`}
          style={{ background: isNightmare ? "linear-gradient(180deg, #080000 0%, #110000 100%)" : undefined }}>
        <style>{`
          .nightmare-arena {
            background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='60' height='60' fill='%23080000'/%3E%3Crect x='0' y='0' width='1' height='1' fill='%23440000' opacity='0.5'/%3E%3C/svg%3E");
          }
          .nightmare-arena::before {
            content: '';
            position: absolute;
            inset: 0;
            background: radial-gradient(ellipse at 50% 0%, rgba(255,0,0,0.08) 0%, transparent 70%);
            pointer-events: none;
            z-index: 0;
          }
        `}</style>

        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${diff.borderColor} ${diff.headerBg} backdrop-blur-sm`}
          style={isNightmare ? { borderBottomColor: "#440000", background: "rgba(20,0,0,0.8)" } : {}}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${diff.primaryColor}44, ${diff.primaryColor}22)`, border: `1px solid ${diff.primaryColor}44` }}>
              <Swords style={{ color: diff.primaryColor }} size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary"
                style={isNightmare ? { color: "#ff3333", textShadow: "0 0 10px #ff000088" } : {}}>
                Battle Arena
              </h2>
              <p className="text-sm" style={{ color: diff.primaryColor }}>
                Summon and defeat knowledge bosses
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-red text-accent-red bg-accent-red/10" : "border-border text-text-muted hover:border-accent-red/50 hover:text-accent-red"}`}
              title="Battle history"
            ><History size={16} /></button>
            <FileUploader sessionId={sessionId} />
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex items-center justify-center p-6 relative z-10">
          <div className="max-w-md w-full space-y-6">
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                {diff.bossIcon}
              </div>
              <h3 className="text-2xl font-bold text-text-primary"
                style={isNightmare ? { color: "#ff2222", textShadow: "0 0 15px #ff000077", fontFamily: "monospace" } : {}}>
                {isNightmare ? "⚠ SUMMON A BOSS ⚠" : "Summon a Boss"}
              </h3>
              <p style={{ color: isNightmare ? "#cc0000" : "var(--text-muted)" }}>
                {diff.description}
              </p>
            </div>

            {/* Summon form */}
            <div className={`p-6 rounded-xl border space-y-4 ${diff.borderColor}`}
              style={isNightmare
                ? { background: "rgba(20,0,0,0.9)", borderColor: "#550000", boxShadow: "0 0 30px #ff000022" }
                : { background: "var(--bg-card)" }}>

              {/* Difficulty dropdown */}
              <div className="relative">
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Difficulty
                </label>
                <button
                  onClick={() => setDiffOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-left transition-all"
                  style={{
                    background: isNightmare ? "#1a0000" : "var(--bg-primary)",
                    border: `2px solid ${diff.primaryColor}66`,
                    color: diff.primaryColor,
                  }}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <span>{diff.emoji}</span>
                    <span>{diff.label}</span>
                    <span className="text-xs opacity-70">— {diff.hearts} ❤️</span>
                  </span>
                  <ChevronDown size={16} className={`transition-transform ${diffOpen ? "rotate-180" : ""}`} />
                </button>

                {diffOpen && (
                  <div className="absolute z-50 w-full mt-1 rounded-lg overflow-hidden shadow-2xl"
                    style={{
                      background: isNightmare ? "#110000" : "#0F0F1A",
                      border: `1px solid ${diff.primaryColor}66`,
                      backdropFilter: "none",
                    }}>
                    {DIFFICULTIES.map(d => (
                      <button
                        key={d.id}
                        onClick={() => {
                          setDifficulty(d.id);
                          setPlayerHP(DIFF_MAP[d.id].hearts);
                          setDiffOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all"
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.06)",
                          background: "transparent",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <span className="text-lg">{d.emoji}</span>
                        <div>
                          <div className="font-semibold text-sm" style={{ color: d.primaryColor }}>{d.label}</div>
                          <div className="text-xs text-text-muted">{d.hearts} hearts • {d.description.split(".")[0]}</div>
                        </div>
                        {d.id === difficulty && <span className="ml-auto text-xs" style={{ color: d.primaryColor }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Topic input */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Boss Topic
                </label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSummonBoss()}
                  placeholder="e.g., Photosynthesis, World War II"
                  className="w-full px-4 py-3 rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2"
                  style={{
                    background: isNightmare ? "#1a0000" : "var(--bg-primary)",
                    border: `1px solid ${diff.primaryColor}44`,
                    ["--tw-ring-color" as any]: diff.primaryColor + "50",
                    boxShadow: isNightmare ? `0 0 10px ${diff.primaryColor}11` : undefined,
                  }}
                />
              </div>

              {/* Personal best banner */}
              {personalBest && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs border"
                  style={{ background: "rgba(212,175,55,0.06)", borderColor: "rgba(212,175,55,0.25)", color: "#c9a84c" }}>
                  <span>🏆</span>
                  <span>
                    Your best: <strong>{personalBest.grade}</strong>
                    {" · "}{personalBest.accuracy}%
                    {" · "}{Math.floor(personalBest.time / 60)}m {personalBest.time % 60}s
                  </span>
                </div>
              )}

              {/* Leaderboard */}
              {leaderboard.length > 0 && (
                <div className="rounded-lg border overflow-hidden"
                  style={{ borderColor: diff.primaryColor + "33", background: "rgba(0,0,0,0.2)" }}>
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest"
                    style={{ color: diff.primaryColor, borderBottom: `1px solid ${diff.primaryColor}22` }}>
                    🏅 Top {leaderboard.length} — {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
                  </div>
                  <div className="divide-y divide-white/5">
                    {leaderboard.slice(0, 5).map((entry: any, i: number) => (
                      <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                        <span className="text-text-muted w-5">{i + 1}.</span>
                        <span className="flex-1 text-text-secondary truncate px-1">{entry.username ?? entry.user_id ?? "Anonymous"}</span>
                        <span className="font-bold mr-2" style={{ color: diff.primaryColor }}>{entry.grade}</span>
                        <span className="text-text-muted">{entry.accuracy}%</span>
                        <span className="text-text-muted ml-2">
                          {Math.floor(entry.time / 60)}m{entry.time % 60}s
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summon button */}
              <button
                onClick={handleSummonBoss}
                disabled={loading || !topic.trim()}
                className="w-full py-3 text-white rounded-lg font-semibold hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{
                  background: isNightmare
                    ? "linear-gradient(135deg, #440000, #880000)"
                    : `linear-gradient(135deg, ${diff.primaryColor}, ${diff.primaryColor}bb)`,
                  boxShadow: loading ? "none" : `0 4px 20px ${diff.primaryColor}44`,
                  color: isNightmare ? "#ff6666" : "white",
                  border: isNightmare ? "1px solid #660000" : "none",
                  fontFamily: isNightmare ? "monospace" : undefined,
                  letterSpacing: isNightmare ? "1px" : undefined,
                }}
              >
                {loading ? (
                  <><Zap className="animate-pulse" size={20} />Summoning...</>
                ) : (
                  <><Skull size={20} />{isNightmare ? "⚠ SUMMON BOSS ⚠" : "Summon Boss"}</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
        </div>
    );
  }

  // ─── ACTIVE BATTLE SCREEN ───────────────────────────────────────────────────
  const isNightmare = difficulty === "nightmare";
  return (
    <div className="flex flex-col h-full"
      style={isNightmare ? { background: "linear-gradient(180deg, #080000, #110000)" } : {}}>
      <div className={`flex items-center justify-between px-6 py-4 border-b ${diff.borderColor} ${diff.headerBg} backdrop-blur-sm`}
        style={isNightmare ? { borderBottomColor: "#440000", background: "rgba(20,0,0,0.8)" } : {}}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${diff.primaryColor}44, ${diff.primaryColor}22)` }}>
            <Swords style={{ color: diff.primaryColor }} size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-text-primary"
              style={isNightmare ? { color: "#ff3333" } : {}}>Battle Arena</h2>
            <p className="text-sm font-medium" style={{ color: diff.primaryColor }}>
              {diff.emoji} {diff.label} • Battle Level {phase}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${diff.borderColor}`}
          style={{ background: diff.primaryColor + "11" }}>
          <span className="text-xs font-bold" style={{ color: diff.primaryColor }}>
            Battle Level {phase}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto arena-scroll p-6 space-y-4">
        {/* Boss Card */}
        <div className="rounded-xl p-6 border"
          style={{
            background: isNightmare ? "rgba(30,0,0,0.8)" : `linear-gradient(135deg, ${diff.primaryColor}18, ${diff.primaryColor}08)`,
            borderColor: diff.primaryColor + "55",
            boxShadow: isNightmare ? `0 0 30px ${diff.primaryColor}22` : undefined,
          }}>
          <div className="text-center mb-4">
            <h3 className="text-2xl font-bold text-accent-gold mb-1">{boss.name}</h3>
            <p className="text-sm text-text-muted italic">{boss.tagline}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Boss HP */}
            <div className="bg-bg-card p-3 rounded-lg border border-border">
              <p className="text-xs text-text-muted mb-1">Boss HP</p>
              <div className="flex items-center justify-between mb-1">
                <div className="flex-1 h-2 bg-bg-primary rounded-full overflow-hidden mr-2">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${Math.max(0, (bossHP / ((boss.max_hp || 100) + (level * 20))) * 100)}%`,
                      background: `linear-gradient(to right, ${diff.primaryColor}, ${diff.primaryColor}99)`,
                    }}
                  />
                </div>
                <span className="text-sm font-bold" style={{ color: diff.primaryColor }}>
                  {bossHP}/{(boss.max_hp || 100) + (level * 20)}
                </span>
              </div>
            </div>

            {/* Player HP */}
            <div className="bg-bg-card p-3 rounded-lg border border-border">
              <p className="text-xs text-text-muted mb-1">Your HP</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 flex-wrap">
                  {[...Array(diff.hearts)].map((_, i) => (
                    <Heart
                      key={i}
                      size={18}
                      className={i < playerHP ? "fill-red-500 text-red-500" : "text-text-muted"}
                      style={isNightmare && i < playerHP ? { filter: "drop-shadow(0 0 4px #ff0000)" } : {}}
                    />
                  ))}
                </div>
                {buffs?.heal_1 && playerHP < diff.hearts && (
                  <button
                    onClick={handleHeal}
                    disabled={healing}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                    style={{ background: "#ff000020", border: "1px solid #ff000044", color: "#ff6666" }}
                  >
                    🧪 {healing ? "Healing..." : "Potion"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-bg-card p-3 rounded-lg border border-border">
              <p className="text-xs text-text-muted mb-1">⚡ Special Ability</p>
              <p className="text-text-primary font-semibold">{boss.special_ability}</p>
            </div>
            <div className="bg-bg-card p-3 rounded-lg border border-border">
              <p className="text-xs text-text-muted mb-1">🎭 Personality</p>
              <p className="text-text-primary font-semibold">{boss.personality}</p>
            </div>
            <div className="bg-bg-card p-3 rounded-lg border border-border col-span-2">
              <p className="text-xs text-text-muted mb-1">💀 Weakness</p>
              <p className="text-text-primary font-semibold">{boss.weakness}</p>
            </div>
          </div>

          {boss.intro_taunt && (
            <div className="mt-4 p-3 bg-bg-primary rounded-lg" style={{ border: `1px solid ${diff.primaryColor}44` }}>
              <p className="text-sm italic" style={{ color: diff.primaryColor }}>"{boss.intro_taunt}"</p>
            </div>
          )}
        </div>

        {/* Open battle */}
        <div className="bg-bg-card rounded-xl border border-border-subtle overflow-hidden">
          <div className="px-6 py-5 border-b border-border-subtle text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Swords size={16} style={{ color: diff.primaryColor }} />
              <h3 className="font-bold text-text-primary">Battle in Progress</h3>
            </div>
            <p className="text-xs text-text-muted">
              {questionsReady ? `Fight ${boss.name} in the dedicated battle tab` : "Preparing battle questions…"}
            </p>
          </div>
          <div className="px-6 py-6 flex flex-col items-center gap-3">
            <button
              onClick={handleOpenBattleArena}
              disabled={!questionsReady}
              className="flex items-center gap-2 px-10 py-3.5 text-sm font-bold rounded-lg hover:opacity-90 transition-all shadow-lg tracking-wide disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: isNightmare ? "linear-gradient(135deg, #660000, #220000)" : `linear-gradient(135deg, ${diff.primaryColor}, ${diff.primaryColor}99)`,
                color: isNightmare ? "#ff6666" : "white",
                border: isNightmare ? "1px solid #880000" : "none",
                boxShadow: questionsReady ? `0 4px 20px ${diff.primaryColor}44` : "none",
              }}
            >
              {questionsReady ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                  OPEN BATTLE ARENA
                </>
              ) : (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Preparing Questions…
                </>
              )}
            </button>
            <p className="text-xs text-text-muted">
              {questionsReady ? "Keep this page open to track your progress" : "Phase 2 questions load in the background"}
            </p>
          </div>
        </div>

        {/* Tips */}
        <div className="bg-bg-card rounded-xl border border-border-subtle px-6 py-4">
          <h4 className="text-xs font-semibold text-text-muted mb-3 flex items-center gap-1.5">
            <Zap size={13} style={{ color: diff.primaryColor }} /> Battle Tips
          </h4>
          <ul className="text-xs text-text-muted space-y-1.5">
            <li>• Answer quiz questions correctly to damage the boss</li>
            <li>• Build combos for extra damage multipliers</li>
            <li>• Wrong answers let the boss counterattack</li>
            <li>• Use the boss&apos;s weakness to your advantage</li>
            {isNightmare && <li style={{ color: "#cc0000" }}>⚠ ONE HEART — one wrong answer = game over!</li>}
          </ul>
        </div>

        {/* Forfeit */}
        <div className="flex justify-center pb-2">
          <button
            onClick={handleForfeit}
            className="flex items-center gap-2 px-5 py-2 rounded-lg border border-border text-text-muted hover:text-accent-red hover:border-accent-red/40 transition-all text-sm"
          >
            <Flag size={14} />
            Forfeit Battle
          </button>
        </div>
      </div>
    </div>
  );
}