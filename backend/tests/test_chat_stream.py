"""POST /chat/stream (Server-Sent Events) plus the retrieval behaviour of /chat that it shares:
follow-up rewriting, the relevance gate, de-duplicated sources and not blocking the event loop."""
import asyncio
import dataclasses
import json
import re
import time

import httpx
import pytest

import state
from conftest import API_PREFIX
from core_brains.llm_connection import InvalidApiKeyError, ProviderUnreachableError, QuotaExceededError
from fakes import BagOfWordsEmbeddings
from services.chat_stream import SSE_HEADERS, chat_event_stream, sse
from test_api import SID1, fake_llm, upload  # noqa: F401  (fake_llm is a fixture)

QUESTION = "What is mitosis?"                      # strong match for the test PDF ("Mitosis is cell division.")
WEAK = "mitosis banana"                            # shares one word of two: between the block and clarify thresholds
UNRELATED = "quantum chromodynamics lattices"      # nothing in common with the document
HISTORY = [{"role": "user", "content": "What is mitosis?"},
           {"role": "assistant", "content": "Mitosis is cell division."}]


# ═══════════════════════════ helpers ═════════════════════════════════════════
def parse_sse(text: str):
    """[(event, data)] - strict: every frame is exactly `event:` + one `data:` line + a blank line."""
    assert text == "" or text.endswith("\n\n"), repr(text[-20:])
    frames = []
    for block in filter(None, text.split("\n\n")):
        lines = block.split("\n")
        assert len(lines) == 2 and lines[0].startswith("event: ") and lines[1].startswith("data: "), block
        frames.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return frames


def provider_stream(*items, seen=None):
    """A fake of core_brains.chat_brain.stream_chat_with_context: yields strings, raises exceptions."""
    async def gen(question, context, history, llm):
        if seen is not None:
            seen.append({"question": question, "context": context, "history": history, "llm": llm})
        for item in items:
            if isinstance(item, BaseException):
                raise item
            yield item
    return gen


@pytest.fixture()
def streaming(monkeypatch):
    """patch(*items) installs a fake provider stream and returns the list of calls it received."""
    def patch(*items):
        seen = []
        monkeypatch.setattr("routers.study.stream_chat_with_context", provider_stream(*items, seen=seen))
        return seen
    return patch


def ask(c, sid=SID1, question=QUESTION, **extra):
    return c.post("/chat/stream", json={"question": question, "session_id": sid, **extra})


@pytest.fixture()
def doc(make_user, pdf_bytes):
    c, uid = make_user()
    assert upload(c, SID1, pdf_bytes).status_code == 202
    return c, uid


def activity(sid, uid):
    return [(r["action_type"], json.loads(r["content"] or "{}"))
            for r in state.db.query("SELECT action_type, content FROM activity_log WHERE session_id = ? AND user_id = ? AND mode = 'chat' ORDER BY id",
                                    [sid, uid])]


def questions_asked(uid):
    return (state.store.fetchone("SELECT total_chat_questions AS n FROM user_progress WHERE user_id = ?", (str(uid),)) or {"n": 0})["n"]


# ═══════════════════════════ SSE framing ═════════════════════════════════════
def test_a_frame_is_event_plus_one_json_line_plus_blank_line():
    assert sse("token", {"text": "hi"}) == 'event: token\ndata: {"text": "hi"}\n\n'


def test_newlines_and_unicode_in_tokens_cannot_break_framing():
    frame = sse("token", {"text": "line one\nline two\r\n\u2028 – ünïcode ✓"})
    assert frame.count("\n") == 3                                    # event line, data line, blank line - nothing else
    assert parse_sse(frame) == [("token", {"text": "line one\nline two\r\n\u2028 – ünïcode ✓"})]


def test_the_stream_headers_prevent_caching_and_proxy_buffering():
    assert "no-cache" in SSE_HEADERS["Cache-Control"] and SSE_HEADERS["X-Accel-Buffering"] == "no"


async def collect_frames(agen):
    return parse_sse("".join([f async for f in agen]))


async def tokens(*items, closed=None):
    try:
        for item in items:
            if isinstance(item, BaseException):
                raise item
            yield item
    finally:
        if closed is not None:
            closed.append(True)


async def test_event_stream_sends_tokens_then_one_final_sources_event():
    async def finish(answer):
        return {"mode": "chat", "sources": ["a.pdf · p.1"], "echo": answer}
    rest = tokens("lo", " there")
    frames = await collect_frames(chat_event_stream("Hel", rest, finish=finish, to_error=None))
    assert frames == [("token", {"text": "Hel"}), ("token", {"text": "lo"}), ("token", {"text": " there"}),
                      ("sources", {"mode": "chat", "sources": ["a.pdf · p.1"], "echo": "Hello there"})]


async def test_a_provider_error_mid_stream_becomes_an_error_event_and_ends_the_stream():
    finished, closed = [], []

    async def finish(answer):
        finished.append(answer)
        return {}

    def to_error(exc):
        from deps import provider_error_for
        return provider_error_for(exc)

    frames = await collect_frames(chat_event_stream(
        "Hel", tokens("lo", QuotaExceededError("gemini"), "never sent", closed=closed), finish=finish, to_error=to_error))
    assert [e for e, _ in frames] == ["token", "token", "error"]            # no `sources`, nothing after the error
    err = frames[-1][1]["error"]
    assert set(err) == {"code", "message", "action", "details", "request_id"}               # the unified error shape
    assert err["code"] == "provider_quota" and err["action"] == "settings"
    assert err["details"]["provider"] == "gemini" and err["details"]["usage_url"]
    assert finished == [] and closed == [True]                                # not recorded as an answer; stream closed


async def test_closing_the_response_early_closes_the_model_stream_and_skips_the_bookkeeping():
    finished, closed = [], []

    async def finish(answer):
        finished.append(answer)
        return {}

    events = chat_event_stream("Hel", tokens("lo", "more", closed=closed), finish=finish, to_error=None)
    assert await anext(events) == 'event: token\ndata: {"text": "Hel"}\n\n'
    assert await anext(events) == 'event: token\ndata: {"text": "lo"}\n\n'
    await events.aclose()                                                      # the client went away
    assert closed == [True] and finished == []                                 # no rewards for an abandoned answer


async def test_cancellation_is_not_swallowed():
    async def slow_tokens():
        yield "x"
        await asyncio.sleep(60)

    events = chat_event_stream("Hel", slow_tokens(), finish=lambda a: None, to_error=None)
    task = asyncio.create_task(collect_frames(events))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


# ═══════════════════════════ the endpoint ════════════════════════════════════
def test_stream_endpoint_frames_tokens_then_sources(doc, streaming):
    c, uid = doc
    seen = streaming("Mito", "sis is ", "cell division.")
    r = ask(c, history=[{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "reply"}])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert "no-cache" in r.headers["cache-control"] and r.headers["x-accel-buffering"] == "no"

    frames = parse_sse(r.text)
    assert [e for e, _ in frames] == ["token", "token", "token", "sources"]
    assert "".join(d["text"] for e, d in frames if e == "token") == "Mitosis is cell division."
    final = frames[-1][1]
    assert final["mode"] == "chat" and final["blocked"] is False and final["needs_clarification"] is False
    assert len(final["sources"]) == 1 and re.fullmatch(r"notes\.pdf · p\.\d+", final["sources"][0])   # `file · p.N`
    assert final["rewards"] is None

    call = seen[0]                                                              # what the model was given
    assert call["question"] == QUESTION and "Mitosis is cell division" in call["context"]
    assert call["history"] == [{"role": "user", "content": "earlier"}, {"role": "assistant", "content": "reply"}]
    assert set(call["llm"]) == {"api_key", "provider", "model", "base_url"} and call["llm"]["api_key"]


def test_streamed_answers_are_recorded_exactly_like_plain_ones(doc, streaming, fake_llm):
    c, uid = doc
    streaming("Part one. ", "Part two.")
    ask(c)
    assert questions_asked(uid) == 1
    assert activity(SID1, uid) == [("query", {"question": QUESTION}),
                                   ("response", {"answer": "Part one. Part two.", "sources": 1})]

    c.post("/chat", json={"question": QUESTION, "session_id": SID1})            # the non-streaming endpoint
    assert questions_asked(uid) == 2
    assert activity(SID1, uid)[2:] == [("query", {"question": QUESTION}), ("response", {"answer": "stub answer", "sources": 1})]


def test_every_fifth_streamed_question_earns_the_chat_bundle_reward(doc, streaming):
    c, uid = doc
    state.store.ensure_user(str(uid))
    state.store.increment_progress(str(uid), "total_chat_questions", 4)
    streaming("ok")
    rewards = parse_sse(ask(c).text)[-1][1]["rewards"]
    assert isinstance(rewards, dict) and rewards                                # same payload as /chat's `rewards`


def test_a_failure_while_recording_does_not_turn_a_delivered_answer_into_an_error(doc, streaming, monkeypatch):
    c, _ = doc
    streaming("fine")
    monkeypatch.setattr("routers.study._record_chat_answer", lambda *a: (_ for _ in ()).throw(RuntimeError("db down")))
    frames = parse_sse(ask(c).text)
    assert [e for e, _ in frames] == ["token", "sources"] and frames[-1][1]["rewards"] is None


# ── relevance gate through the API ───────────────────────────────────────────
def test_a_question_the_document_does_not_cover_is_blocked_without_calling_the_model(doc, streaming, fake_llm):
    c, uid = doc
    seen = streaming("must not be called")
    frames = parse_sse(ask(c, question=UNRELATED).text)
    assert frames == [
        ("token", {"text": f'I cannot find "{UNRELATED}" in the uploaded PDF.'}),
        ("sources", {"mode": "chat", "sources": [], "blocked": True, "needs_clarification": False, "rewards": None}),
    ]
    assert seen == [] and questions_asked(uid) == 0

    plain = c.post("/chat", json={"question": UNRELATED, "session_id": SID1}).json()   # same behaviour as before
    assert plain == {"mode": "chat", "content": f'I cannot find "{UNRELATED}" in the uploaded PDF.', "sources": [], "blocked": True}


def test_a_weak_match_is_answered_with_a_request_to_clarify(doc, streaming):
    c, uid = doc
    seen = streaming("Could you tell me more?")
    final = parse_sse(ask(c, question=WEAK).text)[-1][1]
    assert final["needs_clarification"] is True and final["blocked"] is False and final["rewards"] is None
    assert "If relevant, explain it. Otherwise, ask the user to clarify." in seen[0]["context"]
    assert [a for a, _ in activity(SID1, uid)] == ["query", "response"]


def test_plain_chat_gate_and_clarification_behave_as_before(doc, fake_llm):
    c, _ = doc
    weak = c.post("/chat", json={"question": WEAK, "session_id": SID1}).json()
    assert weak["needs_clarification"] is True and weak["content"] == "stub answer" and "rewards" not in weak
    strong = c.post("/chat", json={"question": QUESTION, "session_id": SID1}).json()
    assert "needs_clarification" not in strong and "blocked" not in strong and strong["sources"]


def test_gate_thresholds_are_read_from_settings(doc, fake_llm, monkeypatch):
    c, _ = doc
    from services import context_service
    strict = dataclasses.replace(context_service.settings, relevance_block_below=0.9, relevance_clarify_below=0.95)
    monkeypatch.setattr(context_service, "settings", strict)
    assert c.post("/chat", json={"question": QUESTION, "session_id": SID1}).json()["blocked"] is True


def test_topic_gate_for_quiz_notes_and_flashcards_uses_similarity_and_keeps_its_message(doc, monkeypatch):
    c, _ = doc
    expected = "Topic 'quantum chromodynamics' does not appear to be covered in your PDF. Try a topic from the document."
    bodies = [
        ("/quiz", {"topic": "quantum chromodynamics", "num_questions": 3, "question_type": "MCQ"}),
        ("/notes", {"topic": "quantum chromodynamics", "detail_level": "Simple"}),
        ("/flashcards", {"topic": "quantum chromodynamics"}),
    ]
    for path, body in bodies:
        r = c.post(path, json={**body, "session_id": SID1})
        assert r.status_code == 400, path
        assert (r.json()["error"]["code"], r.json()["error"]["message"]) == ("topic_not_found", expected), path


# ── follow-up rewriting through the API ──────────────────────────────────────
@pytest.fixture()
def retrieval_spy(monkeypatch):
    import services.context_service as cs
    queries = []

    def spy(vector_store, query, top_k=5, **kw):
        queries.append(query)
        return cs.retrieve(vector_store, query, top_k, **kw)

    monkeypatch.setattr("routers.study.retrieve", spy)
    return queries


def fake_rewriter(monkeypatch, reply="What does mitosis produce?"):
    calls = []

    async def llm(messages):
        calls.append(messages)
        return reply

    monkeypatch.setattr("routers.study.ask_llm_quick_async", llm)
    return calls


@pytest.mark.parametrize("endpoint", ["/chat", "/chat/stream"])
def test_follow_ups_are_searched_by_their_standalone_form(doc, retrieval_spy, fake_llm, streaming, monkeypatch, endpoint):
    c, _ = doc
    rewriter = fake_rewriter(monkeypatch)
    streaming("answer")
    r = c.post(endpoint, json={"question": "Why does it matter?", "session_id": SID1, "history": HISTORY})
    assert r.status_code == 200
    assert retrieval_spy == ["What does mitosis produce?"] and len(rewriter) == 1


@pytest.mark.parametrize("endpoint", ["/chat", "/chat/stream"])
def test_no_rewrite_call_without_history_or_for_self_contained_questions(doc, retrieval_spy, fake_llm, streaming, monkeypatch, endpoint):
    c, _ = doc
    rewriter = fake_rewriter(monkeypatch)
    streaming("answer")
    c.post(endpoint, json={"question": "Why does it matter?", "session_id": SID1, "history": []})
    c.post(endpoint, json={"question": "How does mitosis divide a cell into daughter cells?", "session_id": SID1, "history": HISTORY})
    assert rewriter == []
    assert retrieval_spy == ["Why does it matter?", "How does mitosis divide a cell into daughter cells?"]


def test_when_the_rewrite_fails_the_previous_question_is_added_to_the_search(doc, retrieval_spy, fake_llm):
    c, _ = doc                                                    # conftest's default rewriter always fails
    r = c.post("/chat", json={"question": "Why does it matter?", "session_id": SID1, "history": HISTORY})
    assert r.status_code == 200                                   # the chat itself is unaffected
    assert retrieval_spy == ["What is mitosis? Why does it matter?"]


def test_rewriting_can_be_switched_off_in_settings(doc, retrieval_spy, fake_llm, monkeypatch):
    c, _ = doc
    rewriter = fake_rewriter(monkeypatch)
    import routers.study as study
    monkeypatch.setattr(study, "settings", dataclasses.replace(study.settings, query_rewrite=False))
    c.post("/chat", json={"question": "Why does it matter?", "session_id": SID1, "history": HISTORY})
    assert rewriter == [] and retrieval_spy == ["Why does it matter?"]


# ── errors ───────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("exc,status,code,action", [
    (QuotaExceededError("gemini"), 429, "provider_quota", "settings"),
    (InvalidApiKeyError("gemini"), 400, "provider_key_rejected", "settings"),
    (ProviderUnreachableError("gemini"), 502, "provider_unreachable", "retry"),
    (RuntimeError("secret /srv/app sk-LEAK"), 500, "ai_request_failed", "retry"),
])
def test_a_failure_before_the_first_token_is_an_ordinary_http_error(doc, streaming, exc, status, code, action):
    c, uid = doc
    streaming(exc)
    r = ask(c)
    assert r.status_code == status and r.headers["content-type"].startswith("application/json")
    err = r.json()["error"]
    assert set(err) == {"code", "message", "action", "details", "request_id"} and (err["code"], err["action"]) == (code, action)
    assert "sk-LEAK" not in r.text and "/srv" not in r.text
    assert questions_asked(uid) == 0


def test_a_model_that_says_nothing_is_an_error(doc, streaming):
    c, _ = doc
    streaming()
    r = ask(c)
    assert r.status_code == 500 and r.json()["error"]["code"] == "ai_request_failed"


@pytest.mark.parametrize("exc,code,action", [
    (QuotaExceededError("gemini"), "provider_quota", "settings"),
    (InvalidApiKeyError("gemini"), "provider_key_rejected", "settings"),
    (ProviderUnreachableError("gemini"), "provider_unreachable", "retry"),
    (RuntimeError("secret /srv/app sk-LEAK"), "ai_request_failed", "retry"),
])
def test_a_provider_error_mid_stream_arrives_as_an_error_event(doc, streaming, exc, code, action):
    c, uid = doc
    streaming("Mito", "sis", exc, "never")
    r = ask(c)
    assert r.status_code == 200                                   # the response had already started
    frames = parse_sse(r.text)
    assert [e for e, _ in frames] == ["token", "token", "error"]
    err = frames[-1][1]["error"]
    assert set(err) == {"code", "message", "action", "details", "request_id"} and (err["code"], err["action"]) == (code, action)
    assert "sk-LEAK" not in r.text and "/srv" not in r.text and "RuntimeError" not in r.text
    # a half answer is neither logged as an answer nor rewarded
    assert questions_asked(uid) == 0 and [a for a, _ in activity(SID1, uid)] == ["query"]


def test_request_problems_are_reported_before_any_streaming_starts(doc, streaming, make_user):
    c, _ = doc
    streaming("never")
    r = ask(c, question="hi")                                     # too short
    assert (r.status_code, r.json()["error"]["code"]) == (400, "invalid_input")
    r = ask(c, sid="99999999-9999-4999-8999-999999999999")        # no such document
    assert (r.status_code, r.json()["error"]["code"]) == (400, "session_expired")
    r = ask(c, top_k=0)
    assert (r.status_code, r.json()["error"]["code"]) == (400, "invalid_input")
    other, _ = make_user()
    assert ask(other).status_code == 403                          # someone else's document
    import main
    from conftest import api_client
    assert ask(api_client(main.app)).status_code == 401           # not logged in


def test_a_document_that_is_still_processing_cannot_be_streamed_from(make_user, pdf_bytes, streaming):
    c, _ = make_user()
    upload(c, SID1, pdf_bytes, wait=False)
    assert state.documents.wait_idle()          # let the background job finish first, or it could overwrite the status below
    state.documents.repo.db.execute("UPDATE documents SET status = 'indexing' WHERE id = ?", (SID1,))
    streaming("never")
    r = ask(c)
    assert (r.status_code, r.json()["error"]["code"]) == (409, "document_not_ready")


# ═══════════════════════════ the event loop stays free ═══════════════════════
async def test_slow_retrieval_and_streaming_never_block_the_event_loop(doc, monkeypatch):
    c, _ = doc
    import main

    def slow_embed(self, text):                                   # a CPU-bound embedding, in the worker thread
        time.sleep(0.4)
        return BagOfWordsEmbeddings._vector(self, text)

    monkeypatch.setattr(BagOfWordsEmbeddings, "embed_query", slow_embed)

    async def slow_tokens(question, context, history, llm):
        for piece in ("a", "b", "c"):
            await asyncio.sleep(0.05)
            yield piece
    monkeypatch.setattr("routers.study.stream_chat_with_context", slow_tokens)

    worst = 0.0
    stop = asyncio.Event()

    async def heartbeat():
        nonlocal worst
        last = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            worst, last = max(worst, now - last), now

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://testserver{API_PREFIX}", cookies=dict(c.cookies)) as ac:
        beat = asyncio.create_task(heartbeat())
        t0 = time.perf_counter()
        responses = await asyncio.gather(*[
            ac.post("/chat/stream", json={"question": QUESTION, "session_id": SID1}) for _ in range(3)])
        elapsed = time.perf_counter() - t0
        stop.set()
        await beat

    assert all(r.status_code == 200 for r in responses)
    assert [e for e, _ in parse_sse(responses[0].text)] == ["token", "token", "token", "sources"]
    assert elapsed >= 0.4                                         # the slow work really ran...
    assert worst < 0.25, f"the event loop stalled for {worst:.2f}s"   # ...while the loop kept ticking
