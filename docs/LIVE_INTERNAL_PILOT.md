# PhantomForce — Live Internal Pilot

PhantomForce is running as a **Live Internal Pilot** for Jordan / ChicagoShots:
real local app usage, real local proposal data, real operator workflow — with
external/dangerous actions still controlled by the owner.

## What is live internal (real, today)

- **Operator cockpit** — local backend + web app; admin/operator dashboard.
- **Embedded Phantom AI** — context brain (`GET /phantom-ai/ops/context`,
  role-aware) lives inside the dashboard; `assistant.mode = live_internal_pilot`.
- **ChicagoShots lead → proposal → follow-up** — real local intake/quote/
  deliverables/follow-up packets, local-deterministic (no provider call).
- **Proposal history + status pipeline** — save packets to the local (ignored)
  store; statuses `draft → sent_manually → follow_up_needed → won / lost`;
  priority/next-action intelligence recomputed on status change.
- **Status visibility** — ops status, ops context, tool-lane/n8n status, sales
  connector status, readiness.

## What stays manual (owner-controlled)

- Sending any follow-up / proposal to a client (drafts + approval preview only).
- Advancing proposal status.
- Pricing/quote approval before any client-facing use.

## What is intentionally off / blocked (until explicitly authorized)

- Live AI provider / OpenRouter GLM — **live-ready but off** by default
  (both `PHANTOM_LIVE_PROVIDERS_ENABLED` and
  `PHANTOM_OPENROUTER_TRANSPORT_ENABLED` must be true + admin-only).
- n8n workflow execution — scaffold only; runtime not started in this pilot.
- External email/social/client sends · payments · invoices.
- Approval execution — `/phantom-ai/approvals/execute` is absent (404).
- Production queue/ledger writes · public webhooks · public deployment.
- Live OAuth connectors · Sales connector (planned/disabled).

## Run it locally

```
# backend (default 127.0.0.1:5190)
npm run dev:server
# web app (127.0.0.1:5188)
npm run dev:web
# n8n (optional, local only) — 127.0.0.1:5678, health/status only
```

Admin demo login issues a signed Bearer token; admin-only routes require it.

## Data sources used by the pilot

Local ChicagoShots proposal-history store (ignored), saved packets, proposal
statuses, ops status/context, tool-lane/n8n status, sales connector status,
local env flag state (no secrets), and local process/port status.

Not used: Gmail, Calendar, Contacts, Drive, social DMs, payments/banking, live
CRM, public webhooks, external sending.

## Gates to authorize before going beyond internal

1. Production auth (owner-production) + strong secrets.
2. Postgres persistence (`DATABASE_URL`).
3. Deployment target + private-edge (Pangolin) exposure.
4. Any live provider / connector / send (each separately).
