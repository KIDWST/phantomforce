import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260718-36";

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path) {
  const response = await fetch(path, { headers: authHeaders() });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(friendlyBackendError(response.status, json?.error, {
      authMessage: "Sign in to load the Managed Growth Ops report.",
      fallbackPrefix: "Managed Growth report failed",
    }));
  }
  return json;
}

export function managedGrowthAvailable() {
  return Boolean(typeof session?.token === "function" && session.token());
}

export async function loadManagedGrowthReport(tenantId = currentTenantId()) {
  const params = new URLSearchParams();
  if (tenantId) params.set("tenant_id", tenantId);
  return api(`/api/managed-growth/report?${params.toString()}`);
}

function fmtMetric(metric = {}) {
  const value = Number(metric.value || 0);
  if (metric.unit === "dollars") return `$${value.toLocaleString()}`;
  if (metric.unit === "percent") return `${value}%`;
  return value.toLocaleString();
}

function severityLabel(severity = "info") {
  if (severity === "critical") return "Needs action";
  if (severity === "warning") return "Watch";
  return "Info";
}

function moduleStatusLabel(status = "waiting") {
  if (status === "live") return "Ready";
  if (status === "needs_action") return "Needs action";
  if (status === "needs_setup") return "Needs setup";
  return "Waiting";
}

function renderLoading(root) {
  root.innerHTML = `
    <section class="mg-report ch-card is-loading" aria-busy="true">
      <div>
        <p class="ch-eyebrow">Managed Growth Ops</p>
        <h3>Checking server-backed operations.</h3>
        <p>Reading Client Setup, CRM, Proposal Forge, and Approvals for this workspace.</p>
      </div>
    </section>`;
}

function renderUnavailable(root, message = "Sign in to load the Managed Growth Ops report.") {
  root.innerHTML = `
    <section class="mg-report ch-card is-blocked">
      <div>
        <p class="ch-eyebrow">Managed Growth Ops</p>
        <h3>Internal operations report unavailable.</h3>
        <p>${esc(message)}</p>
      </div>
      <span class="mg-safe">No social stats invented</span>
    </section>`;
}

function renderReport(root, payload = {}) {
  const report = payload.report || {};
  const metrics = Array.isArray(report.metrics) ? report.metrics : [];
  const blockers = Array.isArray(report.blockers) ? report.blockers : [];
  const actions = Array.isArray(report.nextActions) ? report.nextActions : [];
  const modules = Array.isArray(report.modules) ? report.modules : [];
  const sources = Array.isArray(report.sourceDocuments) ? report.sourceDocuments : [];
  const setup = report.setup || {};
  root.innerHTML = `
    <section class="mg-report">
      <header class="mg-hero ch-card">
        <div>
          <p class="ch-eyebrow">Managed Growth Ops</p>
          <h3>${esc(report.summary || "Server-backed operations report is ready.")}</h3>
          <p>This is internal PhantomForce activity only: setup slots, CRM leads, proposal drafts, and approval cards. Social performance stays separate until OAuth/API syncs or imported platform reports exist.</p>
        </div>
        <div class="mg-setup">
          <span><b>${Number(setup.activeConfigured || 0)}/2</b>active clients</span>
          <span><b>${Number(setup.pendingConfigured || 0)}/1</b>pending client</span>
          <span><b>${Number(setup.averageCompleteness || 0)}%</b>setup avg</span>
        </div>
      </header>
      <div class="mg-metrics">
        ${metrics.map((metric) => `
          <article class="ch-card mg-metric">
            <span>${esc(metric.label)}</span>
            <b>${esc(fmtMetric(metric))}</b>
            <p>${esc(metric.detail)}</p>
            <small>${esc(metric.source)}</small>
          </article>`).join("")}
      </div>
      <section class="ch-card mg-modules">
        <div class="ch-card-h">
          <div>
            <p class="ch-eyebrow">Operations Modules</p>
            <h3>Managed Growth setup board</h3>
          </div>
          <span>${modules.length} modules</span>
        </div>
        <div class="mg-module-grid">
          ${modules.map((module) => `
            <article class="mg-module is-${esc(module.status)}">
              <div>
                <span>${esc(moduleStatusLabel(module.status))}</span>
                <b>${esc(module.label)}</b>
              </div>
              <p>${esc(module.detail)}</p>
              ${module.blocker ? `<small>${esc(module.blocker)}</small>` : ""}
              <dl>
                <div><dt>Clients</dt><dd>${Number(module.enabledClients || 0)}</dd></div>
                <div><dt>Signals</dt><dd>${Number(module.signalCount || 0)}</dd></div>
                <div><dt>Source</dt><dd>${esc(module.source)}</dd></div>
              </dl>
              <button class="btn btn-ghost" type="button" data-open-ws="${esc(module.surface || "clientsetup")}">${esc(module.nextAction || "Open workspace")}</button>
            </article>`).join("") || `<article class="mg-row"><span>Waiting</span><b>No module readiness returned.</b><p>The server report did not include module details.</p></article>`}
        </div>
      </section>
      <div class="mg-grid">
        <section class="ch-card mg-blockers">
          <div class="ch-card-h"><div><p class="ch-eyebrow">Blockers</p><h3>What needs attention</h3></div></div>
          <div class="mg-list">
            ${blockers.map((item) => `
              <article class="mg-row is-${esc(item.severity)}">
                <span>${esc(severityLabel(item.severity))}</span>
                <b>${esc(item.title)}</b>
                <p>${esc(item.detail)}</p>
              </article>`).join("") || `<article class="mg-row"><span>Clear</span><b>No internal blockers found.</b><p>The server-backed records do not show an operations blocker right now.</p></article>`}
          </div>
        </section>
        <section class="ch-card mg-actions">
          <div class="ch-card-h"><div><p class="ch-eyebrow">Next Actions</p><h3>Best safe moves</h3></div></div>
          <div class="mg-list">
            ${actions.map((item) => `
              <article class="mg-row">
                <span>${item.requiresApproval ? "Approval-safe" : "Setup"}</span>
                <b>${esc(item.title)}</b>
                <p>${esc(item.detail)}</p>
                <button class="btn btn-ghost" type="button" data-open-ws="${esc(item.surface)}">Open</button>
              </article>`).join("")}
          </div>
        </section>
      </div>
      <section class="ch-card mg-sources">
        <div>
          <p class="ch-eyebrow">Evidence</p>
          <h3>Source documents</h3>
        </div>
        <div>
          ${sources.map((source) => `<span><b>${esc(source.label)}</b><i>v${Number(source.version || 1)} · ${esc(String(source.checksum || "").slice(0, 10) || "no checksum")}</i></span>`).join("")}
        </div>
        <small>${esc(report.safety?.socialAnalyticsReason || "Social analytics are not counted here.")}</small>
      </section>
    </section>`;
}

export function mountManagedGrowthReport(root) {
  if (!root) return;
  if (!managedGrowthAvailable()) {
    renderUnavailable(root);
    return;
  }
  renderLoading(root);
  loadManagedGrowthReport()
    .then((payload) => renderReport(root, payload))
    .catch((error) => renderUnavailable(root, error?.message || "Managed Growth report could not load."));
}
