import json
import re
from core_brains.llm_connection import ask_llm
from prompts.flashcard_prompts import FLASHCARD_PROMPT
from langchain_core.messages import SystemMessage, HumanMessage


def generate_flashcards(context: str, topic: str, num_cards: int = 10) -> dict:
    """Generate flashcards from PDF context."""
    system_prompt = FLASHCARD_PROMPT.format(num_cards=num_cards + 3)
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"Topic: {topic}\n\nContent:\n{context[:5000]}"),
    ]
    raw = ask_llm(messages)

    try:
        cards = _parse_cards(raw)
    except Exception:
        # Retry with stricter prompt
        fix_msg = [
            SystemMessage(content="Return ONLY valid JSON, nothing else."),
            HumanMessage(content=f"Fix this JSON so it matches the format with a 'cards' array:\n{raw[:2000]}"),
        ]
        raw2 = ask_llm(fix_msg)
        cards = _parse_cards(raw2)

    # Trim to requested count and ensure IDs are sequential
    cards = cards[:num_cards]
    for i, card in enumerate(cards):
        card["id"] = i + 1

    return {"cards": cards, "total": len(cards), "topic": topic}


def _parse_cards(text: str) -> list:
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("No JSON object found")
    data = json.loads(match.group())
    cards = data.get("cards", [])
    if not cards:
        raise ValueError("No cards found")
    validated = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        front = str(c.get("front", "")).strip()
        back = str(c.get("back", "")).strip()
        if not front or not back:
            continue
        validated.append({
            "id": c.get("id", len(validated) + 1),
            "front": front,
            "back": back,
            "topic": str(c.get("topic", "general")).strip(),
            "difficulty": c.get("difficulty", "medium") if c.get("difficulty") in ("easy", "medium", "hard") else "medium",
        })
    return validated