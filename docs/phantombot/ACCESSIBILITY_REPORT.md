# Accessibility Report

- Phantom presence is `aria-hidden`, non-focusable, non-draggable, and `pointer-events: none`.
- Reduced-motion users receive the same anchored geometry without pose or wisp animation.
- Composer controls retain their existing accessible names and remain above the decorative figure.
- Packaged accessibility inspection exposed named controls for Message, Model, Send/Stop, voice, settings, sessions, and diagnostics.
- The model picker exposes `Phantom` and `Phantom Unleashed` as named menu items.
- Error and provider-readiness state remains readable as text rather than color alone.

The visual treatment does not alter keyboard navigation or the composer’s input semantics.
