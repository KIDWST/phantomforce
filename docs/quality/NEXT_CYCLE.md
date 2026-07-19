# Next Quality Cycle

Last updated: 2026-07-18

## Start Here

Read `AGENTS.md` and every file under `docs/quality` before changing code. Do
not restart the inventory unless it is invalid. Continue in this Codex task via
heartbeat automation `continue-phantomforce-quality-program`.

Cycle 23 repaired the browser account gate and the primary dashboard chat
lifecycle. Account access now has two primary choices, contextual username and
password recovery, a 2FA escape, one-time invitation-link acceptance, duplicate
submit locking, and customer-safe outage copy. Completed chat answers render
immediately. A startup timer can no longer overwrite a real answer with an
accounting/approval briefing, and a dashboard restored after workspace
navigation binds its command form before optional widgets render. The complete
browser graph is `phantom-live-20260718-42`.

## Recommended Cycle 24

Theme: role, entitlement, and expired-session recovery through visible UI.

1. Exercise owner, admin, member, and client accounts against every visible nav
   item and representative deep links on customer and admin hosts.
2. Expire and revoke sessions while users are submitting chat, editing CRM,
   accepting approvals, switching plans, and navigating; recover to sign-in
   without stale data, dead controls, or lost local-safe drafts.
3. Verify Free, Pro, and Elite restrictions match visible navigation, disabled
   controls, direct API authorization, and upgrade explanations.
4. Test slow/failed auth and entitlement requests, browser back/forward, two
   tabs, and re-authentication into a different organization.
5. Browser-check 390x844 and 1440x900 and preserve each correction in permanent
   policy and regression tests.

Likely files:

- `app/js/main.js`
- `app/js/orgs.js`
- `app/js/settings.js`
- `server/src/index.ts`
- `server/src/access/user-accounts.ts`
- `scripts/test-database-auth-org-browser.mjs`

## Regression Commands To Keep

- `npm run test:database-auth`
- `npm run test:account-recovery-2fa:postgres --workspace @phantomforce/server`
- `npm run test:release-critical`
- `npm run test:organization-record-isolation`
- `npm run test:instant-chat:http-live-model --workspace @phantomforce/server`
- `npm run test:change-memory`
- `git diff --check`

## Stop Condition

Stop after one coherent implemented and browser-verified batch. The owner has
authorized commit, push, and live deployment. Fetch and rebase `origin/main`,
preserve concurrent work, sync the dedicated deployment, and run the strict
live-source doctor before reporting the batch live.

