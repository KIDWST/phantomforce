# Skyguard Arena QA

Date: 2026-07-15

Scope:
- Pre-battle offer skip path for Skyguard Arena / Star Battle flow.

Checks:
- Desktop 1280x720: skirmish opens the pre-battle market, `Start without buying` is visible, clicking it hides the market, preserves 260 Stardust, and starts the next-wave prep.
- Mobile 390x844: skip button is visible and tappable, no horizontal overflow, tapping it hides the market, preserves 260 Stardust, and starts the next-wave prep.
- `game.js` passes `node --check`.

Result: passed.
