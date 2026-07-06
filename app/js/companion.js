/* PhantomForce — PhantomPresence: the companion inside the chat.
   Phantom lives IN the chat panel now — a small live portrait in the header
   (real character engine: blinking, eye-tracking, moods) plus a status dot,
   a state caption, and a mode chip. One clean state machine drives it all,
   and the same states are ready for real pose artwork later.
   Contained by design: never covers messages, never blocks the composer,
   shrinks gracefully on mobile, respects prefers-reduced-motion. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260706-17";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- the state system ----------------
   state → label (a11y text next to the dot), caption (what Phantom "feels"),
   dot tone, character mood/emotion, and hold time before decaying to idle. */
export const PRESENCE_STATES = {
  idle:      { label: "Systems online", caption: "Ready when you are.",              dot: "ok",   mood: "idle",      emotion: "calm",   hold: 0 },
  listening: { label: "Listening",      caption: "I'm listening.",                   dot: "ok",   mood: "listening", emotion: "calm",   hold: 2400 },
  thinking:  { label: "Thinking",       caption: "Thinking through the best move…",  dot: "ok",   mood: "thinking",  emotion: "bright", hold: 12000 },
  speaking:  { label: "Responding",     caption: "Here's what I'd do.",              dot: "ok",   mood: "talking",   emotion: "bright", hold: 3200 },
  building:  { label: "Build mode",     caption: "Building the plan…",               dot: "ok",   mood: "thinking",  emotion: "bright", hold: 6000 },
  success:   { label: "Done",           caption: "Done. Ready for approval.",        dot: "ok",   mood: "talking",   emotion: "happy",  hold: 3000 },
  warning:   { label: "Needs approval", caption: "This needs approval first.",       dot: "warn", mood: "talking",   emotion: "alert",  hold: 4200 },
  error:     { label: "Blocked",        caption: "Blocked. Here's what needs fixing.", dot: "err",  mood: "talking",   emotion: "alert",  hold: 4200 },
  paused:    { label: "Paused",         caption: "Paused.",                          dot: "err",  mood: "idle",      emotion: "sad",    hold: 0 },
};

let el = null;            // { dot, label, caption, canvas, modeChip }
let character = null;
let ctx2 = null, dpr = 1, SIZE = 48;
let current = "idle";
let decayTimer = 0;
let rafOn = false;
let pulse = 0;
let pointer = { x: -9999, y: -9999 };
let mode = "chat";        // chat | build
let onModeChange = null;

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
  if (def.hold) decayTimer = setTimeout(() => setCompanionState(mode === "build" ? "building" : "idle"), def.hold);
  if (reduceMotion) paintOnce();
}

export function setCompanionMode(next) {
  mode = next === "build" ? "build" : "chat";
  if (el?.modeChip) {
    el.modeChip.textContent = mode === "build" ? "Build" : "Chat";
    el.modeChip.classList.toggle("is-build", mode === "build");
    el.modeChip.setAttribute("aria-pressed", mode === "build" ? "true" : "false");
  }
  setCompanionState(mode === "build" ? "building" : "idle");
  if (onModeChange) onModeChange(mode);
}
export const companionMode = () => mode;

function paintOnce() {
  if (!ctx2 || !character) return;
  const def = PRESENCE_STATES[current] || PRESENCE_STATES.idle;
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2.clearRect(0, 0, SIZE, SIZE);
  character.draw(ctx2, { t: 0.4, dt: 0.016, cx: SIZE / 2, cy: SIZE * 0.58, scale: SIZE * 0.31, mood: def.mood, emotion: def.emotion, pulse: 0, px: 0, py: 0 });
}

function loop() {
  if (rafOn) return;
  rafOn = true;
  const t0 = performance.now();
  let last = t0;
  const frame = (now) => {
    if (!el?.root.isConnected) { rafOn = false; return; }
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const t = (now - t0) * 0.001;
    const dt = Math.min(0.05, (now - last) * 0.001); last = now;
    pulse = Math.max(0, pulse - dt * 1.2);
    const def = PRESENCE_STATES[current] || PRESENCE_STATES.idle;
    const r = el.canvas.getBoundingClientRect();
    const px = Math.max(-0.5, Math.min(0.5, (pointer.x - (r.left + r.width / 2)) / 520));
    const py = Math.max(-0.5, Math.min(0.5, (pointer.y - (r.top + r.height / 2)) / 520));
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, SIZE, SIZE);
    character.draw(ctx2, { t, dt, cx: SIZE / 2, cy: SIZE * 0.58, scale: SIZE * 0.31, mood: def.mood, emotion: def.emotion, pulse, px, py });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* mountCompanion(headEl, opts) — builds the presence dock inside the chat header.
   opts.onMode(mode) fires when the Chat/Build chip is toggled.
   Double-click the portrait to release the optional flying buddy (easter egg,
   loaded lazily so it costs nothing unless summoned). */
export function mountCompanion(headEl, opts = {}) {
  if (!headEl || headEl.dataset.pcMounted) { if (headEl) refresh(); return; }
  headEl.dataset.pcMounted = "1";
  onModeChange = opts.onMode || null;

  headEl.innerHTML = `
    <div class="pc" data-pc>
      <canvas class="pc-avatar" data-pc-avatar width="10" height="10" role="img"
        aria-label="Phantom — your companion. Double-click to let it fly." title="Phantom (double-click to set it loose)"></canvas>
      <div class="pc-meta">
        <div class="pc-title"><b>Phantom AI</b><i class="pc-dot pc-dot-ok" data-pc-dot aria-hidden="true"></i><span class="pc-label" data-pc-label>Systems online</span></div>
        <p class="pc-caption" data-pc-caption aria-live="polite">Ready when you are.</p>
      </div>
      <button class="pc-mode" data-pc-mode type="button" aria-pressed="false" title="Toggle Build mode">Chat</button>
    </div>`;

  const root = headEl.querySelector("[data-pc]");
  el = {
    root,
    canvas: root.querySelector("[data-pc-avatar]"),
    dot: root.querySelector("[data-pc-dot]"),
    label: root.querySelector("[data-pc-label]"),
    caption: root.querySelector("[data-pc-caption]"),
    modeChip: root.querySelector("[data-pc-mode]"),
  };

  dpr = Math.min(window.devicePixelRatio || 1, 2);
  el.canvas.width = SIZE * dpr; el.canvas.height = SIZE * dpr;
  el.canvas.style.width = SIZE + "px"; el.canvas.style.height = SIZE + "px";
  ctx2 = el.canvas.getContext("2d");
  character = createPhantomCharacter({ small: true });

  window.addEventListener("pointermove", (e) => { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  el.modeChip.addEventListener("click", () => setCompanionMode(mode === "build" ? "chat" : "build"));
  el.canvas.addEventListener("dblclick", async () => {
    try { const m = await import("./buddy.js?v=phantom-live-20260706-17"); m.mountBuddy(); setCompanionState("success", "Set loose. Double-click it to dock."); } catch {}
  });

  setCompanionState("idle");
  if (reduceMotion) paintOnce(); else loop();
}

function refresh() {
  // header re-rendered by shell restore: re-bind onto fresh nodes
  const head = document.querySelector("[data-chatbox] .chatbox-head");
  if (head && !head.dataset.pcMounted) { el = null; mountCompanion(head); }
}
