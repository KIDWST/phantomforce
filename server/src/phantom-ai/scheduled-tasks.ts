/* PhantomBot — deferred / recurring PhantomForce scheduled-task registry.

   This is the canonical, native way to say "recheck / resync in N hours".
   It exists so that agents (Claude, Codex) and PhantomForce code NEVER
   schedule a model self-wakeup to do deferred work. Model self-wakeups burn
   tokens just to sit and wait; every timer registered here instead fires
   deterministically off PhantomForce's own automation tick loop for ZERO
   tokens, and can hand the actual work to an in-repo automation job or to a
   local n8n webhook.

   Rule of thumb for agents: if you ever wanted to "wake yourself up in N
   hours to recheck X", hand it to PhantomBot here instead. Deterministic
   steps run for free on the tick; the only time a paid model should ever be
   involved is a single on-demand call made *inside* the n8n workflow this
   task triggers — never a background agent left open.

   Every run is proof-logged to the Hermes ledger with estimated_tokens: 0,
   so the token-free guarantee is auditable, not just asserted. */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { appendHermesLedgerRecord } from "./hermes-ledger.js";

const DEFAULT_STATE_DIR = path.join(process.cwd(), ".local", "scheduled-tasks");
const STATE_DIR = process.env.PHANTOMFORCE_SCHEDULED_TASKS_DIR ?? DEFAULT_STATE_DIR;
const STATE_FILE = path.join(STATE_DIR, "state.json");
const STATE_VERSION = 1;

// A scheduled task fires at most once per tick; keep a floor so nobody can
// register a "recheck every 1 second" hot loop that hammers the ledger.
const MIN_EVERY_MS = 60 * 1000;
// Cap how far in the future a one-shot can be parked, purely as a sanity rail
// (10 years). This is not a business limit, just a guard against typos.
const MAX_HORIZON_MS = 10 * 365 * 24 * 60 * 60 * 1000;
// If a recurring task is enabled but its stored runAt is far in the past
// (server was off for a long time), don't fire it many times to "catch up" —
// fire once and re-anchor to now + everyMs.
const MAX_CATCHUP_MS = 6 * 60 * 60 * 1000;

export type ScheduledTaskSource = "claude" | "codex" | "phantomforce" | "user" | "n8n";

export type ScheduledTaskAction =
  | { type: "automation"; jobId: string }
  | {
      type: "webhook";
      url: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: unknown;
      headers?: Record<string, string>;
    }
  | { type: "noop"; note?: string };

export type ScheduledTask = {
  id: string;
  label: string;
  action: ScheduledTaskAction;
  run_at: string; // ISO — next time this should fire
  every_ms: number | null; // recurring interval, or null for one-shot
  enabled: boolean;
  source: ScheduledTaskSource;
  created_at: string;
  created_by: string;
  last_run_at: string | null;
  last_status: "pending" | "ok" | "error" | "skipped";
  last_summary: string | null;
  run_count: number;
};

type ScheduledTaskState = {
  version: number;
  tasks: ScheduledTask[];
};

export type ScheduledTaskHandlers = {
  // Injected to avoid a circular import with automation-engine. Returns an
  // object we only read for a short summary; never throws for "unknown job".
  runAutomationJob?: (jobId: string) => Promise<{ ok: boolean; error?: string; last_summary?: string }>;
};

function blankState(): ScheduledTaskState {
  return { version: STATE_VERSION, tasks: [] };
}

async function readState(): Promise<ScheduledTaskState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScheduledTaskState>;
    if (!parsed || !Array.isArray(parsed.tasks)) return blankState();
    return { version: STATE_VERSION, tasks: parsed.tasks as ScheduledTask[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return blankState();
    throw error;
  }
}

async function writeState(state: ScheduledTaskState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  // Atomic write: temp file + rename, so a crash mid-write can never leave a
  // half-written state.json that would drop everyone's scheduled tasks.
  const tmp = path.join(STATE_DIR, `state.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, STATE_FILE);
}

// --- webhook host allowlist -------------------------------------------------

function parseHostList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// Only ever allow webhooks to loopback or an explicitly-configured local
// automation host (n8n). We never let a registered task POST to an arbitrary
// external URL — that would turn this scheduler into an open SSRF relay.
function isAllowedWebhookUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }
  const host = url.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  const configured = parseHostList(process.env.PHANTOMFORCE_N8N_ALLOWED_HOSTS);
  if (loopback || configured.includes(host)) {
    return { ok: true, url };
  }
  return { ok: false, reason: "host_not_allowed" };
}

// --- registration -----------------------------------------------------------

export type RegisterScheduledTaskInput = {
  label: string;
  action: ScheduledTaskAction;
  source?: ScheduledTaskSource;
  created_by?: string;
  // Exactly one of these decides when it first fires.
  run_at?: string; // ISO
  run_in_ms?: number; // relative, from now
  run_in_hours?: number; // relative, convenience for "recheck in N hours"
  // If set, the task repeats on this interval after each fire.
  every_ms?: number | null;
  every_hours?: number | null;
  enabled?: boolean;
};

export type RegisterResult =
  | { ok: true; task: ScheduledTask }
  | { ok: false; error: string };

function resolveFirstRunMs(input: RegisterScheduledTaskInput, now: number): number | { error: string } {
  if (typeof input.run_in_hours === "number" && Number.isFinite(input.run_in_hours)) {
    return now + Math.max(0, input.run_in_hours) * 60 * 60 * 1000;
  }
  if (typeof input.run_in_ms === "number" && Number.isFinite(input.run_in_ms)) {
    return now + Math.max(0, input.run_in_ms);
  }
  if (typeof input.run_at === "string" && input.run_at.trim()) {
    const parsed = Date.parse(input.run_at);
    if (!Number.isFinite(parsed)) return { error: "invalid_run_at" };
    return parsed;
  }
  return { error: "missing_schedule" };
}

function resolveEveryMs(input: RegisterScheduledTaskInput): number | null | { error: string } {
  let every: number | null = null;
  if (typeof input.every_hours === "number" && Number.isFinite(input.every_hours)) {
    every = input.every_hours * 60 * 60 * 1000;
  } else if (input.every_ms === null) {
    every = null;
  } else if (typeof input.every_ms === "number" && Number.isFinite(input.every_ms)) {
    every = input.every_ms;
  }
  if (every !== null && every < MIN_EVERY_MS) return { error: "interval_too_short" };
  return every;
}

function validateAction(action: ScheduledTaskAction): { ok: true } | { ok: false; error: string } {
  if (!action || typeof action !== "object") return { ok: false, error: "invalid_action" };
  if (action.type === "automation") {
    if (!action.jobId || typeof action.jobId !== "string") return { ok: false, error: "missing_job_id" };
    return { ok: true };
  }
  if (action.type === "webhook") {
    const check = isAllowedWebhookUrl(action.url);
    if (!check.ok) return { ok: false, error: `webhook_${check.reason}` };
    return { ok: true };
  }
  if (action.type === "noop") return { ok: true };
  return { ok: false, error: "unknown_action_type" };
}

export async function registerScheduledTask(input: RegisterScheduledTaskInput): Promise<RegisterResult> {
  const label = String(input.label ?? "").trim();
  if (!label) return { ok: false, error: "missing_label" };

  const actionCheck = validateAction(input.action);
  if (!actionCheck.ok) return { ok: false, error: actionCheck.error };

  const now = Date.now();
  const firstRun = resolveFirstRunMs(input, now);
  if (typeof firstRun !== "number") return { ok: false, error: firstRun.error };
  if (firstRun - now > MAX_HORIZON_MS) return { ok: false, error: "run_at_too_far" };

  const every = resolveEveryMs(input);
  if (every !== null && typeof every !== "number") return { ok: false, error: every.error };

  const task: ScheduledTask = {
    id: randomUUID(),
    label: label.slice(0, 160),
    action: input.action,
    run_at: new Date(firstRun).toISOString(),
    every_ms: every,
    enabled: input.enabled ?? true,
    source: input.source ?? "phantomforce",
    created_at: new Date(now).toISOString(),
    created_by: String(input.created_by ?? "system").slice(0, 120),
    last_run_at: null,
    last_status: "pending",
    last_summary: null,
    run_count: 0,
  };

  const state = await readState();
  state.tasks.push(task);
  await writeState(state);
  return { ok: true, task };
}

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const state = await readState();
  return state.tasks
    .slice()
    .sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at));
}

export async function cancelScheduledTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const state = await readState();
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((task) => task.id !== id);
  if (state.tasks.length === before) return { ok: false, error: "unknown_task" };
  await writeState(state);
  return { ok: true };
}

export async function setScheduledTaskEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const state = await readState();
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task) return { ok: false, error: "unknown_task" };
  task.enabled = enabled;
  await writeState(state);
  return { ok: true };
}

// --- execution --------------------------------------------------------------

type RunOutcome = { ok: boolean; summary: string; status: "ok" | "error" | "skipped" };

async function executeWebhook(action: Extract<ScheduledTaskAction, { type: "webhook" }>): Promise<RunOutcome> {
  const check = isAllowedWebhookUrl(action.url);
  if (!check.ok) return { ok: false, status: "error", summary: `webhook blocked: ${check.reason}` };

  const method = action.method ?? (action.body !== undefined ? "POST" : "GET");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(check.url.toString(), {
      method,
      headers: {
        "content-type": "application/json",
        ...(action.headers ?? {}),
      },
      body: action.body !== undefined ? JSON.stringify(action.body) : undefined,
      signal: controller.signal,
    });
    const ok = response.ok;
    return {
      ok,
      status: ok ? "ok" : "error",
      summary: `${method} ${check.url.host}${check.url.pathname} → ${response.status}`,
    };
  } catch (error) {
    return { ok: false, status: "error", summary: `webhook failed: ${String((error as Error).message ?? error)}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeAction(action: ScheduledTaskAction, handlers: ScheduledTaskHandlers): Promise<RunOutcome> {
  if (action.type === "automation") {
    if (!handlers.runAutomationJob) {
      return { ok: false, status: "skipped", summary: "no automation handler wired" };
    }
    const result = await handlers.runAutomationJob(action.jobId);
    if (!result.ok) return { ok: false, status: "error", summary: `automation ${action.jobId}: ${result.error ?? "failed"}` };
    return { ok: true, status: "ok", summary: `automation ${action.jobId}: ${result.last_summary ?? "ran"}`.slice(0, 300) };
  }
  if (action.type === "webhook") {
    return executeWebhook(action);
  }
  // noop: a pure "wake-up marker" — useful when the real effect is just that
  // the tick loop re-evaluated something on its own next pass.
  return { ok: true, status: "ok", summary: action.note ? `noop: ${action.note}` : "noop" };
}

async function logRun(task: ScheduledTask, outcome: RunOutcome): Promise<void> {
  const now = new Date().toISOString();
  try {
    await appendHermesLedgerRecord({
      timestamp: now,
      tenant_id: "phantomforce-admin",
      business_name: "PhantomForce",
      actor_user_id: "system-scheduled-tasks",
      actor_role: "platform_admin",
      request_id: randomUUID(),
      task_type: `scheduled-task:${task.action.type}`,
      sensitivity_level: "low",
      provider_route: "mock",
      model_id: "phantom-scheduled-tasks",
      context_chars: 0,
      estimated_tokens: 0,
      estimated_cost_usd: 0,
      user_request_summary: `Deferred task (${task.source}): ${task.label}`,
      result_summary: outcome.summary.slice(0, 360),
      approval_required: false,
      approval_status: "not_required",
      risks: [],
      next_action: task.every_ms ? "reschedule" : "complete",
      agent_run_id: `scheduled-${task.id}-${now}`,
    });
  } catch {
    // Ledger logging must never break the tick.
  }
}

export type RunDueResult = { checked: number; ran: string[]; errors: string[] };

export async function runDueScheduledTasks(
  handlers: ScheduledTaskHandlers = {},
  reason = "scheduled_tick",
): Promise<RunDueResult> {
  void reason;
  const state = await readState();
  const now = Date.now();
  const ran: string[] = [];
  const errors: string[] = [];
  let changed = false;

  for (const task of state.tasks) {
    if (!task.enabled) continue;
    const due = Date.parse(task.run_at);
    if (!Number.isFinite(due) || due > now) continue;

    const outcome = await executeAction(task.action, handlers);
    await logRun(task, outcome);

    task.last_run_at = new Date(now).toISOString();
    task.last_status = outcome.status;
    task.last_summary = outcome.summary.slice(0, 300);
    task.run_count += 1;
    changed = true;
    ran.push(task.id);
    if (!outcome.ok) errors.push(task.id);

    if (task.every_ms && task.every_ms >= MIN_EVERY_MS) {
      // Recurring: re-anchor. If we're way behind (server was off), don't
      // fire repeatedly to catch up — just schedule the next one from now.
      const behind = now - due;
      const base = behind > MAX_CATCHUP_MS ? now : due;
      let next = base + task.every_ms;
      while (next <= now) next += task.every_ms;
      task.run_at = new Date(next).toISOString();
    } else {
      // One-shot: disable so it never fires again, but keep the record so
      // callers can see it ran and read the summary.
      task.enabled = false;
    }
  }

  if (changed) await writeState(state);
  return { checked: state.tasks.length, ran, errors };
}

export async function runScheduledTaskNow(
  id: string,
  handlers: ScheduledTaskHandlers = {},
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const state = await readState();
  const task = state.tasks.find((entry) => entry.id === id);
  if (!task) return { ok: false, error: "unknown_task" };

  const outcome = await executeAction(task.action, handlers);
  await logRun(task, outcome);
  const now = Date.now();
  task.last_run_at = new Date(now).toISOString();
  task.last_status = outcome.status;
  task.last_summary = outcome.summary.slice(0, 300);
  task.run_count += 1;

  // Running "now" does not consume a one-shot's scheduled fire; it just proves
  // it works. We leave run_at untouched so the real schedule still holds.
  await writeState(state);
  return { ok: outcome.ok, summary: outcome.summary };
}
