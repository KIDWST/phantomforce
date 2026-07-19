/* Termina Mission Bridge — HTTP client for Termina's local Mission API.

   Termina (C:\Users\jorda\Termina, server.js, default port 7420) is a real
   multi-agent coding-agent orchestrator: it spends real API/token cost and
   makes real filesystem/git changes against whatever workspaceRoot it is
   given. This module is a thin, side-effect-light TypeScript port of the
   reference Python client (Phantombot-Unleashed/termina_bridge.py) — same
   request/response shapes, same is_mission_done() logic — with ONE
   deliberate behavioral difference called out below.

   Deliberate departure from the Python reference: that script's
   ensure_running() auto-launches Termina (Electron or `node server.js`) if
   it isn't already up. This module's ensureRunning() does NOT — a server
   backend silently spawning processes on the business owner's machine is a
   different risk profile than a user's own local desktop script doing the
   same thing for themselves. If Termina isn't reachable, callers get a
   clear, typed error to surface to the user ("start Termina first"), never
   a silent auto-launch.

   This module never decides on its own whether a mission may start. Every
   exported function here is a plain, unauthenticated HTTP call — the
   approval gate lives one layer up, in the "termina_mission" executor
   registered with the shared agent-run engine (see
   ./termina-mission-executor.ts), which only ever invokes decompose()/
   createMission() from inside an executor that the agent-run engine itself
   refuses to run until a real, separate approval action has happened. */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
// server/src/phantom-ai/termina-bridge.ts -> up three levels -> repo root
const repoRoot = resolve(moduleDir, "../../..");

const DEFAULT_TERMINA_URL = "http://127.0.0.1:7420";

/* ---------------- env-driven config ----------------
   Matches the rest of server/src's convention of reading process.env
   directly with an in-code default (see phantom-ai/agent-runs.ts's
   PHANTOM_RUN_APPROVAL_DEADLINE_MS, workspace-approvals's
   PHANTOMFORCE_WORKSPACE_APPROVAL_DIR) rather than a central config module.
   Callers (index.ts) read these once per request/call and pass plain
   arguments into the functions below, which keeps every function here easy
   to unit test with a mocked fetch and an explicit baseUrl/token. */

export function terminaUrlFromEnv(): string {
  return process.env.TERMINA_URL?.trim() || DEFAULT_TERMINA_URL;
}

export function terminaTokenFromEnv(): string {
  return process.env.TERMINA_TOKEN?.trim() || "";
}

export function terminaConfigured(): boolean {
  return Boolean(terminaTokenFromEnv());
}

/* PhantomForce's own repo checkout — the workspaceRoot missions operate
   against by default. Overridable for anyone who wants Termina working
   against a different checkout, but always a real, explicit path this
   server controls; never something a chat user can supply. */
export function terminaWorkspaceRootFromEnv(): string {
  return process.env.PHANTOMFORCE_TERMINA_WORKSPACE_ROOT?.trim() || repoRoot;
}

/* ---------------- errors ---------------- */

export class TerminaError extends Error {}

/* Distinct type so callers can catch this specifically and show "start
   Termina first" instead of a generic failure message. */
export class TerminaNotRunningError extends TerminaError {}

/* ---------------- low-level request helper ---------------- */

async function terminaFetch<T>(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-Termina-Token"] = token;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new TerminaError(`Could not reach Termina: ${error instanceof Error ? error.message : String(error)}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new TerminaError(`Termina returned an invalid response: ${error instanceof Error ? error.message : String(error)}`);
  }

  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (!record.ok) {
    throw new TerminaError(typeof record.error === "string" ? record.error : `Termina request failed (${response.status}).`);
  }
  return record as T;
}

/* ---------------- health ---------------- */

/* Swallows every error (network refused, timeout, non-200, malformed body)
   and reports false — this is a liveness probe, never something that should
   throw and take down a caller that just wants a yes/no. */
export async function isRunning(baseUrl: string, token: string, timeoutMs = 3_000): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["X-Termina-Token"] = token;
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/* Checks liveness only. Deliberately does NOT auto-launch Termina if it is
   down (see module header) — throws a clear, typed error instead so the
   caller can tell the user "start Termina locally first," rather than this
   backend spawning a process on the owner's machine on its own. */
export async function ensureRunning(baseUrl: string, token: string, timeoutMs = 3_000): Promise<void> {
  const running = await isRunning(baseUrl, token, timeoutMs);
  if (!running) {
    throw new TerminaNotRunningError(
      `Termina isn't running at ${baseUrl}. Start it locally (the Termina app, or \`node server.js\` in its project folder) and try again — PhantomForce will not start it for you.`,
    );
  }
}

/* ---------------- mission API ---------------- */

export type TerminaRole = {
  name: string;
  scope?: string;
  deliverables?: string[];
  prohibited?: string[];
  [key: string]: unknown;
};

export type TerminaDecomposeResult = {
  roles: TerminaRole[];
  missionName: string;
  costUsd: number | null;
};

/* This call is a real LLM invocation on Termina's side with real cost, even
   though it doesn't spawn workers — callers must only invoke this after the
   user has already approved a mission, never as a speculative "let's see
   what it would look like" preview. See termina-mission-executor.ts. */
export async function decompose(
  baseUrl: string,
  token: string,
  objective: string,
  workspaceRoot: string,
  workerCount?: number,
): Promise<TerminaDecomposeResult> {
  const trimmed = objective.trim();
  if (!trimmed) throw new TerminaError("An objective is required to decompose a mission.");
  const body: Record<string, unknown> = { objective: trimmed, workspaceRoot };
  if (workerCount !== undefined) body.workerCount = workerCount;
  const payload = await terminaFetch<{ roles: TerminaRole[]; missionName: string; costUsd?: number }>(
    baseUrl,
    token,
    "POST",
    "/api/missions/decompose",
    body,
  );
  return { roles: payload.roles, missionName: payload.missionName, costUsd: payload.costUsd ?? null };
}

export type TerminaWorkerStatus = "starting" | "running" | "blocked" | "failed" | "stopped";

export type TerminaWorker = {
  id: string;
  name: string;
  status: TerminaWorkerStatus;
  [key: string]: unknown;
};

export type TerminaLaunchMode = "plan" | "approval" | "auto";

export type TerminaMission = {
  id: string;
  name: string;
  objective: string;
  workspaceRoot: string;
  launchMode: TerminaLaunchMode;
  isolated?: boolean;
  status: string;
  createdAt: string;
  workers: TerminaWorker[];
  [key: string]: unknown;
};

/* createMission() hardcodes launchMode: "approval" — Termina's OWN
   per-worker approval mode, an additional safety layer on top of the "did
   the user approve starting this mission at all" gate this bridge exists
   for. There is deliberately no `launchMode` parameter here at all, so
   nothing upstream can ever pass "auto" through this function. */
export async function createMission(
  baseUrl: string,
  token: string,
  input: { name?: string; objective: string; workspaceRoot: string; roles: TerminaRole[] },
): Promise<TerminaMission> {
  const body = {
    name: input.name,
    objective: input.objective,
    workspaceRoot: input.workspaceRoot,
    roles: input.roles,
    launchMode: "approval" as const,
  };
  const payload = await terminaFetch<{ mission: TerminaMission }>(baseUrl, token, "POST", "/api/missions", body);
  return payload.mission;
}

export type TerminaLedgerEvent = {
  workerId?: string;
  type?: string;
  [key: string]: unknown;
};

export async function getMission(
  baseUrl: string,
  token: string,
  missionId: string,
): Promise<{ mission: TerminaMission; ledger: TerminaLedgerEvent[]; tokens: Record<string, unknown> }> {
  const payload = await terminaFetch<{ mission: TerminaMission; ledger?: TerminaLedgerEvent[]; tokens?: Record<string, unknown> }>(
    baseUrl,
    token,
    "GET",
    `/api/missions/${encodeURIComponent(missionId)}`,
  );
  return { mission: payload.mission, ledger: payload.ledger ?? [], tokens: payload.tokens ?? {} };
}

export async function listRepos(baseUrl: string, token: string): Promise<unknown[]> {
  const payload = await terminaFetch<{ repos: unknown[] }>(baseUrl, token, "GET", "/api/repos");
  return payload.repos ?? [];
}

export async function synthesize(
  baseUrl: string,
  token: string,
  missionId: string,
): Promise<{ report: unknown; markdown: string; costUsd: number | null }> {
  const payload = await terminaFetch<{ report: unknown; markdown: string; costUsd?: number }>(
    baseUrl,
    token,
    "POST",
    `/api/missions/${encodeURIComponent(missionId)}/synthesize`,
    {},
  );
  return { report: payload.report, markdown: payload.markdown, costUsd: payload.costUsd ?? null };
}

/* ---------------- mission completion check ----------------
   Ported exactly from termina_bridge.py's is_mission_done(): worker.status
   (server.js) only ever takes starting/running/blocked/failed/stopped —
   there is no "completed" status, so a worker that finishes successfully
   simply stays at "running" as far as its coarse status goes. Normal
   completion (success or failure) is self-reported by CLI workers via the
   TERMINA_EVENT: ledger protocol, keyed by workerId. So: a worker counts as
   done if EITHER its own status is a terminal *abnormal* one (failed/
   stopped) OR the ledger has a COMPLETE/FAILED event for its workerId. */
const TERMINAL_WORKER_STATUSES: ReadonlySet<string> = new Set(["failed", "stopped"]);
const TERMINAL_LEDGER_EVENT_TYPES: ReadonlySet<string> = new Set(["COMPLETE", "FAILED"]);

export function isMissionDone(
  mission: { workers?: Array<{ id?: string; status?: string }> },
  ledger: Array<{ workerId?: string; type?: string }>,
): boolean {
  const workers = mission.workers ?? [];
  if (!workers.length) return true;
  const completedWorkerIds = new Set(
    ledger
      .filter((event) => typeof event.type === "string" && TERMINAL_LEDGER_EVENT_TYPES.has(event.type))
      .map((event) => event.workerId),
  );
  for (const worker of workers) {
    if (typeof worker.status === "string" && TERMINAL_WORKER_STATUSES.has(worker.status)) continue;
    if (worker.id !== undefined && completedWorkerIds.has(worker.id)) continue;
    return false;
  }
  return true;
}
