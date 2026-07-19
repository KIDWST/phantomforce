import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260718-43";

const PULSE_TTL_MS = 45_000;
const BRAIN_CONTRACT_TTL_MS = 45_000;

const state = {
  tenant: "",
  status: "idle",
  pulse: null,
  brainContractStatus: "idle",
  brainContract: null,
  error: "",
  brainContractError: "",
  loadedAt: 0,
  brainContractLoadedAt: 0,
};

function syncTenant() {
  const tenant = currentTenantId();
  if (state.tenant === tenant) return;
  state.tenant = tenant;
  state.status = "idle";
  state.pulse = null;
  state.brainContractStatus = "idle";
  state.brainContract = null;
  state.error = "";
  state.brainContractError = "";
  state.loadedAt = 0;
  state.brainContractLoadedAt = 0;
}

function authHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function plural(count, one, many = `${one}s`) {
  return `${Number(count || 0)} ${Number(count || 0) === 1 ? one : many}`;
}

export function organizationPulseAvailable() {
  return Boolean(typeof session?.token === "function" && session.token());
}

export function brainContractAvailable() {
  return organizationPulseAvailable();
}

export function organizationPulseState() {
  syncTenant();
  return state;
}

export function cachedOrganizationPulse() {
  syncTenant();
  return state.pulse;
}

export function cachedBrainContract() {
  syncTenant();
  return state.brainContract;
}

export function shouldRefreshOrganizationPulse(maxAgeMs = PULSE_TTL_MS) {
  syncTenant();
  if (!organizationPulseAvailable() || state.status === "loading") return false;
  if (!state.pulse) return true;
  return Date.now() - state.loadedAt > maxAgeMs;
}

export function shouldRefreshBrainContract(maxAgeMs = BRAIN_CONTRACT_TTL_MS) {
  syncTenant();
  if (!brainContractAvailable() || state.brainContractStatus === "loading") return false;
  if (!state.brainContract) return true;
  return Date.now() - state.brainContractLoadedAt > maxAgeMs;
}

export async function loadOrganizationPulse({ force = false } = {}) {
  syncTenant();
  if (!organizationPulseAvailable()) {
    state.status = "unavailable";
    state.pulse = null;
    state.error = "Sign in to load Organization Pulse.";
    return null;
  }
  if (!force && state.pulse && Date.now() - state.loadedAt <= PULSE_TTL_MS) return state.pulse;
  state.status = "loading";
  state.error = "";
  const params = new URLSearchParams();
  if (state.tenant) params.set("tenant_id", state.tenant);
  const response = await fetch(`/api/organization/pulse?${params.toString()}`, { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.pulse) {
    state.status = "error";
    state.error = friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load Organization Pulse.", fallbackPrefix: "Organization Pulse failed" });
    throw new Error(state.error);
  }
  state.pulse = payload.pulse;
  state.loadedAt = Date.now();
  state.status = "ready";
  return state.pulse;
}

export async function loadBrainContract({ force = false } = {}) {
  syncTenant();
  if (!brainContractAvailable()) {
    state.brainContractStatus = "unavailable";
    state.brainContract = null;
    state.brainContractError = "Sign in to load Brain Signals.";
    return null;
  }
  if (!force && state.brainContract && Date.now() - state.brainContractLoadedAt <= BRAIN_CONTRACT_TTL_MS) return state.brainContract;
  state.brainContractStatus = "loading";
  state.brainContractError = "";
  const params = new URLSearchParams();
  if (state.tenant) params.set("tenant_id", state.tenant);
  const response = await fetch(`/api/brain/contract?${params.toString()}`, { headers: authHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    state.brainContractStatus = "error";
    state.brainContractError = friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load Brain Signals.", fallbackPrefix: "Brain Signals failed" });
    throw new Error(state.brainContractError);
  }
  state.brainContract = {
    tenantId: payload.tenantId,
    generatedAt: payload.generatedAt,
    whatChanged: Array.isArray(payload.whatChanged) ? payload.whatChanged : [],
    whatMatters: Array.isArray(payload.whatMatters) ? payload.whatMatters : [],
    recommendedActions: Array.isArray(payload.recommendedActions) ? payload.recommendedActions : [],
  };
  state.brainContractLoadedAt = Date.now();
  state.brainContractStatus = "ready";
  return state.brainContract;
}

function signalIcon(signal = {}) {
  const department = String(signal.department || "").toLowerCase();
  const route = String(signal.recommendedAction?.route || "").toLowerCase();
  if (route.includes("approval") || department === "operations") return "check";
  if (route.includes("automation") || department === "technology") return "auto";
  if (route.includes("crm") || department === "growth" || department === "client care") return "users";
  if (route.includes("asset") || department === "creative") return "media";
  if (route.includes("competitor") || department === "intelligence") return "chart";
  if (department === "finance") return "dollar";
  return "brain";
}

function signalTone(signal = {}) {
  if (signal.impact === "high") return "warn";
  if (signal.impact === "medium") return "ok";
  return "neutral";
}

export function brainContractAttentionItems(contract = cachedBrainContract()) {
  if (!contract) return [];
  const signals = [
    ...(Array.isArray(contract.whatChanged) ? contract.whatChanged : []),
    ...(Array.isArray(contract.recommendedActions) ? contract.recommendedActions : []),
    ...(Array.isArray(contract.whatMatters) ? contract.whatMatters : []),
  ];
  const seen = new Set();
  return signals.filter((signal) => {
    const id = signal?.id || signal?.title;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 6).map((signal) => ({
    icon: signalIcon(signal),
    tone: signalTone(signal),
    title: signal.title || "Business signal",
    sub: signal.recommendedAction?.label || signal.whatHappened || "Review the signal",
    open: signal.recommendedAction?.route || "analytics",
    signal,
  }));
}

export function pulsePendingApprovalCount(pulse = cachedOrganizationPulse()) {
  const growth = pulse?.managedGrowth;
  if (growth?.available) return Number(growth.pendingWorkspaceApprovals || 0);
  const approvals = pulse?.approvals;
  return approvals?.available ? Number(approvals.pending || 0) : 0;
}

export function pulseAttentionItems(pulse = cachedOrganizationPulse()) {
  if (!pulse) return [];
  const items = [];
  const growth = pulse.managedGrowth;
  if (growth?.available) {
    if (growth.pendingWorkspaceApprovals) {
      items.push({
        icon: "check",
        tone: "warn",
        title: `${plural(growth.pendingWorkspaceApprovals, "approval")} waiting`,
        sub: "Server-backed workspace approvals",
        open: "approvals",
      });
    }
    if (growth.followUpsDue) {
      items.push({
        icon: "users",
        tone: "warn",
        title: `${plural(growth.followUpsDue, "follow-up")} due`,
        sub: `${plural(growth.openLeads, "open lead")} in Clients`,
        open: "leads",
      });
    }
    if (growth.nextActions?.some((action) => action.surface === "proposals")) {
      items.push({
        icon: "dollar",
        tone: "ok",
        title: "Proposal review ready",
        sub: `$${Number(growth.proposalPipeline || 0).toLocaleString()} internal pipeline`,
        open: "proposals",
      });
    }
    if (growth.activeClients < 2) {
      items.push({
        icon: "users",
        tone: "warn",
        title: "Client setup incomplete",
        sub: `${growth.activeClients}/2 active clients configured`,
        open: "clientsetup",
      });
    }
  }
  const runs = pulse.agentRuns;
  if (runs?.available && runs.failed) {
    items.push({
      icon: "auto",
      tone: "warn",
      title: `${plural(runs.failed, "run")} failed`,
      sub: "Review agent activity",
      open: "automation",
    });
  }
  const automations = pulse.automations;
  if (automations?.available) {
    automations.failing?.slice(0, 2).forEach((job) => items.push({
      icon: "auto",
      tone: "warn",
      title: `Automation failing: ${job.name}`,
      sub: job.lastSummary || "Open Automations",
      open: "automation",
    }));
  }
  return items.slice(0, 6);
}
