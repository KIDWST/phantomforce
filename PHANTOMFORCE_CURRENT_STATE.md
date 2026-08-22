# PhantomForce Current State

Updated: 2026-08-22

## Product truth

PhantomForce already has a substantial working platform: authenticated admin and customer surfaces, tenant-scoped records, organization switching, CRM, proposals, accounting, approvals, agent runs, automations, media workflows, PhantomBot, PhantomHunter, PhantomPlay, a workforce view, organization pulse/signals, and hash-chained organization audit receipts.

The Command Center already reads real client, approval, finance, security, and workforce state. Its current visual shell is not the primary blocker.

## Critical gap

The owner heartbeat is incomplete:

`What Needs Me -> Review -> Approve -> Phantom Executes -> Verified Complete -> Nothing Slips`

- Decision Cards currently record an owner choice and navigate to another page.
- Workspace approval endpoints explicitly report that execution is not implemented.
- Every generic business-action handler in `server/src/approval/action-registry.ts` is registered but wired to `notImplemented`.
- The database already contains `Action`, `Approval`, `Task`, `Note`, and hash-chained `AuditEvent` models, but the generic business-action path does not execute through them.
- External email and calendar delivery connectors are not proven active. PhantomForce must say `blocked` with the exact missing connection instead of claiming completion.

## Transformation floor

The first shipped vertical must be a real, tenant-scoped internal work lifecycle:

1. Detect or accept a real work item.
2. Package the proposed action with rationale, impact, policy, and an idempotency key.
3. Require owner approval when policy says so.
4. Execute safe internal actions through one work graph.
5. Read the resulting record back before reporting success.
6. Record a correlation-scoped, hash-chained audit receipt.
7. Surface `verified complete`, `blocked`, or `failed` truthfully in the Command Center.
8. Create the next follow-up task when needed so nothing slips.

External sends, publishing, spending, and calendar commits remain approval-gated and must remain blocked until their actual connector is active.

## Preserve

- Server-owned session and tenant authority.
- Database organization isolation and existing release-critical tests.
- Existing workspace approval data and user-created records.
- Existing PhantomBot, PhantomHunter, PhantomPlay, media, CRM, finance, and access systems.
- Dedicated editable checkout and guarded live promotion workflow.

## Verification status at start

- Editable checkout matches the current live source commit: `7fb029f8`.
- Working tree was clean before transformation edits.
- Local admin health: reachable.
- Local customer app health: reachable.
- Public admin health: reachable.
- Public customer app health: reachable.
- Public site: reachable.
- Evolution preflight rejected only because the checkout's configured GitHub remote is four commits behind the current verified live source; no endpoint or dirty-tree failure was reported.

## Next implementation slice

Build the authoritative work graph and expose it in the Command Center before expanding breadth. The first complete action types are safe internal work: task creation, note creation, contact upsert, email-draft preparation, and calendar-proposal preparation. External effects remain blocked with remediation until a real connector is present.
