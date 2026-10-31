"""Profile, rewards, daily quests, HUD and achievements."""
from fastapi import APIRouter, Depends, Request

from errors import AppError, invalid_input
from deps import get_optional_user, require_auth
from schemas import QuestClaimRequest, RewardAwardRequest
from schemas.progression import AchievementsResponse, DailyQuestsResponse, HudResponse, ProfileResponse, QuestClaimResponse, RewardResponse
from services.progression.progression import xp_progress
from services.progression.reward_service import BASE_REWARDS
from state import buff_service, quest_service, reward_service, shop_service, store

router = APIRouter()


@router.get("/profile", response_model=ProfileResponse, response_model_exclude_unset=True)
async def get_profile(request: Request):
    user = await get_optional_user(request)
    if not user:
        return {"progress": {"current_level": 1, "total_xp": 0, "coins": 0, "xp_into_level": 0, "xp_to_next": 100},
                "avatar": {}, "guest_mode": True}
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    progress = store.get_progress(user_id)
    avatar = store.get_avatar(user_id)
    lvl, into, to_next = xp_progress(int(progress.get("total_xp", 0) or 0))
    return {"progress": {**progress, "xp_into_level": into, "xp_to_next": to_next}, "avatar": avatar,
            "guest_mode": False}


@router.post("/rewards/award", response_model=RewardResponse, response_model_exclude_unset=True)
def award_rewards(req: RewardAwardRequest, user=Depends(require_auth)):
    # The browser reports an action and its own accuracy - nothing the server can verify - so no reward is
    # claimable from here. Quizzes pay out through POST /quiz/finish, which grades the answers itself.
    if req.action_type not in BASE_REWARDS:
        raise invalid_input(f"Unknown action_type: {req.action_type!r}.")
    raise AppError("reward_not_claimable", "That reward is granted by the server when you finish the activity.",
                   status_code=403)


@router.get("/daily-quests", response_model=DailyQuestsResponse, response_model_exclude_unset=True)
def get_daily_quests(user=Depends(require_auth)):
    user_id = str(user['user_id'])
    return {"quests": quest_service.get_or_create_daily_quests(user_id)}


@router.post("/daily-quests/claim", response_model=QuestClaimResponse, response_model_exclude_unset=True)
def claim_daily_quest(req: QuestClaimRequest, user=Depends(require_auth)):
    user_id = str(user['user_id'])
    # Marks the quest claimed and writes its reward event in ONE transaction; a repeat can't pay again.
    return reward_service.claim_quest(user_id, req.quest_type)


@router.get("/hud", response_model=HudResponse, response_model_exclude_unset=True)
async def get_hud(request: Request):
    user = await get_optional_user(request)

    if not user:
        return {
            "progress": {
                "current_level": 1, "total_xp": 0, "coins": 0,
                "xp_into_level": 0, "xp_to_next": 100,
                "total_chat_questions": 0, "total_quiz_questions": 0,
            },
            "quests": [],
            "shop": {"shop_unlocked": False, "level": 1, "coins": 0, "items": []},
            "guest_mode": True
        }

    user_id = str(user['user_id'])
    store.ensure_user(user_id)

    progress = store.get_progress(user_id)
    total_xp = int(progress.get("total_xp", 0) or 0)
    _, into, to_next = xp_progress(total_xp)
    progress_out = {**progress, "xp_into_level": into, "xp_to_next": to_next}

    # Pass pre-loaded progress to avoid redundant get_progress reads in sub-services
    quests = quest_service.get_or_create_daily_quests(user_id, progress=progress)

    level = int(progress.get("current_level", 1) or 1)
    if level < 5:
        shop = {"shop_unlocked": False, "level": level, "coins": int(progress.get("coins", 0) or 0), "items": []}
    else:
        shop = shop_service.get_shop_state(user_id, progress=progress)

    active_buffs = buff_service.get_active_buffs(user_id)

    # Always expose consumable inventory counts (independent of shop lock level)
    # so the sidebar can show correct totals for all users
    inv_rows = store.get_inventory(user_id)
    consumable_inventory = {r["item_id"]: int(r["quantity"]) for r in inv_rows}

    return {
        "progress": progress_out,
        "quests": quests,
        "shop": shop,
        "buffs": active_buffs,
        "consumable_inventory": consumable_inventory,
        "guest_mode": False,
    }


@router.get("/achievements", response_model=AchievementsResponse, response_model_exclude_unset=True)
async def get_achievements(request: Request):
    """Return all achievements with the user's unlock status and progress."""
    user = await get_optional_user(request)
    if not user:
        all_ach = store.get_achievements()
        return {"achievements": [dict(a) for a in all_ach], "unlocked": {}, "progress": {}, "guest_mode": True}

    user_id = str(user["user_id"])
    store.ensure_user(user_id)

    all_ach = store.get_achievements()

    rows = store.fetchall(
        "SELECT achievement_id, unlocked_at_utc FROM user_achievements WHERE user_id = ?",
        (user_id,)
    )
    unlocked = {r["achievement_id"]: r["unlocked_at_utc"] for r in rows}

    progress = store.get_progress(user_id)
    stat_map = {
        "total_quizzes_completed":   int(progress.get("total_quizzes_completed",   0) or 0),
        "streak_days":               int(progress.get("streak_days",               0) or 0),
        "total_bosses_defeated":     int(progress.get("total_bosses_defeated",      0) or 0),
        "current_level":             int(progress.get("current_level",             1) or 1),
        "best_quiz_accuracy":        int(progress.get("best_quiz_accuracy",         0) or 0),
        "nightmare_bosses_defeated": int(progress.get("nightmare_bosses_defeated",  0) or 0),
    }

    return {
        "achievements": [dict(a) for a in all_ach],
        "unlocked": unlocked,
        "progress": stat_map,
        "guest_mode": False,
    }
