"""
Quiz prompts redesigned to work identically across Mistral, Claude, OpenAI, and Gemini.

ROOT CAUSE OF OLD BUG:
The old prompts put the entire task (including a JSON example with exactly 2 items)
into the SystemMessage. Claude, Gemini, and OpenAI treat the SystemMessage as a
persona/instruction set and the HumanMessage as the actual request. When the only
content in the HumanMessage was "Generate questions from this content:\n\n{context}",
these models had no count or type instruction in the actual request — they only saw
the 2-item example and produced exactly 2 questions every time.

FIX:
- SystemMessage: role declaration + JSON schema structure only (no example data,
  so no implicit count)
- HumanMessage (built in quiz_brain.py): explicit count, explicit type, and context
  all in one place so every model receives the full task in the request turn
"""

# System message: pure role + schema. No examples with actual data (which imply a count).
MCQ_SYSTEM = """You are a quiz generator for an educational platform.
Your ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.

JSON SCHEMA (follow this structure exactly):
{
  "questions": [
    {
      "id": 1,
      "question": "Question text ending with ?",
      "options": ["A. First option", "B. Second option", "C. Third option", "D. Fourth option"],
      "correct_answer": "A",
      "explanation": "Brief explanation of why A is correct.",
      "difficulty": "easy"
    }
  ]
}

RULES:
- options must be exactly 4 strings, each prefixed with "A. ", "B. ", "C. ", or "D. "
- correct_answer must be a single letter: "A", "B", "C", or "D"
- difficulty must be one of: "easy", "medium", "hard"
- Do NOT include any text outside the JSON object"""

TF_SYSTEM = """You are a quiz generator for an educational platform.
Your ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.

JSON SCHEMA (follow this structure exactly):
{
  "questions": [
    {
      "id": 1,
      "question": "A factual statement that is either true or false.",
      "options": ["True", "False"],
      "correct_answer": "True",
      "explanation": "Brief explanation of why this is true.",
      "difficulty": "easy"
    }
  ]
}

RULES:
- options must be exactly ["True", "False"]
- correct_answer must be exactly "True" or "False"
- difficulty must be one of: "easy", "medium", "hard"
- Do NOT include any text outside the JSON object"""

MIXED_SYSTEM = """You are a quiz generator for an educational platform.
Your ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.

JSON SCHEMA — questions can be either MCQ (4 options) or True/False (2 options):
{
  "questions": [
    {
      "id": 1,
      "question": "An MCQ question?",
      "options": ["A. First option", "B. Second option", "C. Third option", "D. Fourth option"],
      "correct_answer": "B",
      "explanation": "Why B is correct.",
      "difficulty": "medium"
    },
    {
      "id": 2,
      "question": "A true/false statement.",
      "options": ["True", "False"],
      "correct_answer": "False",
      "explanation": "Why it is false.",
      "difficulty": "easy"
    }
  ]
}

RULES:
- Mix approximately half MCQ and half True/False
- MCQ: options = ["A. ...", "B. ...", "C. ...", "D. ..."], correct_answer = "A"/"B"/"C"/"D"
- True/False: options = ["True", "False"], correct_answer = "True" or "False"
- difficulty must be one of: "easy", "medium", "hard"
- Do NOT include any text outside the JSON object"""


# Human message template — count + type + content all in one place so every model
# receives the full task in the request turn (not buried in the system persona).
QUIZ_HUMAN_TEMPLATE = """Generate EXACTLY {num_questions} {question_type} questions based on the content below.

IMPORTANT: Your response must contain EXACTLY {num_questions} question objects in the "questions" array — not fewer, not more.

Content:
{context}"""


def get_quiz_system(question_type: str) -> str:
    """Return the system prompt for the given question type."""
    if question_type == "True/False":
        return TF_SYSTEM
    elif question_type == "Mixed":
        return MIXED_SYSTEM
    else:  # MCQ or default
        return MCQ_SYSTEM


def get_quiz_human(num_questions: int, question_type: str, context: str) -> str:
    """Build the human-turn message with count, type, and context."""
    type_label = {
        "MCQ": "multiple-choice (4 options each)",
        "True/False": "True/False",
        "Mixed": "mixed (half multiple-choice, half True/False)",
    }.get(question_type, "multiple-choice")
    return QUIZ_HUMAN_TEMPLATE.format(
        num_questions=num_questions,
        question_type=type_label,
        context=context,
    )