# PhantomBot 0.4 real Termina integration

Date: 2026-07-26

## Canonical runtime inspected

- Checkout: `C:\Users\jorda\Termina`
- Git branch: `master`
- HEAD: `f539d6e1`
- Remote: none configured
- Package version: `0.1.0`
- Runtime health version: `0.2.0`
- Engine: `server.js`
- Native shell: `electron-main.cjs`
- Start commands: `npm start` for the engine, `npm run app` for Electron
- Bind: `127.0.0.1:7420` by default

The checkout is materially dirty in `phantombot-engine/` with modified and untracked work. It was kept read-only. All runtime verification used a disposable local clone of committed Termina plus a junction to its existing installed dependencies. Runtime artifacts and fixtures were confined to that disposable clone and removed afterward.

## Authentication

Termina reads `TERMINA_TOKEN`. If absent, `server.js` generates a random per-launch token for the served local UI. API clients authenticate with `X-Termina-Token`; query-token fallback also exists for the PTY/UI transport. Origin checks allow only the configured localhost origins when an `Origin` header is present.

No current-process, Windows user-scope, or machine-scope `TERMINA_TOKEN` was configured during inspection. No token value was printed or persisted.

PhantomForce reads the same token through `termina-bridge.ts`. Therefore a random UI-only token is not enough for an independently started PhantomForce service: both processes need the same provisioned secret.

## Real runtime evidence

The repeatable preflight is `server/scripts/test-termina-live-preflight.ps1`.

Against the actual committed Termina server on port 7420:

- listener opened on `127.0.0.1`
- authenticated `/api/health` returned Termina `0.2.0`
- an invalid token returned HTTP 401
- authenticated `/api/repos` returned 40 repositories
- the production PhantomForce TypeScript adapter independently authenticated and returned the same 40 repositories
- the service was stopped after each probe
- port 7420 was confirmed closed afterward

### Real read-only mission

A disposable Git fixture with the phrase `cobalt lighthouse` was created. A real Termina mission was launched with:

- provider `codex`
- launch mode `plan`
- an explicit read-only objective
- prohibited file writes and network use

The mission was genuinely created and dispatched. One 120-second run recorded `STARTED` then `BLOCKER`, with worker status `blocked`; no `COMPLETE` or `FAILED` protocol event arrived. A shorter repeat remained in `starting`. Both were stopped explicitly. The fixture SHA-256 was unchanged.

This is real timeout/blocker evidence, not a completed read-only mission.

### Real PhantomForce-approved dispatch

The existing `termina_mission` agent-run executor was exercised against the real disposable Termina runtime and fixture.

- run began `awaiting_approval`
- Termina had no new mission before approval
- approval triggered the real Termina decomposer
- the decomposer failed with category `decomposer_authentication`
- root cause reported by Termina: the local Claude OAuth session is expired and could not refresh
- no mission was created
- failure receipt: `receipt-run-ms2fl7ta-47xany`
- receipt verification is false
- fixture SHA-256 was unchanged

The receipt and run were intentionally stored only in the disposable proof environment. The ID is evidence correlation, not a durable production receipt.

## Adapter hardening completed

- agent-run evidence now honors `PHANTOM_AGENT_RUN_ARTIFACTS_DIR`
- internal workspace paths were removed from public receipt effects
- returned mission IDs no longer mutate the immutable approved input payload
- verification recovers the mission ID from the run evidence artifact
- post-dispatch cancellation stops all created Termina workers before the run cancels
- the bridge now exposes a typed authenticated worker-stop operation

These changes preserve exact approval-payload integrity and make cancellation behavior explicit.

## Existing and rerun verification

- `npm run build`
- `npm run test:termina-bridge --workspace @phantomforce/server`
- `npm run test:agent-run-lifecycle --workspace @phantomforce/server`
- `npm run test:phantombot-operator`
- live authenticated health
- live invalid-token rejection
- live repository discovery through both raw API and production adapter
- live plan-mode mission timeout/blocker with unchanged fixture
- live approved-dispatch authentication failure with failure receipt

The mocked Termina suite still proves no call before approval, `launchMode: "approval"` enforcement, single-use confirmation, and clean service-unavailable failure.

## Exact blockers and smallest manual action

Two prerequisites prevent the real completion gates:

1. Reauthenticate the Claude CLI used by Termina’s hard-coded `claude -p` decomposer.
2. Provision one shared `TERMINA_TOKEN` through the existing secret-safe environment mechanism for both Termina and PhantomForce, then restart both processes so they inherit it.

After those are complete, rerun:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server/scripts/test-termina-live-preflight.ps1 -RunApprovedDispatch
```

No source change in the dirty Termina checkout is required for that rerun.

## Remaining Termina limitations

- No real mission reached a successful terminal ledger event in this verification.
- The approved fixture-file mutation task was not attempted past the failed decomposer authentication boundary.
- Termina’s direct API accepts an existing workspace path; PhantomForce restricts mission workspace selection to the server-configured `PHANTOMFORCE_TERMINA_WORKSPACE_ROOT` and does not accept a chat-supplied path.
- Termina persists evidence as plain files under its own `.termina/missions/<id>/` tree.
- The Termina repository has no configured remote and its dirty local work is not durably backed up by Git hosting.
