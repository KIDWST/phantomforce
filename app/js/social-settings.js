/* PhantomForce — Social account settings.
 *
 * Extracted from the former Media Lab settings panel. This is the single UI for
 * connecting and managing social accounts (public handle + official OAuth). The
 * standalone Analytics tab and the dashboard audience widget both depend on the
 * social-account store, so this module keeps only the account-connection surface
 * and its OAuth/Hermes bridge machinery — no media generation.
 */

import { currentTenantId, ctx, session as accessSession, workspaceStorageGetItem, workspaceStorageRemoveItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260723-59";
import { PLATFORMS, loadSocialAccounts, saveSocialAccounts, socialStatus } from "./contenthub.js?v=phantom-live-20260723-59";

const SOCIAL_LOGIN_URLS = {
  instagram: "https://www.instagram.com/accounts/login/",
  tiktok: "https://www.tiktok.com/login",
  youtube: "https://accounts.google.com/",
  facebook: "https://www.facebook.com/login",
  x: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login",
  pinterest: "https://www.pinterest.com/login/",
};
let socialNotice = "";
const HERMES_EXTENSION_PROTOCOL = "phantomforce.hermes.extension.v1";
const HERMES_EXTENSION_KEY = "pf.hermes.extension.connect.v1";
let socialSettingsMount = null;
let socialSettingsOpts = {};
let hermesExtensionListenerReady = false;
let socialOAuthListenerReady = false;
let socialBridgePollTimer = 0;
let socialOAuthPollTimer = 0;
let socialOAuthState = {
  loaded: false,
  loading: false,
  error: "",
  connectors: [],
  preflight: null,
};
let socialOAuthSetupState = {
  loaded: false,
  loading: false,
  error: "",
  setup: null,
};

function cleanSocialHandle(value = "") {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/^(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|x\.com|twitter\.com|linkedin\.com|pinterest\.com)\//i, "")
    .replace(/^@+/, "")
    .replace(/^in\//i, "")
    .replace(/^company\//i, "")
    .replace(/[/?#].*$/, "")
    .trim();
}
function normalizeSocialUrl(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "https://") return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
function socialProfileFromHandle(platformId, handle = "") {
  const h = cleanSocialHandle(handle);
  if (!h) return "";
  if (platformId === "instagram") return `https://www.instagram.com/${h}/`;
  if (platformId === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platformId === "youtube") return `https://www.youtube.com/@${h}`;
  if (platformId === "facebook") return `https://www.facebook.com/${h}`;
  if (platformId === "x") return `https://x.com/${h}`;
  if (platformId === "linkedin") return `https://www.linkedin.com/company/${h}/`;
  if (platformId === "pinterest") return `https://www.pinterest.com/${h}/`;
  return "";
}
function socialProfileTarget(account) {
  return normalizeSocialUrl(account.url) || socialProfileFromHandle(account.id, account.handle);
}
function socialLoginTarget(account) {
  return SOCIAL_LOGIN_URLS[account.id] || socialProfileTarget(account) || "about:blank";
}
function socialAuthHeaders(extra = {}) {
  const token = typeof accessSession?.token === "function" ? accessSession.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function requestSocialOAuthStart(platform) {
  const response = await fetch("/phantom-ai/ops/social-oauth/start", {
    method: "POST",
    headers: socialAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ platform }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(json?.error || `OAuth start failed (${response.status}).`));
  if (!json?.oauth?.authorizationUrl) throw new Error("OAuth start did not return an authorization URL.");
  return json.oauth;
}
function openSocialAuthWindow(accountName = "account") {
  const safeName = String(accountName || "account").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  const popup = window.open("about:blank", `phantomforce-social-${safeName}-${Date.now()}`, "popup,width=820,height=860");
  if (!popup) return null;
  try {
    popup.document.title = `Connecting ${accountName}`;
    popup.document.body.style.cssText = "margin:0;display:grid;place-items:center;min-height:100vh;background:#05070d;color:#e9fff4;font:16px system-ui,sans-serif;";
    popup.document.body.innerHTML = `<main style="text-align:center;max-width:420px;padding:28px;"><b>Opening ${accountName} sign-in...</b><p style="color:#9fb7aa;line-height:1.45;">Use the account you are already signed into and approve PhantomForce when the provider asks.</p></main>`;
  } catch {}
  return popup;
}
function routeSocialAuthWindow(popup, url) {
  if (!url) return false;
  if (popup && !popup.closed) {
    try {
      popup.opener = null;
      popup.location.href = url;
      return true;
    } catch {}
  }
  const fallback = window.open(url, "_blank", "noopener,noreferrer");
  return Boolean(fallback);
}
async function beginSocialAccountConnection(account, popup = null) {
  if (!socialOAuthState.loaded) await refreshSocialOAuthStatus({ force: true });
  const connector = socialConnectorFor(account.id);
  if (connector?.oauthConfigured || connector?.configured) {
    const oauth = await requestSocialOAuthStart(account.id);
    const opened = routeSocialAuthWindow(popup, oauth.authorizationUrl);
    account.connectMode = "oauth-started";
    account.lastConnectAt = new Date().toISOString();
    socialNotice = opened
      ? `${account.name} authorization opened. Approve it once; PhantomForce refreshes this panel when the callback returns.`
      : `${account.name} authorization is ready, but the browser blocked the popup. Allow popups for PhantomForce and click again.`;
    startSocialOAuthAuthorizationPolling(account.id);
    return { mode: "oauth", opened };
  }
  const opened = routeSocialAuthWindow(popup, socialLoginTarget(account));
  account.connectMode = "pending";
  account.lastConnectAt = new Date().toISOString();
  startSocialBridgePolling(account.id);
  socialNotice = opened
    ? `${account.name} login opened. Save the public handle here after sign-in; live analytics and posting unlock only after the provider OAuth app is ready.`
    : `${account.name} login was blocked by the browser. Allow popups for PhantomForce and click again.`;
  return { mode: "public-login", opened };
}
async function refreshSocialOAuthStatus({ force = false } = {}) {
  if (socialOAuthState.loading || (socialOAuthState.loaded && !force)) return socialOAuthState;
  socialOAuthState = { ...socialOAuthState, loading: true, error: "" };
  try {
    const response = await fetch("/phantom-ai/ops/social-analytics/status", {
      headers: socialAuthHeaders(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(json?.error || `OAuth status failed (${response.status}).`));
    socialOAuthState = {
      loaded: true,
      loading: false,
      error: "",
      connectors: Array.isArray(json?.social_analytics?.connectors) ? json.social_analytics.connectors : [],
      preflight: json?.social_analytics?.oauthPreflight || null,
    };
  } catch (error) {
    socialOAuthState = {
      ...socialOAuthState,
      loaded: true,
      loading: false,
      error: error?.message || "OAuth status could not be checked.",
    };
  }
  rerenderSocialSettings();
  return socialOAuthState;
}
async function refreshSocialOAuthSetup({ force = false } = {}) {
  if (socialOAuthSetupState.loading || (socialOAuthSetupState.loaded && !force)) return socialOAuthSetupState;
  socialOAuthSetupState = { ...socialOAuthSetupState, loading: true, error: "" };
  try {
    const response = await fetch("/phantom-ai/ops/social-oauth/setup", {
      headers: socialAuthHeaders(),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(json?.error || `OAuth setup check failed (${response.status}).`));
    socialOAuthSetupState = { loaded: true, loading: false, error: "", setup: json.setup || null };
  } catch (error) {
    socialOAuthSetupState = {
      ...socialOAuthSetupState,
      loaded: true,
      loading: false,
      error: error?.message || "OAuth app setup could not be checked.",
    };
  }
  rerenderSocialSettings();
  return socialOAuthSetupState;
}
async function saveSocialOAuthAppSetup(payload = {}) {
  const response = await fetch("/phantom-ai/ops/social-oauth/setup", {
    method: "POST",
    headers: socialAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(json?.error || `OAuth setup save failed (${response.status}).`));
  socialOAuthSetupState = { loaded: true, loading: false, error: "", setup: json.setup || null };
  socialOAuthState.preflight = json?.social_analytics?.oauthPreflight || socialOAuthState.preflight;
  socialOAuthState.loaded = false;
  await refreshSocialOAuthStatus({ force: true });
  return json;
}
function socialConnectorFor(platform) {
  return socialOAuthState.connectors.find((connector) => connector.id === platform) || null;
}
function parseSocialOAuthPayload(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}
function handleSocialOAuthComplete(payload = {}) {
  const platform = String(payload.platform || "").toLowerCase();
  if (!platform) return;
  stopSocialOAuthAuthorizationPolling();
  const accounts = loadSocialAccounts();
  const account = accounts.find((row) => row.id === platform);
  if (account) {
    account.enabled = true;
    account.connectMode = "oauth-connected";
    account.lastConnectAt = payload.connectedAt || new Date().toISOString();
    saveSocialAccounts(accounts);
  }
  socialNotice = `${socialAccountName(platform)} connected. Refreshing live authorization state…`;
  socialOAuthState.loaded = false;
  void refreshSocialOAuthStatus({ force: true });
}
function stopSocialOAuthAuthorizationPolling() {
  if (socialOAuthPollTimer) clearInterval(socialOAuthPollTimer);
  socialOAuthPollTimer = 0;
}
function startSocialOAuthAuthorizationPolling(platform = "") {
  if (typeof window === "undefined" || !platform) return;
  stopSocialOAuthAuthorizationPolling();
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    if (!socialSettingsMount?.isConnected || attempts > 45) {
      stopSocialOAuthAuthorizationPolling();
      return;
    }
    await refreshSocialOAuthStatus({ force: true });
    const connector = socialConnectorFor(platform);
    if (connector?.configured) {
      const accounts = loadSocialAccounts();
      const account = accounts.find((row) => row.id === platform);
      if (account) {
        account.enabled = true;
        account.connectMode = "oauth-connected";
        account.lastConnectAt = new Date().toISOString();
        saveSocialAccounts(accounts);
      }
      socialNotice = `${connector.name || socialAccountName(platform)} connected. Live analytics can sync now. Posting still stays approval-gated.`;
      stopSocialOAuthAuthorizationPolling();
      rerenderSocialSettings();
    } else if (attempts === 45) {
      socialNotice = `${connector?.name || socialAccountName(platform)} sign-in is still pending. Finish provider approval, then return here.`;
      rerenderSocialSettings();
    }
  };
  setTimeout(tick, 1400);
  socialOAuthPollTimer = setInterval(tick, 3500);
}
function ensureSocialOAuthCompletionListener() {
  if (socialOAuthListenerReady || typeof window === "undefined") return;
  socialOAuthListenerReady = true;
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = parseSocialOAuthPayload(event.data);
    if (data?.protocol === "phantomforce.social-oauth.v1" && data.type === "connected") handleSocialOAuthComplete(data);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== "pf.social.oauth.last") return;
    const data = parseSocialOAuthPayload(event.newValue);
    if (data?.protocol === "phantomforce.social-oauth.v1" && data.type === "connected") handleSocialOAuthComplete(data);
  });
  const refreshWhenReturned = () => {
    if (!socialSettingsMount?.isConnected) return;
    void refreshSocialOAuthStatus({ force: true });
    void refreshSocialOAuthSetup({ force: true });
  };
  window.addEventListener("focus", refreshWhenReturned);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshWhenReturned();
  });
}
function socialStatusLabel(account) {
  const connector = socialConnectorFor(account.id);
  if (connector?.configured) return "live authorized";
  if (connector?.oauthConfigured) return "OAuth ready";
  if (socialOAuthState.loading) return "checking OAuth";
  const st = socialStatus(account);
  if (account.connectMode === "live-api" && account.analytics?.live) return "live OAuth";
  if (st === "linked") return "handle saved — not connected";
  if (account.handle) return "handle saved — not connected";
  if (st === "pending") return "finish setup";
  return "not saved";
}
function socialPostingState(account) {
  const connector = socialConnectorFor(account.id);
  if (connector?.configured) return "live feed + posting gated";
  if (connector?.oauthConfigured) return "connect signed-in account";
  if (socialOAuthState.loading) return "checking setup";
  const st = socialStatus(account);
  if (account.connectMode === "live-api" && account.analytics?.live) return "live data";
  if (account.analytics) return "report imported";
  if (st === "linked") return "OAuth needed";
  if (account.handle) return "handle ready";
  if (st === "pending") return "waiting";
  return "not configured";
}
function socialActionLabel(account) {
  const connector = socialConnectorFor(account.id);
  if (account.connectMode === "live-api" && account.analytics?.live) return `Sync ${account.name}`;
  if (connector?.configured) return `Reconnect ${account.name}`;
  if (connector?.oauthConfigured) return `Connect ${account.name}`;
  if (socialOAuthState.loading) return "Checking…";
  return `Open ${account.name} login`;
}
function clampHermesText(value = "", limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function redactHermesVisibleText(value = "", limit = 180) {
  return clampHermesText(String(value || "")
    .replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[^\s'"`;&]+/gi, "Bearer [REDACTED_BEARER]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|password|passwd|secret|private[_-]?key)\b["'`]?\s*[:=]\s*["'`]?([^\s'"`;&]+)/gi, (_match, key) => `${key}=[REDACTED_SECRET]`), limit);
}
function loadHermesExtensionState() {
  try {
    return JSON.parse(workspaceStorageGetItem(HERMES_EXTENSION_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function saveHermesExtensionState(patch = {}) {
  const next = {
    ...loadHermesExtensionState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try { workspaceStorageSetItem(HERMES_EXTENSION_KEY, JSON.stringify(next)); } catch {}
  return next;
}
function sanitizeHermesProfilePacket(payload = {}) {
  const platform = String(payload.platform || "").toLowerCase().trim();
  if (!PLATFORMS.some((p) => p.id === platform)) {
    return { ok: false, reason: "unsupported platform" };
  }
  const url = normalizeSocialUrl(payload.url || "");
  const handle = cleanSocialHandle(payload.handle || url);
  return {
    ok: Boolean(url || handle),
    platform,
    handle,
    url,
    displayName: redactHermesVisibleText(payload.displayName || ""),
    pageTitle: redactHermesVisibleText(payload.pageTitle || ""),
    source: "hermes-extension",
    sourceTab: redactHermesVisibleText(payload.sourceTab || "visible social profile", 80),
    connectedAt: payload.capturedAt || new Date().toISOString(),
    userConfirmed: Boolean(payload.userConfirmed),
    safety: {
      cookiesRead: false,
      passwordsRead: false,
      tokensRead: false,
      privateMessagesRead: false,
      browserHistoryRead: false,
    },
  };
}
function rerenderSocialSettings() {
  if (socialSettingsMount) renderSocialSettings(socialSettingsMount, socialSettingsOpts);
}
function socialAccountName(platform = "") {
  return PLATFORMS.find((p) => p.id === platform)?.name || "the platform";
}
function applyHermesProfilePacket(payload = {}) {
  const packet = sanitizeHermesProfilePacket(payload);
  const pendingPlatform = String(loadHermesExtensionState().pendingPlatform || "").toLowerCase().trim();
  if (!packet.ok) {
    socialNotice = pendingPlatform
      ? `${socialAccountName(pendingPlatform)} sign-in is open. PhantomForce will link it automatically when the browser bridge sees the signed-in public profile.`
      : "Sign-in did not find a supported public social profile yet. Open the platform sign-in once, then return here.";
    saveHermesExtensionState({ detected: true, lastSeenAt: new Date().toISOString(), lastResult: "unsupported" });
    rerenderSocialSettings();
    return;
  }
  if (pendingPlatform && packet.platform !== pendingPlatform) {
    socialNotice = `${socialAccountName(pendingPlatform)} is still waiting. Ignored a saved ${socialAccountName(packet.platform)} profile so the wrong profile was not changed.`;
    saveHermesExtensionState({ detected: true, lastSeenAt: new Date().toISOString(), lastResult: "platform_mismatch" });
    rerenderSocialSettings();
    return;
  }
  const accounts = loadSocialAccounts();
  const account = accounts.find((row) => row.id === packet.platform);
  if (!account) return;
  account.handle = packet.handle || account.handle || "";
  account.url = packet.url || socialProfileFromHandle(account.id, account.handle);
  account.enabled = true;
  account.connectMode = "hermes-extension";
  account.lastConnectAt = packet.connectedAt;
  account.hermesProof = packet;
  saveSocialAccounts(accounts);
  saveHermesExtensionState({
    detected: true,
    lastSeenAt: new Date().toISOString(),
    lastLinkedPlatform: packet.platform,
    pendingPlatform: "",
    lastResult: "linked",
  });
  socialNotice = `${account.name} profile saved from the visible browser page. This stores public identity fields only and does not authorize analytics APIs.`;
  rerenderSocialSettings();
}
function handleHermesExtensionPageMessage(event) {
  if (event.source !== window) return;
  const data = event.data || {};
  if (data.protocol !== HERMES_EXTENSION_PROTOCOL) return;
  if (data.type === "PF_HERMES_EXTENSION_READY") {
    saveHermesExtensionState({
      detected: true,
      version: redactHermesVisibleText(data.payload?.version || "", 80),
      lastSeenAt: new Date().toISOString(),
    });
    rerenderSocialSettings();
    return;
  }
  if (data.type === "PF_HERMES_LINK_CURRENT_TAB_RESULT") {
    applyHermesProfilePacket(data.payload || {});
  }
}
function ensureHermesExtensionListener() {
  if (hermesExtensionListenerReady || typeof window === "undefined") return;
  hermesExtensionListenerReady = true;
  window.addEventListener("message", handleHermesExtensionPageMessage);
  setTimeout(() => requestHermesExtensionPing(), 300);
}
function requestHermesExtensionPing() {
  if (typeof window === "undefined") return;
  window.postMessage({
    protocol: HERMES_EXTENSION_PROTOCOL,
    type: "PF_HERMES_EXTENSION_PING",
    requestedAt: new Date().toISOString(),
    forbiddenFields: ["cookies", "passwords", "tokens", "privateMessages", "browserHistory"],
  }, window.location.origin);
}
function requestHermesExtensionProfileLink(targetPlatform = "", options = {}) {
  if (typeof window === "undefined") return;
  if (!options.quiet) {
    socialNotice = `${socialAccountName(targetPlatform)} sign-in requested. PhantomForce will link it from the browser bridge using public profile fields only.`;
  }
  saveHermesExtensionState({ pendingPlatform: targetPlatform || "", lastLinkRequestedAt: new Date().toISOString() });
  window.postMessage({
    protocol: HERMES_EXTENSION_PROTOCOL,
    type: "PF_HERMES_LINK_CURRENT_TAB_REQUEST",
    requestedAt: new Date().toISOString(),
    userConfirmed: true,
    preferredPlatform: targetPlatform || "",
    allowedFields: ["platform", "handle", "url", "displayName", "pageTitle"],
    forbiddenFields: ["cookies", "passwords", "tokens", "privateMessages", "browserHistory"],
  }, window.location.origin);
  if (!options.quiet) rerenderSocialSettings();
}
function startSocialBridgePolling(targetPlatform = "") {
  if (typeof window === "undefined" || !targetPlatform) return;
  if (socialBridgePollTimer) clearInterval(socialBridgePollTimer);
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    requestHermesExtensionProfileLink(targetPlatform, { quiet: true });
    if (attempts >= 24 && socialBridgePollTimer) {
      clearInterval(socialBridgePollTimer);
      socialBridgePollTimer = 0;
    }
  };
  setTimeout(tick, 900);
  socialBridgePollTimer = setInterval(tick, 2500);
}

export function renderSocialSettings(el, opts = {}) {
  socialSettingsMount = el;
  socialSettingsOpts = opts;
  ensureHermesExtensionListener();
  ensureSocialOAuthCompletionListener();
  const canManageApps = canManageSocialOAuthApps();
  if (!socialOAuthState.loaded && !socialOAuthState.loading) void refreshSocialOAuthStatus();
  if (canManageApps && !socialOAuthSetupState.loaded && !socialOAuthSetupState.loading) void refreshSocialOAuthSetup();
  const esc = opts.esc || ((s) => String(s));
  const socialAccounts = loadSocialAccounts();
  const oauthReadyCount = socialOAuthState.connectors.filter((connector) => connector.oauthConfigured).length;
  const authorizedCount = socialOAuthState.connectors.filter((connector) => connector.configured).length;
  el.innerHTML = `
    <div class="settings">
      <div class="set-section set-social-section">
        <div class="set-sec-head">
          <div>
            <h3>Connect accounts</h3>
            <p class="set-note">Pick a channel and sign in. If a provider app is ready, PhantomForce can connect with official OAuth. If it is not ready yet, you can still open the platform login and save the public handle without pretending it is live.</p>
          </div>
          <span class="set-safe-pill">${authorizedCount}/${socialAccounts.length} live · ${oauthReadyCount}/${socialAccounts.length} ready</span>
        </div>
        ${socialNotice ? `<div class="set-social-notice">${esc(socialNotice)}</div>` : ""}
        ${socialOAuthState.error ? `<div class="set-social-notice">OAuth status check: ${esc(socialOAuthState.error)}</div>` : ""}
        ${socialOAuthManagedPanel(esc)}
        <div class="set-social-grid">
          ${socialAccounts.map((account) => socialCard(account, esc)).join("")}
        </div>
        ${canManageApps ? socialOAuthSetupPanel(esc) : ""}
      </div>
    </div>`;

  const callbackInput = el.querySelector("[data-oauth-callback]");
  if (callbackInput) callbackInput.onclick = () => { callbackInput.select(); navigator.clipboard?.writeText(callbackInput.value).catch(() => {}); };
  const oauthSetupForm = el.querySelector("[data-oauth-setup-form]");
  if (oauthSetupForm) oauthSetupForm.onsubmit = async (event) => {
    event.preventDefault();
    const platform = oauthSetupForm.querySelector("[data-oauth-platform]")?.value || "";
    const clientId = oauthSetupForm.querySelector("[data-oauth-client-id]")?.value.trim() || "";
    const clientSecret = oauthSetupForm.querySelector("[data-oauth-client-secret]")?.value.trim() || "";
    const redirectUri = callbackInput?.value || "";
    if (!clientId && !clientSecret) {
      socialNotice = "Paste the provider app ID or secret before saving.";
      renderSocialSettings(el, opts);
      return;
    }
    try {
      socialNotice = `Saving ${platform} OAuth app setup…`;
      await saveSocialOAuthAppSetup({ platform, clientId, clientSecret, redirectUri });
      socialNotice = `${platform} OAuth app saved. Connect the account from its channel card.`;
    } catch (error) {
      socialNotice = error?.message || "OAuth app setup could not be saved.";
    }
    renderSocialSettings(el, opts);
  };
  const quickConnect = el.querySelector("[data-social-quick-connect]");
  if (quickConnect) quickConnect.onclick = async () => {
    quickConnect.disabled = true;
    let readyAccounts = socialAccounts.filter((account) => {
      const connector = socialConnectorFor(account.id);
      return connector?.oauthConfigured && !connector?.configured;
    });
    if (!readyAccounts.length && !socialOAuthState.loading) {
      await refreshSocialOAuthStatus({ force: true });
      readyAccounts = socialAccounts.filter((account) => {
        const connector = socialConnectorFor(account.id);
        return connector?.oauthConfigured && !connector?.configured;
      });
    }
    if (!readyAccounts.length) {
      socialNotice = "No OAuth-ready provider apps are available yet. Open Developer provider setup once, save the provider app credentials, then Quick connect can authorize accounts.";
      renderSocialSettings(el, opts);
      return;
    }
    const popups = readyAccounts.map((account) => ({ account, popup: openSocialAuthWindow(account.name) }));
    const blocked = popups.filter((item) => !item.popup).length;
    let opened = 0;
    for (const item of popups) {
      try {
        const result = await beginSocialAccountConnection(item.account, item.popup);
        if (result.opened) opened += 1;
      } catch (error) {
        item.account.connectMode = item.account.handle ? "manual-confirmed" : "manual";
      }
    }
    saveSocialAccounts(socialAccounts);
    socialNotice = `Quick connect opened ${opened}/${readyAccounts.length} OAuth-ready account authorization ${readyAccounts.length === 1 ? "window" : "windows"}.${blocked ? ` ${blocked} popup ${blocked === 1 ? "was" : "were"} blocked by the browser.` : ""} Facebook/Instagram will ask which Meta Page assets to authorize; choose the exact Page you want PhantomForce to use.`;
    renderSocialSettings(el, opts);
  };

  // social account linking stays local and never reads browser cookies/tokens.
  // OAuth/API tokens must stay server-side; this UI only captures editable public identity.
  el.querySelectorAll("[data-social-card]").forEach((card) => {
    const id = card.dataset.socialCard;
    const account = socialAccounts.find((row) => row.id === id);
    if (!account) return;
    const saveAndRender = () => { saveSocialAccounts(socialAccounts); renderSocialSettings(el, opts); };
    const clear = card.querySelector("[data-social-clear]");
    if (clear) clear.onclick = () => {
      account.handle = ""; account.url = ""; account.loginIdentity = ""; account.enabled = false; account.connectMode = "manual"; account.lastConnectAt = "";
      delete account.analytics;
      delete account.insights;
      delete account.metrics;
      delete account.hermesProof;
      socialNotice = `${account.name} link cleared locally. No remote account was changed.`;
      saveAndRender();
    };
    const open = card.querySelector("[data-social-open]");
    if (open) open.onclick = async () => {
      open.disabled = true;
      const popup = openSocialAuthWindow(account.name);
      try {
        await beginSocialAccountConnection(account, popup);
      } catch (error) {
        routeSocialAuthWindow(popup, socialLoginTarget(account));
        account.connectMode = "pending";
        socialNotice = `${account.name} login opened. OAuth did not start yet, so this will only save the public handle until provider setup is ready.`;
      }
      saveAndRender();
    };
    const confirmForm = card.querySelector("[data-social-confirm-form]");
    if (confirmForm) confirmForm.onsubmit = (event) => {
      event.preventDefault();
      const input = confirmForm.querySelector("[data-social-confirm-input]");
      const value = input?.value.trim();
      if (!value) return;
      account.handle = cleanSocialHandle(value);
      account.url = normalizeSocialUrl(value) || socialProfileFromHandle(account.id, account.handle);
      account.enabled = true;
      account.connectMode = "manual-confirmed";
      account.lastConnectAt = new Date().toISOString();
      delete account.hermesProof;
      if (socialBridgePollTimer) { clearInterval(socialBridgePollTimer); socialBridgePollTimer = 0; }
      socialNotice = `${account.name} handle saved. Live data and cross-posting remain locked until OAuth/API authorization is configured.`;
      saveAndRender();
    };
  });

}

function socialOAuthSetupPanel(esc) {
  const setup = socialOAuthSetupState.setup;
  const providers = Array.isArray(setup?.providers) ? setup.providers : [];
  const callbackUrl = setup?.recommendedRedirectUri || setup?.redirectUri || "https://admin.phantomforce.online/phantom-ai/ops/social-oauth/callback";
  const preflight = socialOAuthState.preflight || {};
  const nextLabel = preflight.nextGlobalLabel || "Set up provider apps";
  const nextDetail = preflight.nextGlobalAction === "connect_signed_in_account"
    ? "Provider apps are saved. Connect each account with the browser that is already signed in."
    : preflight.nextGlobalAction === "sync_live_feed"
      ? "Accounts are authorized. Sync live metrics from the official platform APIs."
      : "Create the provider app credentials once, then every workspace can connect accounts with OAuth.";
  const providerOptions = providers.length
    ? providers.map((provider) => `<option value="${esc(provider.id)}">${esc(provider.name)}${provider.id === "instagram" ? " + Facebook" : ""}</option>`).join("")
    : PLATFORMS.map((platform) => `<option value="${esc(platform.id)}">${esc(platform.name)}</option>`).join("");
  const providerRows = providers.length
    ? providers.map((provider) => `<span class="${provider.oauthConfigured ? "is-ready" : "is-missing"}">${esc(provider.name)}${provider.id === "instagram" ? " + Facebook" : ""} · ${provider.oauthConfigured ? "ready" : "needs app"}</span>`).join("")
    : `<span>Checking provider app setup…</span>`;
  return `<details class="set-oauth-apps">
    <summary>
      <span>Developer provider setup</span>
      <b>${esc(String(setup?.readyCount ?? 0))}/${esc(String(setup?.totalCount ?? (providers.length || PLATFORMS.length)))} ready</b>
    </summary>
    <p>This is the one-time developer setup for official OAuth/API access. Keep it collapsed unless you are adding provider app credentials. Normal account sign-in happens on the cards above.</p>
    <p class="set-social-next"><b>Next:</b> ${esc(nextLabel)} · ${esc(nextDetail)}</p>
    ${socialOAuthSetupState.error ? `<div class="set-social-notice">${esc(socialOAuthSetupState.error)}</div>` : ""}
    <label class="set-oauth-callback">
      <span>Callback URL for provider consoles</span>
      <input readonly value="${esc(callbackUrl)}" data-oauth-callback />
    </label>
    <div class="set-oauth-provider-row">${providerRows}</div>
    <form class="set-oauth-form" data-oauth-setup-form>
      <select data-oauth-platform>${providerOptions}</select>
      <input data-oauth-client-id autocomplete="off" placeholder="Client ID / App ID / Client key" />
      <input data-oauth-client-secret autocomplete="off" placeholder="Client secret / App secret" type="password" />
      <button class="btn btn-primary" type="submit">${socialOAuthSetupState.loading ? "Checking…" : "Save app"}</button>
    </form>
  </details>`;
}

function canManageSocialOAuthApps() {
  const active = ctx?.session || {};
  return Boolean(active.canManageAccess || active.isSuperAdmin);
}

function socialOAuthManagedPanel(esc) {
  const readyCount = socialOAuthState.connectors.filter((connector) => connector.oauthConfigured).length;
  const authorizedCount = socialOAuthState.connectors.filter((connector) => connector.configured).length;
  const totalCount = socialOAuthState.connectors.length || PLATFORMS.length;
  const preflight = socialOAuthState.preflight || {};
  const nextLabel = preflight.nextGlobalLabel || (authorizedCount ? "Sync live feed" : readyCount ? "Connect accounts" : "Provider setup waiting");
  const nextDetail = preflight.nextGlobalAction === "sync_live_feed"
    ? "Authorized accounts can now pull official metrics."
    : preflight.nextGlobalAction === "connect_signed_in_account"
      ? "Use the browser account you are already signed into; PhantomForce stores the resulting token server-side."
      : "The platform app must be configured by the owner before account OAuth can begin.";
  return `<div class="set-social-command">
    <div>
      <span>Account sign-in</span>
      <b>${esc(String(authorizedCount))}/${esc(String(totalCount))} live connections</b>
      <p>${esc(nextLabel)} · ${esc(nextDetail)} ${readyCount ? `(${readyCount}/${totalCount} provider apps ready)` : ""}</p>
    </div>
    <button class="set-social-bolt" data-social-quick-connect type="button" title="Connect every OAuth-ready account">
      ${svgIc("spark")}
      <span>Quick connect</span>
    </button>
  </div>`;
}

function socialCard(account, esc) {
  const status = socialStatus(account);
  const connector = socialConnectorFor(account.id);
  const profile = socialProfileTarget(account);
  const lastConnect = connector?.configured
    ? `Authorized account: ${connector.savedConnection?.accountHandle || connector.savedConnection?.accountName || connector.handle || account.name}`
    : connector?.oauthConfigured
      ? "OAuth app ready. Click connect and approve once."
      : status === "linked"
    ? (profile ? `Public handle saved: ${profile}` : "Public handle saved")
  : status === "pending"
      ? "Sign-in page opened. Save the visible handle below."
      : account.handle
        ? `Public handle ready: ${account.handle}`
        : "Open login, then save the public handle";
  const providerUnavailableCopy = "Public login only";
  const oauthDetail = connector
    ? `<div class="set-social-hermes-proof">${svgIc(connector.configured ? "check" : connector.oauthConfigured ? "lock" : "spark")} ${esc(connector.configured ? "Connected" : connector.oauthConfigured ? "Ready to connect" : providerUnavailableCopy)}</div>`
    : socialOAuthState.loading ? `<div class="set-social-hermes-proof">${svgIc("refresh")} Checking…</div>` : "";
  const targetHint = account.id === "facebook"
    ? `<div class="set-social-hermes-proof">${svgIc("lock")} Facebook connects to a selected Page, not your personal profile. Reconnect to choose a different Page in Meta.</div>`
    : account.id === "instagram"
      ? `<div class="set-social-hermes-proof">${svgIc("lock")} Instagram connects through the Meta Page's business account. Select the matching Page during Meta authorization.</div>`
      : "";
  const hermesProof = account.hermesProof
    ? `<div class="set-social-hermes-proof">${svgIc("spark")} Handle saved — not connected · ${esc(account.hermesProof.displayName || account.hermesProof.handle || account.name)}</div>`
    : "";
  return `<article class="set-social-card is-${status}" data-social-card="${account.id}">
    <button class="set-card-x" data-social-clear aria-label="Clear ${esc(account.name)} link" title="Clear ${esc(account.name)} link" type="button">×</button>
    <div class="set-social-top">
      <span class="set-social-dot" style="background:${account.color}"></span>
      <span><b>${esc(account.name)}</b><i>${esc(socialStatusLabel(account))}</i></span>
    </div>
    <div class="set-social-connect-state">
      <span>Analytics status</span>
      <b>${esc(socialPostingState(account))}</b>
    </div>
    ${oauthDetail}
    ${targetHint}
    ${hermesProof}
    <div class="set-social-actions">
      <button class="set-social-open set-social-action set-social-signin" data-social-open type="button">${esc(socialActionLabel(account))}</button>
      <span>${esc(lastConnect)}</span>
    </div>
    <form class="set-social-confirm" data-social-confirm-form>
      <label>Editable handle or profile URL</label>
      <div class="set-social-confirm-row">
        <input type="text" data-social-confirm-input placeholder="@officialchicagoshots or https://..." value="${esc(account.handle || account.url || "officialchicagoshots")}"/>
        <button class="btn btn-primary" type="submit">Save handle</button>
      </div>
    </form>
  </article>`;
}

function svgIc(k) {
  const P = {
    image: `<rect x="2.5" y="4" width="11" height="8" rx="1.5"/><path d="M7 6.5l3 1.5-3 1.5z"/>`,
    film: `<rect x="2.5" y="4" width="11" height="8" rx="1"/><path d="M2.5 6.5h11M5.5 4v8M10.5 4v8"/>`,
    spark: `<path d="M8 2.6l1.4 3.4 3.6.3-2.7 2.4.8 3.5L8 10.8 4.9 12.6l.8-3.5L3 6.7l3.6-.3z"/>`,
    bolt: `<path d="M8.5 2L4 9h3l-.5 5L11 7H8z"/>`,
    upload: `<path d="M8 10.5V4M5.5 6L8 3.5 10.5 6M3.5 11.5h9"/>`,
    check: `<circle cx="8" cy="8" r="5.2"/><path d="M6 8l1.5 1.5L10.5 6.5"/>`,
    edit: `<path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3z"/>`,
    copy: `<rect x="5" y="5" width="7.5" height="7.5" rx="1.2"/><path d="M3.5 10.5H3a1.2 1.2 0 0 1-1.2-1.2V3A1.2 1.2 0 0 1 3 1.8h6.3A1.2 1.2 0 0 1 10.5 3v.5"/>`,
    play: `<path d="M5 3.5l7 4.5-7 4.5z"/>`,
    lock: `<rect x="3.5" y="7" width="9" height="6" rx="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`,
    undo: `<path d="M6 4L3 7l3 3M3 7h6a4 4 0 0 1 0 8H6"/>`,
    redo: `<path d="M10 4l3 3-3 3M13 7H7a4 4 0 0 0 0 8h3"/>`,
    refresh: `<path d="M13 5.2A5.3 5.3 0 0 0 4 4.3L3 5.4M3 3.2v2.2h2.2M3 10.8a5.3 5.3 0 0 0 9 1l1-1.2M13 12.8v-2.2h-2.2"/>`,
    expand: `<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>`,
    collapse: `<path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/>`,
    hub: `<circle cx="8" cy="3.6" r="1.5"/><circle cx="3.6" cy="11.4" r="1.5"/><circle cx="12.4" cy="11.4" r="1.5"/><path d="M8 5.1v3.4M8 8.5l-3.7 2M8 8.5l3.7 2"/>`,
    download: `<path d="M8 3v7.5M5.2 8l2.8 2.8L10.8 8M4 13.5h8"/>`,
    target: `<circle cx="8" cy="8" r="5.3"/><circle cx="8" cy="8" r="1.7"/>`,
    grid: `<rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1"/><rect x="9" y="2.4" width="4.6" height="4.6" rx="1"/><rect x="2.4" y="9" width="4.6" height="4.6" rx="1"/><rect x="9" y="9" width="4.6" height="4.6" rx="1"/>`,
    clock: `<circle cx="8" cy="8" r="5.3"/><path d="M8 5.2v3.1l2.1 1.2"/>`,
    layout: `<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.6"/><path d="M2.4 6.6h11.2M6.4 6.6v7"/>`,
    cpu: `<rect x="5" y="5" width="6" height="6" rx="1"/><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M5.1 5.1L3.8 3.8M10.9 5.1l1.3-1.3M5.1 10.9l-1.3 1.3M10.9 10.9l1.3 1.3"/>`,
    gear: `<circle cx="8" cy="8" r="2.2"/><path d="M8 2.8v1.5M8 11.7v1.5M2.8 8h1.5M11.7 8h1.5M4.5 4.5l1.1 1.1M10.4 10.4l1.1 1.1M11.5 4.5l-1.1 1.1M5.6 10.4l-1.1 1.1"/>`,
    close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}
