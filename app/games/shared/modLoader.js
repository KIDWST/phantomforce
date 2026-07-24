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

  var registry = new Map(); // id -> mod
  var hasStoredPrefs = localStorage.getItem(STORAGE_KEY) !== null;
  var activeIds = new Set(loadEnabled());
  var liveInstances = new Map(); // id -> return value of apply(), passed to remove()

  // First-ever launch for this game: seed from the native shell's quick-load
  // Mods menu selection (app/games/<id>/mods/.enabled.json) if present. Once
  // localStorage has anything saved, it's the source of truth (in-game F10
  // edits win from then on).
  if (!hasStoredPrefs) {
    fetch("./mods/.enabled.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (ids) {
      (Array.isArray(ids) ? ids : []).forEach(function (id) {
        activeIds.add(id);
        if (registry.has(id)) enable(id, true); // already registered before this resolved
      });
      saveEnabled();
    }).catch(function () {});
  }

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
  function ensureRafHook() {
    if (rafPatched) return;
    rafPatched = true;
    var nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return nativeRaf(function (t) {
        for (var i = 0; i < frameCallbacks.length; i++) {
          try { frameCallbacks[i](t); } catch (e) {}
        }
        cb(t);
      });
    };
  }

  var ctx = {
    game: window,
    gameId: gameId,
    toast: toast,
    onFrame: function (cb) { ensureRafHook(); frameCallbacks.push(cb); return function () { frameCallbacks = frameCallbacks.filter(function (f) { return f !== cb; }); }; },
    canvas: function () { return document.querySelector("canvas"); },
  };

  var PM = (window.PhantomMods = {
    register: function (mod) {
      if (!mod || !mod.id || typeof mod.apply !== "function") return;
      registry.set(mod.id, mod);
      if (activeIds.has(mod.id)) enable(mod.id, true);
      renderMenu();
    },
    list: function () { return Array.from(registry.values()).map(function (m) { return { id: m.id, name: m.name, desc: m.desc, category: m.category || "game", active: activeIds.has(m.id) }; }); },
    toggle: toggle,
    enable: enable,
    disable: disable,
  });

  function enable(id, silent) {
    var mod = registry.get(id);
    if (!mod || liveInstances.has(id)) return;
    try {
      liveInstances.set(id, mod.apply(ctx) || true);
      activeIds.add(id);
      saveEnabled();
      if (!silent) toast("Mod ON: " + (mod.name || id));
      renderMenu();
    } catch (e) {
      console.error("[PhantomMods] failed to enable", id, e);
    }
  }
  function disable(id) {
    var mod = registry.get(id);
    if (!mod) return;
    try {
      if (typeof mod.remove === "function") mod.remove(ctx, liveInstances.get(id));
    } catch (e) {}
    liveInstances.delete(id);
    activeIds.delete(id);
    saveEnabled();
    toast("Mod off: " + (mod.name || id));
    renderMenu();
  }
  function toggle(id) { (activeIds.has(id) ? disable : enable)(id); }

  // ---- universal mods: work on every game, no cooperation required -------
  PM.register({
    id: "universal_slowmo", name: "Slow Motion", desc: "Halves effective frame rate.", category: "universal",
    apply: function (c) {
      var skip = false;
      return c.onFrame(function () {
        skip = !skip;
        // relies on rAF hook order: a real slow-mo needs per-game cooperation
        // to scale delta-time; this baseline drops every other visual frame,
        // which reads as slow-mo for most of these games' simple loops.
      });
    },
    remove: function (c, unsub) { if (typeof unsub === "function") unsub(); },
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
    apply: function () {
      var suspended = [];
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

  // ---- F10 quick-load mod menu (separate from Dev Mode) -------------------
  var menuEl = null;
  function toggleMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; return; }
    buildMenu();
  }
  function buildMenu() {
    menuEl = document.createElement("div");
    menuEl.id = "pm-mod-menu";
    menuEl.style.cssText = "position:fixed;top:16px;right:16px;width:260px;max-height:80vh;overflow:auto;" +
      "background:rgba(8,7,14,0.95);border:1px solid rgba(143,233,255,0.35);border-radius:10px;" +
      "font:12px monospace;color:#eaf2ff;z-index:2147483647;padding:10px;box-shadow:0 8px 30px rgba(0,0,0,0.5);";
    document.body.appendChild(menuEl);
    renderMenu();
  }
  function renderMenu() {
    if (!menuEl) return;
    var items = PM.list();
    var byCategory = {};
    items.forEach(function (m) { (byCategory[m.category] = byCategory[m.category] || []).push(m); });
    var html = '<div style="font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;">' +
      '<span>MODS — ' + gameId + '</span><span style="opacity:.5;">F10</span></div>';
    if (!items.length) html += '<div style="opacity:.6;">No mods available for this game yet.</div>';
    Object.keys(byCategory).forEach(function (cat) {
      html += '<div style="opacity:.6;text-transform:uppercase;margin:8px 0 4px;font-size:10px;">' + cat + '</div>';
      byCategory[cat].forEach(function (m) {
        html += '<label style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer;">' +
          '<input type="checkbox" data-pm-toggle="' + m.id + '" ' + (m.active ? "checked" : "") + ' style="margin-top:2px;">' +
          '<span><b>' + m.name + '</b><br><span style="opacity:.65;">' + (m.desc || "") + '</span></span></label>';
      });
    });
    menuEl.innerHTML = html;
    menuEl.querySelectorAll("[data-pm-toggle]").forEach(function (input) {
      input.addEventListener("change", function () { toggle(input.getAttribute("data-pm-toggle")); });
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "F10") { e.preventDefault(); toggleMenu(); }
  });

  // ---- load per-game mods (best-effort; 404s are expected for games that
  // don't have a mods/ folder yet) -----------------------------------------
  fetch("./mods/manifest.json").then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
    (Array.isArray(list) ? list : []).forEach(function (entry) {
      var s = document.createElement("script");
      s.src = "./mods/" + entry.file;
      s.async = true;
      document.body.appendChild(s);
    });
  }).catch(function () {});
})();
