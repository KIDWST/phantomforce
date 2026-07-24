/* PhantomForce — external security monitor status (ClamAV/Defender +
   HIBP breach + Pwned Passwords). Wraps /phantom-ai/security/external-monitor/*
   with the same caching/honest-empty-state idiom as organizationpulse.js.
   Never fabricates a scan result: shows "not yet scanned" until a real
   scan has actually run and been persisted server-side. */
import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260723-60";
import { createLatestOperation } from "./product-grammar.js?v=phantom-live-20260723-60";

const STATUS_TTL_MS = 45_000;
const statusRequest = createLatestOperation("security-monitor-status");

const state = {
  tenant: "",
  status: "idle",
  monitor: null,
  error: "",
  loadedAt: 0,
  running: false,
};

function syncTenant() {
  const tenant = currentTenantId();
  if (state.tenant === tenant) return;
  state.tenant = tenant;
  state.status = "idle";
  state.monitor = null;
  state.error = "";
  state.loadedAt = 0;
  statusRequest.cancel("tenant-changed");
}

function authHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export function securityMonitorAvailable() {
  return Boolean(typeof session?.token === "function" && session.token());
}

export function cachedSecurityMonitorStatus() {
  syncTenant();
  return state.monitor;
}

export function securityMonitorIsAdmin() {
  syncTenant();
  return Boolean(state.monitor && !state.monitor.details_redacted);
}

export function shouldRefreshSecurityMonitorStatus(maxAgeMs = STATUS_TTL_MS) {
  syncTenant();
  if (!securityMonitorAvailable() || state.status === "loading") return false;
  if (!state.monitor) return true;
  return Date.now() - state.loadedAt > maxAgeMs;
}

export async function loadSecurityMonitorStatus({ force = false } = {}) {
  syncTenant();
  if (!securityMonitorAvailable()) {
    state.status = "unavailable";
    state.monitor = null;
    state.error = "Sign in to load security status.";
    return null;
  }
  if (!force && state.monitor && Date.now() - state.loadedAt <= STATUS_TTL_MS) return state.monitor;
  state.status = "loading";
  state.error = "";
  const request = statusRequest.begin({ tenant: state.tenant });
  try {
    const response = await fetch("/phantom-ai/security/external-monitor/status", { headers: authHeaders(), signal: request.signal });
    const payload = await response.json().catch(() => ({}));
    if (!request.isCurrent() || state.tenant !== request.context.tenant) return null;
    if (!response.ok || !payload?.ok || !payload?.monitor) {
      state.status = "error";
      state.error = friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in to load security status.", fallbackPrefix: "Security status failed" });
      throw new Error(state.error);
    }
    state.monitor = { ...payload.monitor, details_redacted: Boolean(payload.details_redacted) };
    state.loadedAt = Date.now();
    state.status = "ready";
    return state.monitor;
  } catch (error) {
    if (request.signal.aborted || error?.name === "AbortError" || !request.isCurrent()) return null;
    throw error;
  } finally {
    statusRequest.finish(request);
  }
}

/* Admin-only, local-only trigger: posts an empty body, so only ClamAV/Defender
   + local content scan run — no domains/emails means no external network
   calls (see runExternalSecurityMonitor's externalEnabled branch), so this
   never surprises anyone with an HIBP API charge. */
export async function runSecurityMonitorScan() {
  if (!securityMonitorAvailable() || state.running) return null;
  state.running = true;
  try {
    const response = await fetch("/phantom-ai/security/external-monitor/run", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(friendlyBackendError(response.status, payload?.error, { fallbackPrefix: "Security scan failed" }));
    }
    return loadSecurityMonitorStatus({ force: true });
  } finally {
    state.running = false;
  }
}

export function securityMonitorRunning() {
  return state.running;
}
