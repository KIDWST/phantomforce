import { access, readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText, redactPersonalDataText } from "./hermes-ledger.js";

// n8n Sprint 1: dry-run Tool Lane contract.
//
// Read-only loader for docs/tooling-spine/tool-registry.json plus a dry-run
// "would-run" preview. This is the contract a future approval-gated tool/n8n
// worker lane must satisfy. It NEVER runs a tool, starts n8n, opens a webhook,
// uses a credential, calls a provider/external API, executes an approval, or
// writes a queue/ledger record.
//
// Hard boundaries (same dry-run/local ladder):
// - READ ONLY: reads only the local registry JSON; no writes anywhere.
// - execution_disabled is a hard literal true; would_run is a hard literal false.
// - No credentials, no external/network call, no workflow execution.

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");

export const DEFAULT_TOOL_REGISTRY_PATH = resolve(repoRoot, "docs", "tooling-spine", "tool-registry.json");
export const DEFAULT_N8N_SCAFFOLD_PATH = resolve(repoRoot, "ops", "n8n");
export const DEFAULT_N8N_LOCAL_HOST = "127.0.0.1";
export const DEFAULT_N8N_LOCAL_PORT = 5678;

const MAX_BLOCKED_ACTIONS = 40;
const MAX_FIELD_CHARS = 200;
const N8N_LOCAL_PROBE_TIMEOUT_MS = 350;

export type ToolRegistryEntry = {
  id: string;
  display_name: string;
  intended_role: string;
  allowed_mode: string;
  blocked_actions: string[];
  next_phase: string;
  valid: boolean;
  validation_errors: string[];
};

export type ToolRegistryLoadResult = {
  registry_path: string;
  schema_version: string;
  status: string;
  rules: Record<string, unknown>;
  tools: ToolRegistryEntry[];
  tool_count: number;
  valid_tool_count: number;
  malformed_entries: number;
  loaded: boolean;
  load_error: string | null;
};

export type ToolLanePreview = {
  previewed_at: string;
  requested_tool_id: string | null;
  selected_tool: {
    id: string;
    display_name: string;
    allowed_mode: string;
    intended_role: string;
    blocked_actions: string[];
    next_phase: string;
  } | null;
  status: "dry_run_preview" | "unknown_tool" | "registry_unavailable";
  would_run: false;
  execution_disabled: true;
  allowed_mode: string | null;
  blocked_actions: string[];
  reason: string;
  registry: {
    registry_path: string;
    schema_version: string;
    status: string;
    tool_count: number;
    valid_tool_count: number;
    malformed_entries: number;
    tool_ids: string[];
  };
  n8n_status: LocalN8nStatus;
  safety_flags: {
    execution_disabled: true;
    would_run: false;
    read_only: true;
    credentials_used: false;
    external_call_performed: false;
    network_call_performed: false;
    workflow_executed: false;
    n8n_started: false;
    public_webhook_opened: false;
    provider_called: false;
    approval_executed: false;
    queue_written: false;
    production_ledger_written: false;
    raw_secret_exposed: false;
  };
};

export type LocalN8nStatus = {
  n8n_scaffolded: boolean;
  n8n_running: boolean;
  n8n_local_url: string;
  n8n_host: typeof DEFAULT_N8N_LOCAL_HOST;
  n8n_port: number;
  scaffold_path: string;
  health_check: "localhost_tcp_probe" | "not_checked";
  health_error: string | null;
  workflow_drafts: Array<{
    id: string;
    path: string;
    exists: boolean;
    active: false;
  }>;
  public_webhooks_allowed: false;
  credentials_configured: false;
};

function asString(value: unknown, maxChars = MAX_FIELD_CHARS): string {
  if (typeof value !== "string") return "";
  return redactPersonalDataText(value).slice(0, maxChars);
}

function asBlockedActions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_BLOCKED_ACTIONS)
    .filter((item): item is string => typeof item === "string")
    .map((item) => redactPersonalDataText(item).slice(0, 80));
}

function validateEntry(raw: unknown): ToolRegistryEntry {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const id = asString(source.id, 80);
  const display_name = asString(source.display_name, 120);
  const intended_role = asString(source.intended_role);
  const allowed_mode = asString(source.allowed_mode, 80);
  const blocked_actions = asBlockedActions(source.blocked_actions);
  const next_phase = asString(source.next_phase);

  if (!id) errors.push("missing_id");
  if (!display_name) errors.push("missing_display_name");
  if (!allowed_mode) errors.push("missing_allowed_mode");
  if (!Array.isArray(source.blocked_actions) || blocked_actions.length === 0) errors.push("missing_blocked_actions");
  if (!intended_role) errors.push("missing_intended_role");

  return {
    id,
    display_name,
    intended_role,
    allowed_mode,
    blocked_actions,
    next_phase,
    valid: errors.length === 0,
    validation_errors: errors,
  };
}

export async function loadToolRegistry(
  options: { registryPath?: string } = {},
): Promise<ToolRegistryLoadResult> {
  const registryPath = options.registryPath ?? DEFAULT_TOOL_REGISTRY_PATH;

  try {
    const raw = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawTools = Array.isArray(parsed.tools) ? parsed.tools : [];
    const tools: ToolRegistryEntry[] = [];
    let malformed = 0;

    for (const rawTool of rawTools) {
      const entry = validateEntry(rawTool);
      if (!entry.id) {
        malformed += 1;
        continue;
      }
      tools.push(entry);
    }

    return {
      registry_path: registryPath,
      schema_version: asString(parsed.schema_version, 40),
      status: asString(parsed.status, 80),
      rules: (parsed.rules && typeof parsed.rules === "object" ? parsed.rules : {}) as Record<string, unknown>,
      tools,
      tool_count: tools.length,
      valid_tool_count: tools.filter((tool) => tool.valid).length,
      malformed_entries: malformed,
      loaded: true,
      load_error: null,
    };
  } catch (error) {
    return {
      registry_path: registryPath,
      schema_version: "",
      status: "",
      rules: {},
      tools: [],
      tool_count: 0,
      valid_tool_count: 0,
      malformed_entries: 0,
      loaded: false,
      load_error: redactPersonalDataText((error as Error)?.message ?? "registry_load_failed").slice(0, 200),
    };
  }
}

function safetyFlags(): ToolLanePreview["safety_flags"] {
  return {
    execution_disabled: true,
    would_run: false,
    read_only: true,
    credentials_used: false,
    external_call_performed: false,
    network_call_performed: false,
    workflow_executed: false,
    n8n_started: false,
    public_webhook_opened: false,
    provider_called: false,
    approval_executed: false,
    queue_written: false,
    production_ledger_written: false,
    raw_secret_exposed: false,
  };
}

function normalizeLocalPort(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1 || value > 65535) {
    return DEFAULT_N8N_LOCAL_PORT;
  }

  return value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function probeLocalTcpPort(options: {
  host: typeof DEFAULT_N8N_LOCAL_HOST;
  port: number;
  timeoutMs: number;
}): Promise<{ running: boolean; error: string | null }> {
  return await new Promise((resolveProbe) => {
    const socket = createConnection({
      host: options.host,
      port: options.port,
    });
    let settled = false;

    const settle = (running: boolean, error: string | null = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe({
        running,
        error: error ? redactPersonalDataText(error).slice(0, 120) : null,
      });
    };

    socket.setTimeout(options.timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false, "local_probe_timeout"));
    socket.once("error", (error) => settle(false, (error as Error)?.message ?? "local_probe_failed"));
  });
}

export async function inspectLocalN8nStatus(options: {
  scaffoldPath?: string;
  port?: number;
  probe?: boolean;
} = {}): Promise<LocalN8nStatus> {
  const scaffoldPath = options.scaffoldPath ?? DEFAULT_N8N_SCAFFOLD_PATH;
  const port = normalizeLocalPort(options.port);
  const workflowPath = resolve(scaffoldPath, "workflows", "chicagoshots-lead-intake-dry-run.json");
  const requiredScaffoldFiles = [
    resolve(scaffoldPath, "README.md"),
    resolve(scaffoldPath, ".env.example"),
    resolve(scaffoldPath, "scripts", "start-local.ps1"),
    resolve(scaffoldPath, "scripts", "stop-local.ps1"),
    resolve(scaffoldPath, "scripts", "health-check.ps1"),
    workflowPath,
  ];
  const fileChecks = await Promise.all(requiredScaffoldFiles.map((file) => pathExists(file)));
  const shouldProbe = options.probe ?? true;
  const probeResult = shouldProbe
    ? await probeLocalTcpPort({
        host: DEFAULT_N8N_LOCAL_HOST,
        port,
        timeoutMs: N8N_LOCAL_PROBE_TIMEOUT_MS,
      })
    : { running: false, error: null };

  return {
    n8n_scaffolded: fileChecks.every(Boolean),
    n8n_running: probeResult.running,
    n8n_local_url: `http://${DEFAULT_N8N_LOCAL_HOST}:${port}`,
    n8n_host: DEFAULT_N8N_LOCAL_HOST,
    n8n_port: port,
    scaffold_path: scaffoldPath,
    health_check: shouldProbe ? "localhost_tcp_probe" : "not_checked",
    health_error: probeResult.error,
    workflow_drafts: [
      {
        id: "chicagoshots_lead_intake_dry_run",
        path: workflowPath,
        exists: fileChecks[fileChecks.length - 1] ?? false,
        active: false,
      },
    ],
    public_webhooks_allowed: false,
    credentials_configured: false,
  };
}

export async function buildToolLanePreview(options: {
  toolId?: string | null;
  registryPath?: string;
  n8nStatus?: LocalN8nStatus;
  probeN8n?: boolean;
  now?: string;
}): Promise<ToolLanePreview> {
  const previewedAt = options.now ?? new Date().toISOString();
  const requestedToolId = options.toolId?.trim() ? redactSensitiveText(options.toolId.trim()).slice(0, 80) : null;
  const [registry, n8nStatus] = await Promise.all([
    loadToolRegistry({ registryPath: options.registryPath }),
    options.n8nStatus ?? inspectLocalN8nStatus({ probe: options.probeN8n }),
  ]);

  const registrySummary = {
    registry_path: registry.registry_path,
    schema_version: registry.schema_version,
    status: registry.status,
    tool_count: registry.tool_count,
    valid_tool_count: registry.valid_tool_count,
    malformed_entries: registry.malformed_entries,
    tool_ids: registry.tools.map((tool) => tool.id),
  };

  if (!registry.loaded) {
    return {
      previewed_at: previewedAt,
      requested_tool_id: requestedToolId,
      selected_tool: null,
      status: "registry_unavailable",
      would_run: false,
      execution_disabled: true,
      allowed_mode: null,
      blocked_actions: [],
      reason: "Tool registry could not be loaded; nothing can run. This lane is dry-run only.",
      registry: registrySummary,
      n8n_status: n8nStatus,
      safety_flags: safetyFlags(),
    };
  }

  if (requestedToolId) {
    const tool = registry.tools.find((entry) => entry.id === requestedToolId);
    if (!tool) {
      return {
        previewed_at: previewedAt,
        requested_tool_id: requestedToolId,
        selected_tool: null,
        status: "unknown_tool",
        would_run: false,
        execution_disabled: true,
        allowed_mode: null,
        blocked_actions: [],
        reason: "Unknown tool id. No tool was selected and nothing can run.",
        registry: registrySummary,
        n8n_status: n8nStatus,
        safety_flags: safetyFlags(),
      };
    }

    return {
      previewed_at: previewedAt,
      requested_tool_id: requestedToolId,
      selected_tool: {
        id: tool.id,
        display_name: tool.display_name,
        allowed_mode: tool.allowed_mode,
        intended_role: tool.intended_role,
        blocked_actions: tool.blocked_actions,
        next_phase: tool.next_phase,
      },
      status: "dry_run_preview",
      would_run: false,
      execution_disabled: true,
      allowed_mode: tool.allowed_mode,
      blocked_actions: tool.blocked_actions,
      reason: `Tool "${tool.id}" is ${tool.allowed_mode}. This is a dry-run preview only: no tool, workflow, n8n runtime, webhook, credential, provider, approval, queue, or ledger action can run.`,
      registry: registrySummary,
      n8n_status: n8nStatus,
      safety_flags: safetyFlags(),
    };
  }

  return {
    previewed_at: previewedAt,
    requested_tool_id: null,
    selected_tool: null,
    status: "dry_run_preview",
    would_run: false,
    execution_disabled: true,
    allowed_mode: null,
    blocked_actions: [],
    reason: "Tool lane registry preview (no tool selected). Dry-run only: nothing can run.",
    registry: registrySummary,
    n8n_status: n8nStatus,
    safety_flags: safetyFlags(),
  };
}
