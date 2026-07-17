/* BeatStrike — full-keyboard tap/hold rhythm game, driven by Web Audio's
 * sample-accurate clock so visuals never drift from the beat (the
 * classic "schedule ahead using AudioContext.currentTime" pattern, not
 * setTimeout/rAF timing, which jitters). No words, no lyrics — every
 * note is just a letter key on a beat.
 *
 * Real songs: this ships with a synthesized click track (kick + hihat)
 * so it's fully self-contained and needs no audio assets. To use a real
 * song, provide an actual audio file + a matching beatmap (note
 * timings) — replace AudioScheduler's synthesized _scheduleBeat() with
 * an <audio>/AudioBufferSourceNode playing the real file, and swap
 * generateBeatmap() for a hand-authored or beat-detected note list
 * timed to that file. Can't be wired up sight-unseen since the actual
 * song files live on the user's own machine, not anywhere reachable
 * from here.
 */
(function () {
  "use strict";

  // PhantomPlay host protocol — every built-in game hand-rolls this the
  // same way: postMessage 'ready' once interactive, report score/progress/
  // complete, and react to pause/resume/restart/exit/settings from the host.
  const host = (type, data = {}) => parent.postMessage({ source: "phantomplay-game", type, ...data }, "*");

  // Generic object pool — avoids per-frame allocation in spawn-heavy hot
  // loops (particles, projectiles).
  class ObjectPool {
    constructor(factory, reset, initialSize = 0) {
      this.factory = factory; // () => T — creates a brand-new instance
      this.reset = reset;     // (T) => void — restores an instance to a clean, reusable state
      this.free = [];
      for (let i = 0; i < initialSize; i++) this.free.push(factory());
    }

    acquire() {
      return this.free.length ? this.free.pop() : this.factory();
    }

    release(obj) {
      this.reset(obj);
      this.free.push(obj);
    }

    get pooledCount() {
      return this.free.length;
    }
  }

  const BPM = 128;
  const BEAT_SEC = 60 / BPM;
  const SONG_BEATS = 96; // ~45s at 128bpm
  const LANES = 5;
  const NOTE_TRAVEL_SEC = 2.2; // how long a note is visible before it reaches the hit line
  const HIT_GOOD = 0.15, HIT_PERFECT = 0.06; // seconds of timing tolerance
  const ALPHABET = "qwertyuiopasdfghjklzxcvbnm".split("");

  // ---- deterministic PRNG (mulberry32) so the beatmap is reproducible/testable ----
  function makeRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickKey(rand, avoid) {
    let key;
    do { key = ALPHABET[Math.floor(rand() * ALPHABET.length)]; } while (key === avoid);
    return key;
  }

  function generateBeatmap(seed) {
    const rand = makeRandom(seed);
    const notes = [];
    let lastKey = null;
    let b = 4; // 4-beat lead-in before the first note
    while (b < SONG_BEATS) {
      const roll = rand();
      if (roll < 0.12 && b < SONG_BEATS - 2) {
        const key = pickKey(rand, lastKey);
        notes.push({ time: b * BEAT_SEC, key, type: "hold", duration: BEAT_SEC * 2, lane: Math.floor(rand() * LANES) });
        lastKey = key; b += 2; continue;
      }
      if (roll < 0.32) {
        const k1 = pickKey(rand, lastKey);
        notes.push({ time: b * BEAT_SEC, key: k1, type: "tap", lane: Math.floor(rand() * LANES) });
        const k2 = pickKey(rand, k1);
        notes.push({ time: b * BEAT_SEC + BEAT_SEC / 2, key: k2, type: "tap", lane: Math.floor(rand() * LANES) });
        lastKey = k2; b += 1; continue;
      }
      const key = pickKey(rand, lastKey);
      notes.push({ time: b * BEAT_SEC, key, type: "tap", lane: Math.floor(rand() * LANES) });
      lastKey = key; b += 1;
    }
    return notes.map((n) => ({ ...n, resolved: false, holding: false, judgement: null }));
  }

  // Gamepad mode plays a distinct 8-lane beatmap (A/B/X/Y + D-pad) instead
  // of filtering the 26-letter map down — a generator tuned for 8 lanes
  // plays better than a 26-letter map with most lanes silently skipped.
  const GAMEPAD_KEYS = ["gpUp", "gpDown", "gpLeft", "gpRight", "gpA", "gpB", "gpX", "gpY"];
  const GAMEPAD_GLYPH = { gpUp: "▲", gpDown: "▼", gpLeft: "◀", gpRight: "▶", gpA: "A", gpB: "B", gpX: "X", gpY: "Y" };
  function pickGpKey(rand, avoid) {
    let key;
    do { key = GAMEPAD_KEYS[Math.floor(rand() * GAMEPAD_KEYS.length)]; } while (key === avoid);
    return key;
  }
  function generateBeatmapGamepad(seed) {
    const rand = makeRandom(seed);
    const notes = [];
    let lastKey = null;
    let b = 4;
    while (b < SONG_BEATS) {
      const roll = rand();
      if (roll < 0.12 && b < SONG_BEATS - 2) {
        const key = pickGpKey(rand, lastKey);
        notes.push({ time: b * BEAT_SEC, key, type: "hold", duration: BEAT_SEC * 2, lane: Math.floor(rand() * LANES) });
        lastKey = key; b += 2; continue;
      }
      if (roll < 0.32) {
        const k1 = pickGpKey(rand, lastKey);
        notes.push({ time: b * BEAT_SEC, key: k1, type: "tap", lane: Math.floor(rand() * LANES) });
        const k2 = pickGpKey(rand, k1);
        notes.push({ time: b * BEAT_SEC + BEAT_SEC / 2, key: k2, type: "tap", lane: Math.floor(rand() * LANES) });
        lastKey = k2; b += 1; continue;
      }
      const key = pickGpKey(rand, lastKey);
      notes.push({ time: b * BEAT_SEC, key, type: "tap", lane: Math.floor(rand() * LANES) });
      lastKey = key; b += 1;
    }
    return notes.map((n) => ({ ...n, resolved: false, holding: false, judgement: null }));
  }

  // ---- sample-accurate synthesized click track ----
  class AudioScheduler {
    constructor(ctx) {
      this.ctx = ctx;
      this.lookahead = 0.12;
      this.pollMs = 25;
      this.timerId = null;
    }
    start(fromSongTime, songStartTimeRef) {
      this.songStartTimeRef = songStartTimeRef;
      this.nextBeatIndex = Math.ceil(fromSongTime / BEAT_SEC);
      this.timerId = setInterval(() => this._tick(), this.pollMs);
    }
    stop() { if (this.timerId) clearInterval(this.timerId); this.timerId = null; }
    _tick() {
      const horizon = this.ctx.currentTime + this.lookahead;
      while (this.songStartTimeRef.value + this.nextBeatIndex * BEAT_SEC < horizon) {
        const t = this.songStartTimeRef.value + this.nextBeatIndex * BEAT_SEC;
        if (t >= this.ctx.currentTime) this._scheduleBeat(t, this.nextBeatIndex);
        this.nextBeatIndex++;
      }
    }
    _scheduleBeat(time, index) {
      const downbeat = index % 4 === 0;
      this._blip(time, downbeat ? 90 : 140, downbeat ? 0.3 : 0.14, downbeat ? 0.2 : 0.09);
      this._blip(time + BEAT_SEC / 2, 2200, 0.05, 0.05, true);
    }
    _blip(time, freq, peak, dur, hihat) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = hihat ? "square" : "sine";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(peak, time + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur + 0.02);
    }
  }

  // ---- game state ----
  const canvas = document.getElementById("stage");
  const ctx2d = canvas.getContext("2d");
  const scoreEl = document.querySelector("[data-score]");
  const streakEl = document.querySelector("[data-streak]");
  const accEl = document.querySelector("[data-acc]");
  const startOverlay = document.querySelector("[data-start-overlay]");
  const startBtn = document.querySelector("[data-start-btn]");
  const pauseOverlay = document.querySelector("[data-pause-overlay]");
  const pauseTitle = document.querySelector("[data-pause-title]");
  const keyEls = {};
  document.querySelectorAll("[data-key]").forEach((el) => { keyEls[el.dataset.key] = el; });

  let audioCtx = null, scheduler = null;
  let songStartTimeRef = { value: 0 };
  let notes = [];
  let running = false, paused = false, pausedSongTime = 0;
  let score = 0, streak = 0, resolvedCount = 0, creditedCount = 0;
  let holdingKey = null; // { note } currently being held

  const sparkPool = new ObjectPool(
    () => ({ x: 0, y: 0, life: 0, max: 0, color: "" }),
    (s) => { s.life = 0; },
    32
  );
  const activeSparks = [];

  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  function laneX(lane) {
    const w = innerWidth;
    const margin = w * 0.12;
    return margin + ((w - margin * 2) / (LANES - 1)) * lane;
  }
  const HIT_LINE_FRAC = 0.82;

  function songTime() {
    if (paused) return pausedSongTime;
    return audioCtx.currentTime - songStartTimeRef.value;
  }

  function updateHud() {
    scoreEl.textContent = Math.round(score);
    streakEl.textContent = streak;
    accEl.textContent = resolvedCount ? `${Math.round((creditedCount / resolvedCount) * 100)}%` : "100%";
  }

  function judgeHit(note, dt) {
    const abs = Math.abs(dt);
    if (abs <= HIT_PERFECT) return "perfect";
    if (abs <= HIT_GOOD) return "good";
    return null;
  }

  function resolveNote(note, judgement) {
    note.resolved = true;
    note.judgement = judgement;
    resolvedCount++;
    if (judgement === "perfect") { score += 300; streak++; creditedCount++; }
    else if (judgement === "good") { score += 100; streak++; creditedCount++; }
    else { streak = 0; }
    spawnSpark(note, judgement);
    updateHud();
    host("score", { score: Math.round(score), state: { streak, judgement } });
  }

  function spawnSpark(note, judgement) {
    const s = sparkPool.acquire();
    s.x = laneX(note.lane);
    s.y = innerHeight * HIT_LINE_FRAC;
    s.life = 0; s.max = 0.4;
    s.color = judgement === "perfect" ? "65,255,161" : judgement === "good" ? "30,240,255" : "255,77,99";
    activeSparks.push(s);
  }

  function flashKey(key, cls) {
    const el = keyEls[key];
    if (!el) return;
    el.classList.add(cls);
    if (cls === "active") setTimeout(() => el.classList.remove("active"), 110);
  }

  // Shared by keyboard and gamepad input — both funnel into the same
  // key-namespace note resolution. Keyboard uses real single letters;
  // gamepad uses prefixed symbolic keys (gpUp/gpA/...) that can never
  // collide with a literal keypress, so both sources can coexist safely.
  function pressKey(key) {
    if (!running || paused) return;
    flashKey(key, "active");
    const t = songTime();
    // Nearest unresolved note for this key within the hit window.
    let best = null, bestDt = Infinity;
    for (const n of notes) {
      if (n.resolved || n.key !== key) continue;
      const dt = t - n.time;
      if (Math.abs(dt) < Math.abs(bestDt) && Math.abs(dt) <= HIT_GOOD + 0.05) { best = n; bestDt = dt; }
    }
    if (!best) return;

    if (best.type === "tap") {
      const j = judgeHit(best, bestDt);
      resolveNote(best, j);
    } else if (best.type === "hold") {
      holdingKey = { note: best, downAt: t };
      flashKey(key, "hold-active");
    }
  }

  function releaseKey(key) {
    const el = keyEls[key];
    if (el) el.classList.remove("hold-active");
    if (holdingKey && holdingKey.note.key === key && !holdingKey.note.resolved) {
      const note = holdingKey.note;
      const endTime = note.time + note.duration;
      const t = songTime();
      const j = t >= endTime - HIT_GOOD ? (t <= endTime + HIT_GOOD ? "good" : null) : null;
      // held long enough (within tolerance of the note's end) = credited; released early = miss
      resolveNote(note, j || (t < endTime - HIT_GOOD ? null : "good"));
      holdingKey = null;
    }
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "p" || key === "escape") { togglePause(); return; }
    if (usingGamepadMap) return; // a gamepad beatmap is active — ignore literal keys to avoid ambiguity
    if (!ALPHABET.includes(key)) return;
    pressKey(key);
  }

  function onKeyUp(e) {
    if (usingGamepadMap) return;
    releaseKey(e.key.toLowerCase());
  }

  // --- Gamepad (PhantomPlay standard mapping): A/B/X/Y + D-pad = the 8 lanes ---
  let gpEnabled = false, usingGamepadMap = false;
  const gpPrev = {};
  function gpPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) if (pads[i]) return pads[i];
    return null;
  }
  function gpPoll() {
    if (!usingGamepadMap) return;
    const pad = gpPad();
    if (!pad) return;
    const b = pad.buttons, ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const states = {
      gpUp: !!(b[12] && b[12].pressed) || ay < -0.5,
      gpDown: !!(b[13] && b[13].pressed) || ay > 0.5,
      gpLeft: !!(b[14] && b[14].pressed) || ax < -0.5,
      gpRight: !!(b[15] && b[15].pressed) || ax > 0.5,
      gpA: !!(b[0] && b[0].pressed),
      gpB: !!(b[1] && b[1].pressed),
      gpX: !!(b[2] && b[2].pressed),
      gpY: !!(b[3] && b[3].pressed),
    };
    for (const key of GAMEPAD_KEYS) {
      const now = states[key], was = !!gpPrev[key];
      if (now && !was) pressKey(key);
      else if (!now && was) releaseKey(key);
      gpPrev[key] = now;
    }
  }
  (function gpLoop() { gpPoll(); requestAnimationFrame(gpLoop); })();

  function setPaused(next) {
    if (!running || paused === next) return;
    paused = next;
    pauseOverlay.hidden = !paused;
    if (paused) {
      pausedSongTime = audioCtx.currentTime - songStartTimeRef.value;
      audioCtx.suspend();
      pauseTitle.textContent = "Paused";
    } else {
      audioCtx.resume().then(() => {
        songStartTimeRef.value = audioCtx.currentTime - pausedSongTime;
        scheduler.start(pausedSongTime, songStartTimeRef);
      });
    }
    host("paused", { paused });
  }

  function togglePause() {
    setPaused(!paused);
  }

  function autoMissSweep(t) {
    for (const n of notes) {
      if (n.resolved) continue;
      const endTime = n.type === "hold" ? n.time + n.duration : n.time;
      if (t > endTime + HIT_GOOD + 0.02) resolveNote(n, null);
    }
  }

  function render(t) {
    ctx2d.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx2d.clearRect(0, 0, innerWidth, innerHeight);

    const hitY = innerHeight * HIT_LINE_FRAC;
    ctx2d.strokeStyle = "rgba(255,209,102,0.7)";
    ctx2d.lineWidth = 2;
    ctx2d.beginPath(); ctx2d.moveTo(0, hitY); ctx2d.lineTo(innerWidth, hitY); ctx2d.stroke();

    for (const n of notes) {
      const dt = n.time - t;
      if (dt > NOTE_TRAVEL_SEC || (n.resolved && n.judgement !== null && dt < -0.3)) continue;
      if (n.resolved && dt < -0.05) continue;
      const progress = 1 - dt / NOTE_TRAVEL_SEC; // 0 at spawn, 1 at hit line
      if (progress < 0) continue;
      const y = progress * hitY;
      const x = laneX(n.lane);
      const holding = holdingKey && holdingKey.note === n;

      if (n.type === "hold") {
        const endDt = (n.time + n.duration) - t;
        const endProgress = 1 - endDt / NOTE_TRAVEL_SEC;
        const endY = Math.min(hitY, endProgress * hitY);
        ctx2d.fillStyle = holding ? "rgba(255,209,102,0.55)" : "rgba(255,209,102,0.28)";
        ctx2d.fillRect(x - 12, Math.min(y, endY), 24, Math.abs(endY - Math.min(y, hitY)));
      }
      ctx2d.beginPath();
      ctx2d.arc(x, y, 17, 0, Math.PI * 2);
      ctx2d.fillStyle = n.resolved ? "rgba(255,255,255,0.08)" : (n.type === "hold" ? "#ffd166" : "#ff3d94");
      ctx2d.fill();
      ctx2d.strokeStyle = "rgba(255,255,255,0.5)";
      ctx2d.stroke();
      if (!n.resolved) {
        ctx2d.fillStyle = "#05030a";
        ctx2d.font = "700 14px 'DM Mono', monospace";
        ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
        ctx2d.fillText(GAMEPAD_GLYPH[n.key] || n.key.toUpperCase(), x, y + 1);
      }
    }

    for (let i = activeSparks.length - 1; i >= 0; i--) {
      const s = activeSparks[i];
      s.life += 1 / 60;
      if (s.life > s.max) { activeSparks.splice(i, 1); sparkPool.release(s); continue; }
      const a = 1 - s.life / s.max;
      const r = 17 + s.life * 60;
      ctx2d.beginPath(); ctx2d.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx2d.strokeStyle = `rgba(${s.color},${a})`; ctx2d.lineWidth = 3; ctx2d.stroke();
    }
  }

  function frame() {
    if (!running) return;
    if (!paused) {
      const t = songTime();
      autoMissSweep(t);
      render(t);
      if (t > SONG_BEATS * BEAT_SEC + 2) { finish(); return; }
    }
    requestAnimationFrame(frame);
  }

  function finish() {
    running = false;
    scheduler.stop();
    startOverlay.hidden = false;
    startOverlay.querySelector("h2").textContent = "Song Complete";
    startOverlay.querySelector("p").innerHTML = `Final score <b>${Math.round(score)}</b> · best streak tracked live above · accuracy ${resolvedCount ? Math.round((creditedCount / resolvedCount) * 100) : 100}%.`;
    startOverlay.querySelector("button").textContent = "▶ Play again";
    host("complete", { score: Math.round(score), progress: 100, state: { accuracy: resolvedCount ? Math.round((creditedCount / resolvedCount) * 100) : 100 } });
  }

  function start() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    usingGamepadMap = gpEnabled && !!gpPad();
    notes = usingGamepadMap ? generateBeatmapGamepad(1337) : generateBeatmap(1337);
    score = 0; streak = 0; resolvedCount = 0; creditedCount = 0;
    running = true; paused = false; pauseOverlay.hidden = true;
    updateHud();
    songStartTimeRef = { value: audioCtx.currentTime + 0.6 };
    scheduler = new AudioScheduler(audioCtx);
    scheduler.start(0, songStartTimeRef);
    startOverlay.hidden = true;
    requestAnimationFrame(frame);
  }

  function restartGame() {
    if (running) { running = false; scheduler.stop(); }
    start();
  }

  startBtn.addEventListener("click", start);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  // Host <-> game protocol: the PhantomPlay shell posts these once the
  // iframe is mounted; without a 'ready' reply the shell's watchdog treats
  // the game as unresponsive after 12s.
  window.addEventListener("message", (evt) => {
    const d = evt.data;
    if (!d || d.source !== "phantomplay-host") return;
    if (d.type === "settings") gpEnabled = !!d.gamepad;
    else if (d.type === "pause") setPaused(true);
    else if (d.type === "resume") setPaused(false);
    else if (d.type === "restart") restartGame();
    else if (d.type === "exit") { if (running) { running = false; scheduler.stop(); } }
  });
  host("ready");

  window.__beatStrikeDebug = { generateBeatmap, get score() { return score; }, get resolvedCount() { return resolvedCount; }, get creditedCount() { return creditedCount; } };
})();
