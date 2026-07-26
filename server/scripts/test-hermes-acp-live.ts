import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = await mkdtemp(resolve(tmpdir(), "phantombot-live-acp-"));
const phantom = resolve(root, ".phantom");
const documentPath = resolve(root, "docs", "LIVE_ACP_CHECK.md");
const before = "Status: live ACP verification pending.";
const after = "Status: live ACP verification passed.";

await mkdir(resolve(root, "docs"), { recursive: true });
await writeFile(documentPath, `# Live ACP check\n\n${before}\n`, "utf8");
await writeFile(resolve(root, "package.json"), JSON.stringify({
  name: "phantombot-live-acp-check",
  private: true,
  scripts: {
    "test:phantombot-desktop": "node -e \"console.log('live ACP desktop verification passed')\"",
  },
}, null, 2), "utf8");

Object.assign(process.env, {
  NODE_ENV: "test",
  PHANTOMBOT_OPERATOR_WORKSPACE_ROOT: root,
  PHANTOM_HERMES_ACP_SESSIONS_PATH: resolve(phantom, "sessions.jsonl"),
  PHANTOM_AGENT_RUNS_LOG_PATH: resolve(phantom, "runs.jsonl"),
  PHANTOM_AGENT_RUN_ARTIFACTS_DIR: resolve(phantom, "artifacts"),
  PHANTOM_HERMES_LEDGER_PATH: resolve(phantom, "ledger.jsonl"),
  PHANTOM_BRAIN_MEMORY_PATH: resolve(phantom, "memory.jsonl"),
  PHANTOM_BRAIN_EVENTS_PATH: resolve(phantom, "brain-events.jsonl"),
  PHANTOM_HERMES_ACP_TIMEOUT_MS: process.env.PHANTOM_HERMES_ACP_TIMEOUT_MS || "300000",
});

const {
  approveAgentRun,
  getAgentRun,
} = await import("../src/phantom-ai/agent-runs.js");
const {
  createHermesOperatorSession,
  getHermesOperatorSession,
  reopenHermesOperatorSession,
} = await import("../src/phantom-ai/hermes-acp-operator.js");

const accessSession = {
  id: "live-acp-verifier",
  label: "Live ACP Verifier",
  role: "admin" as const,
  canManageAccess: true,
};
const options = {
  sessionsPath: process.env.PHANTOM_HERMES_ACP_SESSIONS_PATH,
  workspaceRoot: root,
  env: { ...process.env },
};

async function waitForSession(id: string, states: string[], timeoutMs = 360_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getHermesOperatorSession(accessSession, id, options);
    if (record && states.includes(record.state)) return record;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`live ACP session did not reach ${states.join(",")}`);
}

async function waitForRun(id: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getAgentRun(id);
    if (run && ["succeeded", "failed", "cancelled", "rejected", "expired"].includes(run.state)) {
      return run;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("live ACP run did not finish");
}

try {
  const created = await createHermesOperatorSession(accessSession, {
    workspace: "live-acp-fixture",
    prompt: `Inspect docs/LIVE_ACP_CHECK.md and propose changing the exact line "${before}" to "${after}".`,
  }, options);
  const planned = await waitForSession(created.id, ["awaiting_approval", "blocked", "failed"]);
  if (planned.state !== "awaiting_approval") {
    console.error(JSON.stringify({
      state: planned.state,
      errorCode: planned.errorCode,
      assistantText: planned.assistantText,
      events: planned.events.map((event) => ({ type: event.type, summary: event.summary })),
    }, null, 2));
  }
  assert.equal(planned.state, "awaiting_approval", `planning failed closed: ${planned.errorCode || planned.state}`);
  assert(planned.agentRunId);
  assert.equal(await readFile(documentPath, "utf8"), `# Live ACP check\n\n${before}\n`);

  const approval = await approveAgentRun(
    planned.agentRunId,
    { id: accessSession.id },
    { tenantId: "live-acp-fixture", businessName: "Live ACP Fixture" },
  );
  assert.equal(approval.ok, true);
  const run = await waitForRun(planned.agentRunId);
  assert.equal(run.state, "succeeded", run.error || "live ACP run failed");
  assert(run.receipt?.verification.ok);
  assert.equal(await readFile(documentPath, "utf8"), `# Live ACP check\n\n${after}\n`);

  const complete = await waitForSession(created.id, ["completed"]);
  assert(complete.receiptId);
  assert(complete.memoryId);
  const reopened = await reopenHermesOperatorSession(accessSession, created.id, options);
  assert.equal(reopened?.state, "completed");
  assert.equal(reopened?.receiptId, complete.receiptId);
  assert.equal(reopened?.memoryId, complete.memoryId);

  console.log(JSON.stringify({
    ok: true,
    transport: "installed Hermes ACP stdio",
    providerModelTurn: true,
    hermesAgent: planned.hermesCapabilities?.agentName,
    hermesVersion: planned.hermesCapabilities?.agentVersion,
    durableHermesSession: Boolean(planned.hermesSessionId),
    approvedRealEdit: true,
    realTestExitZero: true,
    verifiedReceipt: complete.receiptId,
    memoryCreated: complete.memoryId,
    closeReopenRecovered: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
