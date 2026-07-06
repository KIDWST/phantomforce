import type { HermesLedgerRecord, ProviderRoute } from "./types.js";
import { getHermesLedgerStatus, readHermesLedgerRecords } from "./hermes-ledger.js";
import { inspectInternalHarnessReadiness } from "./internal-harness-router.js";
import { buildToolLanePreview, loadToolRegistry } from "./tool-lane.js";

const DEFAULT_WINDOW_HOURS = 24;

type AgentState = "active" | "standby" | "idle" | "blocked" | "unconfigured";

type WorkerDefinition = {
  id: string;
  name: string;
  role: string;
  tool_binding: string;
  focus: string;
  route?: ProviderRoute;
  taskMatch?: RegExp;
  baseState: AgentState;
};

type AgentRoute =
  | "command"
  | "agents"
  | "security"
  | "site"
  | "access"
  | "offers"
  | "approvals"
  | "media"
  | "connections";

const workerDefinitions: WorkerDefinition[] = [
  {
    id: "phantom-ai",
    name: "PhantomAI",
    role: "Chief operator",
    tool_binding: "dashboard_chat_and_router",
    focus: "Turns asks into drafts, work cards, plans, and next actions.",
    baseState: "active",
  },
  {
    id: "hermes",
    name: "Hermes",
    role: "Memory and receipt keeper",
    tool_binding: "hermes_ledger_context_memory",
    focus: "Tracks local receipts, context, redaction, and memory usage.",
    baseState: "active",
  },
  {
    id: "builder",
    name: "Builder",
    role: "Local app and file worker",
    tool_binding: "codex_local_operator_lane",
    focus: "Handles repo, dashboard, website, and local file work for admin sessions.",
    route: "local",
    baseState: "standby",
  },
  {
    id: "strategist",
    name: "Strategist",
    role: "Deep reasoning lane",
    tool_binding: "glm_5_2_openrouter_lane",
    focus: "Drafts, reasons, critiques, and plans when the admin chooses deep thinking.",
    route: "openrouter_glm",
    baseState: "standby",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Second opinion lane",
    tool_binding: "claude_cli_lane",
    focus: "Reviews product decisions, UI, copy, and implementation plans.",
    route: "claude",
    baseState: "standby",
  },
  {
    id: "gatekeeper",
    name: "Gatekeeper",
    role: "Access and private route guard",
    tool_binding: "pangolin_access_state",
    focus: "Tracks route posture, client access state, and private doorway readiness.",
    taskMatch: /(access|pangolin|gateway|route|client)/i,
    baseState: "unconfigured",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Sales and proposal worker",
    tool_binding: "chicagoshots_pipeline",
    focus: "Organizes leads, proposal packets, quotes, and follow-up status.",
    taskMatch: /(lead|proposal|chicagoshots|sales|quote|follow)/i,
    baseState: "active",
  },
  {
    id: "sentinel",
    name: "Sentinel",
    role: "Security and data scanner",
    tool_binding: "local_security_scanner",
    focus: "Checks copy, uploads, scripts, and secrets before client exposure.",
    taskMatch: /(security|scan|malware|secret|data)/i,
    baseState: "active",
  },
  {
    id: "cutlab",
    name: "CutLab",
    role: "Media workflow worker",
    tool_binding: "phantomcut_media_lab",
    focus: "Keeps video, Media Lab, and ChicagoShots delivery paths organized.",
    taskMatch: /(media|video|phantomcut|higgsfield|chicagoshots)/i,
    baseState: "standby",
  },
];

const subagentDefinitions = [
  { id: "atlas", name: "Atlas", parent: "PhantomAI", specialty: "Breaks vague asks into execution paths." },
  { id: "forge", name: "Forge", parent: "Builder", specialty: "Prepares local code and UI changes." },
  { id: "scribe", name: "Scribe", parent: "Hermes", specialty: "Condenses context, receipts, and summaries." },
  { id: "lens", name: "Lens", parent: "Reviewer", specialty: "Inspects UI, copy, and truth claims." },
  { id: "relay", name: "Relay", parent: "Gatekeeper", specialty: "Maps n8n/Pangolin/tool-lane readiness." },
  { id: "closer", name: "Closer", parent: "Scout", specialty: "Turns leads into quote/follow-up moves." },
  { id: "warden", name: "Warden", parent: "Sentinel", specialty: "Flags secrets, suspicious scripts, and risky uploads." },
  { id: "frame", name: "Frame", parent: "CutLab", specialty: "Keeps video/content workflow proof organized." },
  { id: "spec", name: "Spec", parent: "Builder", specialty: "OpenSpec-style acceptance and implementation boundaries." },
  { id: "standard", name: "Standard", parent: "PhantomAI", specialty: "PhantomOps-style working standards and handoffs." },
  { id: "map", name: "Map", parent: "Builder", specialty: "Serena-style code navigation profile." },
  { id: "swarm", name: "Loopus", parent: "Reviewer", specialty: "Loopus-style squad planning vocabulary, quarantined." },
];

const agentAssignments: Array<{
  id: string;
  owner: string;
  title: string;
  detail: string;
  status: "ready" | "watching" | "blocked" | "drafting";
  action_label: string;
  destination_route: AgentRoute;
  guardrail: string;
}> = [
  {
    id: "command-work",
    owner: "PhantomAI",
    title: "Turn a business ask into an artifact",
    detail: "Use Home to ask for a quote, reply, booking plan, page copy, or next-action packet.",
    status: "ready",
    action_label: "Ask PhantomAI",
    destination_route: "command",
    guardrail: "Drafts and plans stay in-app until Jordan chooses the next move.",
  },
  {
    id: "site-edit",
    owner: "Builder",
    title: "Adjust the website from Phantom",
    detail: "Use Site Studio for public story, offer copy, preview blocks, and launch wording.",
    status: "drafting",
    action_label: "Open Site Studio",
    destination_route: "site",
    guardrail: "Preview only. No deploy or public push from this worker.",
  },
  {
    id: "scan-client-input",
    owner: "Sentinel",
    title: "Scan text, files, or page copy before it touches a client surface",
    detail: "Use Scanner to check malware indicators, secrets, risky files, and injection patterns.",
    status: "ready",
    action_label: "Run Scanner",
    destination_route: "security",
    guardrail: "Local-only preview. No delete, quarantine, upload, or external scan provider.",
  },
  {
    id: "proposal-pipeline",
    owner: "Scout",
    title: "Move leads into proposal and follow-up work",
    detail: "Use Money/Offers to turn packages, pricing, and follow-up status into a sales motion.",
    status: "ready",
    action_label: "Open Money",
    destination_route: "offers",
    guardrail: "No email, payment, invoice, or send action from the worker map.",
  },
  {
    id: "approval-review",
    owner: "Gatekeeper",
    title: "Watch actions that need approval",
    detail: "Use Review for work that can affect booking, sending, access, billing, or client-facing output.",
    status: "watching",
    action_label: "Open Review",
    destination_route: "approvals",
    guardrail: "Approvals are visible; execution routes remain absent unless separately implemented.",
  },
  {
    id: "media-path",
    owner: "CutLab",
    title: "Route media work into PhantomCut and ChicagoShots",
    detail: "Use Video to see where Higgsfield, PhantomCut, and media delivery fit into the workflow.",
    status: "watching",
    action_label: "Open Video",
    destination_route: "media",
    guardrail: "No paid generation or upload from the workforce page.",
  },
];

function nowMs() {
  return Date.now();
}

function parseTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordsSince(records: HermesLedgerRecord[], hours: number, now = nowMs()) {
  const cutoff = now - hours * 60 * 60 * 1000;
  return records.filter((record) => parseTime(record.timestamp) >= cutoff);
}

function sumTokens(records: HermesLedgerRecord[]) {
  return records.reduce((total, record) => total + Math.max(0, record.estimated_tokens || 0), 0);
}

function sumCost(records: HermesLedgerRecord[]) {
  return records.reduce((total, record) => total + Math.max(0, record.estimated_cost_usd ?? 0), 0);
}

function latestTimestamp(records: HermesLedgerRecord[]) {
  return records
    .map((record) => record.timestamp)
    .sort((left, right) => parseTime(right) - parseTime(left))[0] ?? null;
}

function workerRecords(records: HermesLedgerRecord[], worker: WorkerDefinition) {
  if (worker.id === "phantom-ai" || worker.id === "hermes") return records;
  if (worker.route) return records.filter((record) => record.provider_route === worker.route);
  if (worker.taskMatch) {
    return records.filter((record) =>
      worker.taskMatch!.test(`${record.task_type} ${record.user_request_summary} ${record.result_summary}`),
    );
  }
  return [];
}

function stateFromMetrics(definition: WorkerDefinition, tasks24h: number) {
  if (definition.id === "gatekeeper" && tasks24h === 0) return "unconfigured" as const;
  if (tasks24h > 0) return "active" as const;
  return definition.baseState;
}

function buildWorkerMetrics(definition: WorkerDefinition, allRecords: HermesLedgerRecord[]) {
  const all = workerRecords(allRecords, definition);
  const records1h = recordsSince(all, 1);
  const records24h = recordsSince(all, 24);
  const records7d = recordsSince(all, 24 * 7);
  const tokens24h = sumTokens(records24h);

  return {
    id: definition.id,
    name: definition.name,
    role: definition.role,
    tool_binding: definition.tool_binding,
    state: stateFromMetrics(definition, records24h.length),
    focus: definition.focus,
    tasks_last_1h: records1h.length,
    tasks_last_24h: records24h.length,
    tasks_last_7d: records7d.length,
    tokens_last_24h: tokens24h,
    estimated_cost_usd_last_24h: Number(sumCost(records24h).toFixed(6)),
    last_run_at: latestTimestamp(all),
    data_source: definition.id === "gatekeeper" ? "access/tool status + Hermes ledger" : "Hermes ledger",
  };
}

function subagentStatus(parentState: AgentState, tasks24h: number) {
  if (parentState === "active" && tasks24h > 0) return "working";
  if (parentState === "active") return "available";
  if (parentState === "unconfigured") return "waiting";
  return "standby";
}

function buildClientSummary(workers: ReturnType<typeof buildWorkerMetrics>[]) {
  const activeCount = workers.filter((worker) => worker.state === "active").length;

  return {
    visible_to_client: true,
    active_agent_count: activeCount,
    total_agent_count: workers.length,
    status: activeCount > 0 ? "agents_available" : "standing_by",
    label: `${activeCount} worker${activeCount === 1 ? "" : "s"} active`,
  };
}

function labelForRecord(record: HermesLedgerRecord, workers: ReturnType<typeof buildWorkerMetrics>[]) {
  if (record.provider_route === "local") return "Builder";
  if (record.provider_route === "openrouter_glm") return "Strategist";
  if (record.provider_route === "claude") return "Reviewer";

  const text = `${record.task_type} ${record.user_request_summary} ${record.result_summary}`;
  const matched = workers.find((worker) => {
    const definition = workerDefinitions.find((item) => item.id === worker.id);
    return definition?.taskMatch?.test(text);
  });

  return matched?.name ?? "PhantomAI";
}

function buildTicker(records: HermesLedgerRecord[], workers: ReturnType<typeof buildWorkerMetrics>[]) {
  const recentRecords = [...records]
    .sort((left, right) => parseTime(right.timestamp) - parseTime(left.timestamp))
    .slice(0, 8)
    .map((record, index) => ({
      id: `ledger-${index}-${record.timestamp}`,
      label: labelForRecord(record, workers),
      text: `${labelForRecord(record, workers)} logged ${record.task_type.replace(/_/g, " ")} · ${Math.max(
        0,
        record.estimated_tokens || 0,
      )} tokens`,
      timestamp: record.timestamp,
    }));

  return [
    ...recentRecords,
    {
      id: "n8n-status",
      label: "Automation Bay",
      text: "n8n is scaffolded for dry-run workflow drafts; execution is still blocked.",
      timestamp: new Date().toISOString(),
    },
    {
      id: "client-redaction",
      label: "Client View",
      text: "Clients see agent count and outcomes, not internal tools, tokens, or worker plumbing.",
      timestamp: new Date().toISOString(),
    },
  ];
}

function buildProgramUse(toolStack: Array<{
  id: string;
  display_name: string;
  intended_role: string;
  allowed_mode: string;
  state: string;
  blocked_actions_count: number;
  next_phase: string;
}>) {
  const programRoutes: Record<string, AgentRoute> = {
    n8n: "connections",
    openspec: "agents",
    "agent-os": "agents",
    serena: "connections",
    ruflo: "agents",
    "phantom-ai-online-fetch": "connections",
  };
  const actionIds: Record<string, string> = {
    n8n: "n8n-readiness",
    openspec: "openspec-proposal",
    "agent-os": "agent-os-sandbox",
    serena: "serena-readonly-profile",
    ruflo: "ruflo-planning",
    "phantom-ai-online-fetch": "agentlab-preflight",
  };
  const actionLabels: Record<string, string> = {
    n8n: "Check automation bay",
    openspec: "Draft local proposal",
    "agent-os": "Read standards posture",
    serena: "Generate code map profile",
    ruflo: "Check Loopus posture",
    "phantom-ai-online-fetch": "Run AgentLab preflight",
  };
  const currentUse: Record<string, string> = {
    n8n: "Automation draft bay for local workflow plans and inactive workflow JSON.",
    openspec: "Acceptance criteria and implementation-boundary thinking before code changes.",
    "agent-os": "Operating standards for handoffs, constraints, and worker behavior.",
    serena: "Future code navigation profile for worker context.",
    ruflo: "Quarantined Loopus planning vocabulary for future multi-agent work.",
    "phantom-ai-online-fetch": "Planned allowlisted research lane behind Hermes controls.",
  };
  const owner: Record<string, string> = {
    n8n: "Relay",
    openspec: "Spec",
    "agent-os": "Standard",
    serena: "Map",
    ruflo: "Loopus",
    "phantom-ai-online-fetch": "Scout",
  };

  return toolStack.map((tool) => ({
    ...tool,
    manager_agent: owner[tool.id] ?? "PhantomAI",
    current_use: currentUse[tool.id] ?? tool.intended_role,
    action_id: actionIds[tool.id] ?? "tool-registry-audit",
    action_label: actionLabels[tool.id] ?? "Audit tool",
    destination_route: programRoutes[tool.id] ?? "connections",
    commercial_visible: false,
  }));
}

export async function buildAgentWorkforceStatus(options: {
  admin: boolean;
  windowHours?: number;
}) {
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const [ledgerStatus, allRecords, registry, n8nPreview, internalHarness] = await Promise.all([
    getHermesLedgerStatus(),
    readHermesLedgerRecords({ limit: 1000 }),
    loadToolRegistry(),
    buildToolLanePreview({ toolId: "n8n" }),
    inspectInternalHarnessReadiness(),
  ]);
  const recent = recordsSince(allRecords, windowHours);
  const workers = workerDefinitions.map((definition) => buildWorkerMetrics(definition, allRecords));
  const subagents = subagentDefinitions.map((subagent) => {
    const parent = workers.find((worker) => worker.name === subagent.parent);
    const tasks24h = parent ? Math.floor(parent.tasks_last_24h / 2) : 0;
    const tokens24h = parent ? Math.floor(parent.tokens_last_24h / 2) : 0;

    return {
      ...subagent,
      state: subagentStatus(parent?.state ?? "standby", tasks24h),
      tasks_last_24h: tasks24h,
      tokens_last_24h: tokens24h,
    };
  });
  const toolStack = registry.tools.map((tool) => ({
    id: tool.id,
    display_name: tool.display_name,
    intended_role: tool.intended_role,
    allowed_mode: tool.allowed_mode,
    state:
      tool.id === "n8n"
        ? n8nPreview.n8n_status.n8n_running
          ? "running_local"
          : n8nPreview.n8n_status.n8n_scaffolded
            ? "scaffolded_idle"
            : "missing"
        : tool.allowed_mode.includes("reference") || tool.allowed_mode.includes("planning")
          ? "sandbox_reference"
          : "planned",
    blocked_actions_count: tool.blocked_actions.length,
    next_phase: tool.next_phase,
  }));
  const summary = {
    window_hours: windowHours,
    generated_at: new Date().toISOString(),
    ledger_exists: ledgerStatus.exists,
    ledger_bytes: ledgerStatus.bytes,
    tasks_in_window: recent.length,
    tokens_in_window: sumTokens(recent),
    estimated_cost_usd_in_window: Number(sumCost(recent).toFixed(6)),
    active_workers: workers.filter((worker) => worker.state === "active").length,
    total_workers: workers.length,
    subagents_mapped: subagents.length,
    n8n_scaffolded: n8nPreview.n8n_status.n8n_scaffolded,
    n8n_running: n8nPreview.n8n_status.n8n_running,
    tool_registry_loaded: registry.loaded,
    tool_count: registry.tool_count,
    operator_harness_ready: internalHarness.ready_for_internal_use,
    operator_harness_hidden: internalHarness.hidden_infrastructure,
  };
  const clientSummary = buildClientSummary(workers);
  const ticker = buildTicker(allRecords, workers);
  const programs = buildProgramUse(toolStack);

  if (!options.admin) {
    return {
      ok: true,
      role: "client" as const,
      summary: clientSummary,
      details_redacted: true,
      token_usage_visible: false,
      tool_stack_visible: false,
    };
  }

  return {
    ok: true,
    role: "admin" as const,
    summary,
    client_summary: clientSummary,
    workers,
    subagents,
    tool_stack: toolStack,
    assignments: agentAssignments,
    programs,
    ticker,
    n8n: {
      status: n8nPreview.status,
      execution_disabled: n8nPreview.execution_disabled,
      would_run: n8nPreview.would_run,
      local_url: n8nPreview.n8n_status.n8n_local_url,
      scaffolded: n8nPreview.n8n_status.n8n_scaffolded,
      running: n8nPreview.n8n_status.n8n_running,
      workflow_drafts: n8nPreview.n8n_status.workflow_drafts,
    },
    safety_flags: {
      read_only: true,
      provider_called: false,
      external_call_performed: false,
      n8n_started: false,
      workflow_executed: false,
      approval_executed: false,
      queue_written: false,
      production_ledger_written: false,
      internal_harness_customer_visible: false,
      internal_harness_execution_enabled: false,
    },
  };
}
