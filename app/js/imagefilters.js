/* PhantomForce — shared canvas image-filter engine: adjust/rotate/flip/text
   overlay, subject bokeh, plus a local, honest "AI edit" heuristic that maps
   a text prompt to filter presets. Pure functions, no network calls, no
   module-level state — Media Lab's Edit tab and Content Hub's inline image
   editor both import this so the actual pixel work only lives in one tested
   place. */

export function freshTextStyle() {
  return {
    font: "Space Grotesk", size: 6, bold: true, italic: false,
    color: "#eafff4", align: "center", x: 50, y: 90, width: 86, opacity: 100,
    outline: true, outlineColor: "#000000", outlineWidth: 14, shadow: true,
    preset: "custom",
  };
}

export function freshEditState() {
  return {
    brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, rotate: 0, flip: false,
    text: "", textStyle: freshTextStyle(),
    bokeh: null, bokehBrush: 24,
  };
}

/* System/app fonts only — nothing that can silently fail to load. Brand Kit
   fonts aren't a real feature yet; when that lands, its fonts append here. */
export const TEXT_FONTS = ["Space Grotesk", "DM Mono", "Arial", "Georgia", "Impact", "Courier New"];

/* Layout presets: position, size, and typography only — no background
   shapes, so nothing here can misrepresent itself as a full graphic template. */
export const TEXT_PRESETS = {
  "thumbnail-title": { size: 9, x: 50, y: 88, width: 90, align: "center", bold: true, italic: false, color: "#ffffff", outline: true, outlineWidth: 18, shadow: true },
  "lower-third": { size: 5, x: 8, y: 88, width: 60, align: "left", bold: true, italic: false, color: "#ffffff", outline: false, outlineWidth: 0, shadow: true },
  "top-banner": { size: 6, x: 50, y: 10, width: 90, align: "center", bold: true, italic: false, color: "#ffffff", outline: true, outlineWidth: 12, shadow: false },
  "center-headline": { size: 10, x: 50, y: 50, width: 80, align: "center", bold: true, italic: false, color: "#ffffff", outline: true, outlineWidth: 16, shadow: true },
  "sale-badge": { size: 8, x: 82, y: 18, width: 32, align: "center", bold: true, italic: false, color: "#02140b", outline: false, outlineWidth: 0, shadow: false },
  "quote-card": { size: 5.5, x: 50, y: 50, width: 74, align: "center", bold: false, italic: true, color: "#eafff4", outline: false, outlineWidth: 0, shadow: false },
  "sports-graphic": { size: 9, x: 50, y: 82, width: 92, align: "center", bold: true, italic: true, color: "#ffe14d", outline: true, outlineWidth: 20, shadow: true },
  "product-label": { size: 4.5, x: 50, y: 92, width: 70, align: "center", bold: true, italic: false, color: "#ffffff", outline: false, outlineWidth: 0, shadow: true },
  "clean-caption": { size: 4, x: 50, y: 94, width: 80, align: "center", bold: false, italic: false, color: "#eafff4", outline: false, outlineWidth: 0, shadow: true },
};
export function applyTextPreset(state, presetId) {
  const preset = TEXT_PRESETS[presetId];
  if (!preset) return state;
  if (!state.textStyle) state.textStyle = freshTextStyle();
  Object.assign(state.textStyle, preset, { preset: presetId });
  return state;
}

export const FILTER_PRESETS = {
  none: [100, 100, 100, 0, 0],
  noir: [105, 120, 0, 0, 0],
  emerald: [100, 110, 150, 130, 0],
  warm: [108, 105, 135, 20, 0],
  cold: [98, 108, 90, 210, 0],
  vivid: [105, 125, 175, 0, 0],
};

export function applyFilterPreset(v, state) {
  const [b, c, s, h, bl] = FILTER_PRESETS[v] || FILTER_PRESETS.none;
  Object.assign(state, { brightness: b, contrast: c, saturate: s, hue: h, blur: bl });
  return state;
}

/* Local heuristic preview only — a real provider edit call is what would
   actually run the prompt; this keeps the studio usable and honest when
   no edit backend is connected, same as the rest of Media Lab. */
export function heuristicAiEdit(query, state) {
  const q = String(query || "").toLowerCase();
  if (/night|dark|noir/.test(q)) Object.assign(state, { brightness: 70, saturate: 80, hue: 210 });
  else if (/warm|sunset|golden/.test(q)) Object.assign(state, { brightness: 108, saturate: 140, hue: 20 });
  else if (/emerald|phantom|neon|green/.test(q)) Object.assign(state, { saturate: 160, hue: 130 });
  else if (/vivid|pop|vibrant/.test(q)) Object.assign(state, { saturate: 175, contrast: 120 });
  else Object.assign(state, { contrast: 115, saturate: 130 });
  return state;
}

/* ---------------- subject bokeh ----------------
   state.bokeh = { spots: [{x, y, r}, ...], strength, feather, maskImg } —
   maskImg (when set) is a decoded <img> of a real rembg segmentation cutout
   for this photo: its alpha channel IS the subject silhouette, so it cuts
   an exact hole in the blurred background layer — concave gaps (the space
   between a cat's two ears, for example) fall outside the silhouette and
   blur correctly, which no circle-based click ever could. Manual spots
   layer on top as an additive refinement (nudge extra sharp regions in),
   not a replacement. maskImg is a live in-memory <img>, never persisted —
   state itself is never JSON-serialized (Save bakes pixels, not state), so
   this is safe to hold directly. strength is the shared background blur in
   px, feather (0..1) softens spot edges and the mask edge alike. Composited
   as a real edit (baked into export); the on-canvas markers are a separate
   DOM overlay drawn by the caller, never part of the exported pixels. */
export function freshBokeh() {
  return { spots: [], strength: 20, feather: 0.45, maskImg: null };
}
/* Stores a decoded segmentation-mask <img> (its alpha = subject silhouette)
   as the AI-detected cutout for this bokeh. */
export function setBokehMask(state, maskImg) {
  if (!state.bokeh) state.bokeh = freshBokeh();
  state.bokeh.maskImg = maskImg;
  return state.bokeh;
}
export function addBokehSpot(state, x, y, r) {
  if (!state.bokeh) state.bokeh = freshBokeh();
  state.bokeh.spots.push({ x, y, r });
  return state.bokeh.spots.length - 1;
}
export function removeBokehSpotNear(state, x, y) {
  const idx = nearestBokehSpot(state, x, y);
  if (idx === -1) return false;
  state.bokeh.spots.splice(idx, 1);
  if (!state.bokeh.spots.length) state.bokeh = null;
  return true;
}
export function removeBokehSpotAt(state, index) {
  if (!state.bokeh || !state.bokeh.spots[index]) return false;
  state.bokeh.spots.splice(index, 1);
  if (!state.bokeh.spots.length) state.bokeh = null;
  return true;
}
/* Nearest spot index within click distance (in normalized 0..1 space),
   or -1 — shared by remove-on-right-click and select-on-click. */
export function nearestBokehSpot(state, x, y, maxDist = Infinity) {
  if (!state.bokeh || !state.bokeh.spots.length) return -1;
  let bestIdx = -1, bestDist = Infinity;
  state.bokeh.spots.forEach((spot, i) => {
    const d = Math.hypot(spot.x - x, spot.y - y);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  });
  return bestDist <= maxDist ? bestIdx : -1;
}
export function moveBokehSpot(state, index, x, y) {
  const spot = state.bokeh?.spots?.[index];
  if (!spot) return false;
  spot.x = Math.max(0, Math.min(1, x));
  spot.y = Math.max(0, Math.min(1, y));
  return true;
}
export function resizeBokehSpot(state, index, r) {
  const spot = state.bokeh?.spots?.[index];
  if (!spot) return false;
  spot.r = Math.max(0.02, Math.min(0.9, r));
  return true;
}

/* A real (not fake) but simple pixel-contrast heuristic — no ML model, no
   network call. Downsamples the canvas, scores each cell by local contrast
   with a mild center bias (subjects are usually more centered than busy
   edges/corners), and returns the highest-scoring cell as a normalized
   starting point. Always label the result "estimated" in the UI, never
   "detected" — it can be wrong, especially on flat or very busy images. */
export function estimateSubjectPoint(canvas) {
  const SIZE = 64;
  const off = document.createElement("canvas");
  off.width = SIZE; off.height = SIZE;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(canvas, 0, 0, SIZE, SIZE);
  let data;
  try { data = octx.getImageData(0, 0, SIZE, SIZE).data; }
  catch { return null; }
  const gray = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const o = i * 4;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  let bestScore = -Infinity, bestX = 0.5, bestY = 0.42;
  const cx = SIZE / 2, cy = SIZE / 2, maxDist = Math.hypot(cx, cy);
  for (let y = 2; y < SIZE - 2; y++) {
    for (let x = 2; x < SIZE - 2; x++) {
      const i = y * SIZE + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + SIZE] - gray[i - SIZE];
      const edge = Math.hypot(gx, gy);
      const dist = Math.hypot(x - cx, y - cy) / maxDist;
      const score = edge * (1 - dist * 0.55);
      if (score > bestScore) { bestScore = score; bestX = x / SIZE; bestY = y / SIZE; }
    }
  }
  return { x: bestX, y: bestY };
}

function drawFrame(ctx, img, state, extraFilter = "") {
  const rot = state.rotate % 180 !== 0;
  const w = img.naturalWidth, h = img.naturalHeight;
  ctx.canvas.width = rot ? h : w; ctx.canvas.height = rot ? w : h;
  ctx.save();
  ctx.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturate}%) hue-rotate(${state.hue}deg) blur(${state.blur}px)${extraFilter}`;
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
  ctx.rotate(state.rotate * Math.PI / 180);
  ctx.scale(state.flip ? -1 : 1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/* Full-resolution render of just the base frame (adjust/rotate/flip), no
   bokeh, no text overlay — what an AI subject-detection call should send,
   so the segmentation isn't confused by an overlay or a previous mask. */
export function renderBaseFrame(img, state) {
  const c = document.createElement("canvas");
  drawFrame(c.getContext("2d"), img, state);
  return c;
}

export function paintEdit(canvas, img, state) {
  canvas._img = img;
  const g = canvas.getContext("2d");
  drawFrame(g, img, state);

  const hasSpots = state.bokeh && state.bokeh.spots && state.bokeh.spots.length;
  const hasMask = state.bokeh && state.bokeh.maskImg;
  if (hasSpots || hasMask) {
    const w = canvas.width, h = canvas.height;
    const bg = document.createElement("canvas");
    bg.width = w; bg.height = h;
    const bgCtx = bg.getContext("2d");
    drawFrame(bgCtx, img, state, ` blur(${state.bokeh.strength}px)`);
    bgCtx.globalCompositeOperation = "destination-out";
    const feather = state.bokeh.feather ?? 0.45;
    if (hasMask) {
      const featherPx = Math.max(0, feather * 14);
      bgCtx.save();
      bgCtx.filter = featherPx > 0.3 ? `blur(${featherPx}px)` : "none";
      bgCtx.drawImage(state.bokeh.maskImg, 0, 0, w, h);
      bgCtx.restore();
    }
    if (hasSpots) state.bokeh.spots.forEach((spot) => {
      const cx = spot.x * w, cy = spot.y * h;
      const r = Math.max(8, spot.r * Math.min(w, h));
      const grad = bgCtx.createRadialGradient(cx, cy, Math.max(0, r * (1 - feather)), cx, cy, r);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      bgCtx.fillStyle = grad;
      bgCtx.beginPath(); bgCtx.arc(cx, cy, r, 0, Math.PI * 2); bgCtx.fill();
    });
    g.drawImage(bg, 0, 0);
  }

  if (state.text) drawTextOverlay(g, canvas, state);
}

/* Greedy word-wrap into lines that fit maxWidth at the current g.font. */
function wrapTextLines(g, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (g.measureText(attempt).width > maxWidth && line) { lines.push(line); line = word; }
    else line = attempt;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function drawTextOverlay(g, canvas, state) {
  const st = { ...freshTextStyle(), ...(state.textStyle || {}) };
  const fs = Math.max(12, canvas.width * (st.size / 100));
  const weight = st.bold ? "700" : "400";
  const style = st.italic ? "italic" : "normal";
  const fontStack = st.font === "Space Grotesk" ? '"Space Grotesk", sans-serif'
    : st.font === "DM Mono" ? '"DM Mono", monospace'
    : `"${st.font}", sans-serif`;
  g.font = `${style} ${weight} ${fs}px ${fontStack}`;
  g.textAlign = st.align === "left" ? "left" : st.align === "right" ? "right" : "center";
  g.textBaseline = "alphabetic";

  const maxWidth = canvas.width * (st.width / 100);
  const lines = wrapTextLines(g, state.text, maxWidth);
  const lineHeight = fs * 1.22;
  const totalHeight = lineHeight * lines.length;
  const anchorX = canvas.width * (st.x / 100);
  const anchorY = canvas.height * (st.y / 100);
  // y anchors the LAST line's baseline so a fixed position (e.g. "lower
  // third") stays put as the caption grows upward, not downward off-canvas.
  const firstBaseline = anchorY - totalHeight + lineHeight;

  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, st.opacity / 100));
  if (st.shadow) {
    g.shadowColor = "rgba(0,0,0,0.55)";
    g.shadowBlur = fs * 0.22;
    g.shadowOffsetY = fs * 0.05;
  }
  lines.forEach((line, i) => {
    const y = firstBaseline + i * lineHeight;
    if (st.outline && st.outlineWidth > 0) {
      g.lineWidth = fs * (st.outlineWidth / 100);
      g.strokeStyle = st.outlineColor || "#000000";
      g.lineJoin = "round";
      g.strokeText(line, anchorX, y);
    }
    g.fillStyle = st.color || "#eafff4";
    g.fillText(line, anchorX, y);
  });
  g.restore();
}
