/* PhantomForce — shared real-backend client for the media editor: background
   removal (rembg) and AI Edit. Every call here is a real network request —
   no fabricated success, no fake progress. Unreachable/unconfigured always
   resolves to an honest unavailable/error result, never a silent pretend
   success. Content Hub's lightbox, Media Lab's Edit tab, and Settings all
   use this so "is a real backend connected" is answered the same way
   everywhere.

   Two lanes, tried in order (same philosophy as Media Lab's own multi-lane
   health check):
   1. Same-origin Fastify server (server/src/index.ts) — the real admin
      backend, authenticated with the session's bearer token. This is what
      runs in production behind admin.phantomforce.online.
   2. ai-proxy (ai-proxy/server.mjs) — the lighter self-hosted proxy, useful
      for local/dev setups that don't run the full server. */

import { session } from "./store.js?v=phantom-live-20260709-119";
import { safeCanvasDataUrl } from "./imagefilters.js?v=phantom-live-20260709-119";

function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function aiProxyBase() {
  try {
    const cfg = JSON.parse(localStorage.getItem("pf.medialab.v1") || "{}");
    if (cfg.endpointBase) return String(cfg.endpointBase).replace(/\/+$/, "");
  } catch { /* fall through to default */ }
  return (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://127.0.0.1:8788" : "https://ai.phantomforce.online";
}

async function fetchWithTimeout(url, options = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* ---------------- safe image loading for canvas editing ----------------
   A canvas that ever draws a cross-origin image without CORS gets "tainted"
   by the browser — every later toDataURL()/getImageData() call throws.
   Images still always load directly for display: gating the image on a
   backend proxy round-trip means a slow/unreachable proxy breaks viewing
   entirely, which is worse than the taint problem it's meant to solve.
   Instead, editing operations that actually need pixel data (Save, Download,
   sending to a provider) go through imagefilters.js's safeCanvasDataUrl,
   catch the taint there, and call rescueTaintedImage below to fetch a clean
   same-origin copy through this proxy — only then does an unreachable proxy
   become a real (clearly explained) error, and only for that one action. */
export function loadImage(src) {
  return new Promise((resolvePromise, reject) => {
    const img = new Image();
    img.onload = () => resolvePromise(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

export async function loadImageForEditing(url) {
  return loadImage(url);
}

async function proxyImageToDataUrl(url) {
  try {
    const r = await fetchWithTimeout(`/phantom-ai/media-lab/proxy-image?url=${encodeURIComponent(url)}`, { headers: authHeaders() }, 10000);
    if (r.status !== 404) {
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && d.image) return d.image;
    }
  } catch { /* try the fallback lane */ }
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/api/media/proxy-image?url=${encodeURIComponent(url)}`, {}, 10000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok && d.image) return d.image;
  } catch { /* both lanes unreachable */ }
  return null;
}

/* Fetches a same-origin copy of a tainting image through the backend proxy
   and loads it. Returns null (never throws) if both proxy lanes fail, so
   callers can show one honest "couldn't recover" message. */
export async function rescueTaintedImage(url) {
  if (url.startsWith("data:") || url.startsWith("blob:")) return null; // already same-origin-safe; taint came from elsewhere
  const proxied = await proxyImageToDataUrl(url);
  if (!proxied) return null;
  try { return await loadImage(proxied); }
  catch { return null; }
}

/* One call for every Save/Download/AI-send site: try to read the canvas,
   and if it's tainted, rescue once through the proxy and retry before
   giving up. repaintFn(img) must redraw the canvas with the rescued image
   (and update canvas._img) — callers already have this as their repaint(). */
export async function exportCanvas(canvas, repaintFn, format = "image/png", quality) {
  const first = safeCanvasDataUrl(canvas, format, quality);
  if (first.ok) return first;
  const srcUrl = canvas._img?.src;
  const rescued = srcUrl ? await rescueTaintedImage(srcUrl) : null;
  if (!rescued) return first;
  repaintFn(rescued);
  return safeCanvasDataUrl(canvas, format, quality);
}

/* ---------------- background removal (rembg) ---------------- */

/* Full status detail — used by the editor panel and Settings > Media
   Engines. `lane` records which backend actually answered, or "unreachable"
   if neither did (never guessed). */
export async function getRembgStatus(opts = {}) {
  const recheck = opts.recheck ? "?recheck=true" : "";
  try {
    const r = await fetchWithTimeout(`/phantom-ai/media-lab/rembg/status${recheck}`, { headers: authHeaders() }, 8000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && typeof d.available === "boolean") {
      return { lane: "server", available: d.available, pythonCommand: d.pythonCommand || null, version: d.version || null, error: d.error || null, checkedAt: d.checkedAt || null };
    }
  } catch { /* try the fallback lane */ }

  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/api/media/remove-background/status`, {}, 5000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && typeof d.available === "boolean") {
      return { lane: "ai-proxy", available: d.available, pythonCommand: null, version: null, error: d.available ? null : "rembg is not installed or not connected.", checkedAt: new Date().toISOString() };
    }
  } catch { /* both lanes unreachable */ }

  return { lane: "unreachable", available: false, pythonCommand: null, version: null, error: "Could not reach a media backend to check rembg.", checkedAt: new Date().toISOString() };
}

/* Simple boolean check for the editor's mount-time probe. */
export async function probeRemoveBackground() {
  return (await getRembgStatus()).available;
}

export async function requestRemoveBackground(dataUrl) {
  try {
    const r = await fetchWithTimeout("/phantom-ai/media-lab/rembg/remove-background", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ image: dataUrl }),
    }, 45000);
    if (r.status !== 404) {
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && d.image) return { ok: true, image: d.image };
      if (d) return { ok: false, message: (typeof d.error === "string" && d.error) || d.message || "Background removal unavailable — rembg is not installed or not connected." };
    }
  } catch { /* try the fallback lane */ }

  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/api/media/remove-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl }),
    }, 40000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok && d.image) return { ok: true, image: d.image };
    return { ok: false, message: (d && d.message) || "Background removal unavailable — rembg is not installed or not connected." };
  } catch (e) {
    return { ok: false, message: e && e.name === "AbortError" ? "Background removal timed out." : "Could not reach the media backend." };
  }
}

/* ---------------- AI edit (real /generate, modality "edit") ----------------
   Reuses the media-generation route Media Lab uses for creation, with a
   reference image + modality "edit" so a connected provider (Higgsfield)
   performs a real prompt-guided edit. No key ever touches the browser. */
export async function probeAiEditBackend() {
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/health`, {}, 5000);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return { available: false };
    const media = d.media || {};
    const provider = Object.keys(media).find((id) => media[id]) || null;
    return { available: !!provider, provider };
  } catch {
    return { available: false };
  }
}

export async function requestAiEdit({ dataUrl, prompt, provider = "higgsfield" }) {
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider, modality: "edit", prompt, ref: dataUrl,
        params: { aspect: "1:1", count: 1 },
      }),
    }, 45000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && Array.isArray(d.assets) && d.assets[0]?.url) return { ok: true, url: d.assets[0].url };
    return { ok: false, message: (d && d.message) || (d && d.error === "unconfigured" ? "No AI edit provider is connected yet." : "The edit backend didn't return a result.") };
  } catch (e) {
    return { ok: false, message: e && e.name === "AbortError" ? "AI edit timed out." : "Could not reach the AI edit backend." };
  }
}
