# Accounting tab: photo + natural-language smart entry

## Problem

The Accounting tab's primary onboarding path today is bank/card linking via
Plaid, which is explicitly stubbed and disabled server-side
(`server/src/connectors/finance-connector.ts`: `live_bank_sync_enabled:
false`, `provider_runtime: "not_implemented"`). Manual entry and CSV import
already work, but nobody wants to sit and type every transaction, and most
small businesses will not want to link a bank account to a tool like this.
The tab needs a modern, low-friction way to get real transactions onto the
books without either bank linking or manual form-filling: drop a receipt
photo, or type a plain-English line like "$500 every week since April."

## Non-goals

- No change to the Plaid bank/card connector backend (stays stubbed/disabled
  as-is).
- No new persistent server-side database for transactions. Ledger data stays
  exactly where it is today: client-side, in `localStorage`, via
  `app/js/store.js`. This feature adds two *stateless* AI-parsing endpoints
  and one small *file-storage* endpoint (for receipt images only) — it does
  not move the ledger itself server-side.
- No changes to `server/src/phantom-ai/model-router.ts` or
  `providers/openrouter-adapter.ts`. **Correction from the original draft:**
  those are a hardcoded dry-run skeleton for a separate, larger, in-progress
  "Phantom AI operator" initiative — `openrouter-adapter.ts` returns
  `live_call_allowed: false` / `network_client_implemented: false`
  unconditionally, regardless of env config, per its own comments ("adapter
  is skeleton-only," "Do not fund OpenRouter yet"). There is today no
  working live AI call anywhere in the admin server to reuse. However,
  `server/.env` already has a real `OPENROUTER_API_KEY` and both
  `PHANTOM_LIVE_PROVIDERS_ENABLED=true` and
  `PHANTOM_OPENROUTER_TRANSPORT_ENABLED=true` — i.e. live AI spend is
  already opted into at the config level; the gap is purely that no HTTP
  call was ever implemented. `finance-smart-entry.ts` therefore makes its
  own small, direct `POST https://openrouter.ai/api/v1/chat/completions`
  call, gated on those same two env flags (fails closed with a friendly
  "AI parsing isn't enabled yet" error if either is off, exactly as the
  Error Handling section already specified) — it does not touch or extend
  the separate, still-unfinished Phantom AI operator governance layer.

## Architecture

Two new AI-assisted entry paths feed the **existing** ledger instead of
replacing it — same `transactions` array in `store.js`, same
`normalizeFinance` validation, same "money = confirmed transactions only"
rule that already governs manual entry and CSV import today. Nothing gets
written to the books except through that one client-side write path
(`financeNow().transactions.unshift(...)`), regardless of whether the entry
started as a photo, a typed sentence, or the existing manual form.

```
 ┌─────────────┐   image     ┌────────────────────────────┐   draft JSON   ┌──────────────┐
 │ Photo drop  │ ───────────▶│ POST /finance/parse-receipt │───────────────▶│              │
 └─────────────┘             └────────────────────────────┘                 │  Confirm     │  "Add to books"  ┌──────────────────────┐
                                                                             │  card (UI)   │─────────────────▶│ existing client-side │
 ┌─────────────┐   text      ┌──────────────────────────────────┐ draft JSON│              │                  │ transaction / rule    │
 │ "Tell       │────────────▶│ POST /finance/parse-expense-text │──────────▶│              │                  │ write (store.js)      │
 │  Phantom"   │             └──────────────────────────────────┘           └──────────────┘                  └──────────────────────┘
 └─────────────┘
```

- **Receipt photo → draft**: image (data URL) goes to a new
  `POST /phantom-ai/ops/finance/parse-receipt`, which sends it to the
  existing model-router AI path with a vision-capable model and asks for
  vendor/amount/date/category as structured JSON. The server also stores the
  original image via a new small disk-backed asset store and returns an
  `assetId` so the confirmed transaction can keep a reference to its
  receipt. Nothing is written to the ledger yet — this is a draft only.
- **Typed line → draft**: text goes to
  `POST /phantom-ai/ops/finance/parse-expense-text`, which extracts
  amount/direction/category, and — if it detects a recurrence phrase ("every
  week since April", "$1200 rent on the 1st every month") — returns a
  **recurring rule draft** instead of a single transaction draft.
- **Confirm card**: both draft types render through the same editable
  preview component (amount, direction, date/recurrence, category, vendor,
  receipt thumbnail if any). "Add to books" calls the existing
  transaction-create logic for single entries, or a new (still client-side)
  recurring-rule-create function for recurring entries — never a separate
  write path, and never auto-posted without this step (per the earlier
  design decision: AI drafts always get a confirm card, never silent
  auto-post).
- **Recurring rules** are a new small collection alongside
  `accounts`/`transactions` in the client-side finance state. There is no
  background cron. Each time the Accounting tab loads, active rules top
  themselves up: generate any occurrences between their last-generated date
  and today. If the app isn't opened for a while, it just catches up next
  time — same end result, no missed money, no extra background process to
  run or monitor. A hard cap (500 occurrences per top-up pass) prevents a
  pathological rule ("every day since 1990") from generating unbounded rows
  in one pass; if the cap is hit, the UI shows how many were generated and
  that more remain, and tops up further on the next load.

## Components

**Server (new files, mirroring existing connector/module patterns):**

- `server/src/connectors/finance-smart-entry.ts` — two independent parse
  functions:
  - `parseExpenseText(text)` — **fully deterministic, no AI call.** Regex +
    date-math extracts amount, direction (in/out keywords, defaulting to
    "out"), a recurrence phrase ("every week/month", "biweekly"), and a
    "since <month>" start date. This is more reliable and instant for
    structured phrases like "$500 every week since April" than an LLM call
    would be, and needs no provider at all.
  - `parseReceiptImage(dataUrl)` — the one part of this feature that
    genuinely needs a vision model (photos are unstructured). Makes a
    direct, minimal `POST https://openrouter.ai/api/v1/chat/completions`
    call (own small fetch wrapper, not routed through
    `model-router.ts`/`openrouter-adapter.ts` — see Non-goals), gated on
    `PHANTOM_LIVE_PROVIDERS_ENABLED` and
    `PHANTOM_OPENROUTER_TRANSPORT_ENABLED` both being `"true"`; returns the
    "AI parsing isn't enabled yet" error path (see Error Handling) if
    either is off.
- `server/src/connectors/receipt-asset-storage.ts` — local-disk storage for
  receipt images only, modeled directly on
  `content-asset-storage.ts`'s provider interface and disk layout
  (`server/.local/receipt-assets/{files,index.json}`), but **no 30-day
  expiry** — receipts are financial records the owner may need at tax time,
  so they persist until explicitly deleted (e.g. when their transaction is
  deleted). Same `PHANTOMFORCE_..._DIR` env-override convention, same
  `owner_scope`/admin-session gating, same size cap.
- Two new routes in `server/src/index.ts`, both behind
  `requireAdminAccessSession` like every other finance/analytics route:
  `POST /phantom-ai/ops/finance/parse-receipt` and
  `POST /phantom-ai/ops/finance/parse-expense-text`. A third,
  `GET /phantom-ai/ops/finance/receipt/:assetId`, serves a stored receipt
  image back for display in the ledger row.

**Frontend (`app/js/main.js`, same file the rest of `renderMoney` already
lives in):**

- Replace today's connector-first layout with the agreed hero: a drop zone
  ("Drop receipt photos here or click to upload") and a one-line text input
  ("$500 every week since April") side by side at the top of the Accounting
  tab, with the Bank/Card/Manual connector panel demoted to a collapsed
  "Advanced: connect a bank or card (optional)" section further down. The
  existing manual-entry form stays, reframed as the fallback for entries
  with no photo and no natural phrasing.
- A shared `renderConfirmDraft(draft)` component: editable amount/direction
  toggle/date/category/vendor fields, receipt thumbnail when present, "Add
  to books" / "Edit" / "Discard" actions. For a recurring draft, adds a
  frequency/start-date summary and a "starts posting from <date>, N past
  occurrences will be added now" note before confirming.
- Multi-file drop support: dropping N images queues N draft cards in a
  small review list (not N blocking modals), each independently
  confirmable/editable/skippable, with a "confirm all high-confidence"
  bulk action for a shoebox-of-receipts session.
- A "Recurring rules" panel: active rules with next-due date and running
  backfill total (as mocked earlier), each with Pause/Edit/Delete.
- `generateDueOccurrences(rule, asOfISODate)` — pure function, unit
  testable without the DOM: given a rule and "today," returns the list of
  transaction rows to insert and the rule's new `lastGeneratedDate`,
  capped at 500 per call.

**Client-side finance state additions (`app/js/store.js`):**

- `transactions[]` gains optional `receiptAssetId` (string|null),
  `recurringRuleId` (string|null), and `aiAssisted` (bool, for an "AI" badge
  in the ledger reader — provenance, not a trust gate).
- New `recurringRules[]` in `financeSeed()`/`normalizeFinance()`: `{id, ws,
  description, amount, direction, category, account, frequency
  ("weekly"|"biweekly"|"monthly"|"custom-days"), intervalDays, startDate,
  endDate (nullable), status ("active"|"paused"), lastGeneratedDate,
  createdAt, source ("ai-parsed"|"manual")}`.

## Data flow (photo example)

1. User drops a receipt photo onto the Accounting tab.
2. Frontend reads it as a data URL, `POST`s to `/finance/parse-receipt`
   with the session bearer token.
3. Server stores the original via `receipt-asset-storage.ts` (returns
   `assetId`), sends the image to the model-router for extraction, returns
   `{ assetId, draft: { vendor, amount, direction, date, categoryGuess,
   confidence } }`. If extraction fails/low-confidence, still returns the
   `assetId` and whatever partial fields it could read, plus
   `confidence: "low"` — never a dead-end failure, always at least a
   pre-filled manual form.
4. Frontend renders the confirm card pre-filled from the draft.
5. User taps "Add to books" (editing any field first if needed). Frontend
   calls the same local `financeNow().transactions.unshift(...)` path
   manual entry already uses, with `receiptAssetId` and `aiAssisted: true`
   set.
6. Ledger re-renders; the transaction row shows a small receipt-thumbnail
   affordance that opens `/finance/receipt/:assetId`.

## Data flow (recurring text example)

1. User types "$500 every week since April" and submits.
2. `POST /finance/parse-expense-text` returns a recurring-rule draft:
   `{ description, amount, direction, category, frequency: "weekly",
   startDate: "2026-04-01" }` (year inferred from current date if omitted).
3. Confirm card shows the rule summary plus "15 occurrences since Apr 1
   will be added now, $7,500 total."
4. On confirm, frontend creates the rule in `recurringRules[]` with
   `lastGeneratedDate: null`, then immediately calls
   `generateDueOccurrences(rule, today)` to backfill, inserting the
   resulting transactions and setting `lastGeneratedDate: today`.
5. On every future Accounting-tab load, each `status: "active"` rule is
   passed through `generateDueOccurrences` again; any newly-due occurrences
   since `lastGeneratedDate` are inserted automatically (this is the "auto-
   post forever" behavior — no per-occurrence confirm).

## Error handling

- AI provider not configured/enabled (`PHANTOM_LIVE_PROVIDERS_ENABLED`
  etc.): parse endpoints return a clear `503`-style "AI parsing isn't
  configured yet" error; frontend falls back to the existing manual entry
  form pre-filled with nothing lost (the photo/text the user provided is
  still there to reference, just not auto-parsed).
- Low-confidence/partial parse: never blocks — returns whatever fields it
  found, confirm card just shows more empty fields to fill in.
- Ambiguous direction (in vs. out): defaults to "out" (expense) since that's
  the overwhelmingly common case for receipts/recurring bills, but the
  confirm card's in/out toggle is always visible and never hidden, so it's
  a one-click fix, not a hunt.
- Runaway recurrence range (e.g., "every day since 2010"): capped at 500
  occurrences per generation pass; UI states the cap was hit and that more
  will backfill on next load, rather than hanging or silently truncating
  with no explanation.
- Receipt storage failures (disk full, write error): parse endpoint still
  returns the AI-extracted draft even if image storage failed, with
  `assetId: null`; confirm card can still post the transaction, just
  without a receipt thumbnail attached.

## Testing

- `generateDueOccurrences` — pure function — gets direct unit tests: weekly
  from a past date produces the right count and dates; monthly across a
  month-length change (e.g. rule day-of-month 31 into a 30-day month) rounds
  sensibly; the 500-occurrence cap triggers correctly; a paused rule
  generates nothing; a rule with `endDate` in the past stops generating.
- `finance-smart-entry.ts` parse functions — tested the same way the
  existing `test-social-analytics-connector.ts` tests the social connector:
  mocked `fetch` standing in for the model-router's HTTP call, asserting the
  draft shape and that low-confidence/failure paths degrade instead of
  throwing uncaught.
- `receipt-asset-storage.ts` — tested the same way as its
  `content-asset-storage.ts` sibling presumably already is: store/read/
  delete round-trip, size-cap rejection, no expiry (contrast case against
  the 30-day content-asset store).
- Manual/visual verification of the confirm-card UI and multi-file drop
  queue in a real browser pass (per the repo's own `/run`-style
  verification norm for UI work), since drag-and-drop interaction can't be
  fully covered by unit tests alone.
