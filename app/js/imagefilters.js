/* PhantomForce — shared canvas image-filter engine: adjust/rotate/flip/text
   overlay plus a local, honest "AI edit" heuristic that maps a text prompt
   to filter presets. Pure functions, no network calls, no module-level
   state — Media Lab's Edit tab and Content Hub's inline image editor both
   import this so the actual pixel work only lives in one tested place. */

export function freshEditState() {
  return { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, rotate: 0, flip: false, text: "" };
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

export function paintEdit(canvas, img, state) {
  canvas._img = img;
  const rot = state.rotate % 180 !== 0;
  const w = img.naturalWidth, h = img.naturalHeight;
  canvas.width = rot ? h : w; canvas.height = rot ? w : h;
  const g = canvas.getContext("2d");
  g.save();
  g.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturate}%) hue-rotate(${state.hue}deg) blur(${state.blur}px)`;
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(state.rotate * Math.PI / 180);
  g.scale(state.flip ? -1 : 1, 1);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
  if (state.text) {
    const fs = Math.max(18, canvas.width * 0.06);
    g.font = `700 ${fs}px "Space Grotesk", sans-serif`;
    g.textAlign = "center"; g.lineWidth = fs * 0.14; g.strokeStyle = "rgba(0,0,0,0.55)";
    g.fillStyle = "#eafff4";
    g.strokeText(state.text, canvas.width / 2, canvas.height - fs);
    g.fillText(state.text, canvas.width / 2, canvas.height - fs);
  }
}
