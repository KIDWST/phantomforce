import { currentTenantId, session } from "./store.js?v=phantom-live-20260713-247";
import { loadCrmLeads } from "./crmpipeline.js?v=phantom-live-20260713-247";
import { loadProposals } from "./proposalpipeline.js?v=phantom-live-20260713-247";

const RECORD_TTL_MS = 45_000;

const state = {
  tenant: "",
  status: "idle",
  leads: [],
  proposals: [],
  error: "",
  loadedAt: 0,
};

function syncTenant() {
  const tenant = currentTenantId();
  if (state.tenant === tenant) return;
  state.tenant = tenant;
  state.status = "idle";
  state.leads = [];
  state.proposals = [];
  state.error = "";
  state.loadedAt = 0;
}

export function serverRecordsAvailable() {
  return Boolean(typeof session?.token === "function" && session.token());
}

export function cachedServerRecords() {
  syncTenant();
  return { leads: state.leads, proposals: state.proposals, status: state.status, error: state.error };
}

export function shouldRefreshServerRecords(maxAgeMs = RECORD_TTL_MS) {
  syncTenant();
  if (!serverRecordsAvailable() || state.status === "loading") return false;
  if (state.status !== "ready") return true;
  return Date.now() - state.loadedAt > maxAgeMs;
}

export async function loadServerRecords({ force = false } = {}) {
  syncTenant();
  if (!serverRecordsAvailable()) {
    state.status = "unavailable";
    state.leads = [];
    state.proposals = [];
    state.error = "Sign in to search server records.";
    return cachedServerRecords();
  }
  if (!force && state.status === "ready" && Date.now() - state.loadedAt <= RECORD_TTL_MS) return cachedServerRecords();
  state.status = "loading";
  state.error = "";
  const [crmResult, proposalResult] = await Promise.allSettled([loadCrmLeads(), loadProposals()]);
  if (crmResult.status === "fulfilled") {
    state.leads = Array.isArray(crmResult.value?.document?.leads) ? crmResult.value.document.leads : [];
  }
  if (proposalResult.status === "fulfilled") {
    state.proposals = Array.isArray(proposalResult.value?.document?.proposals) ? proposalResult.value.document.proposals : [];
  }
  if (crmResult.status === "rejected" && proposalResult.status === "rejected") {
    state.status = "error";
    state.error = "Server CRM and proposal records could not be read.";
    throw new Error(state.error);
  }
  state.status = "ready";
  state.loadedAt = Date.now();
  return cachedServerRecords();
}
