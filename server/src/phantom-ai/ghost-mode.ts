import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";
import { appendHermesLedgerRecord } from "./hermes-ledger.js";

/* Ghost Mode: a hard privacy switch for Phantom AI chat. When enabled for a
   workspace, every chat request is restricted to the local_ollama provider
   only - codex_cli, claude_cli, and openrouter_glm are never attempted, so
   no request text ever leaves the machine. This trades reasoning quality
   (local models only) for a real, verifiable "100% local" guarantee, which
   is the point: normal operation already prefers cloud reasoning routes for
   quality, so this only exists for the user who wants the stronger promise
   and accepts the tradeoff. */

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_GHOST_MODE_PATH || resolve(repoRoot, ".phantom", "ghost-mode.json");

type GhostModeWorkspaceState = {
  workspaceId: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
};

type GhostModeStore = { version: 1; workspaces: Record<string, GhostModeWorkspaceState> };

const now = () => new Date().toISOString();
const workspaceIdFor = (session: AccessSession) => session.clientId || session.id || "owner-admin";

function freshState(session: AccessSession): GhostModeWorkspaceState {
  return { workspaceId: workspaceIdFor(session), enabled: false, updatedAt: now(), updatedBy: null };
}

async function readStore(): Promise<GhostModeStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as { workspaces?: Record<string, GhostModeWorkspaceState> };
    return { version: 1, workspaces: parsed.workspaces || {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, workspaces: {} };
    throw error;
  }
}

async function writeStore(store: GhostModeStore) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
}

export async function getGhostModeStatus(session: AccessSession) {
  const store = await readStore();
  const id = workspaceIdFor(session);
  const state = store.workspaces[id] || freshState(session);
  return {
    enabled: state.enabled,
    updated_at: state.updatedAt,
    detail: state.enabled
      ? "Ghost Mode is on. Phantom AI chat only calls the local model - no request text leaves this machine."
      : "Ghost Mode is off. Phantom AI chat may use cloud reasoning routes for better answer quality.",
  };
}

/* Cheap, sync-safe check for the hot chat path - callers already need to
   await getGhostModeStatus once per request anyway, so this just re-exports
   the same read for a single call site instead of duplicating logic. */
export async function isGhostModeEnabled(session: AccessSession): Promise<boolean> {
  const status = await getGhostModeStatus(session);
  return status.enabled;
}

export async function setGhostMode(session: AccessSession, enabled: boolean) {
  const store = await readStore();
  const id = workspaceIdFor(session);
  const state: GhostModeWorkspaceState = { workspaceId: id, enabled, updatedAt: now(), updatedBy: session.id };
  store.workspaces[id] = state;
  await writeStore(store);

  try {
    await appendHermesLedgerRecord({
      timestamp: state.updatedAt,
      tenant_id: id,
      business_name: session.clientId || "PhantomForce",
      actor_user_id: session.id,
      actor_role: session.canManageAccess ? "platform_admin" : "business_owner",
      request_id: `ghost-mode-${state.updatedAt}`,
      task_type: "ghost_mode.toggle",
      sensitivity_level: "low",
      provider_route: "local",
      model_id: "phantomforce-ghost-mode",
      context_chars: 0,
      estimated_tokens: 0,
      estimated_cost_usd: 0,
      user_request_summary: `Ghost Mode ${enabled ? "enabled" : "disabled"}.`,
      result_summary: enabled
        ? "Chat restricted to local_ollama only; cloud provider routes disabled for this workspace."
        : "Cloud provider routes re-enabled for this workspace.",
      approval_required: false,
      approval_status: "not_required",
      risks: [],
      next_action: enabled ? "All chat requests stay on-device." : "Chat may route to cloud providers again.",
    });
  } catch {
    /* ledger write is best-effort; the toggle itself must not fail on it */
  }

  return getGhostModeStatus(session);
}
