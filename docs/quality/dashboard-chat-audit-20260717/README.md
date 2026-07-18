# Dashboard Chat Audit — 2026-07-17/18

This folder preserves the visual proof for the dashboard/chat quality batch.

## States

- `01-before-dashboard-desktop.png` — original repeated dashboard at 1280x720.
- `03-after-dashboard-desktop.png` — compact split dashboard at 1440x810.
- `04-after-dashboard-mobile.png` — responsive command surface at 390x804.

## Interaction Proof

The in-app browser exercised the local app at
`http://127.0.0.1:5187/app/?demo=1`:

1. "What's your favorite food?" returned a direct tacos answer without
   business-ledger contamination.
2. "Why tacos?" used the immediately previous answer and explained the choice
   directly.

Automated coverage is in `scripts/test-dashboard-chat-quality.mjs` and checks
22 representative prompts, routing behavior, context handling, and offline
follow-up behavior.
