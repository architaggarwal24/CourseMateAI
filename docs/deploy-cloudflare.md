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
browser ── https://coursemateai.<you>.workers.dev (or your domain)
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
5. **First deploy, by hand:** `npm run cf:deploy`. It prints the address, e.g. `https://coursemateai.<you>.workers.dev`.
6. **Settings:** in the Cloudflare dashboard, open Workers & Pages → `coursemateai` → Settings → Variables and Secrets. Add:

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

**Settings** (Cloudflare dashboard → `coursemateai` → Settings → Variables and Secrets):

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
3. Verify the email. Without an email service, the code is in the Worker's log: run `npx wrangler tail` and look for `[coursemate-email]`, or use Workers & Pages → `coursemateai` → Logs.
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

## AI (Stage 4.3)

Every AI call is the server's: students can't add keys of their own. Each call counts against the student's plan: calls a day and tokens a month.

**Models** (dashboard → Variables and Secrets):

| Setting | What it is | Example |
|---|---|---|
| `LLM_FAST` | a cheap API model | `gemini:gemini-3.5-flash-lite` |
| `LLM_STRONG` | for questions and answers (default: `LLM_FAST`) | `gemini:gemini-3.8-flash` |
| `LLM_PREMIUM` | the strongest, for Archmage (default: `LLM_STRONG`) | `claude:claude-sonnet-5-5` |
| `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `NVIDIA_API_KEY` (Secrets) | the key for each provider you use | |
| `WORKERS_AI_MODEL` | small jobs (follow-up rewrites, boss lines) on Workers AI | default `@cf/meta/llama-3.1-8b-instruct-fp8` |

**Who gets what:**

| Plan | Questions | Small jobs |
|---|---|---|
| Apprentice | fast, then strong | Workers AI, then fast |
| Scholar, Sage | strong, then fast | Workers AI, then fast |
| Archmage | premium, then strong, then fast | fast, then Workers AI |

If a model fails, the next one in the line takes over. Workers AI is always the last resort. `MODEL_ROUTES_JSON` overrides any of this.

**Costs and the cap:**
- Set real prices in `MODEL_PRICES_JSON`, in US dollars per 1M tokens, e.g. `{"gemini:gemini-3.8-flash": [0.3, 2.5], "claude:*": [3, 15]}`. A model without a price is counted at `[1, 4]` and shown as *estimated* in Admin.
- **Admin → AI spend** shows today's spend, the last 30 days by model, and which model answers what.
- It also sets the **daily cap** (default $2, about ₹170). Once the day's spend reaches the cap, every call goes to Workers AI until midnight UTC: answers get simpler, but the app never stops.

**Check:** `/api/system/status` shows `ai.detail` as your fast model. Without any key it says Workers AI only.

## Study tools (Stage 4.4)

Quizzes, flashcards, notes, the history, the review queue, exams and the concept map run on the Worker. Nothing to set up: migration `0004_study` adds their tables on deploy.

- **A topic must be in the document.** Quiz, flashcards and notes search it first; below `TOPIC_MIN_SIMILARITY` (default 0.40) the answer is "not covered in your PDF", with no AI call.
- **Cached for a week:** the same flashcards or notes request (same document, topic and options) is answered from D1 for `GENERATION_CACHE_DAYS` days (default 7; 0 turns it off).
- **Quizzes are never repeated.** A quiz asks the model for whole batches of 5. The spare questions go to the student's own question bank for that document and topic. The next quiz takes questions they haven't had from the bank, with no AI call, before writing new ones. Banks are per student, never shared.
- **Review queue:** FSRS (`ts-fsrs`), one queue per student, 20 new cards a day (days are UTC).
- **Exams:** written in parallel batches. The score report is the results page itself: **Save as PDF** opens the browser's print dialog and prints only the report.
- **Concept map:** one AI pass per PDF (by file hash), reused by every course with that PDF. The map is made inside the *Make the concept map* request while the page polls for its progress line. If the tab closes mid-way, the build shows as stalled after about 6 minutes and can be started again.
- XP, coins and quests (`rewards`) stay `null` until the game moves over in 4.5.

## Auto-deploy from GitHub

1. Cloudflare dashboard → *My Profile* → API Tokens → *Create Token* → template **Edit Cloudflare Workers**. Make sure these *Account* permissions are on it (add any missing): *Workers Scripts → Edit*, *D1 → Edit*, *Workers R2 Storage → Edit*, *Vectorize → Edit*, *Workers AI → Read*. Account Resources: your account. Create it and copy the token (shown once).
2. In GitHub: repository → Settings → Secrets and variables → Actions → *New repository secret*:
   - `CLOUDFLARE_API_TOKEN`: the token;
   - `CLOUDFLARE_ACCOUNT_ID`: the long hex id in the dashboard URL (`dash.cloudflare.com/<account id>/...`), or run `npx wrangler whoami`.
3. Push to `main`. The **deploy** job runs after the backend and frontend tests pass. It migrates D1, builds with OpenNext and deploys. Without the two secrets the deploy job fails (red X) and says which secret is missing. After adding them, open the latest run → *Re-run all jobs*.

A deploy doesn't cut off people already using the app: requests that are already running finish on the old version.

Don't also connect the repository under Workers Builds in the dashboard (Worker → Settings → Build): every push would deploy twice, and Workers Builds skips the tests and the D1 migrations. If it is connected, disconnect it there.

**Renaming the Worker:** change `"name"` and the `WORKER_SELF_REFERENCE` `"service"` in `wrangler.jsonc` together, deploy (a new Worker is created), set its Variables and Secrets again (they belong to a Worker), then delete the old Worker. D1 and R2 aren't touched.

## The Python backend during the move

Your PC runs the backend only; the app itself is the Worker.

1. `backend\.env`:
   - `PROXY_SECRET=<the same value as the Worker's>`
   - `ALLOWED_ORIGIN=https://coursemateai.<you>.workers.dev` (the Worker's address, or your domain once you add one)
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
