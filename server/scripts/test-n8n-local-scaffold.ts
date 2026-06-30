import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_N8N_LOCAL_HOST,
  DEFAULT_N8N_LOCAL_PORT,
  DEFAULT_N8N_SCAFFOLD_PATH,
  buildToolLanePreview,
  inspectLocalN8nStatus,
} from "../src/phantom-ai/tool-lane.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const scaffoldPath = DEFAULT_N8N_SCAFFOLD_PATH;
const read = (path: string) => readFileSync(path, "utf8");
const requiredFiles = [
  "README.md",
  ".env.example",
  "CHICAGOSHOTS_DRY_RUN_WORKFLOW.md",
  "scripts/start-local.ps1",
  "scripts/stop-local.ps1",
  "scripts/health-check.ps1",
  "workflows/chicagoshots-lead-intake-dry-run.json",
].map((file) => resolve(scaffoldPath, file));

for (const file of requiredFiles) {
  assert(existsSync(file), `Required n8n scaffold file missing: ${file}`);
}

const envExample = read(resolve(scaffoldPath, ".env.example"));
assert(envExample.includes("N8N_LISTEN_ADDRESS=127.0.0.1"), "n8n env must bind to 127.0.0.1.");
assert(envExample.includes("N8N_PORT=5678"), "n8n env should prefer port 5678.");
assert(!/API_KEY\s*=|TOKEN\s*=|SECRET\s*=|PASSWORD\s*=/i.test(envExample), "n8n env example must not include secrets.");

const startScript = read(resolve(scaffoldPath, "scripts/start-local.ps1"));
assert(startScript.includes("127.0.0.1"), "start script must force localhost.");
assert(startScript.includes("Start-Process"), "start script should support local runtime launch.");
assert(startScript.includes("-WindowStyle Hidden"), "start script should launch hidden if used.");
assert(!/0\.0\.0\.0|--tunnel|ngrok|localhost\.run/i.test(startScript), "start script must not expose public tunnels.");

const stopScript = read(resolve(scaffoldPath, "scripts/stop-local.ps1"));
assert(stopScript.includes("n8n.pid"), "stop script must use the local pid file.");
assert(stopScript.includes("CommandLine -notmatch \"n8n\""), "stop script must avoid stopping unrelated processes.");

const healthScript = read(resolve(scaffoldPath, "scripts/health-check.ps1"));
assert(healthScript.includes("http://127.0.0.1:$port/healthz"), "health check must use localhost healthz.");
assert(!/https?:\/\/(?!127\.0\.0\.1)/i.test(healthScript), "health check must not call non-local URLs.");

const workflowPath = resolve(scaffoldPath, "workflows/chicagoshots-lead-intake-dry-run.json");
const workflowRaw = read(workflowPath);
const workflow = JSON.parse(workflowRaw) as {
  active?: boolean;
  nodes?: Array<{ type?: string; name?: string }>;
  credentials?: unknown;
  meta?: Record<string, unknown>;
};

assert(workflow.active === false, "ChicagoShots workflow must be inactive.");
assert(Array.isArray(workflow.nodes) && workflow.nodes.length >= 4, "Workflow should contain the dry-run draft chain.");
assert(!("credentials" in workflow), "Workflow export must not include credentials.");
assert(
  workflow.nodes.every((node) => !/webhook|httpRequest|email|gmail|smtp|slack|telegram|twilio|discord/i.test(node.type ?? "")),
  "Workflow must not include external action nodes.",
);
assert(!/"public_webhooks_allowed"\s*:\s*true/i.test(workflowRaw), "Workflow must not allow public webhooks.");
assert(!/public[_ -]?webhook[_ -]?(url|endpoint)/i.test(workflowRaw), "Workflow must not include public webhook URLs.");
assert(workflowRaw.includes("Lead Intake Sample"), "Workflow should include lead intake.");
assert(workflowRaw.includes("Task Draft"), "Workflow should include task draft.");
assert(workflowRaw.includes("Follow-up Draft"), "Workflow should include follow-up draft.");
assert(workflowRaw.includes("Approval Preview"), "Workflow should include approval preview.");

const status = await inspectLocalN8nStatus({ probe: false });
assert(status.n8n_scaffolded === true, "Tool lane status should detect scaffold.");
assert(status.n8n_local_url === `http://${DEFAULT_N8N_LOCAL_HOST}:${DEFAULT_N8N_LOCAL_PORT}`, "n8n local URL should be localhost.");
assert(status.public_webhooks_allowed === false, "n8n status must block public webhooks.");
assert(status.credentials_configured === false, "n8n status must not report credentials.");
assert(status.workflow_drafts[0]?.exists === true, "n8n status should detect the ChicagoShots workflow draft.");

const preview = await buildToolLanePreview({ toolId: "n8n", probeN8n: false });
assert(preview.n8n_status.n8n_scaffolded === true, "Tool-lane preview should expose scaffolded status.");
assert(preview.n8n_status.n8n_local_url === "http://127.0.0.1:5678", "Tool-lane preview should expose local URL.");
assert(preview.execution_disabled === true, "Tool-lane preview must keep execution disabled.");
assert(preview.would_run === false, "Tool-lane preview must not run.");
assert(preview.safety_flags.workflow_executed === false, "Tool-lane preview must not execute workflows.");
assert(preview.safety_flags.external_call_performed === false, "Tool-lane preview must not perform external calls.");
assert(preview.safety_flags.approval_executed === false, "Tool-lane preview must not execute approvals.");
assert(preview.safety_flags.queue_written === false, "Tool-lane preview must not write queues.");
assert(preview.safety_flags.production_ledger_written === false, "Tool-lane preview must not write production ledgers.");

console.log(
  JSON.stringify(
    {
      ok: true,
      scaffoldPath,
      workflowPath,
      localUrl: status.n8n_local_url,
      n8nScaffolded: status.n8n_scaffolded,
      workflowDraftExists: status.workflow_drafts[0]?.exists === true,
      workflowActive: workflow.active,
      toolLaneExecutionDisabled: preview.execution_disabled,
      toolLaneWouldRun: preview.would_run,
      externalCallPerformed: preview.safety_flags.external_call_performed,
      workflowExecuted: preview.safety_flags.workflow_executed,
      approvalExecuted: preview.safety_flags.approval_executed,
      queueWritten: preview.safety_flags.queue_written,
      productionLedgerWritten: preview.safety_flags.production_ledger_written,
    },
    null,
    2,
  ),
);
