/* PhantomForce — PhantomPresence: the companion inside the chat.
   Phantom lives in the chat header as a contained presence, not a floating toy.
   It uses the real character engine for blinking, eye tracking, and moods,
   respects reduced motion, and keeps every status dot paired with text. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260706-32";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CHAT_SETTINGS_KEY = "pf.chat.settings.v1";
const DEFAULT_CHAT_SETTINGS = { model: "private-api", speed: "balanced", detail: "direct" };
const CHAT_SETTING_OPTIONS = {
  model: [
    ["private-api", "Private API lane"],
    ["fast-local", "Fast local"],
    ["deep-review", "Deep review"],
  ],
  speed: [
    ["fast", "Fast"],
    ["balanced", "Balanced"],
    ["careful", "Careful"],
  ],
  detail: [
    ["direct", "Direct"],
    ["full", "More detail"],
    ["sales", "Sales-ready"],
  ],
};

export const PRESENCE_STATES = {
  idle: { label: "Systems online", caption: "Ready when you are.", dot: "ok", mood: "idle", emotion: "calm", hold: 0 },
  listening: { label: "Listening", caption: "I'm listening.", dot: "ok", mood: "listening", emotion: "calm", hold: 2400 },
  thinking: { label: "Thinking", caption: "Thinking through the best move...", dot: "ok", mood: "thinking", emotion: "bright", hold: 12000 },
  speaking: { label: "Responding", caption: "Here's what I'd do.", dot: "ok", mood: "talking", emotion: "bright", hold: 3200 },
  building: { label: "Working", caption: "Preparing the next step...", dot: "ok", mood: "thinking", emotion: "bright", hold: 6000 },
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
let decayTimer = 0;
let rafOn = false;
let pulse = 0;
let pointer = { x: -9999, y: -9999 };
let settingsOpen = false;
let chatSettings = loadChatSettings();
let onSettingsChange = null;

function loadChatSettings() {
  try {
    return { ...DEFAULT_CHAT_SETTINGS, ...(JSON.parse(localStorage.getItem(CHAT_SETTINGS_KEY) || "null") || {}) };
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

function saveChatSettings() {
  try { localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(chatSettings)); } catch {}
}

function settingLabel(kind, value) {
  return (CHAT_SETTING_OPTIONS[kind] || []).find(([id]) => id === value)?.[1] || value;
}

function renderSettingSelect(kind, label) {
  const options = CHAT_SETTING_OPTIONS[kind] || [];
  return `
    <label class="pc-setting-field">
      <span>${label}</span>
      <select data-pc-setting="${kind}">
        ${options.map(([value, text]) => `<option value="${value}" ${chatSettings[kind] === value ? "selected" : ""}>${text}</option>`).join("")}
      </select>
    </label>`;
}

function renderSettingsPanel() {
  if (!el?.settingsPanel) return;
  el.settingsPanel.innerHTML = `
    ${renderSettingSelect("model", "Model")}
    ${renderSettingSelect("speed", "Speed")}
    ${renderSettingSelect("detail", "Style")}
    <p>Provider details stay behind Phantom. Nothing sends without approval.</p>`;
  el.settingsPanel.querySelectorAll("[data-pc-setting]").forEach((select) => {
    select.addEventListener("change", () => {
      chatSettings = { ...chatSettings, [select.dataset.pcSetting]: select.value };
      saveChatSettings();
      updateSettingsSummary();
      if (onSettingsChange) onSettingsChange(getChatSettings());
    });
  });
}

function updateSettingsSummary() {
  if (!el?.settingsSummary) return;
  el.settingsSummary.textContent = `${settingLabel("model", chatSettings.model)} · ${settingLabel("speed", chatSettings.speed)}`;
}

function setSettingsOpen(open) {
  settingsOpen = !!open;
  if (!el?.settingsPanel || !el?.settingsButton) return;
  el.settingsPanel.hidden = !settingsOpen;
  el.settingsButton.setAttribute("aria-expanded", String(settingsOpen));
}

export function getChatSettings() {
  return { ...chatSettings };
}

export function setCompanionState(state, caption) {
  const def = PRESENCE_STATES[state] || PRESENCE_STATES.idle;
  current = PRESENCE_STATES[state] ? state : "idle";
  if (!el) return;
  el.dot.className = `pc-dot pc-dot-${def.dot}`;
  el.label.textContent = def.label;
  el.caption.textContent = caption || def.caption;
  el.root.dataset.state = current;
  if (current === "success" || current === "speaking") pulse = Math.max(pulse, 0.7);
  if (current === "warning" || current === "error") pulse = 1;
  clearTimeout(decayTimer);
  if (def.hold) decayTimer = setTimeout(() => setCompanionState("idle"), def.hold);
  if (reduceMotion) paintOnce();
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
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, SIZE, SIZE);
    character.draw(ctx2, {
      t,
      dt,
      cx: SIZE / 2,
      cy: SIZE * 0.58,
      scale: SIZE * 0.31,
      mood: def.mood,
      emotion: def.emotion,
      pulse,
      px,
      py,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function mountCompanion(headEl, opts = {}) {
  if (!headEl) return;
  if (headEl.dataset.pcMounted) return;
  headEl.dataset.pcMounted = "1";
  onSettingsChange = opts.onSettings || null;

  headEl.innerHTML = `
    <div class="pc" data-pc>
      <canvas class="pc-avatar" data-pc-avatar width="10" height="10" role="img"
        aria-label="Phantom AI companion portrait"></canvas>
      <div class="pc-meta">
        <div class="pc-title">
          <b>Phantom AI</b>
          <i class="pc-dot pc-dot-ok" data-pc-dot aria-hidden="true"></i>
          <span class="pc-label" data-pc-label>Systems online</span>
        </div>
        <p class="pc-caption" data-pc-caption aria-live="polite">Ready when you are.</p>
      </div>
      <span class="pc-chat-pill" aria-label="Chat lane">Chat</span>
      <div class="pc-settings-wrap">
        <button class="pc-settings-btn" data-pc-settings type="button" aria-label="Chat settings" aria-expanded="false" title="Chat settings">
          <span aria-hidden="true">⚙</span>
        </button>
        <div class="pc-settings-panel" data-pc-settings-panel hidden></div>
      </div>
      <span class="pc-settings-summary" data-pc-settings-summary></span>
    </div>`;

  const root = headEl.querySelector("[data-pc]");
  el = {
    root,
    canvas: root.querySelector("[data-pc-avatar]"),
    dot: root.querySelector("[data-pc-dot]"),
    label: root.querySelector("[data-pc-label]"),
    caption: root.querySelector("[data-pc-caption]"),
    settingsButton: root.querySelector("[data-pc-settings]"),
    settingsPanel: root.querySelector("[data-pc-settings-panel]"),
    settingsSummary: root.querySelector("[data-pc-settings-summary]"),
  };

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.canvas.width = SIZE * dpr;
  el.canvas.height = SIZE * dpr;
  el.canvas.style.width = `${SIZE}px`;
  el.canvas.style.height = `${SIZE}px`;
  ctx2 = el.canvas.getContext("2d");
  character = createPhantomCharacter({ small: true });

  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  el.settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setSettingsOpen(!settingsOpen);
  });
  el.settingsPanel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => setSettingsOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setSettingsOpen(false);
  });

  renderSettingsPanel();
  updateSettingsSummary();
  setCompanionState("idle");
  if (onSettingsChange) onSettingsChange(getChatSettings());
  if (reduceMotion) paintOnce();
  else loop();
}
