# Model routing, costs and the quiz bank (Phase 3, Stage 4b)

> **Note (Stage 4.6):** written for the Python backend, which is gone. The rules still hold; the code is now under `frontend/src/server/`, and settings and admin tasks are in [deploy-cloudflare.md](deploy-cloudflare.md) and the in-app Admin panel.

## Who answers

`core_brains/model_router.py` picks the models; `core_brains/llm_connection.py` (`request_targets`, `_routed`, `_routed_async`, `stream_llm_with_key`) calls them.

- **Your own key (BYOK):** a user who saved their own provider key always gets their own model. There is one target and no routing. This also applies with no meter (scripts, older tests).
- **The server's AI:** the router's plan for the call's **job** and the user's **plan** (the meter carries the plan tier, set in `deps.inject_user_llm_key`).

### Jobs

| Job | What | Tagged by |
|---|---|---|
| `small` | boss dialogue (flavour), rewriting a follow-up question | `with llm_job("small")` in `boss_brain.boss_flavor_async`; `ask_llm_quick_async` is always small |
| `strong` (default) | chat answers, quizzes, flashcards, notes, exams, battle questions, expeditions, concept maps | everything else |

### Slots (env, each `provider:model`; the model is optional)

| Slot | Env | Default |
|---|---|---|
| fast | `LLM_FAST` | the first server key (`GOOGLE_API_KEY`, then NVIDIA, OpenAI, Anthropic), its default model |
| strong | `LLM_STRONG` | fast |
| premium | `LLM_PREMIUM` | strong |
| local | `LOCAL_LLM` + `LOCAL_LLM_BASE_URL` + `LOCAL_LLM_TIMEOUT` (25 s) | off |

The local slot is `ollama:<model>` (default URL `http://localhost:11434`) or `openai-compatible:<model>` with a URL (LM Studio, vLLM, llama.cpp). It is the operator's own config, so it is **trusted**:

- it may be Ollama even when users can't pick Ollama (`ENABLE_OLLAMA=false`);
- its URL may be plain http on the LAN.

Users' own URLs still go through the SSRF checks.

### Routes (first = best; the rest are fallbacks)

| Plan | small | strong |
|---|---|---|
| Apprentice | local → fast | fast → strong |
| Scholar | local → fast | strong → fast |
| Sage | local → fast | strong → fast |
| Archmage | fast → local | premium → strong → fast |

`MODEL_ROUTES_JSON` overrides any of it, for example `{"apprentice": {"strong": ["local", "fast"]}}` to run free accounts fully local. A slot that isn't configured, or whose provider has no server key, is skipped. Duplicates are dropped. `python scripts/admin.py routes` prints the result.

### Fallbacks

- A target that fails hands the call to the next one. Failures include a down server, a local model slower than its timeout, a quota or key refusal, an empty or unusable answer, or any other error. The last target's error is raised as before.
- A streamed chat answer falls back only before its first piece; text already sent can't be taken back.
- Every fallback is counted (`model_usage_daily.fallbacks`) and logged as `model X failed (Error); trying Y`.

## Costs

- Every response is attributed to the provider and model that answered (`usage_meter.add_tokens / add_call / add_fallback`).
- `UsageService.record` adds the cost to the user's day (`usage_daily.cost_micro_usd`) and to `model_usage_daily (day, provider, model, job)`: calls, tokens, cost, fallbacks, own-key calls.
- **Prices are yours to set** in `MODEL_PRICES_JSON`, in USD per 1M tokens (`{"provider:model": [in, out]}`, or `provider:*`). Providers change them, so none are built in.
- A local model (Ollama, or the `LOCAL_LLM` slot) costs 0, and so does a call on a user's own key.
- A model without a price counts 0 and is listed as **unpriced**.
- `python scripts/admin.py costs --days 30` shows per model and job, the total (in ₹ too with `USD_TO_INR`), the unpriced models and the top 10 users.

## The quiz bank (per document)

`services/quiz_bank.py`, tables `quiz_bank` and `quiz_bank_served`:

- Every generated quiz question is kept, keyed by the document's **content hash**, the topic (normalised) and the question type. Every user with the same PDF shares it. Each question text is stored once, with at most 400 per topic.
- On `/quiz`, after the short per-request cache (`GENERATION_CACHE_TTL`) misses, the topic is still checked against the PDF (no AI). If the bank holds enough questions **this user hasn't had**, the quiz is made from them with **no AI call**. Otherwise a fresh batch is generated, added and marked as had.
- A user never gets the same banked question twice, so asking again brings new questions.
- Answers stay on the server (the quiz is stored and graded as before).
- `QUIZ_BANK=0` turns it off.

## Data (migration 0013)

`usage_daily.cost_micro_usd`, `model_usage_daily`, `quiz_bank`, `quiz_bank_served`. Deleting a user deletes their served rows; the bank stays, since it belongs to the document's content.
