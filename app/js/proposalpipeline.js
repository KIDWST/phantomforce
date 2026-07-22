import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260721-4";
import { authHeaders } from "./api-client.js?v=phantom-live-20260721-4";

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load server-backed proposals." }));
  return payload;
}

export function proposalServerAvailable() {
  return Boolean(session.token());
}

export function proposalTenantQuery() {
  return `tenant_id=${encodeURIComponent(currentTenantId())}`;
}

export async function loadProposals() {
  return api(`/api/proposals?${proposalTenantQuery()}`);
}

export async function createProposal(proposal) {
  return api("/api/proposals", {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), proposal }),
  });
}

export async function updateProposal(proposalId, patch) {
  return api(`/api/proposals/${encodeURIComponent(proposalId)}`, {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), patch }),
  });
}

export async function deleteProposal(proposalId) {
  return api(`/api/proposals/${encodeURIComponent(proposalId)}?${proposalTenantQuery()}`, { method: "DELETE" });
}
