import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260723-45";

export const CRM_REFRESH_SIGNAL_KEY = "pf.crm.refresh.v1";

const authHeaders = (json = false) => {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
};

export function signalCrmRefresh(reason = "crm-updated") {
  try { globalThis.sessionStorage?.setItem(CRM_REFRESH_SIGNAL_KEY, `${Date.now()}:${reason}`); } catch {}
}

export function crmRefreshSignal() {
  try { return globalThis.sessionStorage?.getItem(CRM_REFRESH_SIGNAL_KEY) || ""; } catch { return ""; }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load server-backed CRM." }));
  return payload;
}

export function crmServerAvailable() {
  return Boolean(session.token());
}

export function crmTenantQuery() {
  return `tenant_id=${encodeURIComponent(currentTenantId())}`;
}

export async function loadCrmLeads() {
  return api(`/api/crm/leads?${crmTenantQuery()}`);
}

export async function createCrmLead(lead) {
  return api("/api/crm/leads", {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), lead }),
  });
}

export async function updateCrmLead(leadId, patch) {
  return api(`/api/crm/leads/${encodeURIComponent(leadId)}`, {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), patch }),
  });
}

export async function deleteCrmLead(leadId) {
  return api(`/api/crm/leads/${encodeURIComponent(leadId)}?${crmTenantQuery()}`, { method: "DELETE" });
}

export async function persistCrmProspectLanes(leads, prompt = "") {
  return api("/api/crm/prospect-lanes", {
    method: "POST",
    body: JSON.stringify({ tenant_id: currentTenantId(), prompt, leads }),
  });
}
