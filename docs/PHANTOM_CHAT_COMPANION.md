# Phantom Chat Companion (PhantomPresence)

Phantom lives **inside the chat panel** — a contained presence, not a floating
mascot. The goal: the user is never typing into a dead box; they are working
*with* Phantom.

## Where it lives
- `app/js/companion.js` — the presence dock + state machine (`mountCompanion`,
  `setCompanionState`, `setCompanionMode`).
- Mounted into `.chatbox-head` by `renderConsole()` (survives dashboard shell
  restores). The portrait is the real animated character engine
  (`character.js`) at 48px — it blinks, its eyes track the cursor, and its
  mood follows the conversation.

## State system (`PRESENCE_STATES`)
| state | dot | caption |
|---|---|---|
| idle | green | "Ready when you are." |
| listening | green | "I'm listening." (fires while the user types) |
| thinking | green | "Thinking through the best move…" |
| speaking | green | "Here's what I'd do." |
| building | green | "Building the plan…" (Build mode) |
| success | green | "Done. Ready for approval." |
| warning | amber | "This needs approval first." |
| error / paused | red | "Blocked…" / "Paused." |

Each state maps to a label (text, not colour-only), a status-dot tone, a
character mood/emotion, a glow treatment, and a hold time before decaying to
idle. `speak()` in `main.js` drives states automatically; composer input
triggers `listening`.

**Pose artwork:** the state machine is asset-ready. To use painted poses
(`app/assets/poses/*.webp`) later, extend a state's entry with an `asset`
field and render it in place of / behind the canvas. Never reference asset
files that don't exist.

## UX rules (do / don't)
- DO keep Phantom contained in the header dock; captions one line, ellipsized.
- DO keep text labels beside every status dot (a11y — never colour-only).
- DO respect `prefers-reduced-motion` (static portrait, no pulsing).
- DON'T cover messages, block the composer, or overlay content.
- DON'T auto-spawn the flying buddy. It is an opt-in easter egg:
  double-click the portrait to release it; double-click the buddy to dock it.
- DON'T claim capabilities that aren't wired (no voice, no auto-deploy).

## Build mode
The `Chat / Build` chip toggles an honest planning mode: composer copy changes
and the presence holds `building`. Commands still flow through the same
approval-gated operator — nothing executes or publishes on its own. Trust
line under the composer: *"Phantom never publishes, sends, deploys, or
charges without your approval."* (True: all outbound actions in `store.js`
stop at `*-ready` states pending approval.)

## Responsive
Mobile: caption hides, chip shrinks, starter buttons go 2-up; the dock never
grows past the header. The chat log and composer keep full priority.
