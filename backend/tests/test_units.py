"""Pure-logic tests: no HTTP, no DB."""
import pytest

from core_brains.json_utils import strip_option_prefixes, _normalize_correct_answer
from core_brains.llm_schemas import QuizBatch
from core_brains.quiz_brain import merge_questions
from core_brains.llm_connection import (
    _client_cache_key, _is_quota_error, _is_auth_error, get_or_create_client,
)
from core_brains.boss_brain import sanitize_boss
from utils.context_builder import build_context_and_sources
from services.session_service import is_valid_session_id
from utils.validators import validate_question, validate_topic


# ── option label stripping (was mangling real answers) ───────────────────────
@pytest.mark.parametrize("opts", [
    ["A deterministic algorithm always halts", "B-cell receptors", "a mitochondrion", "C. elegans"],
    ["A cell", "B cell", "C cell", "D cell"],     # prose that merely starts with a letter
])
def test_prefix_strip_leaves_normal_text_alone(opts):
    assert strip_option_prefixes(opts) == opts


def test_prefix_strip_removes_consistent_labels():
    assert strip_option_prefixes(["A. one", "B. two", "C. three", "D. four"]) == ["one", "two", "three", "four"]
    assert strip_option_prefixes(["A) one", "B) two"]) == ["one", "two"]


def test_prefix_strip_requires_in_order_labels():
    opts = ["A. one", "C. two", "B. three", "D. four"]
    assert strip_option_prefixes(opts) == opts


# ── correct_answer normalisation ─────────────────────────────────────────────
def test_normalize_letter_label_and_text_forms():
    opts = ["A) Meiosis", "B) Mitosis", "C) Osmosis", "D) Fission"]
    assert _normalize_correct_answer("B", opts) == "B) Mitosis"
    assert _normalize_correct_answer("B) Mitosis", opts) == "B) Mitosis"
    assert _normalize_correct_answer("Mitosis", opts) == "B) Mitosis"


def test_normalize_unmappable_returns_none_not_first_option():
    assert _normalize_correct_answer("Gamma", ["A. alpha", "B. beta"]) is None
    assert _normalize_correct_answer("", ["A. alpha", "B. beta"]) is None


def test_normalize_ambiguous_substring_is_rejected():
    # "x" is contained in both "x" and "xy" -> don't guess
    assert _normalize_correct_answer("zz", ["A. x", "B. xy"]) is None


def test_normalize_true_false():
    assert _normalize_correct_answer("false", ["True", "False"], "True/False") == "False"
    assert _normalize_correct_answer("maybe", ["True", "False"], "True/False") is None


# ── quiz validation (QuizBatch rules + merge_questions) ──────────────────────
def _q(question, options, answer, **kw):
    return {"question": question, "options": options, "correct_answer": answer, **kw}


def _batch(questions, question_type="MCQ"):
    return [q.model_dump() for q in QuizBatch.model_validate(
        {"questions": questions}, context={"question_type": question_type}).questions]


def test_quiz_keeps_text_and_maps_answer():
    out = _batch([_q("What is it?", ["A. a mitochondrion", "B. B-cell receptors", "C. C. elegans", "D. none"], "A")])[0]
    assert out["options"] == ["a mitochondrion", "B-cell receptors", "C. elegans", "none"]
    assert out["correct_answer"] == "a mitochondrion"


def test_quiz_drops_bad_questions_instead_of_faking():
    good = _q("Q good?", ["A. 1", "B. 2", "C. 3", "D. 4"], "C")
    no_answer = {"question": "Q none?", "options": ["A. 1", "B. 2", "C. 3", "D. 4"]}
    bad_answer = _q("Q bad?", ["A. 1", "B. 2", "C. 3", "D. 4"], "Z-nothing")
    too_few = _q("Q few?", ["A. 1", "B. 2"], "A")
    dup = _q("q good??", ["A. 1", "B. 2", "C. 3", "D. 4"], "A")
    out = merge_questions(_batch([good, no_answer, bad_answer, too_few, dup]), 10)
    assert [q["question"] for q in out["questions"]] == ["Q good?"]
    assert out["questions"][0]["correct_answer"] == "3"
    assert all("Option D" not in o for q in out["questions"] for o in q["options"])


def test_quiz_all_invalid_fails_validation():
    with pytest.raises(ValueError):
        _batch([{"question": "x"}])


def test_merge_questions_dedupes_caps_and_renumbers():
    qs = _batch([_q(f"Q{i}?", ["A. 1", "B. 2", "C. 3", "D. 4"], "A") for i in range(5)])
    out = merge_questions(qs + qs, 3)["questions"]
    assert [q["id"] for q in out] == [1, 2, 3]
    assert len({q["question"] for q in out}) == 3
    with pytest.raises(ValueError):
        merge_questions([], 3)


# ── LLM client cache (cross-user key leak) ───────────────────────────────────
def test_cache_key_differs_for_keys_sharing_a_prefix():
    a = _client_cache_key("sk-proj-AAAAAAAAAAAA", "openai", "gpt")
    b = _client_cache_key("sk-proj-BBBBBBBBBBBB", "openai", "gpt")
    assert a != b
    assert "AAAA" not in str(a)          # the raw key is never stored as a dict key


def test_two_users_with_same_prefix_get_different_clients(monkeypatch):
    import core_brains.llm_connection as lc
    created = []

    class Fake:
        def __init__(self, api_key, provider, model, base_url=None):
            created.append(api_key)
            self.api_key = api_key

    monkeypatch.setattr(lc, "LLMClient", Fake)
    lc._client_cache.clear()
    c1 = get_or_create_client("sk-proj-USER-ONE-KEY", "openai", "m")
    c2 = get_or_create_client("sk-proj-USER-TWO-KEY", "openai", "m")
    assert c1 is not c2 and c1.api_key != c2.api_key
    assert get_or_create_client("sk-proj-USER-ONE-KEY", "openai", "m") is c1   # still cached


def test_error_classification():
    assert _is_quota_error(Exception("Error code: 429 - rate limited"))
    assert not _is_quota_error(Exception("Used 1429 tokens of context"))
    assert _is_auth_error(Exception("Incorrect API key provided: sk-***"))
    assert _is_auth_error(Exception("401 Unauthorized"))
    assert not _is_auth_error(Exception("Used 14010 tokens"))


# ── boss sanitiser ───────────────────────────────────────────────────────────
def test_boss_hp_is_clamped_and_types_coerced():
    b = sanitize_boss({"max_hp": "100000", "rage_threshold": "40", "name": None, "attack_names": "x"}, "hard")
    assert 100 <= b["max_hp"] <= 160
    assert 0.2 <= b["rage_threshold"] <= 0.6
    assert b["name"] == "The Guardian"
    assert isinstance(b["attack_names"], list) and b["attack_names"]


# ── sources ─────────────────────────────────────────────────────────────────
def test_sources_are_filenames_and_pages_not_server_paths():
    class D:
        def __init__(self, t, m): self.page_content, self.metadata = t, m
    docs = [D("a", {"source": "/srv/app/uploads/abc_123.pdf", "page": 3}),
            D("b", {"source": "/srv/app/uploads/abc_123.pdf", "page": 3}),
            D("c", {"source": "notes.pdf", "page": 0})]
    _, sources = build_context_and_sources(docs)
    assert sources == ["abc_123.pdf · p.4", "notes.pdf · p.1"]
    assert not any("/" in s for s in sources)


# ── session id / validators ──────────────────────────────────────────────────
@pytest.mark.parametrize("sid,ok", [
    ("3f2b8c1e-9d4a-4c55-9a0b-1f2e3d4c5b6a", True),
    ("*", False), ("../../etc/x", False), ("a b", False), ("", False), (None, False), ("short", False),
    ("x" * 65, False),
])
def test_session_id_validation(sid, ok):
    assert is_valid_session_id(sid) is ok


def test_question_and_topic_limits():
    with pytest.raises(ValueError):
        validate_question("x" * 2001)
    with pytest.raises(ValueError):
        validate_topic("   ")
    assert validate_topic("  Photosynthesis ") == "Photosynthesis"
