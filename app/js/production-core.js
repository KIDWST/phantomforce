import { currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20260819-169";

const esc = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const state = { loading: false, graph: null, truth: null, error: "", diagnosis: null };

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyBackendError(response.status, payload?.error, { authMessage: "Sign in as an owner to inspect Production Core." }));
  return payload;
}

function tenantQuery(extra = {}) {
  return new URLSearchParams({ tenant_id: currentTenantId(), ...extra }).toString();
}

export async function productionCoreCommand(action, payload, options = {}) {
  const correlationId = options.correlationId || `cor-ui-${crypto.randomUUID()}`;
  const commandId = options.commandId || `cmd-ui-${crypto.randomUUID()}`;
  return api("/api/production-core/commands", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: currentTenantId(),
      action,
      command_id: commandId,
      idempotency_key: options.idempotencyKey || commandId,
      correlation_id: correlationId,
      invocation_source: options.invocationSource || "human",
      ...(options.expectedRevision ? { expected_revision: options.expectedRevision } : {}),
      payload,
    }),
  });
}

async function refresh() {
  state.loading = true;
  state.error = "";
  try {
    [state.graph, state.truth] = await Promise.all([
      api(`/api/production-core/graph?${tenantQuery()}`),
      api(`/api/production-core/truth?${tenantQuery()}`),
    ]);
  } catch (error) {
    state.error = error?.message || "Production Core is unavailable.";
  } finally {
    state.loading = false;
  }
}

function truthPill(value) {
  const stateName = ["real", "sandbox", "mock", "degraded", "unavailable"].includes(String(value)) ? String(value) : "unavailable";
  return `<span class="chip chip-${stateName === "real" ? "approved" : stateName === "sandbox" ? "pending" : "rejected"}">${esc(stateName)}</span>`;
}

function render(root) {
  if (!root) return;
  if (state.loading) {
    root.innerHTML = `<article class="record record-wide" aria-busy="true"><h4>Production Core</h4><p class="record-sub">Reading persisted state and verifying provider truth…</p></article>`;
    return;
  }
  if (state.error || !state.graph || !state.truth) {
    root.innerHTML = `<article class="record record-wide"><div class="record-top"><h4>Production Core</h4>${truthPill("unavailable")}</div><p class="record-sub">${esc(state.error || "No verified core state is available.")}</p><div class="record-actions"><button class="btn btn-quiet" type="button" data-production-core-refresh>Retry</button></div></article>`;
    root.querySelector("[data-production-core-refresh]")?.addEventListener("click", () => mountProductionCorePanel(root, { force: true }));
    return;
  }
  const counts = state.graph.counts || {};
  const provider = state.truth.providerAdapter || { state: "unavailable", liveHealth: { platformStatus: "unknown" } };
  const latestJob = state.graph.recentJobs?.[0];
  const latestPublication = state.graph.recentPublications?.[0];
  const latestIncident = state.graph.recentIncidents?.[0];
  const diagnosis = state.diagnosis;
  root.innerHTML = `
    <section class="record record-wide" aria-labelledby="production-core-title">
      <div class="record-top"><div><p class="ch-eyebrow">Canonical execution model</p><h4 id="production-core-title">Production Core</h4></div><div>${truthPill(state.truth.persistence?.state)} ${truthPill(provider.state)}</div></div>
      <p class="record-sub">Persisted business graph and provider truth for <b>${esc(state.graph.tenantId)}</b>. Sandbox is labeled as sandbox; unavailable state is never shown as connected.</p>
      <div class="admin-ws-stats">${Number(counts.leads || 0)} leads · ${Number(counts.clients || 0)} clients · ${Number(counts.campaigns || 0)} campaigns · ${Number(counts.contents || 0)} content · ${Number(counts.publications || 0)} publications · ${Number(counts.analytics || 0)} analytics · ${Number(counts.incidents || 0)} incidents</div>
      <div class="stack">
        <div class="kv"><span>Organization</span><b>${esc(state.graph.organizationStatus || "unavailable")}</b></div>
        <div class="kv"><span>Persistence</span><b>${esc(state.truth.persistence?.state || "unavailable")} · document v${Number(state.truth.persistence?.documentVersion || 0)}</b></div>
        <div class="kv"><span>Provider platform</span><b>${esc(provider.liveHealth?.platformStatus || "unknown")} · checked ${provider.liveHealth?.checkedAt ? esc(new Date(provider.liveHealth.checkedAt).toLocaleString()) : "not checked"}</b></div>
        <div class="kv"><span>Latest publication</span><b>${latestPublication ? `${esc(latestPublication.status)} · ${esc(latestPublication.id)}` : "No persisted publication"}</b></div>
        <div class="kv"><span>Latest job</span><b>${latestJob ? `${esc(latestJob.state)} · attempt ${Number(latestJob.attempt || 0)} · ${esc(latestJob.lastErrorCode || "no error")}` : "No persisted job"}</b></div>
        <div class="kv"><span>Latest incident</span><b>${latestIncident ? `${esc(latestIncident.status)} · ${esc(latestIncident.kind)} · ${esc(latestIncident.remediation || "no remediation recorded")}` : "No persisted incident"}</b></div>
      </div>
      <form class="record-actions" data-production-core-diagnose>
        <label class="sr-only" for="production-core-correlation">Correlation ID</label>
        <input id="production-core-correlation" name="correlation" placeholder="cor_… or cor-gp…" autocomplete="off" />
        <button class="btn btn-quiet" type="submit">Trace transaction</button>
        <button class="btn btn-quiet" type="button" data-production-core-refresh>Refresh</button>
      </form>
      ${diagnosis ? `<div class="stack" aria-live="polite"><div class="kv"><span>Trace</span><b>${esc(diagnosis.correlationId)}</b></div><div class="kv"><span>Timeline</span><b>${Number(diagnosis.timeline?.length || 0)} correlated entries</b></div><div class="kv"><span>Actionable failures</span><b>${diagnosis.actionableFailures?.length ? esc(diagnosis.actionableFailures.map((item) => `${item.errorCode}: ${item.remediation}`).join(" · ")) : "None"}</b></div></div>` : ""}
    </section>`;
  root.querySelector("[data-production-core-refresh]")?.addEventListener("click", () => mountProductionCorePanel(root, { force: true }));
  root.querySelector("[data-production-core-diagnose]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const correlationId = String(new FormData(event.currentTarget).get("correlation") || "").trim();
    if (!correlationId) return;
    try {
      state.diagnosis = await api(`/api/production-core/admin/diagnose?${tenantQuery({ correlation_id: correlationId })}`);
      state.error = "";
    } catch (error) {
      state.diagnosis = null;
      state.error = error?.message || "That transaction could not be traced.";
    }
    render(root);
  });
}

export async function mountProductionCorePanel(root, { force = false } = {}) {
  if (!root) return;
  if (!session.token()) {
    state.error = "Production Core requires an authenticated owner session.";
    render(root);
    return;
  }
  if (force || !state.graph || state.graph.tenantId !== currentTenantId()) {
    render(root);
    await refresh();
  }
  render(root);
}
