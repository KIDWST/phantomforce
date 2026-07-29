import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260729-87";
import { createLatestOperation, normalizeOperationStatus } from "./product-grammar.js?v=phantom-live-20260729-87";

const PULSE_TTL_MS = 45_000;
const BRAIN_CONTRACT_TTL_MS = 45_000;
const pulseRequest = createLatestOperation("organization-pulse");
const brainRequest = createLatestOperation("brain-contract");

function pulseCurtainText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/phantomcut.+(?:unreachable|offline|failed)/i.test(text)) return "Media creation is reconnecting.";
  return text
    .replace(/\b(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[?::1\]?)(?::\d+)?(?:\/[^\s),;]*)?/gi, "the local service")
    .replace(/\b(?:127\.0\.0\.1|localhost)(?::\d+)\b/gi, "the local service")
    .replace(/\bbackend\b/gi, "workspace service")
    .replace(/\bprovider\b/gi, "service")
    .replace(/\bOAuth\b/gi, "account connection")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pulseWorkflowTitle(job = {}) {
  const name = String(job.name || "").trim();
  if (/phantomcut|media.+health/i.test(name)) return "Media creation needs attention";
  return name ? `Workflow needs attention: ${pulseCurtainText(name)}` : "Workflow needs attention";
}

function pulseSignalTitle(signal = {}) {
  const title = pulseCurtainText(signal.title || "Business signal");
  if (/platform automation failing|automation failing/i.test(title)) return "Workflow needs attention";
  return title;
}

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
  pulseRequest.cancel("tenant-changed");
  brainRequest.cancel("tenant-changed");
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
  const request = pulseRequest.begin({ tenant: state.tenant });
  const params = new URLSearchParams();
  if (state.tenant) params.set("tenant_id", state.tenant);
  try {
    const response = await fetch(`/api/organization/pulse?${params.toString()}`, { headers: authHeaders(), signal: request.signal });
    const payload = await response.json().catch(() => ({}));
    if (!request.isCurrent() || state.tenant !== request.context.tenant) return null;
    if (!response.ok || !payload?.ok || !payload?.pulse) {
      state.status = "error";
      state.error = friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load Organization Pulse.", fallbackPrefix: "Organization Pulse failed" });
      throw new Error(state.error);
    }
    state.pulse = payload.pulse;
    state.loadedAt = Date.now();
    state.status = "ready";
    state.operationStatus = normalizeOperationStatus("completed", { verified: true });
    return state.pulse;
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError" || !request.isCurrent()) return null;
    throw error;
  } finally {
    pulseRequest.finish(request);
  }
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
  const request = brainRequest.begin({ tenant: state.tenant });
  const params = new URLSearchParams();
  if (state.tenant) params.set("tenant_id", state.tenant);
  try {
    const response = await fetch(`/api/brain/contract?${params.toString()}`, { headers: authHeaders(), signal: request.signal });
    const payload = await response.json().catch(() => ({}));
    if (!request.isCurrent() || state.tenant !== request.context.tenant) return null;
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
    state.brainOperationStatus = normalizeOperationStatus("completed", { verified: true });
    return state.brainContract;
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError" || !request.isCurrent()) return null;
    throw error;
  } finally {
    brainRequest.finish(request);
  }
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
    title: pulseSignalTitle(signal),
    sub: pulseCurtainText(signal.recommendedAction?.label || signal.whatHappened || "Review the signal"),
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
        sub: "Workspace approvals",
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
      title: pulseWorkflowTitle(job),
      sub: pulseCurtainText(job.lastSummary || "Open workflows"),
      open: "automation",
    }));
  }
  return items.slice(0, 6);
}
