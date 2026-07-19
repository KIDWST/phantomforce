import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Seed a fake automation-engine state (an existing job id with a
// PII-laden last_summary) and a raw, pre-fix-style unredacted ledger entry
// BEFORE importing the modules under test, since they resolve these paths
// from env vars at call time.
const stateDir = path.join(process.cwd(), ".local", "test-agent-runs-snapshot-state");
const ledgerPath = path.join(process.cwd(), ".local", "test-agent-runs-snapshot-ledger", "ledger.jsonl");
await rm(stateDir, { recursive: true, force: true });
await rm(path.dirname(ledgerPath), { recursive: true, force: true });
process.env.PHANTOMFORCE_AUTOMATION_STATE_DIR = stateDir;
process.env.PHANTOM_HERMES_LEDGER_PATH = ledgerPath;

await mkdir(stateDir, { recursive: true });
await writeFile(
  path.join(stateDir, "state.json"),
  JSON.stringify({
    engine_version: "test",
    jobs: {
      "rembg-health": {
        enabled: true,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_summary: "Escalated by jane.doe@example.com, card on file 4111 1111 1111 1111, please advise.",
        run_count: 1,
      },
    },
  }),
  "utf8",
);

await mkdir(path.dirname(ledgerPath), { recursive: true });
// Written directly (bypassing appendHermesLedgerRecord) to simulate a
// historical entry from before the write-time redaction fix existed.
await writeFile(
  ledgerPath,
  `${JSON.stringify({
    timestamp: new Date().toISOString(),
    tenant_id: "test-tenant",
    business_name: "Test Business",
    actor_user_id: "test-user",
    actor_role: "owner",
    request_id: "req-historical-1",
    task_type: "test:pre-fix-entry",
    sensitivity_level: "low",
    provider_route: "mock",
    model_id: "test-model",
    context_chars: 0,
    estimated_tokens: 0,
    estimated_cost_usd: 0,
    user_request_summary: "Please call jane.doe@example.com back about invoice, SSN on file 078-05-1120.",
    result_summary: "Drafted callback note.",
    approval_required: false,
    approval_status: "not_required",
    risks: [],
    next_action: "none",
  })}\n`,
  "utf8",
);

const { getAgentRunExecutor } = await import("../src/phantom-ai/agent-runs.js");

const executor = getAgentRunExecutor("business_snapshot");
assert.ok(executor, "business_snapshot executor must exist");

const fakeRun = {
  id: "test-run-1",
  operation: "business_snapshot",
  workspace: "phantomforce",
} as Parameters<typeof executor.execute>[0]["run"];

const result = await executor.execute({
  run: fakeRun,
  progress: async () => undefined,
  isCancelled: () => false,
});

assert.ok(result.artifacts.length > 0, "business_snapshot must produce an artifact");
const artifactPath = result.artifacts[0].path;
const content = await readFile(artifactPath, "utf8");

assert.ok(!content.includes("jane.doe@example.com"), "report must not contain the raw email from automation job last_summary or historical ledger entry");
assert.ok(!content.includes("4111 1111 1111 1111"), "report must not contain the raw card number from automation job last_summary");
assert.ok(!content.includes("078-05-1120"), "report must not contain the raw SSN from the historical (pre-fix-style) ledger entry");
console.log("[PASS] business_snapshot report redacts PII from automation job summaries and historical ledger entries");

// Clean up the real artifact file this test wrote under the repo's .phantom dir.
await rm(artifactPath, { force: true });
await rm(stateDir, { recursive: true, force: true });
await rm(path.dirname(ledgerPath), { recursive: true, force: true });

console.log("\nALL BUSINESS SNAPSHOT REDACTION TESTS PASSED");
