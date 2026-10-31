from core_brains.llm_connection import ask_llm, stream_llm_with_key
from prompts.chat_prompts import build_chat_prompts


def chat_with_context(question: str, context: str, history: list = None) -> str:
    """
    Generate a chat response grounded in the provided context.

    Args:
        question:  The student's question.
        context:   Retrieved document context from the vector store.
        history:   Prior conversation turns as a list of {role, content} dicts.
                   Defaults to an empty list (stateless call).
    """
    if history is None:
        history = []

    messages = build_chat_prompts(
        context=context,
        question=question,
        history=history,
    )
    return ask_llm(messages)


async def stream_chat_with_context(question: str, context: str, history: list, llm: dict):
    """Same prompt as chat_with_context, but yields the answer piece by piece as the model writes it.

    `llm` is the request's settings captured up front (core_brains.llm_connection.snapshot_request_llm): a
    streaming response outlives the request's dependencies, so nothing is read from context variables here."""
    messages = build_chat_prompts(context=context, question=question, history=history or [])
    async for piece in stream_llm_with_key(messages, **llm):
        yield piece
