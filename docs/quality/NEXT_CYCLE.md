# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read:

1. `AGENTS.md`
2. `docs/quality/CONTINUOUS_QUALITY_PROGRAM.md`
3. `docs/quality/SITE_INVENTORY.md`
4. `docs/quality/QUALITY_BACKLOG.md`
5. `docs/quality/AUDIT_LOG.md`

Do not restart the audit from zero unless the inventory is invalid. Continuation
is scheduled in this same Codex task by heartbeat automation
`continue-phantomforce-quality-program`.

Cycle 17 removed the next class of chat keyword collisions. Approval opinions,
queue data structures, literary summaries, historical reports, monitor
lizards, automation poems, grammar rewrites, autobiographical memories, and
refresher-style reminders now remain normal instant conversation. Explicit
workspace status, tasks, automations, scheduled reminders, and durable memory
still take their operational lanes. Browser and server policy agree, explicit
memory creates a real pinned record, and the module graph is cache-busted as
`phantom-live-20260718-33`.

## Recommended Cycle 18

Theme: authenticated browser conversation and memory-isolation proof.

The unit and authenticated HTTP gates are strong. The next highest-value proof
is a real signed-in browser session that alternates long casual conversation,
durable memory, and explicit workspace commands while switching organizations.

### Required Pass

1. Start the disposable DB-auth fixture and sign in through the actual browser
   login flow as members of two organizations.
2. Run at least 20 alternating casual, lexical-collision, follow-up, correction,
   and explicit workspace prompts without reloading.
3. Require casual prompts to use the instant route with no cards, navigation,
   business modules, or unsolicited workspace state.
4. Save a durable memory in organization A, reload, and prove it remains there.
5. Switch to organization B and prove organization A memory and temporary chat
   are absent from the UI, request packet, and model answer.
6. Switch back to A and prove its memory returns without B contamination.
7. Browser-check the full sequence at 390px and 1440px, including composer
   visibility, internal history scrolling, exact widths, and zero page errors.

Likely files:

- `server/src/index.ts`
- `server/src/phantom-ai/conversation-policy.ts`
- `server/src/phantom-ai/instant-chat-context.ts`
- `app/js/intent-router.js`
- `app/js/command.js`
- `app/js/store.js`
- `app/js/orgs.js`
- `scripts/test-database-auth-org-browser.mjs`

## Regression Commands To Keep

- `powershell -NoProfile -ExecutionPolicy Bypass -File server\scripts\test-auth-database-live.ps1`
- `npm run test:client-setup-audit`
- `npm run test:dashboard-chat`
- `npm run test:release-critical`
- `npm run test:change-memory`
- `npm run test:auth-boundaries`
- `npm run build`
- `git diff --check`

## Stop Condition

Stop after one coherent improvement batch with tests and docs updated. The user
has explicitly authorized commit, push, and live deployment; still fetch/rebase
first, preserve concurrent work, and verify the deployed commit/build id before
reporting completion.
