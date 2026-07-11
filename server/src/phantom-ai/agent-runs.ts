/* PhantomForce agent-run lifecycle.
   The execution contract behind "Phantom acts like an agent": every run is a
   real record with real states (queued → executing → verifying →
   completed | failed | cancelled), timestamped progress events, artifacts on
   disk, and a Hermes ledger proof entry. Executors do REAL work only — they
   read real server state and produce real files; nothing here simulates
   success, calls paid providers, or performs external actions. New executors
   register in EXECUTORS and inherit the whole lifecycle. */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listAutomationJobs } from "./automation-engine.js";
import { getProviderReadinessReport } from "./provider-readiness.js";
import { appendHermesLedgerRecord, readHermesLedgerRecords, redactSensitiveText } from "./hermes-ledger.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const RUNS_LOG_PATH = resolve(repoRoot, ".phantom", "agent-runs.jsonl");
const ARTIFACTS_DIR = resolve(repoRoot, ".phantom", "artifacts");

export type AgentRunState = "queued" | "executing" | "verifying" | "completed" | "failed" | "cancelled";

export type AgentRunEvent = {
  at: string;
  state?: AgentRunState;
  note: string;
};

export type AgentRunArtifact = {
  kind: "markdown" | "json";
  path: string;
  summary: string;
};

export type AgentRun = {
  id: string;
  operation: string;
  title: string;
  workspace: string;
  session_id: string;
  request: string;
  state: AgentRunState;
  created_at: string;
  updated_at: string;
  events: AgentRunEvent[];
  artifacts: AgentRunArtifact[];
  error: string | null;
  proof_request_id: string | null;
  cancel_requested: boolean;
};

type ExecutorContext = {
  run: AgentRun;
  progress: (note: string) => Promise<void>;
  isCancelled: () => boolean;
};

type Executor = {
  title: string;
  description: string;
  execute: (ctx: ExecutorContext) => Promise<{ artifacts: AgentRunArtifact[]; summary: string }>;
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

/* ---------------- executors: real work only ---------------- */

const EXECUTORS: Record<string, Executor> = {
  business_snapshot: {
    title: "Business snapshot report",
    description: "Compiles a real operational report from live server state: automation results, recent Hermes proof entries, and provider readiness. No provider calls, no spend.",
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
        ...jobs.slice(0, 15).map((j) => `- ${j.name}: ${j.last_status ?? "never run"}${j.last_summary ? ` — ${redactSensitiveText(String(j.last_summary)).slice(0, 140)}` : ""}`),
        ``,
        `## Recent activity (Hermes ledger, last ${ledger.length})`,
        ...ledger.slice(-10).map((r) => `- ${r.timestamp} · ${r.task_type} · ${redactSensitiveText(r.result_summary || r.user_request_summary || "").slice(0, 120)}`),
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

export function listAgentRunOperations() {
  return Object.entries(EXECUTORS).map(([id, executor]) => ({
    id,
    title: executor.title,
    description: executor.description,
  }));
}

export function listAgentRuns(options: { sessionId?: string; limit?: number } = {}) {
  const all = [...runs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const scoped = options.sessionId ? all.filter((r) => r.session_id === options.sessionId) : all;
  return scoped.slice(0, options.limit ?? 20);
}

export function getAgentRun(id: string) {
  return runs.get(id) ?? null;
}

export function requestAgentRunCancel(id: string) {
  const run = runs.get(id);
  if (!run) return null;
  if (["completed", "failed", "cancelled"].includes(run.state)) return run;
  run.cancel_requested = true;
  return run;
}

export async function startAgentRun(input: {
  operation: string;
  workspace: string;
  sessionId: string;
  request: string;
  tenantId: string;
  businessName: string;
}): Promise<AgentRun | { error: string; available: ReturnType<typeof listAgentRunOperations> }> {
  const executor = EXECUTORS[input.operation];
  if (!executor) {
    return { error: `unknown_operation`, available: listAgentRunOperations() };
  }

  const run: AgentRun = {
    id: runId(),
    operation: input.operation,
    title: executor.title,
    workspace: input.workspace,
    session_id: input.sessionId,
    request: String(input.request || "").slice(0, 300),
    state: "queued",
    created_at: nowIso(),
    updated_at: nowIso(),
    events: [{ at: nowIso(), state: "queued", note: "Run created and queued." }],
    artifacts: [],
    error: null,
    proof_request_id: null,
    cancel_requested: false,
  };
  runs.set(run.id, run);
  await persistRun(run);

  /* execute asynchronously — the route answers with the queued run and the
     client polls. Every transition is persisted and evented. */
  void (async () => {
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

      /* proof: a real Hermes ledger record referencing this run */
      const ledgerRecord = {
        timestamp: nowIso(),
        tenant_id: input.tenantId,
        business_name: input.businessName,
        actor_user_id: input.sessionId,
        actor_role: "admin" as const,
        request_id: run.id,
        task_type: `agent_run:${input.operation}`,
        sensitivity_level: "internal" as const,
        provider_route: "none" as const,
        model_id: "none",
        context_chars: 0,
        estimated_tokens: 0,
        estimated_cost_usd: null,
        user_request_summary: redactSensitiveText(run.request || executor.title).slice(0, 200),
        result_summary: redactSensitiveText(result.summary).slice(0, 240),
        approval_required: false,
        approval_state: "not_required" as const,
        external_action: false,
        external_action_executed: false,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await appendHermesLedgerRecord(ledgerRecord as any);
      run.proof_request_id = run.id;

      await transition(run, "completed", `${verdict.detail} Proof recorded in the Hermes ledger (request ${run.id}).`);
    } catch (error) {
      const message = String((error as Error)?.message || error);
      if (message === "cancelled" || run.cancel_requested) {
        await transition(run, "cancelled", "Cancelled by request.");
      } else {
        run.error = message.slice(0, 300);
        await transition(run, "failed", `Failed: ${run.error}`);
      }
    }
  })();

  return run;
}
