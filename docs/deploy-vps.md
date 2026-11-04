# Production on a VPS: Docker Compose with Caddy (Phase 3, Stage 4e)

`deploy/vps/docker-compose.yml` runs:

- **caddy**: HTTPS with automatic Let's Encrypt certificates on :80/:443 (HTTP/3 too), HSTS, compression, a 55 MB upload cap. `/api/*` goes to the backend (streamed, 300 s read timeout); everything else goes to the frontend.
- **backend**: the FastAPI image (`backend/Dockerfile`), one uvicorn worker, trusting the proxy headers from Caddy on the private Docker network.
- **frontend**: the Next.js standalone image (`frontend/Dockerfile`), built with `BACKEND_URL=http://backend:8000`.
- **postgres** (profile `postgres`, optional): PostgreSQL 16 with a health check.
- **backup** (profile `backup`, optional): daily database + PDF backup into `deploy/vps/backups`, kept 14 days.

Only Caddy publishes ports. The data lives in named volumes: `data` (SQLite), `uploads` (PDFs, indexes), `models` (the embedding model), `pgdata`, and `caddy_data` (certificates).

## A VPS for India

Pick a region close to your users: **Bangalore** (DigitalOcean BLR1, Linode/Akamai Chennai or Mumbai) or **Singapore** (most providers), or AWS / GCP Mumbai. Sizing:

| Users | VPS | Notes |
|---|---|---|
| testers, < 50 | 2 vCPU, 4 GB RAM, 40 GB disk | bge-small embeddings on the CPU, SQLite |
| a few hundred | 4 vCPU, 8 GB | PostgreSQL profile |

Compare current prices on the providers' sites.

## Steps

1. **Server:** Ubuntu 24.04 LTS. Install Docker (`curl -fsSL https://get.docker.com | sh`). Open ports 80 and 443 only (`ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw enable`).
2. **DNS:** an `A` record for your domain pointing at the VPS IP. On Cloudflare, use *DNS only* (grey cloud) for the first start, so Caddy can get its certificate; you can switch the proxy on after.
3. **Code:** copy the project to the server (git clone, or `scp` the folder).
4. **Settings:** `cd deploy/vps && cp .env.example .env` and fill in `DOMAIN`, `ACME_EMAIL`, the AI keys and the plan settings. Generate the two secrets:
   ```sh
   docker run --rm python:3.11-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
   docker run --rm python:3.11-slim sh -c "pip -q install cryptography && python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
   ```
   **Keep a copy of `.env` off the server.**
5. **Start:**
   ```sh
   docker compose up -d --build                                     # SQLite
   docker compose --profile postgres --profile backup up -d --build # PostgreSQL + daily backups
   ```
   For PostgreSQL also set `POSTGRES_PASSWORD` and `DATABASE_URL=postgresql://coursemate:<password>@postgres:5432/coursemate` in `.env`.
6. **Check:** `docker compose ps` (all healthy), `docker compose logs -f backend`, then open `https://<domain>`.
7. **Invite testers:** `docker compose exec backend python scripts/admin.py invite create --tier sage --days 30 --uses 20`.

## Updating

```sh
git pull        # or copy the new files
docker compose up -d --build
```

Migrations apply when the backend starts. The `models` volume keeps the embedding model between builds.

## Moving from the PC to the VPS

1. On the PC: `.\deploy\windows\stop.ps1`, then `.\deploy\windows\backup.ps1`.
2. Copy `backups\coursemate-<date>.db`, `backend\uploads\files\` (the kept PDFs) and **the same `ENCRYPTION_KEY` and `JWT_SECRET`** to the VPS. The key is needed for saved API keys; the secret keeps sessions valid.
3. **SQLite:** put the file in the `data` volume as `coursemate.db`:
   ```sh
   docker compose run --rm -v "$PWD:/in" backend cp /in/coursemate.db /app/data/
   ```
   Put the PDFs under `/app/uploads/files/` the same way.
   **PostgreSQL:** run `scripts/sqlite_to_postgres.py` (docs/postgres.md) against the `postgres` service.
4. The search indexes rebuild from the PDFs when a document is opened, or users re-upload. Then `docker compose up -d`.

## Things to know

- **Cloudflare in front** (orange cloud): set SSL/TLS to *Full (strict)*. Caddy keeps its own certificate.
- **Backups:**
  - **SQLite:** `sqlite3 .backup`, safe while running.
  - **PostgreSQL:** `pg_dump --format=custom`. Restore with `pg_restore --clean -d <url> file.dump`.
  - Copy `deploy/vps/backups` off the server regularly.
- **Logs:** JSON lines from the backend (`docker compose logs backend`). Errors go to Sentry when `SENTRY_DSN` is set.
