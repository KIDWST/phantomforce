# PhantomForce App

Stable source root for the all-in-one PhantomForce AI operating app.

This is the promoted version of the 2026-06-24 PWA prototype. The prototype
proved the product surface; this repo is where the real backend, approvals,
audit trail, AI orchestration, and connector layer now belong.

## Shape

- `apps/web` - React/Vite/TypeScript PWA client.
- `server` - TypeScript backend, approval engine, connector layer, Falcon broker.
- `packages/contracts` - shared Zod contracts for actions and Falcon jobs.

## Safety Rules

- The web app never talks to Falcon directly.
- Falcon remains private local machinery.
- AI may propose actions, but human approval executes side effects.
- External sends, calendar writes, Falcon write jobs, and Falcon command jobs
  must execute only through persisted approvals and audit events.
- Customers use the hosted PhantomForce app. Source repos, provider keys,
  internal tools, and raw admin machinery are never shipped to customers.
- Local machine access belongs in an optional customer-owned connector, not in
  Jordan's PC as the long-term customer traffic hub.

## Product Deployment Model

PhantomForce is moving toward a cloud-first SaaS operating cockpit with an
optional desktop connector for local files, scans, and creative tools.

- Hosted app: primary customer/admin surface.
- PhantomAI: only user-facing brain.
- Desktop connector: optional, outbound-only, customer-owned bridge.
- Jordan Windows host: internal admin pilot/private connector only.
- Copy resistance: server-side orchestration, tenant gates, subscription gates,
  license gates, and no source-code distribution.

Status contract:

```text
GET /phantom-ai/deployment/model/status
```

See `docs/PHANTOMFORCE_CLOUD_CONNECTOR_MODEL.md`.

## Local Commands

```powershell
npm install
npm run typecheck
npm run build
npm run dev:web
npm run dev:server
npm run test:access --workspace @phantomforce/server
npm run test:access:postgres --workspace @phantomforce/server
npm run test:access:postgres-fail-closed --workspace @phantomforce/server
npm run test:connector-boundary --workspace @phantomforce/server
npm run test:auth:prisma-dev --workspace @phantomforce/server
npm run test:auth:owner-production --workspace @phantomforce/server
npm run test:auth:production-fail-closed --workspace @phantomforce/server
```

## Access Repository Modes

- No `DATABASE_URL`: the access workflow uses the local `json-file` fallback in
  `server/data` for development.
- `DATABASE_URL` configured: the access workflow uses Prisma/Postgres and must
  fail closed if the database is unreachable.
- `PHANTOMFORCE_ACCESS_REPOSITORY=json-file`: explicit local override only.
  Do not use this for production.

Run `npm run test:access:postgres-fail-closed --workspace @phantomforce/server`
before deployment changes to prove an unreachable production database does not
silently serve client access from JSON.

Local JSON writes keep `.bak` files and admins can create recovery snapshots
with `POST /client-access-workflow/snapshot`. JSON remains a local/dev fallback;
production still requires Postgres.

## Auth Modes

- Local development uses `PHANTOMFORCE_AUTH_PROVIDER=demo` and
  `PHANTOMFORCE_ENABLE_DEMO_AUTH=true` for the seeded admin/client sessions.
- `PHANTOMFORCE_AUTH_PROVIDER=prisma-dev` uses `User`, `Org`, and
  `Membership` rows from Postgres to build signed local sessions. It is a
  development bridge toward production auth, not final OAuth.
- `PHANTOMFORCE_AUTH_PROVIDER=owner-production` is the owner-controlled launch
  auth candidate. It seeds one owner admin session, requires a strong
  `PHANTOMFORCE_SESSION_SECRET`, `PHANTOMFORCE_OWNER_EMAIL`, and
  `PHANTOMFORCE_OWNER_LOGIN_KEY`, disables demo auth, and exposes
  `POST /auth/owner-login`.
- `NODE_ENV=production` refuses to serve demo sessions and exits before
  `/health` responds.
- `PHANTOMFORCE_SESSION_SECRET` must be a strong non-default value before any
  production auth provider is introduced.

Run
`npm run test:auth:prisma-dev --workspace @phantomforce/server` to prove
Postgres-backed org identity can replace hardcoded demo sessions in dev/test,
run
`npm run test:auth:owner-production --workspace @phantomforce/server` to prove
the owner launch auth path boots in production and fails closed on bad secrets,
and run
`npm run test:auth:production-fail-closed --workspace @phantomforce/server` to
prove demo auth cannot be accidentally exposed as production auth.

## Local Provisioning Lane

- `client.provision` is the approval-gated action for turning a CRM/manual win
  into a PhantomForce client workspace.
- `POST /client-provisioning/dry-run` shows the billing-derived access plan
  without creating an action.
- `POST /client-provisioning/propose` creates a `client.provision` action and
  approval. Approval execution creates or updates the client access record.
- Local billing source is `manual-json-file` until Stripe/invoice webhooks are
  chosen.
- Admin-only `GET /billing/status/read-only` reports the billing source of
  truth as read-only local demo state:
  `provider=manual-json-file`, `sourceOfTruth=local-manual-provider`,
  `productionReady=false`, and `liveWebhooksAllowed=false`.
- `paymentStatus=paid` provisions `accessStatus=active`.
- `paymentStatus=due` or `failed` provisions a blocked workspace until payment
  is marked paid.
- Provisioning is tested in both JSON fallback and Prisma/Postgres repository
  modes.

## Local Connector Boundary Lane

- Calendar module reads now go through a typed connector boundary at
  `server/src/connectors/calendar-connector.ts`.
- Credential posture is reported by
  `server/src/connectors/credential-boundary.ts`.
- The current provider is `local-demo-calendar` with
  `credentialMode=local_demo`, `live=false`, and `readOnly=true`.
- Calendar workspaces now carry a per-workspace credential reference under
  `ClientAccess.connectorCredentials`, for example
  `local-demo:client-sports-demo:calendar`.
- Postgres mode stores that reference in
  `ClientAccess.connectorCredentials` via the
  `20260625184500_connector_credentials` migration.
- The Access UI shows the connector boundary inside the guarded Calendar module
  panel, including `status=available`, `workspace_reference`, the credential
  reference, and the no-live-credentials reason.
- This is not live Google Calendar OAuth yet. It is the safe local contract for
  adding real OAuth/Google credentials later without exposing credentials or raw
  backend controls to clients.
- `npm run test:connector-boundary --workspace @phantomforce/server` proves a
  Calendar module with no credential reference fails closed with no enabled
  Calendar actions.

## Local Money Demo Lane

- The Access screen includes a Revenue proof panel:
  `NexProspex win to paid workspace`.
- Demo stages run through the same backend approval/provisioning/access APIs:
  signed, paid, past due, revoked, restored.
- Browser proof passed for the full lifecycle:
  signed lead -> blocked until payment -> paid active workspace -> Calendar
  credential boundary -> past-due read-only -> revoked blocked -> restored
  active.
- The demo client uses the workspace credential reference
  `local-demo:client-money-demo:calendar`.
- The revenue proof panel displays the boundary in-app:
  `Local demo verified` and `Not production` until the real production gates
  are cleared.

## Local Readiness Gate

- Admin-only `GET /readiness` reports local demo and production gates.
- Client sessions receive HTTP `403` from `/readiness`.
- The Access screen includes a Production gates panel.
- Current local proof reports `localDemoReady=true` and
  `productionReady=false`.
- Ready local gates: access spine, access action contracts, audit content and
  driver parity, Calendar connector boundary.
- Latest local proof:
  - JSON fallback: `auditContentAssertions=40`, `driverParitySuite=true`,
    `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
    `billingSourceBoundary=true`, `falconJobValidationAdminGated=true`,
    `auditEvents=606`.
  - Prisma/Postgres: `auditContentAssertions=40`, `driverParitySuite=true`,
    `malformedProvisioningFailClosed=true`, `storageSnapshotCreated=true`,
    `billingSourceBoundary=true`, `falconJobValidationAdminGated=true`,
    `auditEvents=20`.
- Remaining production gates: billing source of truth, production Postgres
  config, real production auth, Pangolin read-only base URL verification, live
  OAuth connectors, and deployment target.

## 2026-06-27 Verification Update

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run test:auth:owner-production --workspace @phantomforce/server` passed
  with production boot, owner login, wrong-key rejection, demo login disabled,
  admin readiness access, one owner session, weak-secret fail-closed, and
  missing-key fail-closed. It also proves anonymous Falcon validation is
  rejected and owner Falcon validation is allowed.
- `npm run test:access --workspace @phantomforce/server` passed with
  `billingSourceBoundary=true`, `auditContentAssertions=40`,
  `driverParitySuite=true`, `malformedProvisioningFailClosed=true`,
  `storageSnapshotCreated=true`, `pangolinDryRun=true`,
  `pangolinReadOnlyStatus=true`, `falconJobValidationAdminGated=true`, and
  `auditEvents=606`.
- `npm run test:access:postgres --workspace @phantomforce/server` passed with
  `repositoryDriver=prisma-postgres`, `prismaWriteMode=enabled`,
  `failClosedOnPrismaError=true`, `billingSourceBoundary=true`,
  `falconJobValidationAdminGated=true`, and `auditEvents=20`.
- `npm run test:auth:production-fail-closed --workspace @phantomforce/server`
  passed.
- `npm run test:auth:prisma-dev --workspace @phantomforce/server` passed.
- `npm run test:access:postgres-fail-closed --workspace @phantomforce/server`
  passed.
- Test wrappers now pin child-process `NODE_ENV`, auth settings, and owner-auth
  repository mode so the local production `.env` cannot leak into
  demo/Postgres/prisma-dev/owner-production tests.
- `/falcon/jobs/validate` is now admin-gated. Anonymous callers receive `401`,
  client sessions receive `403`, and admin/owner sessions can validate schemas
  without executing Falcon.
