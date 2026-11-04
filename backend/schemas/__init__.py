"""Pydantic request models, grouped by feature. Class names are part of the OpenAPI contract."""
from .arena import BattleAnswerRequest, BattleCreateRequest, BattleItemRequest
from .auth import ApiKeyRequest, LoginRequest, RegisterRequest, UpdateProfileRequest
from .avatar import AvatarUpdateRequest, ChampionRequest
from .progression import QuestClaimRequest, RewardAwardRequest
from .shop import ShopEquipRequest, ShopPurchaseRequest, ShopUnequipRequest, UseItemRequest
from .study import ChatMessage, ChatRequest, FlashcardRequest, NotesRequest, QuizAnswerRequest, QuizFinishRequest, QuizRequest

__all__ = [
    "BattleAnswerRequest", "BattleCreateRequest", "BattleItemRequest",
    "ApiKeyRequest", "LoginRequest", "RegisterRequest", "UpdateProfileRequest",
    "AvatarUpdateRequest", "ChampionRequest",
    "QuestClaimRequest", "RewardAwardRequest",
    "ShopEquipRequest", "ShopPurchaseRequest", "ShopUnequipRequest", "UseItemRequest",
    "ChatMessage", "ChatRequest", "FlashcardRequest", "NotesRequest", "QuizAnswerRequest", "QuizFinishRequest", "QuizRequest",
]
