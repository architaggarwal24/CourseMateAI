"""Expedition runs (docs/arena-v2.md section 4): a seeded map per act, hearts / gold / relics carried from node to
node, fights that are ordinary server-side battles whose end flows back into the run exactly once, and ONE
expedition_complete reward when the run ends. Plus a test per relic."""
import json

import pytest

import state
from core_brains import boss_brain
from services.arena_service import PLAYER_MAX_HP, SECONDS_PER_QUESTION
from services.expedition_service import (ACTS, GOLD, LAYERS, LUCKY_COIN, POTION, build_map)
from arena_v2_support import (  # noqa: F401  (fixtures)
    SID, _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, answer, play, row, set_focus, events, wait, pool,
)


# ── helpers ───────────────────────────────────────────────────────────────────
@pytest.fixture()
def runner(hero, llm):
    llm.boss_hp = 40                       # easy bosses: 40 HP (two right answers); elite / boss: medium, 70 x scale
    llm.tiers = ("medium",)
    return hero


def new_run(c, difficulty="easy"):
    r = c.post("/arena/runs", json={"session_id": SID, "difficulty": difficulty})
    assert r.status_code == 200, r.text
    return r.json()["run"]


def run_row(run_id):
    return state.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (run_id,))


def get_run(c, run_id):
    r = c.get(f"/arena/runs/{run_id}")
    assert r.status_code == 200, r.text
    return r.json()["run"]


def travel(c, run_id, node_id, status=200):
    r = c.post(f"/arena/runs/{run_id}/travel", json={"node_id": node_id})
    assert r.status_code == status, r.text
    return r.json()


def choose(c, run_id, action, target=None, status=200):
    r = c.post(f"/arena/runs/{run_id}/choose", json={"action": action, "target": target})
    assert r.status_code == status, r.text
    return r.json()


def set_kind(run_id, node_id, kind):
    """Make a node of the stored map a given kind (the map is random; the tests need a specific road)."""
    run = run_row(run_id)
    maps = json.loads(run["map_json"])
    for m in maps:
        for n in m["nodes"]:
            if n["id"] == node_id:
                n["kind"] = kind
    state.store.execute("UPDATE arena_runs SET map_json = ? WHERE id = ?", (json.dumps(maps), run_id))


def first_node(run):
    return run["reachable"][0]


def fight_at(c, run, kind="battle", node_id=None):
    node_id = node_id or first_node(run)
    set_kind(run["run_id"], node_id, kind)
    out = travel(c, run["run_id"], node_id)
    assert out["battle_id"], out
    return out


def win(c, bid, move=None):
    for _ in range(20):
        last = play(c, bid, True, move)
        if last["battle"]["status"] != "active":
            assert last["battle"]["status"] == "won"
            return last
    raise AssertionError("the boss never fell")


def lose(c, bid):
    for _ in range(40):
        last = play(c, bid, False)
        if last["battle"]["status"] != "active":
            assert last["battle"]["status"] == "lost"
            return last
    raise AssertionError("never lost")


def give(run_id, *relics):
    state.store.execute("UPDATE arena_runs SET relics_json = ? WHERE id = ?", (json.dumps(list(relics)), run_id))


def place(run_id, **fields):
    sets = ", ".join(f"{k} = ?" for k in fields)
    state.store.execute(f"UPDATE arena_runs SET {sets} WHERE id = ?", (*fields.values(), run_id))


# ═════════════════════════ the map ═══════════════════════════════════════════
@pytest.mark.parametrize("seed", [1, 7, 42, 1234, 99991, 2 ** 30])
def test_the_map_is_seeded_and_well_formed(seed):
    for act in range(1, ACTS + 1):
        m = build_map(seed, act, nemesis_ok=False)
        assert m == build_map(seed, act, nemesis_ok=False)                  # deterministic
        layers = [[n for n in m["nodes"] if n["layer"] == layer] for layer in range(LAYERS + 1)]
        assert all(2 <= len(layer) <= 3 for layer in layers[:LAYERS]) and len(layers[LAYERS]) == 1
        assert layers[LAYERS][0]["kind"] == "boss" and m["boss"] == layers[LAYERS][0]["id"]
        assert all(n["kind"] == "battle" for n in layers[0])
        by_id = {n["id"]: n for n in m["nodes"]}
        for n in m["nodes"]:
            assert all(by_id[e]["layer"] == n["layer"] + 1 for e in n["edges"])     # adjacent layers only
            if n["layer"] < LAYERS:
                assert n["edges"], n                                           # every node leads on
        for layer in layers[1:]:
            for n in layer:
                assert any(n["id"] in p["edges"] for p in m["nodes"]), n       # every node can be reached
        assert all(n["kind"] != "nemesis" for n in m["nodes"])
    assert build_map(1, 1, False) != build_map(2, 1, False) or build_map(1, 2, False) != build_map(2, 2, False)


def test_nemesis_nodes_only_appear_with_weak_data():
    kinds = {n["kind"] for seed in range(40) for n in build_map(seed, 1, nemesis_ok=True)["nodes"]}
    assert "nemesis" in kinds and {"rest", "shop", "treasure", "elite"} <= kinds


# ═════════════════════════ starting ══════════════════════════════════════════
def test_a_run_names_its_acts_once_and_resumes(runner, llm):
    c, _ = runner
    run = new_run(c)
    assert llm.act_calls == 1 and run["status"] == "active" and run["act"] == 1 and run["acts_total"] == 3
    assert [a["title"] for a in run["acts"]] == ["Act One", "Act Two", "Act Three"]
    assert run["hearts"] == run["max_hearts"] == PLAYER_MAX_HP and run["gold"] == 0 and run["relics"] == []
    assert run["reachable"] == [n["id"] for n in run["map"]["nodes"] if n["layer"] == 0]
    stored = run_row(run["run_id"])
    assert json.loads(stored["map_json"]) == [build_map(stored["seed"], a, False) for a in (1, 2, 3)]
    again = c.post("/arena/runs", json={"session_id": SID, "difficulty": "easy"}).json()
    assert again["resumed"] and again["run"]["run_id"] == run["run_id"] and llm.act_calls == 1
    assert c.get("/arena/runs/active", params={"session_id": SID}).json()["run"]["run_id"] == run["run_id"]


def test_an_outage_while_naming_the_acts_creates_no_run(runner, llm):
    c, _ = runner
    llm.fail_acts = True
    r = c.post("/arena/runs", json={"session_id": SID, "difficulty": "easy"})
    assert r.status_code >= 500 and r.json()["error"]["action"] == "retry"
    assert state.store.fetchall("SELECT 1 FROM arena_runs") == []


def test_short_act_lists_are_repeated_and_empty_ones_fail(monkeypatch):
    import asyncio
    from core_brains.llm_connection import StructuredOutputError
    from core_brains.llm_schemas import ExpeditionActs

    class VS:
        def search(self, q, k=4):
            return ["ctx"]

    answers = [{"acts": [{"title": "Only", "topic": "cells"}, {"title": "", "topic": ""}]}, {"acts": []}]

    async def fake(messages, schema):
        assert schema is ExpeditionActs
        return ExpeditionActs.model_validate(answers.pop(0))
    monkeypatch.setattr(boss_brain, "generate_structured_async", fake)
    acts = asyncio.run(boss_brain.extract_expedition_acts_async(VS(), 3))
    assert acts == [{"title": "Only", "topic": "cells"}] * 3
    with pytest.raises(StructuredOutputError):
        asyncio.run(boss_brain.extract_expedition_acts_async(VS(), 3))


def test_bad_difficulty_and_foreign_runs(runner, make_user):
    c, _ = runner
    assert c.post("/arena/runs", json={"session_id": SID, "difficulty": "godmode"}).status_code == 400
    run = new_run(c)
    stranger, _ = make_user()
    assert stranger.get(f"/arena/runs/{run['run_id']}").status_code == 404
    assert stranger.post(f"/arena/runs/{run['run_id']}/travel", json={"node_id": first_node(run)}).status_code == 404
    assert stranger.post(f"/arena/runs/{run['run_id']}/abandon").status_code == 404


# ═════════════════════════ travelling ════════════════════════════════════════
def test_travel_must_follow_the_map(runner):
    c, _ = runner
    run = new_run(c)
    layer1 = next(n["id"] for n in run["map"]["nodes"] if n["layer"] == 1)
    for bad in (layer1, "1-boss", "9-9-9"):
        assert travel(c, run["run_id"], bad, status=409)["error"]["code"] == "node_unreachable"
    assert run_row(run["run_id"])["node_id"] is None


def test_a_fight_node_starts_a_run_battle_and_a_win_flows_back(runner, llm):
    c, uid = runner
    run = new_run(c)
    place(run["run_id"], hearts=7)
    out = fight_at(c, run)
    bid = out["battle_id"]
    assert out["battle"]["mode"] == "expedition" and out["battle"]["run_id"] == run["run_id"]
    assert out["battle"]["player"] == {"hp": 7, "max_hp": PLAYER_MAX_HP}
    assert out["run"]["battle_id"] == bid and out["run"]["reachable"] == []
    assert llm.persona_calls[-1] == ("cell structure", "easy")               # act 1's topic
    nxt = out["run"]["map"]["nodes"]
    node = next(n for n in nxt if n["id"] == out["run"]["node_id"])
    assert travel(c, run["run_id"], node["edges"][0], status=409)["error"]["code"] == "battle_in_progress"

    last = win(c, bid)
    assert last["rewards"] == {"arena_round_complete": None, "boss_defeat": None}          # run battles pay nothing
    assert last["battle"]["result"]["run"]["gold_gained"] == GOLD["battle"]
    after = get_run(c, run["run_id"])
    assert after["battle_id"] is None and after["gold"] == GOLD["battle"] and after["depth"] == 1
    assert after["battles_won"] == 1 and after["hearts"] == 7 and after["reachable"] == node["edges"]
    assert after["score"] == 100
    assert events(uid, "boss_defeat") == [] and events(uid, "arena_round_complete") == []
    assert state.store.fetchall("SELECT 1 FROM arena_scores") == []


def test_a_quick_battle_in_progress_blocks_a_run_fight_and_changes_nothing(runner):
    c, _ = runner
    run = new_run(c)
    start(c, "easy")
    set_kind(run["run_id"], first_node(run), "battle")
    r = travel(c, run["run_id"], first_node(run), status=409)
    assert r["error"]["code"] == "battle_in_progress"
    assert run_row(run["run_id"])["node_id"] is None and run_row(run["run_id"])["battle_id"] is None


def test_a_boss_outage_while_travelling_changes_nothing(runner, monkeypatch):
    c, _ = runner
    run = new_run(c)

    async def down(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr("routers.arena.generate_boss_persona_async", down)
    r = c.post(f"/arena/runs/{run['run_id']}/travel", json={"node_id": first_node(run)})
    assert r.status_code >= 500 and r.json()["error"]["action"] == "retry"
    assert run_row(run["run_id"])["node_id"] is None and state.store.fetchall("SELECT 1 FROM arena_battles") == []


def test_losing_a_run_battle_ends_the_run_and_pays_once(runner):
    c, uid = runner
    run = new_run(c)
    win(c, fight_at(c, run)["battle_id"])                                  # depth 1
    here = get_run(c, run["run_id"])
    place(run["run_id"], hearts=2)
    bid = fight_at(c, here, node_id=here["reachable"][0])["battle_id"]
    lost = lose(c, bid)
    assert lost["battle"]["result"]["run"]["status"] == "lost"
    after = get_run(c, run["run_id"])
    assert after["status"] == "lost" and after["hearts"] == 0 and after["reachable"] == []
    paid = after["rewards"]["expedition_complete"]
    assert paid["ok"] and after["result"]["depth"] == 1 and after["result"]["score"] == 100
    assert len(events(uid, "expedition_complete")) == 1
    # finishing again by any route pays nothing more
    assert c.post(f"/arena/runs/{run['run_id']}/abandon").json()["run"]["status"] == "lost"
    assert c.post(f"/arena/battles/{bid}/forfeit").json()["battle"]["status"] == "lost"
    assert state.expedition_service._finish(run["run_id"], "won") is None
    assert len(events(uid, "expedition_complete")) == 1
    assert travel(c, run["run_id"], "1-boss", status=409)["error"]["code"] == "run_finished"


def test_one_active_run_per_document(runner):
    c, _ = runner
    run = new_run(c)
    from errors import AppError
    with pytest.raises(AppError) as exc:
        state.expedition_service.create(run_row(run["run_id"])["user_id"], SID, "h", "easy",
                                        [{"title": "a", "topic": "a"}] * 3)
    assert exc.value.code == "run_in_progress"
    c.post(f"/arena/runs/{run['run_id']}/abandon")
    assert new_run(c)["run_id"] != run["run_id"]


# ═════════════════════════ rest / shop / treasure / elite ════════════════════
def test_rest_heals_thirty_percent(runner):
    c, _ = runner
    run = new_run(c)
    place(run["run_id"], hearts=4)
    set_kind(run["run_id"], first_node(run), "rest")
    out = travel(c, run["run_id"], first_node(run))
    assert out["run"]["pending"]["kind"] == "rest" and out["run"]["pending"]["options"] == ["heal"]
    assert out["run"]["reachable"] == []
    assert travel(c, run["run_id"], out["run"]["map"]["nodes"][-1]["id"], status=409)["error"]["code"] == "choice_pending"
    assert choose(c, run["run_id"], "study", "x", status=400)["error"]["code"] == "invalid_choice"
    done = choose(c, run["run_id"], "heal")
    assert done["outcome"] == {"action": "heal", "healed": 3} and done["run"]["hearts"] == 7
    assert done["run"]["pending"] is None and done["run"]["depth"] == 1
    assert choose(c, run["run_id"], "heal", status=409)["error"]["code"] == "no_choice"


def test_rest_study_gives_focus_to_every_battle_this_act(runner):
    c, _ = runner
    for concept in ("Spindle fibres", "Anaphase"):
        c.post("/study/flashcards/review", json={"session_id": SID, "concept": concept, "correct": False})
    run = new_run(c)
    set_kind(run["run_id"], first_node(run), "rest")
    pending = travel(c, run["run_id"], first_node(run))["run"]["pending"]
    assert pending["options"] == ["heal", "study"] and "Anaphase" in pending["concepts"]
    done = choose(c, run["run_id"], "study", "anaphase")
    assert done["outcome"]["concept"] == "Anaphase" and done["run"]["act_focus_bonus"] == 1
    here = done["run"]
    out = fight_at(c, here, node_id=here["reachable"][0])
    assert out["battle"]["focus"] == 1                                     # +1 Focus at the start of the battle
    place(run["run_id"], act=2)
    state.expedition_service._next_act(run["run_id"])                     # a new act forgets the bonus
    assert run_row(run["run_id"])["act_focus_bonus"] == 0


def test_the_shop_sells_relics_and_potions_for_run_gold(runner):
    c, _ = runner
    run = new_run(c)
    place(run["run_id"], gold=100, hearts=5)
    set_kind(run["run_id"], first_node(run), "shop")
    stock = travel(c, run["run_id"], first_node(run))["run"]["pending"]["stock"]
    assert len(stock) == 4 and stock[-1]["id"] == "potion" and all(not i["sold"] for i in stock)
    assert get_run(c, run["run_id"])["pending"]["stock"] == stock          # a refresh shows the same shop
    relic = min((i for i in stock if i["kind"] == "relic"), key=lambda i: i["price"])
    bought = choose(c, run["run_id"], "buy", relic["id"])
    assert bought["outcome"]["relic"]["id"] == relic["id"] and bought["run"]["gold"] == 100 - relic["price"]
    assert [r["id"] for r in bought["run"]["relics"]] == [relic["id"]]
    assert choose(c, run["run_id"], "buy", relic["id"], status=409)["error"]["code"] == "sold_out"
    potion = choose(c, run["run_id"], "buy", "potion")
    assert potion["outcome"]["healed"] == POTION["heal"] and potion["run"]["hearts"] == 7
    place(run["run_id"], gold=0)
    expensive = next(i for i in stock if i["kind"] == "relic" and i["id"] != relic["id"])
    assert choose(c, run["run_id"], "buy", expensive["id"], status=409)["error"]["code"] == "not_enough_gold"
    assert choose(c, run["run_id"], "buy", "nothing", status=400)["error"]["code"] == "invalid_choice"
    left = choose(c, run["run_id"], "leave")
    assert left["run"]["pending"] is None and left["run"]["reachable"]


def test_treasure_gives_one_random_relic(runner):
    c, _ = runner
    run = new_run(c)
    set_kind(run["run_id"], first_node(run), "treasure")
    out = travel(c, run["run_id"], first_node(run))
    relic = out["gained"]["relic"]
    assert relic["id"] and [r["id"] for r in out["run"]["relics"]] == [relic["id"]]
    assert out["run"]["pending"] is None and out["run"]["depth"] == 1


def test_an_elite_win_offers_a_relic_choice(runner, llm):
    c, _ = runner
    run = new_run(c)
    out = fight_at(c, run, "elite")
    assert llm.persona_calls[-1][1] == "medium"                          # one difficulty up
    assert out["boss"]["max_hp"] == round(70 * 1.25)
    last = win(c, out["battle_id"])
    after = get_run(c, run["run_id"])
    assert after["gold"] == GOLD["elite"] and after["pending"]["kind"] == "relic"
    options = after["pending"]["options"]
    assert len(options) == 3 and len(set(options)) == 3 and last["battle"]["result"]["run"]["pending"] == "relic"
    assert choose(c, run["run_id"], "take", "not_offered", status=400)["error"]["code"] == "invalid_choice"
    took = choose(c, run["run_id"], "take", options[1])
    assert [r["id"] for r in took["run"]["relics"]] == [options[1]] and took["run"]["act"] == 1


def test_an_act_boss_leads_to_the_next_act_and_the_last_one_wins_the_run(runner, llm):
    c, uid = runner
    run = new_run(c)
    m = run["map"]
    last_layer = next(n["id"] for n in m["nodes"] if n["layer"] == LAYERS - 1)
    place(run["run_id"], node_id=last_layer)
    out = travel(c, run["run_id"], "1-boss")
    assert out["boss"]["max_hp"] == round(70 * 1.5)
    win(c, out["battle_id"])
    after = get_run(c, run["run_id"])
    assert after["pending"]["kind"] == "relic" and after["pending"]["then"] == "next_act"
    nxt = choose(c, run["run_id"], "skip")
    assert nxt["outcome"]["next_act"] and nxt["run"]["act"] == 2 and nxt["run"]["node_id"] is None
    assert nxt["run"]["act_title"] == "Act Two" and nxt["run"]["reachable"][0].startswith("2-0-")

    last3 = next(n["id"] for n in build_map(run_row(run["run_id"])["seed"], 3, False)["nodes"] if n["layer"] == LAYERS - 1)
    place(run["run_id"], act=3, node_id=last3, hearts=6)
    final = travel(c, run["run_id"], "3-boss")
    assert llm.persona_calls[-1][0] == "genetics"
    win(c, final["battle_id"])
    done = get_run(c, run["run_id"])
    assert done["status"] == "won" and done["result"]["status"] == "won"
    assert done["score"] == run_row(run["run_id"])["score"] and done["score"] >= 1000 + 20 * 6
    assert done["rewards"]["expedition_complete"]["ok"] and len(events(uid, "expedition_complete")) == 1


def test_a_nemesis_node_fights_the_weak_concepts(runner, llm):
    c, _ = runner
    for concept in ("Spindle fibres", "Anaphase", "Cytokinesis"):
        c.post("/study/flashcards/review", json={"session_id": SID, "concept": concept, "correct": False})
    run = new_run(c)
    assert run_row(run["run_id"])["nemesis_ok"] == 1
    out = fight_at(c, run, "nemesis")
    assert out["battle"]["mode"] == "expedition" and out["battle"]["topic"].startswith("Nemesis: ")
    assert set(out["boss"]["target_concepts"]) == {"Spindle fibres", "Anaphase", "Cytokinesis"}
    assert wait(lambda: pool(out["battle_id"]) > 0)
    assert all(set(kw["target_concepts"]) == {"Spindle fibres", "Anaphase", "Cytokinesis"} for _, _, kw in llm.calls)
    win(c, out["battle_id"])
    assert get_run(c, run["run_id"])["gold"] == GOLD["nemesis"]


def test_abandon_ends_the_run_and_loses_the_fight(runner):
    c, uid = runner
    run = new_run(c)
    bid = fight_at(c, run)["battle_id"]
    out = c.post(f"/arena/runs/{run['run_id']}/abandon").json()
    assert out["run"]["status"] == "abandoned" and out["run"]["battle_id"] is None
    assert row(bid)["status"] == "lost"
    assert out["run"]["rewards"] == {"expedition_complete": None}            # depth 0: nothing earned
    assert events(uid, "expedition_complete") == []
    assert c.get("/arena/runs/active", params={"session_id": SID}).json()["run"] is None


def test_run_boards_per_document_and_global(runner, make_user):
    c, _ = runner
    run = new_run(c)
    win(c, fight_at(c, run)["battle_id"])
    c.post(f"/arena/runs/{run['run_id']}/abandon")
    doc = c.get("/arena/runs/leaderboard", params={"session_id": SID}).json()
    assert doc["scope"] == "document" and len(doc["entries"]) == 1
    entry = doc["entries"][0]
    assert entry["rank"] == 1 and entry["is_me"] and entry["score"] == 100 and entry["depth"] == 1
    assert entry["status"] == "abandoned" and "user_id" not in entry
    other, _ = make_user()
    board = other.get("/arena/runs/leaderboard", params={"scope": "global"}).json()
    assert board["scope"] == "global" and len(board["entries"]) == 1 and board["entries"][0]["is_me"] is False
    assert c.get("/arena/runs/leaderboard").status_code == 400                 # a document board needs its document


# ═════════════════════════ relics: one test each ═════════════════════════════
def relic_fight(c, relics, hearts=None, difficulty="easy", kind="battle"):
    run = new_run(c, difficulty)
    give(run["run_id"], *relics)
    if hearts is not None:
        place(run["run_id"], hearts=hearts)
    return run, fight_at(c, run, kind)


def test_relic_owl_feather_adds_five_seconds(runner):
    c, _ = runner
    _, out = relic_fight(c, ["owl_feather"])
    assert question(c, out["battle_id"])["question"]["time_limit"] == SECONDS_PER_QUESTION + 5


def test_relic_whetstone_makes_heavy_cost_one(runner):
    c, _ = runner
    _, out = relic_fight(c, ["whetstone"])
    bid = out["battle_id"]
    assert out["battle"]["heavy_cost"] == 1
    set_focus(bid, 1)
    q = question(c, bid, "heavy")["question"]
    assert q["move"] == "heavy" and row(bid)["focus"] == 0


def test_relic_aegis_blocks_the_first_wrong_answer_of_each_battle(runner):
    c, _ = runner
    _, out = relic_fight(c, ["aegis"])
    bid = out["battle_id"]
    first = play(c, bid, False)
    assert first["aegis"] is True and first["damage_taken"] == 0
    second = play(c, bid, False)
    assert second["aegis"] is False and second["damage_taken"] == 1


def test_relic_phoenix_ash_revives_once_per_run(runner):
    c, _ = runner
    run, out = relic_fight(c, ["phoenix_ash"], hearts=1)
    bid = out["battle_id"]
    fell = play(c, bid, False)
    assert fell["revived"] is True and fell["battle"]["player"]["hp"] == 3 and fell["battle"]["status"] == "active"
    win(c, bid)
    after = get_run(c, run["run_id"])
    assert after["flags"]["phoenix_used"] is True and after["hearts"] == 3
    place(run["run_id"], hearts=1)
    bid2 = fight_at(c, after, node_id=after["reachable"][0])["battle_id"]
    again = play(c, bid2, False)
    assert again["revived"] is False and again["battle"]["status"] == "lost"


def test_relic_scholar_lens_makes_weakness_triple(runner, llm):
    c, _ = runner
    llm.weakness = "mitosis"
    llm.concept = lambda phase, n, i: "Mitosis phases" if i == 0 else f"other-{n}-{i}"
    _, out = relic_fight(c, ["scholar_lens"])
    hit = play(c, out["battle_id"], True)
    assert hit["weakness"] and hit["damage_dealt"] == 36 * 3


def test_relic_quill_makes_a_jab_worth_three_focus(runner):
    c, _ = runner
    _, out = relic_fight(c, ["quill"])
    assert play(c, out["battle_id"], True, "jab")["focus"] == 3


def test_relic_hourglass_makes_the_first_timewarp_free(runner):
    c, _ = runner
    _, out = relic_fight(c, ["hourglass"])
    bid = out["battle_id"]
    assert out["battle"]["free_timewarp"] is True
    question(c, bid)
    free = c.post(f"/arena/battles/{bid}/spells", json={"spell": "timewarp"}).json()
    assert free["cost"] == 0 and free["battle"]["focus"] == 0 and free["battle"]["free_timewarp"] is False
    play_q = free["question"]
    answer(c, bid, play_q["id"], truth(bid, play_q["id"]))                   # +1 Focus
    question(c, bid)
    paid = c.post(f"/arena/battles/{bid}/spells", json={"spell": "timewarp"}).json()
    assert paid["cost"] == 1 and paid["battle"]["focus"] == 0


def test_relic_lucky_coin_adds_a_quarter_more_gold(runner):
    c, _ = runner
    run, out = relic_fight(c, ["lucky_coin"])
    win(c, out["battle_id"])
    assert get_run(c, run["run_id"])["gold"] == round(GOLD["battle"] * LUCKY_COIN)


def test_relic_iron_will_adds_two_max_hearts(runner):
    c, _ = runner
    run = new_run(c)
    place(run["run_id"], pending_json=json.dumps({"kind": "relic", "node_id": "x", "options": ["iron_will"],
                                                  "then": None}))
    took = choose(c, run["run_id"], "take", "iron_will")
    assert took["run"]["max_hearts"] == PLAYER_MAX_HP + 2 and took["run"]["hearts"] == PLAYER_MAX_HP + 2
    out = fight_at(c, took["run"])
    assert out["battle"]["player"] == {"hp": PLAYER_MAX_HP + 2, "max_hp": PLAYER_MAX_HP + 2}


def test_relic_focus_crystal_starts_battles_with_two_focus(runner):
    c, _ = runner
    _, out = relic_fight(c, ["focus_crystal"])
    assert out["battle"]["focus"] == 2


def test_relic_vampiric_tome_heals_at_combo_five(runner, llm):
    c, _ = runner
    _, out = relic_fight(c, ["vampiric_tome"], hearts=5)
    bid = out["battle_id"]
    guards = [play(c, bid, True, "guard") for _ in range(5)]                  # right answers that deal nothing
    assert [g["lifesteal"] for g in guards] == [0, 0, 0, 0, 1]
    assert guards[-1]["combo"] == 5 and guards[-1]["battle"]["player"]["hp"] == 6


def test_relic_ink_bomb_halves_boss_shields(runner, intents):
    c, _ = runner
    intents.queue = ["shield"]
    _, out = relic_fight(c, ["ink_bomb"])
    assert out["battle"]["intent"]["kind"] == "shield" and out["battle"]["intent"]["value"] == 2     # 40 HP: 4 -> 2
