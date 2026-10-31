"""Shop catalog: a thin view over backend/content/shop.json (see content.py for the format and validation)."""
from game_content import get_content


def flatten_catalog():
    """Every shop item as a flat dict (the shape the API serves), sorted by category then price."""
    shop = get_content().shop
    items = []
    for tier in shop.tiers:
        for it in tier.items:
            raw = it.model_dump(exclude_unset=True)         # only the keys the file wrote
            item_level = raw.get("level_required", tier.unlocks_at_level)
            items.append({
                **raw,
                "tier": tier.id,
                "level_required": max(item_level, tier.unlocks_at_level),
                "category": tier.category,
                "consumable": it.consumable,
                "effect": it.effect,
                "bonus": it.bonus.model_dump(exclude_unset=True) if it.bonus is not None else {},
                "battle": it.battle.model_dump(exclude_unset=True) if it.battle is not None else {},
            })
    items.sort(key=lambda x: (x["category"], x["price"]))
    return items


def get_items_by_category():
    """Group items by category for shop display, sorted by price within category."""
    by_category: dict = {}
    for item in flatten_catalog():
        by_category.setdefault(item["category"], []).append(item)
    return by_category


# Shop categories in the order the shop shows them: id -> level at which the category unlocks / its display info.
CATEGORY_UNLOCK_LEVELS = {c.id: c.unlock_level for c in get_content().shop.categories}
CATEGORY_INFO = {c.id: {"name": c.name, "icon": c.icon, "description": c.description}
                 for c in get_content().shop.categories}
