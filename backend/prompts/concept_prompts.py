"""Prompt for the concept map: one pass per document (core_brains/concept_brain.py)."""

CONCEPT_MAP_PROMPT = """
Below are passages taken evenly from a study document, each marked with its page like [p.12].

--- DOCUMENT PASSAGES ---
{digest}
--- END PASSAGES ---

Map the document's key concepts and how they relate, for a student's concept map.

RULES:
- {min_concepts} to {max_concepts} concepts: the ideas a student must understand, not trivia. Short names
  (1-4 words, as the document names them), each with ONE plain sentence saying what it is.
- importance: 3 = a central idea of the document, 2 = important, 1 = supporting detail.
- page: the page where the concept is best explained (from the [p.N] markers).
- relations: how concepts connect, as "source" -> "target" with a short verb-phrase label ("produces",
  "is part of", "regulates", "is a type of", "contrasts with"). Only between concepts in your list. Up to {max_relations}.
- Use only what the passages say.

Return JSON only: {{"concepts": [{{"name": "...", "summary": "...", "importance": 3, "page": 4}}],
"relations": [{{"source": "...", "target": "...", "label": "..."}}]}}
"""
