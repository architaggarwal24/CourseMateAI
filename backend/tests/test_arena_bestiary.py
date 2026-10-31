"""The bestiary summon: instant creature pick, background flavour that never blocks or breaks a fight, and
truncated (out-of-tokens) structured answers that fail fast instead of being retried."""
import asyncio
import json

import pytest

import state
from core_brains import bestiary, boss_brain
from core_brains.llm_connection import LLMClient, StructuredOutputError
from core_brains.llm_schemas import BossFlavor
from test_api import upload
from arena_v2_support import SID, FakeLLM  # noqa: F401
from test_structured_output import FakeChat

from services import arena_service


# ── picking a creature ────────────────────────────────────────────────────────
def test_topic_words_pick_a_matching_creature():
    assert bestiary.pick_species("Graph algorithms and shortest paths") == "minotaur"
    assert bestiary.pick_species("Probability and statistics") == "kitsune"
    assert bestiary.pick_species("Fluid pressure in deep sea") == "kraken"


def test_pick_is_stable_and_always_valid():
    for topic in ("", "zzzz qqqq", "Photosynthesis", "World War II", "x" * 300):
        a, b = bestiary.pick_species(topic), bestiary.pick_species(topic)
        assert a == b and a in bestiary.CREATURES and a != bestiary.NEMESIS_SPECIES


def test_nemesis_topics_summon_ammit():
    assert bestiary.pick_species("Nemesis: osmosis, diffusion") == "ammit"
    assert bestiary.pick_species("anything", nemesis=True) == "ammit"


@pytest.mark.parametrize("species", list(bestiary.CREATURES))
def test_every_creature_makes_a_complete_boss(species):
    boss = bestiary.base_boss(species, "Cell biology", "hard")
    for key in ("name", "title", "special_ability", "intro_taunt", "defeat_taunt"):
        assert boss[key] and "{topic}" not in boss[key]
    assert len(boss["attack_names"]) == 3 and boss["hit_taunts"] and boss["miss_taunts"]
    assert all("{topic}" not in line for line in boss["hit_taunts"] + boss["miss_taunts"])


# ── the summon itself: no LLM, no waiting ─────────────────────────────────────
def test_persona_is_instant_and_needs_no_llm(monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("the summon must not call the LLM")
    monkeypatch.setattr(boss_brain, "generate_structured_async", boom)
    boss = asyncio.run(boss_brain.generate_boss_persona_async(None, "Thermodynamics", difficulty="nightmare"))
    assert boss["species"] in bestiary.CREATURES and boss["flavor_pending"] is True
    assert 140 <= boss["max_hp"] <= 220 and boss["current_hp"] == boss["max_hp"] and boss["rage_threshold"] == 0.6


def test_merge_flavor_keeps_numbers_and_one_creature_line():
    boss = bestiary.base_boss("hydra", "Cells", "medium")
    hp = boss["max_hp"]
    flavor = BossFlavor.model_validate({"title": "Devourer of Mitosis", "attack_names": ["Spindle Lash", "Prophase Bite", "Cytokinesis Cut"],
                                        "hit_taunts": ["Your spindles align."], "max_hp": 99999}).provided()
    boss_brain.merge_flavor(boss, flavor)
    assert boss["title"] == "Devourer of Mitosis" and boss["max_hp"] == hp
    assert boss["attack_names"][0] == "Spindle Lash"
    assert boss["hit_taunts"][0] == "Your spindles align." and len(boss["hit_taunts"]) == 2
    assert "flavor_pending" not in boss


# ── over HTTP: the battle exists at once, the flavour lands later ──────────────
@pytest.fixture()
def quiz_only(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr("core_brains.boss_brain.generate_battle_quiz_async", fake.quiz)
    return fake


def test_summon_returns_a_creature_and_flavour_applies_in_background(make_user, pdf_bytes, quiz_only, monkeypatch):
    seen = []

    async def flavor(vector_store, species, topic):
        seen.append((species, topic))
        return {"title": "Lord of Mitosis", "attack_names": ["A1", "A2", "A3"]}
    monkeypatch.setattr(boss_brain, "boss_flavor_async", flavor)
    c, _ = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    r = c.post("/arena/battles", json={"session_id": SID, "topic": "mitosis", "difficulty": "hard"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["boss"]["species"] in bestiary.CREATURES
    assert body["battle"]["boss"]["species"] == body["boss"]["species"]
    bid = body["battle_id"]
    row = None
    for _ in range(50):                                     # the TestClient's loop runs the background task
        row = json.loads(state.store.fetchone("SELECT boss_json FROM arena_battles WHERE id = ?", (bid,))["boss_json"])
        if row.get("title") == "Lord of Mitosis":
            break
        c.get(f"/arena/battles/{bid}")
    assert seen and seen[0][1] == "mitosis"
    assert row["title"] == "Lord of Mitosis" and row["attack_names"] == ["A1", "A2", "A3"]
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["boss"]["title"] == "Lord of Mitosis"


def test_failed_flavour_leaves_the_creature_lines(make_user, pdf_bytes, quiz_only, monkeypatch):
    async def down(*a, **k):
        raise asyncio.TimeoutError()
    monkeypatch.setattr(boss_brain, "boss_flavor_async", down)
    c, _ = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    body = c.post("/arena/battles", json={"session_id": SID, "topic": "mitosis", "difficulty": "easy"}).json()
    c.get(f"/arena/battles/{body['battle_id']}")
    boss = json.loads(state.store.fetchone("SELECT boss_json FROM arena_battles WHERE id = ?",
                                           (body["battle_id"],))["boss_json"])
    assert boss["title"].startswith("Warden of") and boss["name"] == bestiary.CREATURES[boss["species"]]["name"]


# ── a cut-off answer is not retried ───────────────────────────────────────────
class LengthFinishReasonError(Exception):
    """Stands in for openai's exception of the same name (matched by name, like the real one)."""


def test_truncated_structured_answer_fails_fast():
    client = LLMClient.__new__(LLMClient)
    client.max_retries, client._provider, client._structured_unsupported = 3, "nvidia-nim", False
    chat = FakeChat("openai_compat", ["{}"], reject_native=LengthFinishReasonError("finish_reason='length'"))
    client.llm = chat
    with pytest.raises(StructuredOutputError, match="cut off"):
        asyncio.run(client.generate_structured_async([], BossFlavor))
    assert len(chat.native_calls) == 1                     # one call, no retries with the same budget


def test_short_stems_match_whole_words_only():
    from core_brains.bestiary import _matches
    assert _matches("art", "art") and not _matches("article", "art")
    assert not _matches("warm", "war") and _matches("biology", "biolog")
    assert bestiary.pick_species("Nemesis in Greek myth") != "ammit"  # only the generated "Nemesis: ..." topic


def test_flavour_runs_once_per_battle():
    svc = state.battle_service
    before = len(svc._flavor_tasks)

    async def go():
        svc._flavor_running.add("b-x")
        try:
            svc.enrich("b-x", "1")             # already running: nothing new is scheduled
            return len(svc._flavor_tasks)
        finally:
            svc._flavor_running.discard("b-x")
    assert asyncio.run(go()) == before
