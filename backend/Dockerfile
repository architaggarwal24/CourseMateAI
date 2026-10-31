# syntax=docker/dockerfile:1

# ── build stage: install the dependencies into a virtualenv (compilers/caches never reach the final image) ──
FROM python:3.11-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /build
COPY requirements.txt .
RUN pip install -r requirements.txt

# ── runtime stage: the virtualenv + the code, run by an unprivileged user ──
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    COURSEMATE_DATA_DIR=/app/data \
    COURSEMATE_UPLOAD_DIR=/app/uploads \
    HF_HOME=/app/.cache/huggingface

RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=builder /opt/venv /opt/venv
COPY --chown=app:app . .
# The folders the app writes to belong to it (a named volume mounted on one inherits that ownership).
RUN mkdir -p /app/data /app/uploads /app/.cache/huggingface \
 && chown -R app:app /app/data /app/uploads /app/.cache
USER app

EXPOSE 8000

# Liveness only (the process answers). Readiness - database + embedding model loaded - is GET /api/v1/ready.
# The long start period covers loading the Python stack; the embedding model downloads in the background.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
