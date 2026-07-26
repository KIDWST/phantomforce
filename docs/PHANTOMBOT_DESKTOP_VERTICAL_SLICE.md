# PhantomBot desktop vertical slice

Status: implemented desktop/runtime foundation and governed ACP operator slice; the complete master mission is not finished.

Last verified: 2026-07-26

## Product boundary

```text
PhantomBot Electron shell
  -> local PhantomForce application and authenticated session
     -> Phantom AI chat/model router
     -> organization-scoped memory and task history
     -> shared agent-run approval/execution/verification/receipt engine
     -> Termina adapter for approved multi-worker missions
  -> installed Hermes runtime
     -> supported CLI discovery
     -> ACP v1 session, planning, and normalized streaming adapter
```

The desktop shell does not contain a second model loop or a second tool
executor. The former proof-of-concept direct OpenRouter executor is retained
only in the timestamped local backup for migration analysis; it is not a
shipping runtime path. Provider credentials remain outside the renderer.

## Implemented behavior

- Windows Electron application with context isolation, renderer sandboxing,
  navigation allowlisting, external-link handoff, single-instance behavior,
  and session-scoped media permission prompts.
- Local-first connection to the existing PhantomForce application at the
  configured application and health URLs. Remote fallback is off unless
  explicitly enabled.
- Testable runtime supervisor that:
  - detects the supported Hermes executable without reading its secret files;
  - verifies Hermes version and ACP adapter readiness;
  - exposes only a bounded, redacted runtime summary to the renderer;
  - finds the PhantomForce monorepo/runtime through an explicit setting,
    packaged resources, the package ancestry, or the standard local deployment;
  - starts the PhantomForce service only when its health endpoint is down;
  - writes child output to the Electron log directory;
  - stops only the child process that the desktop application started.
- Offline/recovery surface that distinguishes PhantomForce availability,
  Hermes kernel health, and desktop-supervisor state.
- Windows package and Squirrel installer generation.
- Provider-neutral Hermes ACP transport and durable PhantomForce operator
  sessions with approval-bound documentation edits, verification, receipts,
  memory, and close/reopen recovery.
- PhantomBot engineering prompts render normalized Hermes milestones and use
  the existing agent-run approval/denial routes from the task timeline.

## Existing systems retained

| Existing capability | Decision | Destination | Risk/status |
| --- | --- | --- | --- |
| PhantomBot task workspace (`app/js/phantomai.js`) | Retain and adapt | Desktop-rendered authenticated application | Real persistent task threads and interruption; browser local storage remains the current UI cache. |
| PhantomForce chat/model router | Retain | `POST /phantom-ai/chat` | Real local/cloud routing with provider policy; not replaced by Electron. |
| Agent run lifecycle | Retain | `server/src/phantom-ai/agent-runs.ts` | Real state machine, verification, receipts, restart recovery, and approval payload binding. |
| Termina mission adapter | Retain | shared agent-run executor | Real production adapter; automated verification uses a mocked Termina endpoint to avoid spending or filesystem mutation. |
| Hermes ledger and memory contracts | Retain | PhantomForce server | Existing organization-scoped evidence/memory path. |
| Installed Hermes Agent | Adapt | server-side ACP adapter + desktop timeline | Real ACP handshake, capabilities, planning stream, typed intent, and live provider-backed journey are verified. |
| Direct Electron OpenRouter/tool executor prototype | Deprecate | none | Would duplicate routing/execution, bypass tenant policy, and create a separate receipt system. |
| PhantomForce web-only shell | Merge | desktop content surface | Desktop owns process/runtime concerns; the application keeps identity and organization context. |

## Vertical-slice evidence

The following parts are proven:

1. Desktop package and Windows installer build.
2. Local PhantomForce health is reachable.
3. Installed Hermes Agent is found and its ACP check succeeds.
4. Auth boundary checks pass.
5. PhantomBot command/task surface checks pass.
6. Chat deterministic tool checks pass.
7. Memory retention checks pass.
8. Agent runs enforce transitions, approvals, expiration, idempotency, cancellation,
   verification-before-completion, persistence, receipt data, and path
   redaction.
9. A real installed-Hermes ACP model turn inspected a disposable workspace,
   produced a governed intent, waited for PhantomForce approval, edited one
   documentation line, ran the real test process, created a verified receipt
   and memory, and reopened durably.
10. Pending approval and completed sessions recover in a new PhantomForce
    process; denial, replay, traversal, malformed stream, drop, timeout, and
    failed-test rollback cases fail closed.
11. The TypeScript server and shared contracts build.

The following are not yet proven as one automated production journey:

- A real Termina mission against the local service. The adapter test uses a
  controlled fake endpoint and deliberately performs no real worker spend.
- Installer signing, update rollback, crash recovery qualification, uninstall
  data preservation, and macOS/Linux packaging.

Therefore this milestone must not be described as the completed master
mission or as a production-qualified release.

## Next highest-value slice

Expand the typed operation catalog beyond documentation edits, add push-based
event delivery, and qualify a disposable live Termina multi-worker mission
after its local service and bridge token are available. See
`docs/HERMES_ACP_OPERATOR.md` for the implemented contract and exact boundary.

Do not use Hermes `--oneshot` for this path: its documented behavior bypasses
tool approvals, so it is unsuitable for governed desktop execution.

## Verification commands

```powershell
npm test --workspace @phantomforce/phantombot-desktop
npm run package --workspace @phantomforce/phantombot-desktop
npm run make --workspace @phantomforce/phantombot-desktop
npm run test:command-surface
npm run test:instant-chat:tools --workspace @phantomforce/server
npm run test:memory
npm run test:auth-boundaries
npm run test:agent-run-lifecycle
npm run test:termina-bridge --workspace @phantomforce/server
npm run test:phantombot-operator
npm run test:hermes-acp-live --workspace @phantomforce/server
npm run build
npm run test:change-memory
git diff --check
```
