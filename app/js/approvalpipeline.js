import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260721-1";

const authHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load server-backed approvals." }));
  return payload;
}

export function approvalServerAvailable() {
  return Boolean(session.token());
}

export function approvalTenantQuery() {
  return `tenant_id=${encodeURIComponent(currentTenantId())}`;
}

export async function loadWorkspaceApprovals() {
  return api(`/api/workspace-approvals?${approvalTenantQuery()}`);
}

export async function createWorkspaceApproval(approval) {
  return api("/api/workspace-approvals", {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), approval }),
  });
}

export async function decideWorkspaceApproval(approvalId, patch) {
  return api(`/api/workspace-approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), patch }),
  });
}

export async function deleteWorkspaceApproval(approvalId) {
  return api(`/api/workspace-approvals/${encodeURIComponent(approvalId)}?${approvalTenantQuery()}`, { method: "DELETE" });
}
