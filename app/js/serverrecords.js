import { currentTenantId, session } from "./store.js?v=phantom-live-20260721-4";
import { loadClientSetupDocument } from "./clientsetup.js?v=phantom-live-20260721-4";
import { loadCrmLeads } from "./crmpipeline.js?v=phantom-live-20260721-4";
import { loadProposals } from "./proposalpipeline.js?v=phantom-live-20260721-4";
import { loadWorkspaceApprovals } from "./approvalpipeline.js?v=phantom-live-20260721-4";

const RECORD_TTL_MS = 45_000;

const state = {
  tenant: "",
  status: "idle",
  leads: [],
  proposals: [],
  approvals: [],
  setupSlots: [],
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
  state.approvals = [];
  state.setupSlots = [];
  state.error = "";
  state.loadedAt = 0;
}

export function serverRecordsAvailable() {
  return Boolean(typeof session?.token === "function" && session.token());
}

export function cachedServerRecords() {
  syncTenant();
  return {
    leads: state.leads,
    proposals: state.proposals,
    approvals: state.approvals,
    setupSlots: state.setupSlots,
    status: state.status,
    error: state.error,
  };
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
    state.approvals = [];
    state.setupSlots = [];
    state.error = "Sign in to search server records.";
    return cachedServerRecords();
  }
  if (!force && state.status === "ready" && Date.now() - state.loadedAt <= RECORD_TTL_MS) return cachedServerRecords();
  state.status = "loading";
  state.error = "";
  const [crmResult, proposalResult, approvalResult, setupResult] = await Promise.allSettled([
    loadCrmLeads(),
    loadProposals(),
    loadWorkspaceApprovals(),
    loadClientSetupDocument(),
  ]);
  if (crmResult.status === "fulfilled") {
    state.leads = Array.isArray(crmResult.value?.document?.leads) ? crmResult.value.document.leads : [];
  }
  if (proposalResult.status === "fulfilled") {
    state.proposals = Array.isArray(proposalResult.value?.document?.proposals) ? proposalResult.value.document.proposals : [];
  }
  if (approvalResult.status === "fulfilled") {
    state.approvals = Array.isArray(approvalResult.value?.document?.approvals) ? approvalResult.value.document.approvals : [];
  }
  if (setupResult.status === "fulfilled") {
    state.setupSlots = Array.isArray(setupResult.value?.document?.slots) ? setupResult.value.document.slots : [];
  }
  const allRejected = [crmResult, proposalResult, approvalResult, setupResult].every((result) => result.status === "rejected");
  if (allRejected) {
    state.status = "error";
    state.error = "Server workspace records could not be read.";
    throw new Error(state.error);
  }
  state.status = "ready";
  state.loadedAt = Date.now();
  return cachedServerRecords();
}
