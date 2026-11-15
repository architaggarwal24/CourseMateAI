# Payments: Razorpay subscriptions (Phase 3 Stage 4c; on the Worker since Phase 4 Stage 4.6)

Payments are off unless `PAYMENTS_ENABLED=1`. While they are off, plans come only from the admin panel (Admin → Users → plan) and invite codes, and the upgrade buttons say "coming soon". Settings go in the Cloudflare dashboard (Workers → `coursemateai` → Settings → Variables and Secrets), or in `.dev.vars` locally. The code is `src/server/account/billing.ts`.

## Providers

| `PAYMENTS_PROVIDER` | What happens |
|---|---|
| unset (Razorpay) | Real subscriptions. Needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and `RAZORPAY_PLAN_IDS_JSON`. Missing keys keep payments off (and a warning is logged). |
| `stub` | A test provider that "pays" at once: no network, no money. It is only on when set on purpose, so a production server can't fall into it by accident. |

## Setting up Razorpay (test mode first)

1. Razorpay Dashboard, **Test mode**: **Account & Settings → API keys → Generate**. This gives `RAZORPAY_KEY_ID` (`rzp_test_…`) and `RAZORPAY_KEY_SECRET`.
2. **Subscriptions → Plans → Create plan**, six times: Scholar ₹149 monthly (period monthly, interval 1), Scholar ₹1,490 yearly, Sage ₹299 / ₹2,990, Archmage ₹599 / ₹5,990. Copy each plan id into:
   `RAZORPAY_PLAN_IDS_JSON={"scholar:month": "plan_…", "scholar:year": "plan_…", "sage:month": "plan_…", "sage:year": "plan_…", "archmage:month": "plan_…", "archmage:year": "plan_…"}`
   A plan left out is refused at checkout ("isn't on sale yet").
3. **Account & Settings → Webhooks → Add new webhook**:
   - URL: `https://<your domain>/api/v1/billing/webhook`
   - Secret: any long random string; put the same in `RAZORPAY_WEBHOOK_SECRET`
   - Events: every `subscription.*` event (authenticated, activated, charged, pending, halted, cancelled, completed, paused, resumed)
   - The webhook needs a public URL: use the Worker's address.
4. Set `PAYMENTS_ENABLED=1` (a dashboard change takes effect at once). Test with Razorpay's test cards or UPI (`success@razorpay`).
5. To go live: generate live keys, create the same plans in live mode, update the env, and add a live webhook.

## The flow

1. **Upgrade** (Account → Plan & usage) calls `POST /billing/checkout {tier, period}`. The server creates a Razorpay subscription for that plan id (`notes.user_id`, 120 monthly or 10 yearly charges) and stores it in `subscriptions`.
2. The browser loads `checkout.razorpay.com/v1/checkout.js` (only now, never before) and opens Checkout with `key` and `subscription_id`.
3. Checkout's handler returns `razorpay_payment_id`, `razorpay_subscription_id` and `razorpay_signature` to `POST /billing/verify`. The server checks `HMAC-SHA256(payment_id + "|" + subscription_id, key secret)`, fetches the subscription and switches the plan on at once.
4. **Webhooks** (`POST /billing/webhook`, no login) keep it in step. The signature is checked (`X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret)`), and each `X-Razorpay-Event-Id` is handled once (`payment_events`). Events for unknown subscriptions are ignored.
5. **Cancel** (`POST /billing/cancel`) cancels at the end of the period (`cancel_at_cycle_end: 1`). The plan stays until then.
6. **Switching plans:** a new subscription that becomes active cancels the old one at once (no proration).

## Plan sync

The subscription's status sets the user's plan in `user_plans` (source `subscription`, ref = subscription id):

| Status | Plan |
|---|---|
| authenticated, active, pending | the plan, until the paid period ends + 3 days' grace (each charge moves it on) |
| cancelled, completed | until the paid period ends, no grace |
| halted, paused, expired | back to the default plan now |

An old subscription ending never touches a newer plan.

## API

`GET /billing`, `POST /billing/checkout`, `POST /billing/verify`, `POST /billing/cancel`, `POST /billing/webhook`, `POST /billing/stub/complete` (stub only). `GET /plans → payments_enabled` drives the UI.

## Data (migration 0007_billing)

`subscriptions` (deleted with the user) and `payment_events`.

## Mana: top-up packs for AI use (budgets pass, Stage 3)

When a paid user's daily AI budget (Admin → AI spend → Daily budgets; `src/server/ai/budget.ts`) is used up, their answers come from the free Workers AI model until midnight UTC, unless they have **Mana**. Mana is bought in one-time packs and pays for AI answers past the budget, so the full model keeps answering. It never expires, is only for AI use, and is kept apart from the game's coins (the Hero shop only links to the packs).

| Pack | Price | Mana |
|---|---|---|
| Pouch of Mana | ₹49 | 49 |
| Flask of Mana | ₹99 | 104 |
| Well of Mana | ₹199 | 219 |

- **1 Mana = $0.006 of real AI cost** (`MANA_MICRO_USD` in `src/server/account/wallet.ts`). About half of each pack's money goes to the models; the rest covers Razorpay's fee, GST and the app. Keep `MODEL_PRICES_JSON` right, because Mana is spent at those prices.
- **Who:** Scholar, Sage and Archmage. Free users are shown the plans. Leftover Mana still works after a downgrade.
- **Spending:** a call that the user's or the plan's budget refuses reserves its worst-case cost against the wallet (and the global cap) instead. The wallet's CHECK keeps reservations inside the balance, and the real cost comes off after the call (one `use` row a user a day in `mana_ledger`).
- **Where:** Account → Plan & usage (`#mana`): today's AI budget as a share, the balance and the packs. Answers in the tutor chat that a budget changed carry a calm note ("a lighter model answered … Top up Mana", or "Answered with your Mana").

### The flow (Razorpay Orders)

1. `POST /billing/mana/checkout {pack}` creates a Razorpay order (`amount` in paise, `notes.kind = "mana"`) and stores it in `mana_orders`.
2. The browser opens Checkout with `order_id`. Its handler returns `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature` to `POST /billing/mana/verify`. The server checks `HMAC-SHA256(order_id + "|" + payment_id, key secret)` and fetches the order. If the order is `paid`, the Mana is credited. Otherwise the answer is `pending` and the webhook credits it.
3. **Webhook:** add the **`order.paid`** event to the same webhook (Razorpay Dashboard → Webhooks). It credits the order, but only an order this app created.
4. **Exactly once:** crediting inserts a `purchase` row in `mana_ledger` (UNIQUE on kind + ref). A trigger moves the balance in the same statement, so Checkout, verify and the webhook can all report the same payment safely.
5. **Stub:** with `PAYMENTS_PROVIDER=stub`, `POST /billing/mana/stub {order_id}` pays at once.

**Before going live:** in test mode, buy each pack with a test card or UPI (`success@razorpay`), check the balance on Plan & usage, and check that one `order.paid` delivery (and a redelivery) adds the Mana once.

Data (migration 0023_mana): `ai_wallet`, `mana_ledger`, `mana_orders`. All are deleted with the user and included in the data export.
