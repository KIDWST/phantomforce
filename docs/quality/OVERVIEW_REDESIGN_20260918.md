# PhantomForce Overview upgrade — September 18, 2026

## Outcome

Replaced the decorative Earth/orbit dashboard with a graphite, action-first Overview. The greeting, four metrics, real owner queue, and PhantomBot entry now share one vertical flow. Work-in-motion and signal tools remain available in a native expandable Activity section. Green is reserved for signals and actions, not the dashboard background.

## Audited journey and step health

1. **Overview — improved.** Removed oversized greeting, Earth scene, duplicate orbital metrics, scanlines, and permanent competing rail. Empty owner queues use a compact verified-evidence view; provider setup is explicitly separate. The current fixture has three sourced prospects, not the owner's 700-record workspace.
2. **Navigation — verified in browser.** Metric cards open their corresponding workspace. Automations retains a readable compact-width label. Open PhantomBot opens the real session workspace; Open Automations opens the unified control plane with Decisions, Exceptions, Activity, and Safety rules.
3. **CRM → inbox setup — improved, setup blocked.** Connection settings opens the actual Connections category with Email expanded. A four-stage panel separates inbox, secure sending, delivery tracking, and reply sync. Removed the unrelated five-panel AI summary and duplicate heading from Connections. Gmail still requires the platform broker, account authorization, delivery executor, and event configuration; this upgrade does not send mail.
4. **Release reliability — hardened.** Shipping validates the dedicated clean deployment, rejects a Windows editing-root override, runs the full critical suite, syncs the deployment rather than the editing clone, and verifies the serving root. The updater now notices incorrect serving roots even when server hashes match.

## Findings resolved

- High: decorative layout concealed useful metrics and made the overview hard to scan.
- High: `Working` was inferred from configured missions, not verified work. The launcher now says Open PhantomBot; real execution status remains receipt-backed.
- High: inbox setup routed to a nonexistent settings category.
- High: readiness cache and asynchronous responses could survive account/tenant changes. Scope invalidation, obsolete-response rejection, and failure clearing are now behaviorally tested.
- Medium: inherited pointer-event rules made metric cards inert.
- Medium: compact navigation hid the Automations label.
- Medium: an old growth-report zero hid current scoped prospects. Opportunity signals now use the same scoped CRM count and do not imply booked revenue or buyer intent.
- Medium: deep-link selection could pin subsequent Settings navigation to the initial tab. The initial selection is now consumed once.

## Evidence and limits

Browser QA used the documented local development account, public sourced fixture prospects, and real UI controls. It did not inspect browser storage, capture secrets, or execute outreach, paid generation, approvals, or publishing. Saved screenshots were visually inspected; they are evidence of the fixture, not evidence of the owner's live account.

- [Before](captures/2026-09-18-overview/01-before.png)
- [Graphite Overview](captures/2026-09-18-overview/02-after.png)
- [Expandable Activity](captures/2026-09-18-overview/03-activity.png)
- [Email setup](captures/2026-09-18-overview/04-email-setup.png)
- [Email readiness first screen](captures/2026-09-18-overview/05-email-readiness.png)

The desktop browser check found no horizontal document overflow at 1280 × 720. Compact layout is covered by release-critical source checks; a new phone visual capture has not been performed. No full WCAG compliance claim is made.

Customer-connections tests pass with signed handoff, tenant isolation, stale-response rejection, auth invalidation, failure clearing, and recovery. The critical suite passed 46/46 before the final small Connections presentation adjustment; shipping reruns the entire suite after the build bump. Change-memory passed 449 checks. No test gate or resource budget was weakened.

## Deployment preservation

Unfinished deployment engine work was preserved in recovery stash `d63d2ae6b4d20c016b32309650404df0590ccd58` and restored into `G:\Codex\Documents\Codex\worktrees\phantomforce-deployment-recovery-20260918`. It is not part of this release. Launcher backups and both active/inactive runtime snapshots are under `G:\Codex\rollbacks\phantomforce\20260918-overview-*`. Fifteen active runtime files were copied into the dedicated deployment while retaining its non-conflicting state and both original snapshots. Database configuration parity was checked without exposing values; the database was not reset or reseeded.

A combined service migration command was blocked by device policy. No part of that rejected command ran. State preservation was completed separately without stopping services; release activation uses the established deployment workflow. Live service alignment must be checked after activation before claiming the migration is healthy.

## Release verification

Initial release `e48e3adb84`, build `phantom-live-20260914-227`, passed the entire 46/46 critical suite after its cache bump. The public admin domain and both local UI/API routes served that build; the API commit, origin/main, deployment checkout, and sync manifest agreed. The strict source doctor returned nonzero for warnings only: Windows process inventory timed out, and preserved/stale sibling development worktrees remain. Its checkout, public build, active roots, startup configuration, and live change-memory checks passed (452 checks). This is not a claim that every strict diagnostic passed.

An older editing-root watcher was still running. Production sync now redirects retired watchers to the dedicated deployment, and both launchers reject editing roots on their production ports before stopping any listener. Alternate preview ports remain supported. This avoids forcibly killing that process while preventing it from undoing the release. The follow-up release reruns all critical gates.

## Next priorities

Verify the shipped authenticated workspace and compact device layout; then simplify Relationships' research/detail hierarchy and connection onboarding. Real Gmail and social provider activation remain credential/configuration work, not an invented success state. Keep the current standing two-hour upgrade heartbeat and notification boundaries intact.
