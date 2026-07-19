# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read `AGENTS.md` and every file under `docs/quality` before changing code. Do
not restart the inventory unless it is invalid. Continue in this Codex task via
heartbeat automation `continue-phantomforce-quality-program`.

Cycle 19 closed the full business-record organization-isolation pass. One real
database user with memberships in PhantomForce and ChicagoShots created unique
CRM contacts, proposals, approvals, assets, accounting transactions, and bank
connector requests in both organizations. The browser proved two-way UI and
storage separation, reload persistence, forged `ws` rejection, direct
nonmember 403 responses, aligned 20-turn chat, and clean 1440x900 plus 390x844
rendering. The module graph is `phantom-live-20260718-37`.

## Recommended Cycle 20

Theme: authenticated account lifecycle and authorization-error recovery.

1. Exercise customer signup, login, invitation acceptance, logout, expired or
   revoked session, forgot username/password, reset, and 2FA challenge in a
   disposable database through the real browser UI.
2. Verify customer and admin hosts never accept the wrong account class and
   every denied state explains the next safe action without exposing internals.
3. Exercise owner, admin, member, and client roles against visible navigation,
   deep links, direct requests, and plan restrictions.
4. Require form busy/error/success states to recover without reload, duplicate
   submission, stale credentials, clipped mobile text, or dead controls.
5. Browser-check 390x844 and 1440x900, then add permanent tests for every
   defect found.

Likely files:

- `app/js/main.js`
- `app/js/orgs.js`
- `app/js/store.js`
- `server/src/index.ts`
- `server/src/access/user-accounts.ts`
- `scripts/test-database-auth-org-browser.mjs`

## Regression Commands To Keep

- `npm run test:database-auth`
- `npm run test:organization-record-isolation`
- `npm run test:release-critical`
- `npm run test:easy-crm:postgres --workspace @phantomforce/server`
- `npm run test:instant-chat:http-live-model --workspace @phantomforce/server`
- `npm run test:change-memory`
- `git diff --check`

## Stop Condition

Stop after one coherent implemented and browser-verified batch. The owner has
authorized commit, push, and live deployment. Fetch and rebase `origin/main`,
preserve concurrent work, sync the dedicated deployment, and run the strict
live-source doctor before reporting the batch live.
