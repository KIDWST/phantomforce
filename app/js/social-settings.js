/* Provider-verified social accounts. Public references never imply authorization. */
import { currentTenantId, session as accessSession } from "./store.js?v=phantom-live-20261003-237";
import { loadSocialAccounts, saveSocialAccounts } from "./contenthub.js?v=phantom-live-20261003-237";
import { socialConnectorsFromResponse } from "./social-connection-state.js?v=phantom-live-20261003-237";

const API = "/phantom-ai/ops/social-oauth";
const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const scopeKey = () => JSON.stringify([currentTenantId(), accessSession.token?.() || accessSession.get?.()?.sessionId || ""]);
const providerHosts = new Set(["accounts.google.com", "www.facebook.com", "www.tiktok.com", "x.com", "twitter.com", "www.linkedin.com", "www.pinterest.com"]);
let mounted = null;
function canManageSocialProviderApps() {
  const user = accessSession.get?.();
  return Boolean(user?.canManageAccess || user?.isSuperAdmin);
}

export function renderSocialSettings(el, opts = {}) {
  mounted?.destroy();
  const tenantId = currentTenantId(), scope = scopeKey(), owner = canManageSocialProviderApps();
  const requests = new Set();
  const state = { loaded: false, loading: false, canManage: false, error: "", notice: "", connectors: [], selections: [], setup: null, setupError: "", setupOpen: "", busy: "", pending: "", handoff: null, confirmDisconnect: "" };
  let disposed = false, poll = null, pollDeadline = 0, statusRequest = null, pendingRevision = "";
  const active = () => !disposed && mounted === controller && el.isConnected && scope === scopeKey();
  const controller = { refresh: refreshSocialOAuthStatus, destroy() {
    disposed = true;
    if (poll) clearTimeout(poll);
    requests.forEach(request => request.abort());
    window.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", onReturn);
    window.removeEventListener("pf:business-switch-start", controller.destroy);
  } };
  mounted = controller;

  async function api(path, body, scoped = true) {
    if (!active()) throw new Error("The business changed. Reopen Social accounts.");
    const abort = new AbortController(); requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 20000);
    const token = accessSession.token?.(), sessionId = accessSession.get?.()?.sessionId;
    try {
      const response = await fetch(path, { method: body ? "POST" : "GET", signal: abort.signal,
        headers: { "x-phantomforce-business": tenantId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(sessionId ? { "x-phantomforce-session": sessionId } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify({ ...body, ...(scoped ? { tenant_id: tenantId } : {}) }) } : {}) });
      const json = await response.json().catch(() => ({}));
      if (!active()) throw new Error("The business changed. Reopen Social accounts.");
      if (scoped && json.tenant_id && json.tenant_id !== tenantId) throw new Error("The connection response belongs to another business.");
      if (!response.ok || json.ok === false) throw new Error(typeof json.error === "string" ? json.error : `The connection could not be updated (${response.status}).`);
      if (scoped && json.tenant_id !== tenantId) throw new Error("The connection scope could not be verified. Refresh and try again.");
      return json;
    } finally { clearTimeout(timeout); requests.delete(abort); }
  }

  async function refreshSocialOAuthStatus() {
    if (!active()) return;
    if (statusRequest) return statusRequest;
    state.loading = true; state.error = ""; paint();
    statusRequest = (async () => {
      try {
        const json = await api(`/phantom-ai/ops/social-analytics/status?tenant_id=${encodeURIComponent(tenantId)}`);
        if (!active()) return;
        state.connectors = socialConnectorsFromResponse(json);
        state.canManage = json.can_manage_accounts === true;
        state.selections = Array.isArray(json.asset_selections) ? json.asset_selections : [];
        state.loaded = true;
        const connected = state.connectors.find(item => item.id === state.pending && item.configured && !item.authorizationPending && item.connectionUpdatedAt && item.connectionUpdatedAt !== pendingRevision);
        const selection = state.selections.find(item => item.platform === state.pending);
        if (connected || selection) {
          state.notice = selection ? "Choose the account to use for this business." : `${connected.name} connected.`;
          state.pending = ""; state.handoff = null;
          if (poll) clearTimeout(poll);
        }
      } catch (error) {
        if (!active()) return;
        state.connectors = []; state.selections = []; state.loaded = false;
        state.error = error.name === "AbortError" ? "Connection check timed out. Try again." : error.message;
      } finally { statusRequest = null; if (active()) { state.loading = false; paint(); } }
    })();
    return statusRequest;
  }

  async function refreshSetup() {
    if (!owner || !active()) return;
    try { const json = await api("/phantom-ai/ops/social-oauth/setup", null, false); if (active()) { state.setup = json.setup; state.setupError = ""; } }
    catch (error) { if (active()) state.setupError = error.message; }
    if (active()) paint();
  }
  function schedulePoll() {
    if (poll) clearTimeout(poll);
    if (!active() || !state.pending) return;
    if (Date.now() > pollDeadline) { state.notice = "Sign-in is still pending. Finish provider approval, then refresh."; paint(); return; }
    poll = setTimeout(async () => { await refreshSocialOAuthStatus(); schedulePoll(); }, 3000);
  }
  async function requestSocialOAuthStart(account) {
    if (!state.canManage) return;
    let popup = null;
    try { popup = window.open("about:blank", `phantomforce-social-${account.id}`, "popup,width=760,height=800"); } catch {}
    pendingRevision = state.connectors.find(item => item.id === account.id)?.connectionUpdatedAt || "";
    try { if (popup) { popup.document.title = `Connect ${account.name}`; popup.document.body.textContent = "Opening secure sign-in…"; } } catch {}
    state.busy = account.id; state.error = ""; state.notice = ""; paint();
    try {
      const json = await api("/phantom-ai/ops/social-oauth/start", { platform: account.id });
      if (!json?.oauth?.authorizationUrl) throw new Error("The provider did not return a sign-in link.");
      const authorization = new URL(json.oauth.authorizationUrl);
      if (authorization.protocol !== "https:" || !providerHosts.has(authorization.hostname)) throw new Error("The provider sign-in address could not be verified.");
      state.pending = account.id; state.handoff = { id: account.id, url: authorization.href };
      let opened = false;
      try { if (popup && !popup.closed) { popup.opener = null; popup.location.href = authorization.href; opened = true; } } catch {}
      state.notice = opened ? `Finish ${account.name} sign-in in the opened window. This page will update automatically.` : "Your browser blocked the sign-in window. Use Continue sign-in below.";
      pollDeadline = Date.now() + 10 * 60_000; schedulePoll();
    } catch (error) { try { popup?.close(); } catch {} if (active()) state.error = error.message; }
    finally { if (active()) { state.busy = ""; paint(); } }
  }
  async function mutate(platform, path, body, notice) {
    if (!state.canManage) return;
    state.busy = platform; state.error = ""; paint();
    try {
      await api(`${API}/${path}`, { platform, ...body });
      if (!active()) return;
      state.notice = notice; state.confirmDisconnect = "";
      if (path === "disconnect") {
        state.pending = ""; state.handoff = null;
        const accounts = loadSocialAccounts(), account = accounts.find(row => row.id === platform);
        if (account) { account.enabled = false; account.connectMode = "manual"; delete account.analytics; delete account.insights; delete account.metrics; }
        saveSocialAccounts(accounts);
      }
      await refreshSocialOAuthStatus();
    } catch (error) { if (active()) state.error = error.message; }
    finally { if (active()) { state.busy = ""; paint(); } }
  }
  function callback(payload) {
    if (!active() || payload?.protocol !== "phantomforce.social-oauth.v1" || payload.tenant_id !== tenantId) return;
    if (["connected", "asset_selection_required"].includes(payload.type)) void refreshSocialOAuthStatus();
  }
  function onMessage(event) { if (event.origin === window.location.origin) callback(event.data); }
  function onStorage(event) { if (event.key === "pf.social.oauth.last") { try { callback(JSON.parse(event.newValue)); } catch {} } }
  function onReturn() { if (active()) void refreshSocialOAuthStatus(); }
  window.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onReturn);
  window.addEventListener("pf:business-switch-start", controller.destroy);

  function providerSetup(account) {
    if (!owner || state.setupOpen !== account.id) return "";
    const provider = state.setup?.providers?.find(item => item.id === account.id || (account.id === "facebook" && item.id === "instagram"));
    if (!provider) return `<p class="social-account-note">${esc(state.setupError || "Checking provider setup…")}</p>`;
    return `<form class="social-app-form" data-social-provider-form><input type="hidden" name="platform" value="${esc(provider.id)}">
      <p>Register the provider app once, then each business can sign in separately. Secrets stay on the server and are never returned to this page.</p>
      <a href="${esc(provider.consoleUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(provider.name)} app setup ↗</a>
      <label>${esc(provider.idLabel)}<input name="clientId" required autocomplete="off"></label>
      <label>${esc(provider.secretLabel)}<input name="clientSecret" type="password" autocomplete="new-password" required></label>
      <label>Authorized callback URL<input name="redirectUri" type="url" readonly value="${esc(provider.callbackUrl || state.setup.recommendedRedirectUri)}"></label>
      <button class="btn btn-primary" type="submit" ${state.busy ? "disabled" : ""}>Save provider app</button></form>`;
  }
  function card(account) {
    const connector = state.connectors.find(item => item.id === account.id), selection = state.selections.find(item => item.platform === account.id);
    const connected = Boolean(connector?.configured), capability = connector?.capabilityStatus;
    const status = selection ? "Choose account" : state.pending === account.id ? "Waiting for sign-in" : state.loading && !state.loaded ? "Checking…" : state.error && !state.loaded ? "Not verified" : connector?.connectionStatus === "REAUTH_REQUIRED" ? "Reconnect needed" : connected ? (connector.connectionStatus === "LIMITED_PERMISSIONS" ? "Limited permissions" : "Connected") : connector?.oauthConfigured ? "Ready to connect" : "Provider setup required";
    const identity = connector?.savedConnection?.selectedAssetName || connector?.savedConnection?.accountHandle || connector?.savedConnection?.accountName || "";
    const analytics = connected && ["FULL", "ANALYTICS_READY"].includes(capability), publishing = connected && ["FULL", "PUBLISH_READY"].includes(capability);
    const label = connected || connector?.connectionStatus === "REAUTH_REQUIRED" ? `Reconnect ${account.name}` : `Connect ${account.name}`;
    const hint = account.id === "instagram" ? "Use an Instagram professional account linked to a Facebook Page." : account.id === "facebook" ? "Choose a Facebook Page managed by your account." : account.id === "tiktok" ? "Connects your social profile. TikTok Shop is managed separately in Channels." : "";
    return `<article class="social-account-card" data-social-card="${esc(account.id)}"><div class="social-account-heading"><span class="social-platform-dot" style="background:${account.color}"></span><h2>${esc(account.name)}</h2><span class="social-account-state ${connected ? "is-connected" : ""}">${esc(status)}</span></div>
      ${identity && connected ? `<p class="social-account-identity">${esc(identity)}</p>` : ""}
      ${connected ? `<div class="social-capabilities"><span>${analytics ? "Analytics authorized" : "Analytics permission needed"}</span><span>${publishing ? "Publishing permission granted" : "Publishing permission needed"}</span></div><p class="social-account-note">Publishing also requires a configured delivery service and approval.</p>` : `<p class="social-account-note">${esc(connector?.oauthConfigured ? "OAuth app ready. Click connect and approve once." : owner ? "Enable the provider app below to open secure sign-in." : "The platform owner must enable this provider before you can sign in.")}</p>`}
      ${state.loaded && !state.canManage ? '<p class="social-account-note">A business administrator must manage this connection.</p>' : ""}${hint ? `<p class="social-account-note">${esc(hint)}</p>` : ""}
      ${selection && state.canManage ? `<form class="social-selection" data-social-selection="${esc(account.id)}"><label>Account for this business<select name="pageId" required><option value="">Choose an account…</option>${selection.pages.map(page => `<option value="${esc(page.id)}">${esc(page.name)}${page.instagramUsername ? ` · @${esc(page.instagramUsername)}` : ""}</option>`).join("")}</select></label><button class="btn btn-primary" ${state.busy ? "disabled" : ""}>Use this account</button></form>` : ""}
      <div class="social-account-actions">${connector?.oauthConfigured ? `<button class="btn btn-primary" data-social-open="${esc(account.id)}" ${state.busy || !state.loaded || !state.canManage ? "disabled" : ""}>${esc(label)}</button>` : owner ? `<button class="btn" data-social-setup="${esc(account.id)}" ${state.loading && !state.loaded ? "disabled" : ""}>${state.setupOpen === account.id ? "Close setup" : "Set up provider"}</button>` : '<span class="social-account-note">Provider not available yet</span>'}${state.canManage && (connected || selection) ? `<button class="btn btn-quiet" data-social-disconnect="${esc(account.id)}" ${state.busy ? "disabled" : ""}>Disconnect</button>` : ""}</div>
      ${state.handoff?.id === account.id ? `<a class="social-continue" href="${esc(state.handoff.url)}" target="_blank" rel="noopener noreferrer">Continue sign-in ↗</a>` : ""}
      ${state.confirmDisconnect === account.id ? `<div class="social-disconnect-confirm"><p>Remove this connection from this business? Your posts and other businesses stay unchanged.</p><button class="btn" data-confirm-disconnect="${esc(account.id)}">Disconnect account</button><button class="btn btn-quiet" data-cancel-disconnect>Keep connected</button></div>` : ""}
      ${providerSetup(account)}
      <details class="social-profile-reference"><summary>Public profile reference</summary><form data-social-confirm-form="${esc(account.id)}"><label>Editable handle or profile URL<input name="handle" placeholder="@yourbusiness or https://…" value="${esc(account.enabled || account.lastConnectAt ? account.handle || account.url || "" : "")}"></label><button class="btn" type="submit">Save handle</button></form><p>Saving a reference does not connect an account.</p></details></article>`;
  }
  function paint() {
    if (!active()) return;
    const accounts = loadSocialAccounts(), connected = state.connectors.filter(item => item.configured).length, heading = opts.standalone ? "h1" : "h3";
    el.innerHTML = `<section class="social-accounts" aria-busy="${state.loading}"><header class="social-accounts-heading"><div><${heading}>Social accounts</${heading}><span>${state.loaded ? `${connected} connected` : state.error ? "Connection check failed" : "Checking connections"}</span></div><button class="btn" data-social-refresh ${state.loading ? "disabled" : ""}>${state.loading ? "Checking…" : "Refresh"}</button></header>${state.error ? `<p class="social-account-alert" role="alert">${esc(state.error)}</p>` : ""}${state.notice ? `<p class="social-account-notice" role="status">${esc(state.notice)}</p>` : ""}<div class="social-accounts-grid">${accounts.map(card).join("")}</div></section>`;
    el.querySelector("[data-social-refresh]")?.addEventListener("click", () => { void refreshSocialOAuthStatus(); void refreshSetup(); });
    el.querySelectorAll("[data-social-open]").forEach(button => button.onclick = () => { const account = accounts.find(item => item.id === button.dataset.socialOpen); if (account && active()) void requestSocialOAuthStart(account); });
    el.querySelectorAll("[data-social-setup]").forEach(button => button.onclick = () => { state.setupOpen = state.setupOpen === button.dataset.socialSetup ? "" : button.dataset.socialSetup; paint(); void refreshSetup(); });
    el.querySelectorAll("[data-social-selection]").forEach(form => form.onsubmit = event => { event.preventDefault(); const platform = form.dataset.socialSelection, selection = state.selections.find(item => item.platform === platform); if (selection) void mutate(platform, "select-asset", { selectionId: selection.selectionId, pageId: new FormData(form).get("pageId") }, "Account selected."); });
    el.querySelectorAll("[data-social-disconnect]").forEach(button => button.onclick = () => { state.confirmDisconnect = button.dataset.socialDisconnect; paint(); });
    el.querySelectorAll("[data-confirm-disconnect]").forEach(button => button.onclick = () => void mutate(button.dataset.confirmDisconnect, "disconnect", {}, "Connection removed from this business."));
    el.querySelector("[data-cancel-disconnect]")?.addEventListener("click", () => { state.confirmDisconnect = ""; paint(); });
    el.querySelectorAll("[data-social-provider-form]").forEach(form => form.onsubmit = async event => {
      event.preventDefault(); if (!owner || !active()) return;
      const data = new FormData(form), platform = String(data.get("platform"));
      state.busy = platform; state.error = ""; form.querySelector("button[type=submit]").disabled = true;
      try {
        const json = await api(`${API}/setup`, Object.fromEntries(data), false);
        if (!active()) return;
        form.reset(); state.setup = json.setup; state.setupOpen = ""; state.notice = "Provider app saved. Connect the account to verify authorization.";
        await refreshSocialOAuthStatus();
      } catch (error) { if (active()) state.error = error.message; }
      finally { if (active()) { state.busy = ""; paint(); } }
    });
    el.querySelectorAll("[data-social-confirm-form]").forEach(form => form.onsubmit = event => {
      event.preventDefault(); if (!active()) return;
      const account = accounts.find(item => item.id === form.dataset.socialConfirmForm), value = String(new FormData(form).get("handle") || "").trim().slice(0, 300);
      if (!account) return;
      account.handle = /^https?:\/\//i.test(value) ? "" : value.replace(/^@/, ""); account.url = /^https?:\/\//i.test(value) ? value : "";
      account.enabled = Boolean(value); account.connectMode = "manual-confirmed"; account.lastConnectAt = new Date().toISOString();
      saveSocialAccounts(accounts); state.notice = `${account.name} handle saved as a public reference.`; paint();
    });
  }
  paint(); void refreshSocialOAuthStatus(); if (owner) void refreshSetup();
  return controller;
}
