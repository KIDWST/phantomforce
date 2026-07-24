/* PhantomForce companion.
   One sidebar-docked Phantom system: preference-aware, drag-safe, always
   returns home, and tied to real chat/notification states. */

import { createPhantomCharacter } from "./character.js?v=phantom-live-20260723-57";
import {
  COMPANION_EVENT,
  clearCompanionSessionHide,
  hideCompanionForSession,
  isCompanionHiddenForSession,
  loadCompanionPrefs,
  updateCompanionPrefs,
} from "./companion-preferences.js?v=phantom-live-20260723-57";

const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const LEGACY_DOCK_KEY = "pf.buddy.docked.v1";
const GREETED_SESSION_KEY = "pf.companion.greeted.session.v1";
const LAST_GREETING_KEY = "pf.companion.lastGreeting.v1";
const LAST_QUIP_KEY = "pf.companion.lastQuip.v1";

const GREETINGS = {
  professional: ["Ready when you are.", "Your Phantom is standing by.", "Systems are ready.", "Good timing. We have work to do."],
  friendly: ["Human!", "You're back!", "There you are.", "Welcome back, boss.", "Ready when you are.", "I was waiting for you."],
  playful: ["Human!", "I missed you.", "There you are.", "The workforce is ready.", "Welcome back, boss.", "Everything feels better when you're here."],
  quiet: ["Ready.", "Standing by.", "Online."],
};

const BASE_QUIPS = [
  "I run the boring half. You take the glory.",
  "Every desk is watching. Nothing slips.",
  "Say the word and it becomes work.",
  "I never sleep. It's a whole thing.",
  "Approvals first. Chaos never.",
  "Your calendar fears me.",
  "Caught three threats before breakfast.",
  "Docked, not domesticated.",
];

const QUIPS = {
  professional: ["Standing by.", "Approval gates stay on.", "Nothing external moves without you.", ...BASE_QUIPS],
  friendly: ["I'm here.", "Tell me where to look.", "Your Phantom is nearby.", ...BASE_QUIPS],
  playful: ["I fit better over here.", "Small Phantom, serious job.", "I promise not to hover over the buttons.", "Haunting the sidebar. Professionally.", ...BASE_QUIPS],
  quiet: ["Here.", "Ready.", "Docked.", "Approvals first."],
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
  let buddyWidth = 120;
  let buddyHeight = 120;
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
  let lastHitTestAt = 0;
  let sayTimer = 0;
  let nextIdleAt = 0;
  let nextWanderAt = 0;
  let lastPaintAt = 0;
  let scrollHideTimer = 0;
  let revealAt = 0;
  let revealed = false;

  function mobile() { return window.matchMedia("(max-width: 720px)").matches; }
  function reduceMotion() { return reduceMotionQuery.matches || prefs.motionLevel === "reduced" || prefs.motionLevel === "none"; }
  function motionAllowed() { return !reduceMotion() && prefs.motionLevel !== "none"; }
  function roamingAllowed() { return false; }
  function sidebarPortraitMode() { return !mobile() && prefs.dockLocation === "sidebar"; }

  function sidebarRect() {
    const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
    if (sidebar && sidebar.width > 120) return sidebar;
    return { left: 0, top: 0, width: window.innerWidth > 900 ? 212 : 0 };
  }

  function sidebarDockZone() {
    const side = sidebarRect();
    const sidebar = document.querySelector(".sidebar");
    const nav = sidebar?.querySelector(".side-nav-main");
    const bottomNav = sidebar?.querySelector(".side-nav-bottom");
    const navItems = nav ? [...nav.querySelectorAll(".nav-item")].map((item) => item.getBoundingClientRect()).filter((rect) => (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    )) : [];
    const sideTop = Math.max(0, side.top || 0);
    const sideBottom = Math.min(window.innerHeight, side.bottom || window.innerHeight);
    const bottomNavRect = bottomNav?.getBoundingClientRect();
    const bottomNavVisible = !!bottomNavRect && bottomNavRect.width > 0 && bottomNavRect.height > 0 && bottomNavRect.top < sideBottom && bottomNavRect.bottom > sideTop;
    const lastNavBottom = navItems.length ? Math.max(...navItems.map((rect) => rect.bottom)) : (sideTop + 420);
    const hardBottom = bottomNavVisible
      ? Math.max(sideTop + 126, Math.min(sideBottom - 12, bottomNavRect.top - 12))
      : sideBottom - 12;
    const bottom = Math.max(sideTop + 126, hardBottom);
    const preferredTop = Math.max(lastNavBottom + 14, sideTop + 250);
    const top = Math.min(preferredTop, Math.max(sideTop + 106, bottom - 78));
    const height = Math.max(0, bottom - top);
    return {
      left: side.left,
      top,
      bottom,
      width: side.width,
      height: Math.max(76, height),
      cramped: height < 116,
    };
  }

  function safeInsets() {
    const hasSidebar = window.innerWidth > 900;
    const inSidebarDock = hasSidebar && prefs.dockLocation === "sidebar";
    return {
      left: inSidebarDock ? 10 : hasSidebar ? 214 : 14,
      right: 18,
      top: hasSidebar ? 88 : 72,
      bottom: mobile() ? 98 : 24,
    };
  }

  function sizeForPrefs() {
    const map = {
      compact: mobile() ? 60 : 58,
      standard: mobile() ? 68 : 64,
      large: mobile() ? 78 : 74,
    };
    return map[prefs.size] || map.standard;
  }

  function dimensionsForPrefs() {
    const base = sizeForPrefs();
    if (!sidebarPortraitMode()) return { width: base, height: base };
    const zone = sidebarDockZone();
    const width = Math.round(Math.min(Math.max(base, 64), Math.max(58, Math.min(96, zone.width - 34))));
    const idealHeight = zone.cramped ? Math.max(base + 24, 92) : Math.max(base + 46, 118);
    const height = Math.round(Math.min(idealHeight, Math.max(76, Math.min(168, zone.height - 8))));
    return {
      width,
      height,
    };
  }

  function bottomRightPoint() {
    const inset = safeInsets();
    return {
      x: window.innerWidth - inset.right - buddyWidth / 2,
      y: window.innerHeight - inset.bottom - buddyHeight / 2,
    };
  }

  function sidebarPatrolBounds() {
    const halfX = buddyWidth / 2;
    const halfY = buddyHeight / 2;
    const zone = sidebarDockZone();
    const minX = zone.left + 20 + halfX;
    const maxX = Math.min(zone.left + zone.width - 12 - halfX, minX + 18);
    const minY = zone.top + halfY;
    const maxY = zone.bottom - halfY;
    return {
      minX,
      maxX: Math.max(minX, maxX),
      minY,
      maxY: Math.max(minY, maxY),
    };
  }

  function dockPoint() {
    const inset = safeInsets();
    const halfX = buddyWidth / 2;
    const halfY = buddyHeight / 2;
    const dock = mobile() && prefs.dockLocation === "sidebar" ? "bottom-right" : prefs.dockLocation;
    if (dock === "bottom-left") return { x: inset.left + halfX, y: window.innerHeight - inset.bottom - halfY };
    if (dock === "sidebar") {
      const bounds = sidebarPatrolBounds();
      return {
        x: bounds.minX,
        y: bounds.maxY,
      };
    }
    return { x: window.innerWidth - inset.right - halfX, y: window.innerHeight - inset.bottom - halfY };
  }

  function clampToSafeZone() {
    const inset = safeInsets();
    const halfX = buddyWidth / 2;
    const halfY = buddyHeight / 2;
    if (!mobile() && prefs.dockLocation === "sidebar") {
      const bounds = sidebarPatrolBounds();
      x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
      y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
      return;
    }
    x = Math.max(inset.left + halfX, Math.min(window.innerWidth - inset.right - halfX, x));
    y = Math.max(inset.top + halfY, Math.min(window.innerHeight - inset.bottom - halfY, y));
  }

  function setTargetToDock() {
    const dock = dockPoint();
    tx = dock.x;
    ty = dock.y;
  }

  function configureCanvas({ snap = false } = {}) {
    if (!canvas) return;
    size = sizeForPrefs();
    const dims = dimensionsForPrefs();
    const changed = Math.abs(dims.width - buddyWidth) > 1 || Math.abs(dims.height - buddyHeight) > 1;
    buddyWidth = dims.width;
    buddyHeight = dims.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (changed || canvas.width !== Math.round(buddyWidth * dpr) || canvas.height !== Math.round(buddyHeight * dpr)) {
      canvas.width = Math.round(buddyWidth * dpr);
      canvas.height = Math.round(buddyHeight * dpr);
      canvas.style.width = `${buddyWidth}px`;
      canvas.style.height = `${buddyHeight}px`;
    }
    layer.style.setProperty("--buddy-size", `${size}px`);
    layer.style.setProperty("--buddy-width", `${buddyWidth}px`);
    layer.style.setProperty("--buddy-height", `${buddyHeight}px`);
    const zone = sidebarPortraitMode() ? sidebarDockZone() : null;
    layer.classList.toggle("is-sidebar-cramped", !!zone?.cramped);
    setTargetToDock();
    if (!x || !y || (docked && snap)) {
      x = tx;
      y = ty;
    }
    clampToSafeZone();
  }

  function createLayer() {
    if (layer) return;
    layer = document.createElement("div");
    layer.className = "buddy is-docked is-booting";
    layer.setAttribute("data-buddy", "");
    layer.innerHTML = `
      <div class="buddy-say" data-buddy-say hidden></div>
      <canvas class="buddy-canvas" data-buddy-canvas width="10" height="10" aria-label="Phantom companion. Left-click for a quip, drag to bounce in the sidebar, right-click for controls." role="img" tabindex="0"></canvas>
      <div class="buddy-menu" data-buddy-menu hidden role="menu" aria-label="Phantom companion controls">
        <b>Phantom</b>
        <button type="button" data-buddy-action="ask" role="menuitem">Ask Phantom</button>
        <button type="button" data-buddy-action="notifications" role="menuitem">Show notifications</button>
        <button type="button" data-buddy-action="approvals" role="menuitem">Show approvals</button>
        <hr />
        <button type="button" data-buddy-action="dock" role="menuitem">Return to sidebar</button>
        <button type="button" data-buddy-action="quiet" role="menuitem">Quiet mode</button>
        <button type="button" data-buddy-action="hide" role="menuitem">Hide for 30 minutes</button>
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
    /* The layer moves via transform, and a transformed ancestor becomes the
       containing block for position:fixed children — leaving the menu inside
       would offset its viewport coordinates by the phantom's position and
       throw it off-screen. It must live directly under <body>. */
    document.body.appendChild(menu);
    ctx2 = canvas.getContext("2d");
    character = createPhantomCharacter({ small: true });
    revealed = false;
    revealAt = performance.now() + 720;
    bindEvents();
    configureCanvas({ snap: true });
  }

  function removeLayer() {
    clearTimeout(sayTimer);
    clearTimeout(scrollHideTimer);
    running = false;
    loopToken += 1;
    if (eventAbort) {
      eventAbort.abort();
      eventAbort = null;
    }
    if (layer) layer.remove();
    if (menu) menu.remove(); // re-parented to <body>, so the layer no longer owns it
    layer = canvas = sayEl = menu = ctx2 = character = null;
    revealed = false;
    revealAt = 0;
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

  function quipText() {
    const pool = QUIPS[prefs.personality] || QUIPS.friendly;
    let last = "";
    try { last = localStorage.getItem(LAST_QUIP_KEY) || ""; } catch {}
    const options = pool.filter((item) => item !== last);
    const next = (options.length ? options : pool)[Math.floor(Math.random() * (options.length ? options.length : pool.length))];
    try { localStorage.setItem(LAST_QUIP_KEY, next); } catch {}
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
    nextWanderAt = 0;
    setState("docked", 0);
    try { localStorage.setItem(LEGACY_DOCK_KEY, "1"); } catch {}
    applyPreferenceClasses();
  }

  function undock() {
    dock();
  }

  function pickWanderTarget(now, force = false) {
    if (!force && now < nextWanderAt) return;
    if (docked && prefs.dockLocation === "sidebar" && !mobile() && motionAllowed() && !userBusy()) {
      const bounds = sidebarPatrolBounds();
      tx = bounds.minX + Math.random() * Math.max(1, bounds.maxX - bounds.minX);
      ty = bounds.maxY - Math.random() * Math.min(18, Math.max(1, bounds.maxY - bounds.minY));
      nextWanderAt = now + 4200 + Math.random() * 5200;
      return;
    }
    if (!roamingAllowed() || docked || userBusy()) {
      setTargetToDock();
      nextWanderAt = now + 1600;
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
    /* The dashboard hero command input only exists on the dashboard home
       page. Everywhere else, "Ask Phantom" used to focus nothing. Route to
       the Phantom AI workspace (same real nav mechanism openSurface() below
       already uses for "approvals") and focus its chat input once the
       workspace has mounted, matching how wirePhantomConsole in main.js
       defers focus until after its own paint. */
    const input = document.querySelector("[data-command-input]");
    setState("listening", 1800);
    say("Ready.", 1600);
    if (input) {
      input.focus({ preventScroll: true });
      return;
    }
    openSurface("phantomai");
    setTimeout(() => {
      document.querySelector("[data-phantomai-chat-input]")?.focus({ preventScroll: true });
    }, 60);
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
    const anchorX = Number.isFinite(clientX) ? clientX : x + buddyWidth / 2;
    const anchorY = Number.isFinite(clientY) ? clientY : y - buddyHeight / 2;
    const gutter = 10;
    const sidebar = sidebarRect();
    const prefersRightOfSidebar = prefs.dockLocation === "sidebar" && sidebar.width > 120;
    const rawLeft = prefersRightOfSidebar ? sidebar.left + sidebar.width + gutter : anchorX;
    const rawTop = prefersRightOfSidebar ? anchorY - rect.height + 18 : anchorY;
    const left = Math.max(gutter, Math.min(window.innerWidth - rect.width - gutter, rawLeft));
    const top = Math.max(gutter, Math.min(window.innerHeight - rect.height - gutter, rawTop));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.querySelector("button, select")?.focus({ preventScroll: true });
  }

  function closeMenu() {
    if (menu) menu.hidden = true;
  }

  function buddyRectHit(clientX, clientY) {
    if (!canvas || !layer) return false;
    if (document.body.classList.contains("overlay-open")) return false;
    if (getComputedStyle(layer).opacity === "0") return false;
    const rect = canvas.getBoundingClientRect();
    return !(
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    );
  }

  function buddyHitTest(clientX, clientY, alphaThreshold = 8) {
    if (!canvas || !ctx2 || !buddyRectHit(clientX, clientY)) return false;
    const rect = canvas.getBoundingClientRect();
    try {
      const sx = Math.max(0, Math.min(canvas.width - 1, Math.floor((clientX - rect.left) * (canvas.width / rect.width))));
      const sy = Math.max(0, Math.min(canvas.height - 1, Math.floor((clientY - rect.top) * (canvas.height / rect.height))));
      return ctx2.getImageData(sx, sy, 1, 1).data[3] > alphaThreshold;
    } catch {
      return true;
    }
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

  function openMenuFromPointerEvent(event, { requireRightButton = true } = {}) {
    if (!canvas || !menu || menu.contains(event.target)) return false;
    if (requireRightButton && event.button !== 2) return false;
    if (event.target !== canvas && !buddyRectHit(event.clientX, event.clientY)) return false;
    event.preventDefault();
    event.stopPropagation();
    canvas.style.pointerEvents = "auto";
    setState("curious", 1200);
    openMenu(event.clientX, event.clientY);
    return true;
  }

  /* The canvas is a big rectangle but the ghost only fills part of it. Keep the
     canvas click-through by default and only accept the pointer while it is over
     an actually painted pixel — otherwise the companion silently eats clicks on
     whatever nav buttons it happens to float across. */
  function updatePointerHitState(force = false) {
    if (!canvas || !ctx2) return;
    if (dragging || (menu && !menu.hidden)) { canvas.style.pointerEvents = "auto"; return; }
    const now = performance.now();
    if (!force && now - lastHitTestAt < 30) return;
    lastHitTestAt = now;
    const over = buddyHitTest(lastPointer.x, lastPointer.y);
    canvas.style.pointerEvents = over ? "auto" : "none";
  }

  function bindEvents() {
    eventAbort = new AbortController();
    const signal = eventAbort.signal;
    const hideDuringScroll = () => {
      if (!layer || dragging || (menu && !menu.hidden)) return;
      layer.classList.add("is-scroll-hidden");
      if (canvas) canvas.style.pointerEvents = "none";
      clearTimeout(scrollHideTimer);
      scrollHideTimer = setTimeout(() => {
        if (!layer) return;
        configureCanvas({ snap: false });
        dock();
        layer.classList.remove("is-scroll-hidden");
        updatePointerHitState(true);
      }, 260);
    };
    window.addEventListener("pointermove", (event) => { lastPointer = { x: event.clientX, y: event.clientY }; updatePointerHitState(); }, { passive: true, signal });
    window.addEventListener("resize", () => { configureCanvas({ snap: true }); if (docked || mobile()) dock(); }, { passive: true, signal });
    document.addEventListener("scroll", hideDuringScroll, { passive: true, capture: true, signal });
    document.addEventListener("pointerdown", (event) => {
      openMenuFromPointerEvent(event);
    }, { capture: true, signal });
    document.addEventListener("mousedown", (event) => {
      openMenuFromPointerEvent(event);
    }, { capture: true, signal });
    document.addEventListener("click", (event) => {
      if (menu && !menu.hidden && !menu.contains(event.target) && event.target !== canvas) closeMenu();
    }, { signal });
    document.addEventListener("contextmenu", (event) => {
      openMenuFromPointerEvent(event, { requireRightButton: false });
    }, { capture: true, signal });
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
        if (sidebarPortraitMode()) {
          setState("curious", 1100);
          pulse = Math.max(pulse, 0.18);
          say(quipText(), 1900);
        } else {
          setState(prefs.personality === "quiet" ? "curious" : "playful", 1400);
          pulse = Math.max(pulse, 0.85);
          say(quipText(), 2400);
        }
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
      const sidebarAliveNow = docked && sidebarPortraitMode() && motionAllowed() && !userBusy();
      const isDockedIdle = docked && (state === "docked" || state === "idle");
      const frameGap = reduceMotion() ? 66 : sidebarAliveNow ? 16 : isDockedIdle ? 66 : 16;
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
        if (docked) pickWanderTarget(now);
        else if (!roamingAllowed() || userBusy()) setTargetToDock();
        else pickWanderTarget(now);
      }

      if (!dragging) {
        const sidebarAlive = docked && sidebarPortraitMode() && motionAllowed() && !userBusy();
        const k = docked || !roamingAllowed() || reduceMotion() ? (sidebarAlive ? 0.055 : 0.12) : 0.026;
        vx += (tx - x) * k * dt * 60;
        vy += (ty - y) * k * dt * 60;
        vx *= docked ? (sidebarAlive ? 0.91 : 0.76) : 0.92;
        vy *= docked ? (sidebarAlive ? 0.91 : 0.76) : 0.92;
        x += vx + (sidebarAlive ? Math.sin(t * 1.7) * 0.18 : 0);
        y += vy + (reduceMotion() ? 0 : Math.sin(t * 1.25) * (sidebarAlive ? 0.52 : docked ? 0.12 : 0.34));
        clampToSafeZone();
      }

      maybeIdleTrick(now);
      pulse = Math.max(0, pulse - dt * 1.1);
      applyPreferenceClasses();

      const sidebarAlive = docked && sidebarPortraitMode() && motionAllowed() && !userBusy();
      const tilt = reduceMotion() || (docked && !sidebarAlive) ? 0 : Math.max(-10, Math.min(10, vx * 1.2));
      const dockTwirl = sidebarAlive ? Math.sin(t * 1.8) * 1.4 : 0;
      const flourish = state === "playful" && prefs.personality !== "quiet" && !reduceMotion()
        ? Math.sin(t * 8) * (sidebarPortraitMode() ? 1.5 : 8)
        : 0;
      const rotation = sidebarPortraitMode() ? dockTwirl + flourish : tilt + dockTwirl + flourish;
      layer.style.transform = `translate(${(x - buddyWidth / 2).toFixed(1)}px, ${(y - buddyHeight / 2).toFixed(1)}px)`;
      canvas.style.transform = `rotate(${rotation.toFixed(1)}deg)`;

      const look = STATE_LOOK[state] || STATE_LOOK.idle;
      const px = Math.max(-0.5, Math.min(0.5, (lastPointer.x - x) / 640));
      const py = Math.max(-0.5, Math.min(0.5, (lastPointer.y - y) / 640));
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.clearRect(0, 0, buddyWidth, buddyHeight);
      const portrait = sidebarPortraitMode();
      if (portrait) {
        ctx2.save();
        ctx2.translate(buddyWidth / 2, buddyHeight * 0.58);
        ctx2.scale(0.9, 1.2);
        ctx2.translate(-buddyWidth / 2, -buddyHeight * 0.58);
      }
      character.draw(ctx2, {
        t,
        dt,
        cx: buddyWidth / 2,
        cy: portrait ? buddyHeight * 0.56 : buddyHeight * 0.56,
        scale: portrait ? Math.min(buddyWidth * 0.52, buddyHeight * 0.27) : size * 0.3,
        mood: look.mood,
        emotion: look.emotion,
        pulse: pulse + (look.pulse || 0),
        px,
        py,
        startupOnly: false,
        moodAge: stateUntil ? Math.max(0, (stateUntil - now) * 0.001) : 2,
      });
      if (portrait) ctx2.restore();
      updatePointerHitState(true);
      if (!revealed && now >= revealAt) {
        revealed = true;
        layer.classList.remove("is-booting");
        layer.classList.add("is-ready");
        updatePointerHitState(true);
      }
    };
    requestAnimationFrame(frame);
  }

  return { applyPreferences, react };
}
