import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "phantom-agent-runs-"));
const journal = join(tempDir, "agent-runs.jsonl");
process.env.PHANTOM_AGENT_RUNS_LOG_PATH = journal;
process.env.PHANTOM_AGENT_RUN_ARTIFACTS_DIR = join(tempDir, "artifacts");
process.env.PHANTOM_HERMES_LEDGER_PATH = join(tempDir, "hermes-ledger.jsonl");

const {
  AGENT_RUN_TRANSITIONS,
  approveAgentRun,
  getAgentRun,
  registerAgentRunExecutor,
  requestAgentRunCancel,
  retryAgentRun,
  serializeAgentRun,
  startAgentRun,
  TERMINAL_AGENT_RUN_STATES,
} = await import("../src/phantom-ai/agent-runs.js");

async function waitForTerminal(id: string, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getAgentRun(id);
    if (run && TERMINAL_AGENT_RUN_STATES.has(run.state)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`run ${id} did not reach a terminal state`);
}

registerAgentRunExecutor("test_verified", {
  title: "Verified test",
  description: "Produces a test artifact.",
  risk: "low_internal",
  requiredRole: "super_admin",
  scope: "test",
  expectedEffect: "One verified artifact.",
  execute: async ({ run }) => ({
    artifacts: [{ kind: "json", path: join(tempDir, `${run.id}.json`), summary: "verified artifact" }],
    summary: "verified artifact",
    actualEffect: "Verified test artifact recorded.",
  }),
  verify: async () => ({ ok: true, detail: "test verifier accepted artifact" }),
});

registerAgentRunExecutor("test_rejected_by_verifier", {
  title: "Rejected verifier test",
  description: "Produces an artifact that verification rejects.",
  risk: "low_internal",
  requiredRole: "super_admin",
  scope: "test",
  expectedEffect: "No successful outcome.",
  execute: async ({ run }) => ({
    artifacts: [{ kind: "json", path: join(tempDir, `${run.id}.json`), summary: "unverified artifact" }],
    summary: "unverified artifact",
  }),
  verify: async () => ({ ok: false, detail: "artifact checksum mismatch" }),
});

registerAgentRunExecutor("test_cancellable", {
  title: "Cancellable test",
  description: "Waits for a cancellation point.",
  risk: "low_internal",
  requiredRole: "super_admin",
  scope: "test",
  expectedEffect: "Cancellation before completion.",
  execute: async ({ isCancelled }) => {
    for (let index = 0; index < 50; index += 1) {
      if (isCancelled()) throw new Error("cancelled");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { artifacts: [], summary: "unexpected completion" };
  },
  verify: async () => ({ ok: true, detail: "unexpected verification" }),
});

registerAgentRunExecutor("test_approval_bound", {
  title: "Approval payload test",
  description: "Requires approval over an immutable payload.",
  risk: "external_approval",
  requiredRole: "org_manager",
  scope: "test external effect",
  expectedEffect: "One approved test effect.",
  rollbackGuidance: "Remove the test effect.",
  execute: async () => ({ artifacts: [], summary: "approved effect", actualEffect: "Approved test effect executed." }),
  verify: async () => ({ ok: true, detail: "approved effect verified" }),
});

try {
  assert(AGENT_RUN_TRANSITIONS.queued.has("executing"));
  assert(!AGENT_RUN_TRANSITIONS.queued.has("completed"), "queued cannot skip execution and verification");
  assert(AGENT_RUN_TRANSITIONS.verifying.has("completed"), "verified low-risk work can complete");

  const common = {
    workspace: "org-a",
    organizationId: "org-a",
    sessionId: "session-a",
    tenantId: "org-a",
    businessName: "Org A",
    requestedBy: "owner-a",
  };

  const first = await startAgentRun({
    ...common,
    operation: "test_verified",
    request: "produce the verified artifact",
    idempotencyKey: "verified-operation-001",
  });
  assert("id" in first);
  const duplicate = await startAgentRun({
    ...common,
    operation: "test_verified",
    request: "produce the verified artifact",
    idempotencyKey: "verified-operation-001",
  });
  assert("id" in duplicate);
  assert.equal(duplicate.id, first.id, "duplicate idempotency key must return the original run");

  const completed = await waitForTerminal(first.id);
  assert.equal(completed.state, "completed");
  assert(completed.receipt?.verification.ok === true);
  assert.equal(completed.receipt?.payload_hash, completed.payload_hash);
  assert.equal(completed.receipt?.organization_id, "org-a");
  const publicRun = serializeAgentRun(completed);
  assert(!("path" in publicRun.artifacts[0]), "public run payload must not expose server artifact paths");

  const rejected = await startAgentRun({
    ...common,
    operation: "test_rejected_by_verifier",
    request: "produce an invalid artifact",
    idempotencyKey: "rejected-operation-001",
  });
  assert("id" in rejected);
  const failed = await waitForTerminal(rejected.id);
  assert.equal(failed.state, "failed", "verifier rejection must prevent completion");
  assert.equal(failed.receipt, null, "unverified work must not receive a success receipt");

  const retry = await retryAgentRun(failed.id, {
    sessionId: "session-a",
    tenantId: "org-a",
    businessName: "Org A",
    requestedBy: "owner-a",
  });
  assert(retry.ok);
  assert.equal(retry.run.retry_of_run_id, failed.id);
  assert.equal(retry.run.attempt, 2);
  await waitForTerminal(retry.run.id);

  const cancellable = await startAgentRun({
    ...common,
    operation: "test_cancellable",
    request: "wait until cancelled",
    idempotencyKey: "cancel-operation-001",
  });
  assert("id" in cancellable);
  const firstCancel = await requestAgentRunCancel(cancellable.id);
  const secondCancel = await requestAgentRunCancel(cancellable.id);
  assert.equal(firstCancel?.id, secondCancel?.id, "cancel is idempotent");
  assert.equal((await waitForTerminal(cancellable.id)).state, "cancelled");

  const approval = await startAgentRun({
    ...common,
    operation: "test_approval_bound",
    request: "perform approved effect",
    inputs: { target: "version-a" },
    idempotencyKey: "approval-operation-001",
  });
  assert("id" in approval);
  assert.equal(approval.state, "awaiting_approval");
  approval.inputs.target = "version-b";
  const changedDecision = await approveAgentRun(
    approval.id,
    { id: "owner-a" },
    { tenantId: "org-a", businessName: "Org A" },
  );
  assert(!changedDecision.ok && changedDecision.error === "approval_payload_changed");
  approval.inputs.target = "version-a";
  const decision = await approveAgentRun(
    approval.id,
    { id: "owner-a" },
    { tenantId: "org-a", businessName: "Org A" },
  );
  assert(decision.ok);
  assert.equal((await waitForTerminal(approval.id)).state, "succeeded");

  const persisted = await readFile(journal, "utf8");
  assert(persisted.includes(`"id":"${completed.id}"`));
  assert(persisted.includes('"state":"completed"'), "terminal state must be persisted for refresh recovery");
  assert(persisted.includes('"receipt_id"'), "durable receipt must be persisted");

  console.log(JSON.stringify({
    ok: true,
    transitions: "enforced",
    completionRequiresVerification: true,
    duplicateSuppression: true,
    cancellationIdempotent: true,
    approvalPayloadBound: true,
    retryLinked: true,
    refreshPersistence: true,
    internalPathsRedacted: true,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
