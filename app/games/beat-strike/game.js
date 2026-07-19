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
  // Note-speed setting = approach time (seconds a note is visible before the
  // hit line). Longer travel = slower, more readable notes. Persisted.
  const NOTE_SPEEDS = { slow: 3.0, standard: 2.2, fast: 1.55 };
  let noteSpeedName = "standard";
  try {
    const saved = localStorage.getItem("pf.beatstrike.notespeed");
    if (saved && NOTE_SPEEDS[saved]) noteSpeedName = saved;
  } catch (err) { /* storage unavailable in some embeds */ }
  let noteTravelSec = NOTE_SPEEDS[noteSpeedName];
  const HIT_GOOD = 0.15, HIT_PERFECT = 0.06; // seconds of timing tolerance
  const ALPHABET = "qwertyuiopasdfghjklzxcvbnm".split("");

  // Fixed key→lane mapping by physical keyboard column (two QWERTY columns
  // per lane) so the on-screen guide and the falling lanes always agree:
  // Q/A/Z + W/S/X = lane 1 … O/L + P = lane 5.
  const KEY_COLS = ["qaz", "wsx", "edc", "rfv", "tgb", "yhn", "ujm", "ik", "ol", "p"];
  const KEY_LANE = {};
  const LANE_KEYS = Array.from({ length: LANES }, () => []); // keys sharing each lane, in guide order
  KEY_COLS.forEach((col, i) => {
    const lane = Math.min(LANES - 1, Math.floor(i / 2));
    for (const k of col) { KEY_LANE[k] = lane; LANE_KEYS[lane].push(k); }
  });
  // Up to 6 different letters share one lane (see LANE_KEYS above), so lane
  // color alone can't tell them apart — the start-screen promise that keys
  // are "color-matched to their lane" was only true at the lane level.
  // KEY_SLOT/KEY_SLOT_COUNT record each key's position within its lane's key
  // list; used below to give every key its own shade of the lane color and a
  // small fixed x-offset, so within-lane keys are actually distinguishable at
  // a glance instead of stacking identically (see tintTriple() and laneX()).
  const KEY_SLOT = {}, KEY_SLOT_COUNT = {};
  LANE_KEYS.forEach((keys) => keys.forEach((k, idx) => { KEY_SLOT[k] = idx; KEY_SLOT_COUNT[k] = keys.length; }));
  const LANE_COLORS = ["#41ffa1", "#1ef0ff", "#ffd166", "#ff3d94", "#c084fc"];
  const LANE_COLORS_RGB = ["65,255,161", "30,240,255", "255,209,102", "255,61,148", "192,132,252"];
  // Per-key color = the lane's base color tinted lighter/darker by slot, so
  // e.g. Q (lane 0, slot 0) and X (lane 0, slot 3) render as visibly
  // different shades of the same lane hue rather than the identical color.
  function tintTriple(rgbCsv, slot, count) {
    const [r, g, b] = rgbCsv.split(",").map(Number);
    if (count <= 1) return [r, g, b];
    const mid = (count - 1) / 2;
    const amt = (slot - mid) / mid; // -1 (earliest slot) .. +1 (latest slot)
    const mix = Math.min(0.45, Math.abs(amt) * 0.45);
    const toward = amt >= 0 ? 255 : 0;
    return [r, g, b].map((c) => Math.round(c + (toward - c) * mix));
  }
  const KEY_COLOR_RGB = {}, KEY_COLOR = {};
  for (const k of ALPHABET) {
    const [r, g, b] = tintTriple(LANE_COLORS_RGB[KEY_LANE[k]], KEY_SLOT[k], KEY_SLOT_COUNT[k]);
    KEY_COLOR_RGB[k] = `${r},${g},${b}`;
    KEY_COLOR[k] = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

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

  // ---- learnable phrase-based key patterns ----
  // Previously every note's key came from a uniform random distribution
  // over all 26 letters (only constrained to not repeat the immediately
  // previous key) — that produces no learnable structure at all. Instead,
  // the letter beatmap cycles through small "clusters" of keys — home-row
  // anchors, then the full home row, then the top row, then the bottom row —
  // and repeats a short hand-authored index-pattern within each cluster for
  // a whole phrase before rotating to the next cluster and a new pattern.
  // This mirrors the sibling game keyboardist-on-tour.html's lanePattern
  // approach (small repeating index arrays cycled over a handful of lanes),
  // adapted here to letters instead of lanes so "every letter key is live"
  // stays the core hook while still being genuinely learnable: within any
  // few-second window there's a literal repeating riff, and the full track
  // still touches every one of the 26 letters as the clusters rotate.
  const KEY_CLUSTERS = [
    ["f", "j"],                                    // two-key anchor phrase
    ["f", "j", "d", "k"],                           // expand to four fingers
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],  // full home row
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], // top row
    ["z", "x", "c", "v", "b", "n", "m"],            // bottom row
  ];
  // Beat-budget share of each cluster above (sums to 1) — earlier/smaller
  // clusters get a shorter phrase since there's less to learn, later ones
  // get more room since they cover more letters.
  const CLUSTER_WEIGHTS = [0.10, 0.14, 0.22, 0.30, 0.24];
  // Small library of hand-authored index-patterns (analogous to
  // lanePattern), reused for whichever cluster is active. Adjacent entries
  // are chosen to avoid back-to-back repeats of the same index.
  const INDEX_PATTERNS = [
    [0, 1, 0, 1, 1, 0, 1, 0],
    [0, 1, 2, 1, 0, 1, 2, 1],
    [0, 1, 2, 3, 2, 1, 0, 3],
    [0, 2, 1, 3, 0, 2, 1, 3],
    [0, 1, 2, 3, 4, 3, 2, 1, 0],
    [0, 2, 4, 1, 3, 2, 0, 4],
    [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 5],
    [0, 3, 1, 4, 2, 5, 6, 3, 0],
  ];

  function generateBeatmap(seed) {
    const rand = makeRandom(seed);
    const notes = [];
    let lastKey = null;
    let b = 4; // 4-beat lead-in before the first note

    // Precompute the beat at which each cluster's phrase ends, from
    // CLUSTER_WEIGHTS, so cluster rotation is deterministic for a given seed.
    const totalBeats = SONG_BEATS - b;
    let acc = 0;
    const clusterEndBeat = CLUSTER_WEIGHTS.map((w) => { acc += w; return b + Math.round(totalBeats * acc); });
    clusterEndBeat[clusterEndBeat.length - 1] = SONG_BEATS; // avoid rounding leaving a sliver unassigned

    let clusterIdx = 0;
    let pattern = INDEX_PATTERNS[Math.floor(rand() * INDEX_PATTERNS.length)];
    let cursor = 0;
    // Letters in the active cluster the pattern hasn't produced yet this
    // phrase (INDEX_PATTERNS' index range doesn't always span a whole
    // cluster — e.g. the 10-letter top row can't be reached past index 6 by
    // some patterns via modulo alone). Tracked so every letter in a cluster
    // gets a guaranteed appearance before its phrase ends.
    let unseenQueue = KEY_CLUSTERS[0].slice();

    function nextPatternKey(cluster) {
      let idx = pattern[cursor % pattern.length] % cluster.length;
      let key = cluster[idx];
      if (key === lastKey && cluster.length > 1) {
        cursor++;
        idx = pattern[cursor % pattern.length] % cluster.length;
        key = cluster[idx];
      }
      cursor++;
      return key;
    }

    // Picks the next key for the active cluster: mostly the repeating
    // pattern above (so a player can learn and anticipate it), but once a
    // phrase reaches its final stretch it sweeps through any cluster
    // letters the pattern hasn't used yet — a short guaranteed-coverage
    // run/fill leading into the next section, the same way a real riff
    // often resolves with a quick run before the next section starts.
    function takeKey(cluster, sweeping) {
      // Re-check unseenQueue.length here (not just trust the passed flag):
      // a double-tap note takes two keys per iteration, and the first call
      // can drain the queue empty before the second call runs.
      const key = (sweeping && unseenQueue.length > 0)
        ? (unseenQueue[0] === lastKey && unseenQueue.length > 1 ? unseenQueue[1] : unseenQueue[0])
        : nextPatternKey(cluster);
      const qi = unseenQueue.indexOf(key);
      if (qi !== -1) unseenQueue.splice(qi, 1);
      return key;
    }

    while (b < SONG_BEATS) {
      // Phrase boundary: once the active cluster's beat budget is spent,
      // rotate to the next cluster and pick a fresh pattern for it.
      if (clusterIdx < KEY_CLUSTERS.length - 1 && b >= clusterEndBeat[clusterIdx]) {
        clusterIdx++;
        cursor = 0;
        pattern = INDEX_PATTERNS[Math.floor(rand() * INDEX_PATTERNS.length)];
        unseenQueue = KEY_CLUSTERS[clusterIdx].slice();
      }
      const cluster = KEY_CLUSTERS[clusterIdx];
      const beatsLeftInPhrase = clusterEndBeat[clusterIdx] - b;
      // A hold note spends 2 beats to cover only 1 letter, which can starve
      // the coverage sweep of the beats it needs — so once we're sweeping,
      // stick to (single- or double-) taps that spend 1 beat per letter.
      const sweeping = unseenQueue.length > 0 && beatsLeftInPhrase <= unseenQueue.length + 1;

      const roll = rand();
      if (!sweeping && roll < 0.12 && b < SONG_BEATS - 2) {
        const key = takeKey(cluster, sweeping);
        notes.push({ time: b * BEAT_SEC, key, type: "hold", duration: BEAT_SEC * 2, lane: KEY_LANE[key] });
        lastKey = key; b += 2; continue;
      }
      if (roll < 0.32) {
        const k1 = takeKey(cluster, sweeping);
        notes.push({ time: b * BEAT_SEC, key: k1, type: "tap", lane: KEY_LANE[k1] });
        lastKey = k1;
        const k2 = takeKey(cluster, sweeping);
        notes.push({ time: b * BEAT_SEC + BEAT_SEC / 2, key: k2, type: "tap", lane: KEY_LANE[k2] });
        lastKey = k2; b += 1; continue;
      }
      const key = takeKey(cluster, sweeping);
      notes.push({ time: b * BEAT_SEC, key, type: "tap", lane: KEY_LANE[key] });
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
  const keyboardEl = document.querySelector("[data-keyboard]");
  const speedBtns = Array.from(document.querySelectorAll("[data-speed]"));
  const guideBtn = document.querySelector("[data-guide-toggle]");
  const keyEls = {};
  document.querySelectorAll("[data-key]").forEach((el) => { keyEls[el.dataset.key] = el; });

  // ---- settings UI: note speed + keyboard guide visibility ----
  function setNoteSpeed(name, persist) {
    if (!NOTE_SPEEDS[name]) return;
    noteSpeedName = name;
    noteTravelSec = NOTE_SPEEDS[name];
    for (const b of speedBtns) b.setAttribute("aria-pressed", String(b.dataset.speed === name));
    if (persist) try { localStorage.setItem("pf.beatstrike.notespeed", name); } catch (err) { /* ignore */ }
  }
  speedBtns.forEach((b) => b.addEventListener("click", () => setNoteSpeed(b.dataset.speed, true)));
  setNoteSpeed(noteSpeedName, false);

  // The key guide strip is fixed at the bottom and stays visible during play
  // by default — it never auto-hides. The only way it disappears is this
  // explicit settings toggle, which is persisted.
  let guideVisible = true;
  try { guideVisible = localStorage.getItem("pf.beatstrike.showguide") !== "0"; } catch (err) { /* ignore */ }
  function applyGuide(persist) {
    if (keyboardEl) keyboardEl.dataset.hidden = guideVisible ? "0" : "1";
    if (guideBtn) {
      guideBtn.setAttribute("aria-pressed", String(guideVisible));
      guideBtn.textContent = guideVisible ? "Shown" : "Hidden";
    }
    if (persist) try { localStorage.setItem("pf.beatstrike.showguide", guideVisible ? "1" : "0"); } catch (err) { /* ignore */ }
  }
  if (guideBtn) guideBtn.addEventListener("click", () => { guideVisible = !guideVisible; applyGuide(true); });
  applyGuide(false);

  // Color every guide key by its lane so the strip is a true key→lane map,
  // and make the keys playable touch targets (press/release = tap/hold).
  for (const [k, el] of Object.entries(keyEls)) {
    const lane = KEY_LANE[k];
    if (lane !== undefined) el.style.borderBottom = "3px solid " + (KEY_COLOR[k] || LANE_COLORS[lane]);
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); if (!usingGamepadMap) pressKey(k); });
    el.addEventListener("pointerup", () => { if (!usingGamepadMap) releaseKey(k); });
    el.addEventListener("pointercancel", () => { if (!usingGamepadMap) releaseKey(k); });
  }

  let audioCtx = null, scheduler = null;
  let songStartTimeRef = { value: 0 };
  let notes = [];
  let running = false, paused = false, pausedSongTime = 0;
  let score = 0, streak = 0, resolvedCount = 0, creditedCount = 0;
  let holdingKey = {}; // per-key map: key -> { note, downAt } currently being held.
  // A single shared variable would let pressing a second hold-note's key
  // while already holding a different one overwrite tracking and orphan the
  // first hold; keying by the actual key character keeps them independent
  // even if a future beatmap ever overlaps two holds (today's generator
  // never does, but this makes that safe rather than merely untested).

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

  function laneX(lane, key) {
    const w = innerWidth;
    const margin = w * 0.12;
    const pitch = (w - margin * 2) / (LANES - 1);
    const base = margin + pitch * lane;
    // Structural callers (lane dividers, receptor circles) omit `key` and
    // get the lane's canonical center. Note-specific callers pass the note's
    // key so keys sharing a lane get a small, fixed x-offset — combined with
    // per-key color tinting (KEY_COLOR), this keeps same-lane keys visually
    // distinct instead of stacking at an identical position.
    const count = key !== undefined ? (KEY_SLOT_COUNT[key] || 1) : 1;
    if (count <= 1) return base;
    const mid = (count - 1) / 2;
    const spread = Math.min(14, pitch * 0.16); // stay well inside the lane's own band
    return base + ((KEY_SLOT[key] - mid) / mid) * spread;
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

  // Hit/miss feedback tone — reuses the exact oscillator+gain envelope
  // approach as AudioScheduler._blip (short attack ramp, exponential decay)
  // so the feel matches the existing click track. Previously nothing fired
  // here at all: only the fixed background click track ever made sound,
  // so correct play felt unresponsive.
  function playFeedbackTone(judgement) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    let freq, peak, dur, type;
    if (judgement === "perfect") { freq = 1046.5; peak = 0.22; dur = 0.09; type = "triangle"; }
    else if (judgement === "good") { freq = 784; peak = 0.18; dur = 0.08; type = "triangle"; }
    else { freq = 150; peak = 0.1; dur = 0.13; type = "sine"; } // miss: quieter, lower thud
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function resolveNote(note, judgement) {
    note.resolved = true;
    note.judgement = judgement;
    resolvedCount++;
    if (judgement === "perfect") { score += 300; streak++; creditedCount++; }
    else if (judgement === "good") { score += 100; streak++; creditedCount++; }
    else { streak = 0; }
    playFeedbackTone(judgement);
    spawnSpark(note, judgement);
    updateHud();
    host("score", { score: Math.round(score), state: { streak, judgement } });
  }

  function spawnSpark(note, judgement) {
    const s = sparkPool.acquire();
    s.x = laneX(note.lane, note.key);
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
      holdingKey[key] = { note: best, downAt: t };
      flashKey(key, "hold-active");
    }
  }

  function releaseKey(key) {
    const el = keyEls[key];
    if (el) el.classList.remove("hold-active");
    const held = holdingKey[key];
    if (held && !held.note.resolved) {
      const note = held.note;
      const endTime = note.time + note.duration;
      const t = songTime();
      // Credited only if released within tolerance of the note's end;
      // anything outside that window — early OR late — is a genuine miss.
      // (Previously a buggy `j || (...)` fallback re-derived the result from
      // scratch and mistakenly credited "good" for a too-late release.)
      const j = (t >= endTime - HIT_GOOD && t <= endTime + HIT_GOOD) ? "good" : null;
      resolveNote(note, j);
      delete holdingKey[key];
    }
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "escape") { togglePause(); return; }
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
    const laneHalf = (innerWidth * 0.76) / (LANES - 1) / 2;

    // Lane separation: a faint tinted column per lane plus divider lines,
    // so "which lane is this note in" is readable at a glance.
    for (let l = 0; l < LANES; l++) {
      const x = laneX(l);
      ctx2d.fillStyle = `rgba(${LANE_COLORS_RGB[l]},0.045)`;
      ctx2d.fillRect(x - laneHalf + 3, 0, laneHalf * 2 - 6, hitY);
      ctx2d.strokeStyle = `rgba(${LANE_COLORS_RGB[l]},0.22)`;
      ctx2d.lineWidth = 1;
      ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, hitY); ctx2d.stroke();
    }

    // Subtle beat grid: one faint line per beat scrolling into the hit line,
    // downbeats slightly brighter, so the pulse is visible even between notes.
    const firstBeat = Math.ceil(t / BEAT_SEC);
    for (let bi = firstBeat; bi * BEAT_SEC < t + noteTravelSec; bi++) {
      const p = 1 - (bi * BEAT_SEC - t) / noteTravelSec;
      if (p < 0) continue;
      const y = p * hitY;
      ctx2d.strokeStyle = bi % 4 === 0 ? "rgba(234,255,244,0.14)" : "rgba(234,255,244,0.06)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(innerWidth, y); ctx2d.stroke();
    }

    // Hit window made visible: outer band = "good" timing, inner brighter
    // band = "perfect", sized from the actual tolerances and travel speed.
    const goodPx = (HIT_GOOD / noteTravelSec) * hitY;
    const perfectPx = (HIT_PERFECT / noteTravelSec) * hitY;
    ctx2d.fillStyle = "rgba(255,209,102,0.09)";
    ctx2d.fillRect(0, hitY - goodPx, innerWidth, goodPx * 2);
    ctx2d.fillStyle = "rgba(65,255,161,0.12)";
    ctx2d.fillRect(0, hitY - perfectPx, innerWidth, perfectPx * 2);
    ctx2d.strokeStyle = "rgba(255,209,102,0.85)";
    ctx2d.lineWidth = 3;
    ctx2d.beginPath(); ctx2d.moveTo(0, hitY); ctx2d.lineTo(innerWidth, hitY); ctx2d.stroke();
    // Hit-line lane targets: an outlined receptor circle per lane.
    for (let l = 0; l < LANES; l++) {
      ctx2d.beginPath();
      ctx2d.arc(laneX(l), hitY, 20, 0, Math.PI * 2);
      ctx2d.strokeStyle = `rgba(${LANE_COLORS_RGB[l]},0.6)`;
      ctx2d.lineWidth = 2;
      ctx2d.stroke();
    }

    for (const n of notes) {
      const dt = n.time - t;
      if (dt > noteTravelSec || (n.resolved && n.judgement !== null && dt < -0.3)) continue;
      if (n.resolved && dt < -0.05) continue;
      const progress = 1 - dt / noteTravelSec; // 0 at spawn, 1 at hit line
      if (progress < 0) continue;
      const y = progress * hitY;
      const x = laneX(n.lane, n.key);
      const held = holdingKey[n.key];
      const holding = held && held.note === n;
      const keyRgb = KEY_COLOR_RGB[n.key] || LANE_COLORS_RGB[n.lane] || LANE_COLORS_RGB[0];

      if (n.type === "hold") {
        const endDt = (n.time + n.duration) - t;
        const endProgress = 1 - endDt / noteTravelSec;
        const endY = Math.min(hitY, endProgress * hitY);
        ctx2d.fillStyle = holding ? `rgba(${keyRgb},0.55)` : `rgba(${keyRgb},0.26)`;
        ctx2d.fillRect(x - 12, Math.min(y, endY), 24, Math.abs(endY - Math.min(y, hitY)));
      }
      ctx2d.beginPath();
      ctx2d.arc(x, y, 17, 0, Math.PI * 2);
      ctx2d.fillStyle = n.resolved ? "rgba(255,255,255,0.08)" : (KEY_COLOR[n.key] || LANE_COLORS[n.lane] || LANE_COLORS[0]);
      ctx2d.fill();
      ctx2d.strokeStyle = n.type === "hold" ? "#ffffff" : "rgba(255,255,255,0.5)";
      ctx2d.lineWidth = n.type === "hold" ? 2.5 : 1;
      ctx2d.stroke();
      ctx2d.lineWidth = 1;
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
    holdingKey = {}; // clear any hold tracked from a previous run
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
