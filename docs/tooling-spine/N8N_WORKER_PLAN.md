# n8n Worker Plan

Status: proposed future local worker

This document describes how n8n may fit into PhantomForce later. Sprint 0 does not install n8n, run n8n, create workflows, add public webhooks, add credentials, or enable outbound actions.

## Role

n8n may become a local-only automation worker for approved, boring automations.

It is not:

- A second brain.
- A planning agent.
- A public automation endpoint.
- A credential vault for production secrets.
- A path around Hermes approval, budget, redaction, or ledger controls.

## Ownership Boundary

Phantom AI owns user-facing intent, decision framing, and response composition.

Hermes owns memory, context, approval status, budget gates, redaction, cache references, and audit/ledger semantics.

n8n may only execute narrowly scoped worker tasks after Phantom AI and Hermes have already made the task eligible.

## Local-Only Scaffold Design

Future n8n setup should default to:

- Localhost binding only.
- No public tunnels.
- No public webhooks.
- No active workflows.
- No stored real credentials.
- No live provider calls.
- No email, upload, post, CRM, client contact, billing, delete, deploy, or delivery actions.
- Manual startup only unless a later approved task adds a safer supervisor.
- Version-pinned local documentation before runtime is introduced.

## Workflow Admission Rules

A future n8n workflow can be considered only if it has:

- A named owner.
- A tenant/project scope.
- A recipe or workflow schema.
- An input contract.
- An output contract.
- A dry-run mode.
- A blocked-action list.
- A budget impact label.
- A credential boundary.
- A Hermes approval requirement when any side effect is possible.
- A test fixture that proves no external side effect is performed by default.

## Allowed Future Worker Classes

Allowed candidates after separate review:

- Local file normalization into a safe scratch directory.
- Read-only report formatting from already-approved data.
- Local export manifest generation.
- Local checklist generation.
- Local notification draft generation without sending.
- Local queue item draft generation without writing live queue records unless that write path has already been approved.

## Blocked Worker Classes

Blocked by default:

- Sending email.
- Posting to social media.
- Uploading files.
- Calling clients.
- Mutating CRM records.
- Charging, billing, or payment actions.
- Deleting or overwriting source media.
- Calling live AI/provider APIs.
- Writing production ledger records.
- Executing approval decisions.
- Exposing public webhooks.
- Running unreviewed browser automation.

## Future Phase Gates

Before n8n can move beyond plan-only:

1. Add an OpenSpec proposal for the worker boundary.
2. Define workflow input/output schemas.
3. Add a local-only installation note with no credentials.
4. Add a dry-run sample workflow that cannot call external services.
5. Add static checks for public webhooks, credentials, and outbound nodes.
6. Add Hermes approval/budget/cache integration design.
7. Review with Jordan before any runtime execution.

## Current Sprint 0 Result

n8n is only planned. It is not installed, scaffolded as an executable runtime, exposed, credentialed, or run.
