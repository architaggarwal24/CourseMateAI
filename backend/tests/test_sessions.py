"""Revocable sessions, per-user rate limits behind trusted proxies, the login cookie's flags and CORS."""
import ipaddress

import pytest
from starlette.requests import Request

import middleware.client as net
import state
from conftest import api_client

PASSWORD = "correct-horse-1"
ORIGIN = "http://localhost:3000"


def login(app_module, who, **client_kwargs):
    """A second browser signing in as the same user."""
    c = api_client(app_module.app, **client_kwargs)
    r = c.post("/auth/login", json={"email": f"{who}@example.com", "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c


def named(make_user, who):
    c, uid = make_user(who)
    return c, uid


def cookie_of(client):
    return client.cookies.get("session_token")


def with_cookie(app_module, token):
    return api_client(app_module.app, cookies={"session_token": token})


# ═════════════════ sessions are revocable ═════════════════
def test_login_opens_a_server_side_session_and_the_token_itself_is_never_stored(make_user):
    c, uid = named(make_user, "sess1")
    token = cookie_of(c)
    assert token and len(token) >= 40
    assert state.auth_service.sessions.count_for_user(uid) == 1
    rows = state.db.query("SELECT id FROM sessions WHERE user_id = ?", [uid])
    assert rows[0]["id"] != token and token not in rows[0]["id"]          # only a keyed hash is in the database
    assert rows[0]["id"] == state.auth_service.token_id(token)


def test_after_logout_the_old_cookie_gets_401(make_user, app_module):
    c, uid = named(make_user, "sess2")
    stolen = cookie_of(c)
    assert with_cookie(app_module, stolen).get("/auth/me").status_code == 200
    assert c.post("/auth/logout").json() == {"success": True}
    assert state.auth_service.sessions.count_for_user(uid) == 0
    for url in ("/auth/me", "/profile", "/documents"):
        r = with_cookie(app_module, stolen).get(url)
        assert r.status_code == 401 or r.json().get("guest_mode"), url      # never serves the account again
    assert with_cookie(app_module, stolen).get("/auth/me").status_code == 401
    assert c.get("/auth/me").status_code == 401


def test_logout_only_ends_that_one_session(make_user, app_module):
    c1, _ = named(make_user, "sess3")
    c2 = login(app_module, "sess3")
    c1.post("/auth/logout")
    assert c1.get("/auth/me").status_code == 401
    assert c2.get("/auth/me").status_code == 200


def test_logout_without_a_session_is_harmless(app_module):
    c = api_client(app_module.app)
    assert c.post("/auth/logout").status_code == 200
    assert with_cookie(app_module, "garbage").post("/auth/logout").status_code == 200


def test_after_a_password_change_other_sessions_get_401_and_this_one_stays(make_user, app_module):
    c1, uid = named(make_user, "sess4")
    c2 = login(app_module, "sess4")
    c3 = login(app_module, "sess4")
    assert state.auth_service.sessions.count_for_user(uid) == 3
    r = c1.post("/auth/update-profile", json={"current_password": PASSWORD, "new_password": "brand-new-pass-9"})
    assert r.status_code == 200 and r.json()["message"] == "Profile updated"
    assert c2.get("/auth/me").status_code == 401
    assert c3.get("/auth/me").status_code == 401
    assert c1.get("/auth/me").status_code == 200
    assert state.auth_service.sessions.count_for_user(uid) == 1
    # and the new password is what works now
    fresh = api_client(app_module.app)
    assert fresh.post("/auth/login", json={"email": "sess4@example.com", "password": PASSWORD}).status_code == 401
    assert fresh.post("/auth/login", json={"email": "sess4@example.com", "password": "brand-new-pass-9"}).status_code == 200


def test_changing_only_the_profile_does_not_sign_other_devices_out(make_user, app_module):
    c1, _ = named(make_user, "sess5")
    c2 = login(app_module, "sess5")
    assert c1.post("/auth/update-profile", json={"full_name": "New Name"}).status_code == 200
    assert c2.get("/auth/me").status_code == 200


def test_a_wrong_current_password_revokes_nothing(make_user, app_module):
    c1, _ = named(make_user, "sess6")
    c2 = login(app_module, "sess6")
    r = c1.post("/auth/update-profile", json={"current_password": "wrong-password", "new_password": "brand-new-pass-9"})
    assert r.status_code == 401
    assert c2.get("/auth/me").status_code == 200


def test_account_deletion_revokes_every_session(make_user, app_module):
    c1, uid = named(make_user, "sess7")
    c2 = login(app_module, "sess7")
    t1, t2 = cookie_of(c1), cookie_of(c2)
    assert c1.delete("/auth/delete-account").json()["success"]
    assert state.db.query("SELECT 1 FROM sessions WHERE user_id = ?", [uid]) == []
    assert with_cookie(app_module, t1).get("/auth/me").status_code == 401
    assert with_cookie(app_module, t2).get("/auth/me").status_code == 401


def test_expired_sessions_are_rejected_and_purged(make_user, app_module):
    c, uid = named(make_user, "sess8")
    state.db.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00' WHERE user_id = ?", (uid,))
    assert c.get("/auth/me").status_code == 401
    assert state.auth_service.purge_expired_sessions() == 1


def test_forged_unknown_and_old_style_tokens_are_rejected(make_user, app_module):
    import jwt
    c, uid = named(make_user, "sess9")
    old_style = jwt.encode({"user_id": uid, "email": "sess9@example.com"}, "test-jwt-secret-" + "x" * 32, algorithm="HS256")
    for bad in ("", "nope", "a" * 43, old_style, cookie_of(c)[:-1] + "x"):
        assert with_cookie(app_module, bad).get("/auth/me").status_code == 401


def test_bearer_header_uses_the_same_session(make_user, app_module):
    c, _ = named(make_user, "sess10")
    token = cookie_of(c)
    bare = api_client(app_module.app)
    assert bare.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    c.post("/auth/logout")
    assert bare.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_logging_in_again_replaces_the_browsers_old_session(make_user, app_module):
    c, uid = named(make_user, "sess11")
    old = cookie_of(c)
    r = c.post("/auth/login", json={"email": "sess11@example.com", "password": PASSWORD})
    assert r.status_code == 200 and cookie_of(c) != old
    assert with_cookie(app_module, old).get("/auth/me").status_code == 401
    assert state.auth_service.sessions.count_for_user(uid) == 1


def test_a_user_keeps_at_most_the_newest_20_sessions(make_user, app_module):
    c, uid = named(make_user, "sess12")
    first = cookie_of(c)
    for _ in range(22):
        state.auth_service.login("sess12@example.com", PASSWORD)
    assert state.auth_service.sessions.count_for_user(uid) == 20
    assert with_cookie(app_module, first).get("/auth/me").status_code == 401       # the oldest went


# ═════════════════ the cookie ═════════════════
def set_cookie(response):
    return response.headers["set-cookie"].lower()


def test_cookie_flags_on_plain_http_localhost(make_user, app_module):
    make_user("cook1")
    r = api_client(app_module.app).post("/auth/login", json={"email": "cook1@example.com", "password": PASSWORD})
    flags = set_cookie(r)
    assert "httponly" in flags and "samesite=lax" in flags and "path=/" in flags
    assert "secure" not in flags.replace("httponly", "")                        # http://localhost must still work
    assert "max-age=604800" in flags


def test_cookie_is_secure_behind_an_https_proxy(make_user, app_module):
    make_user("cook2")
    behind_proxy = api_client(app_module.app, client=("172.18.0.3", 5000))
    r = behind_proxy.post("/auth/login", json={"email": "cook2@example.com", "password": PASSWORD},
                          headers={"X-Forwarded-Proto": "https"})
    assert "secure" in set_cookie(r).split("; ")
    # Next.js appends its own hop: "https,http" still means the browser used https.
    r = behind_proxy.post("/auth/login", json={"email": "cook2@example.com", "password": PASSWORD},
                          headers={"X-Forwarded-Proto": "https,http"})
    assert "secure" in set_cookie(r).split("; ")


def test_x_forwarded_proto_from_an_untrusted_client_is_ignored(make_user, app_module):
    make_user("cook3")
    r = api_client(app_module.app, client=("203.0.113.9", 5000)).post(
        "/auth/login", json={"email": "cook3@example.com", "password": PASSWORD}, headers={"X-Forwarded-Proto": "https"})
    assert "secure" not in set_cookie(r).split("; ")


def test_cookie_secure_setting_forces_the_flag(make_user, app_module, monkeypatch):
    import auth.cookies
    monkeypatch.setattr(auth.cookies, "settings", type("S", (), {"cookie_secure": True})())
    make_user("cook4")
    r = api_client(app_module.app).post("/auth/login", json={"email": "cook4@example.com", "password": PASSWORD})
    assert "secure" in set_cookie(r).split("; ")


def test_logout_clears_the_cookie_with_the_same_attributes(make_user):
    c, _ = named(make_user, "cook5")
    r = c.post("/auth/logout", headers={"X-Forwarded-Proto": "https"})
    flags = set_cookie(r)
    assert "session_token=" in flags and ("max-age=0" in flags or "expires=" in flags)
    assert "httponly" in flags and "samesite=lax" in flags and "path=/" in flags


# ═════════════════ client address behind proxies ═════════════════
def fake_request(peer, forwarded=None, proto=None, scheme="http"):
    headers = []
    if forwarded is not None:
        headers.append((b"x-forwarded-for", forwarded.encode()))
    if proto is not None:
        headers.append((b"x-forwarded-proto", proto.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "query_string": b"", "headers": headers,
                    "client": (peer, 1234) if peer else None, "scheme": scheme, "server": ("backend", 8000)})


@pytest.fixture()
def proxies(monkeypatch):
    def use(*cidrs):
        monkeypatch.setattr(net, "_networks", tuple(ipaddress.ip_network(c) for c in cidrs))
    use("10.0.0.0/8", "127.0.0.1/32")
    return use


def test_direct_callers_cannot_spoof_their_address(proxies):
    assert net.client_ip(fake_request("203.0.113.7", forwarded="1.2.3.4")) == "203.0.113.7"


def test_trusted_proxy_reports_the_real_client(proxies):
    assert net.client_ip(fake_request("10.0.0.2", forwarded="198.51.100.4")) == "198.51.100.4"


def test_only_the_part_added_by_our_own_proxies_is_believed(proxies):
    # the client sent "6.6.6.6"; nginx (10.0.0.9) appended the address it saw; Next (the peer) is 10.0.0.2
    assert net.client_ip(fake_request("10.0.0.2", forwarded="6.6.6.6, 198.51.100.4, 10.0.0.9")) == "198.51.100.4"


def test_a_chain_of_only_our_proxies_falls_back_to_the_first_hop(proxies):
    assert net.client_ip(fake_request("10.0.0.2", forwarded="10.0.0.7, 10.0.0.9")) == "10.0.0.7"


def test_trusted_proxy_without_or_with_garbage_header(proxies):
    assert net.client_ip(fake_request("10.0.0.2")) == "10.0.0.2"
    assert net.client_ip(fake_request("10.0.0.2", forwarded="not-an-ip")) == "10.0.0.2"
    assert net.client_ip(fake_request(None)) == "unknown"


def test_empty_trusted_proxy_list_trusts_nobody(proxies):
    proxies()
    assert net.client_ip(fake_request("10.0.0.2", forwarded="198.51.100.4")) == "10.0.0.2"
    assert not net.request_is_https(fake_request("10.0.0.2", proto="https"))


def test_ipv6_clients(proxies):
    assert net.client_ip(fake_request("10.0.0.2", forwarded="2001:db8::1")) == "2001:db8::1"


def test_https_detection(proxies):
    assert net.request_is_https(fake_request("203.0.113.7", scheme="https"))
    assert net.request_is_https(fake_request("10.0.0.2", proto="https"))
    assert net.request_is_https(fake_request("10.0.0.2", proto="https, http"))
    assert not net.request_is_https(fake_request("10.0.0.2", proto="http"))
    assert not net.request_is_https(fake_request("203.0.113.7", proto="https"))


def test_only_this_host_and_private_networks_are_trusted_by_default():
    trusted = tuple(ipaddress.ip_network(n) for n in net.TRUSTED_PROXY_NETWORKS)
    assert net._networks == trusted
    assert net._trusted("127.0.0.1") and net._trusted("172.18.0.3") and net._trusted("10.1.2.3") and net._trusted("::1")
    assert not net._trusted("203.0.113.7") and not net._trusted("not-an-ip")


# ═════════════════ rate limits ═════════════════
BAD_QUIZ = {"topic": "mitosis", "num_questions": 3, "question_type": "MCQ",
            "session_id": "11111111-1111-4111-8111-111111111111", "top_k": 0}      # answers 400 - but counts against 20/minute


def hammer(client, n):
    return [client.post("/quiz", json=BAD_QUIZ).status_code for _ in range(n)]


def test_limits_are_per_user_not_per_address(make_user, app_module):
    a, _ = named(make_user, "rate1")
    b, _ = named(make_user, "rate2")                       # same address ("testclient"), different account
    state.limiter.reset()
    assert hammer(a, 20) == [400] * 20
    assert hammer(a, 1) == [429]
    assert hammer(b, 1) == [400]                           # b is not punished for a's requests


def test_one_users_devices_share_one_budget(make_user, app_module):
    a, _ = named(make_user, "rate3")
    a2 = login(app_module, "rate3", client=("198.51.100.77", 4000))        # another device, another address
    state.limiter.reset()
    assert hammer(a, 20) == [400] * 20
    assert hammer(a2, 1) == [429]


def test_anonymous_routes_are_limited_per_client_address_behind_a_proxy(app_module):
    state.limiter.reset()
    proxy = api_client(app_module.app, client=("172.18.0.3", 5000))          # a trusted proxy in front of everyone
    wrong = {"email": "nobody@example.com", "password": "whatever1"}

    def attempt(ip):
        return proxy.post("/auth/login", json=wrong, headers={"X-Forwarded-For": ip}).status_code
    assert [attempt("203.0.113.1") for _ in range(5)] == [401] * 5
    assert attempt("203.0.113.1") == 429                   # that visitor is out of attempts ...
    assert attempt("203.0.113.2") == 401                   # ... but a different visitor behind the same proxy is not


def test_a_direct_client_cannot_dodge_the_limit_with_forged_forwarding_headers(app_module):
    state.limiter.reset()
    direct = api_client(app_module.app, client=("203.0.113.50", 5000))       # not a trusted proxy
    wrong = {"email": "nobody@example.com", "password": "whatever1"}
    codes = [direct.post("/auth/login", json=wrong, headers={"X-Forwarded-For": f"9.9.9.{i}"}).status_code
             for i in range(7)]
    assert codes[:5] == [401] * 5 and codes[5:] == [429, 429]


# ═════════════════ CORS ═════════════════
def preflight(client, method="POST", headers="content-type", origin=ORIGIN):
    return client.options("/auth/login", headers={
        "Origin": origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers})


def test_cors_allows_what_the_app_needs(app_module):
    c = api_client(app_module.app)
    for method in ("GET", "POST", "PUT", "DELETE"):
        r = preflight(c, method=method, headers="content-type, authorization")
        assert r.status_code == 200, method
        assert r.headers["access-control-allow-origin"] == ORIGIN
        assert r.headers["access-control-allow-credentials"] == "true"


def test_cors_refuses_other_methods_headers_and_origins(app_module):
    c = api_client(app_module.app)
    assert preflight(c, method="PATCH").status_code == 400
    assert preflight(c, headers="x-custom-header").status_code == 400
    assert preflight(c, headers="content-type, x-requested-with").status_code == 400
    assert "access-control-allow-origin" not in preflight(c, origin="https://evil.example").headers
    allowed = preflight(c).headers
    assert "*" not in allowed.get("access-control-allow-headers", "") and "*" not in allowed.get("access-control-allow-methods", "")
