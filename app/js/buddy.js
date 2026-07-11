/* PhantomForce companion.
   One sidebar-docked Phantom system: preference-aware, drag-safe, always
   returns home, and tied to real chat/notification states. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260711-189";
import {
  COMPANION_EVENT,
  clearCompanionSessionHide,
  hideCompanionForSession,
  isCompanionHiddenForSession,
  loadCompanionPrefs,
  updateCompanionPrefs,
} from "./companion-preferences.js?v=phantom-live-20260711-189";

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const LEGACY_DOCK_KEY = "pf.buddy.docked.v1";
const GREETED_SESSION_KEY = "pf.companion.greeted.session.v1";
const LAST_GREETING_KEY = "pf.companion.lastGreeting.v1";

const GREETINGS = {
  professional: ["Ready when you are.", "Your Phantom is standing by.", "Systems are ready.", "Good timing. We have work to do."],
  friendly: ["Human!", "You're back!", "There you are.", "Welcome back, boss.", "Ready when you are.", "I was waiting for you."],
  playful: ["Human!", "I missed you.", "There you are.", "The workforce is ready.", "Welcome back, boss.", "Everything feels better when you're here."],
  quiet: ["Ready.", "Standing by.", "Online."],
};

const QUIPS = {
  professional: ["Standing by.", "Docked and watching.", "Approval gates stay on.", "Nothing external moves without you."],
  friendly: ["I'm here.", "Tell me where to look.", "I can stay docked.", "Your Phantom is nearby."],
  playful: ["I fit better over here.", "Small Phantom, serious job.", "I promise not to hover over the buttons.", "Dock me if I get dramatic."],
  quiet: ["Here.", "Ready.", "Docked."],
};

const STATE_LOOK = {
  docked: { mood: "idle", emotion: "calm", pulse: 0 },
  waking: { mood: "happy", emotion: "happy", pulse: 0.55 },
  greeting: { mood: "talking", emotion: "happy", pulse: 0.75 },
  idle: { mood: "idle", emotion: "calm", pulse: 0 },
  listening: { mood: "listening", emotion: "calm", pulse: 0.18 },
  thinking: { mood: "thinking", emotion: "bright", pulse: 0.28 },
  working: { mood: "thinking", emotion: "bright", pulse: 0.38 },
  notifying: { mood: "talking", emotion: "alert", pulse: 0.78 },
  celebrating: { mood: "talking", emotion: "happy", pulse: 0.9 },
  curious: { mood: "listening", emotion: "bright", pulse: 0.24 },
  playful: { mood: "happy", emotion: "excited", pulse: 0.65 },
  concerned: { mood: "menace", emotion: "alert", pulse: 0.62 },
  dragged: { mood: "listening", emotion: "bright", pulse: 0.18 },
  sleeping: { mood: "idle", emotion: "sad", pulse: 0 },
};

let mounted = false;
let controller = null;

export function buddyReact(kind, ms = 1600) {
  controller?.react(kind, ms);
}

export function mountBuddy() {
  if (mounted) return;
  mounted = true;
  controller = createBuddyController();
  controller.applyPreferences(loadCompanionPrefs());
  window.addEventListener(COMPANION_EVENT, (event) => controller?.applyPreferences(event.detail || loadCompanionPrefs()));
}

function createBuddyController() {
  let prefs = loadCompanionPrefs();
  let layer = null;
  let canvas = null;
  let sayEl = null;
  let menu = null;
  let ctx2 = null;
  let character = null;
  let eventAbort = null;
  let running = false;
  let loopToken = 0;
  let size = 120;
  let dpr = 1;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let tx = 0;
  let ty = 0;
  let docked = true;
  let dragging = false;
  let dragged = false;
  let grabDX = 0;
  let grabDY = 0;
  let state = "docked";
  let stateUntil = 0;
  let pulse = 0;
  let lastPointer = { x: -9999, y: -9999 };
  let sayTimer = 0;
  let nextIdleAt = 0;
  let nextWanderAt = 0;
  let lastPaintAt = 0;

  function mobile() { return window.matchMedia("(max-width: 720px)").matches; }
  function reduceMotion() { return reduceMotionQuery.matches || prefs.motionLevel === "reduced" || prefs.motionLevel === "none"; }
  function motionAllowed() { return !reduceMotion() && prefs.motionLevel !== "none"; }
  function roamingAllowed() { return false; }

  function sidebarRect() {
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    if (sidebar && sidebar.width > 120) return sidebar;
    return { left: 0, width: window.innerWidth > 900 ? 212 : 0 };
  }

  function safeInsets() {
    const hasSidebar = window.innerWidth > 900;
    const inSidebarDock = hasSidebar && prefs.dockLocation === "sidebar";
    return {
      left: inSidebarDock ? 10 : hasSidebar ? 236 : 14,
      right: 18,
      top: hasSidebar ? 88 : 72,
      bottom: mobile() ? 98 : 24,
    };
  }

  function sizeForPrefs() {
    const map = {
      compact: mobile() ? 76 : 96,
      standard: mobile() ? 88 : 118,
      large: mobile() ? 104 : 146,
    };
    return map[prefs.size] || map.standard;
  }

  function dockPoint() {
    const inset = safeInsets();
    const half = size / 2;
    const dock = mobile() && prefs.dockLocation === "sidebar" ? "bottom-right" : prefs.dockLocation;
    if (dock === "bottom-left") return { x: inset.left + half, y: window.innerHeight - inset.bottom - half };
    if (dock === "sidebar") {
      const side = sidebarRect();
      const sideCenter = side.left + side.width / 2;
      return {
        x: Math.max(half + 10, Math.min(side.left + side.width - half - 10, sideCenter)),
        y: window.innerHeight - inset.bottom - half,
      };
    }
    return { x: window.innerWidth - inset.right - half, y: window.innerHeight - inset.bottom - half };
  }

  function clampToSafeZone() {
    const inset = safeInsets();
    const half = size / 2;
    x = Math.max(inset.left + half, Math.min(window.innerWidth - inset.right - half, x));
    y = Math.max(inset.top + half, Math.min(window.innerHeight - inset.bottom - half, y));
  }

  function setTargetToDock() {
    const dock = dockPoint();
    tx = dock.x;
    ty = dock.y;
  }

  function configureCanvas() {
    if (!canvas) return;
    size = sizeForPrefs();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    layer.style.setProperty("--buddy-size", `${size}px`);
    setTargetToDock();
    if (!x || !y || docked) {
      x = tx;
      y = ty;
    }
    clampToSafeZone();
  }

  function createLayer() {
    if (layer) return;
    layer = document.createElement("div");
    layer.className = "buddy is-docked";
    layer.setAttribute("data-buddy", "");
    layer.innerHTML = `
      <div class="buddy-say" data-buddy-say hidden></div>
      <canvas class="buddy-canvas" data-buddy-canvas width="10" height="10" aria-label="Phantom companion. Drag to move, double-click to dock, right-click for controls." role="img" tabindex="0"></canvas>
      <div class="buddy-menu" data-buddy-menu hidden role="menu" aria-label="Phantom companion controls">
        <b>Phantom</b>
        <button type="button" data-buddy-action="ask" role="menuitem">Ask Phantom</button>
        <button type="button" data-buddy-action="notifications" role="menuitem">Show notifications</button>
        <button type="button" data-buddy-action="approvals" role="menuitem">Show approvals</button>
        <hr />
        <button type="button" data-buddy-action="dock" role="menuitem">Return to sidebar</button>
        <button type="button" data-buddy-action="quiet" role="menuitem">Quiet mode</button>
        <button type="button" data-buddy-action="hide" role="menuitem">Hide for this session</button>
        <button type="button" data-buddy-action="disable" role="menuitem">Disable companion</button>
        <hr />
        <label>Size <select data-buddy-pref="size">
          <option value="compact">Compact</option>
          <option value="standard">Standard</option>
          <option value="large">Large</option>
        </select></label>
        <label>Motion <select data-buddy-pref="motionLevel">
          <option value="full">Full</option>
          <option value="subtle">Subtle</option>
          <option value="reduced">Reduced</option>
          <option value="none">None</option>
        </select></label>
        <label>Dock <select data-buddy-pref="dockLocation">
          <option value="sidebar">Sidebar</option>
        </select></label>
        <label>Personality <select data-buddy-pref="personality">
          <option value="professional">Professional</option>
          <option value="friendly">Friendly</option>
          <option value="playful">Playful</option>
          <option value="quiet">Quiet</option>
        </select></label>
      </div>`;
    document.body.appendChild(layer);

    canvas = layer.querySelector("[data-buddy-canvas]");
    sayEl = layer.querySelector("[data-buddy-say]");
    menu = layer.querySelector("[data-buddy-menu]");
    ctx2 = canvas.getContext("2d");
    character = createPhantomCharacter({ small: true });
    bindEvents();
    configureCanvas();
  }

  function removeLayer() {
    clearTimeout(sayTimer);
    running = false;
    loopToken += 1;
    if (eventAbort) {
      eventAbort.abort();
      eventAbort = null;
    }
    if (layer) layer.remove();
    layer = canvas = sayEl = menu = ctx2 = character = null;
  }

  function syncMenuControls() {
    if (!menu) return;
    menu.querySelectorAll("[data-buddy-pref]").forEach((field) => {
      field.value = prefs[field.dataset.buddyPref] || field.value;
    });
  }

  function applyPreferenceClasses() {
    if (!layer) return;
    layer.classList.toggle("is-docked", docked);
    layer.classList.toggle("is-roaming", false);
    layer.dataset.motion = prefs.motionLevel;
    layer.dataset.personality = prefs.personality;
    layer.dataset.dock = prefs.dockLocation;
  }

  function applyPreferences(nextPrefs) {
    prefs = nextPrefs || loadCompanionPrefs();
    if (!prefs.enabled || !prefs.visible || isCompanionHiddenForSession()) {
      removeLayer();
      return;
    }
    createLayer();
    configureCanvas();
    syncMenuControls();
    dock();
    applyPreferenceClasses();
    startLoop();
    maybeGreet();
  }

  function canGreetNow() {
    if (!prefs.greetingEnabled || prefs.greetingFrequency === "off" || reduceMotion()) return false;
    try {
      if (prefs.greetingFrequency === "session" && sessionStorage.getItem(GREETED_SESSION_KEY) === "1") return false;
      if (prefs.greetingFrequency === "daily") {
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem(GREETED_SESSION_KEY) === today) return false;
      }
    } catch {}
    return true;
  }

  function markGreeted() {
    try {
      sessionStorage.setItem(GREETED_SESSION_KEY, "1");
      localStorage.setItem(GREETED_SESSION_KEY, new Date().toISOString().slice(0, 10));
    } catch {}
  }

  function greetingText() {
    const pool = GREETINGS[prefs.personality] || GREETINGS.friendly;
    let last = "";
    try { last = localStorage.getItem(LAST_GREETING_KEY) || ""; } catch {}
    const options = pool.filter((item) => item !== last);
    const next = (options.length ? options : pool)[Math.floor(Math.random() * (options.length ? options.length : pool.length))];
    try { localStorage.setItem(LAST_GREETING_KEY, next); } catch {}
    return next;
  }

  function maybeGreet() {
    if (!layer || !canGreetNow()) return;
    markGreeted();
    setTimeout(() => {
      if (!layer || document.body.classList.contains("overlay-open")) return;
      setState("greeting", 2400);
      say(greetingText(), 2600);
    }, 900);
  }

  function say(text, ms = 2400) {
    if (!sayEl || !prefs.speechEnabled) return;
    clearTimeout(sayTimer);
    sayEl.textContent = String(text || "").slice(0, 96);
    sayEl.hidden = false;
    sayEl.classList.remove("pop");
    void sayEl.offsetWidth;
    sayEl.classList.add("pop");
    sayTimer = setTimeout(() => { if (sayEl) sayEl.hidden = true; }, ms);
  }

  function setState(next, ms = 1600) {
    if (!STATE_LOOK[next]) next = docked ? "docked" : "idle";
    state = next;
    stateUntil = ms ? performance.now() + ms : 0;
    pulse = Math.max(pulse, STATE_LOOK[next].pulse || 0);
    if (layer) layer.dataset.state = state;
  }

  function react(kind, ms = 1600) {
    if (!prefs.enabled || !prefs.notificationReactions) return;
    if (!layer) return;
    const map = {
      listening: ["listening", "I'm listening."],
      thinking: ["thinking", "Thinking."],
      talking: ["working", ""],
      alert: ["notifying", "Needs your attention."],
      happy: ["celebrating", "Done."],
      success: ["celebrating", "Done."],
      error: ["concerned", "Something needs fixing."],
    };
    const [next, text] = map[kind] || ["working", ""];
    setState(next, ms);
    if (text && kind !== "talking") say(text, Math.min(ms + 600, 2800));
  }

  function dock() {
    docked = true;
    setTargetToDock();
    setState("docked", 0);
    try { localStorage.setItem(LEGACY_DOCK_KEY, "1"); } catch {}
    applyPreferenceClasses();
  }

  function undock() {
    dock();
  }

  function pickWanderTarget(now, force = false) {
    if (!force && now < nextWanderAt) return;
    if (!roamingAllowed() || docked || userBusy()) {
      setTargetToDock();
      return;
    }
    const inset = safeInsets();
    const minX = inset.left + size / 2;
    const maxX = window.innerWidth - inset.right - size / 2;
    const minY = inset.top + size / 2;
    const maxY = window.innerHeight - inset.bottom - size / 2;
    const zone = Math.floor(Math.random() * 3);
    tx = zone === 0 ? maxX - Math.random() * Math.min(220, maxX - minX) :
      zone === 1 ? minX + Math.random() * Math.min(220, maxX - minX) :
      minX + Math.random() * Math.max(1, maxX - minX);
    ty = minY + Math.random() * Math.max(1, (maxY - minY) * 0.65);
    nextWanderAt = now + 9000 + Math.random() * 10000;
  }

  function userBusy() {
    if (document.body.classList.contains("overlay-open")) return true;
    const active = document.activeElement;
    if (!active) return false;
    return !!active.closest("input, textarea, select, [contenteditable='true'], .cmdk, .notif-menu, .modal, .overlay, .chatbox-composer");
  }

  function maybeIdleTrick(now) {
    if (prefs.idleFrequency === "off" || prefs.personality === "quiet" || reduceMotion() || userBusy()) return;
    if (now < nextIdleAt) return;
    const interval = prefs.idleFrequency === "normal" ? 22000 : 42000;
    nextIdleAt = now + interval + Math.random() * interval;
    if (docked) {
      setState(prefs.personality === "playful" ? "playful" : "curious", 1200);
      if (prefs.personality === "playful" && prefs.speechEnabled) say("Still here.", 1400);
    }
  }

  function focusChat() {
    const input = document.querySelector("[data-command-input]");
    input?.focus({ preventScroll: true });
    setState("listening", 1800);
    say("Ready.", 1600);
  }

  function openSurface(id) {
    const button = document.querySelector(`[data-nav-id="${id}"]`);
    if (button) {
      button.click();
      return;
    }
    try {
      location.hash = `#ws/${id}`;
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}
  }

  function openMenu(clientX, clientY) {
    if (!menu) return;
    syncMenuControls();
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    const left = Math.max(10, Math.min(window.innerWidth - rect.width - 10, clientX));
    const top = Math.max(10, Math.min(window.innerHeight - rect.height - 10, clientY));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.querySelector("button, select")?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu) menu.hidden = true;
  }

  function handleMenuAction(action) {
    if (action === "ask") focusChat();
    else if (action === "notifications") document.querySelector("[data-notif-btn]")?.click();
    else if (action === "approvals") openSurface("approvals");
    else if (action === "dock") { updateCompanionPrefs({ roamingEnabled: false, startDocked: true, dockLocation: "sidebar" }); dock(); say("I'm home.", 1500); }
    else if (action === "quiet") { updateCompanionPrefs({ personality: "quiet", motionLevel: "reduced", idleFrequency: "off", speechEnabled: false }); dock(); }
    else if (action === "hide") hideCompanionForSession();
    else if (action === "disable") updateCompanionPrefs({ enabled: false });
    closeMenu();
  }

  function bindEvents() {
    eventAbort = new AbortController();
    const signal = eventAbort.signal;
    window.addEventListener("pointermove", (event) => { lastPointer = { x: event.clientX, y: event.clientY }; }, { passive: true, signal });
    window.addEventListener("resize", () => { configureCanvas(); if (docked || mobile()) dock(); }, { passive: true, signal });
    document.addEventListener("click", (event) => {
      if (menu && !menu.hidden && !menu.contains(event.target) && event.target !== canvas) closeMenu();
    }, { signal });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    }, { signal });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      dragging = true;
      dragged = false;
      grabDX = event.clientX - x;
      grabDY = event.clientY - y;
      canvas.setPointerCapture(event.pointerId);
      layer.classList.add("is-grabbed");
      setState("dragged", 99999);
    }, { signal });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const nx = event.clientX - grabDX;
      const ny = event.clientY - grabDY;
      vx = (nx - x) * 0.72;
      vy = (ny - y) * 0.72;
      if (Math.hypot(nx - x, ny - y) > 2.5) dragged = true;
      x = nx;
      y = ny;
      clampToSafeZone();
    }, { signal });
    const release = (event) => {
      if (!dragging) return;
      dragging = false;
      layer.classList.remove("is-grabbed");
      if (event?.pointerId != null) { try { canvas.releasePointerCapture(event.pointerId); } catch {} }
      if (dragged) {
        updateCompanionPrefs({ roamingEnabled: false, startDocked: true, dockLocation: "sidebar" });
        dock();
        say("I'll stay in the sidebar.", 1600);
      } else {
        setState("curious", 1200);
        const pool = QUIPS[prefs.personality] || QUIPS.friendly;
        say(pool[Math.floor(Math.random() * pool.length)], 2200);
      }
      applyPreferenceClasses();
    };
    canvas.addEventListener("pointerup", release, { signal });
    canvas.addEventListener("pointercancel", release, { signal });
    canvas.addEventListener("dblclick", () => {
      updateCompanionPrefs({ roamingEnabled: false, startDocked: true, dockLocation: "sidebar" });
      dock();
      say("Back home.", 1500);
    }, { signal });
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY);
    }, { signal });
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusChat(); }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const rect = canvas.getBoundingClientRect();
        openMenu(rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
    }, { signal });
    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-buddy-action]")?.dataset.buddyAction;
      if (action) handleMenuAction(action);
    }, { signal });
    menu.addEventListener("change", (event) => {
      const field = event.target.closest("[data-buddy-pref]");
      if (!field) return;
      updateCompanionPrefs({ [field.dataset.buddyPref]: field.value });
    }, { signal });
  }

  function startLoop() {
    if (running || !layer || !ctx2 || !character) return;
    running = true;
    const token = ++loopToken;
    const t0 = performance.now();
    let last = t0;
    setTargetToDock();

    const frame = (now) => {
      if (!running || token !== loopToken || !layer || !ctx2 || !character) return;
      requestAnimationFrame(frame);
      if (document.hidden) return;
      const isDockedIdle = docked && (state === "docked" || state === "idle");
      const frameGap = isDockedIdle || reduceMotion() ? 66 : 16;
      if (now - lastPaintAt < frameGap) return;
      lastPaintAt = now;
      const t = (now - t0) * 0.001;
      const dt = Math.min(0.06, (now - last) * 0.001);
      last = now;

      if (stateUntil && now > stateUntil) {
        state = docked ? "docked" : "idle";
        stateUntil = 0;
      }
      if (mobile() && !docked) dock();
      if (document.body.classList.contains("overlay-open")) {
        setTargetToDock();
      } else if (!dragging) {
        if (docked || !roamingAllowed() || userBusy()) setTargetToDock();
        else pickWanderTarget(now);
      }

      if (!dragging) {
        const k = docked || !roamingAllowed() || reduceMotion() ? 0.12 : 0.026;
        vx += (tx - x) * k * dt * 60;
        vy += (ty - y) * k * dt * 60;
        vx *= docked ? 0.76 : 0.92;
        vy *= docked ? 0.76 : 0.92;
        x += vx;
        y += vy + (reduceMotion() ? 0 : Math.sin(t * 1.25) * (docked ? 0.12 : 0.34));
        clampToSafeZone();
      }

      maybeIdleTrick(now);
      pulse = Math.max(0, pulse - dt * 1.1);
      applyPreferenceClasses();

      const tilt = reduceMotion() || docked ? 0 : Math.max(-10, Math.min(10, vx * 1.2));
      const flourish = state === "playful" && prefs.personality === "playful" && !reduceMotion()
        ? Math.sin(t * 8) * 7
        : 0;
      layer.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px) rotate(${(tilt + flourish).toFixed(1)}deg)`;

      const look = STATE_LOOK[state] || STATE_LOOK.idle;
      const px = Math.max(-0.5, Math.min(0.5, (lastPointer.x - x) / 640));
      const py = Math.max(-0.5, Math.min(0.5, (lastPointer.y - y) / 640));
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.clearRect(0, 0, size, size);
      character.draw(ctx2, {
        t,
        dt,
        cx: size / 2,
        cy: size * 0.56,
        scale: size * 0.3,
        mood: look.mood,
        emotion: look.emotion,
        pulse: pulse + (look.pulse || 0),
        px,
        py,
        startupOnly: false,
        moodAge: stateUntil ? Math.max(0, (stateUntil - now) * 0.001) : 2,
      });
    };
    requestAnimationFrame(frame);
  }

  return { applyPreferences, react };
}
