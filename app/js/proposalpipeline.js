import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260722-6";

const authHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
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
