# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read `AGENTS.md` and every file under `docs/quality` before changing code. Do
not restart the inventory unless it is invalid. Continue in this Codex task via
heartbeat automation `continue-phantomforce-quality-program`.

Cycle 24 removed the browser's blind newest-eight-turn cutoff. Phantom now sends
at most ten organization-scoped temporary turns: six newest turns plus up to
four turns from a specifically named older thread and its nearby corrections.
The server deterministically extracts exact recalled colors and codenames from
that corrected thread instead of letting the model guess. A real Chrome journey
proved the corrected Nova fact after nine unrelated topics, and the expanded
real-model gate passed 102 requests. The complete browser graph is
`phantom-live-20260718-43`.

## Recommended Cycle 25

Theme: ambiguous-reference resolution and conversational self-correction.

1. Exercise references involving multiple people, objects, lists, dates, and
   pronouns across topic switches, corrections, negation, and user typos.
2. Verify Phantom asks one concise clarification only when multiple
   interpretations are genuinely plausible; otherwise it should answer.
3. Test user challenges such as “that is wrong,” “you misunderstood me,” and
   “use the first answer but the second tone” without resetting the thread or
   inventing workspace status.
4. Expand deterministic tools only for exact extractive facts and calculations;
   keep creative or judgment calls on the lightest capable local model.
5. Run at least 100 real-model requests and the authenticated 390x844/1440x900
   browser journey, preserving each correction in change memory.

Likely files:

- `app/js/store.js`
- `app/js/command.js`
- `server/src/phantom-ai/instant-chat-context.ts`
- `server/src/phantom-ai/instant-chat-tools.ts`
- `server/scripts/test-instant-chat-http-live-model.ts`
- `scripts/test-database-auth-org-browser.mjs`

## Regression Commands To Keep

- `npm run test:instant-chat:http-live-model --workspace @phantomforce/server`
- `npm run test:database-auth`
- `npm run test:dashboard-chat`
- `node scripts/test-memory-retention.mjs`
- `npm run test:release-critical`
- `npm run test:change-memory`
- `git diff --check`

## Stop Condition

Stop after one coherent implemented and browser-verified batch. The owner has
authorized commit, push, and live deployment. Fetch and rebase `origin/main`,
preserve concurrent work, sync the dedicated deployment, and run the strict
live-source doctor before reporting the batch live.

