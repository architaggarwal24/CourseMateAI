# One Google project, one paid Gemini key: a guide for moving off a separate "free key" project

> **For the Claude chat reading this:** the owner runs this project with two Google Cloud projects, one per Gemini key
> (a free-tier key for free users and a paid key for paying users). They want one project with one paid key, with the
> free plan served by a cheap model on that key and spending limits that cannot be exceeded. Read the whole guide,
> then look at how this codebase calls Gemini, tracks usage and decides plans. Ask the owner scope questions before
> building, then build it in stages with tests. The design below is stack-neutral: map each part to this project's own
> database, framework and secret store.
>
> Written 15 Nov 2026 from the design used in CourseMateAI. Google's tiers, caps and prices change; check the linked
> pages before relying on a number.

---

## 1. Why one paid key instead of a free key and a paid key

**Free or paid is decided by billing, not by the key.** A Google Cloud project linked to an active billing account is on
the paid tier, and every Gemini API key in that project is paid. Keys have no billing setting of their own. So a free
key needs a whole separate project with no billing, which is why the project has two today.
([Gemini API billing](https://aistudio.google.com/docs/billing))

**The free tier is the wrong place for users' data.** Google's Gemini API terms say that on unpaid services Google uses
what you send and what comes back to improve its products, that human reviewers may read it, and that you should not
send sensitive, confidential or personal information. A free plan's users send exactly that: their documents, their
questions, their names. On the paid tier, prompts and responses are not used to improve Google's products.
([Gemini API terms](https://ai.google.dev/gemini-api/terms))

**One project is simpler to run.** One key to rotate, one bill, one quota to watch, one place for spend caps.

**What makes it safe** is not the key but the app: the free plan uses a cheap model, every call's cost is reserved
before it runs, and limits at three levels (the whole app, each plan, each user) stop spending before it happens.
Google-side caps sit behind that as a backstop.

**Check the age rule.** The same terms say you must be 18 or older to use the APIs and must not use them in an app
"directed towards or is likely to be accessed by individuals under the age of 18". This applies to paid keys too. If
this project has younger users, get legal advice or route them to a provider whose terms allow it. This guide does not
solve that.

---

## 2. The target design at a glance

```
user request
   │
   ▼
plan + job ──► route: an ordered list of models, cheapest-that-is-good-enough first, free fallback last
   │
   ▼
for each model in the route:
   estimate worst-case cost ──► RESERVE it against: user budget, plan budget, global cap (all or nothing)
        │ reserved                               │ refused
        ▼                                        ▼
   call the model (max output tokens set)    try the next model in the route
        │                                     (the free fallback costs 0, so it always passes)
        ▼
   SETTLE: replace the reservation with the real cost from the response's usage
```

Every piece is described below.

---

## 3. Routing: which model answers which plan

Keep a small table of **slots** (named model choices) and **routes** (per plan and job, an ordered list of slots).

| Slot | Example | Used for |
| --- | --- | --- |
| `small` | a free model (Cloudflare Workers AI, a self-hosted model) | the last fallback; short, simple jobs |
| `fast` | `gemini-*-flash-lite` on the paid key | the free plan's main model; cheap paid jobs |
| `strong` | `gemini-*-flash` | paid plans' main model |
| `premium` | the best model you pay for | the top plan |

```
free plan:  ["fast", "small"]              # flash-lite until the free budget is used, then the free model
paid plan:  ["strong", "fast", "small"]
top plan:   ["premium", "strong", "fast", "small"]
```

- The first slot that is configured **and** passes its budget reservation answers. The rest are fallbacks, also used
  when a provider errors or times out.
- Put the slot-to-model mapping in settings (environment or an admin page) so you can change models without a deploy.
- The free fallback must be free for real. Do not use another provider's free tier here: most of them have the same
  data-use terms as Gemini's free tier.

---

## 4. Counting cost

Keep a **price table**: `provider:model → [input $ per 1M tokens, output $ per 1M tokens]`. Store money as integers
(micro-dollars, `$1 = 1,000,000`) so sums never drift.

```
cost_micro = tokens_in * price_in + tokens_out * price_out      # price in $/1M tokens, so the 1e6 cancels out
```

- A model with **no price** in the table is charged at a deliberately high estimate, so a forgotten price can only make
  the limits stricter, never looser. Show "estimated" next to it in the admin view.
- **Thinking tokens are billed as output** on Gemini models that think. Either turn thinking off or give it a fixed
  budget per job, and include that budget in the worst case below.
- The free fallback model costs 0.

---

## 5. Limits that cannot be exceeded: reserve, then settle

### The bug to avoid

The common approach is: check "spent today < limit", call the model, then add the cost. With 50 requests arriving in the
same second, all 50 pass the check before any cost is added, and the limit is overshot by 50 calls. A limit is only
airtight if the money is taken **before** the call, in one atomic step.

### Worst-case cost of a call

```
worst_in   = estimated input tokens (be generous: about 1 token per 2 characters covers Hindi and other non-Latin
             scripts; or call Gemini's countTokens endpoint for an exact number)
worst_out  = max_output_tokens you set on the request + the thinking budget
worst_cost = worst_in * price_in + worst_out * price_out
```

**Always set `max_output_tokens` on every request.** Without it there is no worst case and no airtight limit.

### The budget table

One row per scope per day. Scopes: `global`, `plan:<name>`, `user:<id>`, and `wallet:<id>` for top-up credits
(section 7).

```sql
CREATE TABLE ai_budget (
  scope          TEXT    NOT NULL,   -- 'global' | 'plan:free' | 'user:123'
  day            TEXT    NOT NULL,   -- UTC date, '2026-11-15'
  spent_micro    INTEGER NOT NULL DEFAULT 0,
  reserved_micro INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, day)
);
```

### Reserve (atomic, before the call)

```sql
-- make sure the row exists
INSERT INTO ai_budget (scope, day) VALUES (:scope, :day) ON CONFLICT DO NOTHING;

-- take the money only if it fits; :limit comes from settings at this moment
UPDATE ai_budget
   SET reserved_micro = reserved_micro + :worst
 WHERE scope = :scope AND day = :day
   AND spent_micro + reserved_micro + :worst <= :limit;
-- 1 row changed: reserved.  0 rows changed: over the limit.
```

Reserve against **every** scope that applies (user, then plan, then global). It is all or nothing: if any one refuses,
release the ones already taken and move to the next model in the route. If your database has transactions, wrap the
three in one; if it does not (Cloudflare D1, for example), the conditional `UPDATE` above is the compare-and-set that
makes each step safe, and the release undoes the earlier ones.

Passing `:limit` from settings (instead of storing it in the row) means a limit you lower in the admin page applies to
the very next call.

### Settle (after the call)

```sql
UPDATE ai_budget
   SET reserved_micro = reserved_micro - :worst,
       spent_micro    = spent_micro + :actual
 WHERE scope = :scope AND day = :day;
```

- `:actual` comes from the usage numbers in the model's response.
- **Call failed:** settle with `:actual = 0` (or what the provider says it billed).
- **Streaming and the user disconnected:** settle with the usage you received; if you got none, settle at `:worst`.
  Never leave a reservation open on purpose.
- **Crash between reserve and settle:** the reservation stays until the day ends. That fails safe: the budget is a bit
  lower, never higher. Optionally keep a reservations list with timestamps and sweep ones older than ten minutes.
- **Fallbacks and retries:** each attempt reserves for its own model's price. Release a failed attempt before the next.

### Why this cannot overshoot

The money is taken before the call, the check and the take are one statement, and the most a call can cost is its
reservation, because output is capped by `max_output_tokens` and the input estimate is generous. The only way past a
limit is an input estimate that is too low, which is why the estimate leans high (or uses countTokens).

### The three levels

| Level | Example start | What it protects |
| --- | --- | --- |
| Global daily cap | $2 a day, with a hard ceiling (e.g. $20) that only a config change can raise | your bill |
| Per-plan daily budget | free plan: $0.25 a day for all free users together | paying users' share from free users |
| Per-user daily budget | free user: $0.02 a day | the plan's budget from one heavy user |

When a level refuses, the route falls through to the next slot, and finally to the free model. The user keeps getting
answers; show a calm note ("the strong model is resting until midnight") rather than an error.

Pick one day boundary (UTC is simplest) and say so in the UI ("resets at 5:30 am IST").

---

## 6. Google-side backstops (behind the app's limits)

The app's limits are the real control. These catch a bug in them. ([Gemini API billing](https://aistudio.google.com/docs/billing))

1. **Prepay billing with a small balance (the strongest backstop).** With Prepay you buy credit in advance
   ($5 minimum). When the balance reaches $0, every key on that billing account stops working (HTTP 402). Usage is
   deducted with roughly a 10-minute lag, so a small overage is possible. Keep the balance at a few days of spend and
   top it up by hand. Treat a 402 as "provider unavailable" and fall back to the free model.
2. **Project spend cap** (AI Studio, Spend page; experimental). Set a monthly cap per project. Google warns it can be
   overshot while billing data catches up (about 10 minutes), so it is a backstop, not a limit.
3. **Tier caps** are automatic monthly caps on the billing account (Tier 1: $250 a month at the time of writing). When
   reached, service pauses for all projects on that account until the next month.
4. **Budget alerts** in Cloud Billing email you at 50%, 90% and 100% of a monthly amount. They only alert; they do not
   stop spending.
5. **Lock the key down.** In Credentials, name it (for example `prod-gemini`), restrict it to the Generative Language
   API only, and keep it server-side in your secret store. Never put it in client code or a public environment variable.

---

## 7. Optional: top-up credit packs for paid users

When a paid user hits their daily budget, they can buy a credit pack instead of falling back to the free model.

- **Who:** paid plans only. Free users are offered the paid plans instead.
- **What:** one-time packs (for example ₹49) that add credits to a wallet. Credits never expire. One credit is tied to a
  fixed amount of real AI cost with a margin, so a pack can never cost you more than it earned.
- **Order:** daily user budget first, then wallet credits, then the free model.
- **Same airtight rule:** reserve against the wallet like any other scope (`balance - reserved >= worst`), settle after.
- **Credits are added only by a verified payment:** the payment provider's webhook, with its signature checked, and
  idempotent on the payment ID so a repeated webhook cannot add credits twice. Never trust the browser's "payment
  succeeded".
- **Keep a ledger** (one row per purchase, use and refund), not just a balance, so every credit can be explained.
- **Keep credits separate from any game currency** so real money never buys in-game advantages.
- Hide the whole feature behind a flag until payments have been tested live.

---

## 8. Moving from two projects to one: checklist

1. **Choose the project to keep:** the one with billing and anything else that matters (OAuth clients for Google
   sign-in, other APIs). Rename its **display name** if you like (for example "MyApp Prod"); the project **ID** never
   changes, so sign-in and other integrations keep working.
2. Check billing is linked. Decide Prepay or Postpay (section 6).
3. Create one key in that project, name it, restrict it to the Generative Language API, and store it in the secret store
   under one name (for example `GOOGLE_API_KEY`).
4. Build the price table, routing and budgets (sections 3–5) with tests. Point the free plan's route at flash-lite, then
   the free model.
5. Remove the second key from the code: one key name, one client.
6. Deploy, then test on production: a free account and a paid account each make a few calls; check the budget rows
   move and the fallback kicks in when you set a tiny limit.
7. Set the Google-side backstops (section 6).
8. **Before shutting the old free project down,** check it holds nothing else (OAuth clients, other APIs, service
   accounts). Delete its key first, watch the logs for a day, then shut it down (Google keeps it recoverable for about
   30 days).

---

## 9. Tests worth writing

- **Concurrency:** fire 50 reservations at once against a limit that fits 10; exactly 10 succeed, and spent + reserved
  never passes the limit.
- **Settle:** a reservation of 100 settled at 30 leaves spent 30, reserved 0.
- **All or nothing:** the user budget passes and the plan budget refuses; the user reservation is released.
- **Failure paths:** a provider error, a timeout and a disconnected stream each leave no open reservation.
- **Routing:** the free plan goes flash-lite → free model; past any limit the free model answers; a 402 from Google
  falls back too.
- **Prices:** an unpriced model is charged at the high estimate.
- **Limits from settings:** lowering a limit applies to the next call; a limit can never be set above the ceiling.
- **Top-ups:** a repeated webhook adds credits once; a bad signature adds nothing; a free-plan user cannot buy.
- **Guard test:** every model call goes through the one function that reserves and settles (for example, search the
  source for direct calls to the provider client outside it).
