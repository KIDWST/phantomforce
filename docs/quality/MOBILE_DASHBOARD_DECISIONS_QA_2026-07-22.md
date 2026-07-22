# Mobile dashboard decision-flow QA

- Source visual truth: `C:\Users\jorda\.codex\codex-remote-attachments\019f8846-e05f-76b3-8d34-eeb34265ae6d\BAD9D1C4-1679-44B3-971A-52AE4FB529FA\1-Photo-1.jpg`
- Implementation screenshot: `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live\tmp\responsive-viewports\2026-07-22T21-00-18-104Z\screenshots\dashboard-375x812.png`
- Combined comparison: `C:\Users\jorda\Documents\Codex\deployments\phantomforce-live\tmp\responsive-viewports\2026-07-22T21-00-18-104Z\dashboard-mobile-comparison.png`
- Viewport: 375 x 812 CSS pixels, device scale factor 1.
- Source dimensions: 590 x 1280 physical pixels. App-owned source region was cropped from y=81 through y=1145 and normalized to 375 x 676.
- Implementation dimensions: 375 x 812 pixels. The top 375 x 676 region was used for the equal-size comparison.
- State: authenticated dashboard home with 13 open decisions and a representative high-impact Technology decision.

## Full-view comparison evidence

The source shows an oversized horizontal decision rail with a second card escaping the phone, a long first card, and the Phantom composer displaced beneath a decorative Earth stage and the fixed dock. The revised implementation contains the decision preview to the viewport, shows one priority card plus a direct `Review all 13` route, removes phone-only decoration, and keeps the input and send control above the dock.

## Focused-region comparison evidence

The combined comparison focuses on the above-the-fold decision-to-composer path because that is the broken interaction region in the source. The revised card actions retain readable labels and touch-sized controls, while the command-state, execution modes, first Phantom message, composer, and send button are all visible in the same initial phone viewport.

## Findings and iteration history

- P1 fixed: the 86vw horizontal decision carousel created sideways overflow and exposed partial neighboring cards. Replaced with a one-column phone preview and one visible priority card.
- P1 fixed: the Phantom composer was displaced beneath the fixed bottom dock. Removed verbose decision detail from the home preview and added a permanent responsive assertion that the composer bottom stays above the dock.
- P2 fixed: the decorative Earth stage consumed the phone's useful vertical space. It is now disabled at phone widths while remaining intact on larger layouts.
- P2 fixed: the full decision queue lacked an obvious compact entry point. Added a live `Review all {count}` control routed through the existing Approvals workspace.

## Required fidelity surfaces

- Fonts and typography: existing Instrument Sans and Spline Sans Mono system preserved; mobile sizes and line heights remain readable without clipped control labels.
- Spacing and layout rhythm: brief, priority decision, Phantom console, and dock form a single vertical flow with no collision or horizontal escape.
- Colors and visual tokens: existing dark Command OS palette, green state accent, purple primary action, and risk accent preserved.
- Image quality and asset fidelity: no assets were approximated or replaced. The decorative Earth asset is intentionally suppressed only on phones to prioritize interaction.
- Copy and content: business brief, decision title, actions, execution modes, Phantom response, and composer copy remain product-authentic. Detailed decision evidence remains available through Approvals.

## Verification

- `node scripts/test-command-surface.mjs`: passed.
- `node --check app/js/main.js`: passed.
- `node --check scripts/test-responsive-viewports.mjs`: passed.
- `git diff --check`: passed.
- Responsive browser matrix: 48/48 cases passed across eight admin pages at 320, 375, 768, 1024, 1440, and 1920 widths.
- Browser console: no blocking error was observed during the responsive capture run.

No actionable P0, P1, or P2 findings remain. No focused-region follow-up is required beyond the recorded comparison.

final result: passed
