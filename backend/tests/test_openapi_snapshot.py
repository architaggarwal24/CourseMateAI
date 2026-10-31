"""backend/openapi.json (input of the generated frontend client) must match the running app."""
import json
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parent.parent / "openapi.json"


def test_openapi_snapshot_is_current(app_module):
    live = json.loads(json.dumps(app_module.app.openapi(), sort_keys=True))
    saved = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert saved == live, (
        "backend/openapi.json is stale. Regenerate it and the TypeScript client with `make gen-api` "
        "(or `npm run gen:api` in frontend/) and commit the result."
    )
