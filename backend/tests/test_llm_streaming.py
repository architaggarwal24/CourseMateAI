"""The streaming LLM layer: token pieces, <think> filtering, retry rules, error classification."""
import asyncio

import pytest

from core_brains import llm_connection as lc
from core_brains.llm_connection import (
    EmptyModelResponse, InvalidApiKeyError, LLMClient, ProviderUnreachableError, QuotaExceededError, _ThinkFilter,
)


class Chunk:
    def __init__(self, content):
        self.content = content


class ScriptedLLM:
    """Stands in for a LangChain chat model: each astream() call plays the next scripted attempt.
    An attempt is a list of chunk contents; an Exception in the list is raised at that point."""

    def __init__(self, *attempts):
        self.attempts, self.calls, self.closed = list(attempts), 0, 0

    async def astream(self, messages):
        script = self.attempts[min(self.calls, len(self.attempts) - 1)]
        self.calls += 1
        try:
            for item in script:
                if isinstance(item, Exception):
                    raise item
                yield Chunk(item)
        finally:
            self.closed += 1


@pytest.fixture()
def sleeps(monkeypatch):
    waited = []

    async def fake_sleep(seconds):
        waited.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return waited


def client(llm, retries=3):
    c = object.__new__(LLMClient)
    c.max_retries, c._provider, c.llm = retries, "gemini", llm
    return c


async def collect(c):
    return [p async for p in c.stream_async(["hi"])]


# ═══════════════════════════ pieces ══════════════════════════════════════════
async def test_pieces_arrive_in_order_and_content_blocks_are_flattened():
    llm = ScriptedLLM(["Mito", "sis ", [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "is division"}]])
    assert await collect(client(llm)) == ["Mito", "sis ", "is division"]


async def test_empty_pieces_are_not_forwarded():
    assert await collect(client(ScriptedLLM(["a", "", None, "b"]))) == ["a", "b"]


# ═══════════════════════════ <think> blocks ══════════════════════════════════
def run_filter(*chunks):
    f = _ThinkFilter()
    out = [f.feed(c) for c in chunks] + [f.flush()]
    return "".join(out)


@pytest.mark.parametrize("chunks,expected", [
    (["plain answer"], "plain answer"),
    (["<think>plan</think>The answer"], "The answer"),
    (["<think>pla", "nning</think>\n\nThe ans", "wer is 42"], "The answer is 42"),
    (["Hello <th", "ink>secret</thi", "nk> world"], "Hello  world"),                 # tag split across chunks, both tags
    (["<THINK>x</Think>y"], "y"),                                                     # case-insensitive
    (["a<think>1</think>b<think>2</think>c"], "abc"),                                  # several blocks
    (["x < y and 3 <thin"], "x < y and 3 <thin"),                                      # a lookalike is ordinary text
    (["<think>never closed"], ""),                                                     # unfinished reasoning is dropped
    (["  \n  indented answer"], "indented answer"),                                    # leading whitespace trimmed
])
def test_think_blocks_are_removed_even_when_split_across_chunks(chunks, expected):
    assert run_filter(*chunks) == expected


def test_nothing_of_the_reasoning_leaks_one_character_at_a_time():
    text = "<think>secret plan</think>Answer"
    assert run_filter(*list(text)) == "Answer"


async def test_a_stream_of_only_reasoning_counts_as_empty(sleeps):
    with pytest.raises(EmptyModelResponse):
        await collect(client(ScriptedLLM(["<think>all I did was think</think>"])))


# ═══════════════════════════ retries & classification ════════════════════════
async def test_a_failure_before_any_output_is_retried(sleeps):
    llm = ScriptedLLM([RuntimeError("flaky network blip")], ["ok"])
    assert await collect(client(llm)) == ["ok"]
    assert llm.calls == 2 and sleeps == [1]


async def test_a_failure_after_output_is_not_retried(sleeps):
    llm = ScriptedLLM(["Hel", RuntimeError("boom")], ["never used"])
    got, c = [], client(llm)
    with pytest.raises(RuntimeError, match="boom"):
        async for piece in c.stream_async(["hi"]):
            got.append(piece)
    assert got == ["Hel"] and llm.calls == 1 and sleeps == []                         # re-sending would duplicate text


@pytest.mark.parametrize("message,error", [
    ("429 Too Many Requests", QuotaExceededError),
    ("You exceeded your current quota", QuotaExceededError),
    ("Incorrect API key provided", InvalidApiKeyError),
    ("401 Unauthorized", InvalidApiKeyError),
])
async def test_quota_and_key_errors_are_raised_at_once_before_or_after_output(message, error, sleeps):
    before = ScriptedLLM([RuntimeError(message)], ["never"])
    with pytest.raises(error):
        await collect(client(before))
    assert before.calls == 1 and sleeps == []                                          # no pointless retries

    after = ScriptedLLM(["Hel", RuntimeError(message)])
    with pytest.raises(error):
        await collect(client(after))


async def test_exhausted_retries_on_a_connection_problem_say_the_provider_is_unreachable(sleeps):
    llm = ScriptedLLM([ConnectionError("Connection error.")])
    with pytest.raises(ProviderUnreachableError):
        await collect(client(llm))
    assert llm.calls == 3 and sleeps == [1, 2]


async def test_an_empty_answer_is_an_error_not_a_silent_success(sleeps):
    with pytest.raises(EmptyModelResponse):
        await collect(client(ScriptedLLM([])))


async def test_closing_the_stream_early_closes_the_underlying_model_stream():
    llm = ScriptedLLM(["one", "two", "three"])
    agen = client(llm).stream_async(["hi"])
    assert await anext(agen) == "one"
    await agen.aclose()
    assert llm.closed == 1


# ═══════════════════════════ request settings helpers ════════════════════════
def test_snapshot_needs_a_key_and_captures_the_request_settings():
    lc.clear_request_key()
    with pytest.raises(ValueError, match="No API key"):
        lc.snapshot_request_llm()
    lc.set_request_key("sk-abc", "openai", "gpt-x", "https://llm.example/v1")
    try:
        assert lc.snapshot_request_llm() == {
            "api_key": "sk-abc", "provider": "openai", "model": "gpt-x", "base_url": "https://llm.example/v1"}
    finally:
        lc.clear_request_key()


async def test_the_quick_call_makes_a_single_attempt(monkeypatch):
    seen = {}

    class Stub:
        async def generate_async(self, messages, max_attempts=None):
            seen["attempts"] = max_attempts
            return "rewritten"

    monkeypatch.setattr(lc, "get_or_create_client", lambda *a, **k: Stub())
    lc.set_request_key("sk-abc", "gemini")
    try:
        assert await lc.ask_llm_quick_async(["m"]) == "rewritten"
    finally:
        lc.clear_request_key()
    assert seen["attempts"] == 1


async def test_stream_llm_with_key_passes_pieces_through(monkeypatch):
    class Stub:
        async def stream_async(self, messages):
            for p in ("a", "b"):
                yield p

    monkeypatch.setattr(lc, "get_or_create_client", lambda *a, **k: Stub())
    assert [p async for p in lc.stream_llm_with_key(["m"], "k", "gemini")] == ["a", "b"]
