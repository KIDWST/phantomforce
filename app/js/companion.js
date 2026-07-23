/* PhantomForce — PhantomPresence: the companion inside the chat.
   Phantom lives in the chat header as a contained presence, not a floating toy.
   It uses the real character engine for blinking, eye tracking, and moods,
   respects reduced motion, and keeps every status dot paired with text. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260723-37";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const PRESENCE_STATES = {
  online: { label: "Systems online", caption: "Systems online.", dot: "ok", mood: "idle", emotion: "calm", hold: 0 },
  idle: { label: "Systems online", caption: "Ready when you are.", dot: "ok", mood: "idle", emotion: "calm", hold: 0 },
  listening: { label: "Listening", caption: "I'm listening.", dot: "ok", mood: "listening", emotion: "calm", hold: 2400 },
  thinking: { label: "Thinking", caption: "Thinking through the best move...", dot: "ok", mood: "thinking", emotion: "bright", hold: 12000 },
  speaking: { label: "Responding", caption: "Here's what I'd do.", dot: "ok", mood: "talking", emotion: "bright", hold: 3200 },
  building: { label: "Phantom Loop", caption: "Loop is on.", dot: "ok", mood: "thinking", emotion: "bright", hold: 6000 },
  looping: { label: "Phantom Loop", caption: "Routing through the loop...", dot: "ok", mood: "thinking", emotion: "bright", hold: 6000 },
  success: { label: "Done", caption: "Done. Ready for approval.", dot: "ok", mood: "talking", emotion: "happy", hold: 3000 },
  warning: { label: "Needs approval", caption: "This needs approval first.", dot: "warn", mood: "talking", emotion: "alert", hold: 4200 },
  error: { label: "Blocked", caption: "Blocked. Here's what needs fixing.", dot: "err", mood: "talking", emotion: "alert", hold: 4200 },
  paused: { label: "Paused", caption: "Paused.", dot: "err", mood: "idle", emotion: "sad", hold: 0 },
};

let el = null;
let character = null;
let ctx2 = null;
let dpr = 1;
const SIZE = 48;
let current = "idle";
let prevDef = null;             // previous state's look, for crossfading
let stateChangedAt = 0;         // performance.now() of the last state switch
const FADE_MS = 420;            // crossfade window — smooth, never a hard cut
let decayTimer = 0;
let rafOn = false;
let pulse = 0;
let pointer = { x: -9999, y: -9999 };
let mode = "chat";
let onModeChange = null;
let canUseLoop = () => true;
let onLoopUnavailable = null;
let renderSettingsPanel = null;
let renderCorePanel = null;

export function setCompanionState(state, caption) {
  const def = PRESENCE_STATES[state] || PRESENCE_STATES.idle;
  const nextKey = PRESENCE_STATES[state] ? state : "idle";
  if (nextKey !== current) {
    prevDef = PRESENCE_STATES[current] || PRESENCE_STATES.idle;
    stateChangedAt = performance.now();
    // squash-and-stretch: a small anticipatory pop on every mood change
    if (!reduceMotion && el?.canvas) {
      el.canvas.classList.remove("pc-pop");
      void el.canvas.offsetWidth;
      el.canvas.classList.add("pc-pop");
    }
  }
  current = nextKey;
  if (!el) return;
  el.dot.className = `pc-dot pc-dot-${def.dot}`;
  el.label.textContent = def.label;
  el.caption.textContent = caption || def.caption;
  el.root.dataset.state = current;
  if (current === "success" || current === "speaking") pulse = Math.max(pulse, 0.7);
  if (current === "warning" || current === "error") pulse = 1;
  clearTimeout(decayTimer);
  if (def.hold) decayTimer = setTimeout(() => setCompanionState(mode === "loop" ? "building" : "idle"), def.hold);
  if (reduceMotion) paintOnce();
}

export function setCompanionMode(next) {
  const nextMode = (next === "loop" || next === "build") ? "loop" : "chat";
  const modeChanged = nextMode !== mode;
  mode = nextMode;
  if (el?.modeChip) {
    const label = el.modeChip.querySelector("[data-pc-mode-state]");
    if (label) label.textContent = mode === "loop" ? "On" : "Off";
    el.modeChip.classList.toggle("is-build", mode === "loop");
    el.modeChip.classList.toggle("is-loop", mode === "loop");
    el.modeChip.setAttribute("aria-pressed", mode === "loop" ? "true" : "false");
  }
  if (el?.root) el.root.dataset.mode = mode;
  if (el?.menuLoop) el.menuLoop.setAttribute("aria-pressed", mode === "loop" ? "true" : "false");
  refreshCompanionCore();
  const targetState = mode === "loop" ? "building" : "idle";
  if (modeChanged || current !== targetState) setCompanionState(targetState);
  if (modeChanged && onModeChange) onModeChange(mode);
}

export const companionMode = () => mode;

export function refreshCompanionCore() {
  if (!el?.core || typeof renderCorePanel !== "function") return;
  el.core.innerHTML = renderCorePanel(mode);
}

function closeSettings() {
  if (!el?.settingsPanel || !el?.settingsBtn) return;
  el.settingsPanel.hidden = true;
  el.settingsBtn.setAttribute("aria-expanded", "false");
}

function toggleSettings() {
  if (!el?.settingsPanel || !el?.settingsBtn) return;
  const nextOpen = el.settingsPanel.hidden;
  el.settingsPanel.hidden = !nextOpen;
  el.settingsBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function requestLoopMode(nextMode) {
  if (nextMode === "loop" && !canUseLoop()) {
    closeSettings();
    if (onLoopUnavailable) onLoopUnavailable();
    return;
  }
  setCompanionMode(nextMode);
}

function paintOnce() {
  if (!ctx2 || !character) return;
  const def = PRESENCE_STATES[current] || PRESENCE_STATES.idle;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, SIZE, SIZE);
  character.draw(ctx2, {
    t: 0.4,
    dt: 0.016,
    cx: SIZE / 2,
    cy: SIZE * 0.58,
    scale: SIZE * 0.31,
    mood: def.mood,
    emotion: def.emotion,
    pulse: 0,
    px: 0,
    py: 0,
    startupOnly: false,
    moodAge: 2,
  });
}

function loop() {
  if (rafOn) return;
  rafOn = true;
  const t0 = performance.now();
  let last = t0;
  const frame = (now) => {
    if (!el?.root.isConnected) {
      rafOn = false;
      return;
    }
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    const t = (now - t0) * 0.001;
    const dt = Math.min(0.05, (now - last) * 0.001);
    last = now;
    pulse = Math.max(0, pulse - dt * 1.2);
    const def = PRESENCE_STATES[current] || PRESENCE_STATES.idle;
    const r = el.canvas.getBoundingClientRect();
    const px = Math.max(-0.5, Math.min(0.5, (pointer.x - (r.left + r.width / 2)) / 520));
    const py = Math.max(-0.5, Math.min(0.5, (pointer.y - (r.top + r.height / 2)) / 520));
    const sinceSwitch = now - stateChangedAt;
    const moodAge = Math.max(0.05, sinceSwitch * 0.001);
    const base = { t, dt, cx: SIZE / 2, cy: SIZE * 0.58, scale: SIZE * 0.31, pulse, px, py, startupOnly: false, moodAge };
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, SIZE, SIZE);
    if (prevDef && sinceSwitch < FADE_MS) {
      // crossfade: the old expression melts into the new one — no vanish frame
      const k = sinceSwitch / FADE_MS;
      const ease = 1 - Math.pow(1 - k, 3);
      ctx2.globalAlpha = 1 - ease;
      character.draw(ctx2, { ...base, mood: prevDef.mood, emotion: prevDef.emotion, moodAge: 2 });
      ctx2.globalAlpha = ease;
      character.draw(ctx2, { ...base, mood: def.mood, emotion: def.emotion });
      ctx2.globalAlpha = 1;
    } else {
      character.draw(ctx2, { ...base, mood: def.mood, emotion: def.emotion });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function mountCompanion(headEl, opts = {}) {
  if (!headEl) return;
  if (headEl.dataset.pcMounted) return;
  headEl.dataset.pcMounted = "1";
  onModeChange = opts.onMode || null;
  canUseLoop = typeof opts.canLoop === "function" ? opts.canLoop : () => true;
  onLoopUnavailable = typeof opts.onLoopUnavailable === "function" ? opts.onLoopUnavailable : null;
  renderSettingsPanel = typeof opts.renderSettings === "function" ? opts.renderSettings : null;
  renderCorePanel = typeof opts.renderCore === "function" ? opts.renderCore : null;

  headEl.innerHTML = `
    <div class="pc" data-pc>
      <canvas class="pc-avatar" data-pc-avatar width="10" height="10" role="img"
        aria-label="Phantom AI chatbot portrait"></canvas>
      <div class="pc-meta">
        <div class="pc-title">
          <b>Phantom Console</b>
          <i class="pc-dot pc-dot-ok" data-pc-dot aria-hidden="true"></i>
          <span class="pc-label" data-pc-label>Brain + hands online</span>
        </div>
        <p class="pc-caption" data-pc-caption aria-live="polite">Phantom AI chat plus Termina hands, approval-gated.</p>
        <div class="pc-core" data-pc-core>
          ${renderCorePanel ? renderCorePanel(mode) : `
            <span><b>Brain</b><i>Phantom Hybrid</i></span>
            <span><b>Hands</b><i>Termina gated</i></span>`}
        </div>
      </div>
      <div class="pc-actions">
        <button class="pc-mode" data-pc-mode type="button" aria-pressed="false" title="Toggle Phantom Loop">
          <span>Loop</span><b data-pc-mode-state>Off</b>
        </button>
        <button class="pc-settings" data-pc-settings type="button" aria-label="Chat settings" title="Chat settings" aria-haspopup="dialog" aria-expanded="false"><span aria-hidden="true">&#9881;</span></button>
        <div class="pc-menu" data-pc-menu hidden>
          <div data-pc-settings-panel></div>
        </div>
      </div>
      <button class="pc-minimize" data-chatbox-toggle type="button" aria-expanded="true" aria-label="Minimize Phantom Console" title="Minimize Phantom Console">
        <span aria-hidden="true">-</span>
      </button>
    </div>`;

  const root = headEl.querySelector("[data-pc]");
  el = {
    root,
    canvas: root.querySelector("[data-pc-avatar]"),
    dot: root.querySelector("[data-pc-dot]"),
    label: root.querySelector("[data-pc-label]"),
    caption: root.querySelector("[data-pc-caption]"),
    core: root.querySelector("[data-pc-core]"),
    modeChip: root.querySelector("[data-pc-mode]"),
    settingsBtn: root.querySelector("[data-pc-settings]"),
    settingsPanel: root.querySelector("[data-pc-menu]"),
    settingsPanelBody: root.querySelector("[data-pc-settings-panel]"),
    menuLoop: root.querySelector("[data-pc-menu-loop]"),
  };
  if (renderSettingsPanel) {
    renderSettingsPanel(el.settingsPanelBody);
  } else {
    el.settingsPanelBody.innerHTML = `
      <b>Phantom settings</b>
      <p>Phantom Loop routes this chat through another model, then brings the answer back.</p>
      <button type="button" data-pc-menu-loop aria-pressed="false">
        <span>Phantom Loop</span>
      </button>`;
    el.menuLoop = root.querySelector("[data-pc-menu-loop]");
  }

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.canvas.width = SIZE * dpr;
  el.canvas.height = SIZE * dpr;
  el.canvas.style.width = `${SIZE}px`;
  el.canvas.style.height = `${SIZE}px`;
  ctx2 = el.canvas.getContext("2d");
  character = createPhantomCharacter({ small: true });

  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  el.modeChip.addEventListener("click", () => requestLoopMode(mode === "loop" ? "chat" : "loop"));
  el.settingsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettings();
  });
  el.menuLoop?.addEventListener("click", () => {
    requestLoopMode(mode === "loop" ? "chat" : "loop");
    closeSettings();
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) closeSettings();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
  });

  setCompanionMode(mode);
  if (reduceMotion) paintOnce();
  else loop();
}
