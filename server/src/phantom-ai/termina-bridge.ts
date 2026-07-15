/* Termina Mission Bridge — vertical slice.
   Per docs/superpowers/specs/2026-07-15-termina-mission-bridge-design.md.

   Wires Termina (C:\Users\jorda\Termina, server.js) into PhantomForce as a
   thin HTTP client. PhantomForce does not reimplement mission orchestration,
   worktree isolation, or worker/LLM decomposition -- Termina already does all
   of that. This module is a client of Termina's existing REST API plus:

   1. A health check ("is Termina running") -- the entire "Phantom Node"
      concept for this slice, no separate registration/handshake protocol.
   2. A single approved-workspace allow-list entry (TERMINA_APPROVED_WORKSPACE_ROOT).
      Termina's own /api/missions/decompose and POST /api/missions both take
      a workspaceRoot; this bridge NEVER accepts one from the caller -- it
      always substitutes its own configured, allow-listed path, so there is
      no way to point a mission at an arbitrary directory (production repos
      included) through this bridge.
   3. A two-tier approval gate: decomposeObjective() (observe, no approval)
      vs. actually starting workers (requires a confirmed, time-limited
      approval record -- see createMissionApproval/confirmMissionStart).

   Deviation from the full design doc, noted for whoever picks this up next:
   the doc specifies a `GET /phantom-ai/missions/ws` relay backed by
   @fastify/websocket. This server has no WebSocket infrastructure today, and
   adding a new global Fastify plugin was judged out of scope for this slice
   -- the frontend instead short-polls GET /phantom-ai/missions/:id while a
   Termina-backed mission is active. Functionally equivalent for one owner
   workstation; revisit if multi-client live-push actually matters later. */

import { randomUUID } from "node:crypto";

export function terminaBridgeConfigured() {
  return Boolean(process.env.TERMINA_TOKEN);
}

function baseUrl() {
  return process.env.TERMINA_BASE_URL || "http://127.0.0.1:7420";
}

function approvedWorkspaceRoot() {
  return process.env.TERMINA_APPROVED_WORKSPACE_ROOT || "C:\\Users\\jorda\\Documents\\phantom-vertical-slice-test";
}

async function terminaFetch(path: string, options: { method?: string; body?: unknown } = {}) {
  const token = process.env.TERMINA_TOKEN;
  if (!token) throw new Error("Termina is not configured (TERMINA_TOKEN is unset).");
  const response = await fetch(`${baseUrl()}${path}`, {
    method: options.method || "GET",
    headers: { "x-termina-token": token, ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `Termina request failed (${response.status}).`);
  }
  return payload;
}

export async function terminaHealth(): Promise<{ reachable: boolean; reason?: string }> {
  if (!terminaBridgeConfigured()) return { reachable: false, reason: "not_configured" };
  try {
    await terminaFetch("/api/health");
    return { reachable: true };
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : "unreachable" };
  }
}

export type TerminaRole = { name: string; scope: string; deliverables: string[]; prohibited: string[] };

/* Observe tier: no approval needed to see a plan. */
export async function decomposeMissionObjective(objective: string): Promise<{ roles: TerminaRole[]; missionName: string; costUsd: number }> {
  const trimmed = objective.trim();
  if (!trimmed) throw new Error("An objective is required.");
  return terminaFetch("/api/missions/decompose", { method: "POST", body: { objective: trimmed, workspaceRoot: approvedWorkspaceRoot() } });
}

/* ---- mission-start approval gate ----
   In-memory, single-process store (this is an owner-workstation vertical
   slice, not a durable multi-instance queue). Expires 15 minutes after
   creation if never confirmed, per the design doc's approval-gate section. */
type PendingMissionApproval = {
  id: string;
  requestedByLabel: string;
  missionName: string;
  objective: string;
  roles: TerminaRole[];
  createdAt: number;
  expiresAt: number;
};
const pendingApprovals = new Map<string, PendingMissionApproval>();
const APPROVAL_TTL_MS = 15 * 60 * 1000;

function pruneExpiredApprovals() {
  const now = Date.now();
  for (const [id, approval] of pendingApprovals) if (approval.expiresAt <= now) pendingApprovals.delete(id);
}

export function createMissionApproval(input: { requestedByLabel: string; missionName: string; objective: string; roles: TerminaRole[] }) {
  pruneExpiredApprovals();
  const id = `termina-appr-${randomUUID()}`;
  const createdAt = Date.now();
  const approval: PendingMissionApproval = { id, createdAt, expiresAt: createdAt + APPROVAL_TTL_MS, ...input };
  pendingApprovals.set(id, approval);
  return { approvalId: id, expiresAt: new Date(approval.expiresAt).toISOString() };
}

export function getMissionApproval(approvalId: string) {
  pruneExpiredApprovals();
  return pendingApprovals.get(approvalId) || null;
}

/* Work-inside-approved-projects tier: actually starts real workers. Requires
   a confirmed, unexpired approval record; consumes it (one-time use). */
export async function confirmMissionStart(approvalId: string) {
  const approval = getMissionApproval(approvalId);
  if (!approval) return null; // not found or expired -- caller maps this to 404, distinct from a Termina call failure
  pendingApprovals.delete(approvalId);
  const mission = await terminaFetch("/api/missions", {
    method: "POST",
    body: {
      name: approval.missionName,
      objective: approval.objective,
      workspaceRoot: approvedWorkspaceRoot(),
      roles: approval.roles,
      launchMode: "approval",
    },
  });
  return mission.mission;
}

export async function getMission(missionId: string) {
  return terminaFetch(`/api/missions/${encodeURIComponent(missionId)}`);
}

export async function missionWorkerAction(missionId: string, workerId: string, action: "stop" | "retry") {
  const result = await terminaFetch(`/api/missions/${encodeURIComponent(missionId)}/workers/${encodeURIComponent(workerId)}/${action}`, { method: "POST" });
  return result.worker;
}

export async function synthesizeMission(missionId: string) {
  return terminaFetch(`/api/missions/${encodeURIComponent(missionId)}/synthesize`, { method: "POST" });
}

export async function getMissionReport(missionId: string) {
  return terminaFetch(`/api/missions/${encodeURIComponent(missionId)}/report`);
}
