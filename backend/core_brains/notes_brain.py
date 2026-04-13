from core_brains.llm_connection import ask_llm
from prompts.notes_prompts import get_notes_prompt


def generate_notes(context: str, detail_level: str = "Normal (Simplified)") -> str:
    """Generate notes from context using appropriate detail level prompt"""

    # Get the appropriate prompt template based on detail level
    prompt_template = get_notes_prompt(detail_level)

    # Format the prompt with context
    messages = prompt_template.format_messages(context=context)

    # Generate notes using LLM
    notes = ask_llm(messages)

    return notes.strip()