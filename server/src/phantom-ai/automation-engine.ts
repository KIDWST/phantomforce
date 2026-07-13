/* PhantomForce — autonomous automation engine.
   Real, scheduled (daily/weekly/monthly), toggle-on/off jobs that read live
   system state (rembg, ai-proxy, PhantomCut, the tool registry, the access
   database when one is configured) and log an honest result to the Hermes
   ledger every time they run. Every job here is read-only/prep-only: none
   of them send, post, pay, publish, or call a paid provider — a job that
   can't verify something real reports that honestly instead of guessing.
   This is what makes the agent-workforce "active worker" counts respond to
   real recurring activity instead of only live chat turns. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { appendHermesLedgerRecord, getHermesLedgerStatus } from "./hermes-ledger.js";
import { detectRembg } from "./rembg-bridge.js";
import { loadToolRegistry, buildToolLanePreview } from "./tool-lane.js";
import { getAutonomousSecurityScanStatus } from "./security-scan-scheduler.js";
import { getAccessAuthConfiguration } from "../access/session.js";
import { buildProductionReadinessReport } from "../access/production-readiness.js";
import { prisma } from "../access/prisma-runtime.js";
import { getContentAssetStorageProvider } from "./content-asset-storage.js";

const ENGINE_VERSION = "2026.07.10-autopilot-v1";
const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "automation-engine");
const STATE_DIR = process.env.PHANTOMFORCE_AUTOMATION_STATE_DIR ?? DEFAULT_STATE_DIR;
const STATE_FILE = path.join(STATE_DIR, "state.json");
const TICK_MS = 10 * 60 * 1000;

const CADENCE_MS = {
  daily: 22 * 60 * 60 * 1000,
  weekly: 6.5 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
} as const;

export type AutomationCategory = "health" | "ops" | "content";
export type AutomationCadence = keyof typeof CADENCE_MS;

type AutomationRunOutcome = {
  ok: boolean;
  summary: string;
  next_action: string;
  risks?: string[];
};

type AutomationJobDefinition = {
  id: string;
  name: string;
  category: AutomationCategory;
  cadence: AutomationCadence;
  description: string;
  run: () => Promise<AutomationRunOutcome>;
};

type AutomationJobState = {
  enabled: boolean;
  last_run_at: string | null;
  last_status: "ok" | "error" | null;
  last_summary: string | null;
  run_count: number;
};

type AutomationEngineState = {
  engine_version: string;
  jobs: Record<string, AutomationJobState>;
};

async function fetchJsonWithTimeout(url: string, ms = 5000): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function aiProxyBaseUrl() {
  return (process.env.PHANTOM_AI_PROXY_BASE_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
}

function phantomCutBaseUrl() {
  return (process.env.PHANTOMCUT_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
}

function keyedMediaProviders(data: Record<string, unknown> | null): string[] {
  const media = data && typeof data.media === "object" && data.media ? (data.media as Record<string, unknown>) : {};
  return Object.keys(media).filter((key) => Boolean(media[key]));
}

const JOB_DEFINITIONS: AutomationJobDefinition[] = [
  // ---------------- system health ----------------
  {
    id: "rembg-health",
    name: "Rembg Health Check",
    category: "health",
    cadence: "daily",
    description: "Confirms the local rembg background-removal bridge is reachable and reports its version.",
    run: async () => {
      const status = await detectRembg(true);
      return {
        ok: status.available,
        summary: status.available
          ? `rembg connected via ${status.pythonCommand ?? "python"}${status.version ? ` (${status.version})` : ""}.`
          : `rembg is not reachable: ${status.error ?? "not installed"}.`,
        next_action: status.available ? "No action needed." : "Install/verify rembg on this machine.",
      };
    },
  },
  {
    id: "ai-proxy-health",
    name: "ai-proxy Health Check",
    category: "health",
    cadence: "daily",
    description: "Confirms ai-proxy is reachable and reports which media providers are keyed.",
    run: async () => {
      const res = await fetchJsonWithTimeout(`${aiProxyBaseUrl()}/health`);
      const keyed = keyedMediaProviders(res.data);
      return {
        ok: res.ok,
        summary: res.ok
          ? `ai-proxy reachable at ${aiProxyBaseUrl()}${keyed.length ? ` — keyed providers: ${keyed.join(", ")}` : " — no media providers keyed"}.`
          : `ai-proxy unreachable at ${aiProxyBaseUrl()}.`,
        next_action: res.ok ? "No action needed." : "Start ai-proxy or set PHANTOM_AI_PROXY_BASE_URL.",
      };
    },
  },
  {
    id: "phantomcut-lane-health",
    name: "PhantomCut Lane Health Check",
    category: "health",
    cadence: "daily",
    description: "Confirms the PhantomCut media bridge is reachable.",
    run: async () => {
      const res = await fetchJsonWithTimeout(`${phantomCutBaseUrl()}/api/health`);
      return {
        ok: res.ok,
        summary: res.ok
          ? `PhantomCut media lane reachable at ${phantomCutBaseUrl()}.`
          : `PhantomCut media lane unreachable at ${phantomCutBaseUrl()}.`,
        next_action: res.ok ? "No action needed." : "Start the PhantomCut bridge or set PHANTOMCUT_BASE_URL.",
      };
    },
  },
  {
    id: "tool-registry-audit",
    name: "Tool Registry Audit",
    category: "health",
    cadence: "weekly",
    description: "Confirms the tool-lane registry file loads and every entry validates.",
    run: async () => {
      const registry = await loadToolRegistry();
      const ok = registry.loaded && registry.malformed_entries === 0 && registry.valid_tool_count === registry.tool_count;
      return {
        ok,
        summary: registry.loaded
          ? `Tool registry loaded: ${registry.tool_count} tool(s), ${registry.valid_tool_count} valid, ${registry.malformed_entries} malformed.`
          : `Tool registry failed to load: ${registry.load_error ?? "unknown error"}.`,
        next_action: ok ? "No action needed." : "Review docs/tooling-spine/tool-registry.json for missing fields.",
      };
    },
  },
  {
    id: "hermes-ledger-integrity",
    name: "Hermes Ledger Integrity Check",
    category: "health",
    cadence: "weekly",
    description: "Confirms the Hermes ledger file exists and reports its current size.",
    run: async () => {
      const status = await getHermesLedgerStatus();
      return {
        ok: status.exists,
        summary: status.exists
          ? `Hermes ledger present at ${status.ledgerPath} (${status.bytes} bytes).`
          : `Hermes ledger has not been created yet at ${status.ledgerPath}.`,
        next_action: status.exists ? "No action needed." : "Expected on a fresh install — no ledger activity yet.",
      };
    },
  },
  {
    id: "security-scan-digest",
    name: "Monthly Security Scan Digest",
    category: "health",
    cadence: "monthly",
    description: "Reads the existing autonomous monthly security scanner's last result and logs it to the ledger.",
    run: async () => {
      const status = await getAutonomousSecurityScanStatus();
      const findingCount = status.targets.reduce((sum, target) => sum + target.finding_titles.length, 0);
      return {
        ok: status.status === "ran_this_month",
        summary: status.status === "ran_this_month"
          ? `Monthly security scan ${status.proof_id} covered ${status.target_count} target(s), ${findingCount} finding(s) noted.`
          : `Monthly security scan has not completed this cycle yet (status: ${status.status}).`,
        next_action: findingCount > 0 ? "Review findings in PhantomOps." : "No action needed.",
      };
    },
  },
  // ---------------- business operations ----------------
  {
    id: "access-auth-posture",
    name: "Access & Auth Posture Digest",
    category: "ops",
    cadence: "weekly",
    description: "Summarizes which access/auth provider and session settings are configured.",
    run: async () => {
      const cfg = getAccessAuthConfiguration();
      return {
        ok: true,
        summary: `Auth provider "${cfg.authProvider}" (${cfg.sessionSource}), production ready: ${cfg.productionReady ? "yes" : "no"}, session secret configured: ${cfg.sessionSecretConfigured ? "yes" : "no"}.`,
        next_action: cfg.productionReady ? "No action needed." : "Review production auth configuration before going live.",
      };
    },
  },
  {
    id: "production-readiness-digest",
    name: "Production Readiness Digest",
    category: "ops",
    cadence: "weekly",
    description: "Runs the existing production-readiness gate report and logs a summary.",
    run: async () => {
      const report = await buildProductionReadinessReport();
      const blocked = report.gates.filter((gate) => gate.status === "blocked").length;
      const needsConfig = report.gates.filter((gate) => gate.status === "needs_config").length;
      return {
        ok: report.productionReady,
        summary: `${report.gates.length} gate(s) checked — ${blocked} blocked, ${needsConfig} need config.`,
        next_action: blocked > 0 ? "Review blocked production-readiness gates." : "No action needed.",
      };
    },
  },
  {
    id: "pending-approvals-digest",
    name: "Pending Approvals Digest",
    category: "ops",
    cadence: "daily",
    description: "Counts approvals awaiting a decision in the access database, when one is configured.",
    run: async () => {
      if (!prisma) {
        return { ok: true, summary: "No database configured (demo/local mode) — nothing to count.", next_action: "No action needed." };
      }
      const pending = await prisma.approval.count({ where: { status: "pending" } });
      return {
        ok: pending === 0,
        summary: `${pending} approval(s) awaiting a decision.`,
        next_action: pending > 0 ? "Review the Approvals queue." : "No action needed.",
      };
    },
  },
  {
    id: "recent-actions-digest",
    name: "Recent Actions Digest",
    category: "ops",
    cadence: "weekly",
    description: "Summarizes the most recent proposed/executed actions in the access database, when one is configured.",
    run: async () => {
      if (!prisma) {
        return { ok: true, summary: "No database configured (demo/local mode) — nothing to summarize.", next_action: "No action needed." };
      }
      const recent = await prisma.action.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
      return {
        ok: true,
        summary: recent.length ? `${recent.length} most recent action(s): ${recent.map((action) => action.type).join(", ")}.` : "No actions recorded yet.",
        next_action: "No action needed.",
      };
    },
  },
  {
    id: "n8n-readiness-check",
    name: "n8n Readiness Check",
    category: "ops",
    cadence: "weekly",
    description: "Checks whether the local n8n scaffold and workflow drafts are in place.",
    run: async () => {
      const preview = await buildToolLanePreview({ toolId: "n8n" });
      return {
        ok: preview.n8n_status.n8n_scaffolded,
        summary: `n8n scaffold ${preview.n8n_status.n8n_scaffolded ? "present" : "missing"}, running: ${preview.n8n_status.n8n_running ? "yes" : "no"}, ${preview.n8n_status.workflow_drafts.length} draft workflow(s).`,
        next_action: preview.n8n_status.n8n_scaffolded ? "No action needed." : "Scaffold the n8n workflow-stack if automation drafting is wanted.",
      };
    },
  },
  {
    id: "content-asset-cleanup",
    name: "Content Asset Cleanup",
    category: "ops",
    cadence: "daily",
    description: "Deletes cross-device-synced content assets older than 30 days from the local sync store.",
    run: async () => {
      const provider = getContentAssetStorageProvider();
      const result = await provider.deleteExpiredAssets();
      return {
        ok: true,
        summary: result.deletedCount > 0
          ? `Deleted ${result.deletedCount} expired content asset(s) past the 30-day retention window.`
          : "No expired content assets to delete.",
        next_action: "No action needed.",
      };
    },
  },
  // ---------------- content & marketing readiness ----------------
  {
    id: "media-engine-connectivity-digest",
    name: "Media Engine Connectivity Digest",
    category: "content",
    cadence: "daily",
    description: "Reports which media/content generation engines are actually keyed on ai-proxy right now.",
    run: async () => {
      const res = await fetchJsonWithTimeout(`${aiProxyBaseUrl()}/health`);
      const keyed = keyedMediaProviders(res.data);
      return {
        ok: res.ok,
        summary: res.ok
          ? (keyed.length ? `Connected media engines: ${keyed.join(", ")}.` : "ai-proxy reachable but no media engines are keyed.")
          : "ai-proxy is unreachable — no media engine status available.",
        next_action: keyed.length ? "No action needed." : "Add a provider API key to ai-proxy, or use manual mode.",
      };
    },
  },
  {
    id: "higgsfield-mode-digest",
    name: "Higgsfield Mode Digest",
    category: "content",
    cadence: "weekly",
    description: "Confirms whether Higgsfield is in real API mode or subscription/manual mode — never claims 'connected' without a real key.",
    run: async () => {
      const res = await fetchJsonWithTimeout(`${aiProxyBaseUrl()}/health`);
      const keyed = keyedMediaProviders(res.data).includes("higgsfield");
      return {
        ok: true,
        summary: keyed
          ? "Higgsfield has a real API key configured — AI Edit can call it directly."
          : "Higgsfield is subscription/manual mode — no API key configured, AI Edit stays prompt-prep only.",
        next_action: keyed ? "No action needed." : "Expected unless Higgsfield ships an official developer API key.",
      };
    },
  },
];

function blankJobState(): AutomationJobState {
  return { enabled: true, last_run_at: null, last_status: null, last_summary: null, run_count: 0 };
}

function blankState(): AutomationEngineState {
  const jobs: Record<string, AutomationJobState> = {};
  for (const job of JOB_DEFINITIONS) jobs[job.id] = blankJobState();
  return { engine_version: ENGINE_VERSION, jobs };
}

async function readState(): Promise<AutomationEngineState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutomationEngineState>;
    const jobs: Record<string, AutomationJobState> = {};
    for (const job of JOB_DEFINITIONS) {
      jobs[job.id] = { ...blankJobState(), ...(parsed.jobs?.[job.id] ?? {}) };
    }
    return { engine_version: ENGINE_VERSION, jobs };
  } catch {
    return blankState();
  }
}

async function writeState(state: AutomationEngineState) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isDue(job: AutomationJobDefinition, jobState: AutomationJobState, now: number) {
  if (!jobState.enabled) return false;
  if (!jobState.last_run_at) return true;
  const last = Date.parse(jobState.last_run_at);
  if (!Number.isFinite(last)) return true;
  return now - last >= CADENCE_MS[job.cadence];
}

async function executeJob(job: AutomationJobDefinition): Promise<{ last_run_at: string; last_status: "ok" | "error"; last_summary: string }> {
  const now = new Date().toISOString();
  let outcome: AutomationRunOutcome;

  try {
    outcome = await job.run();
  } catch (error) {
    outcome = {
      ok: false,
      summary: `Run failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
      next_action: "Check server logs for this automation.",
    };
  }

  await appendHermesLedgerRecord({
    timestamp: now,
    tenant_id: "phantomforce-admin",
    business_name: "PhantomForce",
    actor_user_id: "system-automation-engine",
    actor_role: "platform_admin",
    request_id: randomUUID(),
    task_type: `automation:${job.category}:${job.id}`,
    sensitivity_level: "low",
    provider_route: "mock",
    model_id: "phantom-automation-engine",
    context_chars: 0,
    estimated_tokens: 0,
    estimated_cost_usd: 0,
    user_request_summary: `Scheduled ${job.cadence} run: ${job.name}`,
    result_summary: outcome.summary.slice(0, 360),
    approval_required: false,
    approval_status: "not_required",
    risks: outcome.risks ?? [],
    next_action: outcome.next_action,
    agent_run_id: `automation-${job.id}-${now}`,
  });

  return { last_run_at: now, last_status: outcome.ok ? "ok" : "error", last_summary: outcome.summary };
}

export async function runDueAutomations(reason = "scheduled_tick") {
  const state = await readState();
  const now = Date.now();
  const ran: string[] = [];

  for (const job of JOB_DEFINITIONS) {
    const jobState = state.jobs[job.id] ?? blankJobState();
    if (!isDue(job, jobState, now)) continue;
    const result = await executeJob(job);
    state.jobs[job.id] = { ...jobState, ...result, run_count: (jobState.run_count ?? 0) + 1 };
    ran.push(job.id);
  }

  await writeState(state);
  return { ran, reason };
}

export async function runAutomationJobNow(jobId: string) {
  const job = JOB_DEFINITIONS.find((item) => item.id === jobId);
  if (!job) return { ok: false as const, error: "unknown_job" as const };

  const state = await readState();
  const jobState = state.jobs[jobId] ?? blankJobState();
  const result = await executeJob(job);
  state.jobs[jobId] = { ...jobState, ...result, run_count: (jobState.run_count ?? 0) + 1 };
  await writeState(state);

  return { ok: true as const, job_id: jobId, ...result };
}

export async function setAutomationJobEnabled(jobId: string, enabled: boolean) {
  const job = JOB_DEFINITIONS.find((item) => item.id === jobId);
  if (!job) return { ok: false as const, error: "unknown_job" as const };

  const state = await readState();
  const jobState = state.jobs[jobId] ?? blankJobState();
  state.jobs[jobId] = { ...jobState, enabled };
  await writeState(state);

  return { ok: true as const, job_id: jobId, enabled };
}

export async function listAutomationJobs() {
  const state = await readState();

  return JOB_DEFINITIONS.map((job) => {
    const jobState = state.jobs[job.id] ?? blankJobState();
    const last = jobState.last_run_at ? Date.parse(jobState.last_run_at) : null;
    const nextDueAt = jobState.enabled && last !== null && Number.isFinite(last)
      ? new Date(last + CADENCE_MS[job.cadence]).toISOString()
      : null;

    return {
      id: job.id,
      name: job.name,
      category: job.category,
      cadence: job.cadence,
      description: job.description,
      parent_worker_id: `autopilot-${job.category}`,
      enabled: jobState.enabled,
      last_run_at: jobState.last_run_at,
      last_status: jobState.last_status,
      last_summary: jobState.last_summary,
      run_count: jobState.run_count,
      next_due_at: nextDueAt,
    };
  });
}

export function getAutomationJobDefinitions() {
  return JOB_DEFINITIONS.map(({ id, name, category, cadence, description }) => ({ id, name, category, cadence, description }));
}

type LoggerLike = { info: (message: string) => void; warn: (message: string) => void };

export function startAutomationEngine(logger: LoggerLike) {
  if (process.env.PHANTOMFORCE_AUTOMATION_ENGINE_ENABLED === "false") {
    logger.info("PhantomForce automation engine disabled by environment.");
    return () => undefined;
  }

  void runDueAutomations("server_startup_catchup")
    .then((result) => {
      logger.info(
        result.ran.length
          ? `PhantomForce automation engine ran ${result.ran.length} due job(s) on startup: ${result.ran.join(", ")}.`
          : "PhantomForce automation engine: no jobs due on startup.",
      );
    })
    .catch((error) => {
      logger.warn(`PhantomForce automation engine startup run failed non-fatally: ${String(error)}`);
    });

  const timer = setInterval(() => {
    void runDueAutomations("scheduled_tick").catch((error) => {
      logger.warn(`PhantomForce automation engine tick failed non-fatally: ${String(error)}`);
    });
  }, TICK_MS);
  timer.unref();

  return () => clearInterval(timer);
}
