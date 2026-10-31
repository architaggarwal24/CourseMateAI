BOSS_PERSONA_PROMPT = """
You are designing the IDENTITY and COMBAT MECHANICS of a boss enemy for a
Soulslike educational game. The boss is born from this academic material:

--- DOCUMENT CONTEXT ---
{context}
--- END CONTEXT ---

Boss Topic: {topic}
Difficulty: {difficulty} (easy / medium / hard / nightmare)

STEP 1 — Extract 3–5 fundamental concepts from the material. These anchor every
design decision below. Surface-level trivia won't work — choose concepts
substantial enough to define the boss's entire character and combat identity.

STEP 2 — Design the boss using those concepts:

CORE IDENTITY
- name: A dramatic, specific name derived from a PRIMARY concept in the material.
  Not generic or metaphorical — grounded in actual terminology.
- title: An epithet referencing a SECONDARY or CONTRASTING concept.
  Should feel like an earned rank, not decoration.
- conceptual_core: One sentence explaining why this boss IS this material
  (not just themed around it).

COMBAT MECHANICS
- max_hp: Scale by difficulty. Suggested: easy=60, medium=90, hard=130, nightmare=180.
  Suggested value for this difficulty: {difficulty_hp_hint}. Adjust slightly for topic complexity.
- rage_threshold: 0.3–0.5 as a decimal. HP fraction at which rage mode triggers.
  nightmare: use 0.6 (enters rage earlier).
- special_ability: A single named climactic attack derived from a key concept.
  This is the mechanic that DEFINES the fight.
- weakness: A specific concept area where the boss takes extra damage.
  Represents knowledge a student MUST master to win.
- attack_names: Array of exactly 3 attacks, each derived from DISTINCT concepts.
  They should feel mechanically and thematically different from each other.

Return ONLY valid JSON — no preamble, no explanation:
{{
  "name": "...",
  "title": "...",
  "conceptual_core": "...",
  "max_hp": 120,
  "rage_threshold": 0.4,
  "special_ability": "...",
  "weakness": "...",
  "attack_names": ["...", "...", "..."]
}}
"""


BOSS_TAUNT_PROMPT = """
You are writing ALL COMBAT DIALOGUE for a boss in a Soulslike educational game.
The boss has already been designed — your job is to give it a voice.

BOSS IDENTITY
Name: {name}
Title: {title}
Conceptual Core: {conceptual_core}
Topic / Material: {topic}

--- DOCUMENT CONTEXT ---
{context}
--- END CONTEXT ---

RULES FOR ALL DIALOGUE:
- Every line must reference SPECIFIC content from the material — not generic insults.
- The boss must sound like it genuinely understands the subject and is WEAPONIZING it.
- Do NOT use generic lines like "You dare challenge me?" or "Pathetic student."
- Beginners should understand the broad strokes; advanced learners should catch nuance.

DIALOGUE TO GENERATE:

intro_taunt (2–3 sentences):
  The boss introduces itself. Reference a specific concept or framework from the
  material. Hint at what the fight will test.

phase1_taunts (5 lines):
  Early combat. Each line should reflect a DIFFERENT emotional state:
  [0] Confident  [1] Mocking  [2] Taunting  [3] Philosophical  [4] Direct Challenge
  Each must reference a different concept from the material.

phase2_taunts (5 lines):
  Rage mode. More desperate, intense, or revealing a hidden layer tied to the topic.
  These should feel EARNED — not just angrier versions of phase 1.

hit_taunts (4 lines):
  Boss takes damage — student answered correctly.
  React with grudging respect, defiance, or frustration.
  Acknowledge the student knows something specific and correct.

miss_taunts (4 lines):
  Student answered incorrectly.
  Each line mocks a SPECIFIC knowledge gap or misconception from the material.
  Not just "you're wrong" — call out WHAT they got wrong and WHY it matters.

defeat_taunt (1 line):
  The boss's final line. Should feel thematic and earned.
  Directly reference the core concept that was its undoing.
  Choose ONE tone: mentor-like ("You've truly learned this") OR
  defiant ("I refuse to accept...") — whichever fits the boss's personality.

Return ONLY valid JSON — no preamble, no explanation:
{{
  "intro_taunt": "...",
  "phase1_taunts": ["...", "...", "...", "...", "..."],
  "phase2_taunts": ["...", "...", "...", "...", "..."],
  "hit_taunts": ["...", "...", "...", "..."],
  "miss_taunts": ["...", "...", "...", "..."],
  "defeat_taunt": "..."
}}
"""


BATTLE_QUIZ_PROMPT = """
You are generating quiz questions for a boss battle in a gamified learning system.
The student is fighting a boss and must answer correctly to deal damage.

--- DOCUMENT CONTEXT ---
{context}
--- END CONTEXT ---

Topic: {topic}
Difficulty: {difficulty}
Combat Phase: {phase}
Previously asked concepts (DO NOT repeat these): {asked_concepts}
Questions to generate: {num_questions}
{target_block}
QUESTION DESIGN RULES:
- Questions must test COMPREHENSION of the context — not trivia or memorization.
- All 4 options must be plausible. Wrong answers should represent real misconceptions.
- Distribute correct answers evenly across A, B, C, D — never cluster on one letter.
- Every question must cover a DIFFERENT concept from the others.
- Questions must be self-contained — answerable from the context alone.

DIFFICULTY CALIBRATION (very important — strictly follow this):
- easy:      80% easy questions. Simple recall and basic understanding. Clear, direct questions.
- medium:    40% easy, 60% medium — test solid understanding and application.
- hard:      30% medium, 70% hard — synthesis, application, edge cases, comparisons.
- nightmare: 100% hard/expert — counter-intuitive, exceptions, deep analysis, trap options.

Phase 2 (rage mode): Always add one difficulty tier on top of the above.
E.g. medium phase 2 = hard questions; hard phase 2 = nightmare questions.

TIER MIX (required): the player picks a move before each question and the move decides the tier it gets
(a quick Jab = easy, a Strike = medium, a Heavy blow = hard). So EVERY batch must contain all three tiers:
at least one "easy", at least one "medium" and at least one "hard" question, with the rest following the
calibration above. The tier is RELATIVE to the difficulty: an "easy" nightmare question is still demanding.
Label each question's tier honestly in its "difficulty" field.

FOR EACH QUESTION INCLUDE:
- explanation: Why the correct answer is right (brief, educational).
- hint: A nudge that helps without giving away the answer.
- concept: The specific concept this question tests (used to avoid repeats).
- difficulty: the question's tier: "easy", "medium", or "hard" (nothing else).

Return ONLY valid JSON — no preamble, no explanation:
{{
  "questions": [
    {{
      "id": "q1",
      "question": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "B) ...",
      "explanation": "...",
      "hint": "...",
      "concept": "...",
      "difficulty": "medium"
    }}
  ]
}}

IMPORTANT:
- Generate EXACTLY {num_questions} questions.
# FIX BUG 33: Both arena and regular quiz now expect correct_answer as the FULL
# option text. The _normalize_correct_answer function handles all formats (letter
# only, full text, mixed) but providing full text is most reliable.
- correct_answer must be the FULL option text (e.g. "B) Mitosis"), not just the letter.
- NEVER repeat a concept from the previously asked list.
"""

# Inserted into BATTLE_QUIZ_PROMPT as {target_block} for a Nemesis fight (empty otherwise).
NEMESIS_TARGET_BLOCK = """
NEMESIS MODE - this boss is made of the concepts THIS student keeps getting wrong:
{targets}
Every question MUST test exactly one of these concepts, and its "concept" field MUST be that concept's name
written exactly as listed. Spread the questions over all of them. Ask about them from a fresh angle (a new
scenario, a comparison, a common misconception) - repeating a concept is expected here, repeating a question is not.
"""


EXPEDITION_ACTS_PROMPT = """
You are planning an "Expedition" through a study document for a learning game: the student travels through the
document in {num_acts} acts, each act a chapter or major section, fought in reading order.

--- DOCUMENT CONTEXT (excerpts, may be out of order) ---
{context}
--- END CONTEXT ---

Pick the {num_acts} most substantial, DISTINCT parts of the material, in the order the document presents them.
For each act give:
- title: a short chapter-like title (max 60 characters), e.g. "Chapter 2: Cell Division".
- topic: a precise search topic for that part (3-8 words of the document's own terminology). It is used to pull
  the passages the act's quiz questions are written from, so it must be specific to that part.

Return ONLY valid JSON - no preamble, no explanation:
{{
  "acts": [
    {{"title": "...", "topic": "..."}}
  ]
}}
"""


BOSS_FLAVOR_PROMPT = """
A mythic creature guards a student's study material in a learning game. Give it a voice tied to the material.

Creature: {creature} ({origin} myth)
Topic: {topic}

--- MATERIAL (excerpt) ---
{context}
--- END ---

Write SHORT lines (max 14 words each) that name real concepts from the material.
- title: an epithet, e.g. "Devourer of Entropy" (max 5 words)
- conceptual_core: one sentence on why this creature embodies the topic
- weakness: one concept from the material the student must master
- special_ability: a named finishing move from a key concept (max 4 words)
- attack_names: exactly 3 attack names, each from a different concept (max 4 words each)
- intro_taunt: 1 sentence
- hit_taunts: 3 lines (the student answered right)
- miss_taunts: 3 lines (the student answered wrong; name the misconception)
- defeat_taunt: 1 sentence

Return ONLY the JSON object. No reasoning, no markdown.
"""
