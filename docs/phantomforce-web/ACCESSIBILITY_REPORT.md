# Accessibility report

## Implemented

- Compact navigation is exposed as `role="dialog"` with `aria-modal="true"` while open.
- Background app content and the mobile dock become inert while the drawer is open.
- Focus moves to the first visible drawer control.
- Tab and Shift+Tab remain inside the open drawer.
- Escape closes the drawer and returns focus to the regenerated More button.
- Responsive cards retain usable widths and no longer rely on horizontal phone scrolling.

## Evidence

Static command-surface assertions cover modal semantics, focus order, Tab trapping, Escape, and restoration. Browser checks at 320, 375, and 768 px verify open focus, semantics, close behavior, and restored focus.

## Not claimed

A complete screen-reader matrix, 200% text-zoom audit, forced-colors audit, and manual switch-control review were not run. Those remain appropriate release-candidate checks.
