import assert from "node:assert/strict";

const {
  approveAgentRun,
  getAgentRun,
  startAgentRun,
} = await import("../src/phantom-ai/agent-runs.js");
const {
  getMission,
  stopMissionWorker,
  terminaTokenFromEnv,
  terminaUrlFromEnv,
} = await import("../src/phantom-ai/termina-bridge.js");
const {
  registerTerminaMissionExecutor,
  TERMINA_MISSION_OPERATION,
} = await import("../src/phantom-ai/termina-mission-executor.js");

registerTerminaMissionExecutor();
const baseUrl = terminaUrlFromEnv();
const token = terminaTokenFromEnv();
assert(token, "TERMINA_TOKEN is required.");

async function missionCount() {
  const response = await fetch(`${baseUrl}/api/missions`, {
    headers: { "X-Termina-Token": token },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json() as { ok?: boolean; missions?: unknown[] };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  return body.missions?.length ?? 0;
}

async function waitForRun(id: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getAgentRun(id);
    if (run && ["succeeded", "failed", "cancelled"].includes(run.state)) return run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("approved Termina dispatch did not reach a terminal agent-run state");
}

const before = await missionCount();
const started = await startAgentRun({
  operation: TERMINA_MISSION_OPERATION,
  workspace: "termina-live-fixture",
  organizationId: "termina-live-fixture",
  module: "phantombot",
  sessionId: "live-termina-verifier",
  request: "Inspect README.md in the disposable fixture, report the cobalt lighthouse phrase, and do not modify any files.",
  tenantId: "termina-live-fixture",
  businessName: "Termina Live Fixture",
  requestedBy: "live-termina-verifier",
  idempotencyKey: `termina-live-approved:${Date.now()}`,
  inputs: {
    objective: "Inspect README.md in the disposable fixture, report the cobalt lighthouse phrase, and do not modify any files.",
  },
});
assert("id" in started);
assert.equal(started.state, "awaiting_approval");
assert.equal(await missionCount(), before, "Termina must not receive a mission before approval.");

const approved = await approveAgentRun(
  started.id,
  { id: "live-termina-verifier" },
  { tenantId: "termina-live-fixture", businessName: "Termina Live Fixture" },
);
assert.equal(approved.ok, true);
const finished = await waitForRun(started.id);
if (finished.state !== "succeeded") {
  const error = finished.error || "unknown";
  const failureCategory = /oauth|authenticate|login/iu.test(error)
    ? "decomposer_authentication"
    : /reach|running|fetch|connect/iu.test(error)
      ? "service_unavailable"
      : "other_redacted";
  process.stdout.write(`${JSON.stringify({
    approvalRequired: true,
    noMissionBeforeApproval: true,
    agentRunId: finished.id,
    receiptId: finished.receipt?.receipt_id,
    receiptVerificationOk: finished.receipt?.verification.ok,
    outcome: "failed",
    failureCategory,
    missionCreated: false,
  })}\n`);
  process.exit(0);
}
assert.equal(finished.receipt?.verification.ok, true);
const missionId = finished.artifacts[0]?.summary.match(/mission ([a-zA-Z0-9-]+)/u)?.[1] || "";
assert(missionId);
const mission = await getMission(baseUrl, token, missionId);
await Promise.allSettled(
  mission.mission.workers.map((worker) =>
    stopMissionWorker(baseUrl, token, missionId, worker.id)
  ),
);

process.stdout.write(`${JSON.stringify({
  approvalRequired: true,
  noMissionBeforeApproval: true,
  agentRunId: finished.id,
  receiptId: finished.receipt?.receipt_id,
  missionId,
  launchMode: mission.mission.launchMode,
  workers: mission.mission.workers.length,
  workersStoppedAfterVerification: true,
})}\n`);
