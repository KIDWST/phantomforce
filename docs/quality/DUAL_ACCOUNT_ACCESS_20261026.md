# Customer and admin sign-in on the same app

Owner clarification, October 26, 2026: app.phantomforce.online was originally the customer login website and must also provide admin access. Build `phantom-live-20261026-243`.

## Result

The app sign-in page explicitly offers Customer sign-in and Admin sign-in. Admin sign-in uses the existing account password and second-factor flow, then opens the full owner command center and permitted admin tools. The ordinary sign-in still accepts an existing owner account. Customer signup, invitations and recovery retain their existing workflows. Choosing Admin or adding `access=admin` to a URL never changes an account's authority.

Workspaces and accounts provides Admin sign-in for customers, which signs out the previous account and opens the administrator form on the same origin. Verified platform owners instead receive Open admin console. The account panel labels the platform administrator explicitly. Merely loading the admin-entry URL does not silently sign out a customer session.

Explicit sign-out clears the tab session, removes the old workspace route and opens a fresh document before another account signs in. This prevents an owner page or module state from carrying into the next customer's session. Rejected Admin sign-in clears local access immediately and returns to a usable sign-in form even if server revocation is slow; logout requests have a bounded timeout.

The previous backend already allowed verified owners on the canonical app; the remaining gap was a customer-shaped sign-in screen and no explicit admin entry. No users, memberships, credentials or production permissions are modified. The existing server host/role guards remain authoritative. An installation advertising only the existing production-owner authentication route can use that advertised route instead of being rejected solely because database/customer login is unavailable.

## Implementation and verification

The account-gate controller is loaded when needed so the main shell stays below its existing budget. No new eager stylesheet or service is introduced. Busy-state handling prevents switching access modes during a pending account request; changing access clears an unfinished second-factor challenge.

An isolated browser fixture exercises the shared sign-in page and actual form submissions through password, second factor, successful owner entry, rejected non-admin entry and ordinary customer access. Ten workflows also cover customer signup, direct admin URLs, an owner using either entry, advertised owner fallback, owner console entry, backend-readiness retry, and customer-to-admin sign-in through the workspace panel. A withheld logout response proves rejection clears local access and recovers the form immediately. A private-page canary and changed document time prove sign-out destroys the previous account's page and route. Because Chromium upgraded the real hostname to HTTPS in this fixture, only the served public-host selector is rebound to a loopback hostname. The gate, password/2FA calls and capability logic remain unchanged; actual-domain host boundaries retain their separate existing tests. Disposable profiles and fixture credentials are used, with all other origins blocked and no production authentication requests. Existing owner-console, business-isolation, draft and print-analysis tests remain in the release gate.

Final release and live-source verification are recorded in the shared Obsidian note. Undo by reverting this dedicated release commit and syncing the canonical deployment. No database migration needs reversal.
