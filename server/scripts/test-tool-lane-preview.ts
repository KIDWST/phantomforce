import { readFileSync } from "node:fs";

import { buildToolLanePreview, loadToolRegistry } from "../src/phantom-ai/tool-lane.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static source guards: the tool lane must not run anything or call out.
const source = readFileSync(new URL("../src/phantom-ai/tool-lane.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Tool lane must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Tool lane must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Tool lane must not add axios calls.");
assert(!/child_process|execSync|\bspawn\(|\bexec\(/i.test(source), "Tool lane must not spawn processes.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Tool lane must not write files.");
assert(
  !/npx\s+n8n|n8n\s+start|npm\s+install|\.listen\s*\(/i.test(source),
  "Tool lane must not start/install n8n or open a listener.",
);

// 1) Registry loads and validates.
const registry = await loadToolRegistry();
assert(registry.loaded === true, "Registry should load.");
assert(registry.tool_count > 0, "Registry should contain tools.");
assert(registry.valid_tool_count === registry.tool_count, "All registry tools should validate.");
assert(registry.malformed_entries === 0, "No malformed registry entries expected.");
assert(
  registry.tools.every((tool) => tool.id && tool.allowed_mode && tool.blocked_actions.length > 0),
  "Each tool must have id, allowed_mode, and blocked_actions.",
);

// 2) n8n preview is registry-only / dry-run / execution disabled.
const n8n = await buildToolLanePreview({ toolId: "n8n" });
assert(n8n.status === "dry_run_preview", "n8n preview should be a dry-run preview.");
assert(n8n.execution_disabled === true, "n8n preview must have execution_disabled true.");
assert(n8n.would_run === false, "n8n preview must have would_run false.");
assert(n8n.selected_tool?.id === "n8n", "n8n preview must select the n8n tool.");
assert(typeof n8n.allowed_mode === "string" && n8n.allowed_mode.length > 0, "n8n must report an allowed_mode.");
assert(n8n.blocked_actions.length > 0, "n8n must report blocked actions.");
assert(n8n.blocked_actions.includes("public_webhooks"), "n8n blocked actions must include public_webhooks.");
assert(n8n.blocked_actions.includes("active_workflows"), "n8n blocked actions must include active_workflows.");
assert(typeof n8n.reason === "string" && n8n.reason.length > 0, "n8n preview must give a reason.");
assert(n8n.safety_flags.n8n_started === false, "n8n must not be started.");
assert(n8n.safety_flags.public_webhook_opened === false, "No public webhook opened.");
assert(n8n.safety_flags.credentials_used === false, "No credentials used.");
assert(n8n.safety_flags.external_call_performed === false, "No external call.");
assert(n8n.safety_flags.network_call_performed === false, "No network call.");
assert(n8n.safety_flags.workflow_executed === false, "No workflow executed.");
assert(n8n.safety_flags.provider_called === false, "No provider call.");
assert(n8n.safety_flags.approval_executed === false, "No approval execution.");
assert(n8n.safety_flags.queue_written === false, "No queue write.");
assert(n8n.safety_flags.production_ledger_written === false, "No production ledger write.");

// 3) Unknown tool returns a safe blocked response (no execution).
const unknown = await buildToolLanePreview({ toolId: "does-not-exist-zzz" });
assert(unknown.status === "unknown_tool", "Unknown tool must report unknown_tool status.");
assert(unknown.selected_tool === null, "Unknown tool must not select a tool.");
assert(unknown.would_run === false, "Unknown tool must not run.");
assert(unknown.execution_disabled === true, "Unknown tool must keep execution disabled.");
assert(unknown.safety_flags.workflow_executed === false, "Unknown tool must not execute a workflow.");

// 4) No-tool preview returns the registry summary, dry-run only.
const noTool = await buildToolLanePreview({});
assert(noTool.status === "dry_run_preview", "No-tool preview should be a dry-run preview.");
assert(noTool.would_run === false, "No-tool preview must not run.");
assert(noTool.registry.tool_count === registry.tool_count, "No-tool preview should summarize the registry.");

// 5) All registered tools preview as dry-run, execution disabled (no active lane).
for (const tool of registry.tools) {
  const preview = await buildToolLanePreview({ toolId: tool.id });
  assert(preview.would_run === false, `Tool ${tool.id} must never would_run.`);
  assert(preview.execution_disabled === true, `Tool ${tool.id} must keep execution disabled.`);
}

// 6) Missing registry path fails closed (registry_unavailable, nothing runs).
const missing = await buildToolLanePreview({ toolId: "n8n", registryPath: "C:/nonexistent/tool-registry.json" });
assert(missing.status === "registry_unavailable", "Missing registry must report registry_unavailable.");
assert(missing.would_run === false, "Missing registry must not run anything.");
assert(missing.execution_disabled === true, "Missing registry must keep execution disabled.");

console.log(
  JSON.stringify(
    {
      ok: true,
      toolCount: registry.tool_count,
      validToolCount: registry.valid_tool_count,
      malformed: registry.malformed_entries,
      n8nStatus: n8n.status,
      n8nExecutionDisabled: n8n.execution_disabled,
      n8nWouldRun: n8n.would_run,
      n8nAllowedMode: n8n.allowed_mode,
      unknownStatus: unknown.status,
      missingRegistryStatus: missing.status,
      anyWouldRun: registry.tools.some((t) => false),
    },
    null,
    2,
  ),
);
