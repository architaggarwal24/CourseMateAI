"""Concept maps (Phase 3 Stage 3B, docs/study-power.md section 7): one AI pass per document, cached by content,
built in the background with progress, merged for a course, coloured by mastery."""
import asyncio
import threading
import time

import pytest
from langchain_core.documents import Document

import state
from conftest import make_pdf_bytes
from core_brains import concept_brain
from core_brains.llm_schemas import ConceptMapDraft
from services.concept_map_service import ConceptMapService, heat
from test_api import upload

BIO = "44444444-dddd-4ddd-8ddd-444444444444"
CHEM = "55555555-eeee-4eee-8eee-555555555555"
BIO_PDF = make_pdf_bytes("Mitochondria produce ATP through cellular respiration in the cell. " * 30)
CHEM_PDF = make_pdf_bytes("Covalent bonds share electron pairs between atoms in a molecule. " * 30)

MAPS = {
    "bio": {"concepts": [{"name": "Mitochondria", "summary": "The cell's power plant.", "importance": 3, "page": 1},
                         {"name": "ATP", "summary": "Energy currency.", "importance": 3, "page": 1},
                         {"name": "Cellular respiration", "summary": "Turns glucose into ATP.", "importance": 2, "page": 2}],
            "relations": [{"source": "Mitochondria", "target": "ATP", "label": "produce"},
                          {"source": "Cellular respiration", "target": "ATP", "label": "makes"}]},
    "chem": {"concepts": [{"name": "Covalent bond", "summary": "Shared electrons.", "importance": 3, "page": 1},
                          {"name": "ATP", "summary": "", "importance": 1, "page": 2}],
             "relations": [{"source": "Covalent bond", "target": "ATP", "label": "holds together"}]},
}


class FakeExtractor:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.gate = None

    async def __call__(self, chunks, on_stage=None):
        text = " ".join(c.page_content for c in chunks)
        self.calls.append(text[:20])
        if on_stage:
            await on_stage("Mapping the concepts and how they connect…")
        while self.gate is not None and not self.gate.is_set():
            await asyncio.sleep(0.01)
        if self.fail:
            raise TimeoutError("slow model")
        return MAPS["bio" if "Mitochondria" in text else "chem"]


@pytest.fixture()
def fake(monkeypatch):
    f = FakeExtractor()
    monkeypatch.setattr(state.concept_map_service, "extract", f)
    monkeypatch.setattr(state.concept_map_service, "_active", {})
    state.store.execute("DELETE FROM concept_maps")
    return f


@pytest.fixture()
def student(make_user):
    c, uid = make_user()
    assert upload(c, BIO, BIO_PDF, name="biology.pdf").status_code == 202
    assert upload(c, CHEM, CHEM_PDF, name="chemistry.pdf").status_code == 202
    return c, uid


def _wait(c, sid, until=("ready", "failed", "partial"), timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        m = c.get(f"/concept-map?session_id={sid}").json()
        if m["status"] in until:
            return m
        time.sleep(0.05)
    raise AssertionError(f"map stuck: {m}")


# ═════════════════════════ building ═════════════════════════════════════════
def test_a_map_is_built_once_in_the_background_and_then_reused(student, fake):
    c, _ = student
    assert c.get(f"/concept-map?session_id={BIO}").json()["status"] == "none"            # GET never starts work
    assert fake.calls == []
    r = c.post("/concept-map", json={"session_id": BIO}).json()
    assert r["status"] in ("building", "ready")
    m = _wait(c, BIO)
    assert m["status"] == "ready" and [x["name"] for x in m["concepts"]] == ["ATP", "Mitochondria", "Cellular respiration"]
    assert m["relations"][0] == {"source": "mitochondria", "target": "atp", "label": "produce"}
    assert m["concepts"][1]["pages"] == [{"doc_id": BIO, "page": 1}] and m["concepts"][1]["docs"] == [BIO]
    c.post("/concept-map", json={"session_id": BIO})                                     # asked again: no new AI call
    assert len(fake.calls) == 1


def test_the_same_pdf_for_another_user_costs_nothing(student, fake, make_user):
    c, _ = student
    c.post("/concept-map", json={"session_id": BIO})
    _wait(c, BIO)
    other, _ = make_user()
    sid = "66666666-ffff-4fff-8fff-666666666666"
    upload(other, sid, BIO_PDF)
    assert other.post("/concept-map", json={"session_id": sid}).json()["status"] == "ready"
    assert len(fake.calls) == 1


def test_progress_is_shown_while_it_builds(student, fake):
    c, _ = student
    fake.gate = threading.Event()
    c.post("/concept-map", json={"session_id": BIO})
    end = time.time() + 5
    while (m := c.get(f"/concept-map?session_id={BIO}").json())["stage"] != "Mapping the concepts and how they connect…":
        assert time.time() < end, m
        time.sleep(0.02)
    assert m["status"] == "building" and m["documents"][0]["status"] == "running"
    fake.gate.set()
    assert _wait(c, BIO)["status"] == "ready"


def test_a_failure_says_so_and_can_be_retried(student, fake):
    c, _ = student
    fake.fail = True
    c.post("/concept-map", json={"session_id": BIO})
    m = _wait(c, BIO)
    assert m["status"] == "failed" and "faster" in m["documents"][0]["error"]
    fake.fail = False
    c.post("/concept-map", json={"session_id": BIO})
    assert _wait(c, BIO)["status"] == "ready"


def test_a_job_that_died_with_the_server_is_started_again(student, fake):
    c, _ = student
    h = c.get(f"/documents/{BIO}").json()["file_hash"]
    now = "2026-11-04T09:00:00.000+00:00"
    state.store.execute("INSERT INTO concept_maps (doc_hash, version, status, stage, created_at, updated_at) "
                        "VALUES (?, 1, 'running', 'Mapping…', ?, ?)", (h, now, now))
    assert c.get(f"/concept-map?session_id={BIO}").json()["documents"][0]["status"] == "stalled"
    c.post("/concept-map", json={"session_id": BIO})
    assert _wait(c, BIO)["status"] == "ready"


# ═════════════════════════ courses and mastery ══════════════════════════════
def test_a_course_map_merges_its_documents_and_links_shared_concepts(student, fake):
    c, _ = student
    course = c.post("/courses", json={"name": "Life", "document_ids": [BIO, CHEM]}).json()
    r = c.post("/concept-map", json={"session_id": course["id"]}).json()
    assert r["total"] == 2
    m = _wait(c, course["id"])
    atp = next(x for x in m["concepts"] if x["id"] == "atp")
    assert set(atp["docs"]) == {BIO, CHEM} and atp["importance"] == 3 and atp["summary"] == "Energy currency."
    assert {x["id"] for x in m["concepts"]} == {"mitochondria", "atp", "cellular respiration", "covalent bond"}
    assert len(m["relations"]) == 3 and m["scope"] == {"id": course["id"], "kind": "course", "name": "Life"}
    assert len(fake.calls) == 2                                                           # one call per document


def test_concepts_are_coloured_by_mastery(student, fake):
    c, uid = student
    h = c.get(f"/documents/{BIO}").json()["file_hash"]
    for ok in (True, True, True):
        state.mastery_service.record(uid, h, "ATP", ok)
    state.mastery_service.record(uid, h, "Mitochondria", False)
    state.mastery_service.record(uid, h, "Mitochondria", False)
    state.mastery_service.record(uid, h, "cellular respiration process", True)            # a near name counts
    c.post("/concept-map", json={"session_id": BIO})
    by = {x["id"]: x for x in _wait(c, BIO)["concepts"]}
    assert (by["atp"]["heat"], by["atp"]["seen"]) == ("strong", 3)
    assert by["mitochondria"]["heat"] == "weak"
    assert by["cellular respiration"]["heat"] == "learning"
    assert [heat(0, 0, 0), heat(4, 3, 0), heat(5, 5, 0), heat(3, 2, 2)] == ["new", "learning", "strong", "weak"]


def test_the_concept_map_needs_the_sage_plan_and_is_private(student, fake, monkeypatch, make_user):
    c, _ = student
    other, _ = make_user()
    assert other.get(f"/concept-map?session_id={BIO}").status_code == 404
    monkeypatch.setenv("DEFAULT_TIER", "scholar")
    assert c.get(f"/concept-map?session_id={BIO}").status_code == 403
    assert c.post("/concept-map", json={"session_id": BIO}).status_code == 403


# ═════════════════════════ the AI pass ══════════════════════════════════════
def _chunks(n=40):
    return [Document(page_content=f"Passage {i} about topic {i}. " * 10, metadata={"page": i // 4}) for i in range(n)]


def test_the_digest_spreads_over_the_whole_document_with_page_marks():
    text = concept_brain.digest(_chunks(), max_chars=3000)
    assert text.startswith("[p.1] Passage 0") and "Passage 30 about" in text            # start to end
    assert text.count("[p.") == 4 and len(text) <= 3000


async def test_a_slow_model_gets_one_retry_with_a_shorter_digest(monkeypatch):
    sizes = []

    async def flaky(messages, schema, **kw):
        sizes.append(len(messages[1].content))
        if len(sizes) == 1:
            await asyncio.sleep(1)                                                         # too slow for the limit
        return ConceptMapDraft.model_validate(MAPS["bio"])
    monkeypatch.setattr(concept_brain, "generate_structured_async", flaky)
    stages = []

    async def on_stage(s):
        stages.append(s)
    out = await concept_brain.extract_concept_map(_chunks(), on_stage=on_stage, timeout=0.2)
    assert [c["name"] for c in out["concepts"]] == ["Mitochondria", "ATP", "Cellular respiration"]
    assert len(sizes) == 2 and sizes[1] < sizes[0]
    assert any("shorter summary" in s for s in stages)


async def test_a_missing_key_is_not_retried(monkeypatch):
    calls = []

    async def no_key(messages, schema, **kw):
        calls.append(1)
        raise ValueError("No API key configured.")
    monkeypatch.setattr(concept_brain, "generate_structured_async", no_key)
    with pytest.raises(ValueError):
        await concept_brain.extract_concept_map(_chunks(), timeout=1)
    assert calls == [1]


def test_unusable_concepts_and_relations_are_dropped():
    d = ConceptMapDraft.model_validate({
        "concepts": [{"name": "ATP", "importance": "9", "page": "p.4"}, {"name": "atp "}, {"name": ""},
                     {"name": "Glycolysis", "summary": "x" * 400, "page": "?"}],
        "relations": [{"source": "ATP", "target": "glycolysis", "label": "made by"}, {"source": "ATP", "target": "Nope"},
                      {"source": "Glycolysis", "target": "ATP"}]})
    assert [(c.name, c.importance, c.page) for c in d.concepts] == [("ATP", 3, 4), ("Glycolysis", 2, None)]
    assert len(d.concepts[1].summary) == 240
    assert [(r.source, r.target, r.label) for r in d.relations] == [("ATP", "Glycolysis", "made by")]


def test_service_scope_errors_are_the_documents_errors(student, fake):
    c, _ = student
    assert c.get("/concept-map?session_id=77777777-1111-4111-8111-777777777777").status_code == 404
    assert isinstance(state.concept_map_service, ConceptMapService)
