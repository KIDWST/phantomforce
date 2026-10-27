import { ctx, currentTenantId, friendlyBackendError, session } from "./store.js?v=phantom-live-20261026-244";

const esc = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const panels = new WeakMap();
const rootCurrent = (root, state) => panels.get(root) === state && root.isConnected !== false;
const scopeCurrent = (root, state) => rootCurrent(root, state) && state.tenantId === currentTenantId() && state.token === session.token() && state.account === ctx.session;
function panelState(root) {
  const previous = panels.get(root), tenantId = currentTenantId(), token = session.token(), account = ctx.session;
  if (previous?.tenantId === tenantId && previous.token === token && previous.account === account) return previous;
  if (previous) { previous.revision++; previous.controller?.abort(); previous.diagnosisController?.abort(); }
  const state = { tenantId, token, account, revision: 0, diagnosisRevision: 0, loading: false, graph: null, truth: null, error: "", diagnosis: null, correlation: "", traceError: "", diagnosing: false };
  panels.set(root, state);
  return state;
}
const scopedRequest = (state, controller) => ({ signal: controller.signal, headers: { Authorization: `Bearer ${state.token}`, "x-phantomforce-business": state.tenantId } });

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(friendlyBackendError(response.status, typeof payload?.error === "string" ? payload.error : payload?.error?.code, { authMessage: "Sign in as an owner to inspect Production Core." }));
  return payload;
}

function tenantQuery(extra = {}, tenantId = currentTenantId()) {
  return new URLSearchParams({ tenant_id: tenantId, ...extra }).toString();
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

async function refresh(root, state) {
  const revision = ++state.revision;
  state.controller?.abort(); state.diagnosisController?.abort(); state.diagnosisRevision++;
  const controller = new AbortController(); state.controller = controller;
  const timeout = setTimeout(() => controller.abort(), 15_000);
  state.loading = true;
  state.error = ""; state.graph = null; state.truth = null; state.diagnosis = null; state.traceError = ""; state.diagnosing = false;
  render(root, state);
  try {
    const [graph, truth] = await Promise.all([
      api(`/api/production-core/graph?${tenantQuery({}, state.tenantId)}`, scopedRequest(state, controller)),
      api(`/api/production-core/truth?${tenantQuery({}, state.tenantId)}`, scopedRequest(state, controller)),
    ]);
    if (!scopeCurrent(root, state) || state.revision !== revision) return;
    if (graph?.ok !== true || truth?.ok !== true || graph.tenantId !== state.tenantId || truth.tenant_id !== state.tenantId) throw new Error("Production Core returned an incomplete or different business scope. Refresh to try again.");
    state.graph = graph; state.truth = truth;
  } catch (error) {
    if (scopeCurrent(root, state) && state.revision === revision) state.error = error?.message || "Production Core is unavailable.";
  } finally {
    clearTimeout(timeout);
    if (state.revision === revision) { state.loading = false; render(root, state); }
  }
}

async function diagnose(root, state, correlationId) {
  if (!scopeCurrent(root, state)) { render(root, state); return; }
  const revision = state.revision, diagnosisRevision = ++state.diagnosisRevision;
  state.diagnosisController?.abort();
  const controller = new AbortController(); state.diagnosisController = controller;
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const current = () => scopeCurrent(root, state) && state.revision === revision && state.diagnosisRevision === diagnosisRevision;
  state.diagnosis = null; state.correlation = correlationId; state.traceError = ""; state.diagnosing = true; render(root, state);
  try {
    const result = await api(`/api/production-core/admin/diagnose?${tenantQuery({ correlation_id: correlationId }, state.tenantId)}`, scopedRequest(state, controller));
    if (!current()) return;
    if (result?.ok !== true || result.tenantId !== state.tenantId || result.correlationId !== correlationId) throw new Error("The trace did not match this business and correlation ID. Refresh and try again.");
    state.diagnosis = result;
  } catch (error) {
    if (current()) state.traceError = error?.message || "That transaction could not be traced.";
  } finally {
    clearTimeout(timeout);
    if (state.diagnosisRevision === diagnosisRevision && state.revision === revision) { state.diagnosing = false; render(root, state); }
  }
}

function truthPill(value) {
  const stateName = ["real", "sandbox", "mock", "degraded", "unavailable"].includes(String(value)) ? String(value) : "unavailable";
  return `<span class="chip chip-${stateName === "real" ? "approved" : stateName === "sandbox" ? "pending" : "rejected"}">${esc(stateName)}</span>`;
}

function render(root, state) {
  if (!rootCurrent(root, state)) return;
  if (!scopeCurrent(root, state)) {
    state.graph = null; state.truth = null; state.diagnosis = null; state.loading = false;
    state.error = "Account or workspace changed. Refresh Production Core to inspect the current business.";
  }
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
        <input id="production-core-correlation" name="correlation" value="${esc(state.correlation)}" maxlength="180" placeholder="cor_… or cor-gp…" autocomplete="off" />
        <button class="btn btn-quiet" type="submit" ${state.diagnosing ? "disabled" : ""}>${state.diagnosing ? "Tracing…" : "Trace transaction"}</button>
        <button class="btn btn-quiet" type="button" data-production-core-refresh>Refresh</button>
      </form>
      ${state.traceError ? `<p class="record-sub" role="alert">${esc(state.traceError)}</p>` : ""}
      ${diagnosis ? `<div class="stack" aria-live="polite"><div class="kv"><span>Trace</span><b>${esc(diagnosis.correlationId)}</b></div><div class="kv"><span>Timeline</span><b>${Number(diagnosis.timeline?.length || 0)} correlated entries</b></div><div class="kv"><span>Actionable failures</span><b>${diagnosis.actionableFailures?.length ? esc(diagnosis.actionableFailures.map((item) => `${item.errorCode}: ${item.remediation}`).join(" · ")) : "None"}</b></div></div>` : ""}
    </section>`;
  root.querySelector("[data-production-core-refresh]")?.addEventListener("click", () => mountProductionCorePanel(root, { force: true }));
  root.querySelector("[data-production-core-diagnose]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const correlationId = String(new FormData(event.currentTarget).get("correlation") || "").trim();
    if (!correlationId) return;
    return diagnose(root, state, correlationId);
  });
}

export async function mountProductionCorePanel(root, { force = false } = {}) {
  if (!root) return;
  const state = panelState(root);
  if (!state.token) {
    state.graph = null; state.truth = null; state.diagnosis = null;
    state.error = "Production Core requires an authenticated owner session.";
    render(root, state);
    return;
  }
  if (force || !state.graph || !state.truth) {
    if (!force && state.pending) return state.pending;
    const pending = refresh(root, state); state.pending = pending;
    try { await pending; } finally { if (state.pending === pending) state.pending = null; }
  }
  render(root, state);
}
