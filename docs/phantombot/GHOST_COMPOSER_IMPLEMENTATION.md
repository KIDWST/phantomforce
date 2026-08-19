# Ghost Composer Implementation

The Phantom presence is mounted directly inside the primary `composer-root`, not inside the thread background.

Layering:

1. Radial glow: below the composer surface.
2. Stateful transparent pose: below the composer surface, translated so the lower body is physically occluded by the chatbar.
3. Composer surface: the real input, controls, attachments, and status stack.
4. Two restrained energy wisps: above the surface edge.

The presence is decorative (`aria-hidden`, no pointer events), responsive at 900 px and 680 px breakpoints, and motion-free under `prefers-reduced-motion`. Live pet/activity state selects idle, listening, reasoning, working, celebrate, and error poses.

Packaged visual verification confirmed that the torso is hidden behind the input while the head, shoulders, and hands emerge above it. During the live smoke test the pose changed from welcome to working without covering composer controls.
