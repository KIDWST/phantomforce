# PhantomBot 0.4 governed engineering operator

Date: 2026-07-26

## Implemented capability

Hermes ACP can now return a versioned `phantom_engineering_plan`. PhantomForce validates that typed plan, binds the complete payload to one single-use approval, executes it through the existing agent-run engine, verifies evidence, and records a receipt. The accepted documentation-only intent remains available as a compatibility fallback.

Read-only plans run as `low_internal`. Any file mutation or development command runs as `never_silent`. A plan cannot switch risk lanes after creation, and its workspace label must match the run workspace.

### Read-only operations

- repository status
- bounded text search and file listing
- approved text-file reads
- package-script inspection
- Git diff and recent log inspection
- matching-test discovery
- Phantom process inspection
- allowlisted listening-port inspection

### Approval-bound file operations

- exact text edit with current SHA-256 and unique expected text
- create text file with an absent-state precondition
- controlled append with current SHA-256
- rename or move inside one canonical workspace
- create one directory
- delete one SHA-bound disposable fixture file

There is no recursive-delete operation. Sensitive paths, binary files, oversized files, absolute paths, traversal, mixed separators, and symlink/junction segments fail closed.

### Approval-bound development commands

- declared npm script
- TypeScript build
- typecheck
- repository PowerShell script under an approved scripts directory
- strict or standard secret scan
- optionally Git add or Git commit, each in its own separately approved single-operation plan

Execution uses fixed executables with argument arrays and `shell: false`. Arguments, timeout, output size, environment variables, exit status, cancellation, process-tree termination, and inferred network implications are recorded or enforced. Package installation, push, deployment, service restart, and arbitrary shell remain unavailable.

## Approval and rollback

The full plan is stored in `run.inputs.plan`; the existing agent-run payload hash binds it to approval. Mutation after proposal produces `approval_payload_changed`. The desktop card renders each exact immutable operation before approval.

File mutations push rollback entries before execution. A later command or verification failure restores them in reverse order and retains a JSON evidence artifact. Failed verification now creates a failure receipt with `verification.ok=false`; it does not create success memory.

## Verification

Commands executed from the canonical worktree:

- `npm run build`
- `npm run test:phantombot-operator`
- `npm run test:command-surface`
- `npm run test:phantombot-desktop`
- `npm run test:page-worker`
- `npm run test:change-memory`
- `npm run security:secrets:strict`
- `git diff --check`

The engineering suite proves read-only automatic execution, exact edit/test/diff success, idempotent duplicate suppression, approval mutation rejection for path and command, encoded traversal rejection, mixed-separator rejection, Windows junction escape rejection, malicious argument rejection, output redaction, and verified rollback after an intentional command failure.

Representative controlled-fixture receipts from the final run:

- read-only: `receipt-run-ms2f3mkl-6has1w`
- successful typed task: `receipt-run-ms2f3mr9-k3zfut`
- failed and rolled-back task: `receipt-run-ms2f3n82-9tsm50`

These temporary fixture records demonstrate behavior; they are not production-task receipts.

Strict TruffleHog 3.95.9 scan: zero verified or unknown findings. Sanitized local output was written under ignored `run-evidence/`.

## Remaining scope

This milestone completes the Phase 3 typed execution foundation. Native authenticated event streaming, real Termina runtime proof, ecosystem knowledge onboarding, the authoritative registry, installed 0.4.0 desktop validation, and serious real-task receipts remain separate completion gates.
