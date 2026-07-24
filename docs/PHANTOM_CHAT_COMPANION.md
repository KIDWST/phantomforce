# Phantom Chat Companion

There are two separate Phantom presences. Do not merge them back together —
that exact merge is what caused the "chatbot on the dashboard" regression
(commits `09732cff`/`eae26c27` tried to retire/replace it and failed; see
`app/js/main.js` git blame around the dashboard render function for history).

1. **PhantomPet (`app/js/buddy.js`, `mountBuddy()`)** — the real, site-wide
   ambient presence. Sidebar-docked, drag-safe, reacts to chat/notification
   state via `buddyReact()`. This is "the PhantomPet."
2. **Real chat (`app/js/phantomai.js`)** — the actual PhantomBot conversation:
   message log, composer, memory/activity tabs. Lives only on the `phantomai`
   nav tab (`data-nav-id="phantomai"`), mounted via `mountPhantomAI`.

The dashboard hero (`app/index.html`, `.hero2-copy`) must only contain a
**compact `.phantompet-card` button** (`data-open-ws="phantomai"`) that links
to the real chat tab — never an embedded chat surface, never a mounted
`companion.js` widget.

## `app/js/companion.js` — legacy, not currently mounted

`companion.js` (`mountCompanion`, "PhantomPresence") renders a full chat-header
widget (avatar canvas, Brain/Hands status, Phantom Loop toggle, settings gear).
It used to be mounted into the dashboard's `.chatbox` div, but that div and its
`data-chat-log`/`data-command-input` composer were removed in an earlier pass
while the `mountCompanion(...)` call and `.chatbox` wrapper were left behind —
producing an orphaned status bar with no chat body under it, which read to
users as "a chatbot on the dashboard." It has been removed again. Before ever
re-mounting `companion.js` anywhere, confirm there is a real chat log/composer
underneath it — otherwise you've recreated the same bug a third time.

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
