import type { HermesLedgerRecord, ProviderRoute } from "./types.js";
import { getHermesLedgerStatus, readHermesLedgerRecords } from "./hermes-ledger.js";
import { inspectInternalHarnessReadiness } from "./internal-harness-router.js";
import { buildToolLanePreview, loadToolRegistry } from "./tool-lane.js";
import { getAutomationJobDefinitions } from "./automation-engine.js";
import { getAgentActionDefinitions } from "./agent-actions.js";

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
  {
    id: "autopilot-health",
    name: "Autopilot Health",
    role: "Autonomous system health and readiness",
    tool_binding: "automation_engine_health_lane",
    focus: "Runs scheduled health checks across rembg, ai-proxy, PhantomCut, the tool registry, and the monthly security scanner — read-only, no approval needed.",
    taskMatch: /^automation:health:/,
    baseState: "standby",
  },
  {
    id: "autopilot-ops",
    name: "Autopilot Ops",
    role: "Autonomous business operations",
    tool_binding: "automation_engine_ops_lane",
    focus: "Runs scheduled ops digests — approvals, actions, production readiness, access posture, n8n readiness — read-only.",
    taskMatch: /^automation:ops:/,
    baseState: "standby",
  },
  {
    id: "autopilot-content",
    name: "Autopilot Content",
    role: "Autonomous content and marketing readiness",
    tool_binding: "automation_engine_content_lane",
    focus: "Runs scheduled content/media-engine readiness digests — read-only, never posts or generates.",
    taskMatch: /^automation:content:/,
    baseState: "standby",
  },
];

type SubagentDefinition = {
  id: string;
  name: string;
  parent: string;
  specialty: string;
  rootParent?: string;
  layer?: string;
  taskMatch?: RegExp;
  backingType?: WorkforceBackingType;
};

type WorkforceBackingType =
  | "parent_worker_definition"
  | "curated_subagent_definition"
  | "template_generated_subagent"
  | "template_generated_neural_cell"
  | "automation_job_definition";

type WorkforceRuntimeRole =
  | "ledger_observed_worker"
  | "safe_action_runner"
  | "routable_capability"
  | "mapped_capability"
  | "processing_contract";

type WorkforceNodeContract = {
  responsibility: string;
  inputs: string[];
  outputs: string[];
  upstream: string[];
  downstream: string[];
  permissionBoundary: string;
  failureBehavior: string;
  observability: string;
  value: string;
};

const curatedSubagentDefinitions: SubagentDefinition[] = [
  { id: "atlas", name: "Atlas", parent: "PhantomAI", specialty: "Breaks vague asks into execution paths.", backingType: "curated_subagent_definition" },
  { id: "forge", name: "Forge", parent: "Builder", specialty: "Prepares local code and UI changes.", backingType: "curated_subagent_definition" },
  { id: "scribe", name: "Scribe", parent: "Hermes", specialty: "Condenses context, receipts, and summaries.", backingType: "curated_subagent_definition" },
  { id: "lens", name: "Lens", parent: "Reviewer", specialty: "Inspects UI, copy, and truth claims.", backingType: "curated_subagent_definition" },
  { id: "relay", name: "Relay", parent: "Gatekeeper", specialty: "Maps n8n/Pangolin/tool-lane readiness.", backingType: "curated_subagent_definition" },
  { id: "closer", name: "Closer", parent: "Scout", specialty: "Turns leads into quote/follow-up moves.", backingType: "curated_subagent_definition" },
  { id: "warden", name: "Warden", parent: "Sentinel", specialty: "Flags secrets, suspicious scripts, and risky uploads.", backingType: "curated_subagent_definition" },
  { id: "frame", name: "Frame", parent: "CutLab", specialty: "Keeps video/content workflow proof organized.", backingType: "curated_subagent_definition" },
  { id: "spec", name: "Spec", parent: "Builder", specialty: "OpenSpec-style acceptance and implementation boundaries.", backingType: "curated_subagent_definition" },
  { id: "standard", name: "Standard", parent: "PhantomAI", specialty: "PhantomOps-style working standards and handoffs.", backingType: "curated_subagent_definition" },
  { id: "map", name: "Map", parent: "Builder", specialty: "Serena-style code navigation profile.", backingType: "curated_subagent_definition" },
  { id: "swarm", name: "Swarm", parent: "Reviewer", specialty: "Ruflo-style squad planning vocabulary, quarantined.", backingType: "curated_subagent_definition" },
];

const swarmSubagentTemplates = [
  {
    id: "signal",
    name: "Signal",
    specialty: "Watches incoming context for useful signals, gaps, and next-best routing hints.",
  },
  {
    id: "draft",
    name: "Draft",
    specialty: "Prepares first-pass copy, plans, checklists, or work packets for owner review.",
  },
  {
    id: "qa",
    name: "QA",
    specialty: "Checks the prepared work for missing details, confusing language, and approval-sensitive risk.",
  },
  {
    id: "relay",
    name: "Relay",
    specialty: "Moves handoffs between internal lanes while keeping outside-world actions approval-gated.",
  },
  {
    id: "ledger",
    name: "Ledger",
    specialty: "Tracks what was prepared, what changed, and what still needs human approval.",
  },
  {
    id: "research",
    name: "Research",
    specialty: "Pulls safe local context, docs, and ledger clues before a draft is made.",
  },
  {
    id: "plan",
    name: "Plan",
    specialty: "Breaks work into sequenced, approval-safe steps before it reaches the owner.",
  },
  {
    id: "proof",
    name: "Proof",
    specialty: "Captures receipts, evidence, and the reason a route was chosen.",
  },
  {
    id: "feedback",
    name: "Feedback",
    specialty: "Turns corrections and outcomes into future routing hints without external action.",
  },
] satisfies Array<Pick<SubagentDefinition, "id" | "name" | "specialty">>;

const generatedSwarmSubagentDefinitions: SubagentDefinition[] = workerDefinitions.flatMap((worker) =>
  swarmSubagentTemplates.map((template) => ({
    id: `${worker.id}-${template.id}`,
    name: `${worker.name} ${template.name}`,
    parent: worker.name,
    rootParent: worker.name,
    specialty: template.specialty,
    backingType: "template_generated_subagent",
  })),
);

const neuralCellTemplates = [
  { id: "intake", name: "Intake Cell", layer: "input", specialty: "Classifies the ask, spots missing context, and tags the route." },
  { id: "memory", name: "Memory Cell", layer: "memory", specialty: "Attaches useful local memory, receipts, and workspace context." },
  { id: "rank", name: "Rank Cell", layer: "reasoning", specialty: "Scores urgency, value, risk, and the next useful move." },
  { id: "compose", name: "Compose Cell", layer: "draft", specialty: "Builds the first useful output chunk before review." },
  { id: "verify", name: "Verify Cell", layer: "review", specialty: "Checks claims, labels assumptions, and catches mismatch." },
  { id: "guard", name: "Guard Cell", layer: "safety", specialty: "Keeps outside-world actions behind approval gates." },
  { id: "route", name: "Route Cell", layer: "routing", specialty: "Connects the output to the right workspace or owner packet." },
  { id: "archive", name: "Archive Cell", layer: "ledger", specialty: "Writes the receipt so Phantom remembers the useful parts." },
  { id: "feedback", name: "Feedback Cell", layer: "learning", specialty: "Turns corrections, approvals, and rejects into lower-risk next moves." },
  { id: "health", name: "Health Cell", layer: "health", specialty: "Checks connected tools and blocked/manual modes before work routes." },
] satisfies Array<Pick<SubagentDefinition, "id" | "name" | "layer" | "specialty">>;

const generatedNeuralCellDefinitions: SubagentDefinition[] = generatedSwarmSubagentDefinitions.flatMap((subagent) =>
  neuralCellTemplates.map((template) => ({
    id: `${subagent.id}-${template.id}`,
    name: `${subagent.name} ${template.name}`,
    parent: subagent.name,
    rootParent: subagent.rootParent,
    layer: template.layer,
    specialty: template.specialty,
    backingType: "template_generated_neural_cell",
  })),
);

const AUTOPILOT_PARENT_NAME: Record<string, string> = {
  health: "Autopilot Health",
  ops: "Autopilot Ops",
  content: "Autopilot Content",
};

const automationSubagentDefinitions: SubagentDefinition[] = getAutomationJobDefinitions().map((job) => ({
  id: job.id,
  name: job.name,
  parent: AUTOPILOT_PARENT_NAME[job.category] ?? "PhantomAI",
  specialty: `${job.description} (runs ${job.cadence}).`,
  taskMatch: new RegExp(`^automation:${job.category}:${job.id}$`),
  backingType: "automation_job_definition",
}));

const subagentDefinitions: SubagentDefinition[] = [
  ...curatedSubagentDefinitions,
  ...generatedSwarmSubagentDefinitions,
  ...generatedNeuralCellDefinitions,
  ...automationSubagentDefinitions,
];

const subagentTemplateContracts: Record<string, WorkforceNodeContract> = {
  signal: {
    responsibility: "Detect useful routing signals, gaps, and urgency before work is drafted.",
    inputs: ["current request", "surface/module", "recent ledger summaries"],
    outputs: ["route hints", "missing-context notes", "priority cues"],
    upstream: ["PhantomAI", "Hermes ledger", "context composer"],
    downstream: ["Plan", "Draft", "parent worker"],
    permissionBoundary: "Read-only. Cannot execute outside-world actions.",
    failureBehavior: "If no signal is available, the parent worker continues with normal routing.",
    observability: "Visible through generated topology and parent ledger activity.",
    value: "Reduces repeated intake work and keeps routing consistent.",
  },
  draft: {
    responsibility: "Prepare first-pass copy, plan structure, checklist, or owner-ready packet.",
    inputs: ["route hints", "selected worker lane", "relevant memory/context"],
    outputs: ["draft artifact", "questions", "approval candidate"],
    upstream: ["Signal", "Plan", "parent worker"],
    downstream: ["QA", "Guard", "Review/Approvals"],
    permissionBoundary: "Draft-only. No send, post, upload, deploy, charge, or workflow execution.",
    failureBehavior: "Return a clarification request or blocked draft instead of executing.",
    observability: "Drafts become UI records, approval previews, or ledger events only when a real route creates them.",
    value: "Turns intent into a concrete artifact for the owner to inspect.",
  },
  qa: {
    responsibility: "Check drafts for missing context, bad claims, unclear language, and approval risk.",
    inputs: ["draft artifact", "rules", "brand/context memory"],
    outputs: ["review notes", "risk flags", "needs-change signal"],
    upstream: ["Draft", "Memory Cell", "Guard Cell"],
    downstream: ["Proof", "Review queue", "parent worker"],
    permissionBoundary: "Review-only. Cannot approve or execute.",
    failureBehavior: "Marks the artifact as needs-review rather than passing it as complete.",
    observability: "Appears as review status or approval-gated feedback when the route has a real artifact.",
    value: "Improves quality before work reaches the owner or client-facing surface.",
  },
  relay: {
    responsibility: "Move context between lanes without losing request identity or approval state.",
    inputs: ["route decision", "request id", "artifact metadata"],
    outputs: ["handoff target", "status update"],
    upstream: ["Route Cell", "parent worker"],
    downstream: ["workspace module", "approval queue", "next worker"],
    permissionBoundary: "Handoff-only. Does not start n8n or external workflows.",
    failureBehavior: "Keeps the item in the current workspace with a blocked/missing-integration note.",
    observability: "Handoffs are visible through module records, approval previews, or ledger events.",
    value: "Prevents conflicting ownership and duplicate work.",
  },
  ledger: {
    responsibility: "Record what happened, what changed, and what remains blocked or pending.",
    inputs: ["route result", "worker result", "approval status"],
    outputs: ["receipt summary", "memory candidate", "proof pointer"],
    upstream: ["Proof", "parent worker", "approval queue"],
    downstream: ["Hermes ledger", "Brain memory/context"],
    permissionBoundary: "Metadata-only. No secrets, credentials, cookies, or private payload dumps.",
    failureBehavior: "Return a missing-proof state; never claim completion without a receipt.",
    observability: "Backed by Hermes/Brain event counts and recent ledger rows.",
    value: "Gives future workers proof and context so they do not rediscover the same facts.",
  },
  research: {
    responsibility: "Collect safe local context, known facts, and previous receipts before drafting.",
    inputs: ["request terms", "memory vault", "ledger", "connected local status"],
    outputs: ["verified context notes", "source hints", "unknowns"],
    upstream: ["PhantomAI", "Hermes", "Memory Cell"],
    downstream: ["Plan", "Draft", "Verify Cell"],
    permissionBoundary: "Local/read-only unless a separate approved research lane exists.",
    failureBehavior: "Labels missing sources instead of inventing facts.",
    observability: "Shown as context/debug reasons in Brain preview or route metadata.",
    value: "Improves accuracy and avoids repeated setup questions.",
  },
  plan: {
    responsibility: "Sequence the work into safe steps and identify what needs approval.",
    inputs: ["intent", "research notes", "permission mode", "available tools"],
    outputs: ["step plan", "risk split", "required handoffs"],
    upstream: ["Signal", "Research", "Guard Cell"],
    downstream: ["Draft", "Relay", "Approval queue"],
    permissionBoundary: "Plan-only; cannot execute planned steps.",
    failureBehavior: "Returns a blocked dependency or clarification instead of proceeding silently.",
    observability: "Plans are visible as draft packets, approval previews, or Brain context reasons.",
    value: "Makes complex work safer and easier for downstream workers.",
  },
  proof: {
    responsibility: "Attach evidence, receipt pointers, and validation notes to completed or blocked work.",
    inputs: ["worker output", "validation result", "tool health", "ledger metadata"],
    outputs: ["proof record", "completion/blocked reason"],
    upstream: ["QA", "Verify Cell", "Health Cell"],
    downstream: ["Ledger", "owner-facing status"],
    permissionBoundary: "Proof-only; cannot mark live external work complete without transport proof.",
    failureBehavior: "Keeps work in preview/blocked state when proof is missing.",
    observability: "Proof appears in ledger summaries or status cards.",
    value: "Prevents fake success states and makes outcomes auditable.",
  },
  feedback: {
    responsibility: "Convert explicit corrections and outcomes into low-risk future routing hints.",
    inputs: ["owner correction", "approval/rejection outcome", "useful/not-useful signal"],
    outputs: ["memory suggestion", "profile hint", "avoidance note"],
    upstream: ["owner feedback", "Approval queue", "Brain memory"],
    downstream: ["Context composer", "Memory vault"],
    permissionBoundary: "No sensitive profiling; no secret storage; owner can forget/edit memory.",
    failureBehavior: "Stores only low-confidence suggestions unless explicitly remembered.",
    observability: "Visible in Brain recent learnings and memory vault.",
    value: "Helps Phantom stop repeating known mistakes.",
  },
};

const neuralCellContracts: Record<string, WorkforceNodeContract> = {
  intake: {
    responsibility: "Classify the request and tag the business lane.",
    inputs: ["current message", "surface/module", "session role"],
    outputs: ["intent label", "lane tags", "missing context"],
    upstream: ["PhantomAI chat/router"],
    downstream: ["Signal", "Route Cell"],
    permissionBoundary: "Classification only; no side effects.",
    failureBehavior: "Falls back to conversational clarification.",
    observability: "Context preview and route debug reasons.",
    value: "Keeps casual chat separate from work creation.",
  },
  memory: {
    responsibility: "Attach relevant memory and previous receipts selectively.",
    inputs: ["intent", "memory vault", "Hermes ledger"],
    outputs: ["compact context", "memory reasons"],
    upstream: ["Brain memory", "Hermes"],
    downstream: ["Research", "Draft", "Verify"],
    permissionBoundary: "Tenant/session scoped; no secrets.",
    failureBehavior: "Continues with no-memory context and labels the absence.",
    observability: "Brain context preview shows selected memories.",
    value: "Prevents repeated rediscovery and keeps work personalized.",
  },
  rank: {
    responsibility: "Score urgency, value, risk, and next-best action.",
    inputs: ["intent", "memory/context", "approval state"],
    outputs: ["priority score", "risk level", "next action"],
    upstream: ["Signal", "Memory"],
    downstream: ["Plan", "Guard"],
    permissionBoundary: "Recommendation only.",
    failureBehavior: "Defaults to owner review when risk is uncertain.",
    observability: "Risk/approval fields in Brain context pack.",
    value: "Helps the router pick useful work instead of noisy work.",
  },
  compose: {
    responsibility: "Prepare the first useful output chunk.",
    inputs: ["plan", "context", "style rules"],
    outputs: ["draft text", "artifact shell", "clarifying question"],
    upstream: ["Plan", "Memory", "Research"],
    downstream: ["Verify", "QA"],
    permissionBoundary: "Draft-only.",
    failureBehavior: "Asks for missing details or returns a partial draft.",
    observability: "Draft artifacts or chat response summary.",
    value: "Turns routing into something the owner can use.",
  },
  verify: {
    responsibility: "Check claims, assumptions, and route fit.",
    inputs: ["draft", "source/context notes", "known tool status"],
    outputs: ["validation result", "assumption labels"],
    upstream: ["Compose", "Research", "Health"],
    downstream: ["QA", "Proof"],
    permissionBoundary: "Review-only.",
    failureBehavior: "Blocks or labels uncertain claims.",
    observability: "Review notes and proof status.",
    value: "Raises accuracy and catches hallucinated capabilities.",
  },
  guard: {
    responsibility: "Apply approval and permission boundaries.",
    inputs: ["proposed action", "risk level", "session role"],
    outputs: ["approval required", "blocked/allowed mode"],
    upstream: ["Rank", "Plan", "Approval policy"],
    downstream: ["Relay", "Approval queue"],
    permissionBoundary: "Can block; cannot execute.",
    failureBehavior: "Blocks risky actions by default.",
    observability: "Approval flags and blocked action reasons.",
    value: "Preserves impulse control for outside-world actions.",
  },
  route: {
    responsibility: "Select the workspace or worker lane that should receive the artifact.",
    inputs: ["intent", "approval status", "tool health"],
    outputs: ["destination route", "handoff packet"],
    upstream: ["Intake", "Guard", "Health"],
    downstream: ["Relay", "workspace module"],
    permissionBoundary: "Routing only; no execution.",
    failureBehavior: "Keeps work in chat with missing-integration note.",
    observability: "Open route/card in the UI.",
    value: "Connects the brain to hands and feet.",
  },
  archive: {
    responsibility: "Write the receipt/memory candidate for useful outcomes.",
    inputs: ["result", "proof", "approval status"],
    outputs: ["ledger event", "memory suggestion"],
    upstream: ["Proof", "Feedback"],
    downstream: ["Hermes", "Brain memory"],
    permissionBoundary: "Summary metadata only; no credentials.",
    failureBehavior: "Does not claim durable memory when write fails.",
    observability: "Ledger/event counts.",
    value: "Makes future work faster and more grounded.",
  },
  feedback: {
    responsibility: "Learn from corrections and approvals without retraining model weights.",
    inputs: ["explicit feedback", "approval outcome", "repeated failure pattern"],
    outputs: ["low-confidence profile hint", "memory suggestion"],
    upstream: ["owner feedback", "Review queue"],
    downstream: ["Context composer", "Memory vault"],
    permissionBoundary: "Business/operator preferences only.",
    failureBehavior: "Requires reinforcement before becoming strong permanent memory.",
    observability: "Brain recent learnings.",
    value: "Reduces repeated mistakes and robotic output.",
  },
  health: {
    responsibility: "Check whether required tools are connected, manual, or blocked.",
    inputs: ["tool registry", "ai-proxy health", "rembg status", "n8n preview"],
    outputs: ["health/readiness state", "blocked dependency reason"],
    upstream: ["Tool spine", "media/backend status"],
    downstream: ["Route", "Guard", "owner status"],
    permissionBoundary: "Read-only health checks.",
    failureBehavior: "Pauses work or marks manual mode instead of pretending connectivity.",
    observability: "System Brain Health and Developer Control Room.",
    value: "Prevents dead-end routes and fake connected states.",
  },
};

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
    backing_type: "parent_worker_definition" as const,
    runtime_role: "ledger_observed_worker" as const,
    executable: false,
    routable: Boolean(definition.route || definition.taskMatch || definition.id === "phantom-ai" || definition.id === "hermes"),
    metric_source: "Hermes ledger records matched to route/task patterns",
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

function backingTypeForSubagent(subagent: SubagentDefinition): WorkforceBackingType {
  if (subagent.backingType) return subagent.backingType;
  return subagent.layer ? "template_generated_neural_cell" : "curated_subagent_definition";
}

function templateIdFromSubagentId(subagent: SubagentDefinition) {
  if (subagent.backingType === "template_generated_neural_cell") {
    return subagent.id.split("-").pop() ?? "";
  }
  if (subagent.backingType === "template_generated_subagent") {
    return subagent.id.split("-").pop() ?? "";
  }
  return subagent.id;
}

function contractForSubagent(subagent: SubagentDefinition): WorkforceNodeContract {
  if (subagent.backingType === "template_generated_neural_cell") {
    return neuralCellContracts[templateIdFromSubagentId(subagent)] ?? {
      responsibility: subagent.specialty,
      inputs: ["parent subagent context"],
      outputs: ["mapped cell signal"],
      upstream: [subagent.parent],
      downstream: [subagent.rootParent ?? subagent.parent],
      permissionBoundary: "Mapped processing contract only.",
      failureBehavior: "Parent route continues without this mapped cell.",
      observability: "Visible in topology only unless a real ledger event references it.",
      value: "Documents the expected processing step for this lane.",
    };
  }

  if (subagent.backingType === "template_generated_subagent") {
    return subagentTemplateContracts[templateIdFromSubagentId(subagent)] ?? {
      responsibility: subagent.specialty,
      inputs: ["parent worker context"],
      outputs: ["mapped subagent signal"],
      upstream: [subagent.parent],
      downstream: [subagent.rootParent ?? subagent.parent],
      permissionBoundary: "Mapped capability only.",
      failureBehavior: "Parent route continues without this mapped subagent.",
      observability: "Visible in topology only unless a real ledger event references it.",
      value: "Documents the expected helper lane for this parent worker.",
    };
  }

  return {
    responsibility: subagent.specialty,
    inputs: ["matched request", "parent worker context", "Hermes/tool state where available"],
    outputs: ["capability-specific route hint", "safe action preview", "status note"],
    upstream: [subagent.parent],
    downstream: [subagent.rootParent ?? subagent.parent, "owner-visible workspace"],
    permissionBoundary: "Cannot execute outside-world actions. Uses safe actions only when explicitly invoked by an admin.",
    failureBehavior: "Returns unavailable/blocked status or no-op preview.",
    observability: "Safe action output, tool registry status, or Hermes ledger records.",
    value: "Names a concrete helper capability without pretending it is an independent autonomous worker.",
  };
}

function runtimeRoleForSubagent(subagent: SubagentDefinition): WorkforceRuntimeRole {
  if (subagent.backingType === "template_generated_neural_cell") return "processing_contract";
  if (subagent.backingType === "template_generated_subagent") return "mapped_capability";
  if (subagent.backingType === "automation_job_definition") return "routable_capability";
  return "routable_capability";
}

function subagentState(backingType: WorkforceBackingType, parentState: string, tasks24h: number) {
  if (tasks24h > 0) return "observed";
  if (backingType === "template_generated_neural_cell") return "mapped_cell";
  if (backingType === "template_generated_subagent") return parentState === "unconfigured" ? "blocked_by_parent" : "mapped";
  if (backingType === "automation_job_definition") return "scheduled_definition";
  return parentState === "unconfigured" ? "blocked_by_parent" : "defined";
}

function buildClientSummary(workers: ReturnType<typeof buildWorkerMetrics>[]) {
  const runtimeSignalCount = workers.filter((worker) => worker.tasks_last_24h > 0).length;
  const mappedCount = workers.length;

  return {
    visible_to_client: true,
    active_agent_count: runtimeSignalCount,
    total_agent_count: mappedCount,
    status: runtimeSignalCount > 0 ? "ledger_activity_observed" : "routes_mapped",
    label: runtimeSignalCount > 0
      ? `${runtimeSignalCount} worker ledger signal${runtimeSignalCount === 1 ? "" : "s"}`
      : `${mappedCount} support route${mappedCount === 1 ? "" : "s"} mapped`,
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
    ruflo: "Check planning posture",
    "phantom-ai-online-fetch": "Run AgentLab preflight",
  };
  const currentUse: Record<string, string> = {
    n8n: "Automation draft bay for local workflow plans and inactive workflow JSON.",
    openspec: "Acceptance criteria and implementation-boundary thinking before code changes.",
    "agent-os": "Operating standards for handoffs, constraints, and worker behavior.",
    serena: "Future code navigation profile for worker context.",
    ruflo: "Quarantined squad-planning vocabulary for future multi-agent work.",
    "phantom-ai-online-fetch": "Planned allowlisted research lane behind Hermes controls.",
  };
  const owner: Record<string, string> = {
    n8n: "Relay",
    openspec: "Spec",
    "agent-os": "Standard",
    serena: "Map",
    ruflo: "Swarm",
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

function buildWorkforceRequestTraces() {
  return [
    {
      id: "casual-chat",
      request: "hey",
      entry_point: "POST /phantom-ai/chat or local command router",
      intent_classification: "conversation",
      context_memory: "Brain context composer may add tone/preference memory; no worker task is created.",
      worker_selection: "PhantomAI only",
      permission_evaluation: "not approval-gated",
      output: "short conversational response",
      proof: "Brain event/chat response summary only when backend chat is used.",
      audit_result: "No generated subagent or cell is marked active from casual chat alone.",
    },
    {
      id: "business-task",
      request: "draft a proposal / build a landing page",
      entry_point: "Dashboard chat or workspace module",
      intent_classification: "task/draft",
      context_memory: "Hermes/Brain memory selects relevant project and style context.",
      worker_selection: "Parent worker category such as Builder, Scout, or CutLab; generated subagents provide the contract map.",
      permission_evaluation: "draft-only until owner approval is needed",
      output: "draft artifact or approval preview",
      proof: "Hermes/Brain event if backend route is used; local UI activity if frontend-only.",
      audit_result: "Mapped cells describe the route, but executable work is still only through real app routes/actions.",
    },
    {
      id: "media-generation",
      request: "generate/edit image or video",
      entry_point: "Media Lab",
      intent_classification: "media",
      context_memory: "Media settings, Content Hub assets, ai-proxy/media health, rembg status.",
      worker_selection: "CutLab/Media lane",
      permission_evaluation: "paid/provider generation remains approval/configuration gated",
      output: "generated media, pending item, or blocked/manual-state message",
      proof: "Media Lab job log and Content Hub asset when generated locally/through configured backend.",
      audit_result: "If media provider is unavailable, Health/Guard contracts require blocked/manual state instead of fake success.",
    },
    {
      id: "external-action",
      request: "send/post/upload/deploy/spend",
      entry_point: "Chat, approval preview, or workspace action",
      intent_classification: "approval_required_action",
      context_memory: "Approval strictness and action safety rules",
      worker_selection: "Gatekeeper/Guard/Approval queue",
      permission_evaluation: "approval required; execution endpoints remain absent/blocked unless separately implemented",
      output: "draft/preview/approval queue item",
      proof: "Approval preview/queue record, not an execution receipt",
      audit_result: "No worker, subagent, or cell can bypass approval.",
    },
    {
      id: "vacation-mode",
      request: "turn on vacation mode / handle away coverage",
      entry_point: "Vacation Mode route",
      intent_classification: "away_coverage",
      context_memory: "Vacation settings, automations, approval policy",
      worker_selection: "Autopilot categories and automation job definitions",
      permission_evaluation: "only granted safe/prep work proceeds; external actions queue approval",
      output: "away coverage status, reports, or approvals",
      proof: "Vacation activity records and automation ledger events",
      audit_result: "Autonomous behavior is limited to configured read-only/prep jobs.",
    },
    {
      id: "memory-context",
      request: "use my brand voice / remember this",
      entry_point: "Brain endpoints or chat feedback",
      intent_classification: "memory_or_context",
      context_memory: "Memory vault, behavioral profile, Hermes ledger",
      worker_selection: "Hermes/Scribe/Memory Cell contract",
      permission_evaluation: "tenant scoped; secrets excluded; editable/forgettable",
      output: "context pack, memory suggestion, or saved memory",
      proof: "Brain memory/event record",
      audit_result: "Memory cells are contract nodes that influence context composer output.",
    },
    {
      id: "missing-integration",
      request: "run n8n / use unavailable provider",
      entry_point: "Tool lane, Media Lab, Developer Control Room",
      intent_classification: "blocked_dependency",
      context_memory: "Tool registry and health checks",
      worker_selection: "Relay/Health/Guard",
      permission_evaluation: "blocked or scaffolded/manual; no startup or workflow execution",
      output: "readiness state and next safe step",
      proof: "Tool lane preview/status payload",
      audit_result: "Unavailable integrations must stay blocked/scaffolded rather than being displayed as live.",
    },
  ];
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
  const safeActions = getAgentActionDefinitions();
  const subagents = subagentDefinitions.map((subagent) => {
    const parent = workers.find((worker) => worker.name === subagent.parent)
      ?? workers.find((worker) => worker.name === subagent.rootParent);
    const backingType = backingTypeForSubagent(subagent);
    const contract = contractForSubagent(subagent);
    const runtimeRole = runtimeRoleForSubagent(subagent);

    if (subagent.taskMatch) {
      const matched = allRecords.filter((record) => subagent.taskMatch!.test(record.task_type));
      const records24h = recordsSince(matched, 24);
      const state = subagentState(backingType, parent?.state ?? "standby", records24h.length);

      return {
        id: subagent.id,
        name: subagent.name,
        parent: subagent.parent,
        root_parent: subagent.rootParent ?? subagent.parent,
        layer: subagent.layer ?? "subagent",
        specialty: subagent.specialty,
        backing_type: backingType,
        runtime_role: runtimeRole,
        executable: safeActions.some((action) => action.worker === subagent.name),
        routable: true,
        template_generated: backingType === "template_generated_subagent" || backingType === "template_generated_neural_cell",
        independent_runtime: false,
        metric_source: records24h.length > 0 ? "Hermes ledger records matched by task type" : "definition only; no matching ledger record in window",
        contract,
        state,
        tasks_last_24h: records24h.length,
        tokens_last_24h: sumTokens(records24h),
        last_run_at: latestTimestamp(matched),
      };
    }

    const hasExecutableAction = safeActions.some((action) => action.worker === subagent.name);

    return {
      id: subagent.id,
      name: subagent.name,
      parent: subagent.parent,
      root_parent: subagent.rootParent ?? subagent.parent,
      layer: subagent.layer ?? "subagent",
      specialty: subagent.specialty,
      backing_type: backingType,
      runtime_role: hasExecutableAction ? "safe_action_runner" : runtimeRole,
      executable: hasExecutableAction,
      routable: backingType !== "template_generated_neural_cell",
      template_generated: backingType === "template_generated_subagent" || backingType === "template_generated_neural_cell",
      independent_runtime: false,
      metric_source: "definition/topology only; no synthetic task or token count assigned",
      contract,
      state: subagentState(backingType, parent?.state ?? "standby", 0),
      tasks_last_24h: 0,
      tokens_last_24h: 0,
      last_run_at: null,
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
    runtime_active_workers: workers.filter((worker) => worker.tasks_last_24h > 0).length,
    parent_workers: workers.length,
    total_workers: workers.length,
    subagents_mapped: subagents.length,
    total_worker_nodes: workers.length + subagents.length,
    total_mapped_nodes: workers.length + subagents.length,
    executable_nodes: workers.filter((worker) => worker.executable).length + subagents.filter((subagent) => subagent.executable).length,
    runtime_executable_actions: safeActions.length,
    routable_nodes: workers.filter((worker) => worker.routable).length + subagents.filter((subagent) => subagent.routable).length,
    active_runtime_instances: workers.filter((worker) => worker.tasks_last_24h > 0).length
      + subagents.filter((subagent) => subagent.tasks_last_24h > 0).length,
    parent_worker_definitions: workers.length,
    curated_subagent_definitions: curatedSubagentDefinitions.length,
    generated_subagent_instances: generatedSwarmSubagentDefinitions.length,
    neural_cells_mapped: generatedNeuralCellDefinitions.length,
    generated_neural_cell_instances: generatedNeuralCellDefinitions.length,
    automation_job_definitions: automationSubagentDefinitions.length,
    template_definitions: swarmSubagentTemplates.length + neuralCellTemplates.length,
    template_generated_nodes: generatedSwarmSubagentDefinitions.length + generatedNeuralCellDefinitions.length,
    swarm_subagent_templates: swarmSubagentTemplates.length,
    neural_cell_templates: neuralCellTemplates.length,
    worker_node_floor: 1000,
    generated_nodes_independently_executable: false,
    truth_label: "Mapped workforce topology; generated cells are processing contracts, not autonomous running workers.",
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
    node_truth: {
      total_mapped_nodes: summary.total_mapped_nodes,
      parent_worker_definitions: summary.parent_worker_definitions,
      curated_subagent_definitions: summary.curated_subagent_definitions,
      generated_subagent_instances: summary.generated_subagent_instances,
      generated_neural_cell_instances: summary.generated_neural_cell_instances,
      automation_job_definitions: summary.automation_job_definitions,
      template_definitions: summary.template_definitions,
      template_generated_nodes: summary.template_generated_nodes,
      executable_nodes: summary.executable_nodes,
      runtime_executable_actions: summary.runtime_executable_actions,
      active_runtime_instances: summary.active_runtime_instances,
      routable_nodes: summary.routable_nodes,
      generated_nodes_independently_executable: false,
      label: summary.truth_label,
    },
    contracts: {
      subagent_templates: subagentTemplateContracts,
      neural_cells: neuralCellContracts,
    },
    request_traces: buildWorkforceRequestTraces(),
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
