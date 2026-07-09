/* PhantomForce — shared canvas image-filter engine: adjust/rotate/flip/text
   overlay, subject bokeh, plus a local, honest "AI edit" heuristic that maps
   a text prompt to filter presets. Pure functions, no network calls, no
   module-level state — Media Lab's Edit tab and Content Hub's inline image
   editor both import this so the actual pixel work only lives in one tested
   place. */

export function freshEditState() {
  return { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, rotate: 0, flip: false, text: "", bokeh: null, bokehBrush: 24 };
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
   state.bokeh = { spots: [{x, y, r}, ...], strength } — each spot is a
   paintable focus circle (x/y 0..1 normalized, r 0..1 relative to
   min(width,height)) so an irregular subject can be covered with several
   clicks; strength is the shared background blur in px. Composited as a
   real edit (baked into export); the on-canvas markers are a separate DOM
   overlay drawn by the caller, never part of the exported pixels. */
export function freshBokeh() {
  return { spots: [], strength: 20 };
}
export function addBokehSpot(state, x, y, r) {
  if (!state.bokeh) state.bokeh = freshBokeh();
  state.bokeh.spots.push({ x, y, r });
  return state.bokeh;
}
export function removeBokehSpotNear(state, x, y) {
  if (!state.bokeh || !state.bokeh.spots.length) return false;
  let bestIdx = -1, bestDist = Infinity;
  state.bokeh.spots.forEach((spot, i) => {
    const d = Math.hypot(spot.x - x, spot.y - y);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  });
  if (bestIdx === -1) return false;
  state.bokeh.spots.splice(bestIdx, 1);
  if (!state.bokeh.spots.length) state.bokeh = null;
  return true;
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

export function paintEdit(canvas, img, state) {
  canvas._img = img;
  const g = canvas.getContext("2d");
  drawFrame(g, img, state);

  if (state.bokeh && state.bokeh.spots && state.bokeh.spots.length) {
    const w = canvas.width, h = canvas.height;
    const bg = document.createElement("canvas");
    bg.width = w; bg.height = h;
    const bgCtx = bg.getContext("2d");
    drawFrame(bgCtx, img, state, ` blur(${state.bokeh.strength}px)`);
    bgCtx.globalCompositeOperation = "destination-out";
    state.bokeh.spots.forEach((spot) => {
      const cx = spot.x * w, cy = spot.y * h;
      const r = Math.max(8, spot.r * Math.min(w, h));
      const grad = bgCtx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      bgCtx.fillStyle = grad;
      bgCtx.beginPath(); bgCtx.arc(cx, cy, r, 0, Math.PI * 2); bgCtx.fill();
    });
    g.drawImage(bg, 0, 0);
  }

  if (state.text) {
    const fs = Math.max(18, canvas.width * 0.06);
    g.font = `700 ${fs}px "Space Grotesk", sans-serif`;
    g.textAlign = "center"; g.lineWidth = fs * 0.14; g.strokeStyle = "rgba(0,0,0,0.55)";
    g.fillStyle = "#eafff4";
    g.strokeText(state.text, canvas.width / 2, canvas.height - fs);
    g.fillText(state.text, canvas.width / 2, canvas.height - fs);
  }
}
