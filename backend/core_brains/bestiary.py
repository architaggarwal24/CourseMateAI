"""The arena's bestiary: mythic creatures every boss is drawn from.

A boss used to be invented from scratch by the LLM (two slow calls before the fight could start). Now the creature is
picked here instantly - by the topic's words, else by a stable hash of the topic - and the LLM only writes a short
flavour layer on top (title, attack names, a few lines). If that call is slow or fails, the creature's own lines are
used, so a summon never waits on the model for more than FLAVOR_TIMEOUT seconds.

`species` is what the browser draws: frontend/src/lib/pixel/bestiary.ts has a sprite for every id below."""
from __future__ import annotations

import hashlib
import re
from typing import Dict, List

# id -> creature. keywords: lower-case stems matched against the topic's words.
CREATURES: Dict[str, dict] = {
    "hydra": {
        "name": "Hydra", "origin": "Greek",
        "keywords": ["biolog", "biochem", "cell", "gene", "evolut", "organ", "anatom", "medic", "disease", "virus", "immun",
                     "branch", "recurs", "tree", "growth"],
        "attacks": ["Twin-Fang Bite", "Venom Torrent", "Coil Crush"],
        "special": "Regrowth",
        "intro": "Cut one head and two return. So it goes with {topic}.",
        "hit": ["A head falls... another stirs.", "You cut true. It will not last.", "Hssss! You know this part."],
        "miss": ["Wrong! My heads multiply on your mistakes.", "Every error feeds me.", "Again you miss the root of {topic}."],
        "rage": "ALL HEADS AWAKEN!",
        "defeat": "No head left to grow... you mastered {topic}.",
    },
    "minotaur": {
        "name": "Minotaur", "origin": "Greek",
        "keywords": ["algorithm", "graph", "network", "maze", "path", "program", "comput", "code", "data", "struct",
                     "search", "logic", "system"],
        "attacks": ["Labyrinth Charge", "Horn Gore", "Axe Cleave"],
        "special": "Endless Labyrinth",
        "intro": "You entered my labyrinth of {topic}. Few find the way out.",
        "hit": ["You found a true path!", "Grr... a clever turn.", "The thread holds. For now."],
        "miss": ["A dead end! Turn back!", "Lost in the maze of {topic}.", "My horns find the lost."],
        "rage": "THE WALLS CLOSE IN!",
        "defeat": "The labyrinth... solved...",
    },
    "cyclops": {
        "name": "Cyclops", "origin": "Greek",
        "keywords": ["optic", "light", "engineer", "machin", "mechan", "physic", "force", "energy", "electr",
                     "material", "forge", "metal", "lens"],
        "attacks": ["Boulder Hurl", "Forge Hammer", "Thunder Stomp"],
        "special": "Eye of the Forge",
        "intro": "I forged thunder itself. Your grasp of {topic} is a pebble.",
        "hit": ["My eye... you strike clear!", "A well-forged answer.", "Hmph. Sharp aim."],
        "miss": ["I see your every flaw!", "Crushed like ore.", "{topic} is not for the half-blind."],
        "rage": "THE FORGE BURNS WHITE!",
        "defeat": "My eye closes... you saw further.",
    },
    "fenrir": {
        "name": "Fenrir", "origin": "Norse",
        "keywords": ["econom", "market", "finance", "money", "trade", "war", "wars", "warfare", "politic", "law", "laws", "legal", "power", "govern",
                     "revolut", "conflict"],
        "attacks": ["Ragnarok Fang", "Frost Howl", "Chain Breaker"],
        "special": "Devour the Sun",
        "intro": "No chain held me. Will your knowledge of {topic}?",
        "hit": ["Rrrgh! A chain tightens.", "You bind me with truth.", "Sharp... like Gleipnir."],
        "miss": ["Your chains are thread!", "I smell doubt.", "The wolf feeds on wrong answers."],
        "rage": "THE CHAINS SHATTER!",
        "defeat": "Bound at last... by what you know.",
    },
    "jormungandr": {
        "name": "Jörmungandr", "origin": "Norse",
        "keywords": ["geolog", "geograph", "earth", "climate", "environment", "ecolog", "planet", "cycle", "circul", "loop",
                     "global", "world", "ocean"],
        "attacks": ["World Coil", "Poison Tide", "Tail Lash"],
        "special": "Ouroboros",
        "intro": "I circle the whole world of {topic}. You stand inside my coil.",
        "hit": ["The coil loosens!", "Hsss... you know the cycle.", "A clean strike."],
        "miss": ["Round and round your errors go.", "The tide takes the careless.", "Poisoned by a guess."],
        "rage": "THE WORLD SERPENT RISES!",
        "defeat": "The circle breaks... it ends with you.",
    },
    "kraken": {
        "name": "Kraken", "origin": "Norse",
        "keywords": ["fluid", "wave", "sea", "seas", "marine", "water", "chem", "reaction", "molecul", "solution", "acid",
                     "pressure", "deep"],
        "attacks": ["Tentacle Slam", "Ink Cloud", "Abyssal Grip"],
        "special": "Maelstrom",
        "intro": "From the depths of {topic} I rise. Can you hold your breath?",
        "hit": ["A tentacle recoils!", "You cut through the ink.", "Grrbl... correct."],
        "miss": ["Dragged down by doubt!", "Lost in the ink.", "The deep of {topic} swallows you."],
        "rage": "THE MAELSTROM OPENS!",
        "defeat": "Back to the abyss... you surfaced.",
    },
    "naga": {
        "name": "Naga", "origin": "Indian",
        "keywords": ["philosoph", "relig", "ethic", "moral", "cultur", "art", "arts", "artist", "music", "language", "literat",
                     "poet", "myth", "india"],
        "attacks": ["Serpent Coil", "Jewel Gaze", "Venom Fang"],
        "special": "Thousand-Hood Guard",
        "intro": "I guard the treasures of {topic}. Prove you are worthy.",
        "hit": ["Worthy... perhaps.", "The jewel dims at your answer.", "You honour the old knowledge."],
        "miss": ["Unworthy!", "The treasure stays hidden from you.", "You have not read deeply."],
        "rage": "THE HOODS UNFURL!",
        "defeat": "The treasure is yours. Guard it well.",
    },
    "rakshasa": {
        "name": "Rakshasa", "origin": "Indian",
        "keywords": ["psych", "mind", "behav", "social", "brain", "cognit", "illusion", "percep", "decept",
                     "persuas", "market"],
        "attacks": ["Illusion Claw", "Shapeshift Strike", "Night Feast"],
        "special": "Maya Veil",
        "intro": "Nothing in {topic} is what it seems. I am the illusion.",
        "hit": ["You see through me!", "Clever mortal.", "My veil tears."],
        "miss": ["Fooled again!", "You chase illusions.", "Ha! The obvious answer was a trap."],
        "rage": "A HUNDRED FACES, ONE HUNGER!",
        "defeat": "The illusion fades... you saw truly.",
    },
    "oni": {
        "name": "Oni", "origin": "Japanese",
        "keywords": ["sport", "health", "nutri", "exercis", "body", "muscl", "account", "business", "manage",
                     "strateg", "exam", "test"],
        "attacks": ["Kanabo Smash", "Thunder Drum", "Iron Club Sweep"],
        "special": "Oni's Wrath",
        "intro": "My club has broken a thousand scholars of {topic}.",
        "hit": ["Gwah! A solid blow!", "You fight with knowledge.", "My drum skips a beat!"],
        "miss": ["Weak! Like rice paper!", "My club laughs at you.", "Train harder at {topic}!"],
        "rage": "THE WAR DRUMS THUNDER!",
        "defeat": "Oni bows... to a true scholar.",
    },
    "kitsune": {
        "name": "Kitsune", "origin": "Japanese",
        "keywords": ["math", "algebra", "calcul", "geometr", "statist", "probab", "number", "equation", "proof",
                     "theorem", "trick", "puzzle"],
        "attacks": ["Foxfire", "Nine-Tail Whip", "Trickster's Mark"],
        "special": "Nine Flames",
        "intro": "Nine tails, nine tricks. {topic} has more than you think.",
        "hit": ["Kon! You saw my trick.", "Clever... very clever.", "A tail singed!"],
        "miss": ["Tricked!", "The foxfire leads you astray.", "Ha! Check your working."],
        "rage": "ALL NINE FLAMES BURN!",
        "defeat": "A worthy mind... I yield my tails.",
    },
    "sphinx": {
        "name": "Sphinx", "origin": "Egyptian",
        "keywords": ["riddle", "reason", "critic", "argument", "philosoph", "logic", "question", "ancient",
                     "egypt", "archae", "history"],
        "attacks": ["Riddle Strike", "Sand Talon", "Desert Roar"],
        "special": "The Final Riddle",
        "intro": "Answer my riddles of {topic}, or be devoured.",
        "hit": ["Correct. Continue.", "You reason well.", "The sands shift in your favour."],
        "miss": ["Wrong. The sands await.", "A riddle half-solved is a riddle failed.", "Think, mortal."],
        "rage": "THE FINAL RIDDLE AWAKENS!",
        "defeat": "You have answered... pass, scholar.",
    },
    "simurgh": {
        "name": "Simurgh", "origin": "Persian",
        "keywords": ["history", "knowledge", "wisdom", "educat", "learn", "teach", "literature", "astronom",
                     "star", "space", "sky", "flight"],
        "attacks": ["Gale Wing", "Ancient Screech", "Feather Storm"],
        "special": "Wisdom of Ages",
        "intro": "I have watched {topic} for three thousand years. Show me what you learned.",
        "hit": ["Wise answer.", "My feathers ruffle in respect.", "You learn quickly."],
        "miss": ["The ages forget the careless.", "Look again, young one.", "Shallow understanding."],
        "rage": "THE SKY ITSELF ROARS!",
        "defeat": "Take a feather. You have earned my wisdom.",
    },
    # The Nemesis boss: in myth Ammit devours the hearts that fail the weighing - here, the concepts you keep missing.
    "ammit": {
        "name": "Ammit", "origin": "Egyptian",
        "keywords": [],
        "attacks": ["Heart Devour", "Scale Crush", "Crocodile Maw"],
        "special": "The Weighing",
        "intro": "I remember every mistake you made. Tonight, I feast on them.",
        "hit": ["You... learned this one.", "The scale tips your way!", "Grrah! Not that heart."],
        "miss": ["The same mistake! Delicious.", "Your heart is heavy with error.", "I remember this one too."],
        "rage": "THE SCALES TIP TO RUIN!",
        "defeat": "Your heart is light... I starve.",
    },
}

NEMESIS_SPECIES = "ammit"
_PICKABLE: List[str] = [k for k in CREATURES if k != NEMESIS_SPECIES]
_HP_HINT = {"easy": 60, "medium": 90, "hard": 130, "nightmare": 180}


def _words(topic: str) -> List[str]:
    return re.findall(r"[a-z]+", (topic or "").lower())


def _matches(word: str, key: str) -> bool:
    """A topic word hits a keyword stem: short keys (sea, sky, art...) only as whole words, so "art" is not
    "article"; longer stems also match words they start ("thermodynam" in "thermodynamics")."""
    if len(key) < 4:
        return word == key
    return word.startswith(key) or (len(word) >= 5 and key.startswith(word))


def pick_species(topic: str, nemesis: bool = False) -> str:
    """The creature for a topic: most keyword hits wins; no hit (or a tie) is broken by a stable hash of the topic,
    so the same topic always summons the same creature."""
    # a Nemesis topic is built as "Nemesis: concept, concept" (routers/arena.py nemesis_topic, expedition fight_plan)
    if nemesis or (topic or "").startswith("Nemesis: "):
        return NEMESIS_SPECIES
    words = _words(topic)
    digest = int(hashlib.sha1((topic or "").strip().lower().encode()).hexdigest(), 16)
    scores = {sid: sum(1 for w in words for k in CREATURES[sid]["keywords"] if _matches(w, k)) for sid in _PICKABLE}
    best = max(scores.values()) if scores else 0
    pool = [s for s in _PICKABLE if scores[s] == best] if best > 0 else _PICKABLE
    return pool[digest % len(pool)]


def _fill(text: str, topic: str) -> str:
    return text.replace("{topic}", topic)


def base_boss(species: str, topic: str, difficulty: str) -> dict:
    """A complete boss from the creature alone - what a summon falls back to when the LLM is slow or fails."""
    c = CREATURES.get(species) or CREATURES["hydra"]
    t = (topic or "the unknown").strip()[:80]
    return {
        "species": species if species in CREATURES else "hydra",
        "origin": c["origin"],
        "name": c["name"],
        "title": f"Warden of {t}",
        "tagline": f"A {c['origin']} legend, bound to {t}",
        "personality": f"An ancient {c['name'].lower()} that guards {t}",
        "conceptual_core": f"The {c['name']} feeds on every gap in your understanding of {t}.",
        "max_hp": _HP_HINT.get(difficulty, 120),
        "rage_threshold": 0.6 if difficulty == "nightmare" else 0.4,
        "special_ability": c["special"],
        "weakness": t,
        "attack_names": list(c["attacks"]),
        "intro_taunt": _fill(c["intro"], t),
        "phase1_taunts": [_fill(x, t) for x in c["miss"][:1] + c["hit"][:1]] + [f"Show me what you know of {t}."],
        "phase2_taunts": [c["rage"], f"Now the true depths of {t}!"],
        "hit_taunts": [_fill(x, t) for x in c["hit"]],
        "miss_taunts": [_fill(x, t) for x in c["miss"]],
        "defeat_taunt": _fill(c["defeat"], t),
    }
