// FIX BUG 37: Removed the old dead-code implementation that was left commented out.




// FIX #16/#17: Read from env var — never hardcode localhost.
// Set NEXT_PUBLIC_API_URL in your .env.local (rename NEXT_PUBLIC_BACKEND_URL → NEXT_PUBLIC_API_URL
// OR keep NEXT_PUBLIC_BACKEND_URL and this falls back to it for backwards-compat).
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

// In-flight deduplication: if the same GET URL is already pending, return
// the same promise instead of firing a second network request.
const _inFlight = new Map<string, Promise<any>>();

async function apiFetch(url: string, options?: RequestInit) {
  // Only deduplicate read-only requests — mutations must always fire.
  const isGet = !options?.method || options.method.toUpperCase() === "GET";
  if (isGet && _inFlight.has(url)) {
    return _inFlight.get(url)!;
  }

  const promise = (async () => {
    const res = await fetch(url, { credentials: "include", ...options });
    if (!res.ok) {
      const err = await res.json().catch(() => null);

      if (res.status === 429) {
        const detail = typeof err?.detail === "object" ? err.detail : {};
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("cmai:quota", {
            detail: {
              message: detail.message || "API quota exceeded. Check your usage with your provider.",
              usageUrl: detail.usage_url || "",
              provider: detail.provider || "",
            }
          }));
        }
        const quotaErr: any = new Error(
          detail.message || "API quota exceeded. Check your usage with your provider."
        );
        quotaErr.isQuota = true;
        quotaErr.usageUrl = detail.usage_url || "";
        quotaErr.provider = detail.provider || "";
        throw quotaErr;
      }

      if (res.status === 401) {
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        throw new Error("Session expired. Please log in again.");
      }
      console.error(`API error ${res.status}:`, err);
      const msg = typeof err?.detail === "object"
        ? (err.detail.message || JSON.stringify(err.detail))
        : (err?.detail || `Request failed with status ${res.status}`);
      throw new Error(msg);
    }
    return res.json();
  })();

  if (isGet) {
    _inFlight.set(url, promise);
    promise.finally(() => _inFlight.delete(url));
  }

  return promise;
}

export async function uploadPDF(file: File, sessionId: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("session_id", sessionId);
  // FIX BUG 36: Old code returned null on error, silently swallowing the
  // failure. Callers had no way to show the user what went wrong.
  // Now we throw with the backend error message so the UI can surface it.
  const res = await fetch(`${API_URL}/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const msg = err?.detail || `Upload failed with status ${res.status}`;
    throw new Error(typeof msg === "object" ? JSON.stringify(msg) : msg);
  }
  return res.json();
}

export async function chatQuestion(
  question: string,
  sessionId: string,
  topK: number = 5,
  history: { role: string; content: string }[] = []
) {
  return apiFetch(`${API_URL}/chat?top_k=${topK}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, session_id: sessionId, history }),
  });
}

// chatWithPDF removed — use chatQuestion() directly

export async function generateFlashcards(topic: string, sessionId: string, numCards: number = 10) {
  return apiFetch(`${API_URL}/flashcards?num_cards=${numCards}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, session_id: sessionId }),
  });
}

export async function generateQuiz(topic: string, numQuestions: number, questionType: string, sessionId: string) {
  return apiFetch(`${API_URL}/quiz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, num_questions: numQuestions, question_type: questionType, session_id: sessionId }),
  });
}

export async function generateNotes(topic: string, detailLevel: string, sessionId: string) {
  return apiFetch(`${API_URL}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, detail_level: detailLevel, session_id: sessionId }),
  });
}

export async function awardRewards(
  userId: string, actionType: string,
  accuracy: number = 1.0, difficulty: number = 1.0, comboCount: number = 1
) {
  return apiFetch(`${API_URL}/rewards/award`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, action_type: actionType, accuracy, difficulty, combo_count: comboCount }),
  });
}

export async function fetchHUD() {
  return apiFetch(`${API_URL}/hud`);
}

export async function fetchDailyQuests() {
  return apiFetch(`${API_URL}/daily-quests`);
}

export async function claimQuest(userId: string, questType: string) {
  return apiFetch(`${API_URL}/daily-quests/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, quest_type: questType }),
  });
}

export async function fetchShop() {
  return apiFetch(`${API_URL}/shop`);
}

export async function purchaseItem(userId: string, itemId: string) {
  return apiFetch(`${API_URL}/shop/purchase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, item_id: itemId }),
  });
}

export async function equipItem(userId: string, itemId: string) {
  return apiFetch(`${API_URL}/shop/equip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, item_id: itemId }),
  });
}

// Arena - uses query params (backend expects query params not JSON body)
export async function summonBoss(topic: string, sessionId: string, difficulty: string = "hard") {
  return apiFetch(
    `${API_URL}/arena/boss?topic=${encodeURIComponent(topic)}&session_id=${sessionId}&difficulty=${encodeURIComponent(difficulty)}`,
    { method: "POST" }
  );
}

export async function createBoss(topic: string, sessionId: string, difficulty: string = "hard") {
  return summonBoss(topic, sessionId, difficulty);
}

export async function generateArenaQuiz(
  topic: string, sessionId: string, difficulty: string,
  numQuestions: number, phase: number, askedConcepts: string[]
) {
  return apiFetch(
    `${API_URL}/arena/quiz?topic=${encodeURIComponent(topic)}&session_id=${sessionId}&difficulty=${difficulty}&num_questions=${numQuestions}&phase=${phase}&asked_concepts=${askedConcepts.join(",")}`,
    { method: "POST" }
  );
}

export async function fetchHistory(mode?: string, limit: number = 100) {
  const params = new URLSearchParams();
  if (mode) params.append("mode", mode);
  params.append("limit", limit.toString());
  return apiFetch(`${API_URL}/history?${params}`);
}

export async function fetchSessionHistory(sessionId: string) {
  return apiFetch(`${API_URL}/history/session/${sessionId}`);
}

// Export the resolved URL so ArenaView can forward it to the iframe
export { API_URL };
export async function fetchAchievements() {
  return apiFetch(`${API_URL}/achievements`);
}