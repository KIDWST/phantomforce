/* PhantomForce — shared real-backend client for the media editor: background
   removal (rembg) and AI Edit (the existing /generate route's "edit"
   modality). Every call here is a real network request to the ai-proxy —
   no fabricated success, no fake progress. Unreachable/unconfigured always
   resolves to an honest unavailable/error result, never a silent pretend
   success. Content Hub's lightbox and Media Lab's Edit tab both use this so
   the "is a real backend connected" story is answered the same way everywhere. */

function backendBase() {
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

/* ---------------- background removal (rembg) ---------------- */
export async function probeRemoveBackground() {
  try {
    const r = await fetchWithTimeout(`${backendBase()}/api/media/remove-background/status`, {}, 5000);
    const d = await r.json().catch(() => null);
    return !!(r.ok && d && d.available);
  } catch {
    return false;
  }
}

export async function requestRemoveBackground(dataUrl) {
  try {
    const r = await fetchWithTimeout(`${backendBase()}/api/media/remove-background`, {
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
   Reuses the same media-generation route Media Lab uses for creation, with
   a reference image + modality "edit" so a connected provider (Higgsfield)
   performs a real prompt-guided edit. No key ever touches the browser. */
export async function probeAiEditBackend() {
  try {
    const r = await fetchWithTimeout(`${backendBase()}/health`, {}, 5000);
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
    const r = await fetchWithTimeout(`${backendBase()}/generate`, {
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
