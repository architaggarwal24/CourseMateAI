from core_brains.llm_connection import ask_llm
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
