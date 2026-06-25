import { getAccessDecision, getClientAccess } from "./client-access-state.js";

export type WorkspaceAccessMode = "full" | "read_only" | "blocked";

export type WorkspaceAccessDecision = {
  allowed: boolean;
  mode: WorkspaceAccessMode;
  reason: string;
  modules: string[];
};

function normalizeModuleKey(moduleKey: string) {
  return moduleKey.trim().toLowerCase();
}

export function getWorkspaceAccess(clientId: string) {
  const record = getClientAccess(clientId);

  if (!record) {
    return undefined;
  }

  return {
    record,
    decision: getAccessDecision(clientId) as WorkspaceAccessDecision,
  };
}

export function assertWorkspaceAccess(clientId: string) {
  const access = getWorkspaceAccess(clientId);

  if (!access) {
    return {
      ok: false as const,
      statusCode: 404,
      error: "Client workspace not found.",
    };
  }

  if (!access.decision.allowed) {
    return {
      ok: false as const,
      statusCode: 403,
      error: access.decision.reason,
      record: access.record,
      decision: access.decision,
    };
  }

  return {
    ok: true as const,
    record: access.record,
    decision: access.decision,
  };
}

export function assertModuleAccess(clientId: string, moduleKey: string) {
  const workspace = assertWorkspaceAccess(clientId);

  if (!workspace.ok) {
    return workspace;
  }

  const requested = normalizeModuleKey(moduleKey);
  const allowed = workspace.decision.modules.some((module) => normalizeModuleKey(module) === requested);

  if (!allowed) {
    return {
      ok: false as const,
      statusCode: 403,
      error: `Module '${moduleKey}' is not enabled for this client workspace.`,
      record: workspace.record,
      decision: workspace.decision,
    };
  }

  return {
    ok: true as const,
    record: workspace.record,
    decision: workspace.decision,
    module: moduleKey,
  };
}
