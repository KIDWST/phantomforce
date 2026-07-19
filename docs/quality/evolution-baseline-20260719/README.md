# Cycle 1 Mobile Navigation Evidence

Date: 2026-07-19

## Reproduced Problem

At phone widths, the bottom navigation attempted to render the full route
registry as a horizontal strip. Important routes were clipped or hidden, while
two later CSS overrides disabled the already-built vertical mobile drawer.

## Implemented Decision

- Keep one full route registry and all existing role/permission checks.
- Keep five high-frequency routes in the persistent phone dock: Home, Clients,
  Media, Sites, and Money.
- Add one More control that opens the complete existing route drawer.
- Close the drawer after navigation and keep ARIA expanded state synchronized.
- Leave the desktop sidebar and route authority unchanged.
- Do not invent work, counts, analytics, or provider state.

## Visual Proof

- `admin-dashboard-mobile-before.png`: clipped horizontal route strip.
- `admin-dashboard-mobile-after.png`: stable six-control dock.
- `admin-dashboard-mobile-drawer-after.png`: complete route drawer.
- `admin-dashboard-mobile-comparison.png`: equal-state before/after comparison.
- `admin-dashboard-desktop-before.png`: desktop baseline.
- `admin-dashboard-desktop-after.png`: desktop shell after the change.

## Verification

- `npm run test:release-critical`: 20/20 critical checks passed.
- `node scripts/test-responsive-viewports.mjs`: 42/42 cases passed across
  Dashboard, Clients, Media Lab, Content Hub, Analytics, PhantomPlay, and
  Settings at 320, 375, 768, 1024, 1440, and 1920 widths.
- `npm run test:change-memory`: protected behavior guard passed.
- Manual in-app browser journey at 390x844: six dock controls visible; More
  opened the full drawer; Analytics navigation succeeded; drawer closed.
- Strict live-source doctor: canonical checkout, sync manifest, Hermes, served
  checkout, and build ID agreed.
- Local admin, public admin, customer app, and public site returned HTTP 200.

Stable app commit: `c23bf05d44943bea0df55aad133180d638a7ccdc`

Browser build: `phantom-live-20260719-49`
