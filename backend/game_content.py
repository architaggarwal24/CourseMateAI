"""Static game data: backend/content/*.json, loaded and validated once at startup.

    shop.json          shop categories + every item (armor, headgear, weapons, pets, potions, titles)
    quests.json        daily / weekly / special quests, grouped by the level that unlocks them
    achievements.json  achievements and their rewards
    levels.json        XP needed per level
    rewards.json       base XP / coins and daily caps per rewarded action, tier multiplier, level-up bonus
    relics.json        Expedition relics: names, texts, shop prices and offer weights (effects are code)

Every file carries "schema_version" so the format can change without silently misreading old files.
A mistake (unknown item type, duplicate id, a field that does not exist, bad JSON ...) raises
ContentError with a message naming the file and the exact spot - state.py prints it and stops the
server at startup instead of letting a typo surface later as a wrong price or a missing item.

Changing the numbers/text in these files changes the game; nothing else needs editing - except a NEW
unlock_type, effect, quest trigger or reward action, which also needs code (see the KNOWN_* sets).
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

CONTENT_DIR = Path(__file__).resolve().parent / "content"
SCHEMA_VERSION = 1

# What the code knows how to handle. A content file naming anything else is a mistake, caught at startup.
ITEM_TYPES = ("armor", "headgear", "weapon", "pet", "potion", "title")
KNOWN_EFFECTS = frozenset({"heal_1", "hint_charge", "fifty_fifty", "xp_boost_1h", "xp_boost_2h",
                           "coin_boost_1h", "streak_freeze", "reset_daily_quests"})          # BuffService.apply_buff
KNOWN_UNLOCK_TYPES = frozenset({"total_quizzes_completed", "streak_days", "total_bosses_defeated", "current_level",
                                "best_quiz_accuracy", "nightmare_bosses_defeated"})        # AchievementService._get_stat_value
REWARD_ACTIONS = ("arena_round_complete", "boss_defeat", "quiz_complete", "chat_bundle_5",
                  "notes_generation", "flashcard_complete", "expedition_complete")          # RewardService.award
KNOWN_RELICS = frozenset({"owl_feather", "whetstone", "aegis", "phoenix_ash", "scholar_lens", "quill", "hourglass",
                          "lucky_coin", "iron_will", "focus_crystal", "vampiric_tome", "ink_bomb"})  # arena/expedition


class ContentError(Exception):
    """A content file is missing, unreadable or invalid. str(error) is written for the person editing it."""


class _Model(BaseModel):
    # Unknown keys are errors (a typo like "pricee" must not be silently ignored); no silent type coercion.
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class _File(_Model):
    schema_version: int
    notes: List[str] = []

    @model_validator(mode="after")
    def _known_version(self):
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"schema_version {self.schema_version} is not supported (this version of the app reads "
                             f"schema_version {SCHEMA_VERSION})")
        return self


def _dupes(values) -> List[str]:
    seen, dup = set(), []
    for v in values:
        if v in seen and v not in dup:
            dup.append(v)
        seen.add(v)
    return dup


# ── shop.json ─────────────────────────────────────────────────────────────────
class ItemBonus(_Model):
    """Passive bonuses of an equipped item. Every key is optional; only the keys written in the file exist."""
    xp_pct: Optional[float] = Field(default=None, ge=0)
    coin_pct: Optional[float] = Field(default=None, ge=0)
    combo_xp_pct: Optional[float] = Field(default=None, ge=0)
    arena_hints: Optional[int] = Field(default=None, ge=0)
    streak_freeze_days: Optional[int] = Field(default=None, ge=1)


class ItemBattle(_Model):
    """What an equipped item does in an arena fight. Every key is optional; only the keys written in the file exist."""
    damage_pct: Optional[float] = Field(default=None, ge=0)      # weapon: extra damage on right answers
    hp: Optional[int] = Field(default=None, ge=0)                # armor: extra hearts
    time_sec: Optional[int] = Field(default=None, ge=0)          # headgear: extra seconds per question
    strike: Optional[int] = Field(default=None, ge=0)            # pet: flat damage once the combo reaches 3


class Item(_Model):
    id: str = Field(min_length=1)
    type: Literal["armor", "headgear", "weapon", "pet", "potion", "title"]
    name: str = Field(min_length=1)
    description: str
    price: int = Field(ge=0)
    sprite: str = Field(min_length=1)
    level_required: Optional[int] = Field(default=None, ge=1)
    bonus: Optional[ItemBonus] = None
    battle: Optional[ItemBattle] = None
    consumable: bool = False
    effect: Optional[str] = None
    arena_only: bool = False

    @model_validator(mode="after")
    def _consumable_rules(self):
        if self.consumable and self.effect is None:
            raise ValueError(f"item {self.id!r} is consumable but has no effect")
        if self.effect is not None and not self.consumable:
            raise ValueError(f"item {self.id!r} has an effect but is not consumable")
        if self.effect is not None and self.effect not in KNOWN_EFFECTS:
            raise ValueError(f"item {self.id!r} has unknown effect {self.effect!r} (known: {', '.join(sorted(KNOWN_EFFECTS))})")
        if self.arena_only and not self.consumable:
            raise ValueError(f"item {self.id!r} is arena_only but not consumable")
        return self


class ShopCategory(_Model):
    id: Literal["armor", "headgear", "weapon", "pet", "potion", "title"]
    unlock_level: int = Field(ge=1)
    name: str = Field(min_length=1)
    icon: str = Field(min_length=1)
    description: str


class ShopTier(_Model):
    id: str = Field(min_length=1)
    category: str
    unlocks_at_level: int = Field(ge=1)
    items: List[Item] = Field(min_length=1)


class ShopFile(_File):
    categories: List[ShopCategory] = Field(min_length=1)
    tiers: List[ShopTier] = Field(min_length=1)

    @model_validator(mode="after")
    def _consistent(self):
        problems = []
        if d := _dupes(c.id for c in self.categories):
            problems.append(f"duplicate category id(s): {', '.join(d)}")
        if d := _dupes(t.id for t in self.tiers):
            problems.append(f"duplicate tier id(s): {', '.join(d)}")
        cats = {c.id for c in self.categories}
        for t in self.tiers:
            if t.category not in cats:
                problems.append(f"tier {t.id!r} uses category {t.category!r}, which is not in 'categories'")
            for it in t.items:
                if it.type != t.category:
                    problems.append(f"item {it.id!r} has type {it.type!r} but sits in tier {t.id!r} of category {t.category!r}")
        if d := _dupes(it.id for t in self.tiers for it in t.items):
            problems.append(f"duplicate item id(s): {', '.join(d)}")
        if problems:
            raise ValueError("; ".join(problems))
        return self


# ── quests.json ───────────────────────────────────────────────────────────────
class Quest(_Model):
    quest_type: str = Field(min_length=1)
    description: str = Field(min_length=1)
    target_count: int = Field(ge=1)
    reward_xp: int = Field(ge=0)
    reward_coins: int = Field(ge=0)
    level_required: int = Field(ge=1)
    icon: str = Field(min_length=1)
    duration: Optional[Literal["weekly"]] = None


class QuestGroup(_Model):
    id: str = Field(min_length=1)
    kind: Literal["daily", "weekly", "special"]
    min_level: Optional[int] = Field(default=None, ge=1)
    quests: List[Quest]

    @model_validator(mode="after")
    def _rules(self):
        if self.kind == "daily" and self.min_level is None:
            raise ValueError(f"daily quest group {self.id!r} needs min_level")
        if self.kind != "daily" and self.min_level is not None:
            raise ValueError(f"{self.kind} quest group {self.id!r} must not have min_level (only daily groups use it)")
        return self


class QuestsFile(_File):
    groups: List[QuestGroup] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self):
        problems = []
        if d := _dupes(g.id for g in self.groups):
            problems.append(f"duplicate quest group id(s): {', '.join(d)}")
        if d := _dupes(q.quest_type for g in self.groups for q in g.quests):
            problems.append(f"duplicate quest_type(s): {', '.join(d)}")
        if not any(g.kind == "daily" and g.quests for g in self.groups):
            problems.append("there is no daily quest at all")
        if problems:
            raise ValueError("; ".join(problems))
        return self


# ── achievements.json ─────────────────────────────────────────────────────────
class Achievement(_Model):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    unlock_type: str
    threshold: int = Field(ge=1)
    reward_xp: int = Field(ge=0)
    reward_coins: int = Field(ge=0)
    reward_cosmetic_id: Optional[str] = Field(default=None, min_length=1)
    tier: Literal["common", "rare", "epic", "legendary"]

    @model_validator(mode="after")
    def _known_unlock(self):
        if self.unlock_type not in KNOWN_UNLOCK_TYPES:
            raise ValueError(f"achievement {self.id!r} has unknown unlock_type {self.unlock_type!r} "
                             f"(known: {', '.join(sorted(KNOWN_UNLOCK_TYPES))})")
        return self

    def as_row(self) -> dict:
        """The `achievements` table row (column names of migration 0001)."""
        return {"achievement_id": self.id, "name": self.name, "description": self.description,
                "unlock_type": self.unlock_type, "unlock_threshold": self.threshold,
                "reward_xp": self.reward_xp, "reward_coins": self.reward_coins,
                "reward_cosmetic_id": self.reward_cosmetic_id, "tier": self.tier}


class AchievementsFile(_File):
    achievements: List[Achievement] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self):
        if d := _dupes(a.id for a in self.achievements):
            raise ValueError(f"duplicate achievement id(s): {', '.join(d)}")
        return self


# ── levels.json ───────────────────────────────────────────────────────────────
class LevelsFile(_File):
    xp_to_next_level: List[int] = Field(min_length=1)

    @model_validator(mode="after")
    def _positive(self):
        bad = [i + 1 for i, x in enumerate(self.xp_to_next_level) if x < 1]
        if bad:
            raise ValueError(f"xp_to_next_level must be at least 1 for every level (wrong at level(s) {bad[:5]})")
        return self


# ── rewards.json ──────────────────────────────────────────────────────────────
class ActionReward(_Model):
    xp: int = Field(ge=0)
    coins: int = Field(ge=0)
    daily_cap: int = Field(ge=1)


class TierMultiplier(_Model):
    levels_per_tier: int = Field(ge=1)
    bonus_per_tier: float = Field(ge=0)


class RewardsFile(_File):
    actions: Dict[str, ActionReward]
    tier_multiplier: TierMultiplier
    level_up_bonus_coins_per_level: int = Field(ge=0)

    @model_validator(mode="after")
    def _exact_actions(self):
        unknown = [a for a in self.actions if a not in REWARD_ACTIONS]
        missing = [a for a in REWARD_ACTIONS if a not in self.actions]
        problems = []
        if unknown:
            problems.append(f"unknown action(s) {unknown} (the app rewards: {', '.join(REWARD_ACTIONS)})")
        if missing:
            problems.append(f"missing action(s) {missing}")
        if problems:
            raise ValueError("; ".join(problems))
        return self


# ── relics.json ───────────────────────────────────────────────────────────────
class Relic(_Model):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    rarity: Literal["common", "uncommon", "rare"]
    price: int = Field(ge=0)
    weight: int = Field(ge=1)

    @model_validator(mode="after")
    def _known(self):
        if self.id not in KNOWN_RELICS:
            raise ValueError(f"unknown relic {self.id!r} (the code knows: {', '.join(sorted(KNOWN_RELICS))})")
        return self


class RelicsFile(_File):
    relics: List[Relic] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique_ids(self):
        dup = _dupes(r.id for r in self.relics)
        if dup:
            raise ValueError(f"duplicate relic id(s) {dup}")
        return self


# ── loading ───────────────────────────────────────────────────────────────────
class GameContent(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    shop: ShopFile
    quests: QuestsFile
    achievements: AchievementsFile
    levels: LevelsFile
    rewards: RewardsFile
    relics: RelicsFile


_FILES = (("shop", "shop.json", ShopFile), ("quests", "quests.json", QuestsFile),
          ("achievements", "achievements.json", AchievementsFile), ("levels", "levels.json", LevelsFile),
          ("rewards", "rewards.json", RewardsFile), ("relics", "relics.json", RelicsFile))


def _where(loc) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out or "(file)"


def _describe(name: str, exc: ValidationError) -> List[str]:
    lines = []
    for err in exc.errors():
        msg = err["msg"].removeprefix("Value error, ")
        where = _where(err["loc"])
        if err["type"] == "extra_forbidden":
            msg = "unknown field (typo? the loader accepts only the documented fields)"
        elif err["type"] == "missing":
            msg = "required field is missing"
        elif err["type"] == "literal_error":
            msg = err["msg"]
        shown = ""
        if err["type"] not in ("missing", "value_error", "extra_forbidden") and "input" in err:
            shown = f"  (got {json.dumps(err['input'], ensure_ascii=False, default=str)[:60]})"
        lines.append(f"  - {name}: {where}: {msg}{shown}")
    return lines


def load_content(directory: Union[str, Path] = CONTENT_DIR) -> GameContent:
    """Read and validate every content file. Raises ContentError listing ALL problems found."""
    directory = Path(directory)
    problems: List[str] = []
    loaded = {}
    for key, filename, model in _FILES:
        path = directory / filename
        if not path.is_file():
            problems.append(f"  - {filename}: file not found in {directory}")
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            problems.append(f"  - {filename}: not valid JSON - {exc.msg} at line {exc.lineno}, column {exc.colno}")
            continue
        except (OSError, UnicodeDecodeError) as exc:
            problems.append(f"  - {filename}: cannot be read - {exc}")
            continue
        try:
            loaded[key] = model.model_validate(raw)
        except ValidationError as exc:
            problems.extend(_describe(filename, exc))
    if problems:
        raise ContentError(f"Game content in {directory} is invalid:\n" + "\n".join(problems)
                           + "\nFix the file(s) above and start the server again.")
    return GameContent(**loaded)


@lru_cache(maxsize=1)
def get_content() -> GameContent:
    """The validated content of backend/content/ (loaded on first use, then shared)."""
    return load_content()
