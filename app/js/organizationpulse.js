import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260715-2";

const PULSE_TTL_MS = 45_000;

const state = {
  tenant: "",
  status: "idle",
  pulse: null,
  error: "",
  loadedAt: 0,
};

function syncTenant() {
  const tenant = currentTenantId();
  if (state.tenant === tenant) return;
  state.tenant = tenant;
  state.status = "idle";
  state.pulse = null;
  state.error = "";
  state.loadedAt = 0;
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

export function organizationPulseState() {
  syncTenant();
  return state;
}

export function cachedOrganizationPulse() {
  syncTenant();
  return state.pulse;
}

export function shouldRefreshOrganizationPulse(maxAgeMs = PULSE_TTL_MS) {
  syncTenant();
  if (!organizationPulseAvailable() || state.status === "loading") return false;
  if (!state.pulse) return true;
  return Date.now() - state.loadedAt > maxAgeMs;
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
