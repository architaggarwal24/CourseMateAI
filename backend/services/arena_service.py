"""Arena boss fights are decided by the server.

The browser starts a battle, asks for the next question, sends an answer and (optionally) uses an item. Everything
else - the boss and its hit points, the player's hearts, phase, combo, the questions with their correct answers, the
clock, the rewards and the leaderboard - lives in the database and is computed here with boss_brain's combat rules.

    create()         a battle row + boss + the boss's first telegraphed intent; returns the boss and battle_id,
                     never an answer
    next_question()  the next question for the player's MOVE (strike / jab / heavy / guard: the move decides the
                     question's tier, its time and - later - its damage; Heavy's Focus is paid here), options
                     shuffled by the server and a server-side deadline. Asking again (a page refresh, a restart)
                     returns the SAME question, move and time left; no move = strike (older clients)
    answer()         grades on the server and resolves the turn both ways: the player's hit (move multiplier,
                     weakness, gear, the boss's shield), the boss's intent (attack / heavy / shield / drain / heal),
                     Focus, relic effects, concept mastery - and rolls the next intent. The first answer to a question
                     is final: a replay returns the stored result and changes nothing
    use_item()       heal / 50-50 act on the battle and consume only what the user owns
    cast_spell()     insight / timewarp, paid with Focus, on the open question
    forfeit()        ends the battle as lost

A battle ends exactly once (compare-and-set on its status). The rewards (arena_round_complete, boss_defeat), the
leaderboard row and the personal best are written in that same transaction, keyed by battle_id. A battle that is
part of an Expedition run (run_id set) pays nothing itself: its end is handed to `on_run_battle_end` (the
ExpeditionService) inside the same transaction, so the run's hearts / gold / relic offers move exactly once too.

LLM trouble never decides a fight: when questions can't be generated - including when the per-phase batch budget is
spent without a usable question - the battle stays as it is and the caller gets a retryable error
(GenerationUnavailable); asking again resumes it.
"""
import asyncio
import json
import logging
import random
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from core_brains import boss_brain
from core_brains.boss_brain import boss_taunt, make_intent, player_hit, roll_intent
from core_brains.llm_schemas import question_key, question_tier
from errors import AppError
from services.quiz_service import same_answer

logger = logging.getLogger(__name__)

# ── rules ────────────────────────────────────────────────────────────────────
PLAYER_MAX_HP = 10                 # boss_attack's damage per wrong answer scales with difficulty (1-3, rage 1-5)
SECONDS_PER_QUESTION = 30
DEADLINE_GRACE_SECONDS = 3         # network slack: an answer this late still counts
MAX_ANSWERS = 40                   # a fight that goes this long without a winner is lost
ROUND_SIZE = 5                     # answers that make up the round arena_round_complete pays for
BATCH_SIZE = 6                     # questions per generated batch
MAX_BATCHES_PER_PHASE = 6
LOW_WATER = 2                      # top the pool up when this few questions are left in the phase
GENERATION_WAIT_SECONDS = 90
HEAL_ITEM, FIFTY_ITEM = "potion_health_small", "fifty_fifty"
ITEMS = ("heal", "fifty_fifty")
# Pacing: boss health (as the LLM / difficulty range gives it) is stretched so a fight is a real study session -
# roughly 5 right answers on easy, 7 on medium, 10 on hard and 14 on nightmare.
HP_PACING = {"easy": 2.6, "medium": 2.4, "hard": 2.6, "nightmare": 2.8}
GEAR_SLOTS = ("weapon", "armor", "headgear", "pet")
# the multipliers the old arena sent along with its rewards
BOSS_DEFEAT_DIFFICULTY = {"easy": 1.2, "medium": 1.5, "hard": 1.8, "nightmare": 2.5}

# ── Arena v2: moves, Focus, spells (docs/arena-v2.md section 2) ─────────────
# tier: the question it asks for; mult: damage of a right answer; seconds: the clock (None = the base);
# cost: Focus paid when the question is issued.
MOVES = {
    "strike": {"tier": "medium", "mult": 1.0, "seconds": None, "cost": 0},
    "jab":    {"tier": "easy",   "mult": 0.6, "seconds": 15,   "cost": 0},
    "heavy":  {"tier": "hard",   "mult": 1.8, "seconds": None, "cost": 2},
    "guard":  {"tier": "medium", "mult": 0.0, "seconds": None, "cost": 0},
}
DEFAULT_MOVE = "strike"                 # what a client that never sends a move gets
TIER_ORDER = {"easy": ("easy", "medium", "hard"), "medium": ("medium", "easy", "hard"),
              "hard": ("hard", "medium", "easy")}      # the wanted tier first, then the nearest
FOCUS_CAP = 5
SPELLS = {"insight": 1, "timewarp": 1}  # Focus cost
TIMEWARP_SECONDS = 15
INTERRUPTING_MOVES = ("strike", "heavy")   # a right answer with these stops a heal
# relic numbers (the relics themselves are content/relics.json; what they do is here and in expedition_service)
OWL_FEATHER_SECONDS = 5
PHOENIX_HEARTS = 3
VAMPIRIC_COMBO = 5
FOCUS_CRYSTAL_START = 2


class GenerationUnavailable(Exception):
    """Questions could not be generated right now. The battle is untouched and can be resumed."""

    def __init__(self, cause: BaseException):
        super().__init__(str(cause))
        self.cause = cause


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def norm_topic(topic) -> str:
    """"Photosynthesis", "photosynthesis " and "PHOTOSYNTHESIS" are the same board."""
    return " ".join(str(topic or "general").lower().split())[:100] or "general"


def board_key(topic, difficulty: str, doc_hash: str) -> str:
    return f"{norm_topic(topic)}|{difficulty}|{doc_hash}"


def grade_for(accuracy: int) -> str:
    for floor, grade in ((95, "S+"), (90, "S"), (80, "A"), (70, "B"), (60, "C"), (50, "D")):
        if accuracy >= floor:
            return grade
    return "F"


def gear_for(equipped: dict) -> dict:
    """What the equipped items do in a fight (the shop's `battle` fields), summed into one snapshot.
    Taken when the battle starts, so changing clothes mid-fight changes nothing."""
    from services.progression.catalog import flatten_catalog
    by_id = {it["id"]: it.get("battle") or {} for it in flatten_catalog()}
    worn = {slot: (equipped.get(slot) or (equipped.get("outfit_id") if slot == "armor" else "")) or "" for slot in GEAR_SLOTS}
    stats = [by_id.get(item_id, {}) for item_id in worn.values() if item_id]
    return {
        "items": {slot: item_id for slot, item_id in worn.items() if item_id},
        "damage_pct": round(sum(float(st.get("damage_pct", 0)) for st in stats), 4),
        "hp": sum(int(st.get("hp", 0)) for st in stats),
        "time_sec": sum(int(st.get("time_sec", 0)) for st in stats),
        "strike": sum(int(st.get("strike", 0)) for st in stats),
    }


def relics_of(boss: dict) -> set:
    """The Expedition relics this battle was started with (a snapshot, like the gear)."""
    return set((boss.get("mods") or {}).get("relics") or [])


def time_limit(boss: dict, move: Optional[str] = None) -> int:
    """Seconds a question lasts in this battle: the move's base (Jab is quick), plus what the hero's headgear adds,
    plus the Owl Feather relic."""
    base = MOVES.get(move or DEFAULT_MOVE, MOVES[DEFAULT_MOVE])["seconds"] or SECONDS_PER_QUESTION
    extra = OWL_FEATHER_SECONDS if "owl_feather" in relics_of(boss) else 0
    return base + int((boss.get("gear") or {}).get("time_sec", 0)) + extra


def question_limit(boss: dict, q: dict) -> int:
    """The time limit of one issued question: its move's, plus a Timewarp if one was cast on it."""
    return time_limit(boss, q.get("move")) + (TIMEWARP_SECONDS if q.get("timewarped") else 0)


def heavy_cost(boss: dict) -> int:
    return 1 if "whetstone" in relics_of(boss) else MOVES["heavy"]["cost"]


def move_cost(move: str, boss: dict) -> int:
    return heavy_cost(boss) if move == "heavy" else MOVES[move]["cost"]


def shield_factor(boss: dict) -> float:
    return 0.5 if "ink_bomb" in relics_of(boss) else 1.0


def week_start(now: Optional[datetime] = None) -> datetime:
    """Monday 00:00 UTC of the current week: when the weekly global boards start over."""
    now = now or _now()
    return (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def is_weakness(boss: dict, question: dict) -> bool:
    """The boss takes double damage from questions about its weakness."""
    weakness = str(boss.get("weakness") or "").strip().lower()
    concept = str(question.get("concept") or "").strip().lower()
    return bool(weakness and concept and (weakness in concept or concept in weakness))


def _err(code: str, message: str, status: int = 409, **details) -> AppError:
    return AppError(code, message, status_code=status, details=details or None)


class BattleService:
    def __init__(self, store, reward_service, buff_service, documents, mastery=None):
        self.store = store
        self.rewards = reward_service
        self.buffs = buff_service
        self.documents = documents
        self.mastery = mastery                           # MasteryService: every answer counts for its concept
        # Set by state.py to ExpeditionService.battle_ended: called INSIDE _end's transaction for run battles.
        self.on_run_battle_end = None
        self._tasks: Dict[tuple, asyncio.Task] = {}      # (battle_id, phase) -> the batch being generated
        self._flavor_tasks: set = set()                  # background boss-flavour calls (held so they aren't GC'd)
        self._flavor_running: set = set()                # battle ids whose flavour call is in flight

    # ═════════════════════════════ reading ══════════════════════════════════
    def _row(self, battle_id: str, user_id: str) -> Optional[dict]:
        # someone else's battle looks exactly like a missing one
        return self.store.fetchone("SELECT * FROM arena_battles WHERE id = ? AND user_id = ?",
                                   (str(battle_id), int(user_id)))

    def _need(self, battle_id: str, user_id: str) -> dict:
        row = self._row(battle_id, user_id)
        if not row:
            raise AppError("battle_not_found", "We couldn't find that battle.", status_code=404)
        return row

    def _question_row(self, battle_id: str, seq: int) -> Optional[dict]:
        return self.store.fetchone("SELECT * FROM arena_questions WHERE battle_id = ? AND seq = ?", (battle_id, seq))

    def state(self, b: dict) -> dict:
        """The battle as the browser may see it."""
        boss = json.loads(b["boss_json"])
        out = {
            "battle_id": b["id"], "status": b["status"], "session_id": b["session_id"], "topic": b["topic"],
            "difficulty": b["difficulty"], "phase": b["phase"], "rage": bool(boss.get("rage")),
            "boss": {"name": boss.get("name"), "hp": b["boss_hp"], "max_hp": b["boss_max_hp"],
                     "species": boss.get("species"), "title": boss.get("title"), "origin": boss.get("origin")},
            "player": {"hp": b["player_hp"], "max_hp": b["player_max_hp"]},
            "combo": b["combo"], "max_combo": b["max_combo"], "answered": b["answered"], "correct": b["correct"],
            "heals_used": b["heals_used"], "fifty_used": b["fifty_used"],
            "gear": boss.get("gear") or {},
            "mode": b["mode"], "run_id": b["run_id"],
            "focus": b["focus"], "focus_cap": b["focus_cap"], "shield": b["shield"],
            "intent": json.loads(b["intent_json"]) if b["intent_json"] and b["status"] == "active" else None,
            "relics": sorted(relics_of(boss)),
            "heavy_cost": heavy_cost(boss),
            # a question is out and its clock is running: a resumed screen goes straight back to it, not to a move choice
            "question_issued": b["status"] == "active" and b["current_seq"] is not None,
            "free_timewarp": "hourglass" in relics_of(boss) and not (boss.get("mods") or {}).get("hourglass_used"),
        }
        if b["status"] != "active":
            out["result"] = json.loads(b["result_json"] or "{}")
            out["rewards"] = json.loads(b["rewards_json"]) if b["rewards_json"] else None
        return out

    def public_boss(self, b: dict) -> dict:
        boss = json.loads(b["boss_json"])
        boss.pop("asked_concepts", None)
        return boss

    def public_question(self, q: dict, b: dict) -> dict:
        question = json.loads(q["question_json"])
        removed = json.loads(q["removed_json"] or "[]")
        options = [o for o in json.loads(q["options_json"]) if o not in removed]
        left = max(0.0, (_parse(q["deadline_at"]) - _now()).total_seconds())
        boss = json.loads(b["boss_json"])
        return {
            "id": q["seq"], "number": b["answered"] + 1, "question": question["question"], "options": options,
            "concept": question.get("concept"), "difficulty": question.get("difficulty"), "phase": q["phase"],
            "move": q["move"] or DEFAULT_MOVE, "tier": question_tier(question.get("difficulty"), b["difficulty"]),
            "weakness": is_weakness(boss, question), "fifty_used": bool(removed), "timewarped": bool(q["timewarped"]),
            "time_limit": question_limit(boss, q), "expires_at": q["deadline_at"], "seconds_left": round(left, 1),
        }

    def find_active(self, user_id: str, session_id: Optional[str] = None) -> Optional[dict]:
        """The battle in progress on a document - or, without one, the user's most recent one on any document."""
        row = self.store.fetchone(
            "SELECT * FROM arena_battles WHERE user_id = ? AND status = 'active'"
            + (" AND session_id = ?" if session_id else "") + " ORDER BY created_at DESC LIMIT 1",
            (int(user_id),) + ((session_id,) if session_id else ()))
        if row:
            self._settle(row["id"], user_id)
            row = self._row(row["id"], user_id)
        return row

    def get(self, user_id: str, battle_id: str) -> dict:
        """The battle after any overdue question has been settled (a refresh can't dodge a timeout)."""
        self._need(battle_id, user_id)
        self._settle(battle_id, user_id)
        return self._need(battle_id, user_id)

    # ═════════════════════════════ create ═══════════════════════════════════
    def create(self, user_id: str, session_id: str, doc_hash: str, topic: str, difficulty: str, boss: dict, *,
               mode: str = "quick", run_id: Optional[str] = None, hearts: Optional[int] = None,
               max_hearts: Optional[int] = None, mods: Optional[dict] = None, hp_scale: float = 1.0,
               target_concepts: Optional[List[str]] = None, focus_cap: int = FOCUS_CAP) -> dict:
        """A new battle. Quick / Nemesis battles take the hero's hearts from the gear; a run battle gets the run's
        hearts (`hearts` / `max_hearts`), its relics and per-run flags (`mods`) and maybe a tougher boss (`hp_scale`).
        A Nemesis boss remembers the concepts its questions must target."""
        boss = boss_brain.sanitize_boss(dict(boss), difficulty)            # HP stays inside the difficulty's range
        boss["max_hp"] = int(round(boss["max_hp"] * HP_PACING.get(difficulty, 2.6) * hp_scale))
        boss["difficulty"] = difficulty
        boss["current_hp"] = boss["max_hp"]
        equipped = json.loads(self.store.get_avatar(str(user_id)).get("equipped_json") or "{}")
        boss["gear"] = gear_for(equipped)
        mods = dict(mods or {})
        mods.setdefault("relics", [])
        mods.update(aegis_used=False, hourglass_used=False)
        boss["mods"] = mods
        if target_concepts:
            boss["target_concepts"] = list(target_concepts)
        if hearts is None:
            hearts = max_hearts = PLAYER_MAX_HP + boss["gear"]["hp"]
        boss.update(phase=1, rage=False, rounds_fought=0, total_damage_taken=0, total_damage_dealt=0, asked_concepts=[])
        focus = min(focus_cap, (FOCUS_CRYSTAL_START if "focus_crystal" in mods["relics"] else 0)
                    + int(mods.get("focus_bonus", 0)))
        intent = roll_intent(boss, difficulty, shield_factor(boss))
        now = _iso(_now())
        battle_id = uuid.uuid4().hex
        try:
            self.store.execute(
                "INSERT INTO arena_battles (id, user_id, session_id, doc_hash, topic, difficulty, board_key, boss_json, "
                "boss_hp, boss_max_hp, player_hp, player_max_hp, created_at, updated_at, mode, run_id, focus, focus_cap, "
                "intent_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (battle_id, int(user_id), session_id, doc_hash, topic, difficulty, board_key(topic, difficulty, doc_hash),
                 json.dumps(boss), boss["max_hp"], boss["max_hp"], hearts, max_hearts, now, now, mode, run_id, focus,
                 focus_cap, json.dumps(intent)))
        except sqlite3.IntegrityError:
            raise _err("battle_in_progress", "You already have a battle running for this document.")
        return self._need(battle_id, user_id)

    # ═════════════════════════════ questions ════════════════════════════════
    def _attempts(self, b: dict, phase: int) -> int:
        return int(b[f"gen_attempts_{1 if phase == 1 else 2}"])

    def _pool(self, battle_id: str, phase: int) -> int:
        return int(self.store.fetchone(
            "SELECT COUNT(*) AS n FROM arena_questions WHERE battle_id = ? AND phase = ? AND status = 'queued'",
            (battle_id, phase))["n"])

    def _store_batch(self, battle_id: str, phase: int, questions: List[dict]) -> int:
        """Add a generated batch to the pool, one question per concept (and never the same text twice)."""
        with self.store.transaction():
            battle = self.store.fetchone("SELECT boss_json, difficulty FROM arena_battles WHERE id = ?", (battle_id,))
            # a Nemesis (a Nemesis battle or an Expedition nemesis node) asks its few concepts again, on purpose
            nemesis = bool(battle and json.loads(battle["boss_json"]).get("target_concepts"))
            rows = self.store.fetchall("SELECT concept_key, text_key FROM arena_questions WHERE battle_id = ?", (battle_id,))
            concepts, texts = {r["concept_key"] for r in rows}, {r["text_key"] for r in rows}
            nxt = len(rows) + 1
            fresh, repeats = [], []
            for q in questions:
                q = {**q, "difficulty": question_tier(q.get("difficulty"), battle["difficulty"] if battle else "medium")}
                text_key = question_key(str(q.get("question", "")))
                concept_key = question_key(str(q.get("concept", ""))) or text_key
                if not text_key or text_key in texts:
                    continue
                (repeats if concept_key in concepts and not nemesis else fresh).append((concept_key, text_key, q))
                concepts.add(concept_key)
                texts.add(text_key)
            # a batch made only of already-asked concepts is better than an empty pool
            chosen = fresh or repeats
            for concept_key, text_key, q in chosen:
                self.store.execute(
                    "INSERT INTO arena_questions (battle_id, seq, phase, concept_key, text_key, question_json) "
                    "VALUES (?, ?, ?, ?, ?, ?)", (battle_id, nxt, phase, concept_key, text_key, json.dumps(q)))
                nxt += 1
            col = f"gen_attempts_{1 if phase == 1 else 2}"
            self.store.execute(f"UPDATE arena_battles SET {col} = {col} + 1 WHERE id = ?", (battle_id,))
            return len(chosen)

    async def _fill_once(self, battle_id: str, user_id: str, phase: int, force: bool = False) -> Optional[BaseException]:
        """Generate ONE batch for a phase. Returns the failure instead of raising, so a background run can't
        leave an unretrieved exception behind; whoever waits for the pool decides what to do with it.
        The per-phase budget bounds background prefetching; `force` (a player asking again after the budget is
        spent) goes past it - one batch per request."""
        try:
            b = await asyncio.to_thread(self._row, battle_id, user_id)
            if not b or b["status"] != "active" or (self._attempts(b, phase) >= MAX_BATCHES_PER_PHASE and not force):
                return None
            vector_store = await self.documents.get_index(b["session_id"], int(user_id))
            if not vector_store:
                return AppError("session_expired", "Your document session has expired. Please upload your PDF again.",
                                status_code=400, action="reupload")
            asked = await asyncio.to_thread(
                lambda: [json.loads(r["question_json"]).get("concept") or "" for r in self.store.fetchall(
                    "SELECT question_json FROM arena_questions WHERE battle_id = ?", (battle_id,))])
            targets = json.loads(b["boss_json"]).get("target_concepts") or []
            quiz = await boss_brain.generate_battle_quiz_async(
                vector_store, b["topic"], difficulty=b["difficulty"], num_questions=BATCH_SIZE,
                asked_concepts=[c for c in asked if c], phase=phase,
                **({"target_concepts": targets} if targets else {}))
            await asyncio.to_thread(self._store_batch, battle_id, phase, quiz.get("questions", []))
            return None
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("arena battle %s: generating phase %s questions failed: %s", battle_id, phase, exc)
            return exc

    def _task_for(self, battle_id: str, user_id: str, phase: int) -> asyncio.Task:
        key = (battle_id, phase)
        task = self._tasks.get(key)
        if task is None or task.done():
            task = asyncio.get_running_loop().create_task(self._fill_once(battle_id, user_id, phase))
            self._tasks[key] = task
            task.add_done_callback(lambda t, k=key: self._tasks.pop(k, None) if self._tasks.get(k) is t else None)
        return task

    async def _forced_batch(self, battle_id: str, user_id: str, phase: int) -> Optional[BaseException]:
        try:
            return await asyncio.wait_for(self._fill_once(battle_id, user_id, phase, force=True),
                                          timeout=GENERATION_WAIT_SECONDS)
        except asyncio.TimeoutError:
            return TimeoutError("question generation took too long")

    def enrich(self, battle_id: str, user_id: str) -> None:
        """Write the boss's topic-specific lines in the background (boss_brain.boss_flavor_async). The fight never
        waits for it: until it lands - or if it fails - the creature's own lines are used. Never raises."""
        if battle_id in self._flavor_running:          # already being written (a resume while it runs)
            return

        async def _run():
            self._flavor_running.add(battle_id)
            try:
                b = await asyncio.to_thread(self._row, battle_id, user_id)
                if not b or b["status"] != "active":
                    return
                vector_store = await self.documents.get_index(b["session_id"], int(user_id))
                if not vector_store:
                    return
                boss = json.loads(b["boss_json"])
                flavor = await boss_brain.boss_flavor_async(vector_store, boss.get("species") or "", b["topic"])
                await asyncio.to_thread(self._apply_flavor, battle_id, flavor)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.info("arena battle %s: boss flavour skipped (%s)", battle_id, type(exc).__name__)
            finally:
                self._flavor_running.discard(battle_id)
        try:
            task = asyncio.get_running_loop().create_task(_run())
        except RuntimeError:                 # no running loop: the creature's own lines will do
            return
        self._flavor_tasks.add(task)
        task.add_done_callback(self._flavor_tasks.discard)

    def _apply_flavor(self, battle_id: str, flavor: dict) -> None:
        with self.store.transaction():
            row = self.store.fetchone("SELECT status, boss_json FROM arena_battles WHERE id = ?", (battle_id,))
            if not row or row["status"] != "active":
                return
            boss = boss_brain.merge_flavor(json.loads(row["boss_json"]), flavor)
            self.store.execute("UPDATE arena_battles SET boss_json = ? WHERE id = ?", (json.dumps(boss), battle_id))

    def prefetch(self, battle_id: str, user_id: str) -> None:
        """Background batches: phase 1 first, then phase 2 (so the rage phase never waits), and a top-up when the
        pool for the current phase runs low. Never blocks and never raises."""
        try:
            b = self._row(battle_id, user_id)
            if not b or b["status"] != "active":
                return
            phase = b["phase"]
            if self._pool(battle_id, phase) <= LOW_WATER and self._attempts(b, phase) < MAX_BATCHES_PER_PHASE:
                self._task_for(battle_id, user_id, phase)
            if phase == 1 and self._attempts(b, 2) == 0 and self._pool(battle_id, 1) > 0:
                self._task_for(battle_id, user_id, 2)
            elif phase == 1 and self._attempts(b, 1) == 0:
                t = self._task_for(battle_id, user_id, 1)
                t.add_done_callback(lambda _t: self.prefetch(battle_id, user_id))
        except RuntimeError:        # no running loop (called from a worker thread): the next request will do it
            pass

    def _pick(self, battle_id: str, phase: int, tier: str, difficulty: str) -> Optional[dict]:
        """The first queued question of the phase in the wanted tier - or, when there is none, the nearest tier."""
        queued = self.store.fetchall(
            "SELECT * FROM arena_questions WHERE battle_id = ? AND phase = ? AND status = 'queued' ORDER BY seq",
            (battle_id, phase))
        for wanted in TIER_ORDER[tier]:
            for q in queued:
                if question_tier(json.loads(q["question_json"]).get("difficulty"), difficulty) == wanted:
                    return q
        return None

    def _issue_next(self, battle_id: str, user_id: str, move: str = DEFAULT_MOVE) -> Optional[dict]:
        """Hand out the next queued question of the current phase for this move: its tier (or the nearest one),
        options shuffled, the move's deadline started and its Focus paid. A question already out is returned as
        it is (its move was fixed when it was issued)."""
        with self.store.transaction():
            b = self._need(battle_id, user_id)
            if b["status"] != "active":
                return None
            if b["current_seq"] is not None:
                return self._question_row(battle_id, b["current_seq"])
            boss = json.loads(b["boss_json"])
            cost = move_cost(move, boss)
            if b["focus"] < cost:
                raise _err("not_enough_focus", f"{move.title()} needs {cost} Focus.", focus=b["focus"], cost=cost)
            q = self._pick(battle_id, b["phase"], MOVES[move]["tier"], b["difficulty"])
            if not q:
                return None
            options = list(json.loads(q["question_json"])["options"])
            random.shuffle(options)
            now = _now()
            self.store.execute(
                "UPDATE arena_questions SET status = 'issued', options_json = ?, issued_at = ?, deadline_at = ?, move = ? "
                "WHERE battle_id = ? AND seq = ? AND status = 'queued'",
                (json.dumps(options), _iso(now), _iso(now + timedelta(seconds=time_limit(boss, move))), move,
                 battle_id, q["seq"]))
            self.store.execute("UPDATE arena_battles SET current_seq = ?, focus = focus - ?, updated_at = ? WHERE id = ?",
                               (q["seq"], cost, _iso(now), battle_id))
            return self._question_row(battle_id, q["seq"])

    async def next_question(self, user_id: str, battle_id: str, move: Optional[str] = None) -> dict:
        """{"battle", "question" (None when the battle is over), "previous" (a timeout settled on the way)}.
        `move` decides the next question's tier / time / cost; None is a strike (what older clients get)."""
        move = move or DEFAULT_MOVE
        if move not in MOVES:
            raise AppError("invalid_move", f"Move must be one of: {', '.join(MOVES)}.", status_code=400)
        await asyncio.to_thread(self._need, battle_id, user_id)               # 404 for someone else's battle
        settled = await asyncio.to_thread(self._settle, battle_id, user_id)
        failures = 0
        for _ in range(MAX_BATCHES_PER_PHASE + 1):
            b = await asyncio.to_thread(self._need, battle_id, user_id)
            if b["status"] != "active":
                return {"battle": self.state(b), "question": None, "previous": settled}
            q = await asyncio.to_thread(self._issue_next, battle_id, user_id, move)
            if q:
                b = await asyncio.to_thread(self._need, battle_id, user_id)
                self.prefetch(battle_id, user_id)
                return {"battle": self.state(b), "question": self.public_question(q, b), "previous": settled}
            if self._attempts(b, b["phase"]) >= MAX_BATCHES_PER_PHASE:
                # The budget is spent and the pool is empty: that is LLM trouble (empty / duplicate batches), and
                # LLM trouble never decides a fight - neither side wins by default. Try ONE more batch for this
                # request; if it brings nothing, the caller gets a retryable error and the battle stays as it is
                # (the player may retry or forfeit; MAX_ANSWERS still bounds the fight).
                waited = await self._forced_batch(battle_id, user_id, b["phase"])
                if await asyncio.to_thread(self._pool, battle_id, b["phase"]) > 0:
                    continue
                if isinstance(waited, AppError):
                    raise waited
                raise GenerationUnavailable(waited or RuntimeError("no usable questions were generated"))
            task = self._task_for(battle_id, user_id, b["phase"])
            try:
                waited = await asyncio.wait_for(asyncio.shield(task), timeout=GENERATION_WAIT_SECONDS)
            except asyncio.TimeoutError:
                raise GenerationUnavailable(TimeoutError("question generation took too long"))
            if waited is not None and await asyncio.to_thread(self._pool, battle_id, b["phase"]) == 0:
                failures += 1
                if isinstance(waited, AppError):
                    raise waited
                if failures >= 2:           # one retry: the run we waited on may have been an old background one
                    raise GenerationUnavailable(waited)
        raise GenerationUnavailable(RuntimeError("no usable questions were generated"))

    # ═════════════════════════════ answering ════════════════════════════════
    def _ensure_intent(self, b: dict) -> dict:
        """A battle started before Arena v2 has no telegraphed intent: roll one and store it (compare-and-set), so
        what the player is shown is exactly what resolves."""
        boss = json.loads(b["boss_json"])
        intent = roll_intent(boss, b["difficulty"], shield_factor(boss))
        self.store.execute("UPDATE arena_battles SET intent_json = ? WHERE id = ? AND intent_json IS NULL",
                           (json.dumps(intent), b["id"]))
        return self.store.fetchone("SELECT * FROM arena_battles WHERE id = ?", (b["id"],))

    def _settle(self, battle_id: str, user_id: str) -> Optional[dict]:
        """An issued question whose deadline (plus grace) has passed is a wrong answer. Returns its outcome.
        Every read of a battle comes through here, which is also where a pre-v2 battle gets its first intent."""
        with self.store.transaction():
            b = self._row(battle_id, user_id)
            if b and b["status"] == "active" and not b["intent_json"]:
                b = self._ensure_intent(b)
            if not b or b["status"] != "active" or b["current_seq"] is None:
                return None
            q = self._question_row(battle_id, b["current_seq"])
            if q["status"] != "issued":
                return None
            if _now() <= _parse(q["deadline_at"]) + timedelta(seconds=DEADLINE_GRACE_SECONDS):
                return None
            return self._resolve(b, q, None, timed_out=True)

    def answer(self, user_id: str, battle_id: str, question_id: int, answer: str) -> dict:
        with self.store.transaction():
            b = self._need(battle_id, user_id)
            q = self._question_row(battle_id, question_id)
            if q is None:
                raise AppError("question_not_found", "That question isn't part of this battle.", status_code=404)
            if q["status"] == "answered":                       # a replay: first answer wins, nothing changes
                return {**json.loads(q["outcome_json"]), "ok": True, "replayed": True,
                        "battle": self.state(b), "rewards": None}
            if b["status"] != "active":
                raise _err("battle_finished", "That battle is over.")
            if q["status"] != "issued" or b["current_seq"] != q["seq"]:
                raise _err("question_not_current", "Ask for the next question before answering it.")

            late = _now() > _parse(q["deadline_at"]) + timedelta(seconds=DEADLINE_GRACE_SECONDS)
            picked = None
            if not late:
                visible = [o for o in json.loads(q["options_json"]) if o not in json.loads(q["removed_json"] or "[]")]
                picked = next((o for o in visible if same_answer(o, answer)), None)
                if picked is None:
                    raise AppError("invalid_answer", "Pick one of the answer options.", status_code=400)
            outcome = self._resolve(b, q, picked, timed_out=late)
            b = self._need(battle_id, user_id)
            rewards = json.loads(b["rewards_json"]) if b["rewards_json"] else None
            return {**outcome, "ok": True, "replayed": False, "battle": self.state(b), "rewards": rewards}

    def _resolve(self, b: dict, q: dict, picked: Optional[str], timed_out: bool) -> dict:
        """Grade one issued question and resolve the turn both ways. Runs inside the caller's transaction.

        Player:  a right answer hits for apply_player_attack's damage (combo) x weakness (x2, Scholar's Lens x3)
                 x the move (strike 1, jab 0.6, heavy 1.8, guard 0), + gear; the boss's shield absorbs it unless
                 it was a weakness hit. Focus +1 (+1 more for jab - Quill: +2 - and guard), capped.
        Boss:    the telegraphed intent - attack / heavy: a miss takes it all, a right answer half (floor), a right
                 guard nothing; shield: the boss gains it; drain: a miss loses all Focus; heal: the boss heals
                 unless a right strike / heavy interrupts it. Aegis, Phoenix Ash and the Vampiric Tome act here.
        Then the next intent is rolled from the (maybe new) phase."""
        battle_id, user_id = b["id"], b["user_id"]
        question = json.loads(q["question_json"])
        boss = json.loads(b["boss_json"])
        mods = boss.setdefault("mods", {})
        relics = relics_of(boss)
        move = q["move"] or DEFAULT_MOVE
        intent = json.loads(b["intent_json"]) if b["intent_json"] else make_intent("attack", boss, b["difficulty"])
        correct = bool(picked is not None and not timed_out and same_answer(picked, question["correct_answer"]))
        correct_option = next((o for o in json.loads(q["options_json"]) if same_answer(o, question["correct_answer"])),
                              question["correct_answer"])

        combo, phase_changed = b["combo"], False
        focus, shield, focus_cap = b["focus"], b["shield"], b["focus_cap"]
        dealt = taken = absorbed = healed = drained = lifesteal = 0
        hit_type = None
        gear_bonus = pet_strike = focus_gained = 0
        blocked = interrupted = aegis = revived = False
        weak = is_weakness(boss, question)

        # ── the player's hit ──
        if correct:
            combo += 1
            hit = player_hit(boss, combo)
            dealt, hit_type = hit["damage"], hit["hit_type"]
            if weak:
                dealt *= 3 if "scholar_lens" in relics else 2
            dealt = int(dealt * MOVES[move]["mult"])
            if dealt > 0:                                        # gear rides on a real hit only (not on a guard)
                gear = boss.get("gear") or {}
                weapon_bonus = int(round(dealt * float(gear.get("damage_pct", 0))))     # the weapon
                pet_strike = int(gear.get("strike", 0)) if combo >= 3 else 0            # the pet, on a hot streak
                gear_bonus = weapon_bonus + pet_strike
                dealt += gear_bonus
            if shield and dealt and not weak:                    # weakness hits ignore shields
                absorbed = min(shield, dealt)
                shield -= absorbed
                dealt -= absorbed
            boss["current_hp"] = max(0, boss["current_hp"] - dealt)
            boss["total_damage_taken"] = boss.get("total_damage_taken", 0) + dealt
            boss["rounds_fought"] = boss.get("rounds_fought", 0) + 1
            if boss["current_hp"] < boss["max_hp"] * boss.get("rage_threshold", 0.4) and boss.get("phase", 1) == 1:
                boss["phase"], boss["rage"], phase_changed = 2, True, True
            gain = 1 + (1 if move == "guard" else 0) + ((2 if "quill" in relics else 1) if move == "jab" else 0)
            focus_gained = min(focus_cap, focus + gain) - focus
            focus += focus_gained
            if "vampiric_tome" in relics and combo % VAMPIRIC_COMBO == 0:
                lifesteal = 1
        else:
            combo = 0

        # ── the boss's intent ──
        attack_name = None
        if boss["current_hp"] > 0:
            kind = intent.get("kind")
            if kind in ("attack", "heavy"):
                value = int(intent.get("value", 0))
                attack_name = intent.get("name")
                if correct and move == "guard":
                    taken, blocked = 0, True
                else:
                    taken = value // 2 if correct else value
            elif kind == "shield":
                shield += int(intent.get("value", 0))
            elif kind == "drain" and not correct:
                drained, focus = focus, 0
            elif kind == "heal":
                if correct and move in INTERRUPTING_MOVES:
                    interrupted = True
                else:
                    amount = int(intent.get("amount") or round(boss["max_hp"] * int(intent.get("value", 0)) / 100))
                    healed = max(0, min(amount, boss["max_hp"] - boss["current_hp"]))
                    boss["current_hp"] += healed
            if not correct and taken > 0 and "aegis" in relics and not mods.get("aegis_used"):
                taken, aegis, mods["aegis_used"] = 0, True, True
            boss["total_damage_dealt"] = boss.get("total_damage_dealt", 0) + taken
            taunt = boss_taunt(boss, "phase_change" if phase_changed else "hit") if correct else boss_taunt(boss, "miss")
        else:
            taunt = boss_taunt(boss, "defeat")

        player_hp = max(0, min(b["player_max_hp"], b["player_hp"] + lifesteal) - taken)
        if player_hp <= 0 and "phoenix_ash" in relics and not mods.get("phoenix_used"):
            player_hp, revived, mods["phoenix_used"] = min(PHOENIX_HEARTS, b["player_max_hp"]), True, True
        answered = b["answered"] + 1
        over = boss["current_hp"] <= 0 or player_hp <= 0 or answered >= MAX_ANSWERS
        next_intent = None if over else roll_intent(boss, b["difficulty"], shield_factor(boss))
        now = _now()
        spent = min((now - _parse(q["issued_at"])).total_seconds(), question_limit(boss, q))
        outcome = {
            "question_id": q["seq"], "correct": correct, "timed_out": bool(timed_out), "answer": picked,
            "correct_answer": correct_option, "explanation": question.get("explanation") or None,
            "move": move, "tier": question_tier(question.get("difficulty"), b["difficulty"]),
            "damage_dealt": dealt, "hit_type": hit_type, "weakness": bool(weak and correct),
            "damage_taken": taken, "attack_name": attack_name, "taunt": taunt, "phase_changed": phase_changed,
            "combo": combo, "gear_bonus": gear_bonus, "pet_strike": pet_strike,
            "intent": intent, "next_intent": next_intent, "blocked": blocked, "interrupted": interrupted,
            "shield_absorbed": absorbed, "boss_healed": healed, "focus": focus, "focus_gained": focus_gained,
            "focus_drained": drained, "aegis": aegis, "revived": revived, "lifesteal": lifesteal,
        }
        self.store.execute(
            "UPDATE arena_questions SET status = 'answered', answer = ?, correct = ?, timed_out = ?, answered_at = ?, "
            "outcome_json = ? WHERE battle_id = ? AND seq = ? AND status = 'issued'",
            (picked, int(correct), int(timed_out), _iso(now), json.dumps(outcome), battle_id, q["seq"]))
        self.store.execute(
            "UPDATE arena_battles SET boss_json = ?, boss_hp = ?, player_hp = ?, phase = ?, combo = ?, max_combo = ?, "
            "answered = ?, correct = correct + ?, active_ms = active_ms + ?, current_seq = NULL, focus = ?, shield = ?, "
            "intent_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(boss), boss["current_hp"], player_hp, boss.get("phase", 1), combo, max(b["max_combo"], combo),
             answered, int(correct), int(spent * 1000), focus, shield,
             json.dumps(next_intent) if next_intent else b["intent_json"], _iso(now), battle_id))
        if self.mastery is not None:                              # once per question: this runs once per question
            self.mastery.record(user_id, b["doc_hash"], question.get("concept"), correct, source="arena",
                                question={"question": question.get("question"), "correct_answer": correct_option,
                                          "explanation": question.get("explanation")})

        if boss["current_hp"] <= 0:
            self._end(user_id, battle_id, "won")
        elif player_hp <= 0 or answered >= MAX_ANSWERS:
            self._end(user_id, battle_id, "lost")
        return outcome

    # ═════════════════════════════ finishing ════════════════════════════════
    def missed(self, battle_id: str) -> List[dict]:
        """The battle's "loot": every question it got wrong (or ran out of time on), with the answer to learn."""
        out = []
        for r in self.store.fetchall("SELECT question_json, options_json FROM arena_questions "
                                     "WHERE battle_id = ? AND status = 'answered' AND correct = 0 ORDER BY seq",
                                     (battle_id,)):
            q = json.loads(r["question_json"])
            shown = json.loads(r["options_json"] or "[]")
            right = next((o for o in shown if same_answer(o, q["correct_answer"])), q["correct_answer"])
            out.append({"concept": q.get("concept") or None, "question": q.get("question"), "correct_answer": right,
                        "explanation": q.get("explanation") or None})
        return out

    def _end(self, user_id, battle_id: str, status: str) -> Optional[dict]:
        """Finish a battle ONCE: status, rewards, leaderboard row and personal best commit together.
        A run battle pays nothing here - its end goes to on_run_battle_end in this same transaction."""
        with self.store.transaction():
            b = self._need(battle_id, user_id)
            if b["status"] != "active":
                return None
            now = _iso(_now())
            if self.store.execute(
                    "UPDATE arena_battles SET status = ?, finished_at = ?, updated_at = ?, current_seq = NULL "
                    "WHERE id = ? AND status = 'active'", (status, now, now, battle_id)) != 1:
                return None
            accuracy = round(100 * b["correct"] / b["answered"]) if b["answered"] else 0
            seconds = max(1, round(b["active_ms"] / 1000))
            grade = grade_for(accuracy)
            uid = str(user_id)
            paid = {"arena_round_complete": None, "boss_defeat": None}
            ratio = accuracy / 100
            missed = self.missed(battle_id)
            if b["run_id"]:
                result = {"grade": grade, "accuracy": accuracy, "time_seconds": seconds, "new_personal_best": False,
                          "missed": missed}
                if self.on_run_battle_end is not None:
                    result["run"] = self.on_run_battle_end({**b, "status": status}, status)
                self.store.execute("UPDATE arena_battles SET rewards_json = ?, result_json = ? WHERE id = ?",
                                   (json.dumps(paid), json.dumps(result), battle_id))
                return paid
            if b["answered"] >= ROUND_SIZE:
                paid["arena_round_complete"] = self.rewards.award(
                    uid, "arena_round_complete", accuracy=ratio, difficulty=1.5 if b["phase"] == 2 else 1.2,
                    combo_count=max(b["max_combo"], 1), source_id=battle_id)
            result = {"grade": grade, "accuracy": accuracy, "time_seconds": seconds, "new_personal_best": False,
                      "missed": missed}
            if status == "won":
                paid["boss_defeat"] = self.rewards.award(
                    uid, "boss_defeat", accuracy=ratio, difficulty=BOSS_DEFEAT_DIFFICULTY.get(b["difficulty"], 1.2),
                    combo_count=max(b["max_combo"], 1), source_id=battle_id)
                result["new_personal_best"] = self._record_score(b, grade, accuracy, seconds, now)
            self.store.execute("UPDATE arena_battles SET rewards_json = ?, result_json = ? WHERE id = ?",
                               (json.dumps(paid), json.dumps(result), battle_id))
            return paid

    def _record_score(self, b: dict, grade: str, accuracy: int, seconds: int, now: str) -> bool:
        user = self.store.fetchone("SELECT username FROM users WHERE id = ?", (b["user_id"],))
        username = (user or {}).get("username") or str(b["user_id"])[:8]
        self.store.execute(
            "INSERT OR IGNORE INTO arena_scores (battle_id, board_key, user_id, username, topic, topic_key, difficulty, "
            "doc_hash, grade, accuracy, time_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (b["id"], b["board_key"], b["user_id"], username, b["topic"], norm_topic(b["topic"]), b["difficulty"],
             b["doc_hash"], grade, accuracy, seconds, now))
        return self.store.execute(
            "INSERT INTO arena_personal_bests (user_id, board_key, battle_id, grade, accuracy, time_seconds, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, board_key) DO UPDATE SET battle_id = excluded.battle_id, "
            "grade = excluded.grade, accuracy = excluded.accuracy, time_seconds = excluded.time_seconds, "
            "updated_at = excluded.updated_at WHERE excluded.accuracy > accuracy "
            "OR (excluded.accuracy = accuracy AND excluded.time_seconds < time_seconds)",
            (b["user_id"], b["board_key"], b["id"], grade, accuracy, seconds, now)) == 1

    def forfeit(self, user_id: str, battle_id: str) -> dict:
        """Retreat. The battle is lost (and pays what its answered round earned); doing it twice changes nothing."""
        self._need(battle_id, user_id)
        self._settle(battle_id, user_id)
        with self.store.transaction():
            self._end(user_id, battle_id, "lost")
            b = self._need(battle_id, user_id)
            return {"ok": True, "battle": self.state(b),
                    "rewards": json.loads(b["rewards_json"]) if b["rewards_json"] else None}

    # ═════════════════════════════ items ════════════════════════════════════
    def stock(self, user_id: str) -> dict:
        uid = str(user_id)
        return {"heal": self.store.get_inventory_quantity(uid, HEAL_ITEM) + self.buffs.get_heal_count(uid),
                "fifty_fifty": self.store.get_inventory_quantity(uid, FIFTY_ITEM) + self.buffs.get_fifty_fifty_count(uid)}

    def _consume(self, user_id: str, item: str) -> bool:
        """Take ONE charge the user really holds: an activated charge first, then the inventory."""
        uid = str(user_id)
        if item == "heal":
            return bool(self.buffs.consume_heal(uid)) or self.store.consume_inventory_item(uid, HEAL_ITEM)
        if self.buffs.get_fifty_fifty_count(uid) > 0:
            self.buffs.consume_fifty_fifty_charge(uid)
            return True
        return self.store.consume_inventory_item(uid, FIFTY_ITEM)

    def use_item(self, user_id: str, battle_id: str, item: str) -> dict:
        if item not in ITEMS:
            raise AppError("invalid_item", "Unknown item.", status_code=400)
        self._need(battle_id, user_id)
        self._settle(battle_id, user_id)          # its own transaction: an overdue question is settled even if this call is refused
        with self.store.transaction():
            b = self._need(battle_id, user_id)
            if b["status"] != "active":
                raise _err("battle_finished", "That battle is over.")
            question = None
            if item == "heal":
                if b["player_hp"] >= b["player_max_hp"]:
                    raise _err("hp_full", "Your hearts are already full.")
                if not self._consume(user_id, "heal"):
                    raise _err("no_stock", "You don't have a health potion.")
                self.store.execute(
                    "UPDATE arena_battles SET player_hp = player_hp + 1, heals_used = heals_used + 1, updated_at = ? WHERE id = ?",
                    (_iso(_now()), battle_id))
            else:
                q = self._question_row(battle_id, b["current_seq"]) if b["current_seq"] is not None else None
                if q is None or q["status"] != "issued":
                    raise _err("no_question", "There is no question to use that on.")
                if q["removed_json"]:
                    raise _err("already_used", "You already used 50/50 on this question.")
                if not self._consume(user_id, "fifty_fifty"):
                    raise _err("no_stock", "You don't have a 50/50 charge.")
                correct = json.loads(q["question_json"])["correct_answer"]
                wrong = [o for o in json.loads(q["options_json"]) if not same_answer(o, correct)]
                hidden = random.sample(wrong, min(2, len(wrong)))
                self.store.execute("UPDATE arena_questions SET removed_json = ? WHERE battle_id = ? AND seq = ?",
                                   (json.dumps(hidden), battle_id, q["seq"]))
                self.store.execute("UPDATE arena_battles SET fifty_used = fifty_used + 1, updated_at = ? WHERE id = ?",
                                   (_iso(_now()), battle_id))
            b = self._need(battle_id, user_id)
            if item == "fifty_fifty":
                question = self.public_question(self._question_row(battle_id, b["current_seq"]), b)
            return {"ok": True, "item": item, "battle": self.state(b), "question": question,
                    "stock": self.stock(user_id)}

    # ═════════════════════════════ spells ═══════════════════════════════════
    def cast_spell(self, user_id: str, battle_id: str, spell: str) -> dict:
        """insight (remove two wrong options) / timewarp (+15 s) on the open question, paid with Focus.
        Each works once per question; the Hourglass relic makes the battle's first timewarp free."""
        if spell not in SPELLS:
            raise AppError("invalid_spell", f"Spell must be one of: {', '.join(SPELLS)}.", status_code=400)
        self._need(battle_id, user_id)
        self._settle(battle_id, user_id)          # an overdue question is settled first: no spell can rescue it
        with self.store.transaction():
            b = self._need(battle_id, user_id)
            if b["status"] != "active":
                raise _err("battle_finished", "That battle is over.")
            q = self._question_row(battle_id, b["current_seq"]) if b["current_seq"] is not None else None
            if q is None or q["status"] != "issued":
                raise _err("no_question", "There is no question to cast that on.")
            if _now() > _parse(q["deadline_at"]):
                # the grace period is network slack for an ANSWER: a spell can't bring a run-out clock back
                raise _err("question_expired", "Time is up for that question.")
            boss = json.loads(b["boss_json"])
            mods = boss.setdefault("mods", {})
            cost = SPELLS[spell]
            if spell == "insight" and q["removed_json"]:
                raise _err("already_used", "Two wrong answers are already gone from this question.")
            if spell == "timewarp":
                if q["timewarped"]:
                    raise _err("already_used", "You already bent time on this question.")
                if "hourglass" in relics_of(boss) and not mods.get("hourglass_used"):
                    cost, mods["hourglass_used"] = 0, True
            if b["focus"] < cost:
                raise _err("not_enough_focus", f"{spell.title()} needs {cost} Focus.", focus=b["focus"], cost=cost)
            if spell == "insight":
                correct = json.loads(q["question_json"])["correct_answer"]
                wrong = [o for o in json.loads(q["options_json"]) if not same_answer(o, correct)]
                self.store.execute("UPDATE arena_questions SET removed_json = ? WHERE battle_id = ? AND seq = ?",
                                   (json.dumps(random.sample(wrong, min(2, len(wrong)))), battle_id, q["seq"]))
            else:
                deadline = _parse(q["deadline_at"]) + timedelta(seconds=TIMEWARP_SECONDS)
                self.store.execute("UPDATE arena_questions SET deadline_at = ?, timewarped = 1 "
                                   "WHERE battle_id = ? AND seq = ?", (_iso(deadline), battle_id, q["seq"]))
            self.store.execute("UPDATE arena_battles SET focus = focus - ?, boss_json = ?, updated_at = ? WHERE id = ?",
                               (cost, json.dumps(boss), _iso(_now()), battle_id))
            b = self._need(battle_id, user_id)
            return {"ok": True, "spell": spell, "cost": cost, "battle": self.state(b),
                    "question": self.public_question(self._question_row(battle_id, q["seq"]), b)}

    # ═════════════════════════════ leaderboard ══════════════════════════════
    def leaderboard(self, user_id: str, topic: str, difficulty: str, doc_hash: Optional[str] = None,
                    scope: str = "topic") -> List[dict]:
        """Best result of each player on the board, best first.
        scope="topic":  topic + difficulty [+ document] (all time).
        scope="global": this week's wins at this difficulty on ANY topic and document - never empty for long."""
        if scope == "global":
            where, params = "WHERE difficulty = ? AND created_at >= ?", (difficulty, _iso(week_start()))
        else:
            where = "WHERE topic_key = ? AND difficulty = ?" + (" AND doc_hash = ?" if doc_hash else "")
            params = (norm_topic(topic), difficulty) + ((doc_hash,) if doc_hash else ())
        sql = ("SELECT * FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY user_id "
               "ORDER BY accuracy DESC, time_seconds ASC, created_at ASC) AS rn FROM arena_scores s "
               + where + ") WHERE rn = 1 ORDER BY accuracy DESC, time_seconds ASC, created_at ASC LIMIT 100")
        out = []
        for i, r in enumerate(self.store.fetchall(sql, params)):
            entry = {"rank": i + 1, "username": r["username"], "grade": r["grade"], "accuracy": r["accuracy"],
                     "time": r["time_seconds"], "date": r["created_at"][:10], "is_me": str(r["user_id"]) == str(user_id)}
            if scope == "global":
                entry["topic"] = r["topic"]
            out.append(entry)
        return out
