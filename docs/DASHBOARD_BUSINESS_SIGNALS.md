# Dashboard Business Signals, PhantomPet Fix, and Internal Mesh

Record of a 2026-07-23 pass that replaced the dashboard's generic intel band
with real business signals, fixed a recurring "chatbot on the dashboard"
regression, wired the existing external security monitor into the UI for the
first time, and started (but did not finish) an internal Tailscale mesh.

## A. Dashboard: real signals instead of generic cards

`app/js/main.js`'s `renderDashboardIntel()` (mounted at
`[data-dashboard-intel]`, `app/index.html`, right after the `hero2` section)
used to show four generic connect-nag cards (Analytics / Customer intel /
Content readiness / Business health) — the last of which duplicated
`renderDashboardBrief()`'s own Clients/Approvals/Cash tiles one section up.

It now renders four cards sourced from data that already existed server-side
but had no UI:

- **New opportunities** — `cachedOrganizationPulse().managedGrowth` (already
  computed by `server/src/phantom-ai/organization-pulse.ts`'s
  `buildManagedGrowthPulseSection`). Shows the real proposal-pipeline count
  (a lead that moved to "proposal" — i.e. said yes and wants to move
  forward), falling back to won value, then follow-ups-due, then an honest
  "none open" state. Never fabricated.
- **Upcoming appointments/calls** — `store.state.bookings`
  (`app/js/workspaces.js`), filtered to approved/confirmed future bookings.
  No calendar connector exists anywhere in this codebase yet (bookings are
  explicitly local/manual — see workspaces.js's own copy), so this is
  presented honestly as draft/manual until a real calendar integration
  (Google Calendar, most likely) is built as its own separate project.
- **New comments/interactions** — gated on `connectedSocialCount()`. Content
  Hub's post/comment feed (`app/js/contenthub.js`'s `genPosts()`) is a
  seeded-random demo dataset that silently persists as if real on any fresh
  org with no "sample data" labeling. That's a pre-existing, separate,
  larger UX question (Content Hub's own demo experience) that was
  deliberately **not** touched in this pass — the fix here is narrower: the
  new dashboard card never reads from that generator, only from real
  connector state.
- **Leaked password scanner** — new. See section C.

## B. PhantomPet regression (fixed)

Two prior commits (`09732cff`, `eae26c27`) each claimed to retire the
dashboard's embedded chat widget in favor of a compact "PhantomPet" status
card, but the actual diff in `eae26c27` deleted a working
`<button class="hero2-phantombot-link">Open PhantomBot →</button>` and put
`companion.js`'s full `mountCompanion()` chat-header widget back in its
place (under a `hero2-phantompet` CSS class that didn't change what it
mounted). That widget had a Loop toggle, settings gear, and avatar canvas but
no chat log or composer beneath it — `[data-chat-log]` and
`[data-command-input]` don't exist anywhere in `app/index.html` — so it read
to users as an inert, orphaned chatbot.

Fixed:
- `app/index.html`: `.chatbox`/`mountCompanion` mount replaced with a static
  `.phantompet-card` button linking to the real PhantomBot tab
  (`data-open-ws="phantomai"`).
- `app/js/main.js`: removed the `mountCompanion(...)` call and the entire
  drag/minimize/hotkey/right-click-menu subsystem that only ever operated on
  the now-removed `[data-chatbox]` element (`setChatboxMinimized`,
  `bindChatboxMobility`, `CHATBOX_POSITION_KEY`, the Ctrl-backtick summon
  hotkey, etc.) rather than leave it bound to nothing.
- `docs/PHANTOM_CHAT_COMPANION.md`: rewritten — it previously said "Phantom
  lives inside the chat panel as a contained presence, not a floating
  mascot," which is backwards from the actual current architecture and is
  likely why this got recreated twice. It now names the two real presences
  (`buddy.js`'s docked PhantomPet mascot, `phantomai.js`'s real chat tab)
  and explicitly warns against re-merging them.
- `scripts/test-command-surface.mjs` / `scripts/test-responsive-viewports.mjs`:
  both had assertions locking in the *old, broken* markup/selectors
  (`class="chatbox hero2-phantompet"`, `bindChatboxMobility();`,
  `.hero2-phantompet` selector) — updated to check the new, correct state
  instead of the regression.

## C. Leaked password / security scanner surfaced (new wiring)

`server/src/phantom-ai/external-security-monitor.ts` already ran ClamAV
(with Windows Defender fallback) and HIBP breach/Pwned-Passwords checks, but
had **zero UI anywhere** and **no persisted history** — each scan only ever
returned a live, one-off result. Added:

- `readExternalMonitorHistory()` / `writeExternalMonitorHistory()`, using the
  same `.local/security-scans/` state-file convention as the existing
  monthly scheduler. `runExternalSecurityMonitor()` now persists
  `{ last_run_at, verdict, findings_count }` after every run.
- `getExternalSecurityMonitorStatus()` includes `history` now; the
  `/phantom-ai/security/external-monitor/status` route surfaces
  `history.last_run_at` / `verdict` to **every** signed-in user (not just
  admins) — safe, since it's just a timestamp and a clean/review/blocked
  verdict, no findings detail.
- `app/js/securitystatus.js` (new): thin fetch/cache wrapper, same idiom as
  `organizationpulse.js`. Includes `runSecurityMonitorScan()`, which POSTs an
  **empty body** to `/external-monitor/run` — no domains/emails means no
  external network calls fire (HIBP only runs against explicitly-supplied
  emails), so clicking "Run local scan now" only exercises local ClamAV/
  Defender + local content scan. Zero surprise API cost.
- Dashboard card shows "No leak detected — as of {date}" once a scan has
  run, or "Not yet scanned" honestly until then. An admin-only "Run local
  scan now" button appears under the signal row (visible only when the
  status response isn't redacted, i.e. `canManageAccess` sessions).

## D. Internal Tailscale mesh (installed, not yet joined)

Decision (confirmed with the user): internal infrastructure only — the
admin server, dev/build machines, and any unreleased PhantomPlay dev
builds/dev-rooms move behind a private tailnet with ACLs; public customer
traffic (`app.phantomforce.online`, `admin.phantomforce.online` logins)
stays on the existing Pangolin tunnel exactly as-is. This is additive
hardening, not a re-architecture of how customers reach the site. Explicitly
**not** enrolling customer machines — see the "surface existing protection"
decision in section C rather than shipping any client-side security agent.

Status: Tailscale client installed via `winget install --id
Tailscale.Tailscale` (v1.98.9), Windows service confirmed `RUNNING`. Blocked
on one interactive step that requires the account owner, not automatable:

```powershell
& "C:\Program Files\Tailscale\tailscale.exe" up
```

This prints a login URL — visiting it (or running with `--authkey=<key>`
from a pre-generated key in the Tailscale admin console) binds this machine
to a tailnet. Once joined, the next steps (not yet done):

1. Restrict admin-only internal routes/dev tooling to the tailnet via
   Tailscale ACLs (`tailnet policy file` in the admin console) rather than
   leaving them reachable over the public Pangolin tunnel.
2. Add any future build/dev machine to the same tailnet by default.
3. Extend the dashboard's security card (section C) to show tailnet
   connection status once ACLs are in place.

## Known pre-existing issues found during verification (not fixed here — out of scope)

- `scripts/test-organization-pulse.mjs` fails on a stale assertion
  ("Client graph must style Managed Growth nodes explicitly") — reproduces
  identically on a clean checkout before any of this work, unrelated to
  this change.
- `scripts/test-responsive-viewports.mjs` fails on an unrelated `media-lab`
  workspace-page assertion — also reproduces on a clean checkout; Media Lab
  was removed from the app in a recent commit and this test wasn't updated.
- Neither is part of the `npm run ship:live-admin` gate.
