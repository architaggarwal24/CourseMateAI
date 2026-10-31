"""Write the API schema to backend/openapi.json.

That file is the input of the frontend's generated client (`npm run gen:api`), and
tests/test_openapi_snapshot.py fails whenever it no longer matches the running app.

    python scripts/export_openapi.py          # from backend/
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
OUT = BACKEND / "openapi.json"


def build_schema() -> dict:
    # Importing the app validates settings and opens its databases, so give it throwaway ones:
    # exporting the schema must work without real secrets and must never touch real data.
    tmp = tempfile.mkdtemp(prefix="coursemate-openapi-")
    os.environ.setdefault("JWT_SECRET", "openapi-export-only-" + "x" * 32)
    os.environ.setdefault("ENCRYPTION_KEY", "uHw8Qy3m5y1m1N2s0Wc2n8cE0ZxqkC0m3dJX1xGk0aA=")
    os.environ["COURSEMATE_DATA_DIR"] = os.path.join(tmp, "data")
    os.environ["COURSEMATE_UPLOAD_DIR"] = os.path.join(tmp, "uploads")
    sys.path.insert(0, str(BACKEND))
    try:
        from main import app
        return json.loads(json.dumps(app.openapi(), sort_keys=True))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    schema = build_schema()
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(schema, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"wrote {OUT.relative_to(BACKEND.parent)} ({len(schema['paths'])} paths)")


if __name__ == "__main__":
    main()
