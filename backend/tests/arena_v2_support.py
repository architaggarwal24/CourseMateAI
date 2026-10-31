"""Shared fakes, fixtures and helpers for the Arena v2 tests (tactical turns, mastery/Nemesis, Expedition).

Import the fixtures you need by name into a test module (pytest picks fixtures up from module globals)."""
import json
import time

import pytest

import state
from core_brains import boss_brain
from services import arena_service
from test_api import upload

SID = "66666666-6666-4666-8666-666666666666"
SID_OTHER = "88888888-8888-4888-8888-888888888888"
TIERS = ("easy", "medium", "hard", "medium", "easy", "hard")


class FakeLLM:
    """Boss persona, battle quiz (questions in every tier) and Expedition acts - offline and countable."""

    def __init__(self):
        self.calls = []                    # (phase, asked, kwargs) per quiz call
        self.persona_calls = []
        self.act_calls = 0
        self.per_batch = 6
        self.tiers = TIERS
        self.concept = None                # callable(phase, n, i) -> concept text
        self.boss_hp = 160
        self.weakness = "unrelated weakness"
        self.fail_acts = False
        self.empty = None                  # callable(phase, call_number) -> bool: a batch with no usable questions
        self.acts_out = [{"title": "Act One", "topic": "cell structure"},
                         {"title": "Act Two", "topic": "cell division"},
                         {"title": "Act Three", "topic": "genetics"}]

    async def boss(self, vector_store, topic, difficulty="hard"):
        self.persona_calls.append((topic, difficulty))
        return {"name": f"Boss of {topic}", "title": "Keeper", "tagline": "t", "personality": "p",
                "conceptual_core": "c", "max_hp": self.boss_hp, "rage_threshold": 0.4, "special_ability": "Doom",
                "weakness": self.weakness, "attack_names": ["Slam"], "intro_taunt": "Hello",
                "phase1_taunts": ["p1"], "phase2_taunts": ["p2"], "hit_taunts": ["ouch"], "miss_taunts": ["haha"],
                "defeat_taunt": "argh"}

    async def quiz(self, vector_store, topic, difficulty="normal", num_questions=5, asked_concepts=None, phase=1,
                   **kwargs):
        self.calls.append((phase, list(asked_concepts or []), kwargs))
        n = len(self.calls)
        targets = kwargs.get("target_concepts") or []
        if self.empty and self.empty(phase, n):
            return {"questions": []}
        qs = []
        for i in range(self.per_batch):
            if targets:
                concept = targets[i % len(targets)]
            else:
                concept = self.concept(phase, n, i) if self.concept else f"concept-p{phase}-b{n}-{i}"
            qs.append({"id": f"q{n}_{i}", "question": f"P{phase} question {n}.{i} about {concept}?",
                       "options": [f"right-{n}-{i}", f"wrong-a-{n}-{i}", f"wrong-b-{n}-{i}", f"wrong-c-{n}-{i}"],
                       "correct_answer": f"right-{n}-{i}", "explanation": f"because {n}.{i}", "hint": "think",
                       "concept": concept, "difficulty": self.tiers[i % len(self.tiers)]})
        return {"questions": qs}

    async def acts(self, vector_store, num_acts=3):
        self.act_calls += 1
        if self.fail_acts:
            raise RuntimeError("provider is down")
        return [dict(a) for a in self.acts_out[:num_acts]]


class Intents:
    """Decides the boss's intents: a queue of kinds (then `default`). None = the real weighted roll."""

    def __init__(self):
        self.queue = []
        self.default = "attack"

    def roll(self, boss, difficulty, shield_factor=1.0, rng=None):
        kind = self.queue.pop(0) if self.queue else self.default
        if kind is None:
            return boss_brain.roll_intent(boss, difficulty, shield_factor)
        return boss_brain.make_intent(kind, boss, difficulty, shield_factor)


@pytest.fixture(autouse=True)
def _clean_v2_tables():
    for table in ("arena_personal_bests", "arena_scores", "arena_battles", "arena_runs", "concept_mastery",
                  "missed_questions"):
        state.store.execute(f"DELETE FROM {table}")
    yield


@pytest.fixture(autouse=True)
def _plain_pacing(monkeypatch):
    monkeypatch.setattr(arena_service, "HP_PACING", {"easy": 1.0, "medium": 1.0, "hard": 1.0, "nightmare": 1.0})


@pytest.fixture()
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr("routers.arena.generate_boss_persona_async", fake.boss)
    monkeypatch.setattr("core_brains.boss_brain.generate_battle_quiz_async", fake.quiz)
    monkeypatch.setattr("routers.arena.extract_expedition_acts_async", fake.acts)
    return fake


@pytest.fixture()
def intents(monkeypatch):
    ctl = Intents()
    monkeypatch.setattr(arena_service, "roll_intent", ctl.roll)
    return ctl


@pytest.fixture()
def hero(make_user, pdf_bytes, llm, intents):
    c, uid = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    state.store.modify_avatar(str(uid), lambda equipped, owned: equipped.clear())      # no gear: plain arithmetic
    return c, uid


# ── helpers ───────────────────────────────────────────────────────────────────
def start(c, difficulty="hard", topic="mitosis", sid=SID, **extra):
    r = c.post("/arena/battles", json={"session_id": sid, "topic": topic, "difficulty": difficulty, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def question(c, bid, move=None, status=200):
    r = c.get(f"/arena/battles/{bid}/question", params={"move": move} if move else None)
    assert r.status_code == status, r.text
    return r.json()


def truth(bid, seq):
    row = state.store.fetchone("SELECT question_json FROM arena_questions WHERE battle_id = ? AND seq = ?", (bid, seq))
    return json.loads(row["question_json"])["correct_answer"]


def wrong(options, bid, seq):
    return next(o for o in options if o != truth(bid, seq))


def answer(c, bid, qid, pick):
    return c.post(f"/arena/battles/{bid}/answer", json={"question_id": qid, "answer": pick})


def play(c, bid, right, move=None):
    q = question(c, bid, move)["question"]
    pick = truth(bid, q["id"]) if right else wrong(q["options"], bid, q["id"])
    r = answer(c, bid, q["id"], pick)
    assert r.status_code == 200, r.text
    return r.json()


def row(bid):
    return state.store.fetchone("SELECT * FROM arena_battles WHERE id = ?", (bid,))


def set_intent(bid, kind):
    """Replace the telegraphed intent of the coming turn."""
    b = row(bid)
    intent = boss_brain.make_intent(kind, json.loads(b["boss_json"]), b["difficulty"])
    state.store.execute("UPDATE arena_battles SET intent_json = ? WHERE id = ?", (json.dumps(intent), bid))
    return intent


def set_focus(bid, focus):
    state.store.execute("UPDATE arena_battles SET focus = ? WHERE id = ?", (focus, bid))


def events(uid, kind):
    return state.store.fetchall("SELECT * FROM reward_events WHERE user_id = ? AND kind = ?", (str(uid), kind))


def wait(predicate, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def pool(bid, phase=1):
    return state.store.fetchone(
        "SELECT COUNT(*) AS n FROM arena_questions WHERE battle_id = ? AND phase = ? AND status = 'queued'",
        (bid, phase))["n"]


def hit(combo, phase=1):
    """apply_player_attack's damage for one right answer at this combo (a 'PERFECT STRIKE': x1.3)."""
    return int(((35 if phase == 2 else 25) + min(combo, 5) * 3) * 1.3)
