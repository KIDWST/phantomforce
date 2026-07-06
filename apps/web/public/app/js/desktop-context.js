const DESKTOP_PROTOCOL = "phantomforce.hermes.extension.v1";
const BRIDGE_TIMEOUT_MS = 1800;
const REFRESH_MS = 15000;
const RESPONSE_TYPES = new Set(["PF_HERMES_DESKTOP_CONTEXT_RESULT", "PF_HERMES_FOCUS_TAB_RESULT"]);

let listenerReady = false;
let requestSeq = 0;
const pending = new Map();

function esc(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function hostOf(rawUrl = "") {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function ensureBridgeListener() {
  if (listenerReady || typeof window === "undefined") return;
  listenerReady = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.protocol !== DESKTOP_PROTOCOL) return;
    if (!RESPONSE_TYPES.has(data.type)) return;
    const payload = data.payload || {};
    const requestId = payload.requestId || data.requestId;
    if (!requestId || !pending.has(requestId)) return;
    const entry = pending.get(requestId);
    clearTimeout(entry.timer);
    pending.delete(requestId);
    entry.resolve(payload);
  });
}

function bridgeRequest(type, payload = {}) {
  ensureBridgeListener();
  return new Promise((resolve) => {
    const requestId = `pf-desktop-${Date.now()}-${++requestSeq}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, requestId, reason: "bridge_timeout" });
    }, BRIDGE_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    window.postMessage({
      protocol: DESKTOP_PROTOCOL,
      type,
      requestId,
      payload: { ...payload, requestId },
      requestedAt: new Date().toISOString(),
    }, window.location.origin);
  });
}

function requestDesktopContext() {
  return bridgeRequest("PF_HERMES_DESKTOP_CONTEXT_REQUEST");
}

function focusDesktopTab(tabId) {
  return bridgeRequest("PF_HERMES_FOCUS_TAB_REQUEST", { tabId });
}

function renderPill(label, isOn = false) {
  return `<span class="dc-pill${isOn ? " is-on" : ""}">${esc(label)}</span>`;
}

function renderTab(tab = {}, { primary = false } = {}) {
  const title = tab.title || "Media tab";
  const host = hostOf(tab.url);
  return `
    <div class="dc-tab${primary ? " is-primary" : ""}">
      <div class="dc-tab-main">
        <span class="dc-app">${esc(tab.app || "Browser")}</span>
        <b>${esc(title)}</b>
        <small>${esc(host || "safe browser tab")}</small>
      </div>
      <div class="dc-tab-actions">
        <span class="dc-state">
          ${tab.audible ? renderPill("playing", true) : ""}
          ${tab.muted ? renderPill("muted") : ""}
          ${tab.active ? renderPill("active", true) : ""}
        </span>
        <button class="dc-open" type="button" data-dc-focus="${esc(tab.id)}">Open</button>
      </div>
    </div>`;
}

function renderRoot(root, state) {
  const mediaTabs = Array.isArray(state.mediaTabs) ? state.mediaTabs : [];
  const active = state.activeMedia || mediaTabs[0] || null;
  const status = state.loading ? "scanning" : state.ok ? `${mediaTabs.length} found` : "bridge waiting";
  root.innerHTML = `
    <div class="dc-head">
      <div>
        <p>Desktop Context</p>
        <h2>Now playing</h2>
      </div>
      <button class="dc-refresh" type="button" data-dc-refresh>${state.loading ? "..." : "Refresh"}</button>
    </div>
    <div class="dc-status">
      <span class="dc-dot${state.ok ? " is-on" : ""}"></span>
      <span>${esc(status)}</span>
    </div>
    ${active ? `<div class="dc-now">${renderTab(active, { primary: true })}</div>` : `
      <div class="dc-empty">
        <b>No media tab detected.</b>
        <span>Open YouTube, Spotify, or another media tab, then refresh.</span>
      </div>`}
    ${mediaTabs.length > 1 ? `<div class="dc-list">${mediaTabs.filter((tab) => tab.id !== active?.id).slice(0, 3).map((tab) => renderTab(tab)).join("")}</div>` : ""}
    <p class="dc-safe">Safe metadata only. No cookies, passwords, history, files, or messages.</p>`;
}

async function refreshDesktopContext(root, opts = {}) {
  if (!root) return;
  root.__pfDesktopContextState = { ...(root.__pfDesktopContextState || {}), loading: true };
  renderRoot(root, root.__pfDesktopContextState);
  const response = await requestDesktopContext();
  const nextState = {
    loading: false,
    ok: Boolean(response?.ok),
    activeMedia: response?.activeMedia || null,
    mediaTabs: Array.isArray(response?.mediaTabs) ? response.mediaTabs : [],
    reason: response?.reason || "",
  };
  root.__pfDesktopContextState = nextState;
  renderRoot(root, nextState);
  const active = nextState.activeMedia;
  if (active?.id && active.id !== root.__pfDesktopLastActiveId) {
    root.__pfDesktopLastActiveId = active.id;
    opts.notify?.("Desktop Context", `${active.app || "Media"} ready: ${active.title || "media tab"}`);
  }
}

export function mountDesktopContextWidget(root, opts = {}) {
  if (!root || root.__pfDesktopContextMounted) return;
  root.__pfDesktopContextMounted = true;
  root.__pfDesktopContextState = { loading: false, ok: false, mediaTabs: [] };
  renderRoot(root, root.__pfDesktopContextState);
  root.addEventListener("click", async (event) => {
    const refreshButton = event.target.closest?.("[data-dc-refresh]");
    if (refreshButton) {
      await refreshDesktopContext(root, opts);
      return;
    }
    const focusButton = event.target.closest?.("[data-dc-focus]");
    if (focusButton) {
      const tabId = focusButton.getAttribute("data-dc-focus");
      focusButton.textContent = "...";
      const response = await focusDesktopTab(tabId);
      focusButton.textContent = response?.ok ? "Opened" : "Open";
      setTimeout(() => { focusButton.textContent = "Open"; }, 1200);
    }
  });
  refreshDesktopContext(root, opts);
  root.__pfDesktopContextInterval = setInterval(() => {
    if (!root.isConnected) {
      clearInterval(root.__pfDesktopContextInterval);
      return;
    }
    refreshDesktopContext(root, opts);
  }, REFRESH_MS);
}
