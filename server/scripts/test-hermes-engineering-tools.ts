import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = await mkdtemp(resolve(tmpdir(), "hermes-engineering-"));
const phantom = resolve(root, ".phantom");
const fixtureDir = resolve(root, "fixtures");
const fixturePath = resolve(fixtureDir, "subject.txt");
const initial = "alpha\n";
const fakeProviderKey = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

await mkdir(fixtureDir, { recursive: true });
await writeFile(fixturePath, initial, "utf8");
await writeFile(
  resolve(root, "package.json"),
  JSON.stringify({
    name: "hermes-engineering-fixture",
    private: true,
    scripts: {
      "test:pass": "node scripts/pass.mjs",
      "test:fail": "node scripts/fail.mjs",
    },
  }, null, 2),
  "utf8",
);
await mkdir(resolve(root, "scripts"), { recursive: true });
await writeFile(
  resolve(root, "scripts", "pass.mjs"),
  `console.log('OPENAI_API_KEY=${fakeProviderKey}')\n`,
  "utf8",
);
await writeFile(resolve(root, "scripts", "fail.mjs"), "process.exit(7)\n", "utf8");
await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root, windowsHide: true });
await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: root, windowsHide: true });
await execFileAsync("git", ["add", "."], { cwd: root, windowsHide: true });
await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root, windowsHide: true });

Object.assign(process.env, {
  NODE_ENV: "test",
  PHANTOMBOT_OPERATOR_WORKSPACE_ROOT: root,
  PHANTOM_AGENT_RUNS_LOG_PATH: resolve(phantom, "runs.jsonl"),
  PHANTOM_AGENT_RUN_ARTIFACTS_DIR: resolve(phantom, "artifacts"),
  PHANTOM_HERMES_LEDGER_PATH: resolve(phantom, "ledger.jsonl"),
});

const {
  approveAgentRun,
  getAgentRun,
  startAgentRun,
} = await import("../src/phantom-ai/agent-runs.js");
const {
  HERMES_ENGINEERING_CHANGE_OPERATION,
  HERMES_ENGINEERING_READ_OPERATION,
  normalizeEngineeringPath,
  parseEngineeringTaskPlan,
} = await import("../src/phantom-ai/hermes-engineering-tools.js");

const workspace = "fixture-workspace";
const proof = { tenantId: workspace, businessName: "Fixture Workspace" };
const actor = { id: "fixture-admin" };

async function waitForRun(id: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = getAgentRun(id);
    if (run && ["completed", "succeeded", "failed", "cancelled"].includes(run.state)) return run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  throw new Error(`run ${id} did not finish`);
}

async function start(operation: string, plan: unknown, key: string) {
  const result = await startAgentRun({
    operation,
    workspace,
    organizationId: workspace,
    module: "phantombot",
    sessionId: actor.id,
    request: "Typed engineering fixture",
    tenantId: workspace,
    businessName: proof.businessName,
    requestedBy: actor.id,
    idempotencyKey: key,
    inputs: { plan },
  });
  assert("id" in result);
  return result;
}

try {
  assert.throws(() => normalizeEngineeringPath("%2e%2e%2foutside.txt"), /path_traversal_rejected/);
  assert.throws(() => normalizeEngineeringPath("fixtures\\nested/file.txt"), /mixed_path_separators_rejected/);
  assert.throws(
    () => parseEngineeringTaskPlan({
      version: 1,
      workspace,
      summary: "Invalid combined commit",
      operations: [
        { id: "read", kind: "repo_status", summary: "Read status" },
        { id: "commit", kind: "git_commit", summary: "Commit", message: "unsafe grouping" },
      ],
    }),
    /separately approved/,
  );

  const readPlan = {
    version: 1,
    workspace,
    summary: "Read-only orientation",
    operations: [
      { id: "status", kind: "repo_status", summary: "Inspect repository status" },
      { id: "file", kind: "read_text_file", summary: "Read fixture", path: "fixtures/subject.txt", maxBytes: 1024 },
      { id: "scripts", kind: "inspect_package_scripts", summary: "Inspect scripts", path: "package.json" },
    ],
    verification: { inspectDiff: true, requireCleanRollback: true },
  };
  const beforeRead = await readFile(fixturePath, "utf8");
  const readStarted = await start(HERMES_ENGINEERING_READ_OPERATION, readPlan, "read-plan");
  assert.notEqual(readStarted.state, "awaiting_approval");
  const readFinished = await waitForRun(readStarted.id);
  assert.equal(readFinished.state, "completed", readFinished.error || undefined);
  assert.equal(await readFile(fixturePath, "utf8"), beforeRead);
  assert.equal(readFinished.receipt?.verification.ok, true);

  const successPlan = {
    version: 1,
    workspace,
    summary: "Exact edit and approved test",
    operations: [
      {
        id: "edit",
        kind: "edit_text_file",
        summary: "Change alpha to beta",
        path: "fixtures/subject.txt",
        expectedSha256: hash(initial),
        expectedText: "alpha",
        replacementText: "beta",
      },
      {
        id: "test",
        kind: "run_npm_script",
        summary: "Run declared passing test",
        script: "test:pass",
        args: [],
        timeoutMs: 20_000,
      },
      { id: "diff", kind: "git_diff", summary: "Inspect resulting diff", staged: false },
    ],
    verification: { inspectDiff: true, requireCleanRollback: true },
  };
  const successStarted = await start(HERMES_ENGINEERING_CHANGE_OPERATION, successPlan, "success-plan");
  assert.equal(successStarted.state, "awaiting_approval");
  const successDuplicate = await start(HERMES_ENGINEERING_CHANGE_OPERATION, successPlan, "success-plan");
  assert.equal(successDuplicate.id, successStarted.id);
  const successApproval = await approveAgentRun(successStarted.id, actor, proof);
  assert.equal(successApproval.ok, true);
  const successFinished = await waitForRun(successStarted.id);
  assert.equal(successFinished.state, "succeeded", successFinished.error || undefined);
  assert.equal(await readFile(fixturePath, "utf8"), "beta\n");
  assert.equal(successFinished.receipt?.verification.ok, true);
  const successEvidence = await readFile(successFinished.artifacts[0].path, "utf8");
  assert(!successEvidence.includes(fakeProviderKey));
  assert.match(successEvidence, /\[redacted(?:-key)?\]/i);

  await writeFile(fixturePath, initial, "utf8");
  const payloadMutationPlan = structuredClone(successPlan);
  payloadMutationPlan.operations[0].path = "fixtures/other.txt";
  const mutationStarted = await start(HERMES_ENGINEERING_CHANGE_OPERATION, successPlan, "mutation-plan");
  mutationStarted.inputs.plan = payloadMutationPlan;
  const mutationApproval = await approveAgentRun(mutationStarted.id, actor, proof);
  assert.equal(mutationApproval.ok, false);
  assert.equal(mutationApproval.error, "approval_payload_changed");
  assert.equal(await readFile(fixturePath, "utf8"), initial);

  const commandMutationStarted = await start(HERMES_ENGINEERING_CHANGE_OPERATION, successPlan, "command-mutation-plan");
  const commandMutation = structuredClone(successPlan);
  commandMutation.operations[1].script = "test:fail";
  commandMutationStarted.inputs.plan = commandMutation;
  const commandMutationApproval = await approveAgentRun(commandMutationStarted.id, actor, proof);
  assert.equal(commandMutationApproval.ok, false);
  assert.equal(commandMutationApproval.error, "approval_payload_changed");

  const rollbackPlan = structuredClone(successPlan);
  rollbackPlan.summary = "Edit then intentionally fail verification";
  rollbackPlan.operations[1].script = "test:fail";
  const rollbackStarted = await start(HERMES_ENGINEERING_CHANGE_OPERATION, rollbackPlan, "rollback-plan");
  assert.equal((await approveAgentRun(rollbackStarted.id, actor, proof)).ok, true);
  const rollbackFinished = await waitForRun(rollbackStarted.id);
  assert.equal(rollbackFinished.state, "failed");
  assert.equal(await readFile(fixturePath, "utf8"), initial);
  assert.equal(rollbackFinished.receipt?.verification.ok, false);
  assert.match(rollbackFinished.receipt?.verification.detail || "", /rolled_back/);
  const rollbackEvidence = JSON.parse(await readFile(rollbackFinished.artifacts[0].path, "utf8")) as {
    rolledBack: boolean;
    rollback: Array<{ ok: boolean }>;
  };
  assert.equal(rollbackEvidence.rolledBack, true);
  assert(rollbackEvidence.rollback.every((entry) => entry.ok));

  const maliciousPlan = {
    version: 1,
    workspace,
    summary: "Reject malicious argument",
    operations: [{
      id: "malicious",
      kind: "run_npm_script",
      summary: "Argument must fail closed",
      script: "test:pass",
      args: ["ok;Remove-Item"],
      timeoutMs: 10_000,
    }],
  };
  const maliciousStarted = await start(HERMES_ENGINEERING_CHANGE_OPERATION, maliciousPlan, "malicious-plan");
  assert.equal((await approveAgentRun(maliciousStarted.id, actor, proof)).ok, true);
  const maliciousFinished = await waitForRun(maliciousStarted.id);
  assert.equal(maliciousFinished.state, "failed");
  assert.match(maliciousFinished.receipt?.verification.detail || "", /command_argument_rejected/);

  let linkedPathTested = false;
  const outside = await mkdtemp(resolve(tmpdir(), "hermes-engineering-outside-"));
  try {
    await symlink(outside, resolve(root, "fixtures", "linked"), process.platform === "win32" ? "junction" : "dir");
    linkedPathTested = true;
    const linkedPlan = {
      version: 1,
      workspace,
      summary: "Reject linked escape",
      operations: [{
        id: "linked",
        kind: "read_text_file",
        summary: "Attempt linked read",
        path: "fixtures/linked/outside.txt",
        maxBytes: 1024,
      }],
    };
    await writeFile(resolve(outside, "outside.txt"), "outside\n", "utf8");
    const linkedStarted = await start(HERMES_ENGINEERING_READ_OPERATION, linkedPlan, "linked-plan");
    const linkedFinished = await waitForRun(linkedStarted.id);
    assert.equal(linkedFinished.state, "failed");
    assert.match(linkedFinished.receipt?.verification.detail || "", /linked_path_rejected/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
  } finally {
    await rm(outside, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    readOnlyReceipt: readFinished.receipt?.receipt_id,
    successReceipt: successFinished.receipt?.receipt_id,
    rollbackReceipt: rollbackFinished.receipt?.receipt_id,
    linkedPathTested,
    adversarialChecks: 10,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
