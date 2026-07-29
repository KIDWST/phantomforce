/* Reusable live Phantom canvas for dashboard and PhantomBot surfaces. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260729-98";

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

export function mountPhantomPresence(canvas, options = {}) {
  if (!canvas) return null;
  if (mounted.has(canvas)) return mounted.get(canvas);

  const context = canvas.getContext("2d");
  if (!context) return null;

  const character = createPhantomCharacter({
    small: options.small !== false,
    preload: ["welcome", "present", "chin", "scheme", "assert", "coy"],
    settled: true,
  });
  let look = LOOKS[options.state] || LOOKS.idle;
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
    character.draw(context, {
      t: (now - started) * 0.001,
      dt,
      cx: width / 2,
      cy: height * (options.compact ? 0.55 : 0.53),
      scale: Math.min(width, height) * (options.compact ? 0.34 : 0.31),
      mood: look.mood,
      emotion: look.emotion,
      pulse,
      px: easedX,
      py: easedY,
      startupOnly: false,
      moodAge: Math.max(0.1, (now - started) * 0.001),
    });
    if (!reduceMotion) frameId = requestAnimationFrame(paint);
  };

  const onState = (event) => api.setState(event.detail?.state);
  const observer = new ResizeObserver(() => {
    resize();
    if (reduceMotion) paint(performance.now());
  });

  const api = {
    setState(state) {
      look = LOOKS[state] || LOOKS.idle;
      pulse = state === "warning" || state === "error" ? 1 : 0.65;
      canvas.dataset.phantomState = LOOKS[state] ? state : "idle";
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
