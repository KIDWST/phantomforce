/* PhantomForce agent-run lifecycle.
   ONE execution engine for everything Phantom does on the server.

   Low-risk internal operations (read org data, compile reports) run
   automatically:  queued → executing → verifying → completed.

   External actions (publish a site, send, deploy…) NEVER run silently:
   awaiting_approval → approved → queued → executing → verifying →
   succeeded | partially_succeeded, or rejected / expired / cancelled /
   failed along the way. Approval is recorded with the requesting user, the
   approving user, a deadline, and an execution receipt; never_silent
   operations require approval regardless of any org policy.

   Every transition is persisted to .phantom/agent-runs.jsonl (runs are
   rehydrated at boot so approvals survive restarts), artifacts land on
   disk, and completed runs write a Hermes ledger proof entry. Nothing here
   simulates success or calls paid providers. */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listAutomationJobs } from "./automation-engine.js";
import { getProviderReadinessReport } from "./provider-readiness.js";
import { appendHermesLedgerRecord, readHermesLedgerRecords, redactSensitiveText, redactPersonalDataText } from "./hermes-ledger.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const RUNS_LOG_PATH = resolve(repoRoot, ".phantom", "agent-runs.jsonl");
const ARTIFACTS_DIR = resolve(repoRoot, ".phantom", "artifacts");

const DEFAULT_APPROVAL_DEADLINE_MS = Number(process.env.PHANTOM_RUN_APPROVAL_DEADLINE_MS ?? 24 * 60 * 60 * 1000);

export type AgentRunState =
  | "draft"
  | "planned"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "queued"
  | "executing"
  | "verifying"
  | "completed"            /* legacy terminal success for low-risk internal ops */
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled";

export const TERMINAL_AGENT_RUN_STATES: ReadonlySet<AgentRunState> = new Set([
  "completed", "succeeded", "partially_succeeded", "failed", "cancelled", "rejected", "expired",
]);

export type AgentRunRiskClass = "low_internal" | "external_approval" | "never_silent";

export type AgentRunEvent = {
  at: string;
  state?: AgentRunState;
  note: string;
};

export type AgentRunArtifact = {
  kind: "markdown" | "json" | "html";
  path: string;
  summary: string;
};

export type AgentRunReceipt = {
  operation: string;
  requested_by: string;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string;
  inputs: Record<string, unknown>;
  scope: string;
  expected_effect: string;
  actual_effect: string;
  cost_estimate_usd: number | null;
  rollback_guidance: string | null;
};

export type AgentRun = {
  id: string;
  operation: string;
  title: string;
  workspace: string;
  session_id: string;
  request: string;
  state: AgentRunState;
  risk: AgentRunRiskClass;
  required_role: "org_manager" | "super_admin";
  inputs: Record<string, unknown>;
  scope: string;
  expected_effect: string;
  cost_estimate_usd: number | null;
  requested_by: string;
  approval_deadline: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  events: AgentRunEvent[];
  artifacts: AgentRunArtifact[];
  receipt: AgentRunReceipt | null;
  error: string | null;
  proof_request_id: string | null;
  cancel_requested: boolean;
};

type ExecutorContext = {
  run: AgentRun;
  progress: (note: string) => Promise<void>;
  isCancelled: () => boolean;
};

export type AgentRunExecutor = {
  title: string;
  description: string;
  risk: AgentRunRiskClass;
  requiredRole: "org_manager" | "super_admin";
  scope: string;
  expectedEffect: string;
  costEstimateUsd?: number | null;
  rollbackGuidance?: string;
  execute: (ctx: ExecutorContext) => Promise<{
    artifacts: AgentRunArtifact[];
    summary: string;
    partial?: boolean;
    actualEffect?: string;
  }>;
  verify: (ctx: ExecutorContext, artifacts: AgentRunArtifact[]) => Promise<{ ok: boolean; detail: string }>;
};

const runs = new Map<string, AgentRun>();

function nowIso() {
  return new Date().toISOString();
}

function runId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function persistRun(run: AgentRun) {
  await mkdir(dirname(RUNS_LOG_PATH), { recursive: true });
  await appendFile(RUNS_LOG_PATH, `${JSON.stringify({ type: "run", run })}\n`, "utf8");
}

async function transition(run: AgentRun, state: AgentRunState, note: string) {
  run.state = state;
  run.updated_at = nowIso();
  run.events.push({ at: run.updated_at, state, note });
  await persistRun(run);
}

async function writeArtifact(run: AgentRun, name: string, content: string, summary: string): Promise<AgentRunArtifact> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const path = resolve(ARTIFACTS_DIR, `${run.id}-${name}.md`);
  await writeFile(path, content, "utf8");
  return { kind: "markdown", path, summary };
}

/* Rehydrate persisted runs at boot so approval queues survive restarts.
   Runs that were mid-flight when the process died are honestly failed.

   Guarded by a cached PROMISE, not a boolean: this module kicks off one
   fire-and-forget call to this function at load time (see the bottom of
   this file), and index.ts's own startup separately `await`s it to make
   sure rehydration has actually finished before the server takes traffic.
   A boolean guard alone is not safe for that: the first call would flip
   the flag to true synchronously and then start its (still-pending) file
   read, so a second, concurrent caller would see the flag already set and
   return immediately -- appearing "done" while the real read was still in
   flight, and getAgentRun()/listAgentRuns() would answer from a Map that
   had not been rehydrated yet. Caching the promise itself means every
   caller, no matter how many times or how soon they call this, awaits the
   exact same underlying completion. */
let rehydratePromise: Promise<void> | null = null;
export function rehydrateAgentRuns(): Promise<void> {
  if (!rehydratePromise) {
    rehydratePromise = rehydrateAgentRunsOnce();
  }
  return rehydratePromise;
}

async function rehydrateAgentRunsOnce() {
  try {
    const raw = await readFile(RUNS_LOG_PATH, "utf8");
    const latest = new Map<string, AgentRun>();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; run?: AgentRun };
        if (parsed.type === "run" && parsed.run?.id) latest.set(parsed.run.id, parsed.run);
      } catch { /* skip corrupt line */ }
    }
    for (const run of latest.values()) {
      /* backfill fields for runs recorded before the approval lifecycle */
      run.risk = run.risk ?? "low_internal";
      run.required_role = run.required_role ?? "super_admin";
      run.inputs = run.inputs ?? {};
      run.scope = run.scope ?? "server";
      run.expected_effect = run.expected_effect ?? "";
      run.cost_estimate_usd = run.cost_estimate_usd ?? null;
      run.requested_by = run.requested_by ?? run.session_id;
      run.approval_deadline = run.approval_deadline ?? null;
      run.approved_by = run.approved_by ?? null;
      run.approved_at = run.approved_at ?? null;
      run.rejected_by = run.rejected_by ?? null;
      run.rejected_at = run.rejected_at ?? null;
      run.rejection_reason = run.rejection_reason ?? null;
      run.receipt = run.receipt ?? null;
      if (["queued", "executing", "verifying", "approved"].includes(run.state)) {
        run.state = "failed";
        run.error = "server_restarted_mid_run";
        run.updated_at = nowIso();
        run.events.push({ at: run.updated_at, state: "failed", note: "Server restarted while this run was in flight." });
      }
      runs.set(run.id, run);
    }
  } catch { /* no journal yet */ }
}
void rehydrateAgentRuns();

/* Lazy expiry: an approval that outlived its deadline can never execute. */
function applyExpiry(run: AgentRun) {
  if (run.state === "awaiting_approval" && run.approval_deadline && Date.parse(run.approval_deadline) < Date.now()) {
    run.state = "expired";
    run.updated_at = nowIso();
    run.events.push({ at: run.updated_at, state: "expired", note: "Approval deadline passed; the run can no longer execute." });
    void persistRun(run);
  }
  return run;
}

/* ---------------- executors: real work only ---------------- */

const EXECUTORS: Record<string, AgentRunExecutor> = {
  business_snapshot: {
    title: "Business snapshot report",
    description: "Compiles a real operational report from live server state: automation results, recent Hermes proof entries, and provider readiness. No provider calls, no spend.",
    risk: "low_internal",
    requiredRole: "super_admin",
    scope: "server state (read-only)",
    expectedEffect: "A markdown report artifact on disk; nothing external.",
    async execute({ run, progress, isCancelled }) {
      await progress("Reading automation engine state…");
      const jobs = await listAutomationJobs();
      if (isCancelled()) throw new Error("cancelled");

      await progress("Reading recent Hermes ledger proof entries…");
      const ledger = await readHermesLedgerRecords({ limit: 15 });
      if (isCancelled()) throw new Error("cancelled");

      await progress("Checking provider readiness…");
      const providers = getProviderReadinessReport();

      const enabledJobs = jobs.filter((j) => j.enabled);
      const failing = jobs.filter((j) => j.last_status === "error");
      const lines = [
        `# Business snapshot — ${run.workspace}`,
        ``,
        `Generated ${nowIso()} by run ${run.id}. Every figure below is read from real server state; nothing is estimated or simulated.`,
        ``,
        `## Automations`,
        `- ${enabledJobs.length} of ${jobs.length} scheduled jobs enabled`,
        `- ${failing.length} job(s) currently reporting errors${failing.length ? `: ${failing.map((j) => j.name).join(", ")}` : ""}`,
        ...jobs.slice(0, 15).map((j) => `- ${j.name}: ${j.last_status ?? "never run"}${j.last_summary ? ` — ${redactPersonalDataText(String(j.last_summary)).slice(0, 140)}` : ""}`),
        ``,
        `## Recent activity (Hermes ledger, last ${ledger.length})`,
        ...ledger.slice(-10).map((r) => `- ${r.timestamp} · ${r.task_type} · ${redactPersonalDataText(r.result_summary || r.user_request_summary || "").slice(0, 120)}`),
        ``,
        `## AI provider readiness`,
        `- Router mode: ${providers.router_mode}`,
        `- Live routes configured: ${providers.any_live_route_configured ? "yes" : "no"}`,
        ...providers.routes.slice(0, 8).map((route) => `- ${route.id}: ${route.configured ? "configured" : "not configured"}${route.disabled_reason ? ` (${String(route.disabled_reason).slice(0, 90)})` : ""}`),
        ``,
        `_Proof: this run and its artifact are recorded in the Hermes ledger under request ${run.id}._`,
      ];
      const artifact = await writeArtifact(run, "snapshot", lines.join("\n"),
        `${enabledJobs.length}/${jobs.length} automations enabled · ${failing.length} failing · ${ledger.length} ledger entries · live providers ${providers.any_live_route_configured ? "configured" : "not configured"}`);
      return { artifacts: [artifact], summary: artifact.summary };
    },
    async verify(_ctx, artifacts) {
      /* real verification: the artifact must exist on disk and contain every
         required section — not just "the function returned" */
      try {
        const content = await readFile(artifacts[0].path, "utf8");
        const required = ["# Business snapshot", "## Automations", "## Recent activity", "## AI provider readiness"];
        const missing = required.filter((h) => !content.includes(h));
        return missing.length
          ? { ok: false, detail: `artifact missing sections: ${missing.join(", ")}` }
          : { ok: true, detail: `artifact verified on disk (${content.length} chars, all sections present)` };
      } catch (error) {
        return { ok: false, detail: `artifact unreadable: ${String((error as Error).message)}` };
      }
    },
  },

  provider_health: {
    title: "AI provider health check",
    description: "Reports which chat provider lanes are actually usable right now, from the real readiness probes. No provider calls, no spend.",
    risk: "low_internal",
    requiredRole: "super_admin",
    scope: "server state (read-only)",
    expectedEffect: "A markdown report artifact on disk; nothing external.",
    async execute({ run, progress }) {
      await progress("Running provider readiness probes…");
      const report = getProviderReadinessReport();
      const lines = [
        `# Provider health — ${nowIso()}`,
        ``,
        `Run ${run.id}. Read from the live readiness report; no providers were called and nothing was spent.`,
        ``,
        ...report.routes.map((route) => `- **${route.id}**: ${route.configured ? "configured" : "not configured"}${route.setup_required ? " · setup required" : ""}${route.disabled_reason ? ` · ${String(route.disabled_reason).slice(0, 110)}` : ""}`),
        ``,
        `Recommended route: ${report.recommended_route}. Live providers globally ${report.live_providers_globally_enabled ? "enabled" : "disabled"}.`,
      ];
      const artifact = await writeArtifact(run, "providers", lines.join("\n"),
        `${report.routes.filter((r) => r.configured).length}/${report.routes.length} routes configured · recommended: ${report.recommended_route}`);
      return { artifacts: [artifact], summary: artifact.summary };
    },
    async verify(_ctx, artifacts) {
      try {
        const content = await readFile(artifacts[0].path, "utf8");
        return content.includes("# Provider health") && content.includes("Recommended route:")
          ? { ok: true, detail: `artifact verified on disk (${content.length} chars)` }
          : { ok: false, detail: "artifact missing expected content" };
      } catch (error) {
        return { ok: false, detail: `artifact unreadable: ${String((error as Error).message)}` };
      }
    },
  },
};

/* External modules (e.g. the site publishing pipeline) register their
   executors here — one engine, no parallel architectures. */
export function registerAgentRunExecutor(operation: string, executor: AgentRunExecutor) {
  if (EXECUTORS[operation]) {
    throw new Error(`Agent run executor "${operation}" is already registered.`);
  }
  EXECUTORS[operation] = executor;
}

export function listAgentRunOperations() {
  return Object.entries(EXECUTORS).map(([id, executor]) => ({
    id,
    title: executor.title,
    description: executor.description,
    risk: executor.risk,
    required_role: executor.requiredRole,
    scope: executor.scope,
    expected_effect: executor.expectedEffect,
  }));
}

export function listAgentRuns(options: { workspace?: string; state?: AgentRunState; limit?: number } = {}) {
  const all = [...runs.values()].map(applyExpiry).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const scoped = all
    .filter((r) => (options.workspace ? r.workspace === options.workspace : true))
    .filter((r) => (options.state ? r.state === options.state : true));
  return scoped.slice(0, options.limit ?? 20);
}

export function getAgentRun(id: string) {
  const run = runs.get(id);
  return run ? applyExpiry(run) : null;
}

export function getAgentRunExecutor(operation: string) {
  return EXECUTORS[operation];
}

export function requestAgentRunCancel(id: string) {
  const run = runs.get(id);
  if (!run) return null;
  if (TERMINAL_AGENT_RUN_STATES.has(run.state)) return run;
  if (run.state === "awaiting_approval") {
    void transition(run, "cancelled", "Cancelled while awaiting approval; nothing executed.");
    return run;
  }
  run.cancel_requested = true;
  return run;
}

/* ---------------- execution core ---------------- */

async function executeRun(run: AgentRun, executor: AgentRunExecutor, proof: {
  tenantId: string;
  businessName: string;
}) {
  const ctx: ExecutorContext = {
    run,
    progress: async (note: string) => {
      run.updated_at = nowIso();
      run.events.push({ at: run.updated_at, note });
      await persistRun(run);
    },
    isCancelled: () => run.cancel_requested,
  };
  try {
    await transition(run, "executing", `Executing ${executor.title}.`);
    const result = await executor.execute(ctx);
    if (run.cancel_requested) {
      await transition(run, "cancelled", "Cancelled by request during execution.");
      return;
    }
    run.artifacts = result.artifacts;

    await transition(run, "verifying", "Verifying the produced artifacts.");
    const verdict = await executor.verify(ctx, result.artifacts);
    if (!verdict.ok) {
      run.error = verdict.detail;
      await transition(run, "failed", `Verification failed: ${verdict.detail}`);
      return;
    }

    /* execution receipt — who asked, who approved, what actually happened */
    run.receipt = {
      operation: run.operation,
      requested_by: run.requested_by,
      approved_by: run.approved_by,
      approved_at: run.approved_at,
      executed_at: nowIso(),
      inputs: run.inputs,
      scope: run.scope,
      expected_effect: run.expected_effect,
      actual_effect: result.actualEffect ?? result.summary,
      cost_estimate_usd: run.cost_estimate_usd,
      rollback_guidance: executor.rollbackGuidance ?? null,
    };

    /* proof: a real Hermes ledger record referencing this run */
    const ledgerRecord = {
      timestamp: nowIso(),
      tenant_id: proof.tenantId,
      business_name: proof.businessName,
      actor_user_id: run.requested_by,
      actor_role: "admin" as const,
      request_id: run.id,
      task_type: `agent_run:${run.operation}`,
      sensitivity_level: "internal" as const,
      provider_route: "none" as const,
      model_id: "none",
      context_chars: 0,
      estimated_tokens: 0,
      estimated_cost_usd: run.cost_estimate_usd,
      user_request_summary: redactSensitiveText(run.request || executor.title).slice(0, 200),
      result_summary: redactSensitiveText(result.summary).slice(0, 240),
      approval_required: run.risk !== "low_internal",
      approval_state: run.risk !== "low_internal" ? ("approved" as const) : ("not_required" as const),
      external_action: run.risk !== "low_internal",
      external_action_executed: run.risk !== "low_internal",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await appendHermesLedgerRecord(ledgerRecord as any);
    run.proof_request_id = run.id;

    const successState: AgentRunState =
      run.risk === "low_internal" ? "completed" : result.partial ? "partially_succeeded" : "succeeded";
    await transition(run, successState, `${verdict.detail} Proof recorded in the Hermes ledger (request ${run.id}).`);
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (message === "cancelled" || run.cancel_requested) {
      await transition(run, "cancelled", "Cancelled by request.");
    } else {
      run.error = message.slice(0, 300);
      await transition(run, "failed", `Failed: ${run.error}`);
    }
  }
}

export async function startAgentRun(input: {
  operation: string;
  workspace: string;
  sessionId: string;
  request: string;
  tenantId: string;
  businessName: string;
  requestedBy?: string;
  inputs?: Record<string, unknown>;
}): Promise<AgentRun | { error: string; available: ReturnType<typeof listAgentRunOperations> }> {
  const executor = EXECUTORS[input.operation];
  if (!executor) {
    return { error: `unknown_operation`, available: listAgentRunOperations() };
  }

  const requiresApproval = executor.risk !== "low_internal";
  const run: AgentRun = {
    id: runId(),
    operation: input.operation,
    title: executor.title,
    workspace: input.workspace,
    session_id: input.sessionId,
    request: String(input.request || "").slice(0, 300),
    state: requiresApproval ? "awaiting_approval" : "queued",
    risk: executor.risk,
    required_role: executor.requiredRole,
    inputs: input.inputs ?? {},
    scope: executor.scope,
    expected_effect: executor.expectedEffect,
    cost_estimate_usd: executor.costEstimateUsd ?? null,
    requested_by: input.requestedBy ?? input.sessionId,
    approval_deadline: requiresApproval ? new Date(Date.now() + DEFAULT_APPROVAL_DEADLINE_MS).toISOString() : null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    events: [
      requiresApproval
        ? { at: nowIso(), state: "awaiting_approval", note: `External action proposed — waiting for explicit approval. ${executor.expectedEffect}` }
        : { at: nowIso(), state: "queued", note: "Run created and queued." },
    ],
    artifacts: [],
    receipt: null,
    error: null,
    proof_request_id: null,
    cancel_requested: false,
  };
  runs.set(run.id, run);
  await persistRun(run);

  if (!requiresApproval) {
    /* low-risk internal work executes immediately; the client polls */
    void executeRun(run, executor, { tenantId: input.tenantId, businessName: input.businessName });
  }

  return run;
}

/* Approve an awaiting run. Authorization (org manager / super-admin for the
   run's workspace) is enforced by the caller — this records WHO approved and
   flips the machine. The engine refuses to execute anything not in
   awaiting_approval, so approval can never be skipped or repeated. */
export async function approveAgentRun(id: string, approver: { id: string; email?: string }, proof: {
  tenantId: string;
  businessName: string;
}) {
  const run = getAgentRun(id);
  if (!run) return { ok: false as const, error: "run_not_found" };
  if (run.state === "expired") return { ok: false as const, error: "approval_expired" };
  if (run.state !== "awaiting_approval") return { ok: false as const, error: `not_awaiting_approval:${run.state}` };
  const executor = EXECUTORS[run.operation];
  if (!executor) return { ok: false as const, error: "executor_missing" };

  run.approved_by = approver.email ?? approver.id;
  run.approved_at = nowIso();
  await transition(run, "approved", `Approved by ${run.approved_by}.`);
  await transition(run, "queued", "Queued for execution.");
  void executeRun(run, executor, proof);
  return { ok: true as const, run };
}

export async function rejectAgentRun(id: string, approver: { id: string; email?: string }, reason?: string) {
  const run = getAgentRun(id);
  if (!run) return { ok: false as const, error: "run_not_found" };
  if (run.state !== "awaiting_approval") return { ok: false as const, error: `not_awaiting_approval:${run.state}` };
  run.rejected_by = approver.email ?? approver.id;
  run.rejected_at = nowIso();
  run.rejection_reason = reason?.slice(0, 300) ?? null;
  await transition(run, "rejected", `Rejected by ${run.rejected_by}${reason ? `: ${reason.slice(0, 200)}` : "."}`);
  return { ok: true as const, run };
}
