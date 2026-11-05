"""The Cloudflare Worker in front of the backend (Phase 4 Stage 0, docs/deploy-cloudflare.md).

While areas move to the Worker one at a time, the rest still reaches this backend through it - and through a
Cloudflare Tunnel, whose own X-Forwarded-For names the Worker, not the student. The Worker proves itself with
PROXY_SECRET and names the real client in X-CoursemateAI-Client-IP; nothing else may set that header."""
from starlette.requests import Request

from config.settings import load_settings
from middleware import client as net

SECRET = "s" * 40


def req(peer="127.0.0.1", secret=None, client_ip=None, proto=None, forwarded=None):
    headers = []
    if secret is not None:
        headers.append((b"x-coursemateai-proxy", secret.encode()))
    if client_ip is not None:
        headers.append((b"x-coursemateai-client-ip", client_ip.encode()))
    if proto is not None:
        headers.append((b"x-forwarded-proto", proto.encode()))
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "query_string": b"", "headers": headers,
                    "client": (peer, 1234), "scheme": "http", "server": ("backend", 8000)})


def use_secret(monkeypatch, value=SECRET):
    monkeypatch.setattr(net, "PROXY_SECRET", value)


def test_the_worker_names_the_real_client(monkeypatch):
    use_secret(monkeypatch)
    r = req(secret=SECRET, client_ip="198.51.100.4", forwarded="104.28.0.9")   # the tunnel's hop is the Worker
    assert net.client_ip(r) == "198.51.100.4"


def test_the_worker_header_works_from_any_peer_with_the_secret(monkeypatch):
    use_secret(monkeypatch)
    assert net.client_ip(req(peer="203.0.113.50", secret=SECRET, client_ip="2001:db8::7")) == "2001:db8::7"


def test_a_wrong_or_missing_secret_is_ignored(monkeypatch):
    use_secret(monkeypatch)
    assert net.client_ip(req(peer="203.0.113.50", secret="nope", client_ip="198.51.100.4")) == "203.0.113.50"
    assert net.client_ip(req(peer="203.0.113.50", client_ip="198.51.100.4")) == "203.0.113.50"


def test_without_a_configured_secret_the_header_means_nothing(monkeypatch):
    use_secret(monkeypatch, "")
    assert net.client_ip(req(peer="203.0.113.50", secret="", client_ip="198.51.100.4")) == "203.0.113.50"


def test_garbage_in_the_client_header_falls_back(monkeypatch):
    use_secret(monkeypatch)
    assert net.client_ip(req(peer="203.0.113.50", secret=SECRET, client_ip="not-an-ip")) == "203.0.113.50"


def test_the_worker_says_whether_the_browser_used_https(monkeypatch):
    use_secret(monkeypatch)
    assert net.request_is_https(req(peer="203.0.113.50", secret=SECRET, proto="https"))
    assert not net.request_is_https(req(peer="203.0.113.50", secret="nope", proto="https"))


def test_the_secret_must_be_long():
    base = {"JWT_SECRET": "x" * 40, "ENCRYPTION_KEY": "", "ALLOW_INSECURE_DEV_KEY": "true"}
    assert load_settings({**base, "PROXY_SECRET": "p" * 32}).proxy_secret == "p" * 32
    assert load_settings(base).proxy_secret == ""
    import pytest
    from config.settings import SettingsError
    with pytest.raises(SettingsError, match="PROXY_SECRET"):
        load_settings({**base, "PROXY_SECRET": "short"})


def test_a_bad_database_url_is_reported_too():
    import pytest
    from config.settings import SettingsError
    base = {"JWT_SECRET": "x" * 40, "ENCRYPTION_KEY": "", "ALLOW_INSECURE_DEV_KEY": "true"}
    with pytest.raises(SettingsError, match="DATABASE_URL"):
        load_settings({**base, "DATABASE_URL": "mysql://x"})
