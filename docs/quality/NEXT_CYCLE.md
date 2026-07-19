# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read `AGENTS.md` and every file under `docs/quality` before changing code. Do
not restart the inventory unless it is invalid. Continue in this Codex task via
heartbeat automation `continue-phantomforce-quality-program`.

Cycle 25 makes genuine ambiguity useful instead of vague. Phantom asks one exact
question naming multiple plausible people, but explicit named subjects and
format words cannot trigger false clarification. Cross-answer corrections keep
the selected idea separate from the referenced tone. A real Chrome journey
proved 38 turns across two isolated organizations, and the expanded real-model
gate passed 105 requests with zero fallback or leakage. Deployment evidence is
recorded in `AUDIT_LOG.md`: `f1923f80` is live from the canonical checkout, the
scheduled sync returned result `0`, and all 187 live guards passed.

## Recommended Cycle 26

Theme: multi-object reference resolution and chained corrections.

1. Exercise `it`, `they`, `those`, former/latter, numbered options, and multiple
   objects without assuming every capitalized noun is a person.
2. Test two and three consecutive corrections involving dates, locations,
   negation, and list reordering.
3. Verify explicit named subjects always outrank older ambiguous context.
4. Keep deterministic handling extractive and bounded; leave creative judgment
   on the lightest capable local model.
5. Run at least 100 real-model requests and the authenticated 390x844/1440x900
   browser journey, preserving corrections in change memory.

Likely files:

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
