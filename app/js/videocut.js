/* PhantomForce — PhantomCut: timeline video editor that runs entirely in the
 * browser.
 *
 * No uploads, no vendor lanes, no server round-trips: media comes from the
 * Media Pool or this PC, compositing happens on a local <canvas>, and export
 * records that canvas in real time through MediaRecorder. Nothing leaves the
 * machine until the owner decides what to do with the finished .webm.
 */

const FADE_S = 0.5;               // crossfade length; short enough to never eat a whole clip
const MAX_CLIPS = 40;             // keeps the realtime export + per-clip <video> pool sane
const MUSIC_FADE_S = 1;           // linear fade-out at the tail of the timeline
const MAX_DATAURL_BYTES = 18 * 1024 * 1024;  // above this the caller relies on the auto-download
const ASPECTS = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1] };
const PREVIEW_DIMS = { "16:9": [854, 480], "9:16": [480, 854], "1:1": [640, 640] };
const RESOLUTIONS = ["720p", "1080p"];

/* Ken Burns pans are picked from a fixed table by hashing the clip id, so a
   replay (or the export after the preview) always moves the same way. */
const KB_PATHS = [
  [0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [1, 1, 0, 0],
  [0, 0.5, 1, 0.5], [1, 0.5, 0, 0.5], [0.5, 0, 0.5, 1], [0.5, 1, 0.5, 0],
];

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function fmtTime(s) {
  const t = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
const fmtSec = (v) => (Math.round((Number(v) || 0) * 10) / 10).toFixed(1);
function kebab(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "phantomcut";
}
/* Cover-fit source rect: crop the media so it fills the whole frame. */
function coverRect(mw, mh, cw, ch) {
  const scale = Math.max(cw / Math.max(1, mw), ch / Math.max(1, mh));
  const sw = cw / scale, sh = ch / scale;
  return [(mw - sw) / 2, (mh - sh) / 2, sw, sh];
}
function containRect(mw, mh, cw, ch) {
  const scale = Math.min(cw / Math.max(1, mw), ch / Math.max(1, mh));
  const dw = mw * scale, dh = mh * scale;
  return [(cw - dw) / 2, (ch - dh) / 2, dw, dh];
}
/* MediaRecorder-made webm reports Infinity until it has been seeked past the
   end once — pool videos often come from that path, so probe before trusting. */
function readVideoDuration(el, done) {
  if (isFinite(el.duration) && el.duration > 0) { done(el.duration); return; }
  const onchange = () => {
    if (!isFinite(el.duration) || el.duration <= 0) return;
    el.removeEventListener("durationchange", onchange);
    done(el.duration);
  };
  el.addEventListener("durationchange", onchange);
  try { el.currentTime = 1e7; } catch { el.removeEventListener("durationchange", onchange); done(0); }
}
function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function mountVideoEditor(host, opts = {}) {
  // re-mount safe: a previous instance on the same host is torn down first
  if (typeof host.__phantomCutDestroy === "function") host.__phantomCutDestroy();
  const esc = opts.esc || ((s) => String(s));
  const notify = (title, message) => { try { opts.notify?.(title, message); } catch {} };

  const state = {
    title: "PhantomCut edit",
    aspect: ASPECTS[opts.aspect] ? opts.aspect : "16:9",
    res: "720p",
    clips: [],
    selectedId: null,
    playing: false,
    playhead: 0,
  };
  const music = { el: null, name: "", url: "", volume: 80 };
  /* One AudioContext for preview AND export. A media element accepts exactly
     one MediaElementAudioSourceNode for its whole life, so the source nodes
     live in a WeakMap and are created lazily, once per element. */
  const audio = { ctx: null, master: null, musicGain: null, exportDest: null, failed: false };
  const routedSources = new WeakMap();
  const ownedUrls = [];             // object URLs this editor created — revoked on destroy/remove
  const recorderMime = pickRecorderMime();
  let clipSeq = 0;
  let pickerItems = [];
  let localPickerItems = [];
  let localPickerLoading = false;
  let localPickerSeq = 0;
  const genPanel = { open: false, busy: false, prompt: "", modality: "video" };
  let playClock = 0;                // performance.now() timestamp for playhead 0 while playing
  let exportRun = null;
  let raf = 0;
  let destroyed = false;

  host.innerHTML = `
    <div class="vc" data-vc-root>
      <header class="vc-head">
        <label class="vc-field vc-field-grow">
          <span class="vc-microlabel">Project</span>
          <input class="vc-title-in" data-vc-title maxlength="80" value="${esc(state.title)}"/>
        </label>
        <label class="vc-field">
          <span class="vc-microlabel">Aspect</span>
          <select class="vc-select" data-vc-aspect>
            ${Object.keys(ASPECTS).map((a) => `<option value="${esc(a)}" ${a === state.aspect ? "selected" : ""}>${esc(a)}</option>`).join("")}
          </select>
        </label>
        <label class="vc-field">
          <span class="vc-microlabel">Export</span>
          <select class="vc-select" data-vc-res>
            ${RESOLUTIONS.map((r) => `<option value="${esc(r)}" ${r === state.res ? "selected" : ""}>${esc(r)} · 30fps</option>`).join("")}
          </select>
        </label>
        <div class="vc-field">
          <span class="vc-microlabel">Total</span>
          <b class="vc-total" data-vc-total>0:00</b>
        </div>
        <div class="vc-export-slot">
          <button class="vc-export-btn" data-vc-export-btn type="button" disabled>Export video</button>
          ${recorderMime ? "" : `<span class="vc-export-unsupported">This browser has no MediaRecorder webm support, so PhantomCut cannot render a file here. Preview still works.</span>`}
        </div>
      </header>

      <div class="vc-stage">
        <canvas class="vc-canvas" data-vc-canvas></canvas>
        <div class="vc-export-panel" data-vc-export-panel hidden>
          <b data-vc-export-label>Exporting…</b>
          <div class="vc-export-bar"><i data-vc-export-fill></i></div>
          <span class="vc-microlabel" data-vc-export-stat>0% · 0:00 elapsed</span>
          <button class="vc-cancel-btn" data-vc-export-cancel type="button">Cancel export</button>
        </div>
      </div>

      <div class="vc-transport">
        <button class="vc-play" data-vc-play type="button" aria-label="Play or pause (space)">▶</button>
        <div class="vc-scrub" data-vc-scrub role="slider" aria-label="Seek"><i data-vc-scrub-fill></i></div>
        <span class="vc-time" data-vc-time>0:00 / 0:00</span>
      </div>

      <div class="vc-addrow" data-vc-addrow></div>

      <div class="vc-lane">
        <span class="vc-microlabel">Timeline</span>
        <div class="vc-timeline" data-vc-timeline></div>
      </div>

      <div class="vc-inspector" data-vc-inspector></div>
      <div class="vc-picker" data-vc-picker hidden></div>
      <div class="vc-offstage" data-vc-media aria-hidden="true"></div>
    </div>`;

  const root = host.querySelector("[data-vc-root]");
  const q = (sel) => root.querySelector(sel);
  const cv = q("[data-vc-canvas]");
  const ctx = cv.getContext("2d");
  const mediaDiv = q("[data-vc-media]");
  const timelineEl = q("[data-vc-timeline]");
  const inspectorEl = q("[data-vc-inspector]");
  const addRowEl = q("[data-vc-addrow]");
  const pickerEl = q("[data-vc-picker]");
  const refs = {
    total: q("[data-vc-total]"),
    exportBtn: q("[data-vc-export-btn]"),
    exportPanel: q("[data-vc-export-panel]"),
    exportLabel: q("[data-vc-export-label]"),
    exportFill: q("[data-vc-export-fill]"),
    exportStat: q("[data-vc-export-stat]"),
    play: q("[data-vc-play]"),
    scrub: q("[data-vc-scrub]"),
    scrubFill: q("[data-vc-scrub-fill]"),
    time: q("[data-vc-time]"),
  };

  /* ---------------- timeline math ---------------- */
  const selectedClip = () => state.clips.find((c) => c.id === state.selectedId) || null;
  function clipDuration(clip) {
    if (clip.kind === "photo") return clamp(Number(clip.duration) || 3, 0.5, 15);
    if (clip.ready === "ready" && clip.out > clip.in) return Math.max(0.1, clip.out - clip.in);
    return 2;  // metadata missing or failed: hold a placeholder slate instead of crashing
  }
  function clipVolume(clip) {
    return clamp(Number(clip.volume ?? 100), 0, 100);
  }
  function clipFadeValue(clip, key) {
    return clamp(Number(clip?.[key]) || 0, 0, Math.min(3, clipDuration(clip) / 2));
  }
  function clipFadeAlpha(clip, local) {
    const dur = clipDuration(clip);
    const fadeIn = clipFadeValue(clip, "fadeIn");
    const fadeOut = clipFadeValue(clip, "fadeOut");
    const inAlpha = fadeIn > 0 ? clamp(local / fadeIn, 0, 1) : 1;
    const outAlpha = fadeOut > 0 ? clamp((dur - local) / fadeOut, 0, 1) : 1;
    return clamp(Math.min(inAlpha, outAlpha), 0, 1);
  }
  function segments() {
    let t = 0;
    return state.clips.map((clip) => {
      const dur = clipDuration(clip);
      const seg = { clip, start: t, end: t + dur, dur };
      t += dur;
      return seg;
    });
  }
  const segmentForClip = (clip) => segments().find((seg) => seg.clip === clip) || null;
  function splitPointForClip(clip) {
    const seg = segmentForClip(clip);
    if (!seg) return null;
    const local = clamp(state.playhead - seg.start, 0, seg.dur);
    const minTail = clip.kind === "video" ? 0.15 : 0.5;
    if (local <= minTail || seg.dur - local <= minTail) return null;
    return { seg, local };
  }
  const totalDuration = () => state.clips.reduce((t, c) => t + clipDuration(c), 0);

  /* ---------------- audio graph ---------------- */
  function ensureAudio() {
    if (audio.ctx || audio.failed) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio.ctx = new Ctx();
      audio.master = audio.ctx.createGain();
      audio.master.connect(audio.ctx.destination);
      audio.musicGain = audio.ctx.createGain();
      audio.musicGain.connect(audio.master);
    } catch { audio.failed = true; }
  }
  function routeElement(el, via) {
    if (!audio.ctx || !el || routedSources.has(el)) return;
    try {
      const src = audio.ctx.createMediaElementSource(el);
      src.connect(via || audio.master);
      routedSources.set(el, src);
    } catch {}
  }
  /* Fade lives on the GainNode so it also lands in the export mix; the user
     volume stays on element.volume so the two never fight. */
  function scheduleMusicFade(fromT) {
    if (!music.el || !audio.ctx || !audio.musicGain) return;
    const g = audio.musicGain.gain;
    const now = audio.ctx.currentTime;
    const remain = Math.max(0, totalDuration() - fromT);
    g.cancelScheduledValues(now);
    if (remain <= 0) { g.setValueAtTime(0, now); return; }
    const startVal = Math.min(1, remain / MUSIC_FADE_S);
    g.setValueAtTime(startVal, now);
    g.setValueAtTime(startVal, now + Math.max(0, remain - MUSIC_FADE_S));
    g.linearRampToValueAtTime(0, now + remain);
  }
  function resetMusicGain() {
    if (!audio.ctx || !audio.musicGain) return;
    const g = audio.musicGain.gain;
    g.cancelScheduledValues(audio.ctx.currentTime);
    g.setValueAtTime(1, audio.ctx.currentTime);
  }

  /* ---------------- media loading ---------------- */
  function revokeOwned(url) {
    const i = ownedUrls.indexOf(url);
    if (i < 0) return;
    ownedUrls.splice(i, 1);
    try { URL.revokeObjectURL(url); } catch {}
  }
  function addClip(kind, url, title, owned) {
    if (state.clips.length >= MAX_CLIPS) {
      notify("PhantomCut", `Timeline is full — ${MAX_CLIPS} clips max.`);
      if (owned) revokeOwned(url);
      return null;
    }
    const clip = {
      id: `vc${++clipSeq}-${Date.now().toString(36)}`,
      kind, url, owned: !!owned,
      title: String(title || (kind === "photo" ? "Photo" : "Video")).slice(0, 80),
      ready: "loading", thumb: "", el: null,
      transition: "none", text: "", textPos: "bottom",
      fit: "cover",
      fadeIn: 0, fadeOut: 0,
      duration: 3, kenBurns: false,               // photo
      in: 0, out: 0, srcDuration: 0, mute: false, volume: 100, // video
      w: 0, h: 0,
    };
    state.clips.push(clip);
    state.selectedId = clip.id;
    if (kind === "photo") loadPhoto(clip); else loadVideo(clip);
    renderAll();
    return clip;
  }
  function loadPhoto(clip) {
    const img = new Image();
    img.onload = () => {
      if (destroyed) return;
      clip.w = img.naturalWidth; clip.h = img.naturalHeight;
      clip.ready = "ready"; clip.thumb = clip.url;
      renderTimeline(); updateMeta();
      if (clip.id === state.selectedId) renderInspector();
    };
    img.onerror = () => { if (destroyed) return; clip.ready = "error"; renderAll(); };
    img.src = clip.url;
    clip.el = img;
  }
  function loadVideo(clip) {
    const v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.volume = clipVolume(clip) / 100;
    v.muted = !!clip.mute;
    v.addEventListener("error", () => { if (destroyed) return; clip.ready = "error"; renderAll(); }, { once: true });
    v.addEventListener("loadedmetadata", () => {
      readVideoDuration(v, (dur) => {
        if (destroyed) return;
        if (!dur) { clip.ready = "error"; renderAll(); return; }
        const requestedIn = Number(clip.in) || 0;
        const requestedOut = Number(clip.out) || 0;
        clip.srcDuration = dur;
        clip.in = clamp(requestedIn, 0, Math.max(0, dur - 0.05));
        clip.out = requestedOut > clip.in ? clamp(requestedOut, clip.in + 0.05, dur) : dur;
        clip.ready = "ready";
        captureVideoThumb(clip);
        renderTimeline(); updateMeta();
        if (clip.id === state.selectedId) renderInspector();
      });
    }, { once: true });
    v.src = clip.url;
    mediaDiv.appendChild(v);
    clip.el = v;
  }
  function captureVideoThumb(clip) {
    const v = clip.el;
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      if (destroyed) return;
      try {
        const c = document.createElement("canvas");
        c.width = 96; c.height = 54;
        const [sx, sy, sw, sh] = coverRect(v.videoWidth, v.videoHeight, c.width, c.height);
        c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
        clip.thumb = c.toDataURL("image/jpeg", 0.7);
        renderTimeline();
      } catch {}  // a tainted frame just means no thumbnail, never a broken card
    };
    v.addEventListener("seeked", onSeeked);
    try { v.currentTime = Math.min(0.1, clip.srcDuration / 2); } catch { v.removeEventListener("seeked", onSeeked); }
  }
  function removeClip(clip) {
    const i = state.clips.indexOf(clip);
    if (i < 0) return;
    state.clips.splice(i, 1);
    try { clip.el?.pause?.(); } catch {}
    if (clip.el && clip.el.remove) clip.el.remove();
    if (clip.owned) revokeOwned(clip.url);
    if (state.selectedId === clip.id) state.selectedId = state.clips[Math.min(i, state.clips.length - 1)]?.id || null;
    state.playhead = clamp(state.playhead, 0, totalDuration());
    renderAll();
  }
  function moveClip(clip, dir) {
    const i = state.clips.indexOf(clip);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.clips.length) return;
    state.clips.splice(i, 1);
    state.clips.splice(j, 0, clip);
    renderAll();
  }
  function moveClipToIndex(clip, targetIndex) {
    const from = state.clips.indexOf(clip);
    if (from < 0) return false;
    const bounded = clamp(Number(targetIndex) || 0, 0, state.clips.length - 1);
    if (from === bounded) return false;
    state.clips.splice(from, 1);
    state.clips.splice(bounded, 0, clip);
    state.selectedId = clip.id;
    renderAll();
    return true;
  }
  function duplicateClip(clip) {
    if (!clip || state.clips.length >= MAX_CLIPS) {
      notify("PhantomCut", `Timeline is full — ${MAX_CLIPS} clips max.`);
      return null;
    }
    const index = state.clips.indexOf(clip);
    if (index < 0) return null;
    if (clip.owned) clip.owned = false;
    const copy = {
      ...clip,
      id: `vc${++clipSeq}-${Date.now().toString(36)}-copy`,
      title: `${clip.title || "Clip"} copy`.slice(0, 80),
      ready: "loading",
      el: null,
      owned: false,
    };
    state.clips.splice(index + 1, 0, copy);
    state.selectedId = copy.id;
    if (copy.kind === "photo") loadPhoto(copy); else loadVideo(copy);
    renderAll();
    notify("PhantomCut", "Duplicated clip.");
    return copy;
  }
  function splitClipAtPlayhead(clip) {
    if (!clip || state.clips.length >= MAX_CLIPS) {
      notify("PhantomCut", `Timeline is full — ${MAX_CLIPS} clips max.`);
      return;
    }
    const split = splitPointForClip(clip);
    if (!split) {
      notify("PhantomCut", "Move the playhead inside the clip before splitting.");
      return;
    }
    const index = state.clips.indexOf(clip);
    if (index < 0) return;
    const copy = {
      ...clip,
      id: `vc${++clipSeq}-${Date.now().toString(36)}-split`,
      title: `${clip.title} cut`,
      ready: "loading",
      thumb: "",
      el: null,
      owned: false,
      transition: "none",
    };
    if (clip.owned) clip.owned = false;
    if (clip.kind === "photo") {
      const originalDuration = clipDuration(clip);
      clip.duration = split.local;
      copy.duration = Math.max(0.5, originalDuration - split.local);
      state.clips.splice(index + 1, 0, copy);
      loadPhoto(copy);
    } else {
      if (clip.ready !== "ready") {
        notify("PhantomCut", "This video is still loading, so it cannot be split yet.");
        return;
      }
      const cut = clip.in + split.local;
      copy.in = cut;
      copy.out = clip.out;
      clip.out = cut;
      state.clips.splice(index + 1, 0, copy);
      loadVideo(copy);
    }
    state.selectedId = copy.id;
    state.playhead = split.seg.start + split.local;
    renderAll();
    notify("PhantomCut", "Split clip at the playhead.");
  }
  function handleFiles(list) {
    for (const f of Array.from(list || [])) {
      if (state.clips.length >= MAX_CLIPS) { notify("PhantomCut", `Timeline is full — ${MAX_CLIPS} clips max.`); break; }
      if (f.type.startsWith("image/")) {
        const fr = new FileReader();
        fr.onload = () => { if (!destroyed) addClip("photo", String(fr.result), f.name, false); };
        fr.onerror = () => notify("PhantomCut", `Could not read ${f.name}.`);
        fr.readAsDataURL(f);
      } else if (f.type.startsWith("video/")) {
        const u = URL.createObjectURL(f);
        ownedUrls.push(u);
        addClip("video", u, f.name, true);
      } else {
        notify("PhantomCut", `${f.name} is not an image or video.`);
      }
    }
  }
  function setMusicFile(file) {
    clearMusic();
    const u = URL.createObjectURL(file);
    ownedUrls.push(u);
    const el = document.createElement("audio");
    el.preload = "auto";
    el.src = u;
    el.volume = music.volume / 100;
    mediaDiv.appendChild(el);
    music.el = el; music.name = file.name; music.url = u;
    renderAddRow();
  }
  function clearMusic() {
    if (!music.el) return;
    try { music.el.pause(); } catch {}
    music.el.remove();
    revokeOwned(music.url);
    music.el = null; music.name = ""; music.url = "";
  }

  /* ---------------- playback + media sync ---------------- */
  function segmentIndexAt(segs, t) {
    const i = segs.findIndex((s) => t < s.end);
    return i < 0 ? segs.length - 1 : i;
  }
  /* Elements are only nudged when they drift, so seeks stay rare and playback
     stays smooth; the previous clip is parked at its out point so a crossfade
     can hold its last frame. */
  function syncMedia(t, hard = false) {
    const segs = segments();
    if (!segs.length) return;
    const idx = segmentIndexAt(segs, t);
    segs.forEach((seg, i) => {
      const c = seg.clip;
      if (c.kind !== "video" || c.ready !== "ready") return;
      const el = c.el;
      el.muted = !!c.mute;
      const running = state.playing || !!exportRun;
      if (i === idx) {
        const want = clamp(c.in + (t - seg.start), 0, Math.max(0, c.srcDuration - 0.05));
        const local = clamp(t - seg.start, 0, seg.dur);
        el.volume = (clipVolume(c) / 100) * clipFadeAlpha(c, local);
        if (hard || Math.abs(el.currentTime - want) > (running ? 0.35 : 0.2)) { try { el.currentTime = want; } catch {} }
        if (running) { if (el.paused) el.play().catch(() => {}); }
        else if (!el.paused) el.pause();
      } else {
        el.volume = 0;
        if (!el.paused) el.pause();
        if (i === idx - 1 && Math.abs(el.currentTime - c.out) > 0.25) {
          try { el.currentTime = Math.max(0, c.out - 0.05); } catch {}
        }
      }
    });
    if (music.el) {
      const running = state.playing || !!exportRun;
      if (running && t < totalDuration()) {
        if (hard || Math.abs(music.el.currentTime - t) > 0.35) { try { music.el.currentTime = t; } catch {} }
        if (music.el.paused) music.el.play().catch(() => {});
      } else if (!music.el.paused) {
        music.el.pause();
      }
    }
  }
  function pauseAllMedia() {
    for (const c of state.clips) { if (c.kind === "video") { try { c.el?.pause(); } catch {} } }
    if (music.el) { try { music.el.pause(); } catch {} }
  }
  function play() {
    if (exportRun || state.playing || totalDuration() <= 0) return;
    if (state.playhead >= totalDuration() - 0.01) state.playhead = 0;
    ensureAudio();
    if (audio.ctx) {
      audio.ctx.resume().catch(() => {});
      if (music.el) routeElement(music.el, audio.musicGain);
      scheduleMusicFade(state.playhead);
    }
    state.playing = true;
    playClock = performance.now() - state.playhead * 1000;
    syncMedia(state.playhead, true);
  }
  function stopPlayback() {
    if (!state.playing) return;
    state.playing = false;
    pauseAllMedia();
    resetMusicGain();
  }
  function togglePlay() { state.playing ? stopPlayback() : play(); }
  function seekTo(t) {
    if (exportRun) return;
    state.playhead = clamp(t, 0, totalDuration());
    if (state.playing) {
      playClock = performance.now() - state.playhead * 1000;
      scheduleMusicFade(state.playhead);
    }
    syncMedia(state.playhead, true);
  }

  /* ---------------- drawing ---------------- */
  function setPreviewSize() {
    const [w, h] = PREVIEW_DIMS[state.aspect];
    cv.width = w; cv.height = h;
  }
  function drawEmptyFrame() {
    const W = cv.width, H = cv.height;
    ctx.fillStyle = "#050b09";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(111,154,131,0.75)";
    ctx.font = `500 ${Math.max(11, Math.round(H * 0.035))}px "DM Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PHANTOMCUT — ADD MEDIA TO BEGIN", W / 2, H / 2);
  }
  function drawPlaceholder(clip) {
    const W = cv.width, H = cv.height;
    ctx.fillStyle = "#050b09";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = clip.ready === "error" ? "rgba(255,77,99,0.85)" : "rgba(111,154,131,0.85)";
    ctx.font = `500 ${Math.max(11, Math.round(H * 0.033))}px "DM Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(clip.ready === "error" ? "MEDIA FAILED TO LOAD" : "LOADING MEDIA…", W / 2, H / 2);
  }
  function drawTextOverlay(clip, alpha) {
    const txt = String(clip.text || "").trim();
    if (!txt) return;
    const W = cv.width, H = cv.height;
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = `600 ${Math.round(H * 0.055)}px "Space Grotesk", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = H * 0.022;
    ctx.shadowOffsetY = H * 0.006;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(txt, W / 2, clip.textPos === "center" ? H / 2 : H * 0.88, W * 0.92);
    ctx.restore();
  }
  function drawContainedMediaFrame(source, mw, mh, W, H) {
    const [sx, sy, sw, sh] = coverRect(mw, mh, W, H);
    const [dx, dy, dw, dh] = containRect(mw, mh, W, H);
    ctx.save();
    ctx.filter = `blur(${Math.max(8, Math.round(Math.min(W, H) * 0.028))}px) brightness(0.72) saturate(1.08)`;
    ctx.drawImage(source, sx, sy, sw, sh, -W * 0.035, -H * 0.035, W * 1.07, H * 1.07);
    ctx.restore();
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(source, 0, 0, mw, mh, dx, dy, dw, dh);
  }
  function drawClipFrame(clip, local, alpha) {
    const W = cv.width, H = cv.height;
    const frameAlpha = clamp(alpha, 0, 1) * clipFadeAlpha(clip, local);
    ctx.save();
    ctx.globalAlpha = frameAlpha;
    if (clip.ready !== "ready") {
      drawPlaceholder(clip);
    } else if (clip.kind === "photo") {
      if (clip.fit === "contain") {
        try { drawContainedMediaFrame(clip.el, clip.w, clip.h, W, H); } catch {}
        ctx.restore();
        drawTextOverlay(clip, frameAlpha);
        return;
      }
      const [sx, sy, sw, sh] = coverRect(clip.w, clip.h, W, H);
      let rx = sx, ry = sy, rw = sw, rh = sh;
      if (clip.kenBurns) {
        const h = hashStr(clip.id);
        const [x0, y0, x1, y1] = KB_PATHS[h % KB_PATHS.length];
        const zoomIn = ((h >>> 4) & 1) === 1;
        const p = clamp(local / clipDuration(clip), 0, 1);
        const z = zoomIn ? 1 + 0.16 * p : 1.16 - 0.16 * p;
        rw = sw / z; rh = sh / z;
        rx = sx + (sw - rw) * (x0 + (x1 - x0) * p);
        ry = sy + (sh - rh) * (y0 + (y1 - y0) * p);
      }
      try { ctx.drawImage(clip.el, rx, ry, rw, rh, 0, 0, W, H); } catch {}
    } else {
      const el = clip.el;
      if (el.readyState >= 2 && el.videoWidth) {
        try {
          if (clip.fit === "contain") drawContainedMediaFrame(el, el.videoWidth, el.videoHeight, W, H);
          else {
            const [sx, sy, sw, sh] = coverRect(el.videoWidth, el.videoHeight, W, H);
            ctx.drawImage(el, sx, sy, sw, sh, 0, 0, W, H);
          }
        } catch {}
      }
    }
    ctx.restore();
    drawTextOverlay(clip, frameAlpha);
  }
  function drawFrame(t) {
    const W = cv.width, H = cv.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const segs = segments();
    if (!segs.length) { drawEmptyFrame(); return; }
    const i = segmentIndexAt(segs, t);
    const seg = segs[i];
    const local = clamp(t - seg.start, 0, seg.dur);
    if (i > 0 && seg.clip.transition === "fade" && local < FADE_S) {
      const prev = segs[i - 1];
      drawClipFrame(prev.clip, prev.dur, 1);        // previous clip holds its last frame under the fade
      drawClipFrame(seg.clip, local, local / FADE_S);
    } else {
      drawClipFrame(seg.clip, local, 1);
    }
  }

  /* ---------------- export ---------------- */
  function exportDims() {
    const short = state.res === "1080p" ? 1080 : 720;
    const [aw, ah] = ASPECTS[state.aspect];
    if (aw >= ah) return [Math.round(short * aw / ah / 2) * 2, short];
    return [short, Math.round(short * ah / aw / 2) * 2];
  }
  function startExport() {
    if (exportRun || destroyed || !recorderMime || !state.clips.length) return;
    const total = totalDuration();
    if (total <= 0) return;
    stopPlayback();
    const [w, h] = exportDims();
    cv.width = w; cv.height = h;
    ensureAudio();
    let audioTrack = null;
    if (audio.ctx) {
      audio.ctx.resume().catch(() => {});
      if (!audio.exportDest) {
        audio.exportDest = audio.ctx.createMediaStreamDestination();
        audio.master.connect(audio.exportDest);
      }
      for (const c of state.clips) {
        if (c.kind === "video" && c.ready === "ready" && !c.mute) routeElement(c.el);
      }
      if (music.el) routeElement(music.el, audio.musicGain);
      audioTrack = audio.exportDest.stream.getAudioTracks()[0] || null;
    }
    let rec;
    try {
      const stream = cv.captureStream(30);
      if (audioTrack) stream.addTrack(audioTrack);
      rec = new MediaRecorder(stream, {
        mimeType: recorderMime,
        videoBitsPerSecond: state.res === "1080p" ? 9_000_000 : 5_000_000,
      });
    } catch (err) {
      setPreviewSize();
      notify("PhantomCut", `Export could not start: ${err?.message || err}`);
      return;
    }
    const run = { rec, chunks: [], t0: performance.now(), total, w, h, cancelled: false, stopping: false };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) run.chunks.push(e.data); };
    rec.onstop = () => finishExport(run);
    exportRun = run;
    state.playhead = 0;
    syncMedia(0, true);
    if (audio.ctx) scheduleMusicFade(0);
    rec.start(250);
    root.classList.add("is-exporting");
    refs.exportPanel.hidden = false;
    refs.exportLabel.textContent = `Exporting ${w}×${h} @30fps — renders in real time`;
    refs.exportFill.style.width = "0%";
    refs.exportStat.textContent = "0% · 0:00 elapsed";
    updateMeta();
  }
  function stopRecorder(cancelled) {
    const run = exportRun;
    if (!run || run.stopping) return;
    run.stopping = true;
    run.cancelled = !!cancelled;
    pauseAllMedia();
    resetMusicGain();
    try { run.rec.stop(); } catch { finishExport(run); }
  }
  function finishExport(run) {
    if (exportRun === run) exportRun = null;
    if (destroyed) return;
    root.classList.remove("is-exporting");
    refs.exportPanel.hidden = true;
    setPreviewSize();
    state.playhead = 0;
    updateMeta();
    if (run.cancelled) { notify("PhantomCut", "Export cancelled — nothing was saved."); return; }
    const blob = new Blob(run.chunks, { type: run.rec.mimeType || "video/webm" });
    if (!blob.size) { notify("PhantomCut", "Export produced an empty file — try again."); return; }
    const name = `${kebab(state.title)}.webm`;
    // Always hand the owner the file — the callback dataUrl is a bonus, not the delivery
    const dl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = dl; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(dl); } catch {} }, 10_000);
    const deliver = (dataUrl) => {
      notify("PhantomCut", `Exported ${name} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
      try {
        Promise.resolve(opts.onExported?.({
          blob, dataUrl, title: state.title, duration: run.total, width: run.w, height: run.h,
        })).catch(() => {});
      } catch {}
    };
    if (blob.size <= MAX_DATAURL_BYTES) {
      const fr = new FileReader();
      fr.onload = () => deliver(String(fr.result));
      fr.onerror = () => deliver(null);
      fr.readAsDataURL(blob);
    } else {
      deliver(null);
    }
  }

  /* ---------------- render loop ---------------- */
  function updateTransportUI(t, total) {
    refs.time.textContent = `${fmtTime(t)} / ${fmtTime(total)}`;
    refs.scrubFill.style.width = total > 0 ? `${clamp(t / total, 0, 1) * 100}%` : "0%";
    const glyph = state.playing || exportRun ? "❚❚" : "▶";
    if (refs.play.textContent !== glyph) refs.play.textContent = glyph;
  }
  function tick() {
    if (destroyed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    let t = state.playhead;
    if (exportRun) {
      t = (now - exportRun.t0) / 1000;
      const done = t >= exportRun.total;
      t = Math.min(t, exportRun.total);
      const pct = Math.round(clamp(t / exportRun.total, 0, 1) * 100);
      refs.exportFill.style.width = `${pct}%`;
      refs.exportStat.textContent = `${pct}% · ${fmtTime(t)} elapsed`;
      if (done) { drawFrame(exportRun.total); stopRecorder(false); return; }
      syncMedia(t);
    } else if (state.playing) {
      t = (now - playClock) / 1000;
      const total = totalDuration();
      if (t >= total) { t = total; state.playhead = t; stopPlayback(); }
      else { state.playhead = t; syncMedia(t); }
    }
    drawFrame(t);
    updateTransportUI(exportRun ? t : state.playhead, exportRun ? exportRun.total : totalDuration());
  }

  /* ---------------- UI: add row / AI generate / picker ---------------- */
  function renderAddRow() {
    const hasAi = typeof opts.sources?.generateClip === "function";
    addRowEl.innerHTML = `
      <div class="vc-addrow-top">
      <div class="vc-addrow-main">
        ${hasAi ? `<button class="vc-add-btn vc-add-btn-ai" data-vc-add-ai type="button">${genPanel.busy ? "✨ Generating…" : "✨ Generate with AI"}</button>` : ""}
        <button class="vc-add-btn" data-vc-add-pool type="button">＋ Your media</button>
        <label class="vc-add-btn vc-add-btn-ghost">＋ This PC<input type="file" data-vc-add-files accept="image/*,video/*" multiple hidden/></label>
      </div>
      <div class="vc-music">
        <span class="vc-microlabel">Music</span>
        ${music.el ? `
          <b class="vc-music-name" title="${esc(music.name)}">${esc(music.name)}</b>
          <input class="vc-range vc-music-vol" data-vc-music-vol type="range" min="0" max="100" step="1" value="${esc(String(music.volume))}"/>
          <span class="vc-microlabel" data-vc-music-out>${esc(String(music.volume))}</span>
          <button class="vc-mini-btn" data-vc-music-remove type="button" aria-label="Remove music">✕</button>
          <span class="vc-microlabel vc-music-note">fades out over the last second</span>
        ` : `
          <label class="vc-add-btn vc-add-btn-ghost">＋ Add track<input type="file" data-vc-music-file accept="audio/*" hidden/></label>
          <span class="vc-microlabel vc-music-note">optional · stops at the cut end</span>
        `}
      </div>
      </div>
      ${hasAi && genPanel.open ? genPanelHtml() : ""}`;
    addRowEl.querySelector("[data-vc-add-pool]").onclick = openPicker;
    addRowEl.querySelector("[data-vc-add-files]").onchange = (e) => { handleFiles(e.target.files); e.target.value = ""; };
    const aiBtn = addRowEl.querySelector("[data-vc-add-ai]");
    if (aiBtn) aiBtn.onclick = () => { genPanel.open = !genPanel.open; renderAddRow(); };
    wireGenPanel();
    const mf = addRowEl.querySelector("[data-vc-music-file]");
    if (mf) mf.onchange = (e) => { if (e.target.files[0]) setMusicFile(e.target.files[0]); e.target.value = ""; };
    const mv = addRowEl.querySelector("[data-vc-music-vol]");
    if (mv) mv.oninput = () => {
      music.volume = clamp(Number(mv.value) || 0, 0, 100);
      if (music.el) music.el.volume = music.volume / 100;
      const out = addRowEl.querySelector("[data-vc-music-out]");
      if (out) out.textContent = String(music.volume);
    };
    const mr = addRowEl.querySelector("[data-vc-music-remove]");
    if (mr) mr.onclick = () => { clearMusic(); renderAddRow(); };
  }
  function genPanelHtml() {
    return `
      <div class="vc-genpanel" data-vc-genpanel>
        <div class="vc-genpanel-mode" data-vc-gen-mode>
          <button type="button" class="${genPanel.modality === "video" ? "is-on" : ""}" data-v="video" ${genPanel.busy ? "disabled" : ""}>Video</button>
          <button type="button" class="${genPanel.modality === "photo" ? "is-on" : ""}" data-v="photo" ${genPanel.busy ? "disabled" : ""}>Image</button>
        </div>
        <textarea class="vc-genpanel-prompt" data-vc-gen-prompt rows="2" maxlength="600" placeholder="Describe the shot — subject, setting, motion, mood…" ${genPanel.busy ? "disabled" : ""}>${esc(genPanel.prompt)}</textarea>
        <div class="vc-genpanel-actions">
          <span class="vc-microlabel">${genPanel.busy ? "Generating — this can take a moment…" : "Adds straight to your timeline when it's ready."}</span>
          <button type="button" class="vc-mini-btn" data-vc-gen-cancel ${genPanel.busy ? "disabled" : ""}>Cancel</button>
          <button type="button" class="vc-add-btn vc-add-btn-ai" data-vc-gen-go ${genPanel.busy ? "disabled" : ""}>${genPanel.busy ? "Working…" : "Generate"}</button>
        </div>
      </div>`;
  }
  function wireGenPanel() {
    const panel = addRowEl.querySelector("[data-vc-genpanel]");
    if (!panel) return;
    panel.querySelectorAll("[data-vc-gen-mode] button").forEach((b) => b.onclick = () => {
      genPanel.modality = b.dataset.v;
      renderAddRow();
    });
    const promptEl = panel.querySelector("[data-vc-gen-prompt]");
    if (promptEl) {
      promptEl.oninput = () => { genPanel.prompt = promptEl.value; };
      promptEl.focus();
      promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
    }
    panel.querySelector("[data-vc-gen-cancel]").onclick = () => { genPanel.open = false; renderAddRow(); };
    panel.querySelector("[data-vc-gen-go]").onclick = async () => {
      const prompt = genPanel.prompt.trim();
      if (!prompt) { promptEl?.focus(); return; }
      genPanel.busy = true;
      renderAddRow();
      try {
        const result = await opts.sources.generateClip(prompt, genPanel.modality === "video" ? "video" : "image");
        if (result?.url) {
          addClip(result.type === "video" ? "video" : "photo", result.url, result.title || "Generated", false);
          genPanel.open = false;
          genPanel.prompt = "";
        }
      } finally {
        genPanel.busy = false;
        renderAddRow();
      }
    };
  }
  function poolItems() {
    const out = [];
    const safe = (fn) => { try { const r = typeof fn === "function" ? fn() : []; return Array.isArray(r) ? r : []; } catch { return []; } };
    for (const r of safe(opts.sources?.poolImages)) if (r && r.url) out.push({ kind: "photo", title: r.title || "Pool image", url: r.url, source: "pool" });
    for (const r of safe(opts.sources?.poolVideos)) if (r && r.url) out.push({ kind: "video", title: r.title || "Pool video", url: r.url, source: "pool" });
    return out;
  }
  function pickerGroupHtml(label, items, emptyText) {
    return `
      <p class="vc-picker-section">${esc(label)}</p>
      ${items.length ? `<div class="vc-picker-grid">${items.map(({ it, i }) => `
        <button class="vc-pick" data-vc-pick="${i}" type="button">
          <span class="vc-pick-thumb">${it.kind === "video"
            ? `<video src="${esc(it.url)}" muted preload="metadata"></video>`
            : `<img src="${esc(it.url)}" alt="" loading="lazy"/>`}</span>
          <span class="vc-pick-copy"><b>${esc(it.title)}</b><i>${it.kind === "video" ? "video" : "image"}</i></span>
        </button>`).join("")}</div>`
        : `<p class="vc-picker-empty">${esc(emptyText)}</p>`}`;
  }
  function pickerGridHtml() {
    const indexed = pickerItems.map((it, i) => ({ it, i }));
    const pool = indexed.filter((row) => row.it.source === "pool");
    const local = indexed.filter((row) => row.it.source === "local");
    const hasLocal = typeof opts.sources?.listLocal === "function";
    return `
      ${pickerGroupHtml("Media Pool", pool, "Media Pool is empty — generate or save media in Media Lab first.")}
      ${hasLocal ? pickerGroupHtml(
        "This PC",
        local,
        localPickerLoading ? "Scanning local files…" : "No local media indexed yet.",
      ) : ""}`;
  }
  function repaintPickerGrid() {
    const grid = pickerEl.querySelector("[data-vc-picker-body]");
    if (grid) grid.innerHTML = pickerGridHtml();
  }
  async function loadLocalPickerItems() {
    const seq = ++localPickerSeq;
    localPickerLoading = true;
    repaintPickerGrid();
    const rows = await opts.sources.listLocal("all").catch(() => []);
    if (seq !== localPickerSeq) return;
    localPickerLoading = false;
    localPickerItems = Array.isArray(rows) ? rows : [];
    repaintPickerGrid(); // repaint now — the loop below only repaints per item, and may be empty
    // resolve blob URLs progressively so the grid can preview without the picker stalling
    for (const row of localPickerItems) {
      if (seq !== localPickerSeq) return;
      const url = await opts.sources.localBlobUrl(row.id).catch(() => null);
      if (seq !== localPickerSeq) return;
      if (url) pickerItems.push({ kind: row.kind === "video" ? "video" : "photo", title: row.title, url, source: "local" });
      repaintPickerGrid();
    }
  }
  function openPicker() {
    pickerItems = poolItems();
    localPickerItems = [];
    localPickerLoading = false;
    pickerEl.hidden = false;
    pickerEl.innerHTML = `
      <div class="vc-picker-backdrop" data-vc-picker-close></div>
      <div class="vc-picker-panel" role="dialog" aria-label="Your media">
        <header class="vc-picker-head">
          <b>Your media</b>
          <span class="vc-microlabel">pick something to append to the timeline</span>
          <button class="vc-mini-btn" data-vc-picker-close type="button" aria-label="Close">✕</button>
        </header>
        <div data-vc-picker-body>${pickerGridHtml()}</div>
      </div>`;
    if (typeof opts.sources?.listLocal === "function") loadLocalPickerItems();
  }
  function closePicker() { pickerEl.hidden = true; pickerEl.innerHTML = ""; localPickerSeq++; }
  pickerEl.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-vc-pick]");
    if (pick) {
      const it = pickerItems[Number(pick.dataset.vcPick)];
      if (it) addClip(it.kind, it.url, it.title, false);
      return;
    }
    if (e.target.closest("[data-vc-picker-close]")) closePicker();
  });

  /* ---------------- UI: timeline ---------------- */
  function clipCardHtml(clip, idx) {
    return `
      <article class="vc-clip${clip.id === state.selectedId ? " is-selected" : ""}${clip.ready === "error" ? " is-error" : ""}" data-vc-clip="${esc(clip.id)}" draggable="true" aria-label="Timeline clip ${idx + 1}: ${esc(clip.title)}">
        ${idx > 0 && clip.transition === "fade" ? `<span class="vc-clip-fade" title="0.5s crossfade from the previous clip">fade</span>` : ""}
        <div class="vc-clip-thumb">
          ${clip.thumb ? `<img src="${esc(clip.thumb)}" alt=""/>` : `<span class="vc-clip-thumb-blank">${clip.ready === "loading" ? "…" : "—"}</span>`}
          <i class="vc-clip-kind">${clip.kind === "photo" ? "IMG" : "VID"}</i>
        </div>
        <div class="vc-clip-copy">
          <b>${esc(clip.title)}</b>
          <span><em data-vc-clip-dur>${esc(fmtSec(clipDuration(clip)))}s</em>${clip.kind === "video" && clip.mute ? " · muted" : clip.kind === "video" && clipVolume(clip) !== 100 ? ` · ${clipVolume(clip)}%` : ""}${clip.ready === "error" ? " · failed to load" : ""}</span>
        </div>
        <div class="vc-clip-actions">
          <button type="button" data-vc-move="-1" ${idx === 0 ? "disabled" : ""} aria-label="Move earlier">◀</button>
          <button type="button" data-vc-move="1" ${idx === state.clips.length - 1 ? "disabled" : ""} aria-label="Move later">▶</button>
          <button type="button" data-vc-dup aria-label="Duplicate clip">⧉</button>
          <button type="button" data-vc-del aria-label="Remove clip">✕</button>
        </div>
      </article>`;
  }
  function renderTimeline() {
    if (!state.clips.length) {
      timelineEl.innerHTML = `
        <div class="vc-empty">
          <b>Start a cut</b>
          <p>Build a video from photos alone, video clips alone, or a mix of both — nothing needs to be imported or converted first. Pull media from the Media Pool or this PC, press play, then export a real .webm.</p>
        </div>`;
      return;
    }
    timelineEl.innerHTML = state.clips.map((c, i) => clipCardHtml(c, i)).join("");
  }
  let draggingClipId = "";
  timelineEl.addEventListener("click", (e) => {
    const card = e.target.closest("[data-vc-clip]");
    if (!card) return;
    const clip = state.clips.find((c) => c.id === card.dataset.vcClip);
    if (!clip) return;
    const move = e.target.closest("[data-vc-move]");
    if (move) { moveClip(clip, Number(move.dataset.vcMove)); return; }
    if (e.target.closest("[data-vc-dup]")) { duplicateClip(clip); return; }
    if (e.target.closest("[data-vc-del]")) { removeClip(clip); return; }
    if (state.selectedId !== clip.id) { state.selectedId = clip.id; renderTimeline(); renderInspector(); }
  });
  timelineEl.addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-vc-clip]");
    if (!card || e.target.closest("button")) return;
    draggingClipId = card.dataset.vcClip || "";
    card.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggingClipId);
  });
  timelineEl.addEventListener("dragover", (e) => {
    if (!draggingClipId) return;
    const card = e.target.closest("[data-vc-clip]");
    if (!card || card.dataset.vcClip === draggingClipId) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    timelineEl.querySelectorAll(".vc-clip.is-drop-before,.vc-clip.is-drop-after").forEach((el) => el.classList.remove("is-drop-before", "is-drop-after"));
    card.classList.add(after ? "is-drop-after" : "is-drop-before");
    e.dataTransfer.dropEffect = "move";
  });
  timelineEl.addEventListener("drop", (e) => {
    const card = e.target.closest("[data-vc-clip]");
    const dragged = state.clips.find((clip) => clip.id === (e.dataTransfer.getData("text/plain") || draggingClipId));
    if (!card || !dragged || card.dataset.vcClip === dragged.id) return;
    e.preventDefault();
    const target = state.clips.find((clip) => clip.id === card.dataset.vcClip);
    if (!target) return;
    const rect = card.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    const from = state.clips.indexOf(dragged);
    let to = state.clips.indexOf(target) + (after ? 1 : 0);
    if (from >= 0 && from < to) to -= 1;
    moveClipToIndex(dragged, to);
  });
  timelineEl.addEventListener("dragend", () => {
    draggingClipId = "";
    timelineEl.querySelectorAll(".vc-clip.is-dragging,.vc-clip.is-drop-before,.vc-clip.is-drop-after").forEach((el) => el.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
  });

  /* ---------------- UI: inspector ---------------- */
  function updateCardDuration(clip) {
    const em = timelineEl.querySelector(`[data-vc-clip="${clip.id}"] [data-vc-clip-dur]`);
    if (em) em.textContent = `${fmtSec(clipDuration(clip))}s`;
  }
  function renderInspector() {
    const clip = selectedClip();
    if (!clip) {
      inspectorEl.innerHTML = state.clips.length
        ? `<p class="vc-hint">Select a clip on the timeline to edit its timing, transition, and text overlay.</p>`
        : "";
      return;
    }
    const idx = state.clips.indexOf(clip);
    const splitReady = !!splitPointForClip(clip);
    const kindPanel = clip.kind === "photo" ? `
      <section class="vc-ins-section">
        <span class="vc-microlabel">Duration</span>
        <div class="vc-ins-slider">
          <input class="vc-range" data-vc-ins-duration type="range" min="0.5" max="15" step="0.5" value="${esc(String(clip.duration))}"/>
          <em data-vc-ins-duration-out>${esc(fmtSec(clip.duration))}s</em>
        </div>
        <label class="vc-check"><input type="checkbox" data-vc-ins-kenburns ${clip.kenBurns ? "checked" : ""}/> Ken Burns <i>slow pan + zoom, same path on every replay</i></label>
      </section>` : `
      <section class="vc-ins-section">
        <span class="vc-microlabel">Trim</span>
        ${clip.ready === "ready" ? `
          <div class="vc-ins-slider">
            <b>In</b>
            <input class="vc-range" data-vc-ins-in type="range" min="0" max="${esc(String(clip.srcDuration))}" step="0.05" value="${esc(String(clip.in))}"/>
            <em data-vc-ins-in-out>${esc(fmtSec(clip.in))}s</em>
          </div>
          <div class="vc-ins-slider">
            <b>Out</b>
            <input class="vc-range" data-vc-ins-out type="range" min="0" max="${esc(String(clip.srcDuration))}" step="0.05" value="${esc(String(clip.out))}"/>
            <em data-vc-ins-out-out>${esc(fmtSec(clip.out))}s</em>
          </div>
          <div class="vc-ins-slider">
            <b>Vol</b>
            <input class="vc-range" data-vc-ins-volume type="range" min="0" max="100" step="1" value="${esc(String(clipVolume(clip)))}"/>
            <em data-vc-ins-volume-out>${esc(String(clipVolume(clip)))}%</em>
          </div>
          <label class="vc-check"><input type="checkbox" data-vc-ins-mute ${clip.mute ? "checked" : ""}/> Mute this clip's audio</label>
        ` : clip.ready === "error"
          ? `<i class="vc-ins-note">This video failed to load, so it has nothing to trim.</i>`
          : `<i class="vc-ins-note">Reading video metadata…</i>`}
      </section>`;
    inspectorEl.innerHTML = `
      <div class="vc-ins-grid">
        <section class="vc-ins-section">
          <span class="vc-microlabel">Clip ${idx + 1} · ${clip.kind === "photo" ? "photo" : "video"}</span>
          <b class="vc-ins-title">${esc(clip.title)}</b>
          ${clip.ready === "error" ? `<i class="vc-ins-note vc-ins-error">This media failed to load — it renders as a blank slate in the cut.</i>` : ""}
          <div class="vc-ins-tools">
            <button type="button" data-vc-ins-split ${splitReady ? "" : "disabled"}>Split at playhead</button>
            <i>${splitReady ? "Cuts this clip into two timeline pieces." : "Move the playhead inside this clip to split it."}</i>
          </div>
        </section>
        <section class="vc-ins-section">
          <span class="vc-microlabel">Transition in</span>
          <select class="vc-select" data-vc-ins-transition ${idx === 0 ? "disabled" : ""}>
            <option value="none" ${clip.transition !== "fade" ? "selected" : ""}>Cut</option>
            <option value="fade" ${clip.transition === "fade" ? "selected" : ""}>Crossfade · 0.5s</option>
          </select>
          ${idx === 0 ? `<i class="vc-ins-note">The first clip has nothing to fade from.</i>` : ""}
        </section>
        <section class="vc-ins-section">
          <span class="vc-microlabel">Framing</span>
          <select class="vc-select" data-vc-ins-fit>
            <option value="cover" ${clip.fit !== "contain" ? "selected" : ""}>Fill frame · crop edges</option>
            <option value="contain" ${clip.fit === "contain" ? "selected" : ""}>Fit full media · blurred backdrop</option>
          </select>
          <i class="vc-ins-note">${clip.fit === "contain" ? "Shows the whole source without cropping." : "Fills the export frame like a social video."}</i>
        </section>
        <section class="vc-ins-section">
          <span class="vc-microlabel">Fade</span>
          <div class="vc-ins-slider">
            <b>In</b>
            <input class="vc-range" data-vc-ins-fade="fadeIn" type="range" min="0" max="3" step="0.1" value="${esc(String(clipFadeValue(clip, "fadeIn")))}"/>
            <em data-vc-ins-fade-out="fadeIn">${esc(fmtSec(clipFadeValue(clip, "fadeIn")))}s</em>
          </div>
          <div class="vc-ins-slider">
            <b>Out</b>
            <input class="vc-range" data-vc-ins-fade="fadeOut" type="range" min="0" max="3" step="0.1" value="${esc(String(clipFadeValue(clip, "fadeOut")))}"/>
            <em data-vc-ins-fade-out="fadeOut">${esc(fmtSec(clipFadeValue(clip, "fadeOut")))}s</em>
          </div>
          <i class="vc-ins-note">${clip.kind === "video" ? "Fades picture and clip audio together." : "Fades the photo and text overlay."}</i>
        </section>
        ${kindPanel}
        <section class="vc-ins-section">
          <span class="vc-microlabel">Text overlay</span>
          <input class="vc-text-in" data-vc-ins-text maxlength="80" placeholder="Optional single line…" value="${esc(clip.text)}"/>
          <select class="vc-select" data-vc-ins-textpos>
            <option value="bottom" ${clip.textPos !== "center" ? "selected" : ""}>Bottom</option>
            <option value="center" ${clip.textPos === "center" ? "selected" : ""}>Center</option>
          </select>
        </section>
      </div>`;
    const iq = (sel) => inspectorEl.querySelector(sel);
    iq("[data-vc-ins-split]")?.addEventListener("click", () => splitClipAtPlayhead(clip));
    iq("[data-vc-ins-transition]")?.addEventListener("change", (e) => {
      clip.transition = e.target.value === "fade" ? "fade" : "none";
      renderTimeline(); updateMeta();
    });
    iq("[data-vc-ins-fit]")?.addEventListener("change", (e) => {
      clip.fit = e.target.value === "contain" ? "contain" : "cover";
      drawFrame(state.playhead);
      renderInspector();
    });
    inspectorEl.querySelectorAll("[data-vc-ins-fade]").forEach((input) => {
      input.addEventListener("input", (e) => {
        const key = e.target.dataset.vcInsFade === "fadeOut" ? "fadeOut" : "fadeIn";
        clip[key] = clipFadeValue({ ...clip, [key]: e.target.value }, key);
        e.target.value = String(clip[key]);
        const out = iq(`[data-vc-ins-fade-out="${key}"]`);
        if (out) out.textContent = `${fmtSec(clip[key])}s`;
        drawFrame(state.playhead);
      });
    });
    // slider drags update readouts in place — a re-render mid-drag would drop the thumb
    iq("[data-vc-ins-duration]")?.addEventListener("input", (e) => {
      clip.duration = clamp(Number(e.target.value) || 3, 0.5, 15);
      const out = iq("[data-vc-ins-duration-out]");
      if (out) out.textContent = `${fmtSec(clip.duration)}s`;
      updateCardDuration(clip); updateMeta();
    });
    iq("[data-vc-ins-kenburns]")?.addEventListener("change", (e) => { clip.kenBurns = e.target.checked; });
    iq("[data-vc-ins-in]")?.addEventListener("input", (e) => {
      clip.in = clamp(Number(e.target.value) || 0, 0, Math.max(0, clip.out - 0.1));
      e.target.value = String(clip.in);
      const out = iq("[data-vc-ins-in-out]");
      if (out) out.textContent = `${fmtSec(clip.in)}s`;
      updateCardDuration(clip); updateMeta();
    });
    iq("[data-vc-ins-out]")?.addEventListener("input", (e) => {
      clip.out = clamp(Number(e.target.value) || clip.srcDuration, clip.in + 0.1, clip.srcDuration);
      e.target.value = String(clip.out);
      const out = iq("[data-vc-ins-out-out]");
      if (out) out.textContent = `${fmtSec(clip.out)}s`;
      updateCardDuration(clip); updateMeta();
    });
    iq("[data-vc-ins-volume]")?.addEventListener("input", (e) => {
      clip.volume = clipVolume({ volume: e.target.value });
      e.target.value = String(clip.volume);
      if (clip.el) clip.el.volume = clip.volume / 100;
      const out = iq("[data-vc-ins-volume-out]");
      if (out) out.textContent = `${clip.volume}%`;
      renderTimeline();
    });
    iq("[data-vc-ins-mute]")?.addEventListener("change", (e) => {
      clip.mute = e.target.checked;
      if (clip.el) clip.el.muted = clip.mute;
      renderTimeline();
    });
    iq("[data-vc-ins-text]")?.addEventListener("input", (e) => { clip.text = e.target.value; });
    iq("[data-vc-ins-textpos]")?.addEventListener("change", (e) => { clip.textPos = e.target.value === "center" ? "center" : "bottom"; });
  }

  function updateMeta() {
    const total = totalDuration();
    refs.total.textContent = fmtTime(total);
    refs.exportBtn.disabled = !recorderMime || !state.clips.length || total <= 0 || !!exportRun;
    if (state.playhead > total) state.playhead = total;
  }
  function renderAll() { renderTimeline(); renderInspector(); updateMeta(); }

  /* ---------------- static wiring ---------------- */
  q("[data-vc-title]").addEventListener("input", (e) => { state.title = e.target.value || "PhantomCut edit"; });
  q("[data-vc-aspect]").addEventListener("change", (e) => {
    if (exportRun) return;
    state.aspect = ASPECTS[e.target.value] ? e.target.value : "16:9";
    setPreviewSize();
  });
  q("[data-vc-res]").addEventListener("change", (e) => { state.res = e.target.value === "1080p" ? "1080p" : "720p"; });
  refs.play.addEventListener("click", togglePlay);
  refs.scrub.addEventListener("click", (e) => {
    const rect = refs.scrub.getBoundingClientRect();
    if (rect.width > 0) seekTo(((e.clientX - rect.left) / rect.width) * totalDuration());
  });
  refs.exportBtn.addEventListener("click", startExport);
  q("[data-vc-export-cancel]").addEventListener("click", () => stopRecorder(true));
  const isTypingTarget = (target) => !!(target && target.closest && target.closest("input, textarea, select, button, [contenteditable]"));
  const onKey = (e) => {
    if (exportRun || !root.isConnected || isTypingTarget(e.target)) return;
    const clip = selectedClip();
    const key = String(e.key || "").toLowerCase();
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      if (clip) duplicateClip(clip);
      return;
    }
    if ((key === "backspace" || key === "delete") && clip) {
      e.preventDefault();
      removeClip(clip);
      return;
    }
    if (key === "s" && clip) {
      e.preventDefault();
      splitClipAtPlayhead(clip);
    }
  };
  document.addEventListener("keydown", onKey);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("keydown", onKey);
    if (exportRun) {
      const run = exportRun;
      exportRun = null;
      run.cancelled = true;
      run.stopping = true;
      try { run.rec.stop(); } catch {}
    }
    for (const c of state.clips) {
      try { c.el?.pause?.(); } catch {}
      if (c.el && c.el.remove) c.el.remove();
    }
    clearMusic();
    for (const u of ownedUrls.splice(0)) { try { URL.revokeObjectURL(u); } catch {} }
    if (audio.ctx) { try { audio.ctx.close(); } catch {} audio.ctx = null; }
    if (host.__phantomCutDestroy === destroy) delete host.__phantomCutDestroy;
    host.innerHTML = "";
  }
  host.__phantomCutDestroy = destroy;

  setPreviewSize();
  renderAddRow();
  renderAll();
  raf = requestAnimationFrame(tick);
  return { destroy, addClip: (kind, url, title) => addClip(kind, url, title, false) };
}
