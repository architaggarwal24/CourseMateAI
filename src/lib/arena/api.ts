// The arena's calls to the server-authoritative battle API (backend/routers/arena.py). One thin function per
// endpoint; they throw ApiError like the rest of the app, so callers use toast.apiError / error.code.
import { api } from "@/lib/api/client";
import type {
  ActiveBattle, AnswerResponse, BattleGetResponse, ChooseResponse, CreateResponse, Difficulty, ForfeitResponse, ItemId,
  ItemResponse, LeaderboardResponse, Move, QuestionResponse, Run, RunBoardEntry, RunResponse, Spell, SpellResponse,
  TravelResponse, UltimateResponse, WeakConceptsResponse, BestiaryPage, BestiaryResponse, TauntResponse, EmoteEntry,
} from "./types";
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";

// The generated schema types these bodies loosely, so the real shapes (types.ts) are asserted here, in one place.
const as = <T,>(data: unknown) => data as T;

/** `species`: a Hunt (the Bestiary's Hunt button) - that creature, whatever the topic would summon. */
export async function startBattle(sessionId: string, topic: string, difficulty: Difficulty, mode: "quick" | "nemesis" = "quick", species?: string | null): Promise<CreateResponse> {
  const body = mode === "nemesis" ? { session_id: sessionId, difficulty, mode }
    : { session_id: sessionId, topic, difficulty, mode, ...(species ? { species } : {}) };
  const { data } = await api.POST("/arena/battles", { body: body as never });
  return as<CreateResponse>(data);
}

export async function fetchBattle(battleId: string): Promise<BattleGetResponse> {
  const { data } = await api.GET("/arena/battles/{battle_id}", { params: { path: { battle_id: battleId } } });
  return as<BattleGetResponse>(data);
}

export async function castSpell(battleId: string, spell: Spell): Promise<SpellResponse> {
  const { data } = await api.POST("/arena/battles/{battle_id}/spells", { params: { path: { battle_id: battleId } }, body: { spell } });
  return as<SpellResponse>(data);
}

/** Cast the champion's ultimate (needs a full meter; 409 ultimate_not_ready / ultimate_active otherwise). */
export async function castUltimate(battleId: string): Promise<UltimateResponse> {
  const { data } = await api.POST("/arena/battles/{battle_id}/ultimate", { params: { path: { battle_id: battleId } } });
  return as<UltimateResponse>(data);
}

export async function fetchWeakConcepts(sessionId: string): Promise<WeakConceptsResponse> {
  const { data } = await api.GET("/arena/weak-concepts", { params: { query: { session_id: sessionId } } });
  return as<WeakConceptsResponse>(data);
}

// ── Expedition ──────────────────────────────────────────────────────────────────────────────────────────────
export async function startRun(sessionId: string, difficulty: Difficulty): Promise<RunResponse> {
  const { data } = await api.POST("/arena/runs", { body: { session_id: sessionId, difficulty } });
  return as<RunResponse>(data);
}
export async function fetchActiveRun(sessionId?: string): Promise<Run | null> {
  const { data } = await api.GET("/arena/runs/active", { params: { query: sessionId ? { session_id: sessionId } : {} } });
  return as<{ run: Run | null }>(data).run ?? null;
}
export async function fetchRun(runId: string): Promise<Run> {
  const { data } = await api.GET("/arena/runs/{run_id}", { params: { path: { run_id: runId } } });
  return as<RunResponse>(data).run;
}
export async function travel(runId: string, nodeId: string): Promise<TravelResponse> {
  const { data } = await api.POST("/arena/runs/{run_id}/travel", { params: { path: { run_id: runId } }, body: { node_id: nodeId } });
  return as<TravelResponse>(data);
}
export async function chooseRun(runId: string, action: string, target?: string): Promise<ChooseResponse> {
  const { data } = await api.POST("/arena/runs/{run_id}/choose", { params: { path: { run_id: runId } }, body: { action, target } as never });
  return as<ChooseResponse>(data);
}
export async function abandonRun(runId: string): Promise<RunResponse> {
  const { data } = await api.POST("/arena/runs/{run_id}/abandon", { params: { path: { run_id: runId } } });
  return as<RunResponse>(data);
}
export async function fetchRunBoard(scope: "document" | "global", sessionId?: string): Promise<RunBoardEntry[]> {
  const { data } = await api.GET("/arena/runs/leaderboard", { params: { query: { scope, ...(sessionId ? { session_id: sessionId } : {}) } as never } });
  return as<{ entries: RunBoardEntry[] }>(data).entries ?? [];
}

/** The battle in progress (on this document when `sessionId` is given, otherwise the newest one), or null. */
export async function fetchActiveBattle(sessionId?: string): Promise<ActiveBattle | null> {
  const { data } = await api.GET("/arena/battles/active", { params: { query: sessionId ? { session_id: sessionId } : {} } });
  return as<{ battle: ActiveBattle | null }>(data).battle ?? null;
}

/** The next question, issued for `move` (the server keeps the one already issued, whatever move is asked). */
export async function fetchQuestion(battleId: string, move?: Move): Promise<QuestionResponse> {
  const { data } = await api.GET("/arena/battles/{battle_id}/question", {
    params: { path: { battle_id: battleId }, query: (move ? { move } : {}) as never },
  });
  return as<QuestionResponse>(data);
}

export async function submitAnswer(battleId: string, questionId: number, answer: string): Promise<AnswerResponse> {
  const { data } = await api.POST("/arena/battles/{battle_id}/answer", {
    params: { path: { battle_id: battleId } }, body: { question_id: questionId, answer },
  });
  return as<AnswerResponse>(data);
}

export async function consumeItem(battleId: string, item: ItemId): Promise<ItemResponse> {
  const { data } = await api.POST("/arena/battles/{battle_id}/items", { params: { path: { battle_id: battleId } }, body: { item } });
  return as<ItemResponse>(data);
}

export async function forfeitBattle(battleId: string): Promise<ForfeitResponse> {
  const { data } = await api.POST("/arena/battles/{battle_id}/forfeit", { params: { path: { battle_id: battleId } } });
  return as<ForfeitResponse>(data);
}

export async function fetchLeaderboard(topic: string, difficulty: Difficulty, signal?: AbortSignal, scope: "topic" | "global" = "topic"): Promise<LeaderboardResponse> {
  const query = scope === "global" ? { difficulty, scope } : { topic, difficulty };
  const { data } = await api.GET("/arena/leaderboard", { params: { query: query as never }, signal });
  return as<LeaderboardResponse>(data);
}

// The Bestiary isn't in the hand-kept OpenAPI types; same origin, same error handling (throwForResponse).
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as T;
}

/** Taunt the boss (once a fight): it rages, the ultimate charges +50, the win pays +25% (409 taunt_used). */
export const tauntBoss = (battleId: string) => postJson<TauntResponse>(`/arena/battles/${encodeURIComponent(battleId)}/taunt`);
/** Every victory emote and whether the player has it. */
export const fetchEmotes = () => getJson<{ emotes: EmoteEntry[] }>("/emotes");

/** The Bestiary: every page and the tiers (signed-in players). */
export const fetchBestiary = () => getJson<BestiaryResponse>("/bestiary");
/** One page, with the concepts this creature has tested you on. */
export const fetchBestiaryPage = (species: string) => getJson<BestiaryPage>(`/bestiary/${encodeURIComponent(species)}`);
