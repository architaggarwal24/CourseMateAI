# CourseMateAI - Item Catalog (Redesigned)
# Level gates: shop@5, armor+potions@5, headgear@7, weapons@10, pets@20, titles@30
#
# BONUS FIELD REFERENCE (applied passively when item is equipped):
#   xp_pct       : float  — extra XP multiplier bonus (0.05 = +5%)
#   coin_pct     : float  — extra coin multiplier bonus (0.05 = +5%)
#   combo_xp_pct : float  — bonus XP specifically from combo streaks
#   arena_hints  : int    — extra hint charges when entering arena
#   streak_freeze_days : int  — earn 1 streak freeze every N days of streak
#
# Consumable EFFECT FIELD (triggered once when used from inventory):
#   heal_1          — restore 1 heart in arena
#   xp_boost_1h     — +50% XP for 1 hour
#   xp_boost_2h     — +100% XP for 1 hour (double-strength elixir)
#   coin_boost_1h   — +50% coins for 1 hour
#   streak_freeze   — grant 1 streak freeze token immediately
#   reset_daily_quests — refresh daily quests right now

COSMETIC_CATALOG = {

    # =========================================================================
    # ARMOR & OUTFITS  — category unlocks at level 5
    # =========================================================================
    "armor_fighting_gi": {
        "category": "armor", "unlocks_at_level": 1,
        "items": [
            {"id": "armor_gi_white",  "type": "armor", "name": "White Karate Gi",
             "description": "Crisp white gi with crossed lapels and a black belt. A fighter's classic. Purely cosmetic.",
             "price": 0,   "sprite": "🥋", "level_required": 1},
            {"id": "armor_gi_red",    "type": "armor", "name": "Red Fighter's Hakama",
             "description": "Bare-chested warrior with wide red gi pants and a pink sash. Pure power. Purely cosmetic.",
             "price": 0,   "sprite": "🔴", "level_required": 1},
            {"id": "armor_gi_blue",   "type": "armor", "name": "Blue Fighter's Hakama",
             "description": "Bare-chested fighter with wide blue gi pants and a golden belt. Swift and precise. Purely cosmetic.",
             "price": 0,   "sprite": "🔵", "level_required": 1},
        ],
    },
    "armor_starter": {
        "category": "armor", "unlocks_at_level": 5,
        "items": [
            {"id": "armor_shirt_basic",   "type": "armor", "name": "Street Legend Tee",
             "description": "Clean white tee with a pocket detail. Classic drip, purely cosmetic.",
             "price": 50,  "sprite": "👕", "level_required": 5},
            {"id": "armor_hoodie_gray",   "type": "armor", "name": "Phantom Hoodie",
             "description": "Oversized grey hoodie with a hidden kangaroo pocket. Lowkey but iconic.",
             "price": 80,  "sprite": "🧥", "level_required": 5},
        ],
    },
    "armor_tier1": {
        "category": "armor", "unlocks_at_level": 5,
        "items": [
            {"id": "armor_robe_blue",     "type": "armor", "name": "Azure Scholar's Vestments",
             "description": "Deep sapphire robes with gold-trimmed bell sleeves. +5% XP on all activities.",
             "price": 250, "sprite": "🥋", "level_required": 6,
             "bonus": {"xp_pct": 0.05}},
            {"id": "armor_jacket_cool",   "type": "armor", "name": "Midnight Rider Jacket",
             "description": "Sleek black leather jacket with V-lapels and combat boots. +5% coins.",
             "price": 300, "sprite": "🧥", "level_required": 6,
             "bonus": {"coin_pct": 0.05}},
        ],
    },
    "armor_tier2": {
        "category": "armor", "unlocks_at_level": 5,
        "items": [
            {"id": "armor_wizard_purple",  "type": "armor", "name": "Void Weaver's Garments",
             "description": "Swirling purple robes etched with arcane runes. +10% XP on all activities.",
             "price": 800, "sprite": "🧙", "level_required": 10,
             "bonus": {"xp_pct": 0.10}},
            {"id": "armor_knight_silver",  "type": "armor", "name": "Titanfall Plate",
             "description": "Gleaming titanium plate with spiked pauldrons and sabatons. +10% coins.",
             "price": 900, "sprite": "🛡️", "level_required": 10,
             "bonus": {"coin_pct": 0.10}},
        ],
    },
    "armor_tier3": {
        "category": "armor", "unlocks_at_level": 5,
        "items": [
            {"id": "armor_knight_gold",   "type": "armor", "name": "Sol Emperor's Plate",
             "description": "Forged from solidified sunlight. Jeweled crest. +15% XP and +10% coins.",
             "price": 2500, "sprite": "⚜️", "level_required": 18,
             "bonus": {"xp_pct": 0.15, "coin_pct": 0.10}},
            {"id": "armor_dragon_scale",  "type": "armor", "name": "Ignis Wyrm Scale Mail",
             "description": "Scales harvested from a volcano dragon. Shoulder spikes glow faintly. +20% XP and +15% coins.",
             "price": 4000, "sprite": "🐉", "level_required": 22,
             "bonus": {"xp_pct": 0.20, "coin_pct": 0.15}},
            {"id": "armor_legends_mantle", "type": "armor", "name": "Astral Conqueror's Mantle",
             "description": "A robe that pulses with starlight. Worn only by those who shaped history. +30% XP and +20% coins.",
             "price": 8000, "sprite": "✨", "level_required": 28,
             "bonus": {"xp_pct": 0.30, "coin_pct": 0.20}},
        ],
    },

    # =========================================================================
    # HEADGEAR  — category unlocks at level 7
    # =========================================================================
    "headgear_fighting": {
        "category": "headgear", "unlocks_at_level": 1,
        "items": [
            {"id": "hat_headband_red",   "type": "headgear", "name": "Red Fighter's Headband",
             "description": "A bold red cloth headband worn by champions. The mark of a true martial artist. Purely cosmetic.",
             "price": 0,  "sprite": "🔴", "level_required": 1},
            {"id": "hat_headband_blue",  "type": "headgear", "name": "Blue Fighter's Headband",
             "description": "A deep blue headband — focused, calm, and ready for battle. Purely cosmetic.",
             "price": 0,  "sprite": "🔵", "level_required": 1},
            {"id": "hat_headband_white", "type": "headgear", "name": "White Headband",
             "description": "A clean white training headband. Simple. Disciplined. Purely cosmetic.",
             "price": 0,  "sprite": "⬜", "level_required": 1},
        ],
    },
    "headgear_starter": {
        "category": "headgear", "unlocks_at_level": 7,
        "items": [
            {"id": "hat_baseball_red",    "type": "headgear", "name": "Crimson Street Cap",
             "description": "Bold red snapback. Low-key flex. Purely cosmetic.",
             "price": 50,  "sprite": "🧢", "level_required": 7},
            {"id": "hat_beanie_blue",     "type": "headgear", "name": "Frostwave Beanie",
             "description": "Thick knitted winter beanie in deep ocean blue. Purely cosmetic.",
             "price": 50,  "sprite": "🎓", "level_required": 7},
        ],
    },
    "headgear_tier1": {
        "category": "headgear", "unlocks_at_level": 7,
        "items": [
            {"id": "hat_headphones",      "type": "headgear", "name": "Neural Link Headphones",
             "description": "Noise-cancelling over-ears with glowing cables. +1 free hint charge every Arena battle.",
             "price": 200, "sprite": "🎧", "level_required": 8,
             "bonus": {"arena_hints": 1}},
            {"id": "hat_wizard",          "type": "headgear", "name": "Archmage's Pointed Hat",
             "description": "Tall midnight hat with a golden constellation band. +5% XP on all activities.",
             "price": 300, "sprite": "🎩", "level_required": 9,
             "bonus": {"xp_pct": 0.05}},
        ],
    },
    "headgear_tier2": {
        "category": "headgear", "unlocks_at_level": 7,
        "items": [
            {"id": "hat_crown_bronze",    "type": "headgear", "name": "Verdant Crown of Learning",
             "description": "Bronze circlet set with emerald and sapphire gems. +5% XP and +5% coins.",
             "price": 500, "sprite": "👑", "level_required": 10,
             "bonus": {"xp_pct": 0.05, "coin_pct": 0.05}},
            {"id": "hat_ninja",           "type": "headgear", "name": "Shadow Veil Headband",
             "description": "Midnight-black cloth mask, only eyes visible. Stealth study mode. +10% XP.",
             "price": 700, "sprite": "🥷", "level_required": 12,
             "bonus": {"xp_pct": 0.10}},
        ],
    },
    "headgear_tier3": {
        "category": "headgear", "unlocks_at_level": 7,
        "items": [
            {"id": "hat_crown_silver",    "type": "headgear", "name": "Glacial Silver Crown",
             "description": "Frosted silver crown with icy-blue gems. +10% XP and +5% coins.",
             "price": 1000, "sprite": "👑", "level_required": 14,
             "bonus": {"xp_pct": 0.10, "coin_pct": 0.05}},
            {"id": "hat_samurai",         "type": "headgear", "name": "Oni-Sealed War Helm",
             "description": "Lacquered kabuto with a golden hachimaki. +10% coins and +1 arena hint.",
             "price": 1200, "sprite": "⛩️", "level_required": 15,
             "bonus": {"coin_pct": 0.10, "arena_hints": 1}},
            {"id": "hat_crown_gold",      "type": "headgear", "name": "Solaris Crown",
             "description": "Blazing gold crown radiating warm light. +15% XP and +10% coins.",
             "price": 2000, "sprite": "👑", "level_required": 18,
             "bonus": {"xp_pct": 0.15, "coin_pct": 0.10}},
        ],
    },

    # =========================================================================
    # WEAPONS  — category unlocks at level 10
    # =========================================================================
    "weapon_starter": {
        "category": "weapon", "unlocks_at_level": 10,
        "items": [
            {"id": "weapon_pencil",  "type": "weapon", "name": "Scholar's Pencil",
             "description": "The pen is mightier. A classic HB pencil, always sharp.",
             "price": 100, "sprite": "✏️", "level_required": 10},
            {"id": "weapon_ruler",   "type": "weapon", "name": "Precision Ruler",
             "description": "Steel-edged ruler. Measures angles AND opponent confidence.",
             "price": 120, "sprite": "📏", "level_required": 10},
        ],
    },
    "weapon_tier1": {
        "category": "weapon", "unlocks_at_level": 10,
        "items": [
            {"id": "weapon_sword_bronze", "type": "weapon", "name": "Dawnsteel Twin Blades",
             "description": "Bronze dual swords with leather-wrapped hilts. ✦✦ Dual wield! +5% combo XP.",
             "price": 400, "sprite": "⚔️", "level_required": 10,
             "bonus": {"combo_xp_pct": 0.05}},
            {"id": "weapon_bow",          "type": "weapon", "name": "Ashwood Recurve Bow",
             "description": "Elegant recurve bow carved from ancient ashwood. +5% XP.",
             "price": 500, "sprite": "🏹", "level_required": 11,
             "bonus": {"xp_pct": 0.05}},
            {"id": "weapon_staff_wood",   "type": "weapon", "name": "Emberwood Quarterstaff",
             "description": "Gnarled forest staff with a glowing crystal tip. +5% XP.",
             "price": 450, "sprite": "🪄", "level_required": 11,
             "bonus": {"xp_pct": 0.05}},
        ],
    },
    "weapon_tier2": {
        "category": "weapon", "unlocks_at_level": 10,
        "items": [
            {"id": "weapon_sword_silver",   "type": "weapon", "name": "Moonblade Twin Swords",
             "description": "Silver dual blades that shimmer like moonlight. ✦✦ Dual wield! +10% combo XP.",
             "price": 900, "sprite": "⚔️", "level_required": 13,
             "bonus": {"combo_xp_pct": 0.10}},
            {"id": "weapon_hammer",         "type": "weapon", "name": "Thundercrack War Hammer",
             "description": "Rune-carved warhammer that crackles with energy. +8% XP.",
             "price": 1000, "sprite": "🔨", "level_required": 14,
             "bonus": {"xp_pct": 0.08}},
            {"id": "weapon_staff_crystal",  "type": "weapon", "name": "Aqua Prism Staff",
             "description": "A crystal-topped staff refracting arcane light. +10% XP.",
             "price": 1100, "sprite": "💎", "level_required": 14,
             "bonus": {"xp_pct": 0.10}},
        ],
    },
    "weapon_tier3": {
        "category": "weapon", "unlocks_at_level": 10,
        "items": [
            {"id": "weapon_sword_excalibur","type": "weapon", "name": "Excalibur Twin Blades",
             "description": "Gold-hilted legendary swords etched with celestial runes. ✦✦ Dual wield! +15% combo XP.",
             "price": 2500, "sprite": "✨", "level_required": 18,
             "bonus": {"combo_xp_pct": 0.15}},
            {"id": "weapon_staff_legendary","type": "weapon", "name": "Infernal Codex Staff",
             "description": "A staff crowned with a swirling tome of forbidden power. +15% XP.",
             "price": 3000, "sprite": "🌟", "level_required": 20,
             "bonus": {"xp_pct": 0.15}},
        ],
    },

    # =========================================================================
    # PETS  — category unlocks at level 20
    # =========================================================================
    "pet_starter": {
        "category": "pet", "unlocks_at_level": 20,
        "items": [
            {"id": "pet_cat_orange",   "type": "pet", "name": "Pyra the Ember Cat",
             "description": "A flame-furred tabby who naps on your notes. +5% XP.",
             "price": 300, "sprite": "🐱", "level_required": 20,
             "bonus": {"xp_pct": 0.05}},
            {"id": "pet_dog_brown",    "type": "pet", "name": "Rex the Thunder Hound",
             "description": "Loyal storm-furred hound who carries your bag. +5% coins.",
             "price": 300, "sprite": "🐶", "level_required": 20,
             "bonus": {"coin_pct": 0.05}},
            {"id": "pet_owl",          "type": "pet", "name": "Athena the Celestial Owl",
             "description": "Golden-eyed scholar owl that whispers answers. +8% XP and +1 arena hint.",
             "price": 500, "sprite": "🦉", "level_required": 21,
             "bonus": {"xp_pct": 0.08, "arena_hints": 1}},
        ],
    },
    "pet_tier2": {
        "category": "pet", "unlocks_at_level": 20,
        "items": [
            {"id": "pet_panda",        "type": "pet", "name": "Kai the Storm Panda",
             "description": "A rare black-and-white panda crackling with static energy. +8% XP, +5% coins.",
             "price": 700, "sprite": "🐼", "level_required": 21,
             "bonus": {"xp_pct": 0.08, "coin_pct": 0.05}},
            {"id": "pet_fox",          "type": "pet", "name": "Zephyr the Void Fox",
             "description": "A silver-tipped fox that phases through shadows. +10% XP, auto streak freeze every 14 days.",
             "price": 900, "sprite": "🦊", "level_required": 22,
             "bonus": {"xp_pct": 0.10, "streak_freeze_days": 14}},
            {"id": "pet_unicorn",      "type": "pet", "name": "Lumis the Starbound Unicorn",
             "description": "A unicorn whose mane trails stardust. MOUNT. +12% XP and +8% coins.",
             "price": 1500, "sprite": "🦄", "level_required": 23,
             "bonus": {"xp_pct": 0.12, "coin_pct": 0.08}},
            {"id": "pet_dragon_baby",  "type": "pet", "name": "Ignis the Hatchling Dragon",
             "description": "A tiny dragon who breathes XP bubbles. MOUNT. +10% XP, +10% coins. Streak freeze every 10 days.",
             "price": 2000, "sprite": "🐲", "level_required": 24,
             "bonus": {"xp_pct": 0.10, "coin_pct": 0.10, "streak_freeze_days": 10}},
        ],
    },
    "pet_tier3": {
        "category": "pet", "unlocks_at_level": 20,
        "items": [
            {"id": "pet_phoenix",       "type": "pet", "name": "Solara the Reborn Phoenix",
             "description": "A blazing firebird reborn from ash each dawn. MOUNT. +15% XP, +10% coins. Streak freeze every 7 days.",
             "price": 3000, "sprite": "🦅", "level_required": 25,
             "bonus": {"xp_pct": 0.15, "coin_pct": 0.10, "streak_freeze_days": 7}},
            {"id": "pet_lion_golden",   "type": "pet", "name": "Aurum the Solar Lion",
             "description": "Golden-maned lion whose roar echoes across the cosmos. MOUNT. +10% XP and +20% coins.",
             "price": 4000, "sprite": "🦁", "level_required": 27,
             "bonus": {"xp_pct": 0.10, "coin_pct": 0.20}},
            {"id": "pet_dragon_ancient","type": "pet", "name": "Erebus the Elder Dragon",
             "description": "An ancient obsidian dragon older than memory itself. MOUNT. +25% XP, +20% coins. Streak freeze every 5 days.",
             "price": 6000, "sprite": "🐉", "level_required": 30,
             "bonus": {"xp_pct": 0.25, "coin_pct": 0.20, "streak_freeze_days": 5}},
        ],
    },

    # =========================================================================
    # POTIONS & CONSUMABLES  — category unlocks at level 5
    # =========================================================================
    "potions": {
        "category": "potion", "unlocks_at_level": 5,
        "items": [
            {"id": "potion_health_small", "type": "potion", "name": "Crimson Vial", "arena_only": True,
             "description": "Restore 1 heart mid-Arena battle. Use from the potion bar before you fall.",
             "price": 80,  "sprite": "🧪", "consumable": True, "effect": "heal_1",
             "level_required": 5},
            {"id": "fifty_fifty", "type": "potion", "name": "Veil of Duality", "arena_only": True,
             "description": "Tear the veil between truth and deception — 2 wrong answers crumble to dust. Arena only.",
             "price": 60,  "sprite": "⚖️", "consumable": True, "effect": "fifty_fifty",
             "level_required": 5},
            {"id": "potion_xp_boost",     "type": "potion", "name": "Sage's Elixir",
             "description": "+50% XP earned for 1 hour. The ancient taste of knowledge.",
             "price": 150, "sprite": "⚗️", "consumable": True, "effect": "xp_boost_1h",
             "level_required": 7},
            {"id": "potion_coin_boost",   "type": "potion", "name": "Midas Tonic",
             "description": "+50% coins earned for 1 hour. Everything you touch turns to gold.",
             "price": 150, "sprite": "💰", "consumable": True, "effect": "coin_boost_1h",
             "level_required": 7},
            {"id": "potion_streak_shield","type": "potion", "name": "Temporal Shield Flask",
             "description": "Grants 1 streak freeze token. Activates automatically if you miss a day — no action needed.",
             "price": 250, "sprite": "🛡️", "consumable": True, "effect": "streak_freeze",
             "level_required": 9},
            {"id": "potion_xp_boost_2h",  "type": "potion", "name": "Grand Arcane Elixir",
             "description": "+100% XP earned for 1 hour. Pure distilled brilliance.",
             "price": 400, "sprite": "🌟", "consumable": True, "effect": "xp_boost_2h",
             "level_required": 12},
            {"id": "potion_quest_reset",  "type": "potion", "name": "Chrono Vortex Flask",
             "description": "Reset your daily quests instantly. Bend time to your will.",
             "price": 600, "sprite": "⏳", "consumable": True, "effect": "reset_daily_quests",
             "level_required": 15},
        ],
    },

    # =========================================================================
    # TITLES  — category unlocks at level 30
    # =========================================================================
    "titles": {
        "category": "title", "unlocks_at_level": 30,
        "items": [
            {"id": "title_scholar",       "type": "title", "name": "📚 The Scholar",
             "description": "Earned by those who pursue knowledge relentlessly. Purely cosmetic.",
             "price": 500,  "sprite": "📚", "level_required": 30},
            {"id": "title_quiz_master",   "type": "title", "name": "🎯 Quiz Sovereign",
             "description": "Master of every quiz format. +3% XP on all activities.",
             "price": 1000, "sprite": "🎯", "level_required": 30,
             "bonus": {"xp_pct": 0.03}},
            {"id": "title_arena_champ",   "type": "title", "name": "⚔️ Arena Overlord",
             "description": "Undefeated in the arena. +5% XP and +5% coins.",
             "price": 2000, "sprite": "⚔️", "level_required": 33,
             "bonus": {"xp_pct": 0.05, "coin_pct": 0.05}},
            {"id": "title_the_eternal",   "type": "title", "name": "♾️ The Undying",
             "description": "Has outlasted civilisations. Their name echoes forever. +8% XP and +5% coins.",
             "price": 4000, "sprite": "♾️", "level_required": 36,
             "bonus": {"xp_pct": 0.08, "coin_pct": 0.05}},
            {"id": "title_dragon_slayer", "type": "title", "name": "🐉 Dragonbane",
             "description": "Slayer of ancient wyrms. Fear follows this name. +10% XP, +5% coins.",
             "price": 5000, "sprite": "🐉", "level_required": 38,
             "bonus": {"xp_pct": 0.10, "coin_pct": 0.05}},
            {"id": "title_legend",        "type": "title", "name": "👑 Living Legend",
             "description": "The ultimate achievement. Songs are written about you. +12% XP, +10% coins, +2 Arena hints.",
             "price": 10000,"sprite": "👑", "level_required": 40,
             "bonus": {"xp_pct": 0.12, "coin_pct": 0.10, "arena_hints": 2}},
        ],
    },
}


def flatten_catalog():
    """Convert nested catalog into a flat list with metadata."""
    items = []
    for tier_key, tier in COSMETIC_CATALOG.items():
        category_unlock = tier["unlocks_at_level"]
        category = tier.get("category", "misc")
        for it in tier["items"]:
            item_level = it.get("level_required", category_unlock)
            items.append({
                **it,
                "tier": tier_key,
                "level_required": max(item_level, category_unlock),
                "category": category,
                "consumable": it.get("consumable", False),
                "effect": it.get("effect", None),
                "bonus": it.get("bonus", {}),
            })
    items.sort(key=lambda x: (x["category"], x["price"]))
    return items


def get_items_by_category():
    """Group items by category for shop display, sorted by price within category."""
    items = flatten_catalog()
    by_category: dict = {}
    for item in items:
        cat = item["category"]
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(item)
    return by_category


CATEGORY_UNLOCK_LEVELS = {
    "armor":    1,   # gi outfits free from level 1; other armors gate at item level
    "potion":   5,
    "headgear": 1,   # headbands free from level 1; other headgear gates at item level
    "weapon":   10,
    "pet":      20,
    "title":    30,
}

CATEGORY_INFO = {
    "headgear": {"name": "Headgear",        "icon": "🎩", "description": "Hats, crowns & headwear — some grant Arena hint charges or XP bonuses"},
    "armor":    {"name": "Armor & Outfits", "icon": "🛡️", "description": "Outfits — expensive ones grant permanent XP & coin bonuses"},
    "weapon":   {"name": "Weapons",         "icon": "⚔️", "description": "Weapons — mid-tier+ boost XP from answer combos"},
    "pet":      {"name": "Pets",            "icon": "🐾", "description": "Companions — grant passive XP/coin bonuses & auto streak freezes"},
    "potion":   {"name": "Potions",         "icon": "🧪", "description": "Consumables — Arena heals, XP boosts, streak shields & quest resets"},
    "title":    {"name": "Titles",          "icon": "🏆", "description": "Prestige titles — rare ones grant small stat bonuses"},
}