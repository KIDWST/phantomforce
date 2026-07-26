# Hermes ACP operator contract

Status: implemented and verified as the first governed PhantomBot operator
slice.

Last verified: 2026-07-26

## Boundary

PhantomBot uses the installed Hermes Agent as a replaceable planning kernel.
It does not give Hermes unrestricted shell access and does not expose raw ACP
messages to the renderer.

```text
authenticated PhantomBot task
  -> PhantomForce Hermes operator session
     -> Hermes ACP stdio planning session
     -> normalized user-safe events
     -> typed documentation_patch intent
     -> existing PhantomForce agent-run approval
     -> exact file operation + allowlisted test
     -> existing verification + receipt + Hermes ledger
     -> existing PhantomForce memory
```

The Electron application remains a hardened client and service supervisor.
PhantomForce owns identity, organization scope, session ownership, approval,
execution policy, evidence, receipts, and memory.

## Observed Hermes ACP interface

The installed runtime verified by the live test is Hermes Agent 0.17.0.

- Entry point: the discovered `hermes` executable.
- Startup: `hermes acp`.
- Transport: newline-delimited JSON-RPC 2.0 over stdin/stdout.
- Protocol version: 1.
- Handshake: `initialize`, with PhantomBot advertising no client filesystem or
  terminal capability.
- Capabilities: returned by `initialize`; normalized into protocol, prompt,
  load-session, and session-operation fields.
- Session creation: `session/new` with a canonical working directory and no
  client-supplied MCP servers.
- Session resumption: `session/load` with the stable Hermes session ID.
- Prompt: `session/prompt`; content is an ACP text content block.
- Streaming: `session/update` notifications. PhantomForce normalizes message,
  thought, plan, tool, usage, and session-info updates.
- Tool permission: `session/request_permission`. Read/search/think/fetch may be
  allowed once only when every declared location resolves inside the canonical
  workspace. Consequential requests are cancelled at the ACP boundary and must
  become a typed PhantomForce operation.
- Cancellation: `session/cancel` notification.
- Errors: JSON-RPC errors, malformed records, timeouts, spawn failures, and
  dropped processes fail closed and become normalized failure events.
- Shutdown: PhantomForce closes readline streams, rejects pending requests,
  and terminates only the ACP child it started.
- Authentication: Hermes uses its locally configured provider credentials;
  PhantomForce never copies credentials into the renderer or receipts.

Hermes owns its provider conversation state and returns a stable session ID.
PhantomForce separately persists the authenticated owner, organization,
normalized event history, typed intent, approval-bound run, receipt, and
memory reference. Reopen therefore remains useful even if the Hermes process
is unavailable.

Hidden thought chunks are never surfaced. They become only “Hermes is
analyzing” milestones. Message chunks are redacted but assembled losslessly;
this is required because whitespace can arrive as a separate ACP delta.

## Event model

The version-one normalized event types are:

`connecting`, `connected`, `analyzing`, `context_inspection`,
`plan_created`, `approval_required`, `operation_started`,
`operation_progress`, `tool_result`, `usage`, `message_delta`, `completed`,
`blocked`, `cancelled`, `disconnected`, and `failed`.

The desktop task timeline renders concise milestones, not raw process output,
hidden reasoning, environment data, or unrestricted tool payloads.

## First allowed operation

The first slice intentionally accepts exactly one operation:

- operation: `documentation_patch`
- path: existing non-symlink `docs/*.md` file under the configured canonical
  workspace
- mutation: one exact text replacement with exactly one occurrence
- verification command: exactly `npm run test:phantombot-desktop`

The approved payload hash binds the authenticated actor, organization,
workspace, Hermes/PhantomBot session mapping, relative path, exact before and
after text, and test command. Approval is expiring and single-use. Modified,
expired, replayed, denied, traversal, symlink, and cross-workspace access fail
closed.

Execution writes a rollback copy, atomically replaces the file, reads it back,
runs the allowlisted test without a shell on Unix and through a fixed
`cmd.exe` invocation on Windows, limits output, enforces a timeout, and gives
the child only a minimal allowlisted environment. A failed or cancelled test
restores the prior file automatically.

## Persistence and recovery

Operator records use an append-only JSONL journal at
`.phantom/hermes-acp-sessions.jsonl` by default. Agent runs, artifacts, ledger
records, and brain memory remain in their existing PhantomForce stores.

Reconciliation is idempotent:

1. Rehydrate the existing agent-run journal.
2. Map the run’s durable state into the operator session.
3. Recover the verified receipt.
4. Create memory only from a verified receipt and only once.
5. Reopen the task with its Hermes session mapping, milestones, outcome,
   receipt, and memory reference.

The hermetic journey proves pending-approval and completed-state recovery in a
new Node process. It also proves denial survives reopen and duplicate approval
cannot execute the operation twice.

## Verification

```powershell
npm run test:phantombot-operator
npm run test:hermes-acp-live --workspace @phantomforce/server
npm run test:agent-run-lifecycle
npm run test:phantombot-desktop
npm run build
```

The live test uses the installed Hermes process and configured provider
against a disposable workspace. It performs a real planning turn, exact
approved edit, real test process, receipt creation, memory creation, and
reopen, then removes the disposable workspace.

## Termina boundary

The existing Termina mission adapter remains the governed path for explicit
multi-worker missions. It is not used for this single-file first slice because
the local Termina service was not listening on its configured port and no
bridge token was configured during verification. The existing automated
Termina bridge test is contract-faithful but simulated; it is not evidence of
a live Termina mission.

The smallest remaining live step is to start the local Termina service with
its shared token, then run a disposable multi-worker mission through the
existing approval-bound `termina_mission` executor. The separate Termina
checkout contains unrelated work and was not modified.

## Current limitations

- The typed execution catalog contains only the documentation patch journey.
- Event delivery uses authenticated bounded polling, not WebSocket/SSE.
- Hermes continuation after PhantomForce approval is represented by the
  durable PhantomForce run and receipt; the current Hermes planning process is
  not kept alive across the approval wait.
- The renderer task cache remains browser local storage; authoritative
  operator/approval/receipt state is server-side.
- Installer signing and a live Termina mission remain separate release work.

## Windows artifact

The verified 0.3.0 artifact is:

`C:\Users\jorda\Documents\Codex\2026-07-26\files-mentioned-by-the-user-phantombot\outputs\PhantomBot-0.3.0-unsigned-Setup.exe`

SHA-256:
`69A7AB81DC1F902D18B2F1C4EAA5BB189D7251ECBF2FD2D49D348D190DE1FC1C`

The matching `.sha256` sidecar is beside the installer. The packaged
executable launch smoke confirmed version 0.3.0, a running PhantomBot process,
local PhantomForce HTTP 200, and Hermes ACP readiness. Authenticode reports
`NotSigned`; SmartScreen or Defender may warn, and no security bypass was
attempted.
