# CourseMate on Cloudflare Workers (Phase 4)

Phase 4 moves the whole app onto Cloudflare and removes the Python backend. It happens one area at a time:

| Stage | Area |
|---|---|
| 4.0 | the base (this guide) |
| 4.1 | accounts and admin |
| 4.2 | documents and search |
| 4.3 | the AI layer |
| 4.4 | study tools |
| 4.5 | the game |
| 4.6 | billing and launch |

Until an area has moved, the Worker forwards its calls to the Python backend.

```
browser ── https://coursemate.<you>.workers.dev (or your domain)
              │  Cloudflare Worker: the Next.js app (OpenNext) + the routes already moved (src/app/api/…)
              │  bindings: D1 database (DB), R2 bucket (FILES)
              └─ every other /api call ──► BACKEND_URL (the Python backend on your PC, through a Cloudflare Tunnel)
```

Pushing to `main` deploys the app, once the tests pass (GitHub Actions, `.github/workflows/ci.yml`).

## What you need

- A Cloudflare account. The free plan allows commercial use. **Workers Paid** (about $5 a month) raises the limits and is needed later for Queues and Durable Objects. Check the current prices on cloudflare.com.
- Node.js 22 and the project's `frontend` folder (`npm ci` done).
- Your GitHub repository.

## One-time setup (PowerShell, in `frontend\`)

1. **Log in:** `npx wrangler login`. A browser opens; allow it.
2. **Create the database** in Asia-Pacific:
   ```powershell
   npx wrangler d1 create coursemate --location apac
   ```
   Copy the printed `database_id` into `frontend\wrangler.jsonc`, replacing the `00000000-…` placeholder. Commit it: it isn't a secret.
3. **Create the file bucket:**
   ```powershell
   npx wrangler r2 bucket create coursemate-files
   ```
4. **Migrate the database:** `npm run db:migrate:remote`.
5. **First deploy, by hand:** `npm run cf:deploy`. It prints the address, e.g. `https://coursemate.<you>.workers.dev`.
6. **Settings:** in the Cloudflare dashboard, open Workers & Pages → `coursemate` → Settings → Variables and Secrets. Add:

   | Name | Value |
   |---|---|
   | `BACKEND_URL` | the Python backend's address (next section), e.g. `https://legacy.example.com` |
   | `PROXY_SECRET` (Secret) | 32+ random characters. **The same value** goes in `backend\.env` as `PROXY_SECRET`. |
   | `OWNER_EMAIL` | your email (see *Accounts* below) |
   | `BETTER_AUTH_SECRET` (Secret) | 32+ random characters (see *Accounts*) |

   A deploy keeps these, because `keep_vars` is set in `wrangler.jsonc`. To generate a secret:
   `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`
7. **Check:** open `https://<address>/api/system/status`. It should answer `"ok": true`, with the database and storage ok, and `backend.ok` true once step 8 of the next section is done.

## Accounts (Stage 4.1)

Sign-up, sign-in, email codes, two-step sign-in, Google, and the admin page all run on the Worker. They use Better Auth, with the code in `src/server/auth`.

**Settings** (Cloudflare dashboard → `coursemate` → Settings → Variables and Secrets):

| Name | Needed | What it does |
|---|---|---|
| `BETTER_AUTH_SECRET` (Secret) | yes | 32+ random characters. Signs sessions and encrypts two-step secrets. **Never change it once people have accounts.** |
| `OWNER_EMAIL` | yes | Your email. That account is always an admin and on Archmage, once its email is verified. |
| `BETTER_AUTH_URL` | with a custom domain | e.g. `https://study.example.com`, so links and Google's redirect use your domain. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Secret) | for Google sign-in | See below. Without them there's no Google button. |
| `EMAIL_FROM` | to send codes | e.g. `CourseMate <no-reply@study.example.com>` |
| `RESEND_API_KEY` (Secret) | one way to send codes | See *Emails*. |
| `PASSWORD_HASH_ITERATIONS` | no | Default 20000, which fits the free plan's CPU limit. On Workers Paid, set `100000` (the most Workers allows). Each password is re-hashed at the user's next sign-in. |

**Making yourself the owner:**
1. Set `OWNER_EMAIL`.
2. Sign up with that email.
3. Verify the email. Without an email service, the code is in the Worker's log: run `npx wrangler tail` and look for `[coursemate-email]`, or use Workers & Pages → `coursemate` → Logs.
4. **Account → Admin** appears.

Sign up as the owner before anyone else can. Until the email is verified the account isn't the owner, so another person signing up with your address first gets nothing, but it would block your sign-up.

**Emails** (verification and password-reset codes, and emailed two-step codes):
- **Cloudflare Email Service:** needs Workers Paid and a sending domain set up in the dashboard (Email Service). Then add this to `wrangler.jsonc`:
  ```jsonc
  "send_email": [{ "name": "EMAIL" }]
  ```
  and set `EMAIL_FROM`.
- **Resend:** has a free tier. Add your domain on resend.com, then set `RESEND_API_KEY` and `EMAIL_FROM`.
- **Neither (the default):** nothing is sent.
  - Sign-up doesn't ask for a code.
  - Codes are written to the Worker's log, for you.
  - Students can't reset a forgotten password themselves. You can ban and re-invite, or set up email.

**Google sign-in:**
1. In Google Cloud Console → APIs & Services → Credentials, create an *OAuth client ID* of type *Web application*.
2. Under *Authorised redirect URIs*, add `https://<your address>/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

A Google account with the same email as an existing account signs into that account.

**Limits that protect accounts:**

| Action | Limit |
|---|---|
| sign-in | 5 a minute per address |
| sign-up | 10 an hour |
| codes | 3 a minute |
| redeeming invite codes | 10 an hour |
| admin actions | 120 a minute |

They're kept in D1, so every Worker instance shares them.

## Documents and search (Stage 4.2)

PDFs, their text and search all run on Cloudflare:

- **Reading the PDF:** done in the browser (pdf.js). The Worker never parses a PDF, so it fits the free plan's CPU limit.
- **The file:** kept in R2 (`FILES`) for the page viewer.
- **The text:** each page is cut into chunks (1000 characters), stored in D1.
- **Search:** each chunk is embedded by Workers AI (`@cf/baai/bge-small-en-v1.5`) and the vectors go in Vectorize (`VECTORS`).

**One-time setup** (in `frontend\`):

```powershell
npx wrangler vectorize create coursemate-chunks --dimensions=384 --metric=cosine
npx wrangler vectorize create-metadata-index coursemate-chunks --property-name=doc --type=string
```

Create the metadata index before uploading anything: vectors added earlier can't be filtered by document. Also give the GitHub deploy token **Account → Vectorize → Edit** and **Account → Workers AI → Read**.

**Check:** `/api/system/status` shows `search: ok`. Then upload a PDF and try `/api/v1/documents/<id>/search?q=<a question>`, which lists the passages the chat would answer from.

**Running it locally:** Workers AI and Vectorize only run on Cloudflare's network. So `npm run dev` / `cf:preview` can only index and search after `npx wrangler login`. The tests use stand-ins (`src/server/test/search-fakes.ts`).

**Scanned PDFs** (photos of pages, no text layer) are refused before anything is uploaded, with a message saying so.

**Free plan limits:**

| Service | Free allowance | About |
|---|---|---|
| Workers AI | 10,000 neurons a day | ~20,000 chunks embedded a day |
| Vectorize | 5 million stored dimensions | ~13,000 chunks in all, i.e. 10–15 textbooks across every user |
| Workers Paid | 10 million stored dimensions included, then very cheap | — |

A deleted document frees its share.

## Auto-deploy from GitHub

1. Cloudflare dashboard → *My Profile* → API Tokens → *Create Token* → template **Edit Cloudflare Workers**. Add the permission *Account → D1 → Edit*, then create it.
2. In GitHub: repository → Settings → Secrets and variables → Actions → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN`: the token;
   - `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers & Pages overview page.
3. Push to `main`. The **deploy** job runs after the backend and frontend tests pass. It migrates D1, builds with OpenNext and deploys. Without the two secrets it only prints a warning.

A deploy doesn't cut off people already using the app: requests that are already running finish on the old version.

Don't also connect the repository under Workers Builds in the dashboard, or every push deploys twice.

## The Python backend during the move

Your PC runs the backend only; the app itself is the Worker.

1. `backend\.env`:
   - `PROXY_SECRET=<the same value as the Worker's>`
   - `ALLOWED_ORIGIN=https://coursemate.<you>.workers.dev` (the Worker's address, or your domain once you add one)
   - `COOKIE_SECURE=true`
2. **A tunnel hostname for the backend**, e.g. `legacy.example.com`:
   ```powershell
   .\deploy\windows\tunnel.ps1 -Hostname legacy.example.com
   ```
   This script sets `ALLOWED_ORIGIN` to the tunnel address, so set it back to the Worker's address afterwards (step 1).
3. **Start:** `.\deploy\windows\start.ps1 -BackendOnly`. This starts the backend, Ollama and the tunnel, without the frontend.
4. **Point the Worker at it:** `BACKEND_URL=https://legacy.example.com` (dashboard, step 6 above).

To try it without a domain, run `start.ps1 -BackendOnly -Quick` and use the `trycloudflare.com` address it prints as `BACKEND_URL`. It changes on every start.

`PROXY_SECRET` is what lets the backend see each student's real address through the Worker and the tunnel. Without it, every student shares one address, and the per-address rate limits (login, sign-up) would count them all together.

## Working on it locally

| Command (in `frontend\`) | What it does |
|---|---|
| `npm run dev` | Next.js dev server; D1 and R2 come from wrangler's local copy (`.wrangler/`) |
| `npm run db:migrate:local` | migrate that local D1 |
| `npm run cf:preview` | build the real Worker and run it locally on :8787 (the same runtime as production) |
| `npm run db:generate` | after changing `src/server/db/schema.ts`, write the next migration into `migrations/` |
| `npm run cf:typegen` | after changing `wrangler.jsonc`, regenerate `cloudflare-env.d.ts` |

Local settings go in `frontend\.dev.vars` (copy `.dev.vars.example`); it's never committed.

## Rules for the TypeScript backend

- **Routes** go in `src/app/api/v1/<area>/…/route.ts`. They take priority over the catch-all proxy (`src/app/api/[...path]/route.ts`), so moving a route is: write it, test it, push.
- **Errors** use `apiError()` (`src/server/errors.ts`): the same `{ error: { code, message, action, details } }` shape the UI already reads.
- **Bindings** come from `getEnv()` (`src/server/env.ts`). Tests use a real local D1/R2 (`localPlatform()` in `src/server/test/platform.ts`) and start server test files with `/** @vitest-environment node */`.
- **Migrations only add.** The deploy migrates before the new version goes live, so the version still serving must keep working. `src/server/migrations.test.ts` enforces this.

## Costs and limits to know

These are as of 2026; check them on cloudflare.com.

- **Free plan:**
  - 100,000 Worker requests a day.
  - 10 ms of CPU per request. Waiting on AI providers doesn't count as CPU. Heavy steps (PDF parsing, embedding) are designed for this in Stage 4.2.
  - A 3 MB (gzip) Worker. CourseMate's was 1.3 MB at 4.0 and 2.3 MB at 4.1. The later stages will probably go over 3 MB, which means Workers Paid (10 MB).
  - If the logs show error 1102 (CPU exceeded), switch to Workers Paid.
- **Workers Paid (about $5 a month):** 10 million requests a month included, up to 5 minutes of CPU per request, Queues and Durable Objects.
- **D1:** 5 GB on the free plan; one primary database (set to Asia-Pacific).
- **R2:** 10 GB free, and no download (egress) fees.
