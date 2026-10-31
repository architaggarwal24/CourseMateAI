"""Fixes from the Arena v2 review: abandon can't hide a bad fight from the run's accuracy, spells can't revive an
expired question, a run fight never calls the LLM when another battle blocks it, the answer that ends a run shows
the payout, an exhausted question budget never decides a fight, pre-v2 battles get a real intent, and the
/arena/runs resume rules."""
import json

import state
from services import arena_service
from services.arena_service import MAX_BATCHES_PER_PHASE
from test_api import upload
from conftest import make_pdf_bytes
from arena_v2_support import (  # noqa: F401  (fixtures)
    SID, SID_OTHER, _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, wrong, answer, play, row, set_focus, events, wait, pool,
)
from test_arena_v2_expedition import (  # noqa: F401
    runner, new_run, run_row, get_run, travel, set_kind, first_node, fight_at, win, lose, place,
)


# 1 ── abandon mid-fight counts that fight's answers ─────────────────────────
def test_abandoning_mid_fight_keeps_the_fights_answers_in_the_run_accuracy(runner):
    c, uid = runner
    run = new_run(c)
    win(c, fight_at(c, run)["battle_id"])                         # 2 right answers, depth 1
    here = get_run(c, run["run_id"])
    bid = fight_at(c, here, node_id=here["reachable"][0])["battle_id"]
    play(c, bid, False)
    play(c, bid, False)                                           # 2 wrong in the fight being abandoned
    out = c.post(f"/arena/runs/{run['run_id']}/abandon").json()["run"]
    assert out["status"] == "abandoned" and out["result"]["accuracy"] == 50
    assert run_row(run["run_id"])["answered"] == 4
    assert len(events(uid, "expedition_complete")) == 1


# 2 ── no spell on an expired question ───────────────────────────────────────
def test_a_spell_cannot_revive_a_question_inside_the_grace_period(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    set_focus(bid, 3)
    past = arena_service._iso(arena_service._now() - arena_service.timedelta(seconds=1))   # late, within grace
    state.store.execute("UPDATE arena_questions SET deadline_at = ? WHERE battle_id = ? AND seq = ?", (past, bid, q["id"]))
    for spell in ("timewarp", "insight"):
        r = c.post(f"/arena/battles/{bid}/spells", json={"spell": spell})
        assert r.status_code == 409 and r.json()["error"]["code"] == "question_expired"
    stored = state.store.fetchone("SELECT * FROM arena_questions WHERE battle_id = ? AND seq = ?", (bid, q["id"]))
    assert stored["deadline_at"] == past and not stored["timewarped"] and not stored["removed_json"]
    assert row(bid)["focus"] == 3


# 3 ── a blocked run fight is refused before any LLM call ────────────────────
def test_a_run_fight_blocked_by_another_battle_is_refused_before_the_llm(runner, llm):
    c, _ = runner
    run = new_run(c)
    quick = start(c, "easy")["battle_id"]
    calls = len(llm.persona_calls)
    set_kind(run["run_id"], first_node(run), "battle")
    r = travel(c, run["run_id"], first_node(run), status=409)
    assert r["error"]["code"] == "battle_in_progress" and r["error"]["details"]["battle_id"] == quick
    assert len(llm.persona_calls) == calls and run_row(run["run_id"])["node_id"] is None


# 4 ── the answer that ends the run shows the payout ─────────────────────────
def test_the_answer_that_loses_the_run_carries_the_payout(runner):
    c, uid = runner
    run = new_run(c)
    win(c, fight_at(c, run)["battle_id"])
    here = get_run(c, run["run_id"])
    place(run["run_id"], hearts=1)
    bid = fight_at(c, here, node_id=here["reachable"][0])["battle_id"]
    last = lose(c, bid)
    summary = last["battle"]["result"]["run"]
    assert summary["status"] == "lost" and summary["score"] == 100 and summary["result"]["depth"] == 1
    assert summary["rewards"]["expedition_complete"]["ok"] is True
    assert summary["rewards"] == get_run(c, run["run_id"])["rewards"]
    assert len(events(uid, "expedition_complete")) == 1


def test_the_answer_that_wins_the_run_carries_the_payout(runner):
    c, _ = runner
    run = new_run(c)
    last3 = next(n["id"] for n in json.loads(run_row(run["run_id"])["map_json"])[2]["nodes"] if n["layer"] == 3)
    place(run["run_id"], act=3, node_id=last3, depth=5)
    final = travel(c, run["run_id"], "3-boss")
    last = win(c, final["battle_id"])
    summary = last["battle"]["result"]["run"]
    assert summary["status"] == "won" and summary["result"]["status"] == "won"
    assert summary["score"] == get_run(c, run["run_id"])["score"] and summary["rewards"]["expedition_complete"]["ok"]


# 5 ── an exhausted question budget is retryable, never a loss ───────────────
def test_an_exhausted_question_budget_is_retryable_and_the_fight_goes_on(hero, llm):
    c, uid = hero
    llm.per_batch = 1
    llm.tiers = ("medium",)
    llm.empty = lambda phase, n: n >= 2                     # after the first question nothing usable comes back
    bid = start(c)["battle_id"]
    assert wait(lambda: pool(bid) >= 1)
    play(c, bid, False)
    for _ in range(MAX_BATCHES_PER_PHASE + 3):
        r = c.get(f"/arena/battles/{bid}/question")
        assert r.status_code == 503 and r.json()["error"]["details"] == {"retryable": True}
    assert row(bid)["status"] == "active" and row(bid)["gen_attempts_1"] >= MAX_BATCHES_PER_PHASE
    assert events(uid, "boss_defeat") == [] and events(uid, "arena_round_complete") == []
    llm.empty = None                                         # the provider recovers: the same fight continues
    assert question(c, bid)["question"] is not None


# 6 ── pre-v2 battles get a real, stored intent ──────────────────────────────
def test_a_battle_without_an_intent_gets_one_rolled_and_stored_on_read(hero, intents):
    c, _ = hero
    bid = start(c)["battle_id"]
    state.store.execute("UPDATE arena_battles SET intent_json = NULL WHERE id = ?", (bid,))
    intents.queue = ["heavy"]
    shown = c.get(f"/arena/battles/{bid}").json()["battle"]["intent"]
    assert shown["kind"] == "heavy" and json.loads(row(bid)["intent_json"]) == shown
    out = play(c, bid, False)
    assert out["intent"] == shown and out["damage_taken"] == 4             # the telegraph is what resolved


# 7a ── /runs/active without a document prefers a run that can still be played
def test_active_run_without_a_document_prefers_a_loadable_one(runner, llm):
    c, _ = runner
    older = new_run(c)
    assert upload(c, SID_OTHER, make_pdf_bytes("Photosynthesis makes sugar. " * 40)).status_code == 202
    newer = c.post("/arena/runs", json={"session_id": SID_OTHER, "difficulty": "easy"}).json()["run"]
    assert c.get("/arena/runs/active").json()["run"]["run_id"] == newer["run_id"]
    state.db.execute("DELETE FROM documents WHERE id = ?", (SID_OTHER,))          # its session expired
    found = c.get("/arena/runs/active").json()["run"]
    assert found["run_id"] == older["run_id"] and found["document_ready"] is True
    dead = c.get("/arena/runs/active", params={"session_id": SID_OTHER}).json()["run"]
    assert dead["run_id"] == newer["run_id"] and dead["document_ready"] is False


# 7b ── another difficulty does not silently resume ──────────────────────────
def test_starting_a_run_with_another_difficulty_is_refused(runner):
    c, _ = runner
    run = new_run(c, "easy")
    r = c.post("/arena/runs", json={"session_id": SID, "difficulty": "hard"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "run_in_progress"
    assert r.json()["error"]["details"] == {"run_id": run["run_id"], "difficulty": "easy"}
    assert c.post("/arena/runs", json={"session_id": SID, "difficulty": "easy"}).json()["resumed"] is True
