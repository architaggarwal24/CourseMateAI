from core_brains.llm_connection import generate_structured
from core_brains.llm_schemas import FlashcardSet
from prompts.flashcard_prompts import FLASHCARD_PROMPT
from langchain_core.messages import SystemMessage, HumanMessage


def generate_flashcards(context: str, topic: str, num_cards: int = 10) -> dict:
    """Generate flashcards from PDF context."""
    system_prompt = FLASHCARD_PROMPT.format(num_cards=num_cards + 3)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Topic: {topic}\n\nContent:\n{context[:5000]}"),
    ]
    deck = generate_structured(messages, FlashcardSet)       # cards without a front/back are dropped by the schema

    # Trim to requested count and number the cards
    cards = [{"id": i + 1, **card.model_dump()} for i, card in enumerate(deck.cards[:num_cards])]
    return {"cards": cards, "total": len(cards), "topic": topic}
