/* Reusable live Phantom canvas for dashboard and PhantomBot surfaces. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260820-186";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const mounted = new WeakMap();

const LOOKS = {
  idle: { mood: "idle", emotion: "happy" },
  online: { mood: "idle", emotion: "happy" },
  listening: { mood: "listening", emotion: "calm" },
  thinking: { mood: "thinking", emotion: "bright" },
  speaking: { mood: "talking", emotion: "bright" },
  building: { mood: "thinking", emotion: "bright" },
  looping: { mood: "thinking", emotion: "bright" },
  success: { mood: "talking", emotion: "happy" },
  warning: { mood: "talking", emotion: "alert" },
  error: { mood: "talking", emotion: "alert" },
  paused: { mood: "idle", emotion: "sad" },
};

/* Full-body gestures are deliberately state-driven and deterministic. The
   presence can therefore feel alive without turning into a random mascot:
   idle welcomes and presents, listening points, thinking considers, and
   speaking delivers. The character engine cross-fades the painted poses. */
const GESTURE_SEQUENCES = {
  idle: [
    { pose: "welcome", duration: 4.8 },
    { pose: "present", duration: 4.2 },
    { pose: "point", duration: 3.2 },
    { pose: "laugh", duration: 3.4 },
  ],
  online: [
    { pose: "welcome", duration: 5.2 },
    { pose: "present", duration: 4.4 },
    { pose: "point", duration: 3.4 },
  ],
  listening: [
    { pose: "point", duration: 3.2 },
    { pose: "welcome", duration: 3.8 },
  ],
  thinking: [
    { pose: "scheme", duration: 4.2 },
    { pose: "chin", duration: 3.4 },
  ],
  speaking: [
    { pose: "assert", duration: 3.1 },
    { pose: "present", duration: 3.5 },
    { pose: "point", duration: 2.8 },
  ],
  building: [
    { pose: "scheme", duration: 3.8 },
    { pose: "chin", duration: 3.2 },
    { pose: "assert", duration: 2.8 },
  ],
  looping: [
    { pose: "scheme", duration: 3.6 },
    { pose: "chin", duration: 3.1 },
    { pose: "present", duration: 3.2 },
  ],
  success: [
    { pose: "laugh", duration: 3.8 },
    { pose: "assert", duration: 3.2 },
  ],
  warning: [
    { pose: "cross", duration: 3.6 },
    { pose: "assert", duration: 3.0 },
  ],
  error: [
    { pose: "cross", duration: 3.8 },
    { pose: "sheepish", duration: 3.2 },
  ],
  paused: [
    { pose: "coy", duration: 3.8 },
    { pose: "sheepish", duration: 3.8 },
  ],
};

function gestureForState(state, elapsed) {
  const sequence = GESTURE_SEQUENCES[state] || GESTURE_SEQUENCES.idle;
  const total = sequence.reduce((sum, gesture) => sum + gesture.duration, 0);
  let cursor = total ? elapsed % total : 0;
  for (const gesture of sequence) {
    if (cursor < gesture.duration) return gesture.pose;
    cursor -= gesture.duration;
  }
  return sequence[0]?.pose || "welcome";
}

export function mountPhantomPresence(canvas, options = {}) {
  if (!canvas) return null;
  if (mounted.has(canvas)) return mounted.get(canvas);

  const context = canvas.getContext("2d");
  if (!context) return null;

  const character = createPhantomCharacter({
    small: options.small !== false,
    preload: ["welcome", "present", "point", "laugh", "chin", "scheme", "assert", "cross", "sheepish", "coy"],
    settled: true,
  });
  let state = LOOKS[options.state] ? options.state : "idle";
  let look = LOOKS[state];
  let pulse = 0.35;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let pointerX = 0;
  let pointerY = 0;
  let easedX = 0;
  let easedY = 0;
  let stopped = false;
  let frameId = 0;
  let last = performance.now();
  const started = last;
  let stateStarted = last;

  const resize = () => {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  };

  const onPointerMove = (event) => {
    const box = canvas.getBoundingClientRect();
    pointerX = Math.max(-0.5, Math.min(0.5, (event.clientX - box.left) / Math.max(1, box.width) - 0.5));
    pointerY = Math.max(-0.5, Math.min(0.5, (event.clientY - box.top) / Math.max(1, box.height) - 0.5));
  };

  const paint = (now) => {
    if (stopped || !canvas.isConnected) {
      api.destroy();
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (now - last) * 0.001));
    last = now;
    easedX += (pointerX - easedX) * 0.08;
    easedY += (pointerY - easedY) * 0.08;
    pulse = Math.max(0, pulse - dt * 0.7);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const rendered = character.draw(context, {
      t: (now - started) * 0.001,
      dt,
      cx: width / 2,
      cy: height * (options.compact ? 0.55 : 0.53),
      scale: Math.min(width, height) * (options.compact ? 0.34 : 0.31),
      pose: gestureForState(state, Math.max(0, (now - stateStarted) * 0.001)),
      mood: look.mood,
      emotion: look.emotion,
      pulse,
      px: easedX,
      py: easedY,
      startupOnly: false,
      moodAge: Math.max(0.1, (now - started) * 0.001),
    });
    canvas.dataset.phantomGesture = rendered?.pose || rendered?.want || "welcome";
    if (!reduceMotion) frameId = requestAnimationFrame(paint);
  };

  const onState = (event) => api.setState(event.detail?.state);
  const observer = new ResizeObserver(() => {
    resize();
    if (reduceMotion) paint(performance.now());
  });

  const api = {
    setState(next) {
      const nextState = LOOKS[next] ? next : "idle";
      if (nextState !== state) stateStarted = performance.now();
      state = nextState;
      look = LOOKS[state];
      pulse = state === "warning" || state === "error" ? 1 : 0.65;
      canvas.dataset.phantomState = state;
      canvas.closest("[data-phantombot-presence]")?.setAttribute("data-phantom-state", state);
      if (reduceMotion) paint(performance.now());
    },
    destroy() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("phantom:presence-state", onState);
      mounted.delete(canvas);
    },
  };

  mounted.set(canvas, api);
  resize();
  observer.observe(canvas);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("phantom:presence-state", onState);
  api.setState(options.state || "idle");
  paint(performance.now());
  if (reduceMotion) {
    setTimeout(() => !stopped && paint(performance.now()), 350);
    setTimeout(() => !stopped && paint(performance.now()), 1400);
  }
  return api;
}
