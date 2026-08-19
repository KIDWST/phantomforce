# PhantomBot web report

Date: 2026-08-18

## Result

PhantomBot now completes the flagship workspace polish pass without restoring the retired Answer / Build / Research / Operate selector. One composer still accepts both questions and work, while the organization brain is now directly selectable from that composer.

## Implemented

- Replaced the read-only model dropdown with a real organization brain picker for Phantom Hybrid, Local / Ollama, Codex, Claude, ChatGPT Bridge, and OpenRouter models.
- Persisted exact model choices through the canonical server AI-runtime contract; a failed save rolls browser state back instead of claiming success.
- Kept provider state truthful: Real, Checking, and Unavailable remain visible, and an unavailable selection is never described as actively powering the organization.
- Added archived-session discovery and one-action restoration.
- Prevented Send from silently dropping files that are still being read, surfaced the 8-file / 25 MB limits, and preserved attachments on retry.
- Added dialog semantics, background inerting, Tab containment, Escape close, and focus restoration to session controls and the compact task rail.
- Added full keyboard navigation and focus restoration to the model picker.
- Corrected phone PhantomStore ordering so real featured product art appears before long copy and action chrome.

## Verification

- Release-critical product gate: 31/31 passed.
- Responsive Chrome matrix: 60/60 cases passed across 10 pages and six viewports from 320x780 through 1920x1080.
- PhantomBot browser interactions passed at every viewport: model picker fit/focus/close, modal session controls, compact rail focus trap, background restoration, and no horizontal overflow.
- PhantomBot desktop tests: 17/17 passed.
- PhantomBot operator transport, approval, rollback, receipt, recovery, streaming, and capability suites passed.
- AI runtime exact-model persistence, provider-specific fallback, cross-organization isolation, and runtime receipts passed.
- Strict TruffleHog git-history scan: zero verified or unknown findings.

No provider credentials, model weights, tokenizer, quantization, or PhantomPlay game source were changed in this pass.
