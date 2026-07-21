# PhantomForce — Pre-Live Internal Readiness

Snapshot of what is ready for **internal** use, what stays manual, and which
gates must be **explicitly authorized** before any external/live behavior.
This is a status note, not an authorization to flip live actions.

## Live-internal ready (local, admin/operator)

- **Phantom AI embedded context brain** — `GET /phantom-ai/ops/context`: one
  read-only, role-aware call giving the dashboard assistant the current module,
  safety state, ChicagoShots proposal history + selected packet, tenant memory,
  and (admin only) provider/tool-lane status. Standard/client sessions get a
  redacted shell.
- **ChicagoShots ops workflow** — lead intake → packet → proposal/follow-up
  drafts → proposal history + status pipeline + priority intelligence. All
  local/deterministic, dry-run, approval-gated. Outputs are dashboard artifacts.
- **Tool lane / n8n** — dry-run preview + local scaffold only; execution
  disabled.
- **Ops dashboard status** — `GET /phantom-ai/ops/status` (admin) + readiness
  report.

## Remains manual

- Sending any follow-up / proposal to a client (drafts are preview + approval
  preview only; a human sends manually).
- Marking proposals sent / advancing status (operator action).
- Provisioning/billing decisions (manual provider).

## Intentionally disabled / coming later (safe status, not wired)

- **Sales connector onboarding** — `GET /phantom-ai/ops/sales-connector/status`
  (admin only) reports `status: planned`, `enabled: false`, `live: false`,
  `credential_mode: none`, `external_send: false`. No live CRM/lead provider,
  no credentials in UI, no sends. Readiness gate `sales_connector_onboarding`
  = `needs_config`. Enabling is a separate, explicitly-authorized step.

## Hard-blocked until explicitly authorized (per gate)

These stay off by design. Each must be turned on deliberately, one at a time:

- **Live AI provider / OpenRouter GLM** — gated behind multiple env flags +
  admin-only; off by default. (`PHANTOM_LIVE_PROVIDERS_ENABLED`,
  `PHANTOM_OPENROUTER_TRANSPORT_ENABLED`, key.)
- **n8n execution** — scaffold only; no workflow execution.
- **External sends** — email / social / client outreach: none.
- **Payments / invoices** — none.
- **Approval execution** — `/phantom-ai/approvals/execute` is absent (404) and
  stays absent. No queue writes, no production-ledger writes.
- **Live OAuth connectors** — Calendar is local-demo only
  (`PHANTOMFORCE_LIVE_OAUTH_CONNECTORS`).
- **Production auth / deployment / public exposure** — owner-production auth +
  deployment target are separate gates; no push/deploy here.

## Gates to authorize for "turn live internal"

When you drop the go-live prompt, name explicitly which of these you are
authorizing, because none flip automatically:

1. Production auth provider (owner-production) + strong secrets + admin 2FA code.
2. Postgres-backed persistence (`DATABASE_URL`).
3. Deployment target + private-edge (Pangolin) exposure.
4. Any live provider / connector / send (each separately).

Until then: local/internal, approval-gated, no external side effects.
