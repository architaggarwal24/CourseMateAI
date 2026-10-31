"""Retrieval: MMR de-duplicated top-k, similarity scores, and the relevance gates that replaced the
word-overlap checks. Uses real FAISS indexes with the offline bag-of-words embeddings (tests/fakes.py), where
a test decides how relevant a question is by choosing its words."""
import math
from types import SimpleNamespace

import pytest
from langchain_core.documents import Document

from errors import AppError
from fakes import BagOfWordsEmbeddings
from rag.vectorstore import VectorStore
from services import context_service as cs
from services.context_service import EMPTY, assess_relevance, ensure_topic_covered, retrieve

BLOCK, CLARIFY, TOPIC = 0.30, 0.45, 0.40          # the default thresholds (config/settings.py)


def make_store(*pages, source="notes.pdf"):
    """One chunk per string; page numbers are 0-based like PyPDFLoader's."""
    return VectorStore([Document(page_content=t, metadata={"source": f"/srv/uploads/{source}", "page": i})
                        for i, t in enumerate(pages)])


def cosine(a: str, b: str) -> float:
    emb = BagOfWordsEmbeddings()
    va, vb = emb.embed_query(a), emb.embed_query(b)
    return sum(x * y for x, y in zip(va, vb))


BIOLOGY = make_store(
    "mitosis cell division chromosomes spindle",
    "photosynthesis chloroplast sunlight glucose",
    "osmosis membrane water diffusion",
)


# ═══════════════════════════ similarity scores ═══════════════════════════════
def test_scores_are_cosine_similarities_between_zero_and_one():
    hits = BIOLOGY.search_scored("mitosis spindle chromosomes", k=3)
    best_doc, best = hits[0]
    assert "mitosis" in best_doc.page_content
    assert best == pytest.approx(cosine("mitosis spindle chromosomes", "mitosis cell division chromosomes spindle"), abs=1e-4)
    assert best == pytest.approx(3 / math.sqrt(3 * 5), abs=1e-4)                     # shared words / sqrt(n * m)
    assert all(0.0 <= s <= 1.0 for _, s in hits)
    # the identical text is (about) 1.0; a question with no word in common is (about) 0
    assert BIOLOGY.search_scored("mitosis cell division chromosomes spindle", k=1)[0][1] == pytest.approx(1.0, abs=1e-4)
    assert BIOLOGY.search_scored("quantum chromodynamics lattices", k=1)[0][1] < 0.05


def test_retrieve_returns_context_sources_and_best_similarity():
    found = retrieve(BIOLOGY, "mitosis chromosomes spindle", top_k=2)
    assert found.best_similarity == pytest.approx(0.7746, abs=1e-3)
    assert found.sources[0] == "notes.pdf · p.1"                                      # `file · p.N`, no server path
    assert "mitosis" in found.context and found.chunk_count == len(found.similarities) == 2


def test_retrieving_nothing_is_an_empty_result_not_an_error():
    assert retrieve(None, "anything") is EMPTY
    assert retrieve(BIOLOGY, "   ") is EMPTY
    assert EMPTY.best_similarity is None and EMPTY.chunk_count == 0


# ═══════════════════════════ MMR + de-duplication ════════════════════════════
HEADER = "Biology 101 lecture notes mitosis"


def test_repeated_boilerplate_is_returned_once_and_diverse_chunks_make_the_cut():
    store = make_store(
        HEADER, HEADER, HEADER, HEADER,                                               # a running header on every page
        "mitosis spindle fibers pull chromosomes apart during anaphase",
        "mitosis ends with telophase and cytokinesis",
    )
    plain = [d.page_content for d in store.search("mitosis", k=3)]
    assert plain.count(HEADER) >= 2                                                   # plain top-k hands the LLM the same header repeatedly

    found = retrieve(store, "mitosis", top_k=3)
    assert found.context.count(HEADER) == 1
    assert "anaphase" in found.context and "telophase" in found.context              # redundancy replaced by new information
    assert len(found.sources) == len(set(found.sources)) == 3                         # unique `file · p.N` labels
    assert {"notes.pdf · p.5", "notes.pdf · p.6"} <= set(found.sources)
    assert sum(s in {f"notes.pdf · p.{n}" for n in (1, 2, 3, 4)} for s in found.sources) == 1   # one copy of the header


def test_a_chunk_contained_in_a_longer_hit_is_dropped():
    store = make_store("mitosis divides a cell", "mitosis divides a cell into two identical daughter cells")
    found = retrieve(store, "mitosis divides a cell", top_k=2)
    assert found.chunk_count == 1 and "daughter" in found.context


def test_mmr_lambda_trades_relevance_for_diversity(monkeypatch):
    store = make_store("mitosis spindle chromosomes", "mitosis spindle chromosomes anaphase", "mitosis cytokinesis telophase")
    relevant = retrieve(store, "mitosis spindle chromosomes", top_k=2, mmr_lambda=1.0)
    diverse = retrieve(store, "mitosis spindle chromosomes", top_k=2, mmr_lambda=0.0)
    assert any("anaphase" in c or "spindle" in c for c in [relevant.context]) and "telophase" not in relevant.context
    assert "telophase" in diverse.context


# ═══════════════════════════ chat relevance gate ═════════════════════════════
def best_for(question: str) -> cs.Retrieval:
    return retrieve(BIOLOGY, question, top_k=3)


def test_on_topic_question_passes():
    q = assess_relevance(best_for("mitosis spindle chromosomes"), block_below=BLOCK, clarify_below=CLARIFY)
    assert (q["blocked"], q["needs_clarification"], q["reason"]) == (False, False, "strong_match")
    assert q["similarity"] > 0.7


def test_weak_match_is_answered_with_a_clarification_request():
    found = best_for("mitosis banana")                                                # 1 of 2 words in common
    assert BLOCK <= found.best_similarity < CLARIFY
    q = assess_relevance(found, block_below=BLOCK, clarify_below=CLARIFY)
    assert (q["blocked"], q["needs_clarification"], q["is_valid"], q["reason"]) == (False, True, True, "weak_match")


def test_unrelated_question_is_blocked_as_not_in_the_document():
    q = assess_relevance(best_for("quantum chromodynamics lattices"), block_below=BLOCK, clarify_below=CLARIFY)
    assert (q["blocked"], q["is_valid"], q["reason"]) == (True, False, "not_in_document")


def test_nothing_retrieved_is_blocked():
    q = assess_relevance(EMPTY, block_below=BLOCK, clarify_below=CLARIFY)
    assert (q["blocked"], q["reason"], q["similarity"]) == (True, "insufficient_content", 0.0)


def test_thresholds_come_from_settings(monkeypatch):
    found = best_for("mitosis spindle chromosomes")                                   # ~0.77
    assert not assess_relevance(found)["blocked"]                                     # default thresholds
    strict = SimpleNamespace(relevance_block_below=0.9, relevance_clarify_below=0.95, topic_min_similarity=0.9,
                             retrieval_mmr_lambda=0.7)
    monkeypatch.setattr(cs, "settings", strict)
    assert assess_relevance(found)["blocked"]                                         # same question, stricter settings
    with pytest.raises(AppError):
        ensure_topic_covered(found, "mitosis")


def test_paraphrase_that_shares_no_words_is_a_limit_of_the_fake_not_of_the_gate():
    """Documented on purpose: with real embeddings synonyms score high; the bag-of-words fake can't know that.
    The gate only looks at the score, so it is the embedding model that decides what counts as 'related'."""
    assert best_for("cytokinesis").best_similarity < BLOCK


# ═══════════════════════════ topic gate (quiz / notes / flashcards) ══════════
def test_topic_in_the_document_passes_even_with_punctuation_and_plurals():
    for topic in ("mitosis", "Mitosis,", "chromosomes", "chromosome spindles", "cell division."):
        ensure_topic_covered(retrieve(BIOLOGY, topic, top_k=4), topic)                # does not raise


def test_topic_not_in_the_document_keeps_the_same_user_facing_message():
    topic = "quantum chromodynamics"
    with pytest.raises(AppError) as e:
        ensure_topic_covered(retrieve(BIOLOGY, topic, top_k=4), topic)
    assert e.value.code == "topic_not_found" and e.value.status_code == 400
    assert e.value.message == "Topic 'quantum chromodynamics' does not appear to be covered in your PDF. Try a topic from the document."


def test_empty_retrieval_keeps_the_was_not_found_message():
    with pytest.raises(AppError) as e:
        ensure_topic_covered(EMPTY, "anything")
    assert e.value.message == ("Topic 'anything' was not found in your PDF. "
                               "Please enter a topic that appears in the uploaded document.")


def test_topic_threshold_is_respected():
    found = retrieve(BIOLOGY, "mitosis banana guitar volcano", top_k=3)               # 1 of 4 words: ~0.22
    assert found.best_similarity < TOPIC
    with pytest.raises(AppError):
        ensure_topic_covered(found, "mitosis banana guitar volcano", min_similarity=TOPIC)
    ensure_topic_covered(found, "mitosis banana guitar volcano", min_similarity=0.1)
