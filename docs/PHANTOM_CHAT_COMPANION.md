# Phantom Chat Companion

Phantom lives inside the chat panel as a contained presence, not a floating mascot.
The user should feel like they are working with Phantom, while the interface stays
clear, mobile-safe, and honest about approval gates.

## Files

- `app/js/companion.js` mounts the portrait and owns the state machine.
- `app/js/main.js` drives companion states from chat, typing, and Phantom Loop mode.
- `app/phantom.css` styles the portrait, status labels, starter actions, and trust line.

## States

| State | Dot | Meaning |
| --- | --- | --- |
| `online` | green | Systems are reachable and ready. |
| `idle` | green | Systems online and ready. |
| `listening` | green | User is focused or typing. |
| `thinking` | green | Phantom is preparing the local response. |
| `speaking` | green | Phantom is answering. |
| `building` | green | Phantom Loop is armed, planning only. |
| `looping` | green | Phantom Loop is preparing a guarded build packet. |
| `success` | green | A draft or recommendation is ready. |
| `warning` | amber | Approval is needed. |
| `error` / `paused` | red | Work is blocked or paused. |

Every colored dot has a text label. The companion must never rely on color alone.

## UX Rules

- Keep Phantom contained in the chat header.
- Do not cover messages, the composer, tools, or mobile navigation.
- Keep the trust line visible below the chat tools:
  `Phantom never publishes, sends, deploys, or charges without your approval.`
- Respect `prefers-reduced-motion`.
- Do not claim voice, autonomous deploys, paid actions, sends, or provider calls unless they are actually wired and approval-gated.
- Phantom Loop is planning-only until a separate approved patch adds execution.

## Future Pose Assets

The current portrait uses the real `character.js` engine. Painted poses under
`app/assets/poses` can be added later by extending state entries
with explicit, existing asset filenames. Never reference placeholder assets that
do not exist.
