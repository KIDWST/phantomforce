import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { buildToolLanePreview, loadToolRegistry } from "./tool-lane.js";

const execFileAsync = promisify(execFile);

const WORKFLOW_STACK_ROOT = "C:\\Users\\jorda\\Documents\\PhantomForce-AgentLab\\workflow-stack";
const SCRIPT_ROOT = `${WORKFLOW_STACK_ROOT}\\scripts`;
const MAX_OUTPUT_CHARS = 10_000;

const safeActionDefinitions = [
  {
    id: "agentlab-preflight",
    label: "Run AgentLab preflight",
    worker: "PhantomAI",
    program: "AgentLab",
    description: "Checks AgentLab wrappers, quarantines, global-state risks, and unsafe runtime processes.",
    script: "agentlab-preflight.ps1",
    mutates_agentlab: false,
  },
  {
    id: "agent-os-sandbox",
    label: "Read Agent OS standards posture",
    worker: "Standard",
    program: "Agent OS",
    description: "Reports Agent OS as standards/documentation only. Does not install or sync it.",
    script: "run-agent-os-sandbox.ps1",
    mutates_agentlab: false,
  },
  {
    id: "openspec-proposal",
    label: "Draft OpenSpec proposal",
    worker: "Spec",
    program: "OpenSpec",
    description: "Creates a local AgentLab proposal draft when write=true; product repos are untouched.",
    script: "openspec-new-proposal.ps1",
    mutates_agentlab: true,
  },
  {
    id: "serena-readonly-profile",
    label: "Generate Serena read-only profile",
    worker: "Map",
    program: "Serena",
    description: "Prints the planned read-only code navigation profile. Does not start Serena.",
    script: "serena-readonly-profile.ps1",
    mutates_agentlab: false,
  },
  {
    id: "ruflo-planning",
    label: "Read Ruflo planning-only posture",
    worker: "Swarm",
    program: "Ruflo",
    description: "Reports Ruflo metadata and confirms runtime remains blocked.",
    script: "run-ruflo-planning-only.ps1",
    mutates_agentlab: false,
  },
  {
    id: "tool-registry-audit",
    label: "Audit downloaded tool candidates",
    worker: "Relay",
    program: "AgentLab registry",
    description: "Reads tool candidate versions, licenses, git state, and registry posture.",
    script: "check-tools.ps1",
    mutates_agentlab: false,
  },
  {
    id: "n8n-readiness",
    label: "Check n8n readiness",
    worker: "Relay",
    program: "n8n",
    description: "Uses the existing dry-run tool lane preview. Does not start n8n or run workflows.",
    script: null,
    mutates_agentlab: false,
  },
] as const;

export const AgentActionRequestSchema = z.object({
  action_id: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  write: z.boolean().optional(),
});

type AgentActionDefinition = (typeof safeActionDefinitions)[number];

function scriptPath(definition: AgentActionDefinition) {
  if (!definition.script) return null;
  return `${SCRIPT_ROOT}\\${definition.script}`;
}

function truncateOutput(value: string) {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n...[truncated ${value.length - MAX_OUTPUT_CHARS} chars]`;
}

function redact(value: string) {
  return value
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "sk-or-v1-[REDACTED]")
    .replace(/sk-proj-[A-Za-z0-9_-]+/g, "sk-proj-[REDACTED]")
    .replace(/OPENROUTER_API_KEY\s*=\s*[^\s]+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, "Authorization: Bearer [REDACTED]");
}

function parseMaybeJson(output: string) {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

async function runPowerShellScript(definition: AgentActionDefinition, args: string[]) {
  const path = scriptPath(definition);
  if (!path) {
    throw new Error(`Action ${definition.id} has no PowerShell script.`);
  }

  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path, ...args],
    {
      cwd: WORKFLOW_STACK_ROOT,
      timeout: 25_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const safeStdout = truncateOutput(redact(stdout));
  const safeStderr = truncateOutput(redact(stderr));

  return {
    stdout: safeStdout,
    stderr: safeStderr,
    json: parseMaybeJson(safeStdout),
  };
}

export function getAgentActionDefinitions() {
  return safeActionDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    worker: definition.worker,
    program: definition.program,
    description: definition.description,
    mutates_agentlab: definition.mutates_agentlab,
    product_repo_edits: false,
    external_actions: false,
    provider_calls: false,
    workflow_execution: false,
  }));
}

export async function runAgentAction(input: z.infer<typeof AgentActionRequestSchema>) {
  const definition = safeActionDefinitions.find((item) => item.id === input.action_id);
  if (!definition) {
    return {
      ok: false,
      error: `Unknown agent action: ${input.action_id}`,
      allowed_actions: safeActionDefinitions.map((item) => item.id),
    };
  }

  if (definition.id === "n8n-readiness") {
    const [preview, registry] = await Promise.all([
      buildToolLanePreview({ toolId: "n8n" }),
      loadToolRegistry(),
    ]);

    return {
      ok: true,
      action_id: definition.id,
      label: definition.label,
      worker: definition.worker,
      program: definition.program,
      status: "completed",
      result_type: "tool_lane_preview",
      output: preview,
      registry_loaded: registry.loaded,
      safety_flags: {
        product_repo_edits: false,
        external_actions: false,
        provider_calls: false,
        n8n_started: false,
        workflow_executed: false,
        credentials_used: false,
      },
    };
  }

  const args: string[] = [];
  if (definition.id === "openspec-proposal") {
    const title = input.title?.trim() || `PhantomForce workforce proposal ${new Date().toISOString()}`;
    args.push("-Title", title);
    if (input.write) args.push("-Write");
  }

  const result = await runPowerShellScript(definition, args);

  return {
    ok: true,
    action_id: definition.id,
    label: definition.label,
    worker: definition.worker,
    program: definition.program,
    status: "completed",
    result_type: result.json ? "json" : "text",
    output: result.json ?? result.stdout,
    stderr: result.stderr,
    safety_flags: {
      product_repo_edits: false,
      external_actions: false,
      provider_calls: false,
      n8n_started: false,
      workflow_executed: false,
      credentials_used: false,
      agentlab_files_written: definition.id === "openspec-proposal" && input.write === true,
    },
  };
}
