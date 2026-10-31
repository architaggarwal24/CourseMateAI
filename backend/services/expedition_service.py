"""Expedition: a roguelite run through a document (docs/arena-v2.md section 4), decided by the server.

    create()        a run: 3 acts (chapter title + topic, extracted by the LLM ONCE by the caller), a seed, and the
                    node map of every act built from that seed (build_map is a pure function of seed + act).
                    One active run per user per document.
    plan_travel()   checks a move on the map without changing anything (the caller may need an LLM boss first)
    travel()        moves to a reachable node: a fight node (battle / elite / nemesis / boss) starts an ordinary
                    arena battle carrying the run's hearts, relics and Focus bonus; rest / shop put a choice on the
                    run; treasure hands out a relic at once
    choose()        answers the pending choice (rest: heal | study, shop: buy | leave, relic offer: take | skip)
    battle_ended()  BattleService calls this INSIDE its finishing transaction when a run battle ends: the battle's
                    hearts, gold, relic offer, the act change - or the run's end - commit together with the battle's
                    own end, so they happen exactly once
    abandon()       ends the run

A run ends exactly once (compare-and-set on status active -> won | lost | abandoned) and that same transaction pays
its single expedition_complete reward (scaled by depth, keyed by run_id) and fixes its score. Battles inside a run
pay nothing themselves. Like battles, LLM trouble never changes a run: the caller generates (acts, a boss) before
calling in, and a failure leaves the run exactly as it was.
"""
import json
import math
import random
import sqlite3
import uuid
from typing import List, Optional

from errors import AppError
from game_content import get_content
from services.arena_service import PLAYER_MAX_HP, _iso, _now, gear_for, week_start

ACTS = 3
LAYERS = 4                              # layers of 2-3 nodes before each act's boss
FIGHT_KINDS = ("battle", "elite", "nemesis", "boss")
# Node odds per layer group (layer 0 is always a battle: a run starts with a fight).
NODE_WEIGHTS = {
    "middle": {"battle": 40, "elite": 14, "nemesis": 14, "rest": 12, "shop": 10, "treasure": 10},
    "last":   {"battle": 28, "elite": 14, "nemesis": 10, "rest": 28, "shop": 12, "treasure": 8},
}
DIFFICULTY_UP = {"easy": "medium", "medium": "hard", "hard": "nightmare", "nightmare": "nightmare"}
HP_SCALE = {"battle": 1.0, "nemesis": 1.0, "elite": 1.25, "boss": 1.5}
GOLD = {"battle": 20, "nemesis": 30, "elite": 40, "boss": 60}
LUCKY_COIN = 1.25
POINTS = {"battle": 100, "nemesis": 150, "elite": 200, "boss": 400, "rest": 25, "shop": 25, "treasure": 25}
WIN_BONUS = 1000
HEART_POINTS = 20
REST_HEAL_PCT = 0.30
IRON_WILL_HEARTS = 2
RELIC_CHOICES = 3
SHOP_RELICS = 3
POTION = {"id": "potion", "kind": "potion", "name": "Healing Draught", "description": "Restore 2 hearts.",
          "price": 30, "heal": 2}
TREASURE_FALLBACK_GOLD = 50             # every relic already owned
NEMESIS_TARGETS = 5


def _err(code: str, message: str, status: int = 409, **details) -> AppError:
    return AppError(code, message, status_code=status, details=details or None)


def relic_catalog() -> dict:
    return {r.id: r.model_dump() for r in get_content().relics.relics}


def public_relic(relic_id: str) -> dict:
    r = relic_catalog().get(relic_id) or {"id": relic_id, "name": relic_id, "description": "", "rarity": "common"}
    return {k: r[k] for k in ("id", "name", "description", "rarity") if k in r}


# ═════════════════════════════ the map ═══════════════════════════════════════
def _edges(rng: random.Random, n_from: int, n_to: int) -> List[List[int]]:
    """Edges from one layer to the next: each node to its proportional neighbour (sometimes also the one beside
    it), then every node of the next layer that nobody reaches gets an edge from the nearest node."""
    out = [set() for _ in range(n_from)]
    scale = (n_to - 1) / max(n_from - 1, 1)
    for j in range(n_from):
        t = int(round(j * scale))
        out[j].add(t)
        side = t + rng.choice((-1, 1))
        if 0 <= side < n_to and rng.random() < 0.5:
            out[j].add(side)
    reached = set().union(*out)
    back = (n_from - 1) / max(n_to - 1, 1)
    for k in range(n_to):
        if k not in reached:
            out[int(round(k * back))].add(k)
    return [sorted(e) for e in out]


def build_map(seed: int, act: int, nemesis_ok: bool) -> dict:
    """The node map of one act - a pure function of (seed, act, nemesis_ok): the same run always has the same map.
    LAYERS layers of 2-3 nodes + the boss; edges only between adjacent layers; every node is reachable from
    layer 0 and leads to the boss."""
    rng = random.Random(f"expedition:{seed}:{act}")
    sizes = [rng.choice((2, 3)) for _ in range(LAYERS)]
    nodes = []
    for layer, size in enumerate(sizes):
        weights = dict(NODE_WEIGHTS["last" if layer == LAYERS - 1 else "middle"])
        if not nemesis_ok:
            weights.pop("nemesis")
        kinds = list(weights)
        for i in range(size):
            kind = "battle" if layer == 0 else rng.choices(kinds, weights=[weights[k] for k in kinds], k=1)[0]
            nodes.append({"id": f"{act}-{layer}-{i}", "layer": layer, "index": i, "kind": kind, "edges": []})
    by_layer = [[n for n in nodes if n["layer"] == layer] for layer in range(LAYERS)]
    for layer in range(LAYERS - 1):
        for j, targets in enumerate(_edges(rng, sizes[layer], sizes[layer + 1])):
            by_layer[layer][j]["edges"] = [by_layer[layer + 1][t]["id"] for t in targets]
    boss_id = f"{act}-boss"
    for n in by_layer[-1]:
        n["edges"] = [boss_id]
    nodes.append({"id": boss_id, "layer": LAYERS, "index": 0, "kind": "boss", "edges": []})
    return {"act": act, "nodes": nodes, "boss": boss_id}


def _node(run_map: dict, node_id: str) -> Optional[dict]:
    return next((n for n in run_map["nodes"] if n["id"] == node_id), None)


class ExpeditionService:
    def __init__(self, store, reward_service, battle_service, mastery):
        self.store = store
        self.rewards = reward_service
        self.battles = battle_service
        self.mastery = mastery

    # ═════════════════════════════ reading ══════════════════════════════════
    def _row(self, run_id: str, user_id) -> Optional[dict]:
        return self.store.fetchone("SELECT * FROM arena_runs WHERE id = ? AND user_id = ?", (str(run_id), int(user_id)))

    def _need(self, run_id: str, user_id) -> dict:
        run = self._row(run_id, user_id)
        if not run:
            raise AppError("run_not_found", "We couldn't find that expedition.", status_code=404)
        return run

    def find_active(self, user_id, session_id: Optional[str] = None) -> Optional[dict]:
        """The active run on a document - or, without one, the latest active run whose document can still be
        loaded (a run whose upload expired is only returned when nothing playable is left).

        Runs are keyed by session_id (the uploaded document), like battles: uploading the same PDF again gives a new
        session and so a fresh run; the old one stays active until it is abandoned."""
        return self.store.fetchone(
            "SELECT r.* FROM arena_runs r LEFT JOIN documents d ON d.id = r.session_id AND d.user_id = r.user_id "
            "AND d.status = 'ready' WHERE r.user_id = ? AND r.status = 'active'"
            + (" AND r.session_id = ?" if session_id else "")
            + " ORDER BY (d.id IS NOT NULL) DESC, r.created_at DESC LIMIT 1",
            (int(user_id),) + ((session_id,) if session_id else ()))

    def document_ready(self, run: dict) -> bool:
        return bool(self.store.fetchone("SELECT 1 FROM documents WHERE id = ? AND user_id = ? AND status = 'ready'",
                                        (run["session_id"], run["user_id"])))

    def get(self, user_id, run_id: str) -> dict:
        return self._need(run_id, user_id)

    @staticmethod
    def act_map(run: dict, act: Optional[int] = None) -> dict:
        return json.loads(run["map_json"])[(act or run["act"]) - 1]

    def reachable(self, run: dict) -> List[str]:
        """Where the player may travel now: layer 0 at the start of an act, else the current node's edges.
        Nowhere while a fight or a choice is pending, or once the run is over."""
        if run["status"] != "active" or run["battle_id"] or run["pending_json"]:
            return []
        m = self.act_map(run)
        if not run["node_id"]:
            return [n["id"] for n in m["nodes"] if n["layer"] == 0]
        node = _node(m, run["node_id"])
        return list(node["edges"]) if node else []

    def state(self, run: dict) -> dict:
        """The run as the browser may see it."""
        acts = json.loads(run["acts_json"])
        out = {
            "run_id": run["id"], "status": run["status"], "session_id": run["session_id"],
            "difficulty": run["difficulty"], "act": run["act"], "acts_total": ACTS, "acts": acts,
            "act_title": acts[run["act"] - 1]["title"], "map": self.act_map(run),
            "node_id": run["node_id"], "visited": json.loads(run["visited_json"]), "reachable": self.reachable(run),
            "hearts": run["hearts"], "max_hearts": run["max_hearts"], "gold": run["gold"],
            "relics": [public_relic(r) for r in json.loads(run["relics_json"])],
            "focus_cap": run["focus_cap"], "act_focus_bonus": run["act_focus_bonus"],
            "pending": json.loads(run["pending_json"]) if run["pending_json"] else None,
            "battle_id": run["battle_id"], "depth": run["depth"], "battles_won": run["battles_won"],
            "score": run["score"], "flags": json.loads(run["flags_json"]),
            "document_ready": self.document_ready(run),       # false: the upload expired - re-upload to play on
        }
        if run["status"] != "active":
            out["result"] = json.loads(run["result_json"] or "{}")
            out["rewards"] = json.loads(run["rewards_json"]) if run["rewards_json"] else None
        return out

    # ═════════════════════════════ create ═══════════════════════════════════
    def create(self, user_id, session_id: str, doc_hash: str, difficulty: str, acts: List[dict],
               seed: Optional[int] = None) -> dict:
        acts = [{"title": str(a.get("title") or a.get("topic"))[:100], "topic": str(a["topic"])[:100]}
                for a in acts][:ACTS]
        if len(acts) < ACTS:
            raise ValueError(f"an expedition needs {ACTS} acts")
        seed = int(seed if seed is not None else random.SystemRandom().randrange(1, 2 ** 31))
        nemesis_ok = self.mastery.nemesis_ready(user_id, doc_hash)
        maps = [build_map(seed, act, nemesis_ok) for act in range(1, ACTS + 1)]
        equipped = json.loads(self.store.get_avatar(str(user_id)).get("equipped_json") or "{}")
        hearts = PLAYER_MAX_HP + gear_for(equipped)["hp"]
        now = _iso(_now())
        run_id = uuid.uuid4().hex
        try:
            self.store.execute(
                "INSERT INTO arena_runs (id, user_id, session_id, doc_hash, difficulty, seed, acts_json, map_json, "
                "nemesis_ok, hearts, max_hearts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, int(user_id), session_id, doc_hash, difficulty, seed, json.dumps(acts), json.dumps(maps),
                 int(nemesis_ok), hearts, hearts, now, now))
        except sqlite3.IntegrityError:
            raise _err("run_in_progress", "You already have an expedition running on this document.")
        return self._need(run_id, user_id)

    # ═════════════════════════════ travel ═══════════════════════════════════
    def plan_travel(self, user_id, run_id: str, node_id: str) -> dict:
        """Validate a move (no side effects). For a fight: what boss to make - {"node", "fight", "topic",
        "difficulty", "targets"}."""
        run = self._need(run_id, user_id)
        self._check_can_travel(run, node_id)
        node = _node(self.act_map(run), node_id)
        fight = node["kind"] in FIGHT_KINDS
        return {"node": node, "fight": fight, **(self.fight_plan(run, node) if fight else
                                                  {"topic": None, "difficulty": run["difficulty"], "targets": None})}

    def _check_can_travel(self, run: dict, node_id: str) -> None:
        """Every reason a move is refused - checked BEFORE the caller spends an LLM call on a boss."""
        if run["status"] != "active":
            raise _err("run_finished", "That expedition is over.")
        if run["battle_id"]:
            raise _err("battle_in_progress", "Finish the fight first.", battle_id=run["battle_id"])
        if run["pending_json"]:
            raise _err("choice_pending", "Make your choice first.", pending=json.loads(run["pending_json"])["kind"])
        if node_id not in self.reachable(run):
            raise _err("node_unreachable", "You can't reach that place from here.", reachable=self.reachable(run))
        node = _node(self.act_map(run), node_id)
        if node and node["kind"] in FIGHT_KINDS:
            # one battle at a time per document: a Quick / Nemesis fight still running there blocks this one
            other = self.store.fetchone(
                "SELECT id FROM arena_battles WHERE user_id = ? AND session_id = ? AND status = 'active'",
                (run["user_id"], run["session_id"]))
            if other:
                raise _err("battle_in_progress", "You already have a battle running for this document. "
                           "Finish or forfeit it first.", battle_id=other["id"])

    def travel(self, user_id, run_id: str, node_id: str, boss: Optional[dict] = None) -> dict:
        """Move to a reachable node and apply it. A fight node needs `boss` (generated by the caller, before)."""
        with self.store.transaction():
            run = self._need(run_id, user_id)
            self._check_can_travel(run, node_id)                     # again: things may have moved meanwhile
            node = _node(self.act_map(run), node_id)
            kind = node["kind"]
            visited = json.loads(run["visited_json"]) + [node_id]
            moved = self.store.execute(
                "UPDATE arena_runs SET node_id = ?, visited_json = ?, updated_at = ? "
                "WHERE id = ? AND status = 'active' AND battle_id IS NULL AND pending_json IS NULL "
                "AND COALESCE(node_id, '') = ?",
                (node_id, json.dumps(visited), _iso(_now()), run["id"], run["node_id"] or ""))
            if moved != 1:
                raise _err("node_unreachable", "You can't reach that place from here.")
            out = {"node": node}
            if kind in FIGHT_KINDS:
                if boss is None:
                    raise ValueError("a fight node needs a boss")
                out.update(self._start_fight(run, node, boss))
            elif kind == "treasure":
                out["gained"] = self._treasure(run, node)
            else:
                self._set_pending(run["id"], self._pending_for(run, node))
            return {**out, "run": self.state(self._need(run_id, user_id))}

    def _start_fight(self, run: dict, node: dict, boss: dict) -> dict:
        plan = self.fight_plan(run, node)
        flags = json.loads(run["flags_json"])
        battle = self.battles.create(
            run["user_id"], run["session_id"], run["doc_hash"], plan["topic"], plan["difficulty"], boss,
            mode="expedition", run_id=run["id"], hearts=run["hearts"], max_hearts=run["max_hearts"],
            mods={"relics": json.loads(run["relics_json"]), "phoenix_used": bool(flags.get("phoenix_used")),
                  "focus_bonus": run["act_focus_bonus"], "node_kind": node["kind"]},
            hp_scale=HP_SCALE[node["kind"]], target_concepts=plan["targets"], focus_cap=run["focus_cap"])
        self.store.execute("UPDATE arena_runs SET battle_id = ? WHERE id = ?", (battle["id"], run["id"]))
        return {"battle_id": battle["id"], "boss": self.battles.public_boss(battle), "battle": self.battles.state(battle)}

    def fight_plan(self, run: dict, node: dict) -> dict:
        """The fight a node holds: the act's topic (a Nemesis: the weakest concepts), one difficulty up for an elite
        or the act boss."""
        act = json.loads(run["acts_json"])[run["act"] - 1]
        plan = {"topic": act["topic"], "difficulty": run["difficulty"], "targets": None}
        if node["kind"] in ("elite", "boss"):
            plan["difficulty"] = DIFFICULTY_UP[run["difficulty"]]
        if node["kind"] == "nemesis":
            targets = [c["concept"] for c in self.mastery.weak_concepts(run["user_id"], run["doc_hash"], NEMESIS_TARGETS)]
            if targets:
                plan["targets"], plan["topic"] = targets, ("Nemesis: " + ", ".join(targets))[:100]
        return plan

    # ═════════════════════════════ relics ═══════════════════════════════════
    def _rng(self, run: dict, node_id: str, purpose: str) -> random.Random:
        """Offers are seeded too: a refresh (or a retry) shows the same shop / relic choice."""
        return random.Random(f"expedition:{run['seed']}:{node_id}:{purpose}:{run['depth']}")

    def _offer(self, run: dict, rng: random.Random, count: int) -> List[str]:
        owned = set(json.loads(run["relics_json"]))
        pool = [r for r in relic_catalog().values() if r["id"] not in owned]
        picked = []
        while pool and len(picked) < count:
            r = rng.choices(pool, weights=[p["weight"] for p in pool], k=1)[0]
            picked.append(r["id"])
            pool.remove(r)
        return picked

    def _grant_relic(self, run_id: str, relic_id: str) -> None:
        """Own a relic for the rest of the run. Iron Will acts at once (+2 max hearts and 2 hearts)."""
        run = self.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (run_id,))
        relics = json.loads(run["relics_json"])
        if relic_id in relics:
            return
        relics.append(relic_id)
        extra = IRON_WILL_HEARTS if relic_id == "iron_will" else 0
        self.store.execute(
            "UPDATE arena_runs SET relics_json = ?, max_hearts = max_hearts + ?, hearts = hearts + ?, updated_at = ? "
            "WHERE id = ?", (json.dumps(relics), extra, extra, _iso(_now()), run_id))

    def _treasure(self, run: dict, node: dict) -> dict:
        found = self._offer(run, self._rng(run, node["id"], "treasure"), 1)
        self._score(run["id"], POINTS["treasure"], depth=1)
        if not found:
            self.store.execute("UPDATE arena_runs SET gold = gold + ? WHERE id = ?", (TREASURE_FALLBACK_GOLD, run["id"]))
            return {"relic": None, "gold": TREASURE_FALLBACK_GOLD}
        self._grant_relic(run["id"], found[0])
        return {"relic": public_relic(found[0]), "gold": 0}

    # ═════════════════════════════ choices ══════════════════════════════════
    def _set_pending(self, run_id: str, pending: Optional[dict]) -> None:
        self.store.execute("UPDATE arena_runs SET pending_json = ?, updated_at = ? WHERE id = ?",
                           (json.dumps(pending) if pending else None, _iso(_now()), run_id))

    def _pending_for(self, run: dict, node: dict) -> dict:
        if node["kind"] == "rest":
            concepts = [c["concept"] for c in self.mastery.weak_concepts(run["user_id"], run["doc_hash"], 5)]
            return {"kind": "rest", "node_id": node["id"], "heal": self._rest_heal(run), "concepts": concepts,
                    "options": ["heal"] + (["study"] if concepts else [])}
        rng = self._rng(run, node["id"], "shop")
        catalog = relic_catalog()
        stock = [{"id": r, "kind": "relic", **public_relic(r), "price": catalog[r]["price"], "sold": False}
                 for r in self._offer(run, rng, SHOP_RELICS)]
        stock.append({**{k: POTION[k] for k in ("id", "kind", "name", "description", "price")}, "sold": False})
        return {"kind": "shop", "node_id": node["id"], "stock": stock}

    @staticmethod
    def _rest_heal(run: dict) -> int:
        return max(0, min(int(math.ceil(run["max_hearts"] * REST_HEAL_PCT)), run["max_hearts"] - run["hearts"]))

    def choose(self, user_id, run_id: str, action: str, target: Optional[str] = None) -> dict:
        """Answer the run's pending choice. Returns {"run", "outcome"}."""
        with self.store.transaction():
            run = self._need(run_id, user_id)
            if run["status"] != "active":
                raise _err("run_finished", "That expedition is over.")
            if not run["pending_json"]:
                raise _err("no_choice", "There is nothing to choose right now.")
            pending = json.loads(run["pending_json"])
            handler = {"rest": self._choose_rest, "shop": self._choose_shop, "relic": self._choose_relic}[pending["kind"]]
            outcome = handler(run, pending, action, target)
            return {"run": self.state(self._need(run_id, user_id)), "outcome": outcome}

    def _bad_action(self, pending: dict, allowed) -> AppError:
        return AppError("invalid_choice", f"Choose one of: {', '.join(allowed)}.", status_code=400,
                        details={"pending": pending["kind"]})

    def _choose_rest(self, run, pending, action, target):
        if action == "heal":
            healed = self._rest_heal(run)
            self.store.execute("UPDATE arena_runs SET hearts = hearts + ? WHERE id = ?", (healed, run["id"]))
            outcome = {"action": "heal", "healed": healed}
        elif action == "study":
            concept = next((c for c in pending.get("concepts") or [] if target and c.lower() == target.strip().lower()),
                           None)
            if concept is None:
                raise AppError("invalid_choice", "Pick one of the concepts on offer to study.", status_code=400,
                               details={"concepts": pending.get("concepts") or []})
            self.store.execute("UPDATE arena_runs SET act_focus_bonus = act_focus_bonus + 1 WHERE id = ?", (run["id"],))
            review = [{"question": r["question"], "correct_answer": r["correct_answer"], "explanation": r["explanation"]}
                      for r in self.mastery.missed_questions(run["user_id"], run["doc_hash"], concept, limit=5)]
            outcome = {"action": "study", "concept": concept, "review": review, "act_focus_bonus": run["act_focus_bonus"] + 1}
        else:
            raise self._bad_action(pending, pending.get("options") or ["heal"])
        self._score(run["id"], POINTS["rest"], depth=1)
        self._set_pending(run["id"], None)
        return outcome

    def _choose_shop(self, run, pending, action, target):
        if action == "leave":
            self._score(run["id"], POINTS["shop"], depth=1)
            self._set_pending(run["id"], None)
            return {"action": "leave"}
        if action != "buy":
            raise self._bad_action(pending, ("buy", "leave"))
        item = next((i for i in pending["stock"] if i["id"] == target), None)
        if item is None:
            raise AppError("invalid_choice", "That isn't for sale here.", status_code=400)
        if item["sold"]:
            raise _err("sold_out", "You already bought that.")
        if run["gold"] < item["price"]:
            raise _err("not_enough_gold", "You don't have enough gold.", gold=run["gold"], price=item["price"])
        # compare-and-set on the gold: two racing purchases can't both spend it
        if self.store.execute("UPDATE arena_runs SET gold = gold - ? WHERE id = ? AND gold >= ?",
                              (item["price"], run["id"], item["price"])) != 1:
            raise _err("not_enough_gold", "You don't have enough gold.")
        outcome = {"action": "buy", "item": target, "price": item["price"]}
        if item["kind"] == "potion":
            healed = max(0, min(POTION["heal"], run["max_hearts"] - run["hearts"]))
            self.store.execute("UPDATE arena_runs SET hearts = hearts + ? WHERE id = ?", (healed, run["id"]))
            outcome["healed"] = healed
        else:
            self._grant_relic(run["id"], target)
            outcome["relic"] = public_relic(target)
        item["sold"] = True
        self._set_pending(run["id"], pending)
        return outcome

    def _choose_relic(self, run, pending, action, target):
        if action == "take":
            if target not in (pending.get("options") or []):
                raise AppError("invalid_choice", "Pick one of the relics on offer.", status_code=400)
            self._grant_relic(run["id"], target)
            outcome = {"action": "take", "relic": public_relic(target)}
        elif action == "skip":
            outcome = {"action": "skip"}
        else:
            raise self._bad_action(pending, ("take", "skip"))
        self._set_pending(run["id"], None)
        if pending.get("then") == "next_act":
            self._next_act(run["id"])
            outcome["next_act"] = True
        return outcome

    def _next_act(self, run_id: str) -> None:
        self.store.execute(
            "UPDATE arena_runs SET act = act + 1, node_id = NULL, act_focus_bonus = 0, updated_at = ? "
            "WHERE id = ? AND act < ?", (_iso(_now()), run_id, ACTS))

    def _score(self, run_id: str, points: int, depth: int = 0) -> None:
        self.store.execute("UPDATE arena_runs SET score = score + ?, depth = depth + ? WHERE id = ?",
                           (points, depth, run_id))

    # ═════════════════════════════ fights end ═══════════════════════════════
    def battle_ended(self, b: dict, status: str) -> Optional[dict]:
        """A run battle just ended (called inside BattleService._end's transaction - exactly once per battle).
        Hearts, gold, Phoenix Ash, the relic offer, the next act or the run's end all move here."""
        run = self.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (b["run_id"],))
        if not run or run["status"] != "active" or run["battle_id"] != b["id"]:
            return None                                       # e.g. the run was abandoned first
        mods = json.loads(b["boss_json"]).get("mods") or {}
        kind = mods.get("node_kind") or "battle"
        flags = json.loads(run["flags_json"])
        if mods.get("phoenix_used"):
            flags["phoenix_used"] = True
        relics = set(json.loads(run["relics_json"]))
        self.store.execute(
            "UPDATE arena_runs SET battle_id = NULL, hearts = ?, flags_json = ?, answered = answered + ?, "
            "correct = correct + ?, updated_at = ? WHERE id = ?",
            (max(0, b["player_hp"]) if status == "won" else 0, json.dumps(flags), b["answered"], b["correct"],
             _iso(_now()), run["id"]))
        if status != "won":
            return self._final_summary(run["id"], self._finish(run["id"], "lost"))

        gold = int(round(GOLD.get(kind, GOLD["battle"]) * (LUCKY_COIN if "lucky_coin" in relics else 1.0)))
        self.store.execute("UPDATE arena_runs SET gold = gold + ?, battles_won = battles_won + 1 WHERE id = ?",
                           (gold, run["id"]))
        self._score(run["id"], POINTS.get(kind, POINTS["battle"]), depth=1)
        summary = {"run_id": run["id"], "status": "active", "gold_gained": gold, "pending": None}
        if kind == "boss" and run["act"] >= ACTS:
            return {**summary, **self._final_summary(run["id"], self._finish(run["id"], "won"))}
        if kind in ("elite", "boss"):
            run = self.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (run["id"],))
            options = self._offer(run, self._rng(run, run["node_id"], "relic"), RELIC_CHOICES)
            if options:
                pending = {"kind": "relic", "node_id": run["node_id"], "options": options,
                           "relics": [public_relic(r) for r in options],
                           "then": "next_act" if kind == "boss" else None}
                self._set_pending(run["id"], pending)
                summary["pending"] = "relic"
            elif kind == "boss":
                self._next_act(run["id"])
        return summary

    # ═════════════════════════════ finishing ════════════════════════════════
    @staticmethod
    def reward_scale(depth: int, won: bool) -> float:
        """The expedition_complete difficulty multiplier: deeper runs pay more, a full clear more still."""
        return round(min(2.0, 0.8 + 0.08 * depth + (0.3 if won else 0.0)), 2)

    def _final_summary(self, run_id: str, paid: Optional[dict]) -> dict:
        """What the answer that ended the run shows: status, final score, result and the expedition_complete paid."""
        run = self.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (run_id,))
        return {"run_id": run_id, "status": run["status"], "score": run["score"],
                "result": json.loads(run["result_json"] or "{}"),
                "rewards": paid if paid is not None else (json.loads(run["rewards_json"]) if run["rewards_json"] else None)}

    def _finish(self, run_id: str, status: str) -> Optional[dict]:
        """End a run ONCE: status, final score and the single expedition_complete reward commit together."""
        with self.store.transaction():
            run = self.store.fetchone("SELECT * FROM arena_runs WHERE id = ?", (run_id,))
            if not run or run["status"] != "active":
                return None
            now = _iso(_now())
            bonus = (WIN_BONUS + HEART_POINTS * run["hearts"]) if status == "won" else 0
            if self.store.execute(
                    "UPDATE arena_runs SET status = ?, score = score + ?, pending_json = NULL, finished_at = ?, "
                    "updated_at = ? WHERE id = ? AND status = 'active'", (status, bonus, now, now, run_id)) != 1:
                return None
            accuracy = run["correct"] / run["answered"] if run["answered"] else 0.0
            paid = {"expedition_complete": None}
            if run["depth"] > 0:
                paid["expedition_complete"] = self.rewards.award(
                    str(run["user_id"]), "expedition_complete", accuracy=accuracy,
                    difficulty=self.reward_scale(run["depth"], status == "won"), combo_count=1, source_id=run_id)
            result = {"status": status, "score": run["score"] + bonus, "depth": run["depth"], "act": run["act"],
                      "battles_won": run["battles_won"], "accuracy": round(100 * accuracy)}
            self.store.execute("UPDATE arena_runs SET rewards_json = ?, result_json = ? WHERE id = ?",
                               (json.dumps(paid), json.dumps(result), run_id))
            return paid

    def abandon(self, user_id, run_id: str) -> dict:
        """Give up: the run ends as abandoned (paying for its depth) and a fight in progress is lost.
        Doing it twice changes nothing."""
        run = self._need(run_id, user_id)
        if run["battle_id"]:
            self.battles._settle(run["battle_id"], user_id)       # an overdue question counts before giving up
        with self.store.transaction():
            run = self._need(run_id, user_id)
            if run["status"] == "active" and run["battle_id"]:
                # the fight being abandoned counts for the run's accuracy (giving up can't hide a bad fight)
                b = self.store.fetchone("SELECT answered, correct FROM arena_battles WHERE id = ? AND status = 'active'",
                                        (run["battle_id"],))
                if b:
                    self.store.execute("UPDATE arena_runs SET answered = answered + ?, correct = correct + ? WHERE id = ?",
                                       (b["answered"], b["correct"], run["id"]))
            self._finish(run["id"], "abandoned")                 # then: the battle's end finds no active run
            if run["battle_id"]:
                self.battles._end(user_id, run["battle_id"], "lost")
                self.store.execute("UPDATE arena_runs SET battle_id = NULL WHERE id = ?", (run["id"],))
            return {"ok": True, "run": self.state(self._need(run_id, user_id))}

    # ═════════════════════════════ leaderboard ══════════════════════════════
    def leaderboard(self, user_id, scope: str = "document", doc_hash: Optional[str] = None) -> List[dict]:
        """Each player's best finished run, highest score first: on one document (all time), or global (this week)."""
        if scope == "global":
            where, params = "WHERE r.status != 'active' AND r.finished_at >= ?", (_iso(week_start()),)
        else:
            where, params = "WHERE r.status != 'active' AND r.doc_hash = ?", (doc_hash,)
        sql = ("SELECT * FROM (SELECT r.*, u.username AS username, ROW_NUMBER() OVER (PARTITION BY r.user_id "
               "ORDER BY r.score DESC, r.finished_at ASC) AS rn FROM arena_runs r JOIN users u ON u.id = r.user_id "
               + where + ") WHERE rn = 1 ORDER BY score DESC, finished_at ASC LIMIT 100")
        return [{"rank": i + 1, "username": r["username"] or str(r["user_id"])[:8], "score": r["score"],
                 "depth": r["depth"], "act": r["act"], "status": r["status"], "difficulty": r["difficulty"],
                 "date": (r["finished_at"] or "")[:10], "is_me": str(r["user_id"]) == str(user_id)}
                for i, r in enumerate(self.store.fetchall(sql, params))]
