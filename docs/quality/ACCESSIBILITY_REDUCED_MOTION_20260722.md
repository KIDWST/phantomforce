# Reduced-motion safety net for the Command-OS cockpit — 2026-07-22

## What changed

The Command-OS dashboard (`app/command-os.css`) accumulated ~29 keyframe
animations across several sessions (gravity beams, drifting flow packets, a
sweeping radar, a spinning reactor core, LED pulses, an equalizer, an ECG
trace, a floating Phantom). Six per-feature `prefers-reduced-motion` blocks
existed, but a headless audit (Chromium, `emulateMedia({reducedMotion:"reduce"})`)
proved they were **incomplete**: under reduced motion the `.os-flow` packets
kept animating (`osFlowHealth` was measured live), and `.os-radar`, the reactor
core (`osSpin`/`osCorePulse`), the equalizer (`osEq`), and the LED pulses were
never given `animation: none` at all.

### Root cause

Media queries add no specificity. The neutralizer `.os-flow.is-live` (0,2,0)
was **overridden** by the rule that sets the animation,
`.os-flow.is-live[data-flow="health"]` (0,3,0). The phantom float additionally
carried `!important`. So the reduced-motion overrides silently lost the cascade.

### The fix

One authoritative `@media (prefers-reduced-motion: reduce)` block appended at
the **end** of `app/command-os.css` (last in cascade) that sets
`animation: none !important` on every infinite ambient loop, and hides frozen
in-flight flow packets (`opacity: 0 !important`). `!important` is required here
precisely to defeat the specificity/`!important` traps above. Elements are left
in their final, readable resting state — comprehension is preserved; only the
looping motion stops.

## Verification (headless Chromium, this sandbox)

Scan = every `body *` with a non-`none` animationName, non-`0s` duration, and an
iteration count that is `infinite` or > 0.

| Condition | Iterating ambient animations active |
|---|---|
| `prefers-reduced-motion: reduce` (before) | `osFlowHealth` (leaking) + uncovered radar/core/eq/LEDs |
| **`prefers-reduced-motion: reduce` (after)** | **`{}` — none** |
| Normal motion (after) | 16 types still active (`osRadar`, `osBeamDrift`, `osFlowHealth`, `osSpin`, `osPhantomFloat`, …) — full cockpit intact |

The fix is confined to reduced-motion behavior: normal-motion rendering is
byte-for-byte unchanged in effect.

## Scope / non-goals

- No capability removed. No layout, color, or normal-motion change.
- Responsive check (same audit) found **0px page overflow** at 320/375/768/1024/1440/1920 — no responsive regression, none pre-existing.
- Keyboard: rail items are real `<button>`s, `aria-label="Global command rail"`, `aria-current` present, focus-visible outline lands on nav after tabbing — left as-is (already sound).

Build id bumped `phantom-live-20260722-18 → -19` across the 132-ref static graph.

## Known pre-existing, not introduced here

`node scripts/guard-change-memory.mjs` still fails on two rules —
`customer-plan-switching-tier-simulator` (`entitlements.ts`) and
`dashboard-chat-context-and-fast-routing` (`command.js`) — both in files this
cycle did not touch. They predate this work and block `ship:live-admin`; they
belong to whoever added the developer tiers / model routing.
