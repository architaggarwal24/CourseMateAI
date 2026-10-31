"""LLM provider registry, validation, client construction and the signup/settings API."""
import json
import socket
import sys

import pytest

import providers
import key_service
from conftest import make_pdf_bytes
from core_brains import llm_connection as lc
import state

SID = "88888888-8888-4888-8888-888888888888"


# ── helpers ───────────────────────────────────────────────────────────────────
@pytest.fixture()
def dns(monkeypatch):
    """Offline DNS: hosts map to a public IP unless overridden via dns.set(host, ip)."""
    table = {}

    class _D:
        def set(self, host, ip):
            table[host] = ip

    def fake_getaddrinfo(host, port, *a, **k):
        ip = table.get(host, "93.184.216.34")
        fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
        return [(fam, socket.SOCK_STREAM, 6, "", (ip, 0))]

    monkeypatch.setattr(providers.socket, "getaddrinfo", fake_getaddrinfo)
    return _D()


def _sdk_httpx():
    """The OpenAI SDK may ship its own httpx fork (httpx2 today). Ask a real client which
    transport classes it uses instead of guessing, so this keeps working across versions."""
    from langchain_openai import ChatOpenAI
    m = ChatOpenAI(model="x", api_key="k", base_url="https://example.com/v1")
    sync_cls = type(m.root_client._client._transport)
    async_cls = type(m.root_async_client._client._transport)
    mod = sys.modules[sync_cls.__module__.split(".")[0]]
    return mod, sync_cls, async_cls


@pytest.fixture()
def sdk_http():
    return _sdk_httpx()


@pytest.fixture()
def fake_http(monkeypatch):
    """Intercept every HTTP request the OpenAI SDK makes and record what was sent."""
    mod, sync_cls, async_cls = _sdk_httpx()
    calls = []
    state = {"content": "pong", "status": 200, "error": "boom"}

    def respond(request):
        calls.append({"url": str(request.url), "auth": request.headers.get("authorization"),
                      "body": json.loads(request.content or b"{}")})
        if state["status"] != 200:
            return mod.Response(state["status"], json={"error": {"message": state["error"]}}, request=request)
        return mod.Response(200, request=request, json={
            "id": "x", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": state["content"]}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    async def arespond(self, request):
        return respond(request)

    monkeypatch.setattr(sync_cls, "handle_request", lambda self, request: respond(request))
    monkeypatch.setattr(async_cls, "handle_async_request", arespond)

    class _H:
        pass
    h = _H()
    h.calls, h.state = calls, state
    return h


def spec(pid):
    return providers.get_provider(pid)


# ═════════════════════════ registry ══════════════════════════════════════════
def test_mistral_is_gone_and_new_providers_exist():
    ids = providers.provider_ids()
    assert "mistral" not in ids
    assert {"gemini", "nvidia-nim", "openai-compatible", "openai", "claude", "ollama"} <= set(ids)


def test_every_default_model_is_in_its_model_list_and_ids_are_valid():
    for p in providers.list_providers():
        if p.models:
            assert p.default_model in {m.id for m in p.models}, p.id
        for m in p.models:
            assert providers.validate_model_id(m.id) == m.id


def test_curated_lists_match_the_pricing_pages():
    free = {p.id for p in providers.list_providers() if p.cost == "free"}
    assert free == {"gemini", "nvidia-nim"}
    # first-party paid providers must not claim their models are free
    for pid in ("openai", "claude"):
        assert not any(m.free for m in spec(pid).models)
    # retired / paid-only Gemini models must not be offered
    ids = {m.id for m in spec("gemini").models}
    assert "gemini-1.5-flash" not in ids and "gemini-3.1-pro-preview" not in ids
    assert all(i.startswith("gemini-3") for i in ids)


def test_ollama_can_be_switched_off_for_production(monkeypatch):
    monkeypatch.setenv("ENABLE_OLLAMA", "false")
    assert "ollama" not in providers.provider_ids()
    assert providers.get_provider("ollama") is None
    monkeypatch.setenv("ENABLE_OLLAMA", "true")
    assert providers.get_provider("ollama") is not None


def test_providers_endpoint_is_public_and_has_no_secrets(client):
    r = client.get("/providers")
    assert r.status_code == 200
    data = r.json()["providers"]
    assert [p["id"] for p in data][0] == "gemini"
    assert all(p["allow_custom_model"] for p in data)
    blob = json.dumps(data).lower()
    assert "api_key_encrypted" not in blob and "secret" not in blob
    oc = next(p for p in data if p["id"] == "openai-compatible")
    assert oc["base_url_mode"] == "required" and any("codecraftapi" in x["url"] for x in oc["presets"])


def test_providers_endpoint_hides_ollama_when_disabled(client, monkeypatch):
    monkeypatch.setenv("ENABLE_OLLAMA", "false")
    assert "ollama" not in [p["id"] for p in client.get("/providers").json()["providers"]]


# ═════════════════════════ model id / base url safety ════════════════════════
@pytest.mark.parametrize("ok", ["gpt-5.4-nano", "meta/llama-3.3-70b-instruct", "llama3.2:3b",
                                "openai/gpt-oss-20b:free", "accounts/x/models/y", "claude-haiku-4-5-20251001"])
def test_model_ids_accepted(ok):
    assert providers.validate_model_id(ok) == ok


@pytest.mark.parametrize("bad", ["a b", "x" * 101, "../etc/passwd", "model;rm -rf", "<script>", "-lead", "a\nb"])
def test_model_ids_rejected(bad):
    with pytest.raises(ValueError):
        providers.validate_model_id(bad)


def test_empty_model_means_use_default():
    assert providers.validate_model_id("  ") is None and providers.validate_model_id(None) is None


@pytest.mark.parametrize("url,ip", [
    ("https://internal.example/v1", "10.0.0.5"),
    ("https://metadata.example/v1", "169.254.169.254"),
    ("https://loop.example/v1", "127.0.0.1"),
    ("https://lan.example/v1", "192.168.1.20"),
    ("https://cgnat.example/v1", "100.64.0.1"),
    ("https://v6.example/v1", "::1"),
    ("https://mapped.example/v1", "::ffff:127.0.0.1"),
])
def test_private_addresses_are_blocked(dns, url, ip):
    dns.set(url.split("//")[1].split("/")[0], ip)
    with pytest.raises(ValueError, match="private or internal"):
        providers.resolve_base_url(spec("openai-compatible"), url)


def test_metadata_ip_blocked_even_when_local_providers_allowed(dns, monkeypatch):
    monkeypatch.setenv("ALLOW_LOCAL_PROVIDERS", "true")
    dns.set("lan.example", "192.168.1.20")
    dns.set("meta.example", "169.254.169.254")
    assert providers.resolve_base_url(spec("openai-compatible"), "https://lan.example/v1")   # LAN ok now
    with pytest.raises(ValueError):
        providers.resolve_base_url(spec("openai-compatible"), "https://meta.example/v1")


@pytest.mark.parametrize("url", ["http://api.example.com/v1", "ftp://x.com/v1", "https://user:pw@x.com/v1",
                                 "https://x.com/v1?key=1", "https://x.com/v1#frag", "https:///v1", "not a url", ""])
def test_malformed_or_insecure_base_urls_rejected(dns, url):
    with pytest.raises(ValueError):
        providers.resolve_base_url(spec("openai-compatible"), url)


def test_base_url_normalisation(dns):
    s = spec("openai-compatible")
    assert providers.resolve_base_url(s, "https://codecraftapi.com/v1/") == "https://codecraftapi.com/v1"
    assert providers.resolve_base_url(s, "https://codecraftapi.com/v1/chat/completions") == "https://codecraftapi.com/v1"


def test_unresolvable_host_has_a_clear_message(monkeypatch):
    def boom(*a, **k):
        raise socket.gaierror("nope")
    monkeypatch.setattr(providers.socket, "getaddrinfo", boom)
    with pytest.raises(ValueError, match="resolve"):
        providers.resolve_base_url(spec("openai-compatible"), "https://nope.invalid/v1")


def test_fixed_provider_ignores_user_supplied_url():
    assert providers.resolve_base_url(spec("nvidia-nim"), "https://evil.example/v1") == "https://integrate.api.nvidia.com/v1"
    assert providers.resolve_base_url(spec("gemini"), "https://evil.example") is None


def test_ollama_is_loopback_only():
    s = spec("ollama")
    assert providers.resolve_base_url(s, "") == "http://localhost:11434"
    assert providers.resolve_base_url(s, "http://127.0.0.1:11434/v1") == "http://127.0.0.1:11434"
    assert providers.resolve_base_url(s, "http://host.docker.internal:11434") == "http://host.docker.internal:11434"
    for bad in ("http://10.0.0.5:11434", "http://169.254.169.254", "https://evil.example"):
        with pytest.raises(ValueError, match="this machine"):
            providers.resolve_base_url(s, bad)


def test_custom_provider_requires_a_base_url():
    with pytest.raises(ValueError, match="required"):
        providers.resolve_base_url(spec("openai-compatible"), "")


# ═════════════════════════ client construction (wire level) ══════════════════
def _run(provider, model, base_url=None, key="k-123"):
    client = lc.LLMClient(api_key=key, provider=provider, model=model, base_url=base_url, max_retries=1)
    from langchain_core.messages import HumanMessage
    return client.generate([HumanMessage(content="hi")])


def test_nvidia_nim_request_shape(fake_http, dns):
    assert _run("nvidia-nim", "meta/llama-3.3-70b-instruct", key="nvapi-abc") == "pong"
    c = fake_http.calls[-1]
    assert c["url"] == "https://integrate.api.nvidia.com/v1/chat/completions"
    assert c["auth"] == "Bearer nvapi-abc"
    assert c["body"]["model"] == "meta/llama-3.3-70b-instruct"
    assert c["body"]["max_tokens"] >= 4096                 # reasoning-safe budget
    assert "max_completion_tokens" not in c["body"]        # NIM/Ollama-style servers want plain max_tokens


def test_custom_openai_compatible_endpoint(fake_http, dns):
    assert _run("openai-compatible", "claude-opus-4.8", "https://codecraftapi.com/v1", key="cc_secret") == "pong"
    c = fake_http.calls[-1]
    assert c["url"] == "https://codecraftapi.com/v1/chat/completions"
    assert c["auth"] == "Bearer cc_secret"
    assert c["body"]["model"] == "claude-opus-4.8" and "max_tokens" in c["body"]


def test_first_party_openai_uses_max_completion_tokens_and_no_temperature(fake_http):
    assert _run("openai", "gpt-5.4-nano", key="sk-proj-x") == "pong"
    b = fake_http.calls[-1]["body"]
    assert fake_http.calls[-1]["url"] == "https://api.openai.com/v1/chat/completions"
    assert b["max_completion_tokens"] == 2000 and "max_tokens" not in b
    assert "temperature" not in b                           # gpt-5 family rejects it


def test_reasoning_model_behind_a_gateway_also_skips_temperature(fake_http, dns):
    _run("openai-compatible", "openai/gpt-5.4-nano", "https://openrouter.ai/api/v1")
    assert "temperature" not in fake_http.calls[-1]["body"]
    _run("openai-compatible", "llama-3.1-8b", "https://api.groq.com/openai/v1")
    assert fake_http.calls[-1]["body"]["temperature"] == 0.4


def test_ollama_talks_to_the_v1_route_without_a_key(fake_http):
    assert _run("ollama", "llama3.2:3b", key=providers.NO_KEY_PLACEHOLDER) == "pong"
    c = fake_http.calls[-1]
    assert c["url"] == "http://localhost:11434/v1/chat/completions"
    assert c["auth"] == "Bearer none"


def test_gemini_and_claude_clients_build_with_safe_budgets():
    g = lc._build_llm("gemini", "AIza-test", "gemini-3.8-flash", max_tokens=2000)
    assert g.model.endswith("gemini-3.8-flash") and g.max_output_tokens >= 8192   # room for hidden thinking
    c = lc._build_llm("claude", "sk-ant-test", "claude-haiku-4-5-20251001")
    assert c.model == "claude-haiku-4-5-20251001"


def test_default_model_is_used_when_none_given():
    g = lc._build_llm("gemini", "AIza-test", None)
    assert g.model.endswith(providers.get_provider("gemini").default_model)


def test_unknown_provider_and_missing_model_fail_clearly():
    with pytest.raises(ValueError, match="Unknown or disabled provider"):
        lc._build_llm("mistral", "k", "m")
    with pytest.raises(ValueError, match="No model"):
        lc._build_llm("openai-compatible", "k", None, base_url="https://codecraftapi.com/v1")


def test_client_cache_separates_same_key_on_different_servers(fake_http, dns):
    a = lc.get_or_create_client("cc_same", "openai-compatible", "m", "https://one.example/v1")
    b = lc.get_or_create_client("cc_same", "openai-compatible", "m", "https://two.example/v1")
    assert a is not b


def test_ssrf_guard_runs_at_request_time_too(dns, fake_http):
    dns.set("rebind.example", "127.0.0.1")        # host that "turned" private after signup
    with pytest.raises(ValueError, match="private or internal"):
        lc.LLMClient(api_key="k", provider="openai-compatible", model="m", base_url="https://rebind.example/v1")


# ═════════════════════════ response cleanup ═════════════════════════════════
@pytest.mark.parametrize("content,expected", [
    ("plain", "plain"),
    ([{"type": "text", "text": "Hello "}, {"type": "text", "text": "world"}], "Hello world"),
    ([{"type": "thinking", "thinking": "secret reasoning"}, {"type": "text", "text": "answer"}], "answer"),
    (["a", {"type": "text", "text": "b"}], "ab"),
    (None, ""),
])
def test_content_blocks_are_flattened(content, expected):
    assert lc._postprocess(content) == expected


@pytest.mark.parametrize("raw,expected", [
    ("<think>hmm\nlet me see</think>\n{\"a\": 1}", '{"a": 1}'),
    ("reasoning here</think>{\"a\": 1}", '{"a": 1}'),
    ("<THINK>x</THINK>ok", "ok"),
])
def test_inline_chain_of_thought_is_removed(raw, expected):
    assert lc._postprocess(raw) == expected


def test_empty_answers_raise_a_helpful_error(fake_http, dns):
    fake_http.state["content"] = "<think>only thinking</think>"
    with pytest.raises(lc.EmptyModelResponse, match="different model"):
        _run("nvidia-nim", "nvidia/nemotron-3-super-120b-a12b")


@pytest.mark.asyncio
async def test_async_path_gets_the_same_treatment(fake_http, dns):
    fake_http.state["content"] = "<think>x</think>async ok"
    c = lc.LLMClient(api_key="nvapi-1", provider="nvidia-nim", model="meta/llama-3.3-70b-instruct", max_retries=1)
    from langchain_core.messages import HumanMessage
    assert await c.generate_async([HumanMessage(content="hi")]) == "async ok"


def test_error_mapping_at_runtime(fake_http, dns):
    fake_http.state.update(status=401, error="Invalid API key")
    with pytest.raises(lc.InvalidApiKeyError):
        _run("nvidia-nim", "meta/llama-3.3-70b-instruct")
    fake_http.state.update(status=429, error="rate limit")
    with pytest.raises(lc.QuotaExceededError) as ei:
        _run("nvidia-nim", "meta/llama-3.3-70b-instruct")
    assert "NVIDIA NIM" in str(ei.value)


def test_unreachable_server_is_reported_clearly(monkeypatch, dns, sdk_http):
    mod, sync_cls, _ = sdk_http

    def refuse(self, request):
        raise mod.ConnectError("All connection attempts failed")
    monkeypatch.setattr(sync_cls, "handle_request", refuse)
    with pytest.raises(lc.ProviderUnreachableError):
        _run("ollama", "llama3.2:3b", key=providers.NO_KEY_PLACEHOLDER)


# ═════════════════════════ validate_api_key ═════════════════════════════════
class _Boom:
    def __init__(self, exc): self.exc = exc
    def invoke(self, *_a, **_k): raise self.exc


def _validate(monkeypatch, provider="gemini", key="AIza-secret-key", model=None, base_url=None, exc=None):
    llm = _Boom(exc) if exc else type("Ok", (), {"invoke": lambda *a, **k: "ok"})()
    monkeypatch.setattr(lc, "_build_llm", lambda **kw: llm)
    return key_service.validate_api_key(provider, key, model, base_url)


@pytest.mark.parametrize("exc,ok,needle", [
    (None, True, ""),
    (Exception("Error code: 401 - invalid_api_key"), False, "rejected the API key"),
    (Exception("API key not valid. Please pass a valid API key."), False, "rejected the API key"),
    (Exception("403 PERMISSION_DENIED"), False, "isn't allowed to use"),
    (Exception("404 models/gemini-1.5-flash is not found"), False, "wasn't found"),
    (Exception("429 RESOURCE_EXHAUSTED quota exceeded, limit: 0"), False, "no free quota"),
    (Exception("429 RESOURCE_EXHAUSTED retry in 10s"), True, ""),           # busy minute ≠ bad key
    (Exception("Request timed out."), False, "Timed out"),
    (Exception("Connection error."), False, "Couldn't connect"),
    (Exception("something odd happened"), False, "returned an error"),
])
def test_validation_messages(monkeypatch, exc, ok, needle):
    got_ok, msg = _validate(monkeypatch, exc=exc)
    assert got_ok is ok and needle.lower() in msg.lower()


def test_validation_never_echoes_the_key(monkeypatch):
    ok, msg = _validate(monkeypatch, key="sk-VERYSECRET123", exc=Exception("bad thing sk-VERYSECRET123 happened"))
    assert not ok and "VERYSECRET" not in msg


def test_validation_input_checks(monkeypatch):
    assert "Unsupported provider" in _validate(monkeypatch, provider="mistral")[1]
    assert "required" in _validate(monkeypatch, key="  ")[1].lower()
    assert "Model name" in _validate(monkeypatch, model="bad model!")[1]
    assert "Base URL" in _validate(monkeypatch, provider="openai-compatible", model="m", base_url="")[1]
    assert "Enter a model" in _validate(monkeypatch, provider="openai-compatible", base_url="https://codecraftapi.com/v1")[1]


def test_validation_uses_generous_limits(monkeypatch):
    seen = {}
    monkeypatch.setattr(lc, "_build_llm", lambda **kw: seen.update(kw) or type("O", (), {"invoke": lambda *a, **k: 1})())
    key_service.validate_api_key("gemini", "AIza-x", "gemini-3.8-flash")
    assert seen["timeout"] >= 15 and seen["max_tokens"] >= 32 and seen["sdk_retries"] == 0


def test_ollama_validation(monkeypatch):
    import urllib.error
    import urllib.request

    def down(*a, **k):
        raise urllib.error.URLError("refused")
    monkeypatch.setattr(urllib.request, "urlopen", down)
    ok, msg = key_service.validate_api_key("ollama", providers.NO_KEY_PLACEHOLDER, "llama3.2:3b")
    assert not ok and "ollama serve" in msg

    class R:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps({"models": [{"name": "qwen3:8b"}, {"name": "llama3.2:3b-instruct"}]}).encode()
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: R())
    ok, msg = key_service.validate_api_key("ollama", providers.NO_KEY_PLACEHOLDER, "llama3.2:3b")
    assert not ok and "ollama pull llama3.2:3b" in msg
    assert key_service.validate_api_key("ollama", providers.NO_KEY_PLACEHOLDER, "qwen3:8b") == (True, "")


# ═════════════════════════ signup / settings API ═════════════════════════════
def _register(client, **over):
    body = {"email": "p@example.com", "password": "correct-horse-1", "username": "pperson", "full_name": "P Person",
            "api_key": "AIza-test-key-123", "llm_provider": "gemini", "llm_model": "gemini-3.8-flash"}
    body.update(over)
    return client.post("/auth/register", json=body)


@pytest.fixture()
def api(client, app_module, monkeypatch):
    seen = []
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: seen.append((a, k)) or (True, ""))
    client.seen = seen
    return client


def test_signup_stores_provider_model_and_base_url(api, app_module):
    r = _register(api, email="a1@example.com", username="oc_user", llm_provider="openai-compatible",
                  llm_model="claude-opus-4.8", llm_base_url="https://codecraftapi.com/v1/chat/completions",
                  api_key="cc_key")
    assert r.status_code == 200, r.text
    info = api.get("/auth/api-key").json()
    assert (info["provider"], info["model"], info["base_url"]) == ("openai-compatible", "claude-opus-4.8", "https://codecraftapi.com/v1")
    assert info["has_key"] and info["provider_supported"] and info["provider_label"] == "OpenAI-compatible"


def test_custom_model_on_any_provider(api):
    r = _register(api, email="a2@example.com", username="custom1", llm_provider="openai", llm_model="gpt-5.5", api_key="sk-x")
    assert r.status_code == 200
    assert api.get("/auth/api-key").json()["model"] == "gpt-5.5"


def test_signup_without_model_stores_none_so_default_tracks_the_registry(api):
    assert _register(api, email="a3@example.com", username="nomodel", llm_model=None).status_code == 200
    assert api.get("/auth/api-key").json()["model"] is None


def test_ollama_signup_needs_no_key(api):
    r = _register(api, email="a4@example.com", username="local1", llm_provider="ollama", llm_model="llama3.2:3b", api_key="")
    assert r.status_code == 200, r.text
    assert api.get("/auth/api-key").json()["provider"] == "ollama"


def test_nvidia_signup_forces_the_official_base_url(api):
    r = _register(api, email="a5@example.com", username="nv1", llm_provider="nvidia-nim",
                  llm_model="meta/llama-3.3-70b-instruct", api_key="nvapi-x", llm_base_url="https://evil.example/v1")
    assert r.status_code == 200
    assert api.get("/auth/api-key").json()["base_url"] == "https://integrate.api.nvidia.com/v1"


@pytest.mark.parametrize("over,needle", [
    (dict(llm_provider="mistral"), "Unsupported provider"),
    (dict(llm_provider=""), "Unsupported provider"),
    (dict(llm_provider="openai-compatible", llm_model="m"), "Base URL is required"),
    (dict(llm_provider="openai-compatible", llm_model="m", llm_base_url="http://insecure.example/v1"), "https"),
    (dict(llm_model="bad model name"), "Model name"),
    (dict(api_key=""), "API key is required"),
])
def test_signup_rejections(api, over, needle):
    r = _register(api, email=f"r{abs(hash(str(over)))}@example.com", username=f"rej{abs(hash(str(over))) % 10**6}", **over)
    assert r.status_code == 400 and needle in r.json()["error"]["message"], r.text


def test_validation_message_is_shown_as_is_not_blamed_on_the_key(client, app_module, monkeypatch):
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (False, "Model 'x' wasn't found on Google Gemini."))
    r = _register(client, email="m1@example.com", username="msg1")
    assert r.json()["error"]["message"] == "Model 'x' wasn't found on Google Gemini."      # no misleading "Invalid API key:" prefix


def test_bad_provider_settings_do_not_create_the_account(client, app_module, monkeypatch):
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (False, "nope"))
    assert _register(client, email="ghost@example.com", username="ghost1").status_code == 400
    assert state.db.get_user_by_email("ghost@example.com") is None


def test_ollama_rejected_when_switched_off(api, monkeypatch):
    monkeypatch.setenv("ENABLE_OLLAMA", "false")
    r = _register(api, email="a6@example.com", username="local2", llm_provider="ollama", llm_model="llama3.2:3b", api_key="")
    assert r.status_code == 400 and "Unsupported provider" in r.json()["error"]["message"]


def test_changing_provider_in_settings(make_user, app_module, monkeypatch):
    c, _ = make_user("switcher")
    r = c.put("/auth/api-key", json={"api_key": "nvapi-new", "llm_provider": "nvidia-nim",
                                      "llm_model": "qwen/qwen3.5-122b-a10b"})
    assert r.status_code == 200
    info = c.get("/auth/api-key").json()
    assert (info["provider"], info["model"]) == ("nvidia-nim", "qwen/qwen3.5-122b-a10b")
    assert c.put("/auth/api-key", json={"api_key": "x", "llm_provider": "mistral"}).status_code == 400


def test_legacy_mistral_accounts_get_a_clear_instruction(make_user, app_module, pdf_bytes):
    c, uid = make_user("legacy")
    c.post("/upload", files={"file": ("a.pdf", pdf_bytes, "application/pdf")}, data={"session_id": SID})
    assert state.documents.wait_idle()          # the upload answers at once; indexing runs in the background
    state.db.execute("UPDATE users SET llm_provider = 'mistral', llm_model = 'mistral-large-2512' WHERE id = ?", (uid,))
    info = c.get("/auth/api-key").json()
    assert info["has_key"] and info["provider_supported"] is False
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID})
    assert r.status_code == 400 and "Settings" in r.json()["error"]["message"] and "mistral" in r.json()["error"]["message"].lower()
    assert (r.json()["error"]["code"], r.json()["error"]["action"]) == ("provider_unsupported", "settings")
    # fixing it in Settings restores service
    assert c.put("/auth/api-key", json={"api_key": "AIza-new", "llm_provider": "gemini"}).status_code == 200
    assert c.get("/auth/api-key").json()["provider_supported"] is True


# ═════════════════════════ end to end through a real provider path ═══════════
def test_chat_end_to_end_through_nvidia_nim(make_user, app_module, pdf_bytes, fake_http, dns):
    c, _ = make_user("e2e")
    assert c.put("/auth/api-key", json={"api_key": "nvapi-user-key", "llm_provider": "nvidia-nim",
                                         "llm_model": "meta/llama-3.3-70b-instruct"}).status_code == 200
    c.post("/upload", files={"file": ("a.pdf", pdf_bytes, "application/pdf")}, data={"session_id": SID})
    assert state.documents.wait_idle()          # the upload answers at once; indexing runs in the background
    fake_http.state["content"] = "<think>look at context</think>Mitosis is cell division."
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID})
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "Mitosis is cell division."            # reasoning stripped
    call = fake_http.calls[-1]
    assert call["url"].startswith("https://integrate.api.nvidia.com/v1/")
    assert call["auth"] == "Bearer nvapi-user-key"                      # the USER's key, not anyone else's


def test_two_users_on_one_custom_endpoint_never_share_keys(make_user, app_module, pdf_bytes, fake_http, dns):
    a, _ = make_user("user_a")
    b, _ = make_user("user_b")
    for cl, key, sid in ((a, "cc_AAAA", SID), (b, "cc_BBBB", "99999999-9999-4999-8999-999999999999")):
        assert cl.put("/auth/api-key", json={"api_key": key, "llm_provider": "openai-compatible", "llm_model": "m",
                                              "llm_base_url": "https://codecraftapi.com/v1"}).status_code == 200
        cl.post("/upload", files={"file": ("a.pdf", pdf_bytes, "application/pdf")}, data={"session_id": sid})
    assert state.documents.wait_idle()          # uploads answer at once; indexing runs in the background
    a.post("/chat", json={"question": "What is mitosis?", "session_id": SID})
    b.post("/chat", json={"question": "What is mitosis?", "session_id": "99999999-9999-4999-8999-999999999999"})
    assert [c["auth"] for c in fake_http.calls[-2:]] == ["Bearer cc_AAAA", "Bearer cc_BBBB"]


def test_provider_outage_is_a_502_with_guidance(make_user, app_module, pdf_bytes, monkeypatch, dns, sdk_http):
    mod, sync_cls, _ = sdk_http

    def refuse(self, request):
        raise mod.ConnectError("refused")
    monkeypatch.setattr(sync_cls, "handle_request", refuse)
    c, _ = make_user("outage")
    c.put("/auth/api-key", json={"api_key": "nvapi-k", "llm_provider": "nvidia-nim"})
    c.post("/upload", files={"file": ("a.pdf", pdf_bytes, "application/pdf")}, data={"session_id": SID})
    assert state.documents.wait_idle()          # the upload answers at once; indexing runs in the background
    r = c.post("/chat", json={"question": "What is mitosis?", "session_id": SID})
    assert r.status_code == 502 and "NVIDIA NIM" in r.json()["error"]["message"]
    assert (r.json()["error"]["code"], r.json()["error"]["action"]) == ("provider_unreachable", "retry")


# ═════════════════ errors name the field they are about (details.field) ═════════════════

def _field(r):
    return (r.json()["error"].get("details") or {}).get("field")


@pytest.mark.parametrize("over, field", [
    ({"email": "not-an-email"}, "email"),
    ({"username": "ab"}, "username"),
    ({"username": "has space"}, "username"),
    ({"full_name": "   "}, "full_name"),
    ({"password": "short"}, "password"),
])
def test_account_validation_errors_name_their_field(api, over, field):
    base = {"email": "f1@example.com", "username": "field_user"}
    r = _register(api, **{**base, **over})
    assert r.status_code == 400 and _field(r) == field, r.text


def test_taken_username_and_email_name_their_field(api):
    assert _register(api, email="t1@example.com", username="taken_name").status_code == 200
    again = _register(api, email="t2@example.com", username="TAKEN_name")
    assert again.status_code == 400 and _field(again) == "username"
    dup = _register(api, email="t1@example.com", username="other_name")
    assert dup.status_code == 400 and _field(dup) == "email"


@pytest.mark.parametrize("message, field", [
    ("Google Gemini rejected the API key — double-check it and try again.", "api_key"),
    ("Model 'x' wasn't found on Google Gemini. Choose another model.", "llm_model"),
    ("This key isn't allowed to use 'x'. Try another model.", "llm_model"),
    ("Ollama hasn't pulled 'x'. Run `ollama pull x` first (installed: none).", "llm_model"),
    ("Couldn't connect to OpenAI at example.com. Check the base URL and your network.", "llm_base_url"),
    ("Couldn't reach Ollama at http://localhost:11434. Is it running?", "llm_base_url"),
    ("Timed out waiting for OpenAI. Check the URL and try again.", "llm_base_url"),
    ("Google Gemini returned an error: boom", None),
])
def test_a_failed_provider_check_names_its_field(client, app_module, monkeypatch, message, field):
    monkeypatch.setattr("routers.auth.validate_api_key", lambda *a, **k: (False, message))
    r = _register(client, email="pf@example.com", username="pf_user")
    assert r.status_code == 400 and r.json()["error"]["code"] == "provider_settings_invalid"
    assert _field(r) == field and r.json()["error"]["message"] == message


def test_missing_key_and_unknown_provider_name_their_field(client, app_module):
    r = _register(client, email="mk@example.com", username="mk_user", api_key="")
    assert _field(r) == "api_key"
    r = _register(client, email="up@example.com", username="up_user", llm_provider="nope")
    assert _field(r) == "llm_provider"
