"""Turn a follow-up question into a standalone search query.

"Why does it happen in prophase?" retrieves nothing useful on its own; it only makes sense with the
previous turns. Before searching, the last few turns are used to rewrite it ("Why does chromosome
condensation happen in prophase?").

Cost control - the LLM is NOT called when
  * there is no conversation yet (history is empty), or
  * the question is already self-contained (see `is_self_contained`), or
  * rewriting is switched off in settings.
When it is called it is ONE short request (no retries), and if that fails for any reason the question is
searched together with the previous student question instead - a rewrite problem never fails a chat.
"""
import logging
import re
from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

LLM = Callable[[list], Awaitable[str]]            # async: messages -> text

MAX_TURN_CHARS = 400                              # per history message shown to the rewriter
MAX_QUERY_CHARS = 400                             # longest rewrite accepted

# Words that point back at something said earlier. Deliberately generous: a false "needs rewriting" costs one
# small request, a false "self-contained" would cost retrieval quality.
_ANAPHORA = frozenset({
    "it", "its", "they", "them", "their", "theirs", "this", "that", "these", "those", "he", "she", "him", "her",
    "his", "hers", "former", "latter", "above", "previous", "earlier", "same", "another", "others",
})
# Openers that continue the conversation rather than start a topic.
_LEAD_INS = frozenset({"and", "but", "so", "also", "then", "plus", "or", "meaning", "okay", "ok", "wait",
                       "elaborate", "continue", "again", "more", "next", "example", "examples", "simplify"})
_LEAD_PHRASES = ("what about", "how about", "what else", "can you explain", "could you explain",
                 "explain more", "tell me more", "go on", "give me an example", "give an example", "any example",
                 "in more detail", "can you elaborate", "could you elaborate")
# Words that carry no topic: a question made only of these ("Why?", "How so?", "Can you explain?") says nothing
# on its own. Anything else ("mitosis", "osmosis", "entropy") is a topic.
_FILLER = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could", "would",
    "should", "will", "what", "why", "how", "when", "where", "who", "which", "whom", "whose", "of", "in", "on", "to",
    "for", "with", "as", "at", "by", "from", "about", "me", "my", "you", "your", "i", "we", "tell", "explain",
    "please", "so", "yes", "no", "mean", "means", "meant", "work", "works", "happen", "happens", "get", "gets",
})

_WORD = re.compile(r"[a-zA-Z']+")
_LABEL = re.compile(r"^\s*(?:the\s+)?(?:standalone|rewritten|reformulated)\s+question\s*[:\-]\s*", re.IGNORECASE)

SYSTEM_PROMPT = (
    "You rewrite a student's latest question so it can be understood WITHOUT the conversation.\n"
    "- Replace pronouns and references (it, they, that, the second one, ...) with what they refer to, "
    "using the conversation.\n"
    "- Keep the meaning and the language of the question. Do not answer it. Do not add facts.\n"
    "- If the question is already standalone, return it unchanged.\n"
    "Output ONLY the rewritten question on a single line."
)


@dataclass(frozen=True)
class Rewrite:
    query: str          # what to search for
    method: str         # "skipped" | "llm" | "fallback"


def is_self_contained(question: str) -> bool:
    """Cheap heuristic: can this question be searched as it is?

    Yes when it names a topic ("What is mitosis?", "Explain osmosis"), continues nothing ("And the second
    one?", "Give an example") and points back at nothing ("Why does it happen?")."""
    words = [w.lower() for w in _WORD.findall(question or "")]
    if not words:
        return False
    text = " ".join(words)
    if words[0] in _LEAD_INS or any(text.startswith(p) for p in _LEAD_PHRASES):
        return False
    if any(w in _ANAPHORA for w in words):
        return False
    return any(w not in _FILLER for w in words)         # at least one word that is a topic


def _recent(history: List[Dict], max_messages: int) -> List[Dict]:
    return [t for t in history if t.get("content")][-max_messages:]


def fallback_query(question: str, history: List[Dict]) -> str:
    """No LLM: search the previous student question together with this one."""
    for turn in reversed(history):
        if turn.get("role") == "user" and turn.get("content"):
            return f"{turn['content'][:MAX_TURN_CHARS]} {question}".strip()
    return question


def _clean(raw: str, original: str) -> str:
    """Make a model reply usable as a search query, or '' if it isn't."""
    line = next((ln.strip() for ln in (raw or "").splitlines() if ln.strip()), "")
    line = _LABEL.sub("", line).strip().strip("\"'`“”‘’ ").strip()
    if not line or len(line) > MAX_QUERY_CHARS:
        return ""
    return line


def _messages(question: str, recent: List[Dict]) -> list:
    convo = "\n".join(
        f"{'Student' if t.get('role') == 'user' else 'Tutor'}: {t['content'][:MAX_TURN_CHARS]}" for t in recent)
    return [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=f"Conversation:\n{convo}\n\nLatest question: {question}\n\nStandalone question:"),
    ]


async def standalone_question(question: str, history: List[Dict], llm: LLM, *,
                              enabled: bool = True, max_messages: int = 6) -> Rewrite:
    """The query to search with for `question`, given the conversation so far (`history` = sanitised
    [{role, content}] turns, oldest first, NOT including `question`)."""
    recent = _recent(history or [], max_messages)
    if not enabled or not recent or is_self_contained(question):
        return Rewrite(question, "skipped")
    try:
        rewritten = _clean(await llm(_messages(question, recent)), question)
    except Exception as exc:                            # quota, bad key, outage...: the answer call will report it
        logger.info("Follow-up rewrite failed (%s); using the previous question as context", type(exc).__name__)
        rewritten = ""
    if rewritten:
        return Rewrite(rewritten, "llm")
    return Rewrite(fallback_query(question, recent), "fallback")
