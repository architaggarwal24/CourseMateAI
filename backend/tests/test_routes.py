"""Contract test: the public API surface (path + HTTP method) must not change by accident.

EXPECTED lists the resource paths; every one is served under /api/v1."""
from conftest import API_PREFIX

EXPECTED = [
    ("/achievements", "GET"),
    ("/arena/battles", "POST"),
    ("/arena/battles/active", "GET"),
    ("/arena/battles/{battle_id}", "GET"),
    ("/arena/battles/{battle_id}/answer", "POST"),
    ("/arena/battles/{battle_id}/forfeit", "POST"),
    ("/arena/battles/{battle_id}/items", "POST"),
    ("/arena/battles/{battle_id}/question", "GET"),
    ("/arena/battles/{battle_id}/spells", "POST"),
    ("/arena/leaderboard", "GET"),
    ("/arena/runs", "POST"),
    ("/arena/runs/active", "GET"),
    ("/arena/runs/leaderboard", "GET"),
    ("/arena/runs/{run_id}", "GET"),
    ("/arena/runs/{run_id}/abandon", "POST"),
    ("/arena/runs/{run_id}/choose", "POST"),
    ("/arena/runs/{run_id}/travel", "POST"),
    ("/arena/weak-concepts", "GET"),
    ("/auth/api-key", "GET"),
    ("/auth/api-key", "PUT"),
    ("/auth/check-username", "GET"),
    ("/auth/delete-account", "DELETE"),
    ("/auth/login", "POST"),
    ("/auth/logout", "POST"),
    ("/auth/me", "GET"),
    ("/auth/register", "POST"),
    ("/auth/update-profile", "POST"),
    ("/avatar", "GET"),
    ("/avatar/hero-forge-save", "POST"),
    ("/avatar/update", "POST"),
    ("/chat", "POST"),
    ("/chat/stream", "POST"),
    ("/daily-quests", "GET"),
    ("/documents", "GET"),
    ("/documents/{document_id}", "GET"),
    ("/daily-quests/claim", "POST"),
    ("/flashcards", "POST"),
    ("/health", "GET"),
    ("/ready", "GET"),
    ("/history", "GET"),
    ("/history/session/{session_id}", "GET"),
    ("/hud", "GET"),
    ("/items/use", "POST"),
    ("/notes", "POST"),
    ("/profile", "GET"),
    ("/providers", "GET"),
    ("/quiz", "POST"),
    ("/quiz/answer", "POST"),
    ("/quiz/finish", "POST"),
    ("/rewards/award", "POST"),
    ("/shop", "GET"),
    ("/shop/equip", "POST"),
    ("/shop/purchase", "POST"),
    ("/shop/unequip", "POST"),
    ("/study/flashcards/review", "POST"),
    ("/study/review-deck", "GET"),
    ("/upload", "POST"),
]


def test_every_endpoint_is_still_served_at_the_same_url(app_module):
    spec = app_module.app.openapi()
    actual = sorted((path, method.upper()) for path, item in spec["paths"].items() for method in item)
    assert actual == sorted((API_PREFIX + path, method) for path, method in EXPECTED)


def test_main_is_a_thin_alias_for_the_app(app_module):
    import app as app_pkg
    assert app_module.app is app_pkg.app


def test_mutating_endpoints_take_json_bodies_not_query_strings(app_module):
    spec = app_module.app.openapi()
    offenders = [
        f"{method.upper()} {path} ?{p['name']}"
        for path, item in spec["paths"].items()
        for method, op in item.items() if method in ("post", "put", "patch", "delete")
        for p in op.get("parameters", []) if p["in"] == "query"
    ]
    assert not offenders, offenders


def test_no_request_body_takes_a_user_id(app_module):
    """Identity always comes from the session cookie, never from the payload."""
    schemas = app_module.app.openapi()["components"]["schemas"]
    offenders = [n for n, sc in schemas.items() if n.endswith("Request") and "user_id" in sc.get("properties", {})]
    assert not offenders, offenders
