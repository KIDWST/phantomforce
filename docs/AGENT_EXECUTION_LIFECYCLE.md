# Agent execution lifecycle

## Sources of truth

- Run journal: `.phantom/agent-runs.jsonl`, or `PHANTOM_AGENT_RUNS_LOG_PATH` in isolated deployments and tests.
- Artifact storage: `.phantom/artifacts`, or `PHANTOM_AGENT_RUN_ARTIFACTS_DIR`.
- Operation catalog: registered `AgentRunExecutor` definitions in `server/src/phantom-ai/agent-runs.ts`.
- Authorization: the authenticated access session and organization membership checks in `server/src/index.ts`.
- Approval: the run's immutable `approval_payload_hash`, approver identity, decision timestamp, and deadline.
- Verification: the registered executor verifier. Execution returning is not completion.
- Receipt: the verified terminal run record plus its Hermes ledger proof.

Internal artifact paths are never included in API run payloads.

## State machine

Low-risk operations:

`queued → executing → verifying → completed`

Approval-gated operations:

`awaiting_approval → approved → queued → executing → verifying → succeeded | partially_succeeded`

Failure terminals are `failed`, `cancelled`, `rejected`, and `expired`. The engine rejects state transitions outside the declared graph.

## Duplicate suppression

Callers may pass `idempotency_key` in the JSON request or `Idempotency-Key` as a request header. The scope is organization plus operation plus key. A duplicate returns the original run instead of producing a second effect.

Website publication uses a deterministic key containing organization, site, and immutable build ID.

## Approval integrity

The approval hash covers operation, organization, workspace, request, and canonicalized inputs. Approval fails with `approval_payload_changed` if that payload differs from what was proposed. Any changed target requires a new run and a new decision.

## Cancellation and retry

- `POST /phantom-ai/runs/:id/cancel` persists the request before responding and is idempotent.
- Executors observe cancellation at practical checkpoints.
- A cancellation after verification but before terminal success prevents a success receipt.
- `POST /phantom-ai/runs/:id/retry` creates a linked attempt only from `failed`, `cancelled`, `expired`, or `rejected`.
- Approval-gated retries return to `awaiting_approval`; approval is never inherited.

## Receipt contract

Successful receipts include actor, organization, workspace, module, object, action, payload hash, previous and next state, requested and approving identities, execution time, expected and actual effect, cost estimate, rollback guidance, verifier detail, and a redacted human summary.

Unverified work never receives a success receipt.

## Recovery

On startup, the latest journal record for each run is rehydrated. A process that died while a run was approved, queued, executing, or verifying records an honest `server_restarted_mid_run` failure. The operator can inspect evidence and start a linked retry.
