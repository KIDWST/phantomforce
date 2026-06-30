# Phantom AI Tool Lane Plan

Status: proposed future design

This document defines the safe lane for Phantom AI to request read-only online fetches and future tool work through Hermes controls. Sprint 0 does not implement fetch, enable provider transport, call external services, execute approvals, write queues, or write production ledgers.

## Product Boundary

Phantom AI remains the user-facing brain.

Hermes remains the control layer for memory, context, approval, budget, redaction, cache, and audit semantics.

Tools and workers are execution surfaces. They do not choose strategy, bypass approvals, or independently decide to perform external actions.

## Online Fetch Lane

A future online fetch lane should be:

- Allowlisted.
- Read-only.
- Dry-run by default.
- Tenant-scoped.
- Budgeted.
- Redacted.
- Cached through Hermes.
- Logged with source metadata.
- Citation-returning.
- Unable to send, post, upload, mutate, delete, charge, deploy, or call clients.

## Required Request Shape

Each fetch request should include:

- Request id.
- Tenant id.
- User id or owner actor id.
- Purpose.
- Allowed domains or URLs.
- Data classification.
- Budget estimate.
- Cache policy.
- Redaction policy.
- Approval state.
- External-write intent set to false.

## Required Response Shape

Each fetch response should include:

- Request id.
- Status.
- Source URL.
- Source title when available.
- Retrieved timestamp.
- Cache key or cache miss reason.
- Citation metadata.
- Redaction summary.
- Budget usage estimate.
- Safety flags.
- Manual follow-up if blocked.

## Default Safety Flags

The future lane should default to:

- `provider_called: false`
- `network_call_performed: false` until a separately approved fetch implementation exists
- `external_write_performed: false`
- `queue_written: false`
- `approval_executed: false`
- `production_ledger_written: false`
- `destructive_action_performed: false`

## Approval Rules

Approval is required before any action that could:

- Send.
- Upload.
- Post.
- Publish.
- Call a client.
- Mutate a CRM or external system.
- Hit a live provider.
- Charge money.
- Delete, overwrite, or destructively transform data.
- Write a production ledger record.
- Execute an approval decision.

Read-only fetch may still be blocked if the source is not allowlisted, the request is too sensitive, the budget is missing, the tenant scope is unclear, or redaction cannot be guaranteed.

## Relationship To Existing Phantom AI Code

Existing clean-base infrastructure already includes:

- Provider policy.
- Provider readiness.
- Budget hard gate.
- Provider invocation firewall.
- OpenRouter dry-run adapter.
- Hermes memory/context/recall.
- Hermes approval queue previews and transitions.
- Live-smoke preflight expecting approval execution to remain unavailable.

The future online fetch lane should reuse those patterns instead of adding a second safety model.

## Not In Sprint 0

Sprint 0 does not add:

- Fetch implementation.
- HTTP client.
- Provider transport.
- External provider calls.
- Queue writes.
- Ledger writes.
- n8n workflow execution.
- Public webhooks.
- Credential handling.
- Approval execution endpoint.

`/phantom-ai/approvals/execute` must remain absent/404 until a separately approved approval-execution design exists.
