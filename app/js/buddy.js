/* PhantomForce — the phantom buddy.
   The living phantom, freed from the hero: a small animated companion that
   flies around the screen, follows the conversation, and can be grabbed,
   tossed, clicked for a quip, or docked. Draws the real 2D character
   (character.js) so it keeps every mood, emotion, and eye-tracking behaviour.
   Self-contained: owns its physics loop, drag handling, and speech bubble.
   Reduced motion: sits calmly in the corner, still clickable. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260707-58";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DOCK_KEY = "pf.buddy.docked.v1";

const QUIPS = [
  "I run the boring half. You take the glory.",
  "Every desk is watching. Nothing slips.",
  "Say the word and it becomes work.",
  "I never sleep. It's a whole thing.",
  "Approvals first. Chaos never.",
  "Your calendar fears me.",
  "Caught three threats before breakfast.",
  "Drag me somewhere nicer.",
];

let mounted = false;
let reactFn = null;

/* main.js calls this from speak() so the buddy follows the conversation */
export function buddyReact(kind, ms = 1600) {
  if (reactFn) reactFn(kind, ms);
}

export function mountBuddy() {
  if (mounted || document.querySelector("[data-buddy]")) return;
  mounted = true;

  const layer = document.createElement("div");
  layer.className = "buddy";
  layer.setAttribute("data-buddy", "");
  layer.innerHTML = `
    <div class="buddy-say" data-buddy-say hidden></div>
    <canvas class="buddy-canvas" data-buddy-canvas width="10" height="10" aria-label="Phantom — your companion. Drag to move, click to talk, double-click to dock." role="img"></canvas>`;
  document.body.appendChild(layer);

  const canvas = layer.querySelector("[data-buddy-canvas]");
  const sayEl = layer.querySelector("[data-buddy-say]");
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) { layer.remove(); return; }

  const small = window.matchMedia("(max-width: 720px)").matches;
  const SIZE = small ? 104 : 138;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
  canvas.style.width = SIZE + "px"; canvas.style.height = SIZE + "px";

  const character = createPhantomCharacter({ small: true });

  /* ---------------- state ---------------- */
  let docked = false;
  try { docked = localStorage.getItem(DOCK_KEY) === "1"; } catch {}
  const vw = () => innerWidth, vh = () => innerHeight;
  const dockPoint = () => ({ x: vw() - SIZE * 0.72, y: vh() - SIZE * 0.8 });

  // position = center of the buddy
  let x = vw() - SIZE, y = vh() * 0.32, vx = 0, vy = 0;
  let tx = x, ty = y;                       // wander target
  let nextWanderAt = 0;
  let mood = "idle", emotion = "calm", moodUntil = 0;
  let pulse = 0, menace = 0;
  let dragging = false, dragged = false, grabDX = 0, grabDY = 0;
  let lastPointer = { x: -9999, y: -9999 };
  let sayTimer = 0;

  const setMood = (m, e, ms = 1600) => { mood = m; emotion = e; moodUntil = performance.now() + ms; };

  reactFn = (kind, ms) => {
    if (kind === "listening") setMood("listening", "calm", ms);
    else if (kind === "thinking") setMood("thinking", "bright", ms);
    else if (kind === "talking") { setMood("talking", "bright", ms); pulse = Math.max(pulse, 0.6); }
    else if (kind === "alert") { setMood("talking", "alert", ms); pulse = 1; }
    else if (kind === "happy") { setMood("talking", "happy", ms); pulse = Math.max(pulse, 0.8); }
  };

  const say = (text, ms = 2600) => {
    clearTimeout(sayTimer);
    sayEl.textContent = text;
    sayEl.hidden = false;
    sayEl.classList.remove("pop"); void sayEl.offsetWidth; sayEl.classList.add("pop");
    sayTimer = setTimeout(() => { sayEl.hidden = true; }, ms);
  };

  const clampToScreen = () => {
    const m = SIZE * 0.42;
    x = Math.max(m, Math.min(vw() - m, x));
    y = Math.max(m + 46, Math.min(vh() - m, y));
  };

  const pickWanderTarget = (now) => {
    if (docked) { const d = dockPoint(); tx = d.x; ty = d.y; return; }
    // favour the airspace: edges and upper half, away from dead-center reading zone
    const zones = [
      () => [vw() * (0.62 + Math.random() * 0.33), vh() * (0.14 + Math.random() * 0.5)],
      () => [vw() * (0.06 + Math.random() * 0.2), vh() * (0.5 + Math.random() * 0.4)],
      () => [vw() * (0.3 + Math.random() * 0.5), vh() * (0.08 + Math.random() * 0.18)],
      () => [vw() * (0.55 + Math.random() * 0.4), vh() * (0.62 + Math.random() * 0.3)],
    ];
    [tx, ty] = zones[Math.floor(Math.random() * zones.length)]();
    nextWanderAt = now + 3800 + Math.random() * 5200;
  };

  /* ---------------- interactions ---------------- */
  window.addEventListener("pointermove", (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; dragged = false;
    grabDX = e.clientX - x; grabDY = e.clientY - y;
    canvas.setPointerCapture(e.pointerId);
    layer.classList.add("is-grabbed");
    setMood("listening", "bright", 9999);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const nx = e.clientX - grabDX, ny = e.clientY - grabDY;
    vx = (nx - x) * 0.9; vy = (ny - y) * 0.9;   // throw velocity from drag speed
    if (Math.hypot(nx - x, ny - y) > 2.5) dragged = true;
    x = nx; y = ny; clampToScreen();
  });
  const release = (e) => {
    if (!dragging) return;
    dragging = false;
    layer.classList.remove("is-grabbed");
    moodUntil = 0;
    if (dragged) {
      // tossed: keep the throw momentum, then wander from wherever it lands
      tx = x + vx * 14; ty = y + vy * 14;
      nextWanderAt = performance.now() + 2600;
      if (Math.hypot(vx, vy) > 9) { pulse = 1; say("Wheee—", 1200); }
    } else {
      // a click, not a drag: menace flash + a quip
      menace = 1.1; pulse = 1;
      say(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
    }
    if (e?.pointerId != null) { try { canvas.releasePointerCapture(e.pointerId); } catch {} }
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener("dblclick", () => {
    docked = !docked;
    try { localStorage.setItem(DOCK_KEY, docked ? "1" : "0"); } catch {}
    say(docked ? "Docking. Holler if you need me." : "Back on patrol.");
    pickWanderTarget(performance.now());
  });

  window.addEventListener("resize", () => { clampToScreen(); if (docked) pickWanderTarget(performance.now()); }, { passive: true });

  /* ---------------- flight + render loop ---------------- */
  if (reduceMotion) {
    const d = dockPoint(); x = d.x; y = d.y;
    layer.style.transform = `translate(${x - SIZE / 2}px, ${y - SIZE / 2}px)`;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    character.draw(ctx2, { t: 0.5, dt: 0.016, cx: SIZE / 2, cy: SIZE * 0.56, scale: SIZE * 0.3, mood: "idle", emotion: "calm", pulse: 0, px: 0, py: 0 });
    return;
  }

  const t0 = performance.now();
  let last = t0;
  pickWanderTarget(t0);

  const frame = (now) => {
    if (!layer.isConnected) return;
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const t = (now - t0) * 0.001;
    const dt = Math.min(0.05, (now - last) * 0.001); last = now;

    pulse = Math.max(0, pulse - dt * 1.3);
    menace = Math.max(0, menace - dt);
    if (moodUntil && now > moodUntil) { mood = "idle"; emotion = "calm"; moodUntil = 0; }

    if (!dragging) {
      if (now > nextWanderAt) pickWanderTarget(now);
      // spring toward target + gentle bob = flying
      const k = docked ? 0.045 : 0.018;
      vx += (tx - x) * k * dt * 60;
      vy += (ty - y) * k * dt * 60;
      vx *= 0.94; vy *= 0.94;
      x += vx; y += vy + Math.sin(t * 1.7) * 0.35;
      clampToScreen();
    }

    // bank into turns like it's actually flying
    const tilt = Math.max(-14, Math.min(14, vx * 1.6));
    layer.style.transform = `translate(${(x - SIZE / 2).toFixed(1)}px, ${(y - SIZE / 2).toFixed(1)}px) rotate(${tilt.toFixed(1)}deg)`;

    // eyes follow the cursor relative to the buddy
    const px = Math.max(-0.5, Math.min(0.5, (lastPointer.x - x) / 640));
    const py = Math.max(-0.5, Math.min(0.5, (lastPointer.y - y) / 640));

    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, SIZE, SIZE);
    character.draw(ctx2, {
      t, dt,
      cx: SIZE / 2, cy: SIZE * 0.56, scale: SIZE * 0.3,
      mood: menace > 0 ? "menace" : mood,
      emotion: menace > 0 ? "alert" : emotion,
      pulse: pulse + (menace > 0 ? 0.4 * menace : 0),
      px, py,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // a friendly hello once it wakes
  setTimeout(() => { say("I'm out here now. Grab me, click me, or just talk."); pulse = 0.8; }, 2200);
}
