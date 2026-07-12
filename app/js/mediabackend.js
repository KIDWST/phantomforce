/* PhantomForce — shared media-engine client for the media editor: background
   removal and AI Edit. Every call here is a real network request —
   no fabricated success, no fake progress. Unreachable/unconfigured always
   resolves to an honest unavailable/error result, never a silent pretend
   success. Creator Hub's lightbox, Media Lab's Edit tab, and Settings all
   use this so "is a real media engine connected" is answered the same way
   everywhere.

   Two lanes, tried in order (same philosophy as Media Lab's own multi-lane
   health check):
   1. Same-origin Fastify server (server/src/index.ts) — the real admin
      media service, authenticated with the session's bearer token. This is what
      runs in production behind admin.phantomforce.online.
   2. ai-proxy (ai-proxy/server.mjs) — the lighter self-hosted proxy, useful
      for local/dev setups that don't run the full server. */

import { currentTenantId, session, workspaceStorageGetItem } from "./store.js?v=phantom-live-20260712-204";
import { safeCanvasDataUrl } from "./imagefilters.js?v=phantom-live-20260712-204";

function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function aiProxyBase() {
  try {
    const cfg = JSON.parse(workspaceStorageGetItem("pf.medialab.v1") || "{}");
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
   media service round-trip means a slow/unreachable service breaks viewing
   entirely, which is worse than the taint problem it's meant to solve.
   Instead, editing operations that actually need pixel data (Save, Download,
   sending to a media engine) go through imagefilters.js's safeCanvasDataUrl,
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

/* Fetches a same-origin copy of a tainting image through the media proxy
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

/* ---------------- background removal ---------------- */

/* Full status detail — used by the editor panel and Settings > Media
   Engines. `lane` records which service actually answered, or "unreachable"
   if neither did (never guessed). */
export async function getRembgStatus(opts = {}) {
  const recheck = opts.recheck ? "?recheck=true" : "";
  try {
    const r = await fetchWithTimeout(`/phantom-ai/media-lab/rembg/status${recheck}`, { headers: authHeaders() }, 8000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && typeof d.available === "boolean") {
      return { lane: "server", available: d.available, pythonCommand: d.pythonCommand || null, version: d.version || null, error: d.error || null, checkedAt: d.checkedAt || null };
    }
    if (r.status === 401 || r.status === 403) {
      return {
        lane: "server",
        available: false,
        pythonCommand: null,
        version: null,
        error: "Business Manager session expired. Sign in again, then re-check background removal.",
        checkedAt: new Date().toISOString(),
      };
    }
  } catch { /* try the fallback lane */ }

  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/api/media/remove-background/status`, {}, 5000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && typeof d.available === "boolean") {
      return { lane: "ai-proxy", available: d.available, pythonCommand: null, version: null, error: d.available ? null : "Background removal is not connected.", checkedAt: new Date().toISOString() };
    }
  } catch { /* both lanes unreachable */ }

  return { lane: "unreachable", available: false, pythonCommand: null, version: null, error: "Could not reach a media engine to check background removal.", checkedAt: new Date().toISOString() };
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
      if (d) return { ok: false, message: (typeof d.error === "string" && d.error) || d.message || "Background removal is not connected." };
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
    return { ok: false, message: (d && d.message) || "Background removal is not connected." };
  } catch (e) {
    return { ok: false, message: e && e.name === "AbortError" ? "Background removal timed out." : "Could not reach the media engine." };
  }
}

/* ---------------- Prompt-guided edit media engine ----------------
   Reuses the Media Lab generation route with a reference image + modality
   "edit" so a connected edit-capable lane performs a real prompt-guided edit.
   No key ever touches the browser.

   If no edit-capable lane is wired, the UI reports AI Edit as unavailable
   instead of pretending an automated edit happened. */
const EDIT_CAPABLE_PROVIDERS = ["cinematic"];

/* Raw ai-proxy /health passthrough — every provider key's real state (not
   just the edit-capable ones Creator Hub cares about), plus the configured
   chat brain. Used by the Developer tab so every integration shows its
   actual status, not a filtered subset. Never throws; unreachable reads as
   ok:false, never a guessed "connected". */
export async function getMediaEngineHealth() {
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/health`, {}, 6000);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return { ok: false, reachable: false };
    return { ok: true, reachable: true, ...d };
  } catch {
    return { ok: false, reachable: false };
  }
}

export async function probeAiEditBackend() {
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/health`, {}, 5000);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d) return { available: false, mode: "unavailable", provider: null };
    const media = d.media || {};
    const keyedProvider = EDIT_CAPABLE_PROVIDERS.find((id) => media[id]);
    if (keyedProvider) return { available: true, mode: "connected", provider: keyedProvider };
    return { available: false, mode: "unavailable", provider: null };
  } catch {
    return { available: false, mode: "unavailable", provider: null };
  }
}

export async function requestAiEdit({ dataUrl, prompt, provider = "cinematic", aspect = "1:1" }) {
  try {
    const r = await fetchWithTimeout(`${aiProxyBase()}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider, modality: "edit", prompt, ref: dataUrl, tenant_id: currentTenantId(),
        params: { aspect, count: 1 },
      }),
    }, 45000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && Array.isArray(d.assets) && d.assets[0]?.url) return { ok: true, url: d.assets[0].url };
    return { ok: false, message: (d && d.message) || (d && d.error === "unconfigured" ? "AI Edit is not connected yet." : "AI Edit did not return a result.") };
  } catch (e) {
    return { ok: false, message: e && e.name === "AbortError" ? "AI Edit timed out." : "Could not reach AI Edit." };
  }
}

/* ---------------- content asset sync (cross-device photos) ----------------
   Creator Hub's actual photo/video data normally lives only in whichever
   browser created it (localStorage). These calls back it up to the real
   Fastify server (server/src/phantom-ai/content-asset-storage.ts) so the
   same asset shows up on any device logged into the same owner session.
   Every asset auto-expires after 30 days server-side — this is a sync/
   archive layer, not permanent storage. Never throws; failures are always
   reported honestly so a photo doesn't silently vanish or fail to sync
   without the caller knowing. */
export async function syncAssetUpload(dataUrl, filename) {
  try {
    const r = await fetchWithTimeout("/phantom-ai/content/assets", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ image: dataUrl, filename, tenant_id: currentTenantId() }),
    }, 30000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok && d.asset) return { ok: true, asset: d.asset };
    return { ok: false, error: (d && d.error) || `Sync failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the sync backend." };
  }
}

export async function listSyncedAssets() {
  try {
    const r = await fetchWithTimeout(`/phantom-ai/content/assets?tenant_id=${encodeURIComponent(currentTenantId())}`, { headers: authHeaders() }, 12000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok && Array.isArray(d.assets)) return { ok: true, assets: d.assets };
    return { ok: false, error: (d && d.error) || `Request failed (${r.status}).`, assets: [] };
  } catch {
    return { ok: false, error: "Could not reach the sync backend.", assets: [] };
  }
}

export async function fetchSyncedAssetFile(id) {
  try {
    const r = await fetchWithTimeout(`/phantom-ai/content/assets/${encodeURIComponent(id)}/file?tenant_id=${encodeURIComponent(currentTenantId())}`, { headers: authHeaders() }, 20000);
    const d = await r.json().catch(() => null);
    if (r.ok && d && d.ok && d.image) return { ok: true, dataUrl: d.image, asset: d.asset };
    return { ok: false, error: (d && d.error) || `Request failed (${r.status}).` };
  } catch {
    return { ok: false, error: "Could not reach the sync backend." };
  }
}
