/* One customer-facing connection contract for every external account.
   The browser never asks for developer credentials. Connect is enabled only
   when the server can create a real, signed authorization handoff. */

import { renderSocialSettings } from "./social-settings.js?v=phantom-live-20260820-186";
import { currentTenantId, session } from "./store.js?v=phantom-live-20260820-186";

let connectionState = { loaded: false, loading: false, error: "", connectors: [], notice: "", busyId: "" };
let connectionMount = null;
let connectionOpts = {};

const esc = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function headers(json = false) {
  const token = typeof session?.token === "function" ? session.token() : "";
  const sessionId = typeof session?.get === "function" ? session.get()?.sessionId : "";
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sessionId ? { "x-phantomforce-session": sessionId } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function connectionApi(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Connection request failed (${response.status}).`);
  return payload;
}

async function refreshConnections({ force = false } = {}) {
  if (connectionState.loading || (connectionState.loaded && !force)) return connectionState;
  connectionState = { ...connectionState, loading: true, error: "" };
  try {
    const tenant = encodeURIComponent(currentTenantId());
    const payload = await connectionApi(`/api/connections/status?tenant_id=${tenant}`);
    connectionState = { ...connectionState, loaded: true, loading: false, error: "", connectors: Array.isArray(payload.connectors) ? payload.connectors : [] };
  } catch (error) {
    connectionState = { ...connectionState, loaded: true, loading: false, error: error instanceof Error ? error.message : "Connections could not be checked." };
  }
  if (connectionMount?.isConnected) renderConnectionCenter(connectionMount, connectionOpts);
  return connectionState;
}

function connectionCard(connector) {
  const connected = connector.state === "connected";
  const needsConfiguration = connector.state === "configuration_required";
  const status = connected ? "Connected" : needsConfiguration ? "Needs configuration" : "Ready to connect";
  const button = connected ? "Manage" : needsConfiguration ? "Needs configuration" : "Connect";
  const busy = connectionState.busyId === connector.id;
  return `<article class="set-connect-card is-${esc(connector.state || "disconnected")}">
    <div class="set-connect-card-top">
      <span class="set-connect-mark" aria-hidden="true">${connected ? "✓" : "+"}</span>
      <span><b>${esc(connector.name)}</b><i>${esc(connector.detail)}</i></span>
    </div>
    <div class="set-connect-state"><span>${esc(status)}</span><i>${esc(connector.customerMessage || "Choose Connect to continue.")}</i></div>
    <button class="btn ${connected || needsConfiguration ? "btn-quiet" : "btn-primary"}" type="button" data-connection-start="${esc(connector.id)}" ${busy || needsConfiguration ? "disabled" : ""}>${busy ? "Opening…" : esc(button)}</button>
  </article>`;
}

function overviewStatus(state) {
  if (state === "connected") return "Active";
  if (state === "attention") return "Needs attention";
  if (state === "checking") return "Checking";
  return "Configured";
}

function brainRouteCard(route) {
  return `<article class="set-connect-brain is-${esc(route.state || "checking")}">
    <span class="set-connect-live-dot" aria-hidden="true"></span>
    <div><p>${esc(route.name)}</p><b>${esc(route.detail)}</b><i>${esc(route.message || "")}</i></div>
    <span class="set-connect-state-pill">${esc(route.status || overviewStatus(route.state))}</span>
    ${route.settingsTab ? `<button class="btn btn-quiet" type="button" data-connection-settings-tab="${esc(route.settingsTab)}">Manage</button>` : ""}
  </article>`;
}

function configuredConnectionCard(connector) {
  return `<article class="set-connect-active-card is-${esc(connector.state || "checking")}">
    <span class="set-connect-mark" aria-hidden="true">${connector.state === "connected" ? "✓" : "!"}</span>
    <div><b>${esc(connector.name)}</b><i>${esc(connector.detail || "Configured connection")}</i><small>${esc(connector.message || "")}</small></div>
    <span class="set-connect-state-pill">${esc(connector.status || overviewStatus(connector.state))}</span>
    ${connector.settingsTab ? `<button class="btn btn-quiet" type="button" data-connection-settings-tab="${esc(connector.settingsTab)}">Manage</button>` : ""}
  </article>`;
}

function connectionOverview() {
  const brainRoutes = Array.isArray(connectionOpts.brainRoutes) ? connectionOpts.brainRoutes : [];
  const supplied = Array.isArray(connectionOpts.configuredConnections) ? connectionOpts.configuredConnections : [];
  const connectedAccounts = connectionState.connectors
    .filter((connector) => connector.state === "connected")
    .map((connector) => ({
      id: connector.id,
      name: connector.name,
      state: "connected",
      status: "Active",
      detail: connector.detail,
      message: connector.customerMessage,
    }));
  const seen = new Set();
  const configured = [...supplied, ...connectedAccounts]
    .filter((connector) => connector?.id && !seen.has(connector.id) && seen.add(connector.id))
    .sort((a, b) => {
      const priority = { connected: 0, checking: 1, attention: 2 };
      return (priority[a.state] ?? 3) - (priority[b.state] ?? 3) || String(a.name).localeCompare(String(b.name));
    });
  return `<div class="set-connect-overview">
    <section class="set-connect-brains">
      <header class="set-connect-section-head"><div><p class="set-eyebrow">Brain routes</p><h3>What powers your workspace</h3></div><span>${brainRoutes.length} routes</span></header>
      <div class="set-connect-brain-grid">${brainRoutes.map(brainRouteCard).join("") || `<p class="set-empty-state">Brain routing is loading.</p>`}</div>
    </section>
    <section class="set-connect-active">
      <header class="set-connect-section-head"><div><p class="set-eyebrow">Active first</p><h3>Configured connections</h3></div><span>${configured.filter((item) => item.state === "connected").length} active</span></header>
      <div class="set-connect-active-grid">${configured.map(configuredConnectionCard).join("") || `<p class="set-empty-state">No connections are active yet. Use Bridges or choose Connect below.</p>`}</div>
    </section>
  </div>`;
}

function connectionGroups() {
  const grouped = new Map();
  connectionState.connectors.filter((connector) => connector.state !== "connected").forEach((connector) => {
    const group = connector.group || "Accounts";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(connector);
  });
  if (!grouped.size && connectionState.loading) return `<div class="set-connect-loading">Checking your connections…</div>`;
  return [...grouped.entries()].map(([group, connectors], index) => `<details class="set-connect-group" ${index === 0 ? "open" : ""}>
    <summary class="set-connect-group-head"><h3>${esc(group)}</h3><span>${connectors.length} available</span></summary>
    <div class="set-connect-grid">${connectors.sort((a, b) => (a.state === "available" ? 0 : 1) - (b.state === "available" ? 0 : 1)).map(connectionCard).join("")}</div>
  </details>`).join("");
}

export function renderConnectionCenter(el, opts = {}) {
  connectionMount = el;
  connectionOpts = opts;
  const socialMountId = `social-connect-${Math.random().toString(36).slice(2)}`;
  el.innerHTML = `<div class="set-connection-center">
    <section class="set-section set-connect-hero">
      <div><p class="set-eyebrow">One-click connections</p><h3>Everything connected to PhantomForce</h3><p class="set-note">Active brain routes, bridges, API providers, and business accounts stay at the top. Choose Connect below when your workspace needs another service.</p></div>
      <button class="btn btn-quiet" type="button" data-connections-refresh>${connectionState.loading ? "Checking…" : "Refresh status"}</button>
    </section>
    ${connectionState.notice ? `<div class="set-social-notice">${esc(connectionState.notice)}</div>` : ""}
    ${connectionState.error ? `<div class="set-social-notice">${esc(connectionState.error)}</div>` : ""}
    ${connectionOverview()}
    <header class="set-connect-catalog-head"><p class="set-eyebrow">Available connectors</p><h3>Add a business account</h3><p>Choose a provider, sign in on its secure page, and return here to confirm it is active.</p></header>
    ${connectionGroups()}
    <section class="set-connect-social"><div id="${socialMountId}"></div></section>
  </div>`;

  el.querySelector("[data-connections-refresh]")?.addEventListener("click", () => void refreshConnections({ force: true }));
  el.querySelectorAll("[data-connection-settings-tab]").forEach((button) => {
    button.addEventListener("click", () => connectionOpts.onOpenSettingsTab?.(button.dataset.connectionSettingsTab || "model"));
  });
  el.querySelectorAll("[data-connection-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      const connectorId = button.dataset.connectionStart || "";
      connectionState.busyId = connectorId;
      connectionState.notice = "Opening secure connection…";
      renderConnectionCenter(el, opts);
      try {
        const payload = await connectionApi("/api/connections/start", {
          method: "POST",
          body: JSON.stringify({ tenant_id: currentTenantId(), connector_id: connectorId }),
        });
        if (payload.authorizationUrl) window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
        connectionState.notice = payload.customerMessage || "Secure provider sign-in opened. Return here after approval.";
        connectionState.loaded = false;
        await refreshConnections({ force: true });
      } catch (error) {
        connectionState.notice = error instanceof Error ? error.message : "The connection could not start.";
      } finally {
        connectionState.busyId = "";
        if (el.isConnected) renderConnectionCenter(el, opts);
      }
    });
  });

  const socialMount = el.querySelector(`#${socialMountId}`);
  if (socialMount) renderSocialSettings(socialMount, opts);
  if (!connectionState.loaded && !connectionState.loading) void refreshConnections();
}
