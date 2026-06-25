# PhantomForce App Instructions

This is the active source root for the all-in-one PhantomForce AI operating app.

## Read This First

When Jordan says "edit the PhantomForce app", "PhantomForce AI app", "the
business command app", "the PWA", "backend spine", or "OL-10", he means this
project:

`C:\Users\jorda\Documents\PhantomForce-App`

When Jordan says "edit PhantomForce online", "phantomforce.online", or "the
PhantomForce website", he means the public marketing site, not this app:

`C:\Users\jorda\Documents\Codex\2026-06-18\when-should-i-use-my-rate\outputs\phantomforce-site`

Canonical business memory is:

`C:\Users\jorda\Documents\Jordan-AI-Operations`

Required context before substantial work:

- `C:\Users\jorda\Documents\Jordan-AI-Operations\CLAUDE.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\CURRENT_STATE.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\MASTER_INDEX.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\context\SYSTEM_STATE.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\context\CURRENT_OPEN_LOOPS.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\context\SOURCE_OF_TRUTH.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\inventories\CLAUDE_ACCESS_SCOPE.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\products\PHANTOMFORCE_APP.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\products\PHANTOMFORCE_BACKEND_ARCHITECTURE_PLAN.md`
- `C:\Users\jorda\Documents\Jordan-AI-Operations\products\PHANTOMFORCE_V1_TOPOLOGY_AND_CONTRACTS.md`

## Product Context

PhantomForce is not a generic dashboard.

It is an AI-powered business operating app:

- One login.
- One coherent mobile-installable PWA.
- Email, scheduling, tasks, contacts, documents, notes, approvals, audit
  history, and AI chat.
- Business-specific modules per organization.
- Approval-gated external actions.
- Falcon-like local/internal power behind typed backend contracts.

Core architecture principle:

One simple customer experience. Separate maintainable systems underneath.

Pangolin/private-edge access is part of the product moat, not a random
infrastructure distraction. The corrected client-access model is:

```text
Client -> PhantomForce login/access -> Pangolin/private app gateway
       -> PhantomForce dashboard/modules -> approval/audit layer
       -> typed backend handlers/Falcon/internal tools
```

Pangolin is not the product UI. PhantomForce is the product UI. Pangolin is the
private access/revocation layer behind paid client workspaces, especially when
Jordan needs to suspend or revoke access after non-payment.

Do not let live infrastructure block local product progress: implement access
status, payment status, module entitlements, private route metadata, and audit
logging locally first. Live DNS/Pangolin/Traefik/firewall changes still require
Jordan approval.

## Current State

- Stable source root initialized as an npm workspace monorepo.
- Local Git baseline commit: `cb4a72c`.
- Existing PWA copied into `apps\web`.
- Shared Zod action and Falcon job contracts live in `packages\contracts`.
- TypeScript backend scaffold lives in `server`.
- Prisma schema exists for users, orgs, memberships, connections, chat,
  actions, approvals, tasks, notes, contacts, audit events, and Falcon jobs.
- Prior verification passed: `npm install`, `npm run typecheck`,
  `npm run build`, `npm run prisma:generate`, Prisma schema validation, and a
  server health check.
- 2026-06-25 access-control proof exists locally:
  - PWA Access route shows active, past-due, and revoked client states.
  - Access changes use propose -> approve -> execute workflow endpoints.
  - Direct `POST /client-access/:id/status` bypass is intentionally absent.
  - Request-time guard endpoints exist:
    - `GET /client-workspaces/:id`
    - `GET /client-workspaces/:id/modules/:moduleKey`
  - Sports Ops Demo guard behavior is verified:
    - `active` returns `full`.
    - `past_due` returns `read_only`.
    - `revoked` returns HTTP `403` and `blocked`.
  - Module entitlement behavior is verified:
    - `POST /client-access/:id/modules/:moduleKey/propose` creates a
      `client.module.set` action and approval.
    - Approving the module action removes/adds the module in the access record.
    - Disabled modules are removed from the workspace decision and return HTTP
      `403` at the module guard endpoint.
  - Guarded module handler registry is implemented:
    - `server/src/access/module-handlers.ts`.
    - `GET /client-workspaces/:id/modules/:moduleKey` returns `moduleView`.
    - Active/full module handlers return `writeAccess=true` and enabled write
      actions.
    - Past-due/read-only module handlers return `writeAccess=false`, keep read
      actions enabled, and move write actions into `disabledActions`.
    - Disabled modules still return HTTP `403` before handler execution.
  - Access UI includes enabled/disabled module toggles per client card.
  - Pangolin dry-run reconciler is implemented:
    - `GET /pangolin/reconcile/dry-run`
    - Admin-only via server-issued Bearer session token.
    - Returns desired private route state per client: `enabled`, `read_only`,
      or `disabled`.
    - Returns `gatewayEnforcement` so the app is explicit that Pangolin handles
      route reachability, not arbitrary write permissions.
    - Returns `appEnforcement` and `enforcementNote` so read-only access is
      correctly owned by PhantomForce module handlers.
    - Always returns `dryRun=true` and `liveChangesAllowed=false`.
    - Live Pangolin changes still require separate approval and fresh
      infrastructure verification.
  - Pangolin read-only live status probe is implemented:
    - `GET /pangolin/status/read-only`
    - Admin-only via server-issued Bearer session token.
    - Uses only a GET request.
    - Reads `PANGOLIN_READONLY_BASE_URL`, optional
      `PANGOLIN_READONLY_HEALTH_PATH`, and optional
      `PANGOLIN_READONLY_TOKEN`.
    - Defaults to `status=unconfigured` until the real read-only Pangolin base
      URL is provided.
    - Always returns `readOnly=true` and `liveChangesAllowed=false`.
  - Access UI includes an admin-only Pangolin route dry-run panel.
  - Access UI includes the admin-only Pangolin read-only status panel.
  - Access UI renders the guarded module handler payload:
    - Guard module chips are clickable.
    - The panel shows `moduleView` widgets, records, enabled actions, and
      disabled actions.
    - Active/full modules show `Write enabled`.
    - Past-due/read-only modules show `Read only`.
  - Client sessions do not see the Pangolin dry-run panel.
  - Demo session boundary is verified:
    - `GET /sessions` lists local demo sessions.
    - `GET /sessions` can also list Prisma-backed dev sessions when
      `PHANTOMFORCE_AUTH_PROVIDER=prisma-dev`.
    - `POST /auth/demo-login` issues signed Bearer session tokens.
    - `POST /auth/session-login` issues signed Bearer tokens for the active
      local auth provider.
    - `/sessions` reports `authProvider=demo`, `demoAuthEnabled=true`,
      `productionMode=false`, and `productionReady=false` in local workflow
      tests.
    - Prisma-dev auth mode uses `User`, `Org`, and `Membership` rows from
      Postgres as the source of signed local sessions:
      - `authProvider=prisma-dev`
      - `sessionSource=prisma-membership`
      - `demoAuthEnabled=false`
      - `prismaDevAuthEnabled=true`
    - Protected requests use `Authorization: Bearer <token>`.
    - Unsigned `x-phantomforce-session` headers are rejected by default unless
      `PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER=true` is explicitly set.
    - `NODE_ENV=production` refuses demo auth and exits before `/health`
      responds.
    - Jordan/admin can manage access.
    - Client sessions can only view their own workspace.
    - Client sessions cannot propose or approve access/module changes.
  - Access UI login can switch between admin and client demo sessions.
  - Client demo sessions render Access as read-only.
  - Access persistence goes through `server/src/access/access-repository.ts`.
  - Access repository now supports two drivers:
    - `json-file` local fallback when no `DATABASE_URL` exists.
    - `prisma-postgres` when `DATABASE_URL` is configured and
      `PHANTOMFORCE_ACCESS_REPOSITORY` is not forced to `json-file`.
  - Prisma schema now includes `ownerName` and `lastAudit` on `ClientAccess`
    so access records can round-trip into Postgres.
  - Server startup awaits repository initialization before serving access
    routes.
  - `/client-access-workflow` reports repository metadata, including
    `driver`, `prismaWriteMode`, `migrationTarget=prisma-postgres`, and
    `prismaConfigured`.
  - Prisma/Postgres startup now fails closed when `DATABASE_URL` is configured
    but unreachable:
    - Repository metadata reports `failClosedOnPrismaError=true` in Prisma
      mode.
    - `PHANTOMFORCE_PRISMA_STARTUP_TIMEOUT_MS` defaults to `8000`.
    - The server exits non-zero before serving `/health` instead of silently
      falling back to JSON.
  - Temporary durable state is JSON-backed in `server\data` until Postgres is
    available.

## Commands

- Install: `npm install`
- Web dev: `npm run dev:web`
- Server dev: `npm run dev:server`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Prisma generate: `npm run prisma:generate`
- Access workflow test: `npm run test:access --workspace @phantomforce/server`
- Postgres access workflow test:
  `npm run test:access:postgres --workspace @phantomforce/server`
- Postgres fail-closed startup test:
  `npm run test:access:postgres-fail-closed --workspace @phantomforce/server`
- Prisma-dev auth test:
  `npm run test:auth:prisma-dev --workspace @phantomforce/server`
- Production demo-auth fail-closed startup test:
  `npm run test:auth:production-fail-closed --workspace @phantomforce/server`

Known local endpoints:

- Web: `http://127.0.0.1:5188/`
- Server default: `http://127.0.0.1:5190/`
- Demo login: `POST http://127.0.0.1:5190/auth/demo-login`
- Pangolin dry-run: `GET http://127.0.0.1:5190/pangolin/reconcile/dry-run`
- Pangolin read-only status:
  `GET http://127.0.0.1:5190/pangolin/status/read-only`
- Billing read-only status:
  `GET http://127.0.0.1:5190/billing/status/read-only`

Latest verification on 2026-06-25:

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run prisma:generate` passed.
- Prisma migration created:
  `server/prisma/migrations/20260625160903_access_control_spine/migration.sql`.
- Postgres migration deploy passed against a throwaway Docker Postgres database.
- `npm run test:access --workspace @phantomforce/server` passed with
  `signedSessionAuth=true`, `pangolinDryRun=true`,
  `pangolinReadOnlyStatus=true`, `prismaWriteMode=disabled`,
  `repositoryDriver=json-file`, `repositoryModeReason=DATABASE_URL not configured`,
  `failClosedOnPrismaError=false`, `moduleEntitlementGuard=true`, and
  `auditContentAssertions=40`, `driverParitySuite=true`,
  `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
  `billingSourceBoundary=true`, and `auditEvents=506`.
- `npm run test:access:postgres --workspace @phantomforce/server` passed with
  `signedSessionAuth=true`, `pangolinDryRun=true`,
  `pangolinReadOnlyStatus=true`, `prismaWriteMode=enabled`,
  `repositoryDriver=prisma-postgres`,
  `repositoryModeReason=DATABASE_URL configured`,
  `failClosedOnPrismaError=true`, `moduleEntitlementGuard=true`, and
  `auditContentAssertions=40`, `driverParitySuite=true`,
  `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
  `billingSourceBoundary=true`, and `auditEvents=20`.

## 2026-06-25 Client Provisioning Update

- `client.provision` is now a shared action contract and server registry entry.
- New admin-only endpoints:
  - `POST /client-provisioning/dry-run`
  - `POST /client-provisioning/propose`
- Provisioning uses a local `manual-json-file` billing source until a real
  Stripe/invoice provider is chosen.
- Billing source-of-truth status is now explicit via admin-only
  `GET /billing/status/read-only`; it reports
  `provider=manual-json-file`, `sourceOfTruth=local-manual-provider`,
  `readOnly=true`, `productionReady=false`, and `liveWebhooksAllowed=false`.
- Paid provisioning creates or updates an active workspace.
- Signed/unpaid provisioning creates or updates a blocked workspace until
  payment is marked paid.
- Provisioning goes through the same approval and audit history as access and
  module changes.
- Client sessions cannot dry-run or propose provisioning.
- Latest verification:
  - JSON fallback access workflow passed with `auditContentAssertions=40`,
    `driverParitySuite=true`, `malformedProvisioningFailClosed=true`,
    `storageSnapshotCreated=true`, `billingSourceBoundary=true`, and
    `auditEvents=506`.
  - Throwaway Postgres access workflow passed with
    `auditContentAssertions=40`, `driverParitySuite=true`,
    `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
    `billingSourceBoundary=true`, and `auditEvents=20`.
  - `npm run test:connector-boundary --workspace @phantomforce/server` passed
    with `connectorStatus=missing`, `credentialMode=missing`, no enabled
    Calendar actions, and disabled `view-calendar`/`create-event` actions.
  - Postgres fail-closed, Prisma-dev auth, and production demo-auth fail-closed
    tests still pass.
- `npm run test:access:postgres-fail-closed --workspace @phantomforce/server`
  passed with `failedClosed=true`, `healthResponded=false`, and `exitCode=1`
  against unreachable `127.0.0.1:1` Postgres.
- `npm run test:auth:prisma-dev --workspace @phantomforce/server` passed with
  `authProvider=prisma-dev`, `sessionSource=prisma-membership`,
  `demoAuthEnabled=false`, `prismaDevAuthEnabled=true`,
  `dbAdminCanManageAccess=true`, `dbClientScoped=client-sports-demo`, and
  `pangolinDryRun=true`.
- `npm run test:auth:production-fail-closed --workspace @phantomforce/server`
  passed with `failedClosed=true`, `healthResponded=false`, and `exitCode=1`
  when `NODE_ENV=production` tried to enable demo auth.
- Browser proof passed:
  - Admin and client logins use server-issued Bearer tokens.
  - Admin sees Pangolin route dry-run panel.
  - `client-sports-demo` route shows `ENABLED`.
  - `client-past-due` route shows `DISABLED`.
  - Pangolin dry-run cards show gateway enforcement separately from app-layer
    enforcement.
  - Access renders the guarded Calendar module payload for Sports Ops Demo.
  - Access renders the Calendar connector boundary: `connector: calendar`,
    `local-demo-calendar`, `credentialMode=local_demo`, `status=available`,
    `credentialSource=workspace_reference`,
    `credentialRef=local-demo:client-sports-demo:calendar`, `readOnly=true`,
    and the no-live-credentials reason.
  - Mark due flips the request-time guard to `read_only` and the module panel
    to `Read only`.
  - Restore flips the request-time guard back to `full` and the module panel
    to `Write enabled`.
  - Sports Ops Demo client session sees one scoped access card, no module
    controls, and no Pangolin dry-run panel.
  - Money demo browser flow passed:
    signed lead -> blocked until payment -> paid active workspace -> Calendar
    credential boundary -> past-due read-only -> revoked blocked -> restored
    active.
  - Access renders the admin-only Production gates panel:
    `localDemoReady=true`, `productionReady=false`, local access spine ready,
    Calendar connector boundary ready, production auth blocked, and production
    Postgres/Pangolin/live OAuth/deployment still needing config.
  - Browser console had no errors.

## 2026-06-25 Calendar Connector Boundary Update

- Calendar module reads now go through
  `server/src/connectors/calendar-connector.ts`.
- Credential posture is reported by
  `server/src/connectors/credential-boundary.ts`.
- Local provider is `local-demo-calendar`; credential mode is `local_demo`;
  `live=false`; `readOnly=true`.
- `ClientAccess` records now carry `connectorCredentials`; Calendar workspaces
  get a per-workspace reference such as
  `local-demo:client-sports-demo:calendar`.
- Prisma migration
  `server/prisma/migrations/20260625184500_connector_credentials/migration.sql`
  adds the `ClientAccess.connectorCredentials` JSONB field for Postgres mode.
- The Access UI shows `connector: calendar`, provider, credential mode, read-only
  posture, `status=available`, `credentialSource=workspace_reference`, the
  workspace credential reference, and the no-live-credentials reason inside the
  guarded module panel.
- JSON fallback and throwaway Postgres access tests cover the boundary.
- Browser proof confirmed the connector labels and no-live-credentials text on
  the Access screen, including
  `ref: local-demo:client-sports-demo:calendar`.
- This is not live Google Calendar OAuth yet. It is the safe contract boundary
  for adding real OAuth/Google credentials later.
- Missing Calendar credential references now have a focused test proving the
  connector boundary fails closed with no enabled Calendar actions.

## 2026-06-25 Money Demo Flow Update

- Access UI now includes a Revenue proof panel:
  `NexProspex win to paid workspace`.
- The panel drives the real backend flow with stage buttons:
  signed, paid, past due, revoked, restored.
- Signed stage provisions `client-money-demo` from a NexProspex-style source
  with `paymentStatus=due`; the workspace is blocked until payment clears.
- Paid stage provisions the same client as active and loads Calendar through
  `ref: local-demo:client-money-demo:calendar`.
- Past-due stage keeps the route reachable while PhantomForce module handlers
  enforce read-only.
- Revoked stage blocks the workspace and removes modules from the guard.
- Restored stage returns to full access with the Calendar credential reference
  intact.
- Browser proof confirmed every stage at `http://127.0.0.1:5188/`.
- The revenue proof panel now displays `Local demo verified` plus a clear
  `Not production` boundary until production Postgres/auth/Pangolin/live OAuth
  and deployment gates are cleared.

## 2026-06-25 Production Readiness Gate Update

- Added admin-only `GET /readiness`.
- Client sessions receive HTTP `403` from `/readiness`.
- The report separates `localDemoReady` from `productionReady`.
- Current local result:
  - `localDemoReady=true`
  - `productionReady=false`
  - local access spine ready
  - access action contracts ready
  - audit content and driver parity ready
  - Calendar connector boundary ready
  - billing source of truth needs production configuration
  - production Postgres needs config in JSON fallback mode
  - production auth blocked until real customer auth exists
  - Pangolin read-only verification needs `PANGOLIN_READONLY_BASE_URL`
  - live OAuth connectors need implementation/config
  - deployment target needs config
- Access UI now renders the admin-only Production gates panel with the same
  readiness evidence.
- Browser proof confirmed the rendered panel, the audit/parity gate, the
  money-demo production boundary, and no console errors.

## 2026-06-25 Negative Path / Recovery Update

- `POST /client-access-workflow/snapshot` is admin-only and creates a local
  recovery snapshot of the JSON access/workflow files.
- Local JSON writes keep `.bak` files before replacing records/workflow state.
- Client sessions receive HTTP `403` when attempting to create recovery
  snapshots.
- Malformed provisioning payloads fail closed before creating actions,
  approvals, or audit events.
- Current proof:
  - JSON fallback: `malformedProvisioningFailClosed=true`,
    `storageSnapshotCreated=true`, `billingSourceBoundary=true`,
    `auditEvents=506`.
  - Prisma/Postgres: `malformedProvisioningFailClosed=true`,
    `storageSnapshotCreated=true`, `billingSourceBoundary=true`,
    `auditEvents=20`.

## 2026-06-25 Billing Source Boundary Update

- Added `server/src/access/billing-provider.ts`.
- Added admin-only `GET /billing/status/read-only`.
- Client sessions receive HTTP `403` from the billing status endpoint.
- Provisioning actions and `client.provision.*` audit events now persist:
  `billingProvider=manual-json-file` and
  `billingSourceOfTruth=local-manual-provider`.
- Readiness now includes `billing_source_of_truth=needs_config`.
- Targeted API proof:
  `provider=manual-json-file`, `sourceOfTruth=local-manual-provider`,
  `readOnly=true`, `productionReady=false`, `liveWebhooksAllowed=false`,
  and `gateStatus=needs_config`.

## 2026-06-25 Claude Review / Hardening Update

- Claude Desktop reviewed the Codex sync and flagged the highest-value
  unblocked hardening: audit event content assertions and JSON/Postgres driver
  parity.
- Codex implemented that hardening in
  `server/scripts/test-access-workflow.ps1`.
- Current passing proof:
  - JSON fallback: `auditContentAssertions=40`, `driverParitySuite=true`,
    `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
    `billingSourceBoundary=true`, `auditEvents=506`.
  - Prisma/Postgres: `auditContentAssertions=40`, `driverParitySuite=true`,
    `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
    `billingSourceBoundary=true`, `auditEvents=20`.
- The same access workflow suite now checks actor, event type, action ID,
  approval ID, client ID, before/after access state, module flags, billing
  status, source, and reason for critical transitions.

## Highest-Value Lane

`OL-10 - PhantomForce backend spine implementation`

Goal:

Implement the persisted local spine:

- Auth/session seed path.
- Prisma-backed append-only audit writer.
- Approval state machine.
- `task.create` action handler.
- API-backed web flow.
- Promote the access-control proof from JSON/demo state to Prisma-backed
  persistence and real production auth/org/module boundaries.

Close criterion:

A user command can propose `task.create`, create the persisted action/approval
path where required, execute through the handler, write audit, survive refresh,
and show in the web app from the API.

## Hard Boundaries

- The web client never talks to Falcon directly.
- No raw Falcon passthrough endpoint.
- AI proposes actions; humans approve consequential side effects.
- External sends and calendar writes require persisted approval.
- Falcon write/command jobs require persisted approval.
- Side effects execute through one action-handler registry.
- Gmail, Calendar, and Falcon execution stay behind typed contracts until the
  local spine is proven.

## Approval Required

Ask Jordan before:

- External sends, posts, uploads, or form submissions.
- Deployment or public exposure.
- DNS, Pangolin, Traefik, Headscale, Tailscale, firewall, startup service, or
  scheduled-task changes.
- GitHub pushes or public repo/settings changes.
- Billing/purchases.
- Destructive migrations.
- CRM/client data mutation.
- Credential, cookie, browser-profile, private-key, recovery-code, password
  store, or payment access.

## Do Not

- Build OL-10 in the public `phantomforce.online` static site repo.
- Copy Falcon into the client app.
- Expose shell access, raw files, raw logs, model settings, or unrestricted
  command execution to clients.
- Treat demo login fields as production auth.
- Invent production status for `app.phantomforce.online` or private-edge
  infrastructure without fresh verification.
- Dismiss Pangolin as irrelevant to the paid-client access model.

## Definition Of Done

- Existing tests/build/typecheck still pass or failures are explained.
- Local app behavior verified where relevant.
- Git status reported.
- Durable docs in `Jordan-AI-Operations` updated when project state,
  decisions, or source-of-truth facts change.
