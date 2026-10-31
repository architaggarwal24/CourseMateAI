"""Structured output: one test matrix over every provider kind with a fake LLM that answers with valid, partly invalid,
fenced, prose-wrapped and unusable JSON; the "server rejects response_format" fallback; the arena/flashcard schemas;
the wire format real LangChain clients send; and the generated-content cache."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

import core_brains.llm_connection as lc
from core_brains.json_utils import extract_json
from core_brains.llm_connection import InvalidApiKeyError, LLMClient, StructuredOutputError, _rejects_structured_output
from core_brains.llm_schemas import (
    BattleQuiz, BossPersona, BossTaunts, FlashcardSet, QuizBatch, wire_schema,
)
from services.generation_cache import GenerationCache, cache_key

# provider id -> kind (providers.py): gemini / openai / anthropic ("claude") / openai_compat / ollama
KINDS = ["gemini", "openai", "claude", "nvidia-nim", "ollama"]
MESSAGES = [HumanMessage(content="make a quiz")]


def question(text="What divides a cell?", answer="B", options=("A. Meiosis", "B. Mitosis", "C. Osmosis", "D. Fission")):
    return {"question": text, "options": list(options), "correct_answer": answer,
            "explanation": "Because.", "difficulty": "easy"}


VALID = json.dumps({"questions": [question(), question("Where is DNA kept?", "A", ("A. Nucleus", "B. Wall", "C. Tail", "D. Lid"))]})
ONE_BAD = json.dumps({"questions": [question(), question("Broken?", "Z-nothing"), {"question": "no options"}]})
FENCED = f"```json\n{VALID}\n```"
PROSE = f"Sure! Here is your quiz:\n\n{VALID}\n\nLet me know if you want more."
TRUNCATED = VALID[: VALID.rindex('{"question"')] + '{"question": "cut off mid'
GARBAGE = "I'm sorry, I can't do that."
ALL_INVALID = json.dumps({"questions": [{"question": "x", "options": ["A. 1"], "correct_answer": "A"}]})


class FakeChat:
    """A LangChain chat model of one provider kind that answers with scripted TEXT, the way the real integration
    would hand it back: OpenAI-style / Gemini give `parsed` when the text is strict JSON, Claude answers with a
    tool call, and anything else comes back as raw text only (parsed=None) for the tolerant parser."""

    def __init__(self, kind, answers, reject_native=None):
        self.kind, self.answers, self.reject_native = kind, list(answers), reject_native
        self.native_calls, self.plain_calls, self.bound = [], [], []

    def _next(self):
        return self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]

    def _result(self, text):
        raw, parsed = AIMessage(content=text), None
        try:
            parsed = json.loads(text)
        except ValueError:
            pass
        if self.kind == "anthropic" and isinstance(parsed, dict):
            raw = AIMessage(content="", tool_calls=[{"name": "QuizBatch", "args": parsed, "id": "t1"}])
        return {"raw": raw, "parsed": parsed, "parsing_error": None if parsed is not None else ValueError("bad")}

    def with_structured_output(self, schema, method=None, include_raw=False):
        self.bound.append((schema, method, include_raw))
        outer = self

        class Bound:
            def invoke(self, messages):
                outer.native_calls.append(messages)
                if outer.reject_native:
                    raise outer.reject_native
                return outer._result(outer._next())

            async def ainvoke(self, messages):
                return self.invoke(messages)
        return Bound()

    def invoke(self, messages):
        self.plain_calls.append(messages)
        return AIMessage(content=self._next())

    async def ainvoke(self, messages):
        return self.invoke(messages)


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status_code = status


def client_for(provider, answers, reject_native=None):
    c = LLMClient.__new__(LLMClient)
    c.max_retries, c._provider, c._structured_unsupported = 3, provider, False
    c.llm = FakeChat(c.kind, answers, reject_native)
    return c


CTX = {"question_type": "MCQ"}


# ═════════════════ the matrix: every provider kind x every kind of answer ═════════════════
@pytest.mark.parametrize("provider", KINDS)
def test_kind_is_resolved_and_native_method_is_chosen(provider):
    c = client_for(provider, [VALID])
    c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    schema, method, include_raw = c.llm.bound[0]
    assert method == ("function_calling" if c.kind == "anthropic" else "json_schema")   # tool use vs json_schema
    assert include_raw
    assert schema["title"] == "QuizBatch" and "questions" in schema["properties"]
    assert c.llm.plain_calls == []                                                          # no prompted fallback needed


@pytest.mark.parametrize("provider", KINDS)
@pytest.mark.parametrize("answer", [VALID, FENCED, PROSE], ids=["valid", "fenced", "prose-wrapped"])
def test_good_answers_in_any_wrapping(provider, answer):
    out = client_for(provider, [answer]).generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert [q.correct_answer for q in out.questions] == ["Mitosis", "Nucleus"]
    assert out.questions[0].options == ["Meiosis", "Mitosis", "Osmosis", "Fission"]        # labels stripped


@pytest.mark.parametrize("provider", KINDS)
def test_invalid_questions_are_dropped_not_patched(provider):
    out = client_for(provider, [ONE_BAD]).generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert [q.question for q in out.questions] == ["What divides a cell?"]


@pytest.mark.parametrize("provider", KINDS)
def test_truncated_answer_keeps_the_complete_questions(provider):
    out = client_for(provider, [TRUNCATED]).generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(out.questions) == 1


@pytest.mark.parametrize("provider", KINDS)
def test_unusable_answer_is_asked_again_once(provider):
    c = client_for(provider, [GARBAGE, VALID])
    assert len(c.generate_structured(MESSAGES, QuizBatch, context=CTX).questions) == 2
    assert len(c.llm.native_calls) == 2


@pytest.mark.parametrize("provider", KINDS)
@pytest.mark.parametrize("bad", [GARBAGE, ALL_INVALID, "[]"], ids=["no-json", "no-valid-question", "empty-array"])
def test_persistently_unusable_answer_raises_after_one_retry(provider, bad):
    c = client_for(provider, [bad])
    with pytest.raises(StructuredOutputError):
        c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(c.llm.native_calls) == 2                      # asked, asked once more, then gave up


@pytest.mark.parametrize("provider", KINDS)
async def test_async_matches_sync(provider):
    out = await client_for(provider, [FENCED]).generate_structured_async(MESSAGES, QuizBatch, context=CTX)
    assert len(out.questions) == 2
    with pytest.raises(StructuredOutputError):
        await client_for(provider, [GARBAGE]).generate_structured_async(MESSAGES, QuizBatch, context=CTX)


# ═════════════════ servers that reject response_format → the tolerant parser ═════════════════
REJECTIONS = [
    ApiError(400, "Error code: 400 - {'error': {'message': \"Unknown parameter: 'response_format'.\"}}"),
    ApiError(422, "Unprocessable Entity: extra inputs are not permitted"),
    ApiError(400, "This model does not support json_schema response format"),
    Exception("Error 501: structured output is not supported by this server"),
]


@pytest.mark.parametrize("provider", ["nvidia-nim", "openai-compatible", "ollama", "openai", "gemini", "claude"])
@pytest.mark.parametrize("rejection", REJECTIONS)
@pytest.mark.parametrize("answer", [VALID, FENCED, PROSE], ids=["valid", "fenced", "prose-wrapped"])
def test_rejected_response_format_falls_back_to_the_tolerant_parser(provider, rejection, answer):
    c = client_for(provider, [answer], reject_native=rejection)
    out = c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(out.questions) == 2
    assert len(c.llm.plain_calls) == 1
    asked = c.llm.plain_calls[0]
    assert asked[: len(MESSAGES)] == MESSAGES and "JSON Schema" in asked[-1].content   # the schema is spelled out
    assert '"questions"' in asked[-1].content


def test_after_a_rejection_the_server_is_not_asked_natively_again():
    c = client_for("ollama", [VALID], reject_native=ApiError(400, "response_format is not supported"))
    c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(c.llm.native_calls) == 1 and len(c.llm.plain_calls) == 2


def test_fallback_still_validates_and_retries():
    c = client_for("nvidia-nim", [GARBAGE, ONE_BAD], reject_native=ApiError(400, "response_format unsupported"))
    out = c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(out.questions) == 1


async def test_fallback_in_async():
    c = client_for("ollama", [PROSE], reject_native=ApiError(400, "response_format unsupported"))
    assert len((await c.generate_structured_async(MESSAGES, QuizBatch, context=CTX)).questions) == 2


@pytest.mark.parametrize("exc", [
    ApiError(401, "Incorrect API key provided"), ApiError(403, "forbidden"),
    ApiError(429, "rate limit reached"), Exception("Connection refused"),
])
def test_other_failures_are_not_mistaken_for_a_rejected_format(exc):
    assert not _rejects_structured_output(exc)


def test_auth_error_is_reported_as_such_and_never_falls_back():
    c = client_for("openai", [VALID], reject_native=ApiError(401, "Incorrect API key provided: sk-bad"))
    with pytest.raises(InvalidApiKeyError):
        c.generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert c.llm.plain_calls == [] and not c._structured_unsupported


def test_transient_provider_error_is_retried_like_generate(monkeypatch):
    monkeypatch.setattr(lc.time, "sleep", lambda s: None)
    class Flaky(FakeChat):
        n = 0

        def with_structured_output(self, *a, **k):
            outer = self
            real = super().with_structured_output(*a, **k)

            class Bound:
                def invoke(self, messages):
                    Flaky.n += 1
                    if Flaky.n == 1:
                        raise RuntimeError("503 upstream hiccup")
                    return real.invoke(messages)
            return Bound()
    c = client_for("gemini", [VALID])
    c.llm = Flaky("gemini", [VALID])
    assert len(c.generate_structured(MESSAGES, QuizBatch, context=CTX).questions) == 2
    assert Flaky.n == 2


# ═════════════════ schemas: quiz rules, flashcards, arena ═════════════════
def test_true_false_questions_are_forced_to_true_false():
    raw = {"questions": [{"question": "The sky is blue.", "options": ["True", "False"], "correct_answer": "true"},
                         {"question": "Water is dry.", "options": ["x", "y"], "correct_answer": "no-idea"}]}
    out = QuizBatch.model_validate(raw, context={"question_type": "True/False"})
    assert [(q.options, q.correct_answer) for q in out.questions] == [(["True", "False"], "True")]


def test_mcq_with_duplicate_or_missing_options_is_dropped():
    dup = question("Dup?", "A", ("A. same", "B. same", "C. other", "D. more"))
    few = question("Few?", "A", ("A. x", "B. y", "C. z"))
    ok = question()
    out = QuizBatch.model_validate({"questions": [dup, few, ok]}, context=CTX)
    assert [q.question for q in out.questions] == ["What divides a cell?"]


def test_unknown_difficulty_becomes_medium_and_missing_explanation_gets_the_default():
    q = {**question(), "difficulty": "impossible"}
    q.pop("explanation")
    got = QuizBatch.model_validate({"questions": [q]}, context=CTX).questions[0]
    assert got.difficulty == "medium" and got.explanation == "See course material."


def test_flashcards_drop_incomplete_cards():
    deck = FlashcardSet.model_validate({"cards": [
        {"front": "Mitosis?", "back": "Cell division", "topic": "bio", "difficulty": "hard"},
        {"front": "", "back": "no front"}, {"front": "no back", "back": " "}, "junk",
        {"front": "Osmosis?", "back": "Water moves", "difficulty": "weird"}]})
    assert [(c.front, c.topic, c.difficulty) for c in deck.cards] == [("Mitosis?", "bio", "hard"), ("Osmosis?", "general", "medium")]
    with pytest.raises(Exception):
        FlashcardSet.model_validate({"cards": [{"front": "", "back": ""}]})


@pytest.mark.parametrize("provider", KINDS)
def test_flashcard_deck_through_every_provider_kind(provider):
    answer = "Here you go:\n```json\n" + json.dumps({"cards": [{"front": "F?", "back": "B", "topic": "t", "difficulty": "easy"}]}) + "\n```"
    out = client_for(provider, [answer]).generate_structured(MESSAGES, FlashcardSet)
    assert out.cards[0].front == "F?"


def test_boss_persona_keeps_only_what_was_answered_and_coerces_numbers():
    boss = BossPersona.model_validate({"name": "Mito", "max_hp": "130", "rage_threshold": "oops", "attack_names": "Slam", "extra": 1})
    assert boss.provided() == {"name": "Mito", "max_hp": 130, "rage_threshold": 0.4, "attack_names": ["Slam"], "extra": 1}


def test_boss_taunts_ignore_empty_lines():
    taunts = BossTaunts.model_validate({"intro_taunt": " Hi ", "hit_taunts": ["", "ow"], "miss_taunts": [], "defeat_taunt": None})
    assert taunts.provided() == {"intro_taunt": "Hi", "hit_taunts": ["ow"]}


def test_battle_quiz_maps_answers_drops_unmappable_and_fills_defaults():
    quiz = BattleQuiz.model_validate({"questions": [
        {"question": "Q1?", "options": ["Alpha", "Beta", "Gamma", "Delta"], "correct_answer": "C"},
        {"question": "Q2?", "options": ["Alpha", "Beta"], "correct_answer": "Omega"},
        {"question": "Q3?", "options": ["Only"], "correct_answer": "Only"},
        {"id": "keep", "question": "Q4?", "options": ["Alpha", "Beta"], "correct_answer": "beta", "concept": "c4", "hint": "h"}]})
    out = quiz.finalize("hard")["questions"]
    assert [q["question"] for q in out] == ["Q1?", "Q4?"]
    assert out[0]["correct_answer"] == "Gamma" and out[0]["difficulty"] == "hard"
    assert out[0]["explanation"] and out[0]["hint"] and out[0]["concept"] == "concept_1" and out[0]["id"]
    assert out[1]["id"] == "keep" and out[1]["correct_answer"] == "Beta" and out[1]["concept"] == "c4"


@pytest.mark.parametrize("provider", KINDS)
def test_arena_schemas_through_every_provider_kind(provider):
    quiz = {"questions": [{"question": "Q?", "options": ["a", "b", "c", "d"], "correct_answer": "b"}]}
    out = client_for(provider, [f"Prose first. {json.dumps(quiz)} done"]).generate_structured(MESSAGES, BattleQuiz)
    assert out.finalize("normal")["questions"][0]["correct_answer"] == "b"
    persona = client_for(provider, [json.dumps({"name": "Boss", "max_hp": 100})]).generate_structured(MESSAGES, BossPersona)
    assert persona.provided()["name"] == "Boss"


def test_wire_schema_is_a_flat_closed_schema_every_provider_accepts():
    for model in (QuizBatch, FlashcardSet, BossPersona, BossTaunts, BattleQuiz):
        text = json.dumps(wire_schema(model))
        assert "$ref" not in text and "$defs" not in text and '"default"' not in text and "anyOf" not in text
    q = wire_schema(QuizBatch)["properties"]["questions"]["items"]
    assert q["additionalProperties"] is False and set(q["required"]) == set(q["properties"])


# ═════════════════ the tolerant parser (what is left of the old regex code) ═════════════════
@pytest.mark.parametrize("text,expected", [
    ('{"a": 1}', {"a": 1}),
    ('```json\n{"a": [1, 2,],}\n```', {"a": [1, 2]}),
    ('Sure!\n{"a": {"b": 2}}\nHope it helps', {"a": {"b": 2}}),
    ('Result: ```{"a": "```"}``` bye', {"a": "```"}),
    ("[1, 2]", [1, 2]),
    ('{"q": [{"x": 1}, {"x": 2}, {"x": ', {"q": [{"x": 1}, {"x": 2}]}),
    ("", None), ("no json here", None),
])
def test_extract_json(text, expected):
    assert extract_json(text) == expected


# ═════════════════ the real clients: what actually goes over the wire ═════════════════
class _Server:
    """A loopback HTTP server that records requests and answers with a canned JSON body."""

    def __init__(self, respond):
        self.seen = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
                outer.seen.append((self.path, body))
                status, payload = respond(self.path, body)
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass
        self.http = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.http.server_port}"

    def close(self):
        self.http.shutdown()


def _client_with(provider, llm):
    c = LLMClient.__new__(LLMClient)
    c.max_retries, c._provider, c._structured_unsupported, c.llm = 2, provider, False, llm
    return c


def _openai_body(text):
    return {"id": "1", "object": "chat.completion", "created": 1, "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}]}


def _openai_llm(handler):
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(api_key="k", model="m", base_url="http://llm.test/v1", max_retries=0,
                      http_client=httpx.Client(transport=httpx.MockTransport(handler)),
                      http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def test_openai_clients_send_a_json_schema_response_format():
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=_openai_body(PROSE))
    out = _client_with("openai", _openai_llm(handler)).generate_structured(MESSAGES, QuizBatch, context=CTX)
    assert len(out.questions) == 2
    fmt = seen[0]["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["name"] == "QuizBatch"
    assert "questions" in fmt["json_schema"]["schema"]["properties"]


def test_openai_compatible_server_that_rejects_response_format_gets_a_prompted_request_instead():
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        if "response_format" in body:
            return httpx.Response(400, json={"error": {"message": "Unknown parameter: 'response_format'.", "type": "invalid_request_error"}})
        return httpx.Response(200, json=_openai_body(FENCED))
    c = _client_with("nvidia-nim", _openai_llm(handler))
    assert len(c.generate_structured(MESSAGES, QuizBatch, context=CTX).questions) == 2
    assert "response_format" in seen[0] and "response_format" not in seen[1]
    assert "JSON Schema" in seen[1]["messages"][-1]["content"]
    c.generate_structured(MESSAGES, QuizBatch, context=CTX)          # remembered: straight to the prompted request
    assert len(seen) == 3 and "response_format" not in seen[2]


def test_claude_is_asked_through_a_forced_tool_call():
    from langchain_anthropic import ChatAnthropic
    args = json.loads(VALID)
    srv = _Server(lambda p, b: (200, {"id": "m", "type": "message", "role": "assistant", "model": "c",
                                      "content": [{"type": "tool_use", "id": "t1", "name": "QuizBatch", "input": args}],
                                      "stop_reason": "tool_use", "usage": {"input_tokens": 1, "output_tokens": 1}}))
    try:
        llm = ChatAnthropic(api_key="k", model="claude-sonnet-4-5", anthropic_api_url=srv.url, max_retries=0)
        out = _client_with("claude", llm).generate_structured(MESSAGES, QuizBatch, context=CTX)
    finally:
        srv.close()
    assert len(out.questions) == 2
    body = srv.seen[0][1]
    assert body["tool_choice"] == {"type": "tool", "name": "QuizBatch"} and body["tools"][0]["name"] == "QuizBatch"


def test_gemini_is_asked_with_a_response_schema():
    from langchain_google_genai import ChatGoogleGenerativeAI
    srv = _Server(lambda p, b: (200, {"candidates": [{"content": {"parts": [{"text": FENCED}], "role": "model"}, "finishReason": "STOP"}],
                                      "usageMetadata": {"promptTokenCount": 1, "candidatesTokenCount": 1, "totalTokenCount": 2}}))
    try:
        llm = ChatGoogleGenerativeAI(google_api_key="k", model="gemini-2.5-flash", base_url=srv.url, max_retries=0)
        out = _client_with("gemini", llm).generate_structured(MESSAGES, QuizBatch, context=CTX)
    finally:
        srv.close()
    assert len(out.questions) == 2
    cfg = srv.seen[0][1]["generationConfig"]
    assert cfg["responseMimeType"] == "application/json"
    assert "questions" in (cfg.get("responseJsonSchema") or cfg.get("responseSchema"))["properties"]


# ═════════════════ the generated-content cache ═════════════════
class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


def key(**over):
    base = dict(user_id=1, file_hash="h1", topic="Mitosis", options={"n": 5}, model="gemini:flash")
    return cache_key("quiz", **{**base, **over})


def test_cache_hit_expiry_and_private_copies():
    clock = Clock()
    cache = GenerationCache(ttl_seconds=60, clock=clock)
    cache.put(key(), {"questions": [1]})
    got = cache.get(key())
    got["questions"].append(2)                                      # callers add per-request fields
    assert cache.get(key()) == {"questions": [1]}
    clock.now += 61
    assert cache.get(key()) is None


def test_cache_ttl_zero_disables_it():
    cache = GenerationCache(ttl_seconds=0)
    cache.put(key(), "x")
    assert cache.get(key()) is None


def test_cache_key_separates_document_topic_options_model_and_user():
    base = key()
    assert key(topic=" mitosis ") == base                             # case / spaces do not matter
    for other in (key(file_hash="h2"), key(topic="Meiosis"), key(options={"n": 6}), key(model="openai:gpt"), key(user_id=2)):
        assert other != base


def test_cache_is_bounded():
    cache = GenerationCache(ttl_seconds=60, max_entries=2)
    for i in range(3):
        cache.put(key(topic=f"t{i}"), i)
    assert cache.get(key(topic="t0")) is None and cache.get(key(topic="t2")) == 2


# ═════════════════ the cache in the endpoints ═════════════════
SID = "33333333-3333-4333-8333-333333333333"


def _setup(make_user, pdf_bytes, monkeypatch):
    from test_api import upload
    c, _ = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    calls = {"quiz": 0, "cards": 0, "notes": 0}

    async def fake_quiz(context, num_questions, question_type):
        calls["quiz"] += 1
        return {"questions": [{"id": 1, "question": "Q?", "options": ["a", "b", "c", "d"], "correct_answer": "a",
                               "explanation": "e", "difficulty": "easy"}]}

    def fake_cards(context, topic, num_cards=10):
        calls["cards"] += 1
        return {"cards": [{"id": 1, "front": "f", "back": "b", "topic": "t", "difficulty": "easy"}], "total": 1, "topic": topic}

    def fake_notes(context, detail_level=""):
        calls["notes"] += 1
        return f"# notes {calls['notes']}"
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    monkeypatch.setattr("routers.study.generate_flashcards", fake_cards)
    monkeypatch.setattr("routers.study.generate_notes", fake_notes)
    return c, calls


def test_identical_requests_reuse_the_generated_content(make_user, pdf_bytes, monkeypatch):
    c, calls = _setup(make_user, pdf_bytes, monkeypatch)
    quiz = {"topic": "mitosis", "num_questions": 3, "question_type": "MCQ", "session_id": SID}
    cards = {"topic": "mitosis", "session_id": SID, "num_cards": 5}
    notes = {"topic": "mitosis", "detail_level": "Simple", "session_id": SID}

    first = [c.post("/quiz", json=quiz), c.post("/flashcards", json=cards), c.post("/notes", json=notes)]
    again = [c.post("/quiz", json=quiz), c.post("/flashcards", json=cards), c.post("/notes", json=notes)]
    for r in first + again:
        assert r.status_code == 200, r.text
    assert calls == {"quiz": 1, "cards": 1, "notes": 1}
    assert again[0].json()["content"] == first[0].json()["content"] and again[0].json()["sources"] == first[0].json()["sources"]
    assert again[2].json()["content"] == first[2].json()["content"] == "# notes 1"
    assert again[1].json()["cards"] == first[1].json()["cards"]


def test_different_options_topic_or_model_are_generated_again(make_user, pdf_bytes, monkeypatch):
    c, calls = _setup(make_user, pdf_bytes, monkeypatch)
    quiz = {"topic": "mitosis", "num_questions": 3, "question_type": "MCQ", "session_id": SID}
    assert c.post("/quiz", json=quiz).status_code == 200
    assert c.post("/quiz", json={**quiz, "num_questions": 4}).status_code == 200
    assert c.post("/quiz", json={**quiz, "question_type": "True/False"}).status_code == 200
    assert c.post("/quiz", json={**quiz, "topic": "cell division"}).status_code == 200
    assert calls["quiz"] == 4
    monkeypatch.setattr("routers.study.request_model_id", lambda: "gemini:another-model")
    assert c.post("/quiz", json=quiz).status_code == 200
    assert calls["quiz"] == 5


def test_expired_entries_are_generated_again(make_user, pdf_bytes, monkeypatch):
    c, calls = _setup(make_user, pdf_bytes, monkeypatch)
    clock = Clock()
    monkeypatch.setattr(state_cache(), "_clock", clock)
    monkeypatch.setattr(state_cache(), "ttl", 60)
    body = {"topic": "mitosis", "detail_level": "Simple", "session_id": SID}
    c.post("/notes", json=body), c.post("/notes", json=body)
    assert calls["notes"] == 1
    clock.now += 61
    assert c.post("/notes", json=body).json()["content"] == "# notes 2"


def test_a_reply_that_earned_rewards_is_still_per_request(make_user, pdf_bytes, monkeypatch):
    """The cached text is shared, the rewards/quest bookkeeping is not."""
    c, calls = _setup(make_user, pdf_bytes, monkeypatch)
    body = {"topic": "mitosis", "session_id": SID, "num_cards": 5}
    first, second = c.post("/flashcards", json=body).json(), c.post("/flashcards", json=body).json()
    assert calls["cards"] == 1
    assert first.get("rewards") and second.get("rewards")


def test_another_users_identical_request_is_not_served_from_my_cache(make_user, pdf_bytes, monkeypatch):
    from test_api import upload
    c, calls = _setup(make_user, pdf_bytes, monkeypatch)
    body = {"topic": "mitosis", "detail_level": "Simple", "session_id": SID}
    c.post("/notes", json=body)
    other, _ = make_user()
    sid2 = "44444444-4444-4444-8444-444444444444"
    upload(other, sid2, pdf_bytes)
    other.post("/notes", json={**body, "session_id": sid2})
    assert calls["notes"] == 2


def state_cache():
    import state
    return state.generation_cache
