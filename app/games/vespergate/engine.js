/* VESPERGATE: THE HOLLOW GEOMETRY — engine.js
 * Foundations: canvas scaling, input (keyboard/mouse/gamepad), WebAudio with
 * two distinct hand voices + adaptive music layers, versioned saves, settings,
 * camera, math. No external assets, no network — everything synthesized.
 */
"use strict";
window.VG = window.VG || {};
(() => {
  const VG = window.VG;

  /* ============ canvas: 640x360 logical space, high-density output ============ */
  VG.W = 640; VG.H = 360; VG.TILE = 16;
  const cv = document.getElementById("vg");
  const ctx = cv.getContext("2d", { alpha: false });
  cv.tabIndex = 0;
  VG.renderScale = 1;
  VG.cv = cv; VG.ctx = ctx;

  function configureContext() {
    ctx.imageSmoothingEnabled = false;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }
  function setLogicalTransform(x = 0, y = 0) {
    const rs = VG.renderScale || 1;
    ctx.setTransform(rs, 0, 0, rs, x * rs, y * rs);
  }
  VG.resetCanvasTransform = () => setLogicalTransform();

  function fit() {
    const viewportW = Math.max(1, document.documentElement.clientWidth || innerWidth);
    const viewportH = Math.max(1, document.documentElement.clientHeight || innerHeight);
    const cssScale = Math.max(0.35, Math.min(viewportW / VG.W, viewportH / VG.H));
    const cssW = Math.max(1, Math.floor(VG.W * cssScale));
    const cssH = Math.max(1, Math.floor(VG.H * cssScale));
    const density = VG.settings?.sharpRender === false ? 1 : Math.min(2, devicePixelRatio || 1);
    const backingScale = Math.max(1, Math.min(4, cssScale * density));
    const backingW = Math.round(VG.W * backingScale);
    const backingH = Math.round(VG.H * backingScale);

    cv.style.width = `${cssW}px`;
    cv.style.height = `${cssH}px`;
    cv.style.imageRendering = "auto";
    if (cv.width !== backingW || cv.height !== backingH) {
      cv.width = backingW;
      cv.height = backingH;
      VG.renderScale = backingW / VG.W;
      configureContext();
      setLogicalTransform();
    }

    const status = document.querySelector("[data-vg-status]");
    if (status) status.textContent = `Vespergate · ${VG.settings?.sharpRender === false ? "Classic" : "HD"} · ${Math.round(cssW)}×${Math.round(cssH)}`;
  }
  addEventListener("resize", () => fit());
  VG.fit = fit;

  /* ============ settings (persisted, accessibility-first) ============ */
  const SETTINGS_KEY = "vespergate.settings.v1";
  VG.settings = Object.assign({
    volume: 0.8, music: 0.7, shake: 1, flash: 1, motion: 1,
    snapStrength: 1, aimAssist: 0.5, softScale: false, sharpRender: true,
    reducedEffects: false, holdToCharge: true, damageTaken: 1, timingWindow: 1,
    lighting: 1,
  }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } })());
  VG.saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(VG.settings)); } catch {} };

  /* ============ fullscreen + lightweight game chrome ============ */
  let theaterMode = false;
  let fullscreenIntent = false;
  function syncFullscreenUi() {
    const active = fullscreenIntent || !!document.fullscreenElement || theaterMode;
    const btn = document.querySelector("[data-vg-fullscreen]");
    if (btn) {
      btn.textContent = active ? "EXIT FULL" : "FULLSCREEN";
      btn.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
      btn.title = active ? "Exit fullscreen (Alt+Enter)" : "Enter fullscreen (Alt+Enter)";
    }
    document.body.classList.toggle("is-vg-theater", theaterMode);
    requestAnimationFrame(fit);
  }
  VG.toggleFullscreen = async () => {
    const active = fullscreenIntent || !!document.fullscreenElement || theaterMode;
    try {
      if (active) {
        fullscreenIntent = false;
        if (document.fullscreenElement) await document.exitFullscreen();
        theaterMode = false;
      } else {
        fullscreenIntent = true;
        if (document.fullscreenEnabled && document.querySelector(".vg-app")?.requestFullscreen) {
          await document.querySelector(".vg-app").requestFullscreen({ navigationUI: "hide" });
          // Embedded browsers may resolve the request while declining native
          // fullscreen. Fall back to the same distraction-free game view.
          if (!document.fullscreenElement) theaterMode = true;
        } else {
          theaterMode = true;
        }
      }
    } catch {
      theaterMode = fullscreenIntent;
    }
    syncFullscreenUi();
    setTimeout(syncFullscreenUi, 300);
    setTimeout(syncFullscreenUi, 1000);
  };
  addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && !theaterMode) fullscreenIntent = false;
    syncFullscreenUi();
  });
  addEventListener("focus", syncFullscreenUi);

  /* ============ save (versioned, resumable) ============ */
  /* v2: the top-down Vesper Hand rebuild. v1 saves reference platformer rooms
     that no longer exist, so they are deliberately not migrated. */
  const SAVE_KEY = "vespergate.save.v2";
  VG.save = {
    read() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); return s && s.version === 2 ? s : null; } catch { return null; } },
    write(data) { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 2, at: Date.now(), ...data })); } catch {} },
    clear() { try { localStorage.removeItem(SAVE_KEY); } catch {} },
  };

  /* ============ input ============ */
  const keys = new Set();
  VG.input = {
    keys,
    mx: VG.W / 2, my: VG.H / 2,           // mouse in internal coords
    fireHeld: false, gateHeld: false,
    pad: null, padAim: { x: 1, y: 0 }, usingPad: false,
    pressed: new Set(),                     // edge-triggered this frame
  };
  addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "Enter") { e.preventDefault(); VG.toggleFullscreen(); return; }
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) VG.input.pressed.add(e.code);
    keys.add(e.code);
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  function toInternal(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * VG.W, y: (e.clientY - r.top) / r.height * VG.H };
  }
  addEventListener("pointermove", (e) => { const p = toInternal(e); VG.input.mx = p.x; VG.input.my = p.y; VG.input.usingPad = false; });
  addEventListener("pointerdown", (e) => {
    if (e.target !== cv) return;
    const p = toInternal(e); VG.input.mx = p.x; VG.input.my = p.y;
    if (e.button === 0) { VG.input.fireHeld = true; VG.input.pressed.add("M1"); }
    if (e.button === 2) { VG.input.gateHeld = true; VG.input.pressed.add("M2"); }
  });
  addEventListener("pointerup", (e) => {
    if (e.button === 0) VG.input.fireHeld = false;
    if (e.button === 2) VG.input.gateHeld = false;
  });
  addEventListener("blur", () => { keys.clear(); VG.input.fireHeld = false; VG.input.gateHeld = false; });
  const dz = (v) => Math.abs(v) < 0.18 ? 0 : v;
  let padPrev = {};
  VG.pollPad = () => {
    let pads = [];
    try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch { return; }
    const pad = pads.find((p) => p && p.connected);
    VG.input.pad = null;
    if (!pad) return;
    const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0);
    const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
    if (rx || ry) { VG.input.padAim = { x: rx, y: ry }; VG.input.usingPad = true; }
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const edge = (name, val) => { if (val && !padPrev[name]) VG.input.pressed.add(name); padPrev[name] = val; };
    edge("PadA", b(0)); edge("PadB", b(1)); edge("PadX", b(2)); edge("PadY", b(3));
    edge("PadLB", b(4)); edge("PadRB", b(5)); edge("PadStart", b(9)); edge("PadBack", b(8));
    VG.input.pad = {
      lx, ly, jump: b(0), dash: b(1), interact: b(2), vent: b(3),
      fire: b(6) || (pad.buttons[6] && pad.buttons[6].value > 0.4), gate: b(7) || (pad.buttons[7] && pad.buttons[7].value > 0.4),
      swapMode: b(4), swapGate: b(5),
    };
  };

  /* ============ audio: two hands, one cathedral ============ */
  const A = { ctx: null, master: null, musicBus: null, layers: {}, muted: false, started: false };
  VG.audio = A;
  function actx() {
    if (A.muted) return null;
    if (!A.ctx) {
      try {
        A.ctx = new AudioContext();
        A.master = A.ctx.createGain(); A.master.gain.value = VG.settings.volume; A.master.connect(A.ctx.destination);
        A.musicBus = A.ctx.createGain(); A.musicBus.gain.value = VG.settings.music * 0.5; A.musicBus.connect(A.master);
      } catch { return null; }
    }
    if (A.ctx.state === "suspended") A.ctx.resume().catch(() => {});
    return A.ctx;
  }
  VG.unlockAudio = () => { actx(); startMusic(); };
  let noiseBuf = null;
  function noise(ctx2) {
    if (!noiseBuf) {
      noiseBuf = ctx2.createBuffer(1, ctx2.sampleRate * 0.6, ctx2.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  // Left hand: percussive ash. Sharp transient + filtered noise body.
  VG.sfxCinder = (kind = "needle") => {
    const c = actx(); if (!c) return;
    try {
      const t0 = c.currentTime;
      const src = c.createBufferSource(); src.buffer = noise(c);
      const f = c.createBiquadFilter(); f.type = "bandpass";
      f.frequency.value = kind === "orb" ? 240 : 1500; f.Q.value = 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(kind === "orb" ? 0.22 : 0.14, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + (kind === "orb" ? 0.4 : 0.09));
      src.connect(f).connect(g).connect(A.master);
      src.start(t0); src.stop(t0 + 0.5);
      const o = c.createOscillator(); o.type = "sawtooth";
      o.frequency.setValueAtTime(kind === "orb" ? 70 : 190, t0);
      o.frequency.exponentialRampToValueAtTime(40, t0 + 0.08);
      const og = c.createGain(); og.gain.setValueAtTime(0.06, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
      o.connect(og).connect(A.master); o.start(t0); o.stop(t0 + 0.12);
    } catch {}
  };
  // Right hand: harmonic glass. Reversed swell + interval chord per endpoint.
  VG.sfxGate = (endpoint, action = "open") => {
    const c = actx(); if (!c) return;
    try {
      const t0 = c.currentTime;
      const base = endpoint === 0 ? 392 : 311.1; // Dawn G4, Dusk Eb4 — identity by pitch, not color
      const ratios = action === "invalid" ? [1, 1.06] : endpoint === 0 ? [1, 1.5, 2] : [1, 1.19, 1.78];
      ratios.forEach((r, i) => {
        const o = c.createOscillator(); o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = base * r;
        const g = c.createGain();
        const dur = action === "close" ? 0.25 : action === "cross" ? 0.16 : 0.5;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(action === "invalid" ? 0.05 : 0.07 / (i + 1), t0 + (action === "open" ? 0.12 : 0.02));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(A.master); o.start(t0); o.stop(t0 + dur + 0.05);
      });
    } catch {}
  };
  VG.sfx = (freq, dur = 0.1, type = "sine", vol = 0.06) => {
    const c = actx(); if (!c) return;
    try {
      const t0 = c.currentTime;
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(A.master); o.start(t0); o.stop(t0 + dur + 0.03);
    } catch {}
  };
  VG.sfxBell = (freq = 98, vol = 0.16) => {
    const c = actx(); if (!c) return;
    try {
      const t0 = c.currentTime;
      [1, 2.76, 5.4].forEach((r, i) => {
        const o = c.createOscillator(); o.type = "sine"; o.frequency.value = freq * r;
        const g = c.createGain(); g.gain.setValueAtTime(vol / (i * 1.8 + 1), t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2 - i * 0.5);
        o.connect(g).connect(A.master); o.start(t0); o.stop(t0 + 2.4);
      });
    } catch {}
  };
  // Adaptive music: three synth layers cross-faded by game state.
  function makeLayer(c, freqs, type, gainBase) {
    const g = c.createGain(); g.gain.value = 0; g.connect(A.musicBus);
    const oscs = freqs.map((f, i) => {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = gainBase / (i + 1);
      const lfo = c.createOscillator(); lfo.frequency.value = 0.06 + i * 0.03;
      const lg = c.createGain(); lg.gain.value = gainBase * 0.3;
      lfo.connect(lg).connect(og.gain);
      o.connect(og).connect(g); o.start(); lfo.start();
      return o;
    });
    return { gain: g, oscs };
  }
  function startMusic() {
    const c = actx(); if (!c || A.started) return;
    A.started = true;
    try {
      A.layers.drone = makeLayer(c, [49, 98, 147], "sine", 0.05);          // organ pedal
      A.layers.veil = makeLayer(c, [196, 246.9, 293.7], "triangle", 0.028); // exploration veil
      A.layers.threat = makeLayer(c, [58.3, 116.5, 174.6], "sawtooth", 0.02); // combat/boss
      A.layers.dread = makeLayer(c, [51.9, 52.3, 155.1], "sawtooth", 0.03); // near-unison beating — the Presence
      A.layers.drone.gain.gain.value = 1;
      A.layers.dread.gain.gain.value = 0;
    } catch { A.started = false; }
  }
  // Presence system: continuous fade (not a discrete state), so the drone
  // creeps in rather than snapping — 0..1 in, mapped to a subtler 0..0.8 out.
  VG.setDreadLevel = (v) => {
    if (!A.started || !A.ctx || !A.layers.dread) return;
    const t = A.ctx.currentTime;
    try { A.layers.dread.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.8, t, 2.5); } catch {}
  };
  // "held breath" cue on a dread tier-up: a brief hard duck, then recover.
  VG.duckMusic = (ms = 200) => {
    if (!A.started || !A.ctx || !A.musicBus) return;
    const t = A.ctx.currentTime, base = VG.settings.music * 0.5;
    try {
      A.musicBus.gain.cancelScheduledValues(t);
      A.musicBus.gain.setValueAtTime(A.musicBus.gain.value, t);
      A.musicBus.gain.linearRampToValueAtTime(0.02, t + 0.05);
      A.musicBus.gain.linearRampToValueAtTime(base, t + 0.05 + ms / 1000);
    } catch {}
  };
  // Rare non-diegetic footstep/breath, gated by the Presence system to high
  // dread + player standing still. Filtered noise burst, no melodic content.
  VG.sfxDreadStep = () => {
    const c = actx(); if (!c) return;
    try {
      const t0 = c.currentTime;
      const src = c.createBufferSource(); src.buffer = noise(c);
      const f = c.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(340, t0); f.frequency.exponentialRampToValueAtTime(120, t0 + 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
      src.connect(f).connect(g).connect(A.master);
      src.start(t0); src.stop(t0 + 0.65);
    } catch {}
  };
  VG.setMusicState = (state) => {
    if (!A.started || !A.ctx) return;
    const t = A.ctx.currentTime;
    const set = (layer, v) => { try { A.layers[layer].gain.gain.setTargetAtTime(v, t, 1.2); } catch {} };
    if (state === "explore") { set("drone", 1); set("veil", 0.9); set("threat", 0); }
    else if (state === "combat") { set("drone", 0.7); set("veil", 0.25); set("threat", 0.9); }
    else if (state === "boss") { set("drone", 1); set("veil", 0.1); set("threat", 1.4); }
    else if (state === "shrine") { set("drone", 0.8); set("veil", 1.2); set("threat", 0); }
  };
  function syncSoundUi() {
    const btn = document.querySelector("[data-vg-sound]");
    if (!btn) return;
    btn.textContent = A.muted ? "MUTED" : "SOUND";
    btn.setAttribute("aria-label", A.muted ? "Turn sound on" : "Mute sound");
    btn.title = A.muted ? "Turn sound on" : "Mute sound";
  }
  VG.setMuted = (m) => { A.muted = m; if (A.master) A.master.gain.value = m ? 0 : VG.settings.volume; syncSoundUi(); };
  VG.toggleMuted = () => VG.setMuted(!A.muted);

  /* ============ camera ============
     zoom lets a room that is SMALLER than the 640x360 logical viewport (e.g. a
     house interior) fill the screen instead of rendering pinned to the corner.
     zoom is a logical world->viewport scale; renderScale is the separate
     logical->device HD scale, and camera.apply composes the two. Large rooms
     stay at zoom 1 and scroll as before. */
  VG.camera = {
    x: 0, y: 0, tx: 0, ty: 0, shake: 0, zoom: 1,
    bounds: { x: 0, y: 0, w: VG.W, h: VG.H },
    // set room bounds and pick a zoom that makes the room COVER the viewport
    // (fills it; never zooms out for large rooms; capped so tiny rooms are sane)
    setRoom(pxW, pxH) {
      this.bounds = { x: 0, y: 0, w: pxW, h: pxH };
      const cover = Math.max(VG.W / pxW, VG.H / pxH);
      this.zoom = Math.min(3, Math.max(1, cover));
    },
    _clamp(target, min, size, view) {
      const maxV = min + size - view;
      if (maxV <= min) return min + (size - view) / 2;   // room <= view: center it
      return Math.max(min, Math.min(maxV, target));
    },
    follow(px, py, aimx, aimy, dt) {
      const look = VG.settings.motion * 24, z = this.zoom || 1;
      const vw = VG.W / z, vh = VG.H / z;
      this.tx = px + (aimx - px) / Math.max(1, vw) * look * 2 - vw / 2;
      this.ty = py - vh / 2 - 8;
      this.tx = this._clamp(this.tx, this.bounds.x, this.bounds.w, vw);
      this.ty = this._clamp(this.ty, this.bounds.y, this.bounds.h, vh);
      const k = 1 - Math.pow(0.0001, dt);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
      this.shake = Math.max(0, this.shake - dt * 3);
    },
    jolt(v) { this.shake = Math.min(1, this.shake + v * VG.settings.shake); },
    apply(ctx2) {
      const s = this.shake > 0 ? this.shake * 3 : 0;
      const k = (VG.renderScale || 1) * (this.zoom || 1);
      const ox = -(this.x + (s ? (Math.random() - 0.5) * s : 0));
      const oy = -(this.y + (s ? (Math.random() - 0.5) * s : 0));
      ctx2.setTransform(k, 0, 0, k, Math.round(ox * k), Math.round(oy * k));
    },
    reset(ctx2) { const rs = VG.renderScale || 1; ctx2.setTransform(rs, 0, 0, rs, 0, 0); },
    snapTo(px, py) {
      const z = this.zoom || 1, vw = VG.W / z, vh = VG.H / z;
      this.tx = this._clamp(px - vw / 2, this.bounds.x, this.bounds.w, vw);
      this.ty = this._clamp(py - vh / 2 - 8, this.bounds.y, this.bounds.h, vh);
      this.x = this.tx; this.y = this.ty;
    },
    // logical screen coords (0..VG.W, 0..VG.H) -> world coords
    screenToWorld(sx, sy) { const z = this.zoom || 1; return { x: this.x + sx / z, y: this.y + sy / z }; },
  };

  /* ============ math ============ */
  VG.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  VG.lerp = (a, b, t) => a + (b - a) * t;
  VG.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
})();
