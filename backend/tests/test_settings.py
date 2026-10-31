"""Settings are read once, validated, and fail fast with a message that names every problem."""
import pytest

from config import SettingsError, load_settings

VALID = {
    "JWT_SECRET": "j" * 40,
    "ENCRYPTION_KEY": "uHw8Qy3m5y1m1N2s0Wc2n8cE0ZxqkC0m3dJX1xGk0aA=",   # valid Fernet key (test only)
}


def test_valid_env_loads_with_defaults():
    s = load_settings(dict(VALID))
    assert s.jwt_secret == VALID["JWT_SECRET"]
    assert (s.session_expiry_hours, s.max_sessions, s.max_sessions_per_user) == (24, 100, 10)
    assert (s.backend_host, s.backend_port) == ("0.0.0.0", 8000)
    assert s.cookie_secure is False and s.skip_warmup is False and s.fallback_llm_keys == ()
    assert s.allowed_origins == ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"]


def test_missing_secrets_fail_fast_and_name_both():
    with pytest.raises(SettingsError) as e:
        load_settings({})
    msg = str(e.value)
    assert "JWT_SECRET" in msg and "ENCRYPTION_KEY" in msg
    assert "secrets.token_hex" in msg and "Fernet.generate_key" in msg      # tells the operator what to do


def test_empty_secret_counts_as_missing():
    with pytest.raises(SettingsError, match="JWT_SECRET"):
        load_settings({**VALID, "JWT_SECRET": ""})


def test_malformed_encryption_key_is_rejected_at_startup():
    with pytest.raises(SettingsError, match="ENCRYPTION_KEY is invalid"):
        load_settings({**VALID, "ENCRYPTION_KEY": "not-a-fernet-key"})


def test_legacy_key_opt_in_still_allows_missing_encryption_key():
    s = load_settings({"JWT_SECRET": "j" * 40, "ALLOW_INSECURE_DEV_KEY": "true"})
    assert s.allow_insecure_dev_key is True and s.encryption_key == ""


def test_numbers_are_validated_with_the_variable_name():
    with pytest.raises(SettingsError) as e:
        load_settings({**VALID, "MAX_SESSIONS": "lots", "BACKEND_PORT": "80x"})
    assert "MAX_SESSIONS" in str(e.value) and "BACKEND_PORT" in str(e.value)
    assert load_settings({**VALID, "MAX_SESSIONS": "7"}).max_sessions == 7


def test_flags_origin_and_fallback_keys():
    s = load_settings({**VALID, "COOKIE_SECURE": "TRUE", "COURSEMATE_SKIP_WARMUP": "1",
                       "ALLOWED_ORIGIN": "https://app.example.com",
                       "OPENAI_API_KEY": "sk-o", "GOOGLE_API_KEY": "AIza-g"})
    assert s.cookie_secure is True and s.skip_warmup is True
    assert s.allowed_origins[-1] == "https://app.example.com"
    assert s.fallback_llm_keys == (("gemini", "AIza-g"), ("openai", "sk-o"))   # same priority order as before
    assert load_settings({**VALID, "COOKIE_SECURE": "1"}).cookie_secure is False   # only "true" enables it, as before


def test_secrets_never_appear_in_repr():
    text = repr(load_settings({**VALID, "OPENAI_API_KEY": "sk-LEAKME"}))
    assert VALID["JWT_SECRET"] not in text and VALID["ENCRYPTION_KEY"] not in text and "sk-LEAKME" not in text


def test_settings_are_immutable():
    s = load_settings(dict(VALID))
    with pytest.raises(Exception):
        s.jwt_secret = "changed"


def test_embedding_model_and_indexing_concurrency_come_from_settings():
    s = load_settings(dict(VALID))
    assert s.embedding_model == "BAAI/bge-large-en-v1.5" and s.index_concurrency == 2     # defaults unchanged
    s = load_settings({**VALID, "EMBEDDING_MODEL": " BAAI/bge-small-en-v1.5 ", "INDEX_CONCURRENCY": "4"})
    assert s.embedding_model == "BAAI/bge-small-en-v1.5" and s.index_concurrency == 4
    assert load_settings({**VALID, "EMBEDDING_MODEL": ""}).embedding_model == "BAAI/bge-large-en-v1.5"


@pytest.mark.parametrize("value", ["0", "-1", "two"])
def test_indexing_concurrency_must_be_a_positive_number(value):
    with pytest.raises(SettingsError, match="INDEX_CONCURRENCY"):
        load_settings({**VALID, "INDEX_CONCURRENCY": value})


def test_the_running_app_uses_the_configured_embedding_model(app_module):
    import state
    from config import settings
    from rag.embeddings import embedding_model_name
    assert embedding_model_name() == settings.embedding_model == state.documents.embedding_model


def test_retrieval_settings_have_conservative_defaults_and_can_be_overridden():
    s = load_settings(dict(VALID))
    assert (s.relevance_block_below, s.relevance_clarify_below, s.topic_min_similarity) == (0.30, 0.45, 0.40)
    assert s.retrieval_mmr_lambda == 0.7 and s.query_rewrite is True and s.query_rewrite_turns == 6
    s = load_settings({**VALID, "RELEVANCE_BLOCK_BELOW": "0.2", "RELEVANCE_CLARIFY_BELOW": "0.5",
                       "TOPIC_MIN_SIMILARITY": "0.35", "RETRIEVAL_MMR_LAMBDA": "1", "QUERY_REWRITE_TURNS": "4"})
    assert (s.relevance_block_below, s.relevance_clarify_below, s.topic_min_similarity) == (0.2, 0.5, 0.35)
    assert s.retrieval_mmr_lambda == 1.0 and s.query_rewrite_turns == 4


@pytest.mark.parametrize("value,expected", [("false", False), ("FALSE", False), ("0", False), ("off", False),
                                            ("true", True), ("1", True), ("", True)])
def test_query_rewrite_switch(value, expected):
    assert load_settings({**VALID, "QUERY_REWRITE": value}).query_rewrite is expected


@pytest.mark.parametrize("env", [
    {"RELEVANCE_BLOCK_BELOW": "1.5"}, {"TOPIC_MIN_SIMILARITY": "-0.1"}, {"RETRIEVAL_MMR_LAMBDA": "high"},
    {"QUERY_REWRITE_TURNS": "0"}, {"RELEVANCE_BLOCK_BELOW": "0.6", "RELEVANCE_CLARIFY_BELOW": "0.4"},
])
def test_invalid_retrieval_settings_fail_fast_with_the_variable_name(env):
    with pytest.raises(SettingsError) as e:
        load_settings({**VALID, **env})
    assert next(iter(env)) in str(e.value)
