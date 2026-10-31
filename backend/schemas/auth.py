from typing import Optional

from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str
    timezone: Optional[str] = None   # IANA name, sent silently by the browser; an unknown name is ignored


class RegisterRequest(BaseModel):
    email: str
    password: str
    username: str
    full_name: str
    guest_id: Optional[str] = None
    api_key: str = ""              # optional for providers that need none (Ollama)
    llm_provider: str = ""
    llm_model: Optional[str] = None
    llm_base_url: Optional[str] = None   # OpenAI-compatible endpoints / Ollama
    timezone: Optional[str] = None       # IANA name, sent silently by the browser; an unknown name is ignored


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class ApiKeyRequest(BaseModel):
    api_key: str = ""              # optional for providers that need none (Ollama)
    llm_provider: str = ""
    # FIX #1: llm_model was missing. update_api_key called req.llm_model which raised
    # AttributeError on every PUT /auth/api-key request, meaning "Save Key" in Settings
    # always returned a 500 error and users could never update their API key.
    llm_model: Optional[str] = None
    llm_base_url: Optional[str] = None


# ── responses ─────────────────────────────────────────────────────────────────
from typing import List, Union  # noqa: E402

from .base import ApiModel  # noqa: E402


class ProviderModelOut(ApiModel):
    id: str
    label: str
    free: Optional[bool] = None
    note: Optional[str] = None


class ProviderPresetOut(ApiModel):
    label: str
    url: str
    hint: Optional[str] = None


class ProviderOut(ApiModel):
    id: str
    label: str
    kind: str
    cost: str
    hint: Optional[str] = None
    key_url: Optional[str] = None
    key_placeholder: Optional[str] = None
    needs_key: bool
    base_url_mode: str
    default_base_url: Optional[str] = None
    models: List[ProviderModelOut]
    default_model: Optional[str] = None
    presets: List[ProviderPresetOut]
    dev_only: bool
    allow_custom_model: bool


class ProvidersResponse(ApiModel):
    providers: List[ProviderOut]


class ApiKeyInfoResponse(ApiModel):
    has_key: bool
    provider: Optional[str] = None
    provider_label: Optional[str] = None
    provider_supported: Optional[bool] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class ApiKeyUpdateResponse(ApiModel):
    success: bool
    provider: str


class RegisterResponse(ApiModel):
    success: bool
    user_id: Union[int, str]
    username: str


class UserResponse(ApiModel):
    user_id: Union[int, str]
    email: Optional[str] = None
    username: Optional[str] = None
    full_name: Optional[str] = None


class UsernameCheckResponse(ApiModel):
    available: bool
    reason: Optional[str] = None
    username: Optional[str] = None


class ProfileUpdateResponse(ApiModel):
    success: bool
    message: str
