import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repo = resolve(scriptDir, "../..");
const fakeHermes = resolve(scriptDir, "fixtures", "fake-hermes-acp.mjs");
const reopenHelper = resolve(scriptDir, "fixtures", "verify-hermes-operator-reopen.ts");
const tsxCli = resolve(repo, "node_modules", "tsx", "dist", "cli.mjs");
const tempRoot = await mkdtemp(resolve(tmpdir(), "phantombot-operator-"));
const docsDir = resolve(tempRoot, "docs");
const phantomDir = resolve(tempRoot, ".phantom");
const documentPath = resolve(docsDir, "PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md");
const sessionsPath = resolve(phantomDir, "hermes-acp-sessions.jsonl");
const runsPath = resolve(phantomDir, "agent-runs.jsonl");
const artifactsDir = resolve(phantomDir, "artifacts");
const ledgerPath = resolve(phantomDir, "hermes-ledger.jsonl");
const memoryPath = resolve(phantomDir, "brain-memory.jsonl");
const brainEventsPath = resolve(phantomDir, "brain-events.jsonl");
const originalLine = "Status: implemented desktop/runtime foundation; the complete master mission is not finished.";
const replacementLine = "Status: implemented desktop/runtime foundation and governed ACP operator slice; the complete master mission is not finished.";

await mkdir(docsDir, { recursive: true });
await writeFile(documentPath, `# Fixture\n\n${originalLine}\n`, "utf8");
await writeFile(
  resolve(tempRoot, "package.json"),
  JSON.stringify({
    name: "phantombot-operator-fixture",
    private: true,
    scripts: {
      "test:phantombot-desktop": "node -e \"console.log('5 desktop runtime tests passed')\"",
    },
  }, null, 2),
  "utf8",
);

Object.assign(process.env, {
  NODE_ENV: "test",
  PHANTOMBOT_OPERATOR_WORKSPACE_ROOT: tempRoot,
  PHANTOM_HERMES_ACP_SESSIONS_PATH: sessionsPath,
  PHANTOM_AGENT_RUNS_LOG_PATH: runsPath,
  PHANTOM_AGENT_RUN_ARTIFACTS_DIR: artifactsDir,
  PHANTOM_HERMES_LEDGER_PATH: ledgerPath,
  PHANTOM_BRAIN_MEMORY_PATH: memoryPath,
  PHANTOM_BRAIN_EVENTS_PATH: brainEventsPath,
});

const {
  approveAgentRun,
  getAgentRun,
  rejectAgentRun,
  startAgentRun,
} = await import("../src/phantom-ai/agent-runs.js");
const {
  createHermesOperatorSession,
  getHermesOperatorSession,
  HERMES_DOCUMENTATION_PATCH_OPERATION,
  reopenHermesOperatorSession,
} = await import("../src/phantom-ai/hermes-acp-operator.js");

const accessSession = {
  id: "operator-test-user",
  label: "Operator Test User",
  role: "admin" as const,
  canManageAccess: true,
};
const otherWorkspaceSession = {
  id: "other-user",
  label: "Other User",
  role: "admin" as const,
  canManageAccess: false,
  orgId: "other-workspace",
};
const options = {
  sessionsPath,
  workspaceRoot: tempRoot,
  hermesExecutable: process.execPath,
  hermesArgs: [fakeHermes],
  env: { ...process.env },
};

async function waitForSession(
  id: string,
  expected: string[],
  timeoutMs = 15_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getHermesOperatorSession(accessSession, id, options);
    if (record && expected.includes(record.state)) return record;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`session ${id} did not reach ${expected.join(",")}`);
}

async function waitForRun(id: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getAgentRun(id);
    if (run && new Set([
      "succeeded",
      "completed",
      "partially_succeeded",
      "failed",
      "cancelled",
      "rejected",
      "expired",
    ]).has(run.state)) return run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`run ${id} did not reach a terminal state`);
}

async function verifyReopenInNewProcess(id: string, expectedState: string) {
  const result = await execFileAsync(
    process.execPath,
    [tsxCli, reopenHelper],
    {
      cwd: repo,
      env: {
        ...process.env,
        OPERATOR_TEST_SESSION_ID: id,
        OPERATOR_TEST_EXPECTED_STATE: expectedState,
      },
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}

try {
  // Typed read-only plans execute automatically and still produce a verified receipt.
  const orientationCreated = await createHermesOperatorSession(
    accessSession,
    {
      prompt: "Orient to the canonical workspace and do not modify anything.",
      workspace: "fixture-workspace",
    },
    {
      ...options,
      env: { ...process.env, FAKE_HERMES_ACP_PLAN: "read" },
    },
  );
  const orientation = await waitForSession(orientationCreated.id, ["completed", "blocked", "failed"]);
  assert.equal(orientation.state, "completed");
  assert(orientation.intent && "operations" in orientation.intent);
  assert.equal(orientation.intent.operations.length, 2);
  assert(orientation.agentRunId);
  const orientationRun = await waitForRun(orientation.agentRunId);
  assert.equal(orientationRun.risk, "low_internal");
  assert.equal(orientationRun.receipt?.verification.ok, true);
  assert.equal(await readFile(documentPath, "utf8"), `# Fixture\n\n${originalLine}\n`);

  // Denial must preserve the file and survive reopen.
  const deniedCreated = await createHermesOperatorSession(
    accessSession,
    {
      prompt: "Find the canonical PhantomBot source, propose a harmless documentation line, and test it.",
      workspace: "fixture-workspace",
    },
    options,
  );
  const deniedPending = await waitForSession(deniedCreated.id, ["awaiting_approval", "blocked", "failed"]);
  assert.equal(deniedPending.state, "awaiting_approval");
  assert.deepEqual(
    deniedPending.events.map((event) => event.sequence),
    deniedPending.events.map((_, index) => index + 1),
    "normalized operator events must have unique, contiguous sequence IDs",
  );
  assert(deniedPending.agentRunId);
  assert.equal(await getHermesOperatorSession(otherWorkspaceSession, deniedPending.id, options), null);
  const denied = await rejectAgentRun(
    deniedPending.agentRunId,
    { id: accessSession.id },
    "Controlled denial test",
  );
  assert.equal(denied.ok, true);
  const deniedRecovered = await waitForSession(deniedPending.id, ["denied"]);
  assert.equal(deniedRecovered.state, "denied");
  assert.equal(await readFile(documentPath, "utf8"), `# Fixture\n\n${originalLine}\n`);
  const reopenedDenied = await reopenHermesOperatorSession(accessSession, deniedPending.id, options);
  assert.equal(reopenedDenied?.state, "denied");

  // A pending approval must survive a new PhantomForce process.
  const pendingCreated = await createHermesOperatorSession(
    accessSession,
    {
      prompt: "Prepare the same controlled documentation patch but wait for approval.",
      workspace: "fixture-workspace",
    },
    options,
  );
  const pending = await waitForSession(pendingCreated.id, ["awaiting_approval"]);
  const pendingRestart = await verifyReopenInNewProcess(pending.id, "awaiting_approval");
  assert.equal(pendingRestart.state, "awaiting_approval");
  assert.equal(await readFile(documentPath, "utf8"), `# Fixture\n\n${originalLine}\n`);

  // Approval permits the exact bound patch and real allowlisted test only once.
  assert(pending.agentRunId);
  const approval = await approveAgentRun(
    pending.agentRunId,
    { id: accessSession.id },
    { tenantId: "fixture-workspace", businessName: "Fixture Workspace" },
  );
  assert.equal(approval.ok, true);
  const replay = await approveAgentRun(
    pending.agentRunId,
    { id: accessSession.id },
    { tenantId: "fixture-workspace", businessName: "Fixture Workspace" },
  );
  assert.equal(replay.ok, false);
  assert.match(replay.error, /not_awaiting_approval/);
  const finishedRun = await waitForRun(pending.agentRunId);
  assert.equal(
    finishedRun.state,
    "succeeded",
    `approved run failed: ${finishedRun.error || "unknown error"}`,
  );
  assert(finishedRun.receipt);
  assert.equal(finishedRun.receipt.verification.ok, true);
  assert.match(finishedRun.receipt.verification.detail, /passed with exit 0/);
  assert.equal(await readFile(documentPath, "utf8"), `# Fixture\n\n${replacementLine}\n`);

  const completed = await waitForSession(pending.id, ["completed"]);
  assert(completed.receiptId);
  assert(completed.memoryId);
  const completedRestart = await verifyReopenInNewProcess(completed.id, "completed");
  assert.equal(completedRestart.receiptRecovered, true);
  assert.equal(completedRestart.memoryRecovered, true);
  const memoryLog = await readFile(memoryPath, "utf8");
  assert(memoryLog.includes(completed.receiptId));
  assert(!memoryLog.match(/api[_-]?key|bearer\s+[a-z0-9]/i));

  // Traversal is approval-gated but fails closed during execution.
  const traversal = await startAgentRun({
    operation: HERMES_DOCUMENTATION_PATCH_OPERATION,
    workspace: "fixture-workspace",
    organizationId: "fixture-workspace",
    module: "phantombot",
    sessionId: accessSession.id,
    request: "Attempt traversal fixture",
    tenantId: "fixture-workspace",
    businessName: "Fixture Workspace",
    requestedBy: accessSession.id,
    inputs: {
      hermesOperatorSessionId: "traversal-fixture",
      hermesSessionId: "fake",
      relativePath: "../escape.md",
      expectedText: "before",
      replacementText: "after",
      testCommand: "npm run test:phantombot-desktop",
    },
  });
  assert("id" in traversal);
  const traversalApproval = await approveAgentRun(
    traversal.id,
    { id: accessSession.id },
    { tenantId: "fixture-workspace", businessName: "Fixture Workspace" },
  );
  assert.equal(traversalApproval.ok, true);
  const traversalRun = await waitForRun(traversal.id);
  assert.equal(traversalRun.state, "failed");
  assert.match(traversalRun.error || "", /documentation_path_not_allowed/);

  // An expired approval is single-use and cannot execute.
  const expiring = await startAgentRun({
    operation: HERMES_DOCUMENTATION_PATCH_OPERATION,
    workspace: "fixture-workspace",
    organizationId: "fixture-workspace",
    module: "phantombot",
    sessionId: accessSession.id,
    request: "Expired approval fixture",
    tenantId: "fixture-workspace",
    businessName: "Fixture Workspace",
    requestedBy: accessSession.id,
    inputs: {
      relativePath: "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md",
      expectedText: replacementLine,
      replacementText: `${replacementLine} expired`,
      testCommand: "npm run test:phantombot-desktop",
    },
  });
  assert("id" in expiring);
  expiring.approval_deadline = new Date(Date.now() - 1_000).toISOString();
  const expiredDecision = await approveAgentRun(
    expiring.id,
    { id: accessSession.id },
    { tenantId: "fixture-workspace", businessName: "Fixture Workspace" },
  );
  assert.equal(expiredDecision.ok, false);
  assert.equal(expiredDecision.error, "approval_expired");
  assert.equal(getAgentRun(expiring.id)?.state, "expired");

  // A real verification failure must restore the approved file automatically.
  await writeFile(
    resolve(tempRoot, "package.json"),
    JSON.stringify({
      name: "phantombot-operator-fixture",
      private: true,
      scripts: {
        "test:phantombot-desktop": "node -e \"process.exit(9)\"",
      },
    }, null, 2),
    "utf8",
  );
  const failing = await startAgentRun({
    operation: HERMES_DOCUMENTATION_PATCH_OPERATION,
    workspace: "fixture-workspace",
    organizationId: "fixture-workspace",
    module: "phantombot",
    sessionId: accessSession.id,
    request: "Verification rollback fixture",
    tenantId: "fixture-workspace",
    businessName: "Fixture Workspace",
    requestedBy: accessSession.id,
    inputs: {
      relativePath: "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md",
      expectedText: replacementLine,
      replacementText: `${replacementLine} should roll back`,
      testCommand: "npm run test:phantombot-desktop",
    },
  });
  assert("id" in failing);
  const failingApproval = await approveAgentRun(
    failing.id,
    { id: accessSession.id },
    { tenantId: "fixture-workspace", businessName: "Fixture Workspace" },
  );
  assert.equal(failingApproval.ok, true);
  const failedRun = await waitForRun(failing.id);
  assert.equal(failedRun.state, "failed");
  assert.match(failedRun.error || "", /approved_test_failed:9:rolled_back/);
  assert.equal(await readFile(documentPath, "utf8"), `# Fixture\n\n${replacementLine}\n`);

  const receipt = finishedRun.receipt!;
  assert(!JSON.stringify(receipt).includes(tempRoot));
  assert.equal(receipt.inputs.relativePath, "docs/PHANTOMBOT_DESKTOP_VERTICAL_SLICE.md");

  console.log(JSON.stringify({
    ok: true,
    realFileEdit: true,
    realTestExecution: true,
    approvalDeniedFailsClosed: true,
    approvalPayloadBound: true,
    approvalReplayRejected: true,
    approvalExpirationRejected: true,
    pathTraversalRejected: true,
    verificationFailureRolledBack: true,
    crossWorkspaceSessionHidden: true,
    typedReadOnlyPlan: true,
    verifiedReceipt: receipt.receipt_id,
    memoryCreated: completed.memoryId,
    pendingRestartRecovered: true,
    completedRestartRecovered: true,
    duplicateExecutionPrevented: true,
  }, null, 2));
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
