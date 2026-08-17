/* PhantomPlay — generic runtime mod loader.

   Non-invasive by design: works on ANY game (canvas or DOM based) without
   that game needing to opt in, by monkey-patching browser-level primitives
   (rAF, AudioContext, CSS) rather than requiring a shared game-engine API.
   Games that DO expose a dev-hook object (see vespergate's `window.VG.dev`)
   can be modded much more deeply — see app/games/vespergate/mods/ for that
   pattern. Only injected by the PhantomPlay native shell's player, never on
   the public web app — <script src="../shared/modLoader.js"></script> is
   added by the shell at serve time, not baked into any game's index.html.

   Per-game manifest convention: app/games/<id>/mods/manifest.json is an
   array of { id, file, name, desc }. Each mods/<file> calls
   window.PhantomMods.register({...}) when it loads. */
(function () {
  "use strict";
  if (window.PhantomMods) return; // already injected once

  var pathParts = location.pathname.split("/").filter(Boolean);
  var gamesIdx = pathParts.indexOf("games");
  var gameId = document.documentElement.getAttribute("data-pm-game-id") ||
    (gamesIdx !== -1 ? pathParts[gamesIdx + 1] : pathParts[0]) ||
    (document.title || "unknown-game").toLowerCase().replace(/\s+/g, "-");
  var STORAGE_KEY = "phantomplay_mods_" + gameId;
  var nativeHost = document.documentElement.getAttribute("data-pm-native") === "true";
  var bootstrap = window.__PHANTOMPLAY_MOD_BOOTSTRAP__ || {};
  var singleFileGame = /\.html$/i.test(pathParts[0] || "");
  var modBase = bootstrap.modBase || (singleFileGame
    ? "/shared/mods/" + encodeURIComponent(gameId) + "/"
    : "/" + encodeURIComponent(gameId) + "/mods/");
  var modStateUrl = "/__pm_mods/" + encodeURIComponent(gameId);

  var registry = new Map(); // id -> mod
  var activeIds = new Set();
  var liveInstances = new Map(); // id -> return value of apply(), passed to remove()

  function loadEnabled() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }
  function saveEnabled() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(activeIds)));
    } catch (e) {}
  }
  function persistEnabled() {
    saveEnabled();
    if (!nativeHost) return Promise.resolve();
    return new Promise(function (resolve) {
      var safeIds = Array.from(activeIds).filter(function (id) { return /^[a-zA-Z0-9_-]+$/.test(id); });
      var beacon = document.createElement("script");
      beacon.async = true;
      beacon.src = "/__pm_mods_write/" + encodeURIComponent(gameId) + "/" + safeIds.join(",") + "?ts=" + Date.now();
      beacon.onload = function () { beacon.remove(); resolve(); };
      beacon.onerror = function () {
        beacon.remove();
        console.error("[PhantomMods] could not persist native mod state");
        toast("Mod is live, but desktop persistence failed");
        resolve();
      };
      document.head.appendChild(beacon);
    });
  }

  function toast(text) {
    var el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
      "background:rgba(10,8,18,0.92);color:#eaf2ff;font:600 12px monospace;padding:8px 14px;border-radius:8px;" +
      "border:1px solid rgba(143,233,255,0.4);box-shadow:0 4px 18px rgba(0,0,0,0.4);pointer-events:none;transition:opacity .4s;";
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; }, 1400);
    setTimeout(function () { el.remove(); }, 1900);
  }

  var frameCallbacks = [];
  var rafPatched = false;
  var timeScale = 1;
  function ensureRafHook() {
    if (rafPatched) return;
    rafPatched = true;
    var nativeRaf = window.requestAnimationFrame.bind(window);
    var nativeTime = null;
    var gameTime = null;
    window.requestAnimationFrame = function (cb) {
      return nativeRaf(function (t) {
        if (nativeTime === null) { nativeTime = t; gameTime = t; }
        gameTime += Math.max(0, t - nativeTime) * timeScale;
        nativeTime = t;
        for (var i = 0; i < frameCallbacks.length; i++) {
          try { frameCallbacks[i](gameTime); } catch (e) {}
        }
        cb(gameTime);
      });
    };
  }

  var devFlagClaims = new Map();
  function claimDevFlag(owner, name, value) {
    var dev = window.PhantomPlayDev;
    if (!dev || typeof dev.setFlag !== "function") throw new Error("This game does not expose the " + name + " developer capability");
    var bucket = devFlagClaims.get(name);
    if (!bucket) {
      bucket = { base: typeof dev.getFlag === "function" ? dev.getFlag(name) : false, claims: new Map() };
      devFlagClaims.set(name, bucket);
    }
    bucket.claims.set(owner, value);
    dev.setFlag(name, value);
    return function () {
      var current = devFlagClaims.get(name);
      if (!current) return;
      current.claims.delete(owner);
      var remaining = Array.from(current.claims.values());
      dev.setFlag(name, remaining.length ? remaining[remaining.length - 1] : current.base);
      if (!remaining.length) devFlagClaims.delete(name);
    };
  }

  var ctx = {
    game: window,
    gameId: gameId,
    toast: toast,
    dev: window.PhantomPlayDev || null,
    claimDevFlag: claimDevFlag,
    onFrame: function (cb) { ensureRafHook(); frameCallbacks.push(cb); return function () { frameCallbacks = frameCallbacks.filter(function (f) { return f !== cb; }); }; },
    setTimeScale: function (scale) { ensureRafHook(); timeScale = Math.max(0.05, Number(scale) || 1); },
    canvas: function () { return document.querySelector("canvas"); },
  };

  var PM = (window.PhantomMods = {
    register: function (mod) {
      if (!mod || !mod.id || typeof mod.apply !== "function") return;
      registry.set(mod.id, mod);
      if (activeIds.has(mod.id)) enable(mod.id, true, true);
      renderMenu();
    },
    list: function () { return Array.from(registry.values()).map(function (m) { return { id: m.id, name: m.name, desc: m.desc, category: m.category || "game", active: activeIds.has(m.id) }; }); },
    toggle: toggle,
    enable: enable,
    disable: disable,
  });

  function enable(id, silent, skipPersist) {
    var mod = registry.get(id);
    if (!mod || liveInstances.has(id)) return;
    try {
      liveInstances.set(id, mod.apply(ctx) || true);
      activeIds.add(id);
      if (!skipPersist) persistEnabled();
      if (!silent) toast("Mod ON: " + (mod.name || id));
      renderMenu();
    } catch (e) {
      console.error("[PhantomMods] failed to enable", id, e);
    }
  }
  function disable(id, silent, skipPersist) {
    var mod = registry.get(id);
    if (!mod) return;
    try {
      if (typeof mod.remove === "function") mod.remove(ctx, liveInstances.get(id));
    } catch (e) {}
    liveInstances.delete(id);
    activeIds.delete(id);
    if (!skipPersist) persistEnabled();
    if (!silent) toast("Mod off: " + (mod.name || id));
    renderMenu();
  }
  function toggle(id) { (activeIds.has(id) ? disable : enable)(id); }

  // ---- universal mods: work on every game, no cooperation required -------
  PM.register({
    id: "universal_slowmo", name: "Slow Motion", desc: "Runs game time at 35% speed.", category: "universal",
    apply: function (c) {
      c.setTimeScale(0.35);
      return true;
    },
    remove: function (c) { c.setTimeScale(1); },
  });
  PM.register({
    id: "universal_crt", name: "CRT Filter", desc: "Retro scanline + vignette look.", category: "universal",
    apply: function () {
      var style = document.createElement("style");
      style.id = "pm-crt-style";
      style.textContent = "canvas{filter:contrast(1.15) saturate(1.2) brightness(1.03);}" +
        "body::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:2147483646;" +
        "background:repeating-linear-gradient(0deg,rgba(0,0,0,0.12) 0px,rgba(0,0,0,0.12) 1px,transparent 2px,transparent 3px);}";
      document.head.appendChild(style);
      return style;
    },
    remove: function (c, style) { style && style.remove(); },
  });
  PM.register({
    id: "universal_bigcursor", name: "Big Cursor", desc: "Larger, high-contrast cursor.", category: "universal",
    apply: function () {
      var style = document.createElement("style");
      style.textContent = "*{cursor:crosshair !important;}";
      document.head.appendChild(style);
      return style;
    },
    remove: function (c, style) { style && style.remove(); },
  });
  PM.register({
    id: "universal_mute", name: "Mute Audio", desc: "Suspends all Web Audio output.", category: "universal",
    apply: function (c) {
      var suspended = [];
      if (c.dev && typeof c.dev.setAudioMuted === "function") c.dev.setAudioMuted(true);
      var NativeCtx = window.AudioContext || window.webkitAudioContext;
      if (!NativeCtx) return null;
      var PatchedCtx = new Proxy(NativeCtx, {
        construct: function (Target, args) {
          var inst = new Target(...args);
          try { inst.suspend(); } catch (e) {}
          suspended.push(inst);
          return inst;
        },
      });
      window.AudioContext = PatchedCtx;
      window.webkitAudioContext = PatchedCtx;
      document.querySelectorAll("audio,video").forEach(function (el) { el.muted = true; });
      return { NativeCtx: NativeCtx, suspended: suspended };
    },
    remove: function (c, state) {
      if (c.dev && typeof c.dev.setAudioMuted === "function") c.dev.setAudioMuted(false);
      if (!state) return;
      window.AudioContext = state.NativeCtx;
      window.webkitAudioContext = state.NativeCtx;
      state.suspended.forEach(function (inst) { try { inst.resume(); } catch (e) {} });
      document.querySelectorAll("audio,video").forEach(function (el) { el.muted = false; });
    },
  });
  PM.register({
    id: "universal_zoom", name: "Zoom In", desc: "Scales the game canvas 1.4x.", category: "universal",
    apply: function (c) {
      var cv = c.canvas();
      if (!cv) return null;
      var prev = cv.style.transform;
      cv.style.transform = (prev || "") + " scale(1.4)";
      cv.style.transformOrigin = "center";
      return { cv: cv, prev: prev };
    },
    remove: function (c, state) { if (state) state.cv.style.transform = state.prev; },
  });

  // PhantomPlay Desktop owns the visible mod controls. The injected runtime
  // only applies the state selected in the shell and never covers the game
  // with a second in-game menu.
  function renderMenu() {}

  function readHostState() {
    if (nativeHost && Array.isArray(bootstrap.enabled)) {
      activeIds = new Set(bootstrap.enabled);
      saveEnabled();
      return Promise.resolve();
    }
    var source = nativeHost ? modStateUrl : modBase + ".enabled.json";
    return fetch(source, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("mod state read failed: " + response.status);
      return response.json();
    }).catch(function () {
      return loadEnabled();
    }).then(function (ids) {
      activeIds = new Set(Array.isArray(ids) ? ids : []);
      saveEnabled();
    });
  }

  function loadProjectMods() {
    function loadEntries(list) {
        return Promise.all((Array.isArray(list) ? list : []).map(function (entry) {
          return new Promise(function (resolve) {
            var s = document.createElement("script");
            s.src = modBase + entry.file;
            s.async = true;
            s.onload = resolve;
            s.onerror = function () {
              console.error("[PhantomMods] failed to load", s.src);
              resolve();
            };
            document.body.appendChild(s);
          });
        }));
    }
    if (nativeHost && Array.isArray(bootstrap.mods)) return loadEntries(bootstrap.mods);
    return fetch(modBase + "manifest.json", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(loadEntries).catch(function (error) {
        console.error("[PhantomMods] manifest load failed", error);
      });
  }

  // The native endpoint is authoritative for the desktop Mods tab. Waiting
  // for state and scripts removes the old startup race where checked mods
  // could register before the shell selection arrived and never apply.
  Promise.all([readHostState(), loadProjectMods()]).then(function () {
    registry.forEach(function (_mod, id) {
      if (activeIds.has(id)) enable(id, true, true);
    });
    renderMenu();
    window.dispatchEvent(new CustomEvent("phantommods:ready", {
      detail: { gameId: gameId, active: Array.from(activeIds), available: PM.list() },
    }));
  });
})();
