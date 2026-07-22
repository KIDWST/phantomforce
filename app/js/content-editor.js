import { freshEditState, freshTextStyle, paintEdit } from "./imagefilters.js?v=phantom-live-20260722-5";

let layerSequence = 0;

function id(prefix = "layer") {
  layerSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${layerSequence.toString(36)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

const BLEND_MODES = new Set(["source-over", "multiply", "screen", "overlay", "soft-light", "hard-light", "color-dodge", "color-burn", "luminosity"]);
function blendMode(value) {
  return BLEND_MODES.has(value) ? value : "source-over";
}

export function cloneImageEditState(source = {}, opts = {}) {
  const base = freshEditState();
  const state = { ...base, ...(source || {}) };
  const includeMask = opts.includeMask !== false;
  const bokeh = state.bokeh ? {
    ...state.bokeh,
    spots: (state.bokeh.spots || []).map((spot) => ({ ...spot })),
    maskImg: includeMask ? (opts.maskImg ?? state.bokeh.maskImg ?? null) : null,
  } : null;
  const paint = state.paint ? {
    size: Number(state.paint.size || 26),
    opacity: Number(state.paint.opacity || 84),
    strokes: Array.isArray(state.paint.strokes)
      ? state.paint.strokes.map((stroke) => ({
          mode: stroke.mode === "erase" ? "erase" : "paint",
          color: stroke.color || "#6649f7",
          size: Number(stroke.size || state.paint.size || 26),
          opacity: Number(stroke.opacity || state.paint.opacity || 84),
          points: Array.isArray(stroke.points) ? stroke.points.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })) : [],
        }))
      : [],
  } : null;
  return {
    ...state,
    crop: { ...base.crop, ...(state.crop || {}) },
    textStyle: { ...freshTextStyle(), ...(state.textStyle || {}) },
    bokeh,
    paint,
  };
}

export function imageEditSnapshot(source = {}) {
  return cloneImageEditState(source, { includeMask: false });
}

export function restoreImageEditSnapshot(snapshot = {}, opts = {}) {
  return cloneImageEditState(snapshot, {
    includeMask: !!opts.maskImg,
    maskImg: opts.maskImg || null,
  });
}

export function pushEditorSnapshot(stack, snapshot, limit = 60) {
  if (!Array.isArray(stack)) return [snapshot];
  stack.push(snapshot);
  if (stack.length > limit) stack.shift();
  return stack;
}

export function freshComposition() {
  return {
    width: 0,
    height: 0,
    zoom: 1,
    layers: [{
      id: "base",
      type: "base",
      name: "Main image",
      visible: true,
      locked: false,
      x: 0.5,
      y: 0.5,
      w: 1,
      h: 1,
      rotation: 0,
      opacity: 1,
      blend: "source-over",
      fit: "cover",
    }],
    selectedIds: ["base"],
    imageCache: new Map(),
  };
}

export function compositionSnapshot(composition) {
  return {
    width: composition.width,
    height: composition.height,
    zoom: composition.zoom,
    layers: composition.layers.map((layer) => {
      const clean = { ...layer };
      delete clean.image;
      return clean;
    }),
    selectedIds: [...composition.selectedIds],
  };
}

export function restoreComposition(composition, snapshot) {
  composition.width = Number(snapshot?.width || 0);
  composition.height = Number(snapshot?.height || 0);
  composition.zoom = clamp(snapshot?.zoom ?? 1, 0.25, 4);
  composition.layers = Array.isArray(snapshot?.layers) ? snapshot.layers.map((layer) => ({ ...layer })) : [];
  if (!composition.layers.some((layer) => layer.id === "base")) composition.layers.push(freshComposition().layers[0]);
  composition.selectedIds = Array.isArray(snapshot?.selectedIds) ? [...snapshot.selectedIds] : ["base"];
  composition.imageCache = composition.imageCache instanceof Map ? composition.imageCache : new Map();
  return composition;
}

export function addImageLayer(composition, src, name = "Image layer", { background = false } = {}) {
  const layer = {
    id: id(background ? "background" : "image"),
    type: "image",
    name,
    src,
    visible: true,
    locked: false,
    x: 0.5,
    y: 0.5,
    w: background ? 1 : 0.52,
    h: background ? 1 : 0.52,
    rotation: 0,
    opacity: 1,
    blend: "source-over",
    fit: background ? "cover" : "contain",
  };
  const baseIndex = composition.layers.findIndex((item) => item.id === "base");
  if (background) composition.layers.splice(Math.max(0, baseIndex), 0, layer);
  else composition.layers.push(layer);
  composition.selectedIds = [layer.id];
  return layer;
}

export function replaceImageLayerSource(composition, layerId, src, image, { transparent = false } = {}) {
  const layer = composition.layers.find((item) => item.id === layerId && item.type === "image");
  if (!layer || !src) return null;
  layer.src = src;
  layer.hasTransparency = !!transparent;
  if (image) composition.imageCache.set(src, image);
  composition.selectedIds = [layer.id];
  return layer;
}

export function addTextLayer(composition, text = "Your headline") {
  const layer = {
    id: id("text"),
    type: "text",
    name: "Headline",
    text,
    visible: true,
    locked: false,
    x: 0.5,
    y: 0.78,
    w: 0.78,
    h: 0.18,
    rotation: 0,
    opacity: 1,
    blend: "source-over",
    font: "Instrument Sans",
    fontSize: 8,
    color: "#ffffff",
    background: "#000000",
    backgroundOpacity: 0,
    bold: true,
    align: "center",
    shadow: true,
  };
  composition.layers.push(layer);
  composition.selectedIds = [layer.id];
  return layer;
}

export function addColorLayer(composition, color = "#141025") {
  const layer = {
    id: id("color"),
    type: "color",
    name: "Color background",
    color,
    visible: true,
    locked: false,
    x: 0.5,
    y: 0.5,
    w: 1,
    h: 1,
    rotation: 0,
    opacity: 1,
    blend: "source-over",
    radius: 0,
  };
  const baseIndex = composition.layers.findIndex((item) => item.id === "base");
  composition.layers.splice(Math.max(0, baseIndex), 0, layer);
  composition.selectedIds = [layer.id];
  return layer;
}

export function duplicateLayer(composition, layerId) {
  const index = composition.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return null;
  const source = composition.layers[index];
  if (source.id === "base") return null;
  const copy = { ...source, id: id(source.type), name: `${source.name} copy`, x: clamp(source.x + 0.03, 0, 1), y: clamp(source.y + 0.03, 0, 1) };
  composition.layers.splice(index + 1, 0, copy);
  composition.selectedIds = [copy.id];
  return copy;
}

export function removeSelectedLayers(composition) {
  const selected = new Set(composition.selectedIds);
  const removed = composition.layers.filter((layer) => selected.has(layer.id) && layer.id !== "base" && !layer.locked);
  composition.layers = composition.layers.filter((layer) => !removed.includes(layer));
  composition.selectedIds = composition.layers.some((layer) => layer.id === "base") ? ["base"] : [];
  return removed.length;
}

export function moveLayerOrder(composition, layerId, direction) {
  const index = composition.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;
  const next = clamp(index + direction, 0, composition.layers.length - 1);
  if (next === index) return false;
  const [layer] = composition.layers.splice(index, 1);
  composition.layers.splice(next, 0, layer);
  return true;
}

export function moveLayerToIndex(composition, layerId, targetIndex) {
  const index = composition.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return false;
  const next = clamp(Math.round(Number(targetIndex) || 0), 0, composition.layers.length - 1);
  if (next === index) return false;
  const [layer] = composition.layers.splice(index, 1);
  composition.layers.splice(next, 0, layer);
  composition.selectedIds = [layer.id];
  return true;
}

export function selectedLayers(composition) {
  const selected = new Set(composition.selectedIds);
  return composition.layers.filter((layer) => selected.has(layer.id));
}

export function selectLayer(composition, layerId, additive = false) {
  if (!layerId) {
    composition.selectedIds = [];
    return;
  }
  if (!additive) composition.selectedIds = [layerId];
  else if (composition.selectedIds.includes(layerId)) composition.selectedIds = composition.selectedIds.filter((idValue) => idValue !== layerId);
  else composition.selectedIds = [...composition.selectedIds, layerId];
}

export function selectAllLayers(composition) {
  composition.selectedIds = composition.layers.filter((layer) => layer.visible && !layer.locked).map((layer) => layer.id);
}

export async function loadCompositionImages(composition, loader) {
  const imageLayers = composition.layers.filter((layer) => layer.type === "image" && layer.src);
  await Promise.all(imageLayers.map(async (layer) => {
    if (composition.imageCache.has(layer.src)) return;
    try { composition.imageCache.set(layer.src, await loader(layer.src)); }
    catch { composition.imageCache.set(layer.src, null); }
  }));
}

function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.min(Math.max(0, radius), Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawImageFit(ctx, image, x, y, w, h, fit) {
  const iw = image.naturalWidth || image.width || 1;
  const ih = image.naturalHeight || image.height || 1;
  const scale = fit === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) { lines.push(current); current = word; }
    else current = next;
  });
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawText(ctx, layer, width, height) {
  const boxW = layer.w * width;
  const boxH = layer.h * height;
  const fontSize = Math.max(12, width * (layer.fontSize / 100));
  ctx.font = `${layer.bold ? 700 : 400} ${fontSize}px "${layer.font || "Instrument Sans"}", sans-serif`;
  ctx.textAlign = layer.align || "center";
  ctx.textBaseline = "middle";
  if ((layer.backgroundOpacity || 0) > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(layer.backgroundOpacity, 0, 1);
    ctx.fillStyle = layer.background || "#000000";
    roundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, Math.min(boxW, boxH) * 0.08);
    ctx.fill();
    ctx.restore();
  }
  if (layer.shadow) {
    ctx.shadowColor = "rgba(0,0,0,.65)";
    ctx.shadowBlur = fontSize * 0.22;
    ctx.shadowOffsetY = fontSize * 0.06;
  }
  ctx.fillStyle = layer.color || "#ffffff";
  const lines = wrapLines(ctx, layer.text, boxW * 0.92);
  const lineHeight = fontSize * 1.12;
  const start = -(lines.length - 1) * lineHeight / 2;
  const tx = layer.align === "left" ? -boxW * 0.46 : layer.align === "right" ? boxW * 0.46 : 0;
  lines.forEach((line, index) => ctx.fillText(line, tx, start + index * lineHeight));
}

function renderImageLayerSource(image, state) {
  const rendered = document.createElement("canvas");
  paintEdit(rendered, image, { ...freshEditState(), ...(state || {}), textStyle: { ...freshEditState().textStyle, ...(state?.textStyle || {}) } });
  return rendered;
}

export function renderComposition(canvas, baseImage, editState, composition, layerEditStates = null) {
  const baseState = layerEditStates?.base || editState || freshEditState();
  const base = renderImageLayerSource(baseImage, baseState);
  if (!composition.width || !composition.height) {
    composition.width = base.width;
    composition.height = base.height;
  }
  canvas.width = composition.width;
  canvas.height = composition.height;
  canvas._img = baseImage;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  composition.layers.forEach((layer) => {
    if (!layer.visible) return;
    const boxW = Math.max(1, layer.w * canvas.width);
    const boxH = Math.max(1, layer.h * canvas.height);
    ctx.save();
    ctx.globalAlpha = clamp(layer.opacity ?? 1, 0, 1);
    ctx.globalCompositeOperation = blendMode(layer.blend);
    ctx.translate(layer.x * canvas.width, layer.y * canvas.height);
    ctx.rotate((Number(layer.rotation || 0) * Math.PI) / 180);
    if (layer.type === "base") drawImageFit(ctx, base, -boxW / 2, -boxH / 2, boxW, boxH, layer.fit || "cover");
    else if (layer.type === "image") {
      const image = composition.imageCache.get(layer.src);
      if (image) {
        const rendered = renderImageLayerSource(image, layerEditStates?.[layer.id]);
        drawImageFit(ctx, rendered, -boxW / 2, -boxH / 2, boxW, boxH, layer.fit || "contain");
      }
    } else if (layer.type === "color") {
      ctx.fillStyle = layer.color || "#141025";
      roundedRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, Math.min(boxW, boxH) * clamp(layer.radius || 0, 0, 0.5));
      ctx.fill();
    } else if (layer.type === "text") drawText(ctx, layer, canvas.width, canvas.height);
    ctx.restore();
  });
  return canvas;
}

function rotatedCorners(layer, width, height) {
  const cx = layer.x * width;
  const cy = layer.y * height;
  const hw = layer.w * width / 2;
  const hh = layer.h * height / 2;
  const angle = (Number(layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}

export function layerBounds(layer, width, height) {
  const corners = rotatedCorners(layer, width, height);
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys), corners };
}

function editableSelectedTransformLayers(composition) {
  return selectedLayers(composition).filter((layer) => layer.id !== "base" && !layer.locked && layer.visible !== false);
}

function canvasSize(composition) {
  return {
    width: Math.max(1, Number(composition?.width || 1000)),
    height: Math.max(1, Number(composition?.height || 1000)),
  };
}

function unionBounds(layers, width, height) {
  return layers.reduce((box, layer) => {
    const bounds = layerBounds(layer, width, height);
    return {
      left: Math.min(box.left, bounds.left),
      top: Math.min(box.top, bounds.top),
      right: Math.max(box.right, bounds.right),
      bottom: Math.max(box.bottom, bounds.bottom),
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

export function alignSelectedLayers(composition, mode) {
  if (!["left", "hcenter", "right", "top", "vcenter", "bottom"].includes(mode)) return false;
  const targets = editableSelectedTransformLayers(composition);
  if (!targets.length) return false;
  const { width, height } = canvasSize(composition);
  const group = targets.length === 1 ? { left: 0, top: 0, right: width, bottom: height } : unionBounds(targets, width, height);
  const refX = (group.left + group.right) / 2;
  const refY = (group.top + group.bottom) / 2;
  targets.forEach((layer) => {
    const bounds = layerBounds(layer, width, height);
    if (mode === "left") layer.x = clamp(layer.x + (group.left - bounds.left) / width, 0, 1);
    else if (mode === "hcenter") layer.x = clamp(layer.x + (refX - ((bounds.left + bounds.right) / 2)) / width, 0, 1);
    else if (mode === "right") layer.x = clamp(layer.x + (group.right - bounds.right) / width, 0, 1);
    else if (mode === "top") layer.y = clamp(layer.y + (group.top - bounds.top) / height, 0, 1);
    else if (mode === "vcenter") layer.y = clamp(layer.y + (refY - ((bounds.top + bounds.bottom) / 2)) / height, 0, 1);
    else if (mode === "bottom") layer.y = clamp(layer.y + (group.bottom - bounds.bottom) / height, 0, 1);
  });
  return true;
}

export function distributeSelectedLayers(composition, axis) {
  if (!["x", "y"].includes(axis)) return false;
  const targets = editableSelectedTransformLayers(composition);
  if (targets.length < 3) return false;
  const { width, height } = canvasSize(composition);
  const isX = axis === "x";
  const size = isX ? width : height;
  const sorted = targets
    .map((layer) => {
      const bounds = layerBounds(layer, width, height);
      return { layer, center: isX ? (bounds.left + bounds.right) / 2 : (bounds.top + bounds.bottom) / 2 };
    })
    .sort((a, b) => a.center - b.center);
  const start = sorted[0].center;
  const step = (sorted[sorted.length - 1].center - start) / (sorted.length - 1);
  sorted.forEach((item, index) => {
    const target = start + step * index;
    const delta = (target - item.center) / size;
    if (isX) item.layer.x = clamp(item.layer.x + delta, 0, 1);
    else item.layer.y = clamp(item.layer.y + delta, 0, 1);
  });
  return axis === "x" || axis === "y";
}

function snapAxisGuides(bounds, size, threshold) {
  const center = (bounds.start + bounds.end) / 2;
  const candidates = [
    { guide: 0, delta: -bounds.start },
    { guide: 0.5, delta: (size / 2) - center },
    { guide: 1, delta: size - bounds.end },
  ].filter((candidate) => Math.abs(candidate.delta) <= threshold);
  return candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0] || null;
}

export function applyLayerDragWithSnap(composition, starts, dx, dy, opts = {}) {
  const targets = Array.isArray(starts) ? starts.filter((item) => item?.layer && !item.layer.locked) : [];
  if (!targets.length) return [];
  targets.forEach((item) => {
    item.layer.x = clamp((Number(item.x) || 0) + dx, 0, 1);
    item.layer.y = clamp((Number(item.y) || 0) + dy, 0, 1);
  });
  const { width, height } = canvasSize(composition);
  const bounds = unionBounds(targets.map((item) => item.layer), width, height);
  const threshold = Math.max(1, Number(opts.thresholdPx || Math.min(width, height) * 0.018));
  const guides = [];
  const snapX = snapAxisGuides({ start: bounds.left, end: bounds.right }, width, threshold);
  const snapY = snapAxisGuides({ start: bounds.top, end: bounds.bottom }, height, threshold);
  if (snapX) {
    targets.forEach((item) => { item.layer.x = clamp(item.layer.x + snapX.delta / width, 0, 1); });
    guides.push({ axis: "x", at: snapX.guide });
  }
  if (snapY) {
    targets.forEach((item) => { item.layer.y = clamp(item.layer.y + snapY.delta / height, 0, 1); });
    guides.push({ axis: "y", at: snapY.guide });
  }
  return guides;
}

export function drawCompositionOverlay(overlay, canvas, composition, guides = []) {
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  (Array.isArray(guides) ? guides : []).forEach((guide) => {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 209, 102, .92)";
    ctx.lineWidth = Math.max(1.5, canvas.width / 900);
    ctx.setLineDash([Math.max(7, canvas.width / 130), Math.max(5, canvas.width / 180)]);
    ctx.beginPath();
    if (guide.axis === "x") {
      const x = Math.max(0, Math.min(1, Number(guide.at))) * canvas.width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    } else if (guide.axis === "y") {
      const y = Math.max(0, Math.min(1, Number(guide.at))) * canvas.height;
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
    ctx.restore();
  });
  const selected = selectedLayers(composition).filter((layer) => layer.visible);
  selected.forEach((layer) => {
    const bounds = layerBounds(layer, canvas.width, canvas.height);
    ctx.save();
    ctx.strokeStyle = "#6649f7";
    ctx.lineWidth = Math.max(2, canvas.width / 700);
    ctx.setLineDash(layer.locked ? [10, 8] : []);
    ctx.beginPath();
    bounds.corners.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.closePath();
    ctx.stroke();
    if (selected.length === 1 && !layer.locked) bounds.corners.forEach((point) => {
      ctx.fillStyle = "#090713";
      ctx.strokeStyle = "#6649f7";
      ctx.lineWidth = Math.max(2, canvas.width / 700);
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(8, canvas.width / 140), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  });
}

/* Editor-only subject visualization. The segmentation cutout is transformed
   through the same base-layer box/fit as the photo, then recolored into a
   translucent mint silhouette with a bright contour. This is never painted
   onto the export canvas. */
export function drawDetectedSubjectOverlay(overlay, canvas, composition, maskImage, layerId = "base") {
  if (!overlay || !canvas || !maskImage) return;
  const baseLayer = composition.layers.find((layer) => layer.id === layerId && (layer.type === "base" || layer.type === "image"));
  if (!baseLayer || !baseLayer.visible) return;
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const ctx = mask.getContext("2d");
  const boxW = Math.max(1, baseLayer.w * mask.width);
  const boxH = Math.max(1, baseLayer.h * mask.height);
  ctx.save();
  ctx.translate(baseLayer.x * mask.width, baseLayer.y * mask.height);
  ctx.rotate((Number(baseLayer.rotation || 0) * Math.PI) / 180);
  drawImageFit(ctx, maskImage, -boxW / 2, -boxH / 2, boxW, boxH, baseLayer.fit || "cover");
  ctx.restore();
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "rgba(102,73,247,.14)";
  ctx.fillRect(0, 0, mask.width, mask.height);

  const out = overlay.getContext("2d");
  out.save();
  out.globalCompositeOperation = "source-over";
  out.filter = `drop-shadow(0 0 ${Math.max(2, canvas.width / 420)}px rgba(102,73,247,.96)) drop-shadow(0 0 ${Math.max(5, canvas.width / 150)}px rgba(102,73,247,.68))`;
  out.drawImage(mask, 0, 0);
  out.restore();
}

export function layerPointToCanvas(layer, point, canvas) {
  const localX = (clamp(point.x, 0, 1) - 0.5) * layer.w * canvas.width;
  const localY = (clamp(point.y, 0, 1) - 0.5) * layer.h * canvas.height;
  const angle = (Number(layer.rotation || 0) * Math.PI) / 180;
  return {
    x: layer.x * canvas.width + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: layer.y * canvas.height + localX * Math.sin(angle) + localY * Math.cos(angle),
  };
}

export function canvasPointToLayer(layer, point, canvas) {
  const angle = -(Number(layer.rotation || 0) * Math.PI) / 180;
  const dx = point.px - layer.x * canvas.width;
  const dy = point.py - layer.y * canvas.height;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    x: clamp(localX / Math.max(1, layer.w * canvas.width) + 0.5, 0, 1),
    y: clamp(localY / Math.max(1, layer.h * canvas.height) + 0.5, 0, 1),
  };
}

export function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    px: clamp((event.clientX - rect.left) / rect.width, 0, 1) * canvas.width,
    py: clamp((event.clientY - rect.top) / rect.height, 0, 1) * canvas.height,
  };
}

export function hitTestLayer(composition, point, canvas) {
  for (let index = composition.layers.length - 1; index >= 0; index -= 1) {
    const layer = composition.layers[index];
    if (!layer.visible || layer.locked) continue;
    const cx = layer.x * canvas.width;
    const cy = layer.y * canvas.height;
    const angle = -(Number(layer.rotation || 0) * Math.PI) / 180;
    const dx = point.px - cx;
    const dy = point.py - cy;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (Math.abs(localX) <= layer.w * canvas.width / 2 && Math.abs(localY) <= layer.h * canvas.height / 2) return layer;
  }
  return composition.layers.find((layer) => layer.id === "base" && layer.visible) || null;
}

export function hitTestResizeHandle(composition, point, canvas, cssScale = 1) {
  const selected = selectedLayers(composition);
  if (selected.length !== 1 || selected[0].locked) return null;
  const layer = selected[0];
  const corners = rotatedCorners(layer, canvas.width, canvas.height);
  const radius = Math.max(14 / Math.max(cssScale, 0.01), canvas.width / 120);
  const index = corners.findIndex((corner) => Math.hypot(corner.x - point.px, corner.y - point.py) <= radius);
  return index >= 0 ? { layer, index } : null;
}

export function setCanvasPreset(composition, width, height) {
  composition.width = Math.max(240, Math.round(width));
  composition.height = Math.max(240, Math.round(height));
}

export function zoomComposition(composition, delta) {
  composition.zoom = clamp((composition.zoom || 1) + delta, 0.25, 4);
  return composition.zoom;
}
