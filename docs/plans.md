# Plans, quotas and usage (Phase 3, Stage 4a)

> **Note (Stage 4.6):** written for the Python backend, which is gone. The rules still hold; the code is now under `frontend/src/server/`, and settings and admin tasks are in [deploy-cloudflare.md](deploy-cloudflare.md) and the in-app Admin panel.

Four plans, enforced on the server. Prices are in INR per month; a year costs 10 months.

| | Apprentice (Free) | Scholar (Pro) | Sage (Pro Plus) | Archmage (Max) |
|---|---|---|---|---|
| Price | ₹0 | ₹149 / ₹1,490 a year | ₹299 / ₹2,990 | ₹599 / ₹5,990 |
| Documents | 3 | 15 | 50 | 150 |
| PDF size | 10 MB | 25 MB | 50 MB | 50 MB |
| AI calls a day | 25 | 150 | 400 | 1,200 |
| AI tokens a month | 300k | 3M | 10M | 30M |
| Courses | - | - | 10 | 30 |
| Features | chat, quizzes, notes, flashcards, arena | + review queue | + exams, courses, concept map, PDF viewer | everything |

The numbers live in `services/entitlements.py` (`PLANS`). `PLAN_LIMITS_JSON` overrides any of them without a code change, for example `{"apprentice": {"ai_calls_day": 40}}`.

## Which plan a user is on

`entitlements.tier_for(user_id)` decides:

1. The user's row in `user_plans`, while `expires_at` hasn't passed. The row comes from an invite code, an admin (`scripts/admin.py plan set`) or, from Stage 4c, a subscription.
2. Otherwise `DEFAULT_TIER`. When it is unset this is `archmage`, so a dev setup has everything. **Set `DEFAULT_TIER=apprentice` for testers and production.**

## What is enforced, and where

| Limit | Where | Error |
|---|---|---|
| Features | `entitlements.require(user, feature)` in each endpoint | 403 `feature_locked`, action `plans` |
| Documents | `upload_service.handle_pdf_upload`: a new id only; replacing a document adds none | 403 `plan_limit` (`documents`) |
| PDF size | the same, after reading the file | 403 `plan_limit` (`pdf_mb`) |
| Courses | `CourseService.create` | 403 `plan_limit` (`courses`) |
| AI calls a day, tokens a month | `deps.inject_user_llm_key`, before any AI work starts (chat, quiz, flashcards, notes, exams, battles, runs, concept maps) | 429 `plan_limit` (`ai_calls_day` / `tokens_month`), with `details.resets_at` |

A `plan_limit` error carries `details: {limit, used, allowed, tier, upgrade_tier, upgrade_tier_name, resets_at?}`, and its action `plans` makes the UI offer **See plans** (Account, Plan & usage).

The turns of a fight already started are never cut off. A battle's next question and its answers use `inject_user_llm_key_in_flight`, which meters but doesn't check. Days are UTC days, and months are calendar months.

## Metering

`core_brains/usage_meter.py`:

- The request sets who is metered (`begin(user_id, byok)`). A background task it starts (a concept map, for example) inherits that.
- `LLMClient` reports one **AI call** per logical call that succeeds (retries included), plus the **tokens** of every model response. These are the provider's `usage_metadata` when it sends one, else an estimate of 4 characters per token.
- A streamed chat answer outlives the request, so `usage_meter.carry()` keeps its meter.
- The numbers go to `usage_daily (user_id, day, ai_calls, byok_calls, tokens_in, tokens_out, byok_tokens)` through `UsageService.record`. A failing sink never fails a model call.

**The user's own key (BYOK):** calls made on a key the user saved are metered, but they are outside the AI quotas (`QUOTA_BYOK_EXEMPT=1`, the default). They cost the server nothing. Document, size and course limits still apply.

## The server's own AI

When the server has a provider key in its environment (`GOOGLE_API_KEY`, `NVIDIA_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`), **CourseMate's AI** is available (`GET /plans` → `managed_ai: true`):

- Sign-up offers it by default, so no key is needed.
- Settings lets a user go back to it (`DELETE /auth/api-key`).
- Those accounts run on the server key within their plan's quotas.

Stage 4b routes these calls per tier and per job.

## Invite codes

- `INVITE_ONLY=1` makes sign-up need a code (400 `invite_invalid`, field `invite_code`).
- A code grants its tier for N days (or for good) to up to `max_uses` users, until it expires (`--valid-days`) or is revoked.
- Redeeming (at sign-up, or Account → Plan & usage → Invite code) never lowers a running plan. A code for the same tier adds its days to the current end date.

```
python scripts/admin.py invite create --tier sage --days 30 --uses 20 --note "first testers"
python scripts/admin.py invite create --tier scholar --code BETA-SCHOLAR --days 14 --uses 50 --valid-days 7
python scripts/admin.py invite list
python scripts/admin.py invite revoke BETA-SCHOLAR
python scripts/admin.py plan set someone@example.com archmage --days 30
python scripts/admin.py plan clear someone@example.com
python scripts/admin.py usage someone@example.com
```

## API

| | |
|---|---|
| `GET /plans` | Every plan (price, limits, features, highlights), `invite_only`, `managed_ai`, `payments_enabled` (false until 4c). No login. |
| `GET /account/usage` | Plan, source, expiry, limits, use (AI calls today, tokens this month, documents, courses), own-key use, reset times, the last 30 days. |
| `POST /account/redeem {code}` | Redeem an invite code (10 an hour). |
| `DELETE /documents/{id}` | Delete a document, freeing a place on the plan. |
| `DELETE /auth/api-key` | Switch to the server's AI. |

## UI

- **Account → Plan & usage** (`components/account/PlanUsage.tsx`): the plan card and four meters (amber at 80%, red when used up), your documents with delete, the invite-code box, and the four plans with a monthly / yearly switch. Upgrade buttons say "coming soon" until payments open.
- `UpgradeCard` (locked features) links to it, and so does every `plan_limit` / `feature_locked` toast ("See plans").

## Data (migration 0012)

`user_plans`, `usage_daily`, `invite_codes`, `invite_redemptions`. Deleting a user deletes their rows. Codes stay; only their redemptions go.
