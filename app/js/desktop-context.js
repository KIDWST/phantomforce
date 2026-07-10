const DESKTOP_PROTOCOL = "phantomforce.hermes.extension.v1";
const BRIDGE_TIMEOUT_MS = 1800;
const REFRESH_MS = 15000;
const RESPONSE_TYPES = new Set([
  "PF_HERMES_DESKTOP_CONTEXT_RESULT",
  "PF_HERMES_FOCUS_TAB_RESULT",
  "PF_HERMES_MEDIA_CONTROL_RESULT",
]);

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

function mediaControl(tabId, command) {
  return bridgeRequest("PF_HERMES_MEDIA_CONTROL_REQUEST", { tabId, command });
}

function compactTitle(value = "") {
  return String(value || "Media").replace(/\s+[-|•]\s+(YouTube|Spotify|Netflix|SoundCloud|Twitch|Vimeo|Apple Music).*$/i, "").trim() || "Media";
}

function mediaInitial(tab = {}) {
  const source = tab.app || hostOf(tab.url) || tab.title || "M";
  return String(source).trim().charAt(0).toUpperCase() || "M";
}

function thumbnailUrl(tab = {}) {
  return tab.thumbnail || tab.thumbnailUrl || tab.artwork || tab.favIconUrl || tab.icon || "";
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

function renderThumb(tab = {}) {
  const url = thumbnailUrl(tab);
  if (url) {
    return `<button class="dc-mini-thumb" type="button" data-dc-focus="${esc(tab.id || "")}" title="Open media tab"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"/></button>`;
  }
  return `<button class="dc-mini-thumb" type="button" data-dc-focus="${esc(tab.id || "")}" title="Open media tab"><span>${esc(mediaInitial(tab))}</span></button>`;
}

function renderMiniRoot(root, state) {
  const mediaTabs = Array.isArray(state.mediaTabs) ? state.mediaTabs : [];
  const active = state.activeMedia || mediaTabs[0] || null;
  const status = state.loading ? "checking" : state.ok ? (active ? (active.audible ? "playing" : "ready") : "idle") : "waiting";
  const hasTab = Boolean(active?.id);
  root.innerHTML = `
    <div class="dc-mini-shell" data-dc-mini-shell>
      ${hasTab ? renderThumb(active) : `<button class="dc-mini-thumb is-empty" type="button" data-dc-refresh title="Find media"><span>♪</span></button>`}
      <div class="dc-mini-copy">
        <span><i class="dc-dot${state.ok ? " is-on" : ""}"></i> Media bridge · ${esc(status)}</span>
        <b title="${esc(active?.title || "No media detected")}">${esc(active ? compactTitle(active.title) : "No media playing")}</b>
      </div>
      <div class="dc-mini-controls" aria-label="Media controls">
        <button type="button" data-dc-control="previous" ${hasTab ? "" : "disabled"} title="Previous">‹</button>
        <button class="is-main" type="button" data-dc-control="play-pause" ${hasTab ? "" : "disabled"} title="Play or pause">${active?.audible ? "Ⅱ" : "▶"}</button>
        <button type="button" data-dc-control="next" ${hasTab ? "" : "disabled"} title="Next">›</button>
        <button type="button" data-dc-refresh title="Refresh">↻</button>
      </div>
    </div>`;
}

function renderRoot(root, state) {
  const compact = root.dataset.dcLayout === "mini" || root.classList.contains("desktop-context-top");
  if (compact) {
    renderMiniRoot(root, state);
    return;
  }
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
      if (!tabId) return;
      const isThumb = focusButton.classList.contains("dc-mini-thumb");
      const previous = focusButton.textContent;
      if (!isThumb) focusButton.textContent = "...";
      else focusButton.classList.add("is-working");
      const response = await focusDesktopTab(tabId);
      if (!isThumb) {
        focusButton.textContent = response?.ok ? "Opened" : "Open";
        setTimeout(() => { focusButton.textContent = "Open"; }, 1200);
      } else {
        focusButton.classList.remove("is-working");
        focusButton.title = response?.ok ? "Opened media tab" : "Open media tab";
      }
      return;
    }
    const controlButton = event.target.closest?.("[data-dc-control]");
    if (controlButton) {
      const command = controlButton.getAttribute("data-dc-control");
      const state = root.__pfDesktopContextState || {};
      const active = state.activeMedia || (Array.isArray(state.mediaTabs) ? state.mediaTabs[0] : null);
      if (!active?.id || !command) return;
      const previous = controlButton.textContent;
      controlButton.textContent = "…";
      controlButton.disabled = true;
      const response = await mediaControl(active.id, command);
      controlButton.textContent = response?.ok ? "✓" : previous;
      controlButton.disabled = false;
      if (!response?.ok) {
        controlButton.title = "Media control bridge needs the extension update";
        opts.notify?.("Media Bridge", "Media control command was sent, but the desktop bridge did not confirm it yet.");
      }
      setTimeout(() => {
        controlButton.textContent = previous;
        refreshDesktopContext(root, opts);
      }, 900);
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
