"""Follow-up questions are rewritten into standalone ones with ONE cheap LLM call - and only when needed."""
import pytest

from core_brains import query_rewriter as qr
from core_brains.query_rewriter import fallback_query, is_self_contained, standalone_question

HISTORY = [
    {"role": "user", "content": "What is mitosis?"},
    {"role": "assistant", "content": "Mitosis is the process in which one cell divides into two identical cells."},
]


class FakeLLM:
    """Records every call; replies with `reply` (or raises it)."""

    def __init__(self, reply="What happens during the prophase stage of mitosis?"):
        self.reply, self.calls = reply, []

    async def __call__(self, messages):
        self.calls.append(messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply

    def prompt_text(self) -> str:
        return "\n".join(m.content for m in self.calls[-1])


# ═══════════════════════════ when the LLM is NOT called ═══════════════════════
@pytest.mark.parametrize("question", ["Why?", "What about its structure?", "How does mitosis work?"])
async def test_no_history_means_no_llm_call(question):
    llm = FakeLLM()
    out = await standalone_question(question, [], llm)
    assert (out.query, out.method) == (question, "skipped") and llm.calls == []


@pytest.mark.parametrize("question", [
    "How does mitosis divide a cell into two daughter cells?",
    "Explain the role of the spindle apparatus during anaphase",
    "List the four phases of the cell cycle in order",
])
async def test_self_contained_questions_are_searched_as_they_are(question):
    llm = FakeLLM()
    out = await standalone_question(question, HISTORY, llm)
    assert (out.query, out.method) == (question, "skipped") and llm.calls == []


async def test_rewriting_can_be_switched_off():
    llm = FakeLLM()
    out = await standalone_question("Why does it happen?", HISTORY, llm, enabled=False)
    assert (out.query, out.method) == ("Why does it happen?", "skipped") and llm.calls == []


async def test_history_without_content_counts_as_empty():
    llm = FakeLLM()
    out = await standalone_question("Why?", [{"role": "user", "content": ""}], llm)
    assert out.method == "skipped" and llm.calls == []


@pytest.mark.parametrize("question,expected", [
    ("How does mitosis divide a cell into two daughter cells?", True),
    ("What is mitosis?", True),                                 # short, but it names its topic
    ("Explain osmosis", True),
    ("Define entropy", True),
    ("Describe the structure of a chromosome during metaphase", True),
    ("Why?", False),                                           # says nothing on its own
    ("How so?", False),
    ("Can you explain?", False),
    ("And the second one?", False),                            # continues the conversation
    ("Give an example", False),
    ("Elaborate", False),
    ("What about the structure of the membrane?", False),      # "what about ..."
    ("Why does it happen in prophase?", False),                # points back with a pronoun
    ("How do they differ from meiosis in humans?", False),
    ("Explain that again", False),
])
def test_self_contained_heuristic(question, expected):
    assert is_self_contained(question) is expected


# ═══════════════════════════ when it IS called ═══════════════════════════════
async def test_a_follow_up_is_rewritten_with_one_call_that_sees_the_recent_turns():
    llm = FakeLLM("What happens during the prophase stage of mitosis?")
    out = await standalone_question("Why does it happen in prophase?", HISTORY, llm)
    assert (out.query, out.method) == ("What happens during the prophase stage of mitosis?", "llm")
    assert len(llm.calls) == 1                                  # exactly one call
    prompt = llm.prompt_text()
    assert "Student: What is mitosis?" in prompt and "Tutor: Mitosis is the process" in prompt
    assert "Latest question: Why does it happen in prophase?" in prompt


async def test_only_the_last_few_messages_are_sent():
    long = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"message number {i}"} for i in range(12)]
    llm = FakeLLM()
    await standalone_question("And why is that?", long, llm, max_messages=4)
    prompt = llm.prompt_text()
    assert "message number 11" in prompt and "message number 8" in prompt
    assert "message number 7" not in prompt and "message number 0" not in prompt


async def test_long_turns_are_truncated_to_keep_the_call_cheap():
    huge = [{"role": "assistant", "content": "x" * 5000}, {"role": "user", "content": "ok"}]
    llm = FakeLLM()
    await standalone_question("Why is that?", huge, llm)
    assert len(llm.prompt_text()) < qr.MAX_TURN_CHARS * 2 + 1000


@pytest.mark.parametrize("raw,expected", [
    ('"What happens in prophase?"', "What happens in prophase?"),
    ("Standalone question: What happens in prophase?", "What happens in prophase?"),
    ("Rewritten question - What happens in prophase?\nThis question asks about prophase.", "What happens in prophase?"),
    ("\n\n  What happens in prophase?  \n", "What happens in prophase?"),
    ("“What happens in prophase?”", "What happens in prophase?"),
])
async def test_the_model_reply_is_cleaned_into_a_single_query(raw, expected):
    out = await standalone_question("Why does it happen?", HISTORY, FakeLLM(raw))
    assert (out.query, out.method) == (expected, "llm")


# ═══════════════════════════ failures never fail the chat ════════════════════
@pytest.mark.parametrize("reply", [RuntimeError("provider down"), "", "   \n ", "x" * 1000])
async def test_a_failed_or_unusable_rewrite_falls_back_to_the_previous_question(reply):
    llm = FakeLLM(reply)
    out = await standalone_question("Why does it happen?", HISTORY, llm)
    assert out.method == "fallback"
    assert out.query == "What is mitosis? Why does it happen?"     # last student question + this one
    assert len(llm.calls) == 1                                       # and no second attempt


def test_fallback_without_a_previous_student_turn_is_the_question_itself():
    assert fallback_query("Why?", [{"role": "assistant", "content": "Hello!"}]) == "Why?"
    assert fallback_query("Why?", HISTORY) == "What is mitosis? Why?"
