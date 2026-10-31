"""
providers.py — the ONE place that knows which LLM providers exist.

Everything else (key validation, client construction, the /providers endpoint that
feeds the signup/settings UI) reads from here, so adding a provider or refreshing a
model list is a one-file change instead of five.

Curated model lists contain only models that are FREE to call (or the cheapest
paid option, clearly labelled when the provider has no free API tier). Anyone who
wants a different model — including paid ones, on their own key — uses the
"custom model" option, which accepts any model id the provider understands.

Model lists were checked against the providers' own pricing/model pages on
2026-10-02. Provider catalogs change often; if a curated model starts returning
404, update it here (or just use "custom model").
"""
import ipaddress
import os
import re
import socket
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlparse

# Placeholder stored (encrypted) for providers that need no key, so the rest of the
# app can keep treating "has a stored key" as "is configured".
NO_KEY_PLACEHOLDER = "no-key-required"

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,99}$")


# ── Data model ────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str
    free: bool = False
    note: str = ""


@dataclass(frozen=True)
class BaseUrlPreset:
    label: str
    url: str
    hint: str = ""


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    kind: str                       # gemini | openai | anthropic | openai_compat | ollama
    cost: str                       # "free" | "paid" | "local"
    hint: str
    key_url: str = ""
    key_placeholder: str = "API key"
    needs_key: bool = True
    base_url_mode: str = "none"     # none | fixed | optional | required
    default_base_url: str = ""
    models: Tuple[ModelOption, ...] = ()
    default_model: str = ""
    presets: Tuple[BaseUrlPreset, ...] = ()
    usage_url: str = ""
    dev_only: bool = False

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "kind": self.kind,
            "cost": self.cost,
            "hint": self.hint,
            "key_url": self.key_url,
            "key_placeholder": self.key_placeholder,
            "needs_key": self.needs_key,
            "base_url_mode": self.base_url_mode,
            "default_base_url": self.default_base_url,
            "models": [m.__dict__ for m in self.models],
            "default_model": self.default_model,
            "presets": [p.__dict__ for p in self.presets],
            "dev_only": self.dev_only,
            "allow_custom_model": True,   # every provider accepts any model id
        }


# ── Registry ──────────────────────────────────────────────────────────────────
_ALL: Tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="gemini",
        label="Google Gemini",
        kind="gemini",
        cost="free",
        hint="Free tier, no credit card. Free-tier prompts may be used by Google to improve its products.",
        key_url="https://aistudio.google.com/apikey",
        key_placeholder="AIza...",
        usage_url="https://aistudio.google.com/rate-limit",
        default_model="gemini-3.8-flash",
        models=(
            ModelOption("gemini-3.8-flash", "Gemini 3.8 Flash", True, "Newest and smartest Flash model"),
            ModelOption("gemini-3.7-flash", "Gemini 3.7 Flash", True, "Fast, reliable all-rounder"),
            ModelOption("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", True, "Lightest — best if you hit rate limits"),
            ModelOption("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", True, "Light and cheap, older generation"),
        ),
    ),
    ProviderSpec(
        id="nvidia-nim",
        label="NVIDIA NIM",
        kind="openai_compat",
        cost="free",
        hint="Free open models (~40 requests/min) with a free NVIDIA Developer account — no credit card.",
        key_url="https://build.nvidia.com/settings/api-keys",
        key_placeholder="nvapi-...",
        usage_url="https://build.nvidia.com/settings/api-keys",
        base_url_mode="fixed",
        default_base_url="https://integrate.api.nvidia.com/v1",
        default_model="meta/llama-3.3-70b-instruct",
        models=(
            ModelOption("meta/llama-3.3-70b-instruct", "Llama 3.3 70B Instruct", True, "Dependable, follows formats well"),
            ModelOption("nvidia/llama-3.3-nemotron-super-49b-v1.5", "Nemotron Super 49B v1.5", True, "NVIDIA-tuned reasoning"),
            ModelOption("nvidia/nemotron-3-super-120b-a12b", "Nemotron 3 Super 120B", True, "Largest NVIDIA option"),
            ModelOption("qwen/qwen3.5-122b-a10b", "Qwen 3.5 122B", True, "Strong multilingual"),
            ModelOption("openai/gpt-oss-20b", "gpt-oss 20B", True, "Small and quick"),
        ),
    ),
    ProviderSpec(
        id="openai-compatible",
        label="OpenAI-compatible",
        kind="openai_compat",
        cost="paid",
        hint="Any service that speaks the OpenAI chat API (OpenRouter, Groq, CodeCraft API, LM Studio, …). "
             "Enter its base URL, your key and a model id.",
        key_placeholder="Your provider's API key",
        base_url_mode="required",
        default_model="",
        models=(),
        presets=(
            BaseUrlPreset("CodeCraft API", "https://codecraftapi.com/v1", "Key starts with cc_"),
            BaseUrlPreset("OpenRouter", "https://openrouter.ai/api/v1", "Free models end in :free"),
            BaseUrlPreset("Groq", "https://api.groq.com/openai/v1", "Has a free tier"),
            BaseUrlPreset("Cerebras", "https://api.cerebras.ai/v1", "Has a free tier"),
        ),
    ),
    ProviderSpec(
        id="openai",
        label="OpenAI",
        kind="openai",
        cost="paid",
        hint="OpenAI has no free API tier — you need a funded account. (Accounts that opt in to OpenAI's "
             "data-sharing program may get free daily tokens.)",
        key_url="https://platform.openai.com/api-keys",
        key_placeholder="sk-...",
        usage_url="https://platform.openai.com/usage",
        default_model="gpt-5.4-nano",
        models=(
            ModelOption("gpt-5.4-nano", "GPT-5.4 nano", False, "Cheapest current model"),
            ModelOption("gpt-5.4-mini", "GPT-5.4 mini", False, "Stronger, still inexpensive"),
        ),
    ),
    ProviderSpec(
        id="claude",
        label="Anthropic Claude",
        kind="anthropic",
        cost="paid",
        hint="Anthropic has no free API tier — you need credits on your own account.",
        key_url="https://console.anthropic.com/settings/keys",
        key_placeholder="sk-ant-...",
        usage_url="https://console.anthropic.com/settings/plans",
        default_model="claude-haiku-4-5-20251001",
        models=(
            ModelOption("claude-haiku-4-5-20251001", "Claude Haiku 4.5", False, "Cheapest Claude"),
            ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5", False, "Best balance of quality and cost"),
        ),
    ),
    ProviderSpec(
        id="ollama",
        label="Ollama (local)",
        kind="ollama",
        cost="local",
        hint="LOCAL TESTING ONLY. Runs models on this machine — install Ollama, then `ollama pull <model>`.",
        key_url="https://ollama.com/download",
        needs_key=False,
        base_url_mode="optional",
        default_base_url="http://localhost:11434",
        default_model="llama3.2:3b",
        dev_only=True,
        models=(
            ModelOption("llama3.2:3b", "Llama 3.2 3B", True, "Tiny, runs on most laptops"),
            ModelOption("qwen3:8b", "Qwen 3 8B", True, "Good quality, ~8 GB RAM"),
            ModelOption("gemma3:4b", "Gemma 3 4B", True, "Compact and capable"),
            ModelOption("llama3.1:8b", "Llama 3.1 8B", True, "Solid general model"),
            ModelOption("gpt-oss:20b", "gpt-oss 20B", True, "Needs ~16 GB RAM"),
        ),
    ),
)

# Where the picker shows them. (ollama last, and only when enabled.)
_ORDER = [p.id for p in _ALL]


def ollama_enabled() -> bool:
    """Ollama is for local testing. Set ENABLE_OLLAMA=false before deploying."""
    return os.getenv("ENABLE_OLLAMA", "true").strip().lower() in ("1", "true", "yes", "on")


def list_providers() -> List[ProviderSpec]:
    return [p for p in _ALL if not (p.kind == "ollama" and not ollama_enabled())]


def get_provider(provider_id: Optional[str]) -> Optional[ProviderSpec]:
    pid = (provider_id or "").strip().lower()
    for p in list_providers():
        if p.id == pid:
            return p
    return None


def provider_ids() -> Tuple[str, ...]:
    return tuple(p.id for p in list_providers())


def provider_label(provider_id: Optional[str]) -> str:
    spec = get_provider(provider_id)
    return spec.label if spec else (provider_id or "your provider")


def usage_url(provider_id: Optional[str]) -> str:
    spec = get_provider(provider_id)
    return spec.usage_url if spec else ""


# ── Model id validation ───────────────────────────────────────────────────────
def validate_model_id(model: Optional[str]) -> Optional[str]:
    """Return the cleaned model id (or None if empty). Raises ValueError if unsafe."""
    model = (model or "").strip()
    if not model:
        return None
    if not _MODEL_ID_RE.match(model):
        raise ValueError(
            "Model name may only contain letters, numbers and . _ : / @ + - (max 100 characters)"
        )
    return model


# ── Base URL handling (SSRF guard) ────────────────────────────────────────────
# The server makes requests to whatever base URL a user types in, so an attacker could
# aim it at internal services (cloud metadata, localhost admin ports, the LAN). We only
# allow public hosts, resolve the name and check every address it maps to.
_OLLAMA_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"}


def _allow_local() -> bool:
    return os.getenv("ALLOW_LOCAL_PROVIDERS", "false").strip().lower() in ("1", "true", "yes", "on")


def _forbidden_ip(ip_str: str, allow_local: bool) -> bool:
    ip = ipaddress.ip_address(ip_str)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    # Cloud-metadata / link-local is NEVER allowed, even in local mode.
    if ip.is_link_local or ip.is_multicast or ip.is_unspecified:
        return True
    if allow_local and (ip.is_private or ip.is_loopback):
        return False
    return not ip.is_global


def _check_host_public(host: str, allow_local: bool) -> None:
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError(f"Couldn't resolve '{host}'. Check the base URL for typos.")
    addrs = {i[4][0].split("%")[0] for i in infos}
    if not addrs:
        raise ValueError(f"Couldn't resolve '{host}'.")
    for addr in addrs:
        if _forbidden_ip(addr, allow_local):
            raise ValueError(
                "That base URL points at a private or internal address, which isn't allowed. "
                "Use the provider's public HTTPS endpoint."
            )


def normalize_base_url(spec: ProviderSpec, raw: Optional[str]) -> Optional[str]:
    """Syntax-only checks + normalisation (no network). Returns the URL to store/use, or
    None for providers that don't take one. Raises ValueError with a user-facing message."""
    mode = spec.base_url_mode
    if mode == "none":
        return None
    if mode == "fixed":
        return spec.default_base_url          # user input is ignored on purpose

    raw = (raw or "").strip()
    if not raw:
        if mode == "required":
            raise ValueError("Base URL is required (for example https://openrouter.ai/api/v1)")
        raw = spec.default_base_url

    if len(raw) > 300:
        raise ValueError("Base URL is too long")
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("Base URL must start with https://")
    if not parsed.hostname:
        raise ValueError("Base URL is missing a host name")
    if parsed.username or parsed.password:
        raise ValueError("Don't put credentials in the base URL — use the API key field")
    if parsed.query or parsed.fragment:
        raise ValueError("Base URL shouldn't contain ? or # parts")

    host = parsed.hostname.lower()
    path = parsed.path.rstrip("/")
    # People often paste the full endpoint; the SDK appends this itself.
    for suffix in ("/chat/completions", "/completions"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
    base = f"{parsed.scheme}://{parsed.netloc}{path}"

    if spec.kind == "ollama":
        # Ollama is a dev-only local runtime: loopback hosts only, never arbitrary URLs.
        if host not in {h.strip("[]") for h in _OLLAMA_HOSTS}:
            raise ValueError("Ollama must be on this machine (localhost / 127.0.0.1 / host.docker.internal)")
        if base.endswith("/v1"):
            base = base[:-3]
        return base

    if parsed.scheme != "https" and not _allow_local():
        raise ValueError("Base URL must use https://")
    return base


def resolve_base_url(spec: ProviderSpec, raw: Optional[str]) -> Optional[str]:
    """normalize_base_url() plus the DNS/SSRF check. Use this wherever the server is about
    to actually connect to the URL (it does a name lookup, so don't call it on the event loop)."""
    base = normalize_base_url(spec, raw)
    if base and spec.kind != "ollama":
        _check_host_public(urlparse(base).hostname.lower(), _allow_local())
    return base
