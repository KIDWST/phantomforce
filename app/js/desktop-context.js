import { session } from "./store.js?v=phantom-live-20260718-1";

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

function requestBrowserDesktopContext() {
  return bridgeRequest("PF_HERMES_DESKTOP_CONTEXT_REQUEST");
}

function focusDesktopTab(tabId) {
  return bridgeRequest("PF_HERMES_FOCUS_TAB_REQUEST", { tabId });
}

function mediaControl(tabId, command) {
  return bridgeRequest("PF_HERMES_MEDIA_CONTROL_REQUEST", { tabId, command });
}

function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function normalizeSystemSession(item = {}) {
  return {
    ...item,
    id: item.session_id || item.id || "",
    sessionId: item.session_id || item.id || "",
    source: "windows",
    app: item.app || "Media",
    title: item.title || "Media",
    subtitle: item.artist || item.album || "",
    audible: Boolean(item.playing),
    active: true,
    controls: item.controls || {},
  };
}

async function requestSystemMediaContext() {
  try {
    const response = await fetch("/phantom-ai/desktop-media/status", { headers: authHeaders() });
    const data = await response.json().catch(() => null);
    const media = data?.media;
    if (!response.ok || !media?.ok) {
      return { ok: false, reason: media?.reason || data?.error || `http_${response.status}` };
    }
    const sessions = Array.isArray(media.sessions) ? media.sessions.map(normalizeSystemSession) : [];
    const active = media.active ? normalizeSystemSession(media.active) : sessions[0] || null;
    return { ok: true, activeMedia: active, mediaTabs: sessions, source: "windows" };
  } catch {
    return { ok: false, reason: "system_media_unreachable" };
  }
}

async function controlSystemMedia(active, command) {
  try {
    const response = await fetch("/phantom-ai/desktop-media/control", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ session_id: active?.sessionId || active?.id || "", command }),
    });
    const data = await response.json().catch(() => null);
    return { ok: Boolean(response.ok && data?.ok), reason: data?.media?.reason || data?.error || "" };
  } catch {
    return { ok: false, reason: "system_media_unreachable" };
  }
}

async function requestDesktopContext() {
  const [system, browser] = await Promise.all([
    requestSystemMediaContext(),
    requestBrowserDesktopContext(),
  ]);
  const browserTabs = Array.isArray(browser?.mediaTabs)
    ? browser.mediaTabs.map((tab) => ({ ...tab, source: "browser" }))
    : [];
  const systemTabs = Array.isArray(system?.mediaTabs) ? system.mediaTabs : [];
  const mediaTabs = [...systemTabs, ...browserTabs.filter((tab) =>
    !systemTabs.some((item) => item.title === tab.title && item.app === tab.app),
  )];
  return {
    ok: Boolean(system?.ok || browser?.ok),
    activeMedia: system?.activeMedia || (browser?.activeMedia ? { ...browser.activeMedia, source: "browser" } : null),
    mediaTabs,
    source: system?.activeMedia ? "windows" : browser?.ok ? "browser" : "none",
    reason: system?.reason || browser?.reason || "",
  };
}

function compactTitle(value = "") {
  return String(value || "Media").replace(/\s+[-|•]\s+(YouTube|Spotify|Netflix|SoundCloud|Twitch|Vimeo|Apple Music).*$/i, "").trim() || "Media";
}

function mediaInitial(tab = {}) {
  const source = tab.app || hostOf(tab.url) || tab.title || "M";
  return String(source).trim().charAt(0).toUpperCase() || "M";
}

function youtubeVideoId(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    if (!/(^|\.)youtube\.com$/i.test(host)) return "";
    if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/").filter(Boolean)[1] || "";
    }
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

function thumbnailUrl(tab = {}) {
  const youtubeId = youtubeVideoId(tab.url || tab.pageUrl || "");
  if (youtubeId) return `https://img.youtube.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`;
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
  const focusAttr = tab.source === "browser" ? ` data-dc-focus="${esc(tab.id || "")}"` : "";
  const title = tab.source === "browser" ? "Open media tab" : "Now playing";
  if (url) {
    return `<button class="dc-mini-thumb" type="button"${focusAttr} title="${title}"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"/></button>`;
  }
  return `<button class="dc-mini-thumb" type="button"${focusAttr} title="${title}"><span>${esc(mediaInitial(tab))}</span></button>`;
}

function renderMiniRoot(root, state) {
  const mediaTabs = Array.isArray(state.mediaTabs) ? state.mediaTabs : [];
  const active = state.activeMedia || mediaTabs[0] || null;
  const status = state.loading ? "checking" : state.ok ? (active ? (active.audible ? "playing" : "ready") : "idle") : "waiting";
  const hasMedia = Boolean(active?.id);
  const controls = active?.controls || {};
  const canPlay = hasMedia && (active?.source !== "windows" || controls.play_pause !== false);
  const canPrevious = hasMedia && (active?.source !== "windows" || controls.previous !== false);
  const canNext = hasMedia && (active?.source !== "windows" || controls.next !== false);
  const expanded = Boolean(root.__pfDesktopMiniExpanded);
  root.innerHTML = `
    <div class="dc-mini-shell${expanded ? " is-expanded" : ""}" data-dc-mini-shell data-dc-mini-toggle aria-expanded="${expanded ? "true" : "false"}">
      ${hasMedia ? renderThumb(active) : `<button class="dc-mini-thumb is-empty" type="button" data-dc-refresh title="Find media"><span>♪</span></button>`}
      <div class="dc-mini-copy">
        <span><i class="dc-dot${state.ok ? " is-on" : ""}"></i> Media · ${esc(status)}</span>
        <b title="${esc(active?.title || "No media detected")}">${esc(active ? compactTitle(active.title) : "No media playing")}</b>
      </div>
      <div class="dc-mini-controls" aria-label="Media controls">
        <button type="button" data-dc-control="previous" ${canPrevious ? "" : "disabled"} title="Previous">‹</button>
        <button class="is-main" type="button" data-dc-control="play-pause" ${canPlay ? "" : "disabled"} title="Play or pause">${active?.audible ? "Ⅱ" : "▶"}</button>
        <button type="button" data-dc-control="next" ${canNext ? "" : "disabled"} title="Next">›</button>
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
        <b>No active media detected.</b>
        <span>Start VLC, Media Player, YouTube, or another supported player.</span>
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
      const response = active.source === "windows"
        ? await controlSystemMedia(active, command)
        : await mediaControl(active.id, command);
      controlButton.textContent = response?.ok ? "✓" : previous;
      controlButton.disabled = false;
      if (!response?.ok) {
        controlButton.title = "This player did not accept that control";
        opts.notify?.("Media", "That player did not accept the control yet. Start playback once, then refresh.");
      }
      setTimeout(() => {
        controlButton.textContent = previous;
        refreshDesktopContext(root, opts);
      }, 900);
      return;
    }
    const miniToggle = event.target.closest?.("[data-dc-mini-toggle]");
    if (miniToggle) {
      root.__pfDesktopMiniExpanded = !root.__pfDesktopMiniExpanded;
      renderRoot(root, root.__pfDesktopContextState || {});
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
