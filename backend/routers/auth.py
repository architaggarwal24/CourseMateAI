"""Auth, account and AI-provider settings endpoints."""
import asyncio
import logging
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, Request, Response

import providers
from auth.cookies import clear_session_cookie, set_session_cookie
from auth.auth_service import validate_email, validate_full_name, validate_password, validate_username
from errors import AppError, invalid_input, provider_settings_invalid
from deps import managed_ai_available, require_auth
from key_service import encrypt_key, failure_field, validate_api_key
from schemas import ApiKeyRequest, LoginRequest, RegisterRequest, UpdateProfileRequest
from schemas.auth import DeleteAccountRequest
from schemas.auth import ApiKeyInfoResponse, ApiKeyUpdateResponse, ProfileUpdateResponse, ProvidersResponse, RegisterResponse, UserResponse, UsernameCheckResponse
from schemas.base import SuccessResponse
from services.invite_service import invalid_code as invite_invalid, invite_only, normalise as normalise_code
from state import auth_middleware, auth_service, db, login_throttle, documents, invite_service, limiter, store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/providers", response_model=ProvidersResponse, response_model_exclude_unset=True)
def list_llm_providers():
    """Public: the provider/model catalogue that drives the signup and settings pickers.
    Contains no secrets. (Ollama is included only while ENABLE_OLLAMA is on.)"""
    return {"providers": [p.to_public() for p in providers.list_providers()]}


async def _prepare_llm_settings(provider: str, api_key: str, model: Optional[str], base_url: Optional[str]):
    """Validate a provider/key/model/base-URL combination for signup or Settings.

    Returns (provider_id, key_to_store, model_or_None, base_url_or_None) or raises a 400
    whose message is safe to show to the user. The live check makes a real (blocking)
    call, so it runs in a worker thread.
    """
    spec = providers.get_provider(provider)
    if spec is None:
        raise AppError(
            "provider_unsupported",
            f"Unsupported provider '{(provider or '').strip()}'. Choose from: {', '.join(providers.provider_ids())}",
            status_code=400, action="settings", details={"field": "llm_provider"},
        )
    try:
        model_clean = providers.validate_model_id(model)
    except ValueError as e:
        raise provider_settings_invalid(str(e), "llm_model")
    try:
        base = providers.normalize_base_url(spec, base_url)
    except ValueError as e:
        raise provider_settings_invalid(str(e), "llm_base_url")

    key = (api_key or "").strip()
    if spec.needs_key and not key:
        raise provider_settings_invalid("API key is required.", "api_key")
    if not spec.needs_key:
        key = providers.NO_KEY_PLACEHOLDER

    ok, err = await asyncio.to_thread(validate_api_key, spec.id, key, model_clean, base)
    if not ok:
        raise provider_settings_invalid(err, failure_field(err))
    return spec.id, key, model_clean, base


@router.get("/auth/api-key", response_model=ApiKeyInfoResponse, response_model_exclude_unset=True)
async def get_api_key_info(user=Depends(require_auth)):
    """Return the saved provider settings (never the actual key)."""
    key_data = db.get_api_key_data(user["user_id"])
    if not key_data or not key_data.get("api_key_encrypted"):
        return {"has_key": False, "provider": None}
    provider = key_data.get("llm_provider")
    spec = providers.get_provider(provider)
    return {
        "has_key": True,
        "provider": provider,
        "provider_label": spec.label if spec else provider,
        "provider_supported": spec is not None,      # False for e.g. legacy Mistral accounts
        "model": key_data.get("llm_model"),
        "base_url": key_data.get("llm_base_url"),
    }


@router.put("/auth/api-key", response_model=ApiKeyUpdateResponse, response_model_exclude_unset=True)
@limiter.limit("20/hour")                     # each one is checked with a real call to the provider
async def update_api_key(req: ApiKeyRequest, request: Request, user=Depends(require_auth)):
    """Validate and replace the user's provider settings."""
    provider, key, model, base_url = await _prepare_llm_settings(
        req.llm_provider, req.api_key, req.llm_model, req.llm_base_url)
    # FIX #4: always persist the model — the old code omitted it, silently resetting
    # users to the default model on every key update.
    db.save_api_key(user["user_id"], encrypt_key(key), provider, model, base_url)
    return {"success": True, "provider": provider}


@router.delete("/auth/api-key", response_model=ApiKeyUpdateResponse, response_model_exclude_unset=True)
@limiter.limit("20/hour")
async def use_managed_ai(request: Request, user=Depends(require_auth)):
    """Forget the user's own provider settings: their AI then runs on the server's (within their plan's quotas)."""
    if not managed_ai_available():
        raise provider_settings_invalid("This server has no built-in AI, so your own provider is needed.", "llm_provider")
    db.save_api_key(user["user_id"], None, None, None, None)
    return {"success": True, "provider": ""}


@router.post("/auth/register", response_model=RegisterResponse, response_model_exclude_unset=True)
@limiter.limit("10/minute")
async def register(req: RegisterRequest, response: Response, request: Request):
    """Register a new user, validate their API key, then log them in."""
    # Validate the cheap things FIRST. The API-key check is a real LLM call; doing it
    # before the form checks let anyone trigger paid calls with a garbage form.
    for field, check, value in (
        ("email", validate_email, req.email), ("username", validate_username, req.username),
        ("full_name", validate_full_name, req.full_name), ("password", validate_password, req.password),
    ):
        try:
            check(value)
        except ValueError as e:
            raise invalid_input(str(e), field=field)      # details.field: the form shows it beside that field
    code = normalise_code(req.invite_code or "")
    if code:
        invite_service.validate(code)                             # 400 invite_invalid (details.field) before anything
    elif invite_only():
        raise invite_invalid("An invite code is needed to sign up while CourseMate is in testing.")
    # No provider chosen: the account uses the server's own AI (its plan's quotas apply) - when the server has one.
    managed = not (req.llm_provider or "").strip()
    if managed and not managed_ai_available():
        raise provider_settings_invalid("Choose an AI provider: this server has no built-in AI.", "llm_provider")
    if not managed:
        provider, key, model, base_url = await _prepare_llm_settings(
            req.llm_provider, req.api_key, req.llm_model, req.llm_base_url)
    try:
        user = auth_service.register_user(
            email=req.email, password=req.password,
            username=req.username, full_name=req.full_name, timezone=req.timezone,
        )
    except ValueError as e:
        raise invalid_input(str(e), field=getattr(e, "field", None))
    if not managed:
        db.save_api_key(user["user_id"], encrypt_key(key), provider, model, base_url)
    store.ensure_user(str(user["user_id"]))
    if code:
        try:
            invite_service.redeem(user["user_id"], code)
        except AppError:                                          # used up in the meantime: the account still stands
            logger.warning("invite code %s could not be redeemed at signup", code)
    token = auth_service.login(req.email, req.password, req.timezone)
    if token:
        set_session_cookie(response, request, token)
    return {"success": True, "user_id": user["user_id"], "username": user["username"]}


@router.post("/auth/login", response_model=SuccessResponse, response_model_exclude_unset=True)
@limiter.limit("5/minute")
async def login(req: LoginRequest, response: Response, request: Request):
    wait = login_throttle.retry_after(req.email)
    if wait:
        raise AppError("rate_limited", "Too many wrong passwords for this account. Try again later.", status_code=429,
                       action="retry", details={"retry_after_seconds": wait}, headers={"Retry-After": str(wait)})
    token = auth_service.login(req.email, req.password, req.timezone)
    if not token:
        login_throttle.failed(req.email)
        raise AppError("invalid_credentials", "Incorrect email or password.", status_code=401)
    login_throttle.succeeded(req.email)
    # Signing in again from a browser that still holds an older session replaces it instead of leaving it valid.
    auth_service.logout(await auth_middleware.session_token(request))
    set_session_cookie(response, request, token)
    return {"success": True}


@router.post("/auth/logout", response_model=SuccessResponse, response_model_exclude_unset=True)
async def logout(request: Request, response: Response):
    """End THIS session: its server-side row is deleted, so the old cookie is rejected from now on (401), even
    if someone copied it. Works (and just clears the cookie) when the request carries no valid session."""
    auth_service.logout(await auth_middleware.session_token(request))
    clear_session_cookie(response, request)
    return {"success": True}


@router.get("/auth/me", response_model=UserResponse, response_model_exclude_unset=True)
async def get_current_user(user=Depends(require_auth)):
    return user


@router.get("/auth/check-username", response_model=UsernameCheckResponse, response_model_exclude_unset=True)
@limiter.limit("60/minute")
async def check_username(username: str, request: Request):
    username = (username or "").strip()
    if len(username) < 3:
        return {"available": False, "reason": "too_short"}
    try:
        validate_username(username)
    except ValueError:
        return {"available": False, "reason": "invalid"}
    existing = db.get_user_by_username(username)
    return {"available": existing is None, "username": username}


def _password_ok(user_row: dict, password: Optional[str]) -> bool:
    try:
        return bool(password) and bcrypt.checkpw(password.encode("utf-8"), user_row["password_hash"].encode("utf-8"))
    except ValueError:      # e.g. >72-byte input under bcrypt>=5
        return False


@router.post("/auth/update-profile", response_model=ProfileUpdateResponse, response_model_exclude_unset=True)
@limiter.limit("10/minute")
async def update_profile(req: UpdateProfileRequest, request: Request, user=Depends(require_auth)):
    user_id = user['user_id']
    current_user = db.get_user_by_id(user_id)
    if not current_user:
        raise AppError("user_not_found", "We couldn't find your account.", status_code=404)
    updates = {}
    # Same validation as registration. Previously an email set here was neither
    # validated nor lower-cased, but login() lower-cases what you type – so after
    # changing to "Foo@x.com" you could never log in again.
    try:
        if req.full_name and req.full_name.strip() != current_user.get('full_name'):
            updates['full_name'] = validate_full_name(req.full_name)
        if req.username and req.username.strip() != current_user.get('username'):
            new_username = validate_username(req.username)
            taken = db.get_user_by_username(new_username)
            if taken and taken['id'] != user_id:
                raise AppError("username_taken", "That username is already taken.", status_code=400)
            updates['username'] = new_username
        if req.email and req.email.strip().lower() != current_user.get('email'):
            new_email = validate_email(req.email)
            taken = db.get_user_by_email(new_email)
            if taken and taken['id'] != user_id:
                raise AppError("email_in_use", "That email is already in use.", status_code=400)
            updates['email'] = new_email
    except ValueError as e:
        raise invalid_input(str(e))
    # The login (email) and the password are the keys to the account: a stolen session alone can't change them.
    if req.new_password or 'email' in updates:
        if not req.current_password:
            what = "set a new password" if req.new_password else "change your email"
            raise AppError("current_password_required", f"Enter your current password to {what}.", status_code=400,
                           details={"field": "current_password"})
        if not _password_ok(current_user, req.current_password):
            raise AppError("wrong_password", "Your current password is incorrect.", status_code=401,
                           details={"field": "current_password"})
    if req.new_password:
        try:
            validate_password(req.new_password)
        except ValueError as e:
            raise invalid_input(str(e))
        password_hash = bcrypt.hashpw(req.new_password.encode('utf-8'), bcrypt.gensalt())
        updates['password_hash'] = password_hash.decode('utf-8')
    if updates:
        update_fields = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [user_id]
        db.execute(f"UPDATE users SET {update_fields} WHERE id = ?", tuple(values))
        if 'password_hash' in updates:
            # A new password signs every OTHER device out (a stolen session must not survive the change);
            # this browser stays signed in.
            auth_service.revoke_other_sessions(user_id, keep_token=await auth_middleware.session_token(request))
        return {"success": True, "message": "Profile updated"}
    return {"success": True, "message": "No changes"}


@router.delete("/auth/delete-account", response_model=SuccessResponse, response_model_exclude_unset=True)
@limiter.limit("5/hour")
def delete_account(req: DeleteAccountRequest, request: Request, response: Response, user=Depends(require_auth)):
    """Delete the account and ALL of its data: login row, chat/quiz history, progression,
    leaderboard entries, and uploaded documents (in memory and on disk). Needs the password."""
    user_id = user['user_id']
    row = db.get_user_by_id(user_id)
    if not row or not _password_ok(row, req.password):
        raise AppError("wrong_password", "Your password is incorrect.", status_code=401, details={"field": "password"})
    try:
        # Documents first: once the user row is gone the cascade removes their rows, and with them the
        # list of index folders / cached indexes that still have to be cleaned up.
        documents.delete_user_documents(user_id)
        auth_service.revoke_other_sessions(user_id)        # every session, explicitly (the cascade below would also do it)
        db.delete_user_data(user_id)                       # one DELETE: ON DELETE CASCADE removes every row of theirs
        store.forget_user(str(user_id))                    # drop the "already bootstrapped" cache entry
        clear_session_cookie(response, request)
        return {"success": True}
    except Exception as e:
        logger.exception(f"delete_account failed for {user_id}: {e}")
        raise AppError("account_delete_failed", "Could not delete your account. Please try again.", status_code=500, action="retry")
