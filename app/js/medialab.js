/* PhantomForce — Media Lab: an all-in-one AI photo & video generator + editor.
 *
 * PLUGGABLE BY DESIGN. A provider is just a config entry (see DEFAULT_PROVIDERS)
 * with an id, the modalities it supports, and its models. The browser never
 * holds a real key: generation POSTs {provider, modality, model, prompt, …} to
 * a server route (the ai-proxy /generate) that maps the id → the real API and
 * signs it with a key from its environment. To add a provider: push one object
 * here and add a matching handler in ai-proxy (server.mjs / worker.js). Done.
 *
 * When no generation backend is reachable the studio still works end to end:
 * it renders a real, on-brand procedural PREVIEW so the whole UI is usable and
 * demoable, and swaps to true results the moment a provider is connected.
 */

import { PLATFORMS, registerContentAsset } from "./contenthub.js?v=phantom-live-20260707-39";

const CFG_KEY = "pf.medialab.v1";
const SOCIAL_KEY = "pf.social.accounts.v1";
const EDIT_INTENT_KEY = "pf.medialab.editIntent.v1";
const TAU = Math.PI * 2;

/* ---------------- provider registry (pluggable defaults) ---------------- */
export const DEFAULT_PROVIDERS = [
  {
    id: "higgsfield", name: "Cinematic Engine", tagline: "Image and video production",
    brand: "#8b7bff", keyEnv: "HIGGSFIELD_API_KEY", enabled: true,
    modalities: ["image", "video", "edit"],
    models: {
      image: ["higgsfield-soul", "higgsfield-turbo"],
      video: ["higgsfield-dop", "higgsfield-motion"],
      edit: ["higgsfield-soul-edit"],
    },
  },
  {
    id: "claude", name: "Creative Director", tagline: "Prompt intelligence and art direction",
    brand: "#d97757", keyEnv: "ANTHROPIC_API_KEY", enabled: true,
    modalities: ["enhance", "caption", "direct"],
    models: { enhance: ["claude-sonnet-5", "claude-opus-4-8"] },
  },
  {
    id: "openai", name: "OpenAI", tagline: "GPT Image · Sora video",
    brand: "#10a37f", keyEnv: "OPENAI_API_KEY", enabled: false,
    modalities: ["image", "video", "edit"],
    models: { image: ["gpt-image-1"], video: ["sora-2"], edit: ["gpt-image-1"] },
  },
  {
    id: "runway", name: "Runway", tagline: "Gen-4 video",
    brand: "#ff5c00", keyEnv: "RUNWAY_API_KEY", enabled: false,
    modalities: ["video", "image"],
    models: { video: ["gen-4", "gen-3-alpha-turbo"], image: ["frames"] },
  },
  {
    id: "flux", name: "Flux (BFL)", tagline: "Photoreal stills",
    brand: "#4c8dff", keyEnv: "BFL_API_KEY", enabled: false,
    modalities: ["image", "edit"],
    models: { image: ["flux-1.1-pro", "flux-dev"], edit: ["flux-kontext"] },
  },
];

const STYLES = ["None", "Cinematic", "Product", "Portrait", "Neon", "Editorial", "3D render", "Analog film"];
const IMG_ASPECTS = [["1:1", 1], ["4:5", 0.8], ["3:2", 1.5], ["16:9", 1.777], ["9:16", 0.5625]];
const VID_ASPECTS = [["16:9", 1.777], ["9:16", 0.5625], ["4:5", 0.8], ["1:1", 1]];
const DURATIONS = [4, 6, 8, 10, 15, 30];
const MEDIA_PRESETS = [
  {
    id: "portrait-ad", label: "Portrait Ad", use: "Paid social", modality: "image", aspect: "4:5", count: 2, style: "Product",
    note: "Clean offer image", prompt: "Premium 4:5 paid social image with one clear offer, strong product or service focal point, polished lighting, and room for a short headline",
  },
  {
    id: "square-brand-post", label: "Square Brand Post", use: "Feed social", modality: "image", aspect: "1:1", count: 2, style: "Editorial",
    note: "Polished feed creative", prompt: "Clean square brand post image with one strong subject, balanced negative space, premium lighting, and no tiny text",
  },
  {
    id: "story-poster", label: "Story Poster", use: "Story cover", modality: "image", aspect: "9:16", count: 2, style: "Neon",
    note: "Vertical hero still", prompt: "Vertical story poster with cinematic depth, bold central subject, premium neon accents, and safe space for large mobile text",
  },
  {
    id: "youtube-thumbnail", label: "YouTube Thumbnail", use: "Video cover", modality: "image", aspect: "16:9", count: 2, style: "Neon",
    note: "High contrast cover", prompt: "Bold wide YouTube thumbnail composition with a clear focal subject, high contrast lighting, expressive emotion, and room for a short headline",
  },
  {
    id: "website-hero", label: "Website Hero", use: "Landing page", modality: "image", aspect: "16:9", count: 2, style: "3D render",
    note: "Premium site header", prompt: "Premium website hero image with cinematic depth, clean product space, dark polished background, and room for interface copy",
  },
  {
    id: "carousel-slide", label: "Carousel Slide", use: "Carousel", modality: "image", aspect: "4:5", count: 3, style: "Editorial",
    note: "Swipeable visual set", prompt: "Premium carousel slide visual with editorial composition, clean information hierarchy, consistent visual system, and strong first-card impact",
  },
  {
    id: "reels-tiktok", label: "Reels / TikTok", use: "Short social", modality: "video", aspect: "9:16", duration: 8, style: "Cinematic",
    note: "Hook-first vertical", prompt: "Fast vertical social clip with a strong first-second hook, premium motion, bold subject, quick cuts, and a clear end card",
  },
  {
    id: "story-ad", label: "Story Ad", use: "Paid social", modality: "video", aspect: "9:16", duration: 6, style: "Product",
    note: "Mobile ad creative", prompt: "Vertical story ad with a simple product reveal, clear benefit moment, clean background, and room for headline text",
  },
  {
    id: "feed-clip", label: "Feed Clip", use: "Feed social", modality: "video", aspect: "4:5", duration: 10, style: "Editorial",
    note: "Professional feed cut", prompt: "Polished feed video with a premium business visual, readable center framing, smooth camera motion, and a confident call-to-action finish",
  },
  {
    id: "launch-teaser", label: "Launch Teaser", use: "Product launch", modality: "video", aspect: "16:9", duration: 15, style: "Neon",
    note: "Punchy reveal clip", prompt: "Short launch teaser with dramatic lighting, one memorable visual idea, controlled camera movement, and a punchy ending",
  },
  {
    id: "youtube-trailer", label: "YouTube Trailer", use: "Wide trailer", modality: "video", aspect: "16:9", duration: 30, style: "Cinematic",
    note: "Full trailer arc", prompt: "Cinematic wide trailer with establishing shot, product reveal, proof moments, and a confident final title card",
  },
  {
    id: "product-demo", label: "Product Demo", use: "Sales enablement", modality: "video", aspect: "16:9", duration: 15, style: "Product",
    note: "Feature walkthrough", prompt: "Clean product demo video showing the interface or offer in motion, clear feature beats, realistic pacing, and a polished final frame",
  },
];

/* Customer-safe display names for render lanes; option values stay untouched
   so requests keep sending the real model ids. */
const LANE_LABELS = {
  "higgsfield-soul": "Signature stills",
  "higgsfield-turbo": "Rapid stills",
  "higgsfield-dop": "Cinema motion",
  "higgsfield-motion": "Motion loop",
  "higgsfield-soul-edit": "Signature retouch",
  "gpt-image-1": "Studio stills",
  "sora-2": "Story motion",
  "gen-4": "Feature motion",
  "gen-3-alpha-turbo": "Rapid motion",
  "frames": "Frame stills",
  "flux-1.1-pro": "Photoreal pro",
  "flux-dev": "Photoreal draft",
  "flux-kontext": "Context retouch",
};
const laneLabel = (m) => LANE_LABELS[m] || String(m || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const SOCIAL_LOGIN_URLS = {
  instagram: "https://www.instagram.com/accounts/login/",
  tiktok: "https://www.tiktok.com/login",
  youtube: "https://accounts.google.com/",
  facebook: "https://www.facebook.com/login",
  x: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login",
  pinterest: "https://www.pinterest.com/login/",
};
let socialNotice = "";
const HERMES_EXTENSION_PROTOCOL = "phantomforce.hermes.extension.v1";
const HERMES_EXTENSION_KEY = "pf.hermes.extension.connect.v1";
let mediaSettingsMount = null;
let mediaSettingsOpts = {};
let hermesExtensionListenerReady = false;
let socialBridgePollTimer = 0;

function defaultSocialAccounts() {
  return PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    handle: "",
    url: "",
    loginIdentity: "",
    enabled: false,
    connectMode: "manual",
    officialConnectState: "not_configured",
    lastConnectAt: "",
  }));
}
function loadSocialAccounts() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(SOCIAL_KEY) || "[]"); } catch {}
  const rows = Array.isArray(saved) ? saved : [];
  return defaultSocialAccounts().map((base) => ({ ...base, ...(rows.find((row) => row && row.id === base.id) || {}) }));
}
function saveSocialAccounts(accounts) {
  try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(accounts)); } catch {}
}
function cleanSocialHandle(value = "") {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/^(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|x\.com|twitter\.com|linkedin\.com|pinterest\.com)\//i, "")
    .replace(/^@+/, "")
    .replace(/^in\//i, "")
    .replace(/^company\//i, "")
    .replace(/[/?#].*$/, "")
    .trim();
}
function normalizeSocialUrl(value = "") {
  const text = String(value || "").trim();
  if (!text || text === "https://") return "";
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}
function socialProfileFromHandle(platformId, handle = "") {
  const h = cleanSocialHandle(handle);
  if (!h) return "";
  if (platformId === "instagram") return `https://www.instagram.com/${h}/`;
  if (platformId === "tiktok") return `https://www.tiktok.com/@${h}`;
  if (platformId === "youtube") return `https://www.youtube.com/@${h}`;
  if (platformId === "facebook") return `https://www.facebook.com/${h}`;
  if (platformId === "x") return `https://x.com/${h}`;
  if (platformId === "linkedin") return `https://www.linkedin.com/in/${h}/`;
  if (platformId === "pinterest") return `https://www.pinterest.com/${h}/`;
  return "";
}
function socialProfileTarget(account) {
  return normalizeSocialUrl(account.url) || socialProfileFromHandle(account.id, account.handle);
}
function socialLoginTarget(account) {
  return SOCIAL_LOGIN_URLS[account.id] || socialProfileTarget(account) || "about:blank";
}
function socialStatus(account) {
  if (account.hermesProof || account.enabled) return "linked";
  if (account.lastConnectAt || account.loginIdentity) return "pending";
  return "empty";
}
function socialStatusLabel(account) {
  const st = socialStatus(account);
  if (st === "linked") return "connected";
  if (st === "pending") return "finish link";
  return "not linked";
}
function socialPostingState(account) {
  const st = socialStatus(account);
  if (st === "linked") return "connected";
  if (st === "pending") return "waiting";
  return "ready";
}
function socialActionLabel(account) {
  const st = socialStatus(account);
  if (st === "linked") return `Reconnect with ${account.name}`;
  if (st === "pending") return `Linking ${account.name}`;
  return `Sign in with ${account.name}`;
}
function clampHermesText(value = "", limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
function redactHermesVisibleText(value = "", limit = 180) {
  return clampHermesText(String(value || "")
    .replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[^\s'"`;&]+/gi, "Bearer [REDACTED_BEARER]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_SECRET]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g, "[REDACTED_SECRET]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|password|passwd|secret|private[_-]?key)\b["'`]?\s*[:=]\s*["'`]?([^\s'"`;&]+)/gi, (_match, key) => `${key}=[REDACTED_SECRET]`), limit);
}
function loadHermesExtensionState() {
  try {
    return JSON.parse(localStorage.getItem(HERMES_EXTENSION_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function saveHermesExtensionState(patch = {}) {
  const next = {
    ...loadHermesExtensionState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  try { localStorage.setItem(HERMES_EXTENSION_KEY, JSON.stringify(next)); } catch {}
  return next;
}
function sanitizeHermesProfilePacket(payload = {}) {
  const platform = String(payload.platform || "").toLowerCase().trim();
  if (!PLATFORMS.some((p) => p.id === platform)) {
    return { ok: false, reason: "unsupported platform" };
  }
  const url = normalizeSocialUrl(payload.url || "");
  const handle = cleanSocialHandle(payload.handle || url);
  return {
    ok: Boolean(url || handle),
    platform,
    handle,
    url,
    displayName: redactHermesVisibleText(payload.displayName || ""),
    pageTitle: redactHermesVisibleText(payload.pageTitle || ""),
    source: "hermes-extension",
    sourceTab: redactHermesVisibleText(payload.sourceTab || "visible social profile", 80),
    connectedAt: payload.capturedAt || new Date().toISOString(),
    userConfirmed: Boolean(payload.userConfirmed),
    safety: {
      cookiesRead: false,
      passwordsRead: false,
      tokensRead: false,
      privateMessagesRead: false,
      browserHistoryRead: false,
    },
  };
}
function rerenderMediaSettings() {
  if (mediaSettingsMount) renderMediaSettings(mediaSettingsMount, mediaSettingsOpts);
}
function socialAccountName(platform = "") {
  return PLATFORMS.find((p) => p.id === platform)?.name || "the platform";
}
function applyHermesProfilePacket(payload = {}) {
  const packet = sanitizeHermesProfilePacket(payload);
  const pendingPlatform = String(loadHermesExtensionState().pendingPlatform || "").toLowerCase().trim();
  if (!packet.ok) {
    socialNotice = pendingPlatform
      ? `${socialAccountName(pendingPlatform)} sign-in is open. PhantomForce will link it automatically when the browser bridge sees the signed-in public profile.`
      : "Sign-in did not find a supported public social profile yet. Open the platform sign-in once, then return here.";
    saveHermesExtensionState({ detected: true, lastSeenAt: new Date().toISOString(), lastResult: "unsupported" });
    rerenderMediaSettings();
    return;
  }
  if (pendingPlatform && packet.platform !== pendingPlatform) {
    socialNotice = `${socialAccountName(pendingPlatform)} is still waiting. Ignored a saved ${socialAccountName(packet.platform)} profile so the wrong account does not get linked.`;
    saveHermesExtensionState({ detected: true, lastSeenAt: new Date().toISOString(), lastResult: "platform_mismatch" });
    rerenderMediaSettings();
    return;
  }
  const accounts = loadSocialAccounts();
  const account = accounts.find((row) => row.id === packet.platform);
  if (!account) return;
  account.handle = packet.handle || account.handle || "";
  account.url = packet.url || socialProfileFromHandle(account.id, account.handle);
  account.enabled = true;
  account.connectMode = "hermes-extension";
  account.lastConnectAt = packet.connectedAt;
  account.hermesProof = packet;
  saveSocialAccounts(accounts);
  saveHermesExtensionState({
    detected: true,
    lastSeenAt: new Date().toISOString(),
    lastLinkedPlatform: packet.platform,
    pendingPlatform: "",
    lastResult: "linked",
  });
  socialNotice = `${account.name} signed in from the visible browser profile. Stored only public handle/profile fields; no cookies, passwords, tokens, or private messages were read.`;
  rerenderMediaSettings();
}
function handleHermesExtensionPageMessage(event) {
  if (event.source !== window) return;
  const data = event.data || {};
  if (data.protocol !== HERMES_EXTENSION_PROTOCOL) return;
  if (data.type === "PF_HERMES_EXTENSION_READY") {
    saveHermesExtensionState({
      detected: true,
      version: redactHermesVisibleText(data.payload?.version || "", 80),
      lastSeenAt: new Date().toISOString(),
    });
    rerenderMediaSettings();
    return;
  }
  if (data.type === "PF_HERMES_LINK_CURRENT_TAB_RESULT") {
    applyHermesProfilePacket(data.payload || {});
  }
}
function ensureHermesExtensionListener() {
  if (hermesExtensionListenerReady || typeof window === "undefined") return;
  hermesExtensionListenerReady = true;
  window.addEventListener("message", handleHermesExtensionPageMessage);
  setTimeout(() => requestHermesExtensionPing(), 300);
}
function requestHermesExtensionPing() {
  if (typeof window === "undefined") return;
  window.postMessage({
    protocol: HERMES_EXTENSION_PROTOCOL,
    type: "PF_HERMES_EXTENSION_PING",
    requestedAt: new Date().toISOString(),
    forbiddenFields: ["cookies", "passwords", "tokens", "privateMessages", "browserHistory"],
  }, window.location.origin);
}
function requestHermesExtensionProfileLink(targetPlatform = "", options = {}) {
  if (typeof window === "undefined") return;
  if (!options.quiet) {
    socialNotice = `${socialAccountName(targetPlatform)} sign-in requested. PhantomForce will link it from the browser bridge using public profile fields only.`;
  }
  saveHermesExtensionState({ pendingPlatform: targetPlatform || "", lastLinkRequestedAt: new Date().toISOString() });
  window.postMessage({
    protocol: HERMES_EXTENSION_PROTOCOL,
    type: "PF_HERMES_LINK_CURRENT_TAB_REQUEST",
    requestedAt: new Date().toISOString(),
    userConfirmed: true,
    preferredPlatform: targetPlatform || "",
    allowedFields: ["platform", "handle", "url", "displayName", "pageTitle"],
    forbiddenFields: ["cookies", "passwords", "tokens", "privateMessages", "browserHistory"],
  }, window.location.origin);
  if (!options.quiet) rerenderMediaSettings();
}
function startSocialBridgePolling(targetPlatform = "") {
  if (typeof window === "undefined" || !targetPlatform) return;
  if (socialBridgePollTimer) clearInterval(socialBridgePollTimer);
  let attempts = 0;
  const tick = () => {
    attempts += 1;
    requestHermesExtensionProfileLink(targetPlatform, { quiet: true });
    if (attempts >= 24 && socialBridgePollTimer) {
      clearInterval(socialBridgePollTimer);
      socialBridgePollTimer = 0;
    }
  };
  setTimeout(tick, 900);
  socialBridgePollTimer = setInterval(tick, 2500);
}

/* ---------------- config ---------------- */
export function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch {}
  const providers = DEFAULT_PROVIDERS.map((p) => {
    const s = (saved.providers || {})[p.id] || {};
    return {
      ...p,
      enabled: s.enabled != null ? s.enabled : p.enabled,
      endpoint: s.endpoint || "",
      localKey: s.localKey || "",
      defaultModel: s.defaultModel || {},
    };
  });
  // any custom providers the user added
  for (const c of saved.customProviders || []) providers.push({ ...c, custom: true });
  return {
    providers,
    endpointBase: saved.endpointBase || "",
    routing: { image: "higgsfield", video: "higgsfield", enhance: "claude", ...(saved.routing || {}) },
    customProviders: saved.customProviders || [],
    credits: saved.credits != null ? saved.credits : 480,
    requireApproval: saved.requireApproval != null ? saved.requireApproval : false,
  };
}
export function saveCfg(cfg) {
  const providers = {};
  for (const p of cfg.providers) {
    if (p.custom) continue;
    providers[p.id] = { enabled: p.enabled, endpoint: p.endpoint || "", localKey: p.localKey || "", defaultModel: p.defaultModel || {} };
  }
  const out = {
    providers,
    endpointBase: cfg.endpointBase || "",
    routing: cfg.routing,
    customProviders: cfg.providers.filter((p) => p.custom),
    credits: cfg.credits,
    requireApproval: cfg.requireApproval,
  };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(out)); } catch {}
}
const provider = (cfg, id) => cfg.providers.find((p) => p.id === id);
const providersFor = (cfg, modality) => cfg.providers.filter((p) => p.enabled && p.modalities.includes(modality));
function genBase(cfg) {
  if (cfg.endpointBase) return cfg.endpointBase.replace(/\/+$/, "");
  return (location.hostname === "127.0.0.1" || location.hostname === "localhost")
    ? "http://127.0.0.1:8788" : "https://ai.phantomforce.online";
}

/* ---------------- generation client ---------------- */
// Returns { assets:[{type,url,meta}], live:boolean } — never throws; falls back
// to a procedural preview so the studio is always usable.
async function generate(cfg, req) {
  const base = genBase(cfg);
  const p = provider(cfg, req.provider) || {};
  const url = (p.endpoint || `${base}/generate`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(p.localKey ? { "x-provider-key": p.localKey } : {}) },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => null);
    if (d && Array.isArray(d.assets) && d.assets.length) {
      return { assets: d.assets.map((a) => ({ type: a.type || req.modality, url: a.url, meta: a.meta })), live: true };
    }
  } catch { /* unreachable / unconfigured → preview */ }
  finally { clearTimeout(timer); }
  const assets = [];
  for (let i = 0; i < (req.params.count || 1); i++) assets.push(previewAsset(req, i));
  return { assets, live: false };
}

async function enhancePrompt(cfg, prompt) {
  const base = genBase(cfg);
  try {
    const r = await fetch(`${base}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Rewrite this into a single vivid, specific image/video generation prompt (one line, no preamble): ${prompt}` }),
    });
    const d = await r.json().catch(() => null);
    if (d && d.reply) return String(d.reply).replace(/^["']|["']$/g, "").trim();
  } catch {}
  // local enrichment fallback
  const extras = ["cinematic lighting", "sharp focus", "high detail", "volumetric glow", "shallow depth of field", "8k"];
  const add = extras.filter((e) => !prompt.toLowerCase().includes(e.split(" ")[0])).slice(0, 3).join(", ");
  return `${prompt.trim()}, ${add}, emerald neon accents, dark background`;
}

/* ---------------- procedural preview (looks real, works offline) ---------------- */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function previewAsset(req, i) {
  const [, ar] = (req.modality === "video" ? VID_ASPECTS : IMG_ASPECTS).find(([k]) => k === req.params.aspect) || ["1:1", 1];
  const W = 640, H = Math.round(W / ar);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const seed = hashStr((req.prompt || "phantom") + "|" + req.style + "|" + i);
  const rng = mulberry(seed);
  // base gradient
  const hueBase = req.style === "Neon" ? 150 : req.style === "Analog film" ? 40 : req.style === "Portrait" ? 160 : 155;
  const g1 = g.createLinearGradient(0, 0, W, H);
  g1.addColorStop(0, `hsl(${hueBase + rng() * 30}, 60%, ${8 + rng() * 6}%)`);
  g1.addColorStop(1, `hsl(${180 + rng() * 40}, 55%, ${4 + rng() * 4}%)`);
  g.fillStyle = g1; g.fillRect(0, 0, W, H);
  // flowing blobs (emerald palette)
  for (let b = 0; b < 5; b++) {
    const x = rng() * W, y = rng() * H, r = (0.2 + rng() * 0.4) * W;
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    const hue = 140 + rng() * 60;
    rad.addColorStop(0, `hsla(${hue}, 90%, 60%, ${0.16 + rng() * 0.2})`);
    rad.addColorStop(1, "hsla(160, 90%, 60%, 0)");
    g.fillStyle = rad; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  // flow-field strokes → a "generated" texture
  g.globalCompositeOperation = "screen";
  for (let s = 0; s < 220; s++) {
    let x = rng() * W, y = rng() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      const a = (Math.sin(x * 0.01 + seed) + Math.cos(y * 0.012 - seed)) * Math.PI;
      x += Math.cos(a) * 7; y += Math.sin(a) * 7;
      g.lineTo(x, y);
    }
    g.strokeStyle = `hsla(${150 + rng() * 40}, 100%, ${55 + rng() * 25}%, ${0.05 + rng() * 0.06})`;
    g.lineWidth = 0.8 + rng() * 1.4; g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  // vignette
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
  vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  // video affordance
  if (req.modality === "video") {
    g.fillStyle = "rgba(2,10,8,0.5)"; g.beginPath(); g.arc(W / 2, H / 2, 34, 0, TAU); g.fill();
    g.fillStyle = "rgba(120,255,190,0.95)"; g.beginPath();
    g.moveTo(W / 2 - 10, H / 2 - 15); g.lineTo(W / 2 + 18, H / 2); g.lineTo(W / 2 - 10, H / 2 + 15); g.closePath(); g.fill();
  }
  // watermark
  g.fillStyle = "rgba(180,255,220,0.5)"; g.font = "600 11px 'DM Mono', monospace";
  g.fillText("PHANTOM · PREVIEW", 14, H - 14);
  return { type: req.modality, url: c.toDataURL("image/webp", 0.85), meta: { preview: true, prompt: req.prompt, style: req.style, preset: req.preset || "Custom" } };
}

/* =========================================================================
   STUDIO
   ========================================================================= */
let session = { assets: [], tab: "generate", edit: null };

function consumeEditIntent(opts = {}) {
  let intent = null;
  try { intent = JSON.parse(localStorage.getItem(EDIT_INTENT_KEY) || "null"); } catch {}
  if (!intent || intent.type !== "image" || !intent.url) return;
  try { localStorage.removeItem(EDIT_INTENT_KEY); } catch {}
  const asset = {
    id: intent.id || `hub-edit-${Date.now()}`,
    type: "image",
    url: intent.url,
    saved: true,
    meta: { prompt: intent.prompt || "", title: intent.title || "Content Hub edit" },
  };
  if (!session.assets.some((item) => item.id === asset.id)) session.assets.unshift(asset);
  session.edit = { url: asset.url, type: "image", id: asset.id };
  session.tab = "edit";
  resetEdit();
  opts.notify?.("Media Factory", `loaded ${intent.title || "Content Hub asset"} for local edit.`);
}

export function renderMediaStudio(el, opts = {}) {
  consumeEditIntent(opts);
  const esc = opts.esc || ((s) => String(s));
  const cfg = loadCfg();
  const tabs = [["generate", "Generate"], ["edit", "Edit"], ["library", `Library${session.assets.length ? ` · ${session.assets.length}` : ""}`], ["briefs", "Video Requests"]];
  const engineReady = providersFor(cfg, "image").length + providersFor(cfg, "video").length > 0;
  el.innerHTML = `
    <div class="ml">
      <div class="ml-deck">
        <div class="ml-tabs" role="tablist" aria-label="Media Lab views">
          ${tabs.map(([id, label]) => `<button class="ml-tab ${session.tab === id ? "is-active" : ""}" role="tab" aria-selected="${session.tab === id}" data-ml-tab="${id}">${label}</button>`).join("")}
        </div>
        <div class="ml-deck-status">
          <span class="ml-chip ${engineReady ? "is-ready" : ""}"><i aria-hidden="true"></i>Cinematic Engine · ${engineReady ? "ready" : "standby"}</span>
          <span class="ml-chip"><i aria-hidden="true"></i>Queue · ${session.assets.length}</span>
          <span class="ml-credits" title="Production credits">${svgIc("bolt")} ${cfg.credits} credits</span>
        </div>
      </div>
      <div class="ml-body" data-ml-body></div>
    </div>`;
  el.querySelectorAll("[data-ml-tab]").forEach((b) => b.onclick = () => { session.tab = b.dataset.mlTab; renderMediaStudio(el, opts); });
  const body = el.querySelector("[data-ml-body]");
  if (session.tab === "generate") renderGenerate(body, cfg, opts, el);
  else if (session.tab === "edit") renderEdit(body, cfg, opts, el);
  else if (session.tab === "library") renderLibrary(body, opts, el);
  else if (session.tab === "briefs") (opts.renderBriefs ? opts.renderBriefs(body) : (body.innerHTML = `<p class="empty-line">Video requests unavailable.</p>`));
}

/* ---- Generate ---- */
const genState = { modality: "image", provider: "higgsfield", model: "", prompt: "", negative: "", aspect: "1:1", count: 2, quality: "standard", style: "Cinematic", duration: 6, ref: null, busy: false, showNeg: false, preset: "custom" };

function activePreset() {
  return MEDIA_PRESETS.find((p) => p.id === genState.preset) || null;
}
function presetSpec(p) {
  return `${p.modality === "video" ? "Video" : "Image"} · ${p.aspect}${p.modality === "video" ? ` · ${p.duration}s` : ` · ${p.count || 1} take${(p.count || 1) > 1 ? "s" : ""}`}`;
}
function presetDeckLabel() {
  return genState.modality === "video" ? "Video presets" : "Image presets";
}
function presetCardMeta(p) {
  return [
    p.aspect,
    p.modality === "video" ? `${p.duration}s` : `${p.count || 1} take${(p.count || 1) > 1 ? "s" : ""}`,
    p.style,
  ].filter(Boolean);
}
function applyPreset(p) {
  genState.preset = p.id;
  genState.modality = p.modality;
  genState.aspect = p.aspect;
  genState.style = p.style || genState.style;
  if (p.modality === "video") genState.duration = p.duration || genState.duration;
  else genState.count = p.count || genState.count;
  if (!genState.prompt.trim()) genState.prompt = p.prompt || "";
}
function setModality(v) {
  genState.modality = v;
  markCustomPreset();
  if (v === "video") {
    genState.aspect = "9:16";
    genState.duration = 8;
  } else {
    genState.aspect = "1:1";
    genState.count = 2;
  }
}
function markCustomPreset() {
  genState.preset = "custom";
}

function renderGenerate(body, cfg, opts, root) {
  const esc = opts.esc || ((s) => String(s));
  const provs = providersFor(cfg, genState.modality);
  if (!provs.find((p) => p.id === genState.provider)) genState.provider = (provs[0] && provs[0].id) || "";
  const p = provider(cfg, genState.provider);
  const models = (p && p.models[genState.modality]) || [];
  if (!models.includes(genState.model)) genState.model = models[0] || "";
  const aspects = genState.modality === "video" ? VID_ASPECTS : IMG_ASPECTS;
  if (!aspects.find(([k]) => k === genState.aspect)) genState.aspect = aspects[0][0];
  const visiblePresets = MEDIA_PRESETS.filter((preset) => preset.modality === genState.modality);

  body.innerHTML = `
    <div class="ml-studio">
      <aside class="ml-panel ml-builder" aria-label="Shot Builder">
        <div class="ml-card-head"><b>Shot Builder</b><i>Pick a format, then roll</i></div>
        <div class="ml-seg" data-ml-modality>
          <button class="${genState.modality === "image" ? "is-on" : ""}" data-v="image">${svgIc("image")} Image</button>
          <button class="${genState.modality === "video" ? "is-on" : ""}" data-v="video">${svgIc("film")} Video</button>
        </div>

        <label class="ml-field ml-field-presets"><span class="ml-preset-heading"><b>${presetDeckLabel()}</b><i>${visiblePresets.length} pro formats</i></span>
          <div class="ml-presets" data-ml-presets>
            ${visiblePresets.map((p) => `<button class="ml-preset is-${p.modality} ${genState.preset === p.id ? "is-on" : ""}" data-v="${p.id}" title="${esc(p.prompt)}">
              <span class="ml-preset-kicker">${svgIc(p.modality === "video" ? "film" : "image")} ${esc(p.use)}</span>
              <b>${esc(p.label)}</b>
              <span class="ml-preset-meta">${presetCardMeta(p).map((m) => `<i>${esc(m)}</i>`).join("")}</span>
              <em>${esc(p.note || presetSpec(p))}</em>
            </button>`).join("")}
          </div>
        </label>

        <label class="ml-field"><span>Engine</span>
          <div class="ml-provs" data-ml-provs>
            ${provs.map((pr) => `<button class="ml-prov ${genState.provider === pr.id ? "is-on" : ""}" data-v="${pr.id}" style="--pb:${pr.brand}">
              <i style="background:${pr.brand}"></i>${esc(pr.name)}</button>`).join("") || `<span class="ml-hint">No engine enabled for ${genState.modality}. <b data-ml-open-settings>Configure →</b></span>`}
          </div>
        </label>

        ${models.length ? `<label class="ml-field"><span>Render lane</span>
          <select class="ml-select" data-ml-model>${models.map((m) => `<option value="${esc(m)}" ${genState.model === m ? "selected" : ""}>${esc(laneLabel(m))}</option>`).join("")}</select></label>` : ""}

        <label class="ml-field ml-field-brief"><span>Shot brief</span>
          <div class="ml-prompt-wrap">
            <textarea class="ml-prompt" data-ml-prompt rows="4" placeholder="Describe the shot — subject, setting, light, mood…">${esc(genState.prompt)}</textarea>
            <button class="ml-enhance" data-ml-enhance title="Improve prompt">${svgIc("spark")} Enhance</button>
          </div>
        </label>
        <button class="ml-link" data-ml-toggleneg>${genState.showNeg ? "− Hide" : "+ Add"} negative prompt</button>
        ${genState.showNeg ? `<label class="ml-field"><textarea class="ml-prompt" data-ml-neg rows="2" placeholder="What to avoid…">${esc(genState.negative)}</textarea></label>` : ""}

        <div class="ml-row">
          <label class="ml-field ml-grow"><span>Frame</span>
            <div class="ml-chips" data-ml-aspect>${aspects.map(([k]) => `<button class="${genState.aspect === k ? "is-on" : ""}" data-v="${k}">${k}</button>`).join("")}</div>
          </label>
          ${genState.modality === "video" ? `<label class="ml-field"><span>Duration</span>
            <div class="ml-chips" data-ml-dur>${DURATIONS.map((d) => `<button class="${genState.duration === d ? "is-on" : ""}" data-v="${d}">${d}s</button>`).join("")}</div></label>`
          : `<label class="ml-field"><span>Takes</span>
            <div class="ml-chips" data-ml-count>${[1, 2, 3, 4].map((n) => `<button class="${genState.count === n ? "is-on" : ""}" data-v="${n}">${n}</button>`).join("")}</div></label>`}
        </div>

        <label class="ml-field"><span>Style</span>
          <div class="ml-chips ml-chips-wrap" data-ml-style>${STYLES.map((s) => `<button class="${genState.style === s ? "is-on" : ""}" data-v="${s}">${s}</button>`).join("")}</div>
        </label>

        <label class="ml-field"><span>Reference (optional)</span>
          <div class="ml-drop ${genState.ref ? "has-ref" : ""}" data-ml-drop>
            ${genState.ref ? `<img src="${genState.ref}" alt="reference"/><button class="ml-drop-x" data-ml-clearref aria-label="Remove reference image">✕</button>`
            : `<span>${svgIc("upload")} Drop an image or click to upload — for img→${genState.modality}, style, or continuity</span>`}
            <input type="file" accept="image/*" data-ml-file hidden />
          </div>
        </label>

        <button class="ml-generate" data-ml-generate ${genState.busy || !genState.provider ? "disabled" : ""}>
          ${genState.busy ? `${svgIc("spark")} Rendering…` : `${svgIc("bolt")} Generate ${genState.modality} · ~${estCredits()} credits`}
        </button>
      </aside>

      <section class="ml-stage" data-ml-results aria-label="Preview Stage">
        <div class="ml-stage-frame ${genState.busy ? "is-busy" : ""}">
          <header class="ml-stage-top">
            <span class="ml-rec ${genState.busy ? "is-live" : ""}"><i aria-hidden="true"></i>${genState.busy ? "Rendering" : "Stage ready"}</span>
            <b>Preview Stage</b>
            <span class="ml-stage-chip">${genState.aspect}${genState.modality === "video" ? ` · ${genState.duration}s` : ""}</span>
          </header>
          <div class="ml-stage-view">
            ${genState.busy ? skeletons(genState.modality === "video" ? 1 : genState.count) : resultsHtml(esc)}
          </div>
          <footer class="ml-stage-meta">${briefChips(esc)}</footer>
        </div>
      </section>

      ${railHtml(cfg, esc)}
    </div>`;

  wireGenerate(body, cfg, opts, root, esc);
}

function briefChips(esc) {
  const preset = activePreset();
  const chips = [
    preset ? preset.label : "Custom",
    genState.modality === "video" ? "Video" : "Image",
    genState.model ? laneLabel(genState.model) : null,
    genState.style !== "None" ? genState.style : null,
    genState.aspect,
    genState.modality === "video" ? `${genState.duration}s` : `${genState.count} take${genState.count > 1 ? "s" : ""}`,
    `≈ ${estCredits()} credits`,
  ].filter(Boolean);
  return `<div class="ml-brief-chips" aria-label="Current shot brief">${chips.map((c) => `<span>${esc(String(c))}</span>`).join("")}</div>`;
}

function railHtml(cfg, esc) {
  const queue = session.assets.slice(0, 4);
  const meterPct = Math.max(4, Math.min(100, Math.round((cfg.credits / 480) * 100)));
  return `
      <aside class="ml-rail" aria-label="Production rail">
        <section class="ml-rail-card">
          <h4>Production credits</h4>
          <div class="ml-rail-credit"><b>${cfg.credits}</b><span>available</span></div>
          <div class="ml-meter" role="img" aria-label="${cfg.credits} production credits available"><i style="width:${meterPct}%"></i></div>
          <p>Next run ≈ ${estCredits()} credits · owner-controlled spend</p>
        </section>
        <section class="ml-rail-card">
          <h4>Render mode</h4>
          <div class="ml-rail-rows">
            <span><b>Preset</b><i>${esc(activePreset()?.label || "Custom")}</i></span>
            <span><b>Mode</b><i>${genState.modality === "video" ? "Video" : "Image"}</i></span>
            ${genState.model ? `<span><b>Lane</b><i>${esc(laneLabel(genState.model))}</i></span>` : ""}
            <span><b>Look</b><i>${esc(genState.style)}</i></span>
            <span><b>Frame</b><i>${esc(genState.aspect)}${genState.modality === "video" ? ` · ${genState.duration}s` : ""}</i></span>
          </div>
        </section>
        <section class="ml-rail-card">
          <h4>Content Hub routing</h4>
          <p>Every finished render is captured to your Content Hub automatically.</p>
          <span class="ml-chip is-ready"><i aria-hidden="true"></i>Auto-capture on</span>
        </section>
        <section class="ml-rail-card ml-rail-guard">
          <h4>Safeguards</h4>
          <p>${cfg.requireApproval ? "Approval is required before paid renders." : "Paid renders stay owner-approved."} Nothing posts externally without you.</p>
        </section>
        <section class="ml-rail-card">
          <h4>Production queue</h4>
          ${queue.length
            ? `<div class="ml-queue">${queue.map((a) => queueRow(a, esc)).join("")}</div>`
            : `<p class="ml-rail-empty">Queue clear — the stage is yours.</p>`}
        </section>
      </aside>`;
}

function queueRow(a, esc) {
  const status = a.saved ? "saved" : (a.meta && a.meta.preview) ? "preview" : "live";
  const label = a.type === "video" ? "Video take" : "Still frame";
  return `<button class="ml-q-row" data-tile-act="edit" data-id="${a.id}" title="Open in editor" aria-label="Open ${label.toLowerCase()} in editor">
    <img src="${a.url}" alt=""/>
    <span class="ml-q-info"><b>${label}</b><i>${esc(String((a.meta && a.meta.prompt) || "Untitled shot").slice(0, 42))}</i></span>
    <em class="ml-q-badge is-${status}">${status}</em>
  </button>`;
}

const estCredits = () => genState.modality === "video" ? genState.duration * 4 : genState.count * (genState.quality === "high" ? 6 : 3);
function captureForContentHub(asset, extra = {}) {
  try {
    const result = registerContentAsset({
      ...asset,
      title: extra.title || (asset.type === "video" ? "Generated video" : "Generated image"),
      prompt: extra.prompt || (asset.meta && asset.meta.prompt) || genState.prompt,
      source: "Media Lab",
      provider: extra.provider || genState.provider,
      model: extra.model || genState.model,
      style: extra.style || genState.style,
      aspect: extra.aspect || genState.aspect,
      duration: extra.duration || genState.duration,
      live: !!extra.live,
      createdAt: asset.at || Date.now(),
    });
    return result.stats;
  } catch {
    return null;
  }
}
function refreshGeneratePanel(body, cfg, opts, root) {
  genState.busy = false;
  try {
    renderGenerate(body, cfg, opts, root);
  } catch {
    if (root) renderMediaStudio(root, opts);
  }
  setTimeout(() => {
    const btn = body?.querySelector?.("[data-ml-generate]");
    if (btn?.disabled && root) renderMediaStudio(root, opts);
  }, 0);
}
function skeletons(n) { return `<div class="ml-grid ml-stage-grid">${Array.from({ length: n }, () => `<div class="ml-skel"><div class="ml-skel-shim"></div></div>`).join("")}</div>`; }
const IDLE_HINTS = ["Neon product hero on wet asphalt", "Founder portrait, window light", "Emerald smoke logo reveal"];
function resultsHtml(esc) {
  const recent = session.assets.filter((a) => a.fromGen);
  if (!recent.length) return `
    <div class="ml-idle">
      <div class="ml-idle-orb" aria-hidden="true"><span></span><span></span><span></span></div>
      <b>The stage is lit and waiting</b>
      <i>Write a shot brief and roll — your frames land here. No engine connected yet? You still get a live preview.</i>
      <div class="ml-board" aria-hidden="true">
        ${["1:1", "4:5", "16:9", "9:16", "3:2"].map((r, i) => `<span class="ml-board-cell" style="--d:${(i * 0.4).toFixed(1)}s" data-ratio="${r}"></span>`).join("")}
      </div>
      <div class="ml-idle-hints">
        ${IDLE_HINTS.map((h) => `<button data-ml-hint="${esc(h)}">${esc(h)}</button>`).join("")}
      </div>
    </div>`;
  return `<div class="ml-grid ml-stage-grid">${recent.slice(0, 8).map((a) => tileHtml(a, esc)).join("")}</div>`;
}
function tileHtml(a, esc) {
  return `<figure class="ml-tile ${a.meta && a.meta.preview ? "is-preview" : ""}" data-asset="${a.id}">
    <button class="ml-tile-x" data-tile-act="remove" data-id="${a.id}" title="Remove" aria-label="Remove generated asset">×</button>
    <img src="${a.url}" alt="${esc((a.meta && a.meta.prompt) || "generation")}" loading="lazy"/>
    ${a.type === "video" ? `<span class="ml-play">${svgIc("play")}</span>` : ""}
    ${a.meta && a.meta.preview ? `<span class="ml-badge">preview</span>` : `<span class="ml-badge ml-badge-live">live</span>`}
    <figcaption class="ml-tile-bar">
      <button data-tile-act="edit" data-id="${a.id}" title="Edit" aria-label="Edit">${svgIc("edit")}</button>
      <button data-tile-act="save" data-id="${a.id}" title="Save to library" aria-label="Save to library">${svgIc("check")}</button>
      <button data-tile-act="download" data-id="${a.id}" title="Download" aria-label="Download">${svgIc("upload")}</button>
      <button data-tile-act="regen" data-id="${a.id}" title="Regenerate" aria-label="Regenerate">${svgIc("spark")}</button>
      <button data-tile-act="ref" data-id="${a.id}" title="Use as reference" aria-label="Use as reference">${svgIc("image")}</button>
    </figcaption>
  </figure>`;
}

function wireGenerate(body, cfg, opts, root, esc) {
  const seg = (sel, fn) => body.querySelectorAll(`${sel} button`).forEach((b) => b.onclick = () => { fn(b.dataset.v); renderGenerate(body, cfg, opts, root); });
  body.querySelectorAll("[data-ml-presets] button").forEach((b) => b.onclick = () => {
    const preset = MEDIA_PRESETS.find((p) => p.id === b.dataset.v);
    if (preset) applyPreset(preset);
    renderGenerate(body, cfg, opts, root);
  });
  seg("[data-ml-modality]", setModality);
  seg("[data-ml-provs]", (v) => { genState.provider = v; });
  seg("[data-ml-aspect]", (v) => { genState.aspect = v; markCustomPreset(); });
  if (body.querySelector("[data-ml-count]")) seg("[data-ml-count]", (v) => { genState.count = +v; markCustomPreset(); });
  if (body.querySelector("[data-ml-dur]")) seg("[data-ml-dur]", (v) => { genState.duration = +v; markCustomPreset(); });
  seg("[data-ml-style]", (v) => { genState.style = v; markCustomPreset(); });
  const modelSel = body.querySelector("[data-ml-model]");
  if (modelSel) modelSel.onchange = () => { genState.model = modelSel.value; };
  const pr = body.querySelector("[data-ml-prompt]"); if (pr) pr.oninput = () => { genState.prompt = pr.value; };
  const neg = body.querySelector("[data-ml-neg]"); if (neg) neg.oninput = () => { genState.negative = neg.value; };
  const tgl = body.querySelector("[data-ml-toggleneg]"); if (tgl) tgl.onclick = () => { genState.showNeg = !genState.showNeg; renderGenerate(body, cfg, opts, root); };
  const os = body.querySelector("[data-ml-open-settings]"); if (os) os.onclick = () => opts.openSettings && opts.openSettings();
  body.querySelectorAll("[data-ml-hint]").forEach((b) => b.onclick = () => { genState.prompt = b.dataset.mlHint; renderGenerate(body, cfg, opts, root); });

  const enh = body.querySelector("[data-ml-enhance]");
  if (enh) enh.onclick = async () => {
    if (!genState.prompt.trim()) return;
    enh.disabled = true; enh.innerHTML = `${svgIc("spark")} …`;
    genState.prompt = await enhancePrompt(cfg, genState.prompt);
    renderGenerate(body, cfg, opts, root);
  };

  // reference upload / drop
  const drop = body.querySelector("[data-ml-drop]");
  const file = body.querySelector("[data-ml-file]");
  const cx = body.querySelector("[data-ml-clearref]");
  if (cx) cx.onclick = (e) => { e.stopPropagation(); genState.ref = null; renderGenerate(body, cfg, opts, root); };
  if (drop && file) {
    drop.onclick = (e) => { if (!e.target.closest("[data-ml-clearref]")) file.click(); };
    file.onchange = () => readImage(file.files[0], (url) => { genState.ref = url; renderGenerate(body, cfg, opts, root); });
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
    drop.ondragleave = () => drop.classList.remove("drag");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("drag"); readImage(e.dataTransfer.files[0], (url) => { genState.ref = url; renderGenerate(body, cfg, opts, root); }); };
  }

  const genBtn = body.querySelector("[data-ml-generate]");
  if (genBtn) genBtn.onclick = () => runGenerate(body, cfg, opts, root, esc);

  body.querySelectorAll("[data-tile-act]").forEach((b) => b.onclick = () => tileAction(b.dataset.tileAct, b.dataset.id, cfg, opts, root, esc, body));
}

async function runGenerate(body, cfg, opts, root, esc) {
  if (!genState.prompt.trim()) { const t = body.querySelector("[data-ml-prompt]"); if (t) { t.focus(); t.classList.add("shake"); setTimeout(() => t.classList.remove("shake"), 500); } return; }
  genState.busy = true;
  renderGenerate(body, cfg, opts, root);
  try {
    const req = {
      modality: genState.modality, provider: genState.provider, model: genState.model,
      prompt: genState.prompt, negative: genState.negative, style: genState.style,
      preset: activePreset()?.label || "Custom",
      ref: genState.ref, params: { aspect: genState.aspect, count: genState.modality === "video" ? 1 : genState.count, quality: genState.quality, duration: genState.duration },
    };
    const out = await generate(cfg, req);
    const stamp = Date.now();
    const created = out.assets.map((a, i) => ({ id: `gen-${stamp}-${i}`, ...a, fromGen: true, at: stamp }));
    created.forEach((asset) => {
      session.assets.unshift(asset);
      captureForContentHub(asset, {
        title: `${genState.modality === "video" ? "Generated video" : "Generated image"} · ${genState.style}`,
        prompt: genState.prompt,
        provider: genState.provider,
        model: genState.model,
        style: genState.style,
        aspect: genState.aspect,
        duration: genState.duration,
        preset: activePreset()?.label || "Custom",
        live: out.live,
      });
    });
    session.assets = session.assets.slice(0, 60);
    refreshGeneratePanel(body, cfg, opts, root);
    if (opts.notify) opts.notify("Media Factory", `generated ${out.assets.length} ${genState.modality}${out.assets.length > 1 ? "s" : ""}${out.live ? "" : " (preview)"} - "${genState.prompt.slice(0, 40)}".`);
    // spend credits (client-side demo accounting)
    cfg.credits = Math.max(0, cfg.credits - estCredits()); saveCfg(cfg);
  } finally {
    if (genState.busy) refreshGeneratePanel(body, cfg, opts, root);
  }
}

function tileAction(act, id, cfg, opts, root, esc, body) {
  const a = session.assets.find((x) => x.id === id);
  if (!a) return;
  if (act === "download") return downloadAsset(a);
  if (act === "regen") { runGenerate(body, cfg, opts, root, esc); return; }
  if (act === "ref") { genState.ref = a.url; session.tab = "generate"; renderMediaStudio(root, opts); return; }
  if (act === "save") { a.saved = true; captureForContentHub(a); if (opts.notify) opts.notify("Media Factory", "saved a generation to the library."); renderMediaStudio(root, opts); return; }
  if (act === "edit") { session.edit = { url: a.url, type: a.type, id: a.id }; session.tab = "edit"; renderMediaStudio(root, opts); return; }
  if (act === "remove") {
    session.assets = session.assets.filter((x) => x.id !== id);
    if (session.edit?.id === id) session.edit = null;
    if (opts.notify) opts.notify("Media Factory", "removed a local media asset.");
    renderMediaStudio(root, opts);
  }
}

/* ---- Library ---- */
function renderLibrary(body, opts, root) {
  const esc = opts.esc || ((s) => String(s));
  const assets = session.assets;
  body.innerHTML = assets.length
    ? `<div class="ml-grid ml-grid-lib">${assets.map((a) => tileHtml(a, esc)).join("")}</div>`
    : `<div class="ml-empty">${svgIc("image")}<b>No assets yet</b><i>Everything you generate or edit lands here for the session.</i></div>`;
  body.querySelectorAll("[data-tile-act]").forEach((b) => b.onclick = () => {
    const a = assets.find((x) => x.id === b.dataset.id); if (!a) return;
    if (b.dataset.tileAct === "download") downloadAsset(a);
    else if (b.dataset.tileAct === "edit") { session.edit = { url: a.url, type: a.type, id: a.id }; session.tab = "edit"; renderMediaStudio(root, opts); }
    else if (b.dataset.tileAct === "ref") { genState.ref = a.url; session.tab = "generate"; renderMediaStudio(root, opts); }
    else if (b.dataset.tileAct === "remove") {
      session.assets = session.assets.filter((x) => x.id !== b.dataset.id);
      if (session.edit?.id === b.dataset.id) session.edit = null;
      if (opts.notify) opts.notify("Media Factory", "removed a local media asset.");
      renderMediaStudio(root, opts);
    }
  });
}

/* ---- Edit (real client-side canvas editor) ---- */
const editState = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, rotate: 0, flip: false, text: "", loadedUrl: null };
function renderEdit(body, cfg, opts, root) {
  const esc = opts.esc || ((s) => String(s));
  if (!session.edit) {
    body.innerHTML = `<div class="ml-empty">${svgIc("edit")}<b>Pick something to edit</b><i>Generate an image, choose one from your library, or upload.</i>
      <div class="ml-edit-pick"><button class="ml-generate ml-inline" data-ml-upload>${svgIc("upload")} Upload an image</button>
      ${session.assets[0] ? `<button class="ml-generate ml-inline ml-ghost" data-ml-fromlib>Use latest generation</button>` : ""}</div>
      <input type="file" accept="image/*" data-ml-editfile hidden /></div>`;
    const f = body.querySelector("[data-ml-editfile]");
    body.querySelector("[data-ml-upload]").onclick = () => f.click();
    f.onchange = () => readImage(f.files[0], (url) => { session.edit = { url, type: "image", id: `up-${Date.now()}` }; resetEdit(); renderMediaStudio(root, opts); });
    const fl = body.querySelector("[data-ml-fromlib]"); if (fl) fl.onclick = () => { const a = session.assets[0]; session.edit = { url: a.url, type: a.type, id: a.id }; resetEdit(); renderMediaStudio(root, opts); };
    return;
  }
  body.innerHTML = `
    <div class="ml-editor">
      <div class="ml-canvas-wrap"><canvas class="ml-canvas" data-ml-canvas></canvas></div>
      <div class="ml-tools">
        <div class="ml-tool-head">Adjust</div>
        ${slider("Brightness", "brightness", 0, 200, editState.brightness)}
        ${slider("Contrast", "contrast", 0, 200, editState.contrast)}
        ${slider("Saturation", "saturate", 0, 250, editState.saturate)}
        ${slider("Hue", "hue", 0, 360, editState.hue)}
        ${slider("Blur", "blur", 0, 12, editState.blur)}
        <div class="ml-tool-head">Transform</div>
        <div class="ml-chips"><button data-ml-rot="-90">${svgIc("undo")} 90°</button><button data-ml-rot="90">90° ${svgIc("redo")}</button><button data-ml-flip class="${editState.flip ? "is-on" : ""}">Flip</button></div>
        <div class="ml-tool-head">Filters</div>
        <div class="ml-chips ml-chips-wrap" data-ml-filter>
          <button data-v="none">None</button><button data-v="noir">Noir</button><button data-v="emerald">Emerald</button>
          <button data-v="warm">Warm</button><button data-v="cold">Cold</button><button data-v="vivid">Vivid</button>
        </div>
        <div class="ml-tool-head">Text overlay</div>
        <input class="ml-text-in" data-ml-text placeholder="Add a caption / headline…" value="${esc(editState.text)}"/>
        <div class="ml-tool-head">AI edit ${svgIc("spark")}</div>
        <div class="ml-prompt-wrap">
          <input class="ml-text-in" data-ml-aiedit placeholder="e.g. remove background, make it night, add rain"/>
          <button class="ml-enhance" data-ml-runai>Apply</button>
        </div>
        <div class="ml-editor-actions">
          <button class="ml-generate" data-ml-savedit>${svgIc("check")} Save to library</button>
          <button class="ml-generate ml-ghost" data-ml-dledit>${svgIc("upload")} Download</button>
          <button class="ml-link" data-ml-resetedit>Reset</button>
          <button class="ml-link" data-ml-changeedit>Change image</button>
        </div>
      </div>
    </div>`;
  const canvas = body.querySelector("[data-ml-canvas]");
  const img = new Image();
  img.onload = () => { editState.loadedUrl = session.edit.url; paintEdit(canvas, img); };
  img.src = session.edit.url;
  // wire tools
  body.querySelectorAll("[data-ml-slider]").forEach((s) => s.oninput = () => { editState[s.dataset.mlSlider] = +s.value; if (canvas._img) paintEdit(canvas, canvas._img); const o = body.querySelector(`[data-out="${s.dataset.mlSlider}"]`); if (o) o.textContent = s.value; });
  body.querySelectorAll("[data-ml-rot]").forEach((b) => b.onclick = () => { editState.rotate = (editState.rotate + (+b.dataset.mlRot) + 360) % 360; if (canvas._img) paintEdit(canvas, canvas._img); });
  const flip = body.querySelector("[data-ml-flip]"); if (flip) flip.onclick = () => { editState.flip = !editState.flip; flip.classList.toggle("is-on"); if (canvas._img) paintEdit(canvas, canvas._img); };
  body.querySelectorAll("[data-ml-filter] button").forEach((b) => b.onclick = () => { applyFilterPreset(b.dataset.v); syncSliders(body); if (canvas._img) paintEdit(canvas, canvas._img); });
  const tin = body.querySelector("[data-ml-text]"); if (tin) tin.oninput = () => { editState.text = tin.value; if (canvas._img) paintEdit(canvas, canvas._img); };
  const runai = body.querySelector("[data-ml-runai]");
  if (runai) runai.onclick = async () => {
    const q = (body.querySelector("[data-ml-aiedit]").value || "").toLowerCase();
    runai.disabled = true; runai.textContent = "…";
    // local heuristic "AI edit" preview (real backend routes to provider edit)
    if (/night|dark|noir/.test(q)) { editState.brightness = 70; editState.saturate = 80; editState.hue = 210; }
    else if (/warm|sunset|golden/.test(q)) { editState.brightness = 108; editState.saturate = 140; editState.hue = 20; }
    else if (/emerald|phantom|neon|green/.test(q)) { editState.saturate = 160; editState.hue = 130; }
    else if (/vivid|pop|vibrant/.test(q)) { editState.saturate = 175; editState.contrast = 120; }
    else { editState.contrast = 115; editState.saturate = 130; }
    syncSliders(body); if (canvas._img) paintEdit(canvas, canvas._img);
    runai.disabled = false; runai.textContent = "Apply";
    if (opts.notify) opts.notify("Media Factory", `applied an AI edit: "${q.slice(0, 30)}".`);
  };
  body.querySelector("[data-ml-resetedit]").onclick = () => { resetEdit(); renderMediaStudio(root, opts); };
  body.querySelector("[data-ml-changeedit]").onclick = () => { session.edit = null; renderMediaStudio(root, opts); };
  body.querySelector("[data-ml-savedit]").onclick = () => {
    const at = Date.now();
    const asset = { id: `edit-${at}`, type: "image", url: canvas.toDataURL("image/webp", 0.9), saved: true, at, meta: { edited: true, prompt: editState.text || "Edited image" } };
    session.assets.unshift(asset);
    captureForContentHub(asset, { title: "Edited image", prompt: editState.text || "Edited image" });
    if (opts.notify) opts.notify("Media Factory", "saved an edited image to the library.");
    session.tab = "library";
    renderMediaStudio(root, opts);
  };
  body.querySelector("[data-ml-dledit]").onclick = () => downloadAsset({ url: canvas.toDataURL("image/webp", 0.92), type: "image", id: "edit" });
}
function slider(label, key, min, max, val) {
  return `<label class="ml-slider"><span>${label} <b data-out="${key}">${val}</b></span>
    <input type="range" min="${min}" max="${max}" value="${val}" data-ml-slider="${key}"/></label>`;
}
function syncSliders(body) { ["brightness", "contrast", "saturate", "hue", "blur"].forEach((k) => { const s = body.querySelector(`[data-ml-slider="${k}"]`); if (s) s.value = editState[k]; const o = body.querySelector(`[data-out="${k}"]`); if (o) o.textContent = editState[k]; }); }
function applyFilterPreset(v) {
  const P = { none: [100, 100, 100, 0, 0], noir: [105, 120, 0, 0, 0], emerald: [100, 110, 150, 130, 0], warm: [108, 105, 135, 20, 0], cold: [98, 108, 90, 210, 0], vivid: [105, 125, 175, 0, 0] };
  const [b, c, s, h, bl] = P[v] || P.none; Object.assign(editState, { brightness: b, contrast: c, saturate: s, hue: h, blur: bl });
}
function resetEdit() { Object.assign(editState, { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, rotate: 0, flip: false, text: "" }); }
function paintEdit(canvas, img) {
  canvas._img = img;
  const rot = editState.rotate % 180 !== 0;
  const w = img.naturalWidth, h = img.naturalHeight;
  canvas.width = rot ? h : w; canvas.height = rot ? w : h;
  const g = canvas.getContext("2d");
  g.save();
  g.filter = `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturate}%) hue-rotate(${editState.hue}deg) blur(${editState.blur}px)`;
  g.translate(canvas.width / 2, canvas.height / 2);
  g.rotate(editState.rotate * Math.PI / 180);
  g.scale(editState.flip ? -1 : 1, 1);
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
  if (editState.text) {
    const fs = Math.max(18, canvas.width * 0.06);
    g.font = `700 ${fs}px "Space Grotesk", sans-serif`;
    g.textAlign = "center"; g.lineWidth = fs * 0.14; g.strokeStyle = "rgba(0,0,0,0.55)";
    g.fillStyle = "#eafff4";
    g.strokeText(editState.text, canvas.width / 2, canvas.height - fs);
    g.fillText(editState.text, canvas.width / 2, canvas.height - fs);
  }
}

/* ---- helpers ---- */
function readImage(fileObj, cb) { if (!fileObj) return; const r = new FileReader(); r.onload = () => cb(r.result); r.readAsDataURL(fileObj); }
function downloadAsset(a) {
  const link = document.createElement("a");
  link.href = a.url; link.download = `phantomforce-${a.id}.${a.type === "video" ? "webm" : "webp"}`;
  document.body.appendChild(link); link.click(); link.remove();
}

/* =========================================================================
   SETTINGS  (provider configuration)
   ========================================================================= */
export function renderMediaSettings(el, opts = {}) {
  mediaSettingsMount = el;
  mediaSettingsOpts = opts;
  ensureHermesExtensionListener();
  const esc = opts.esc || ((s) => String(s));
  const cfg = loadCfg();
  const socialAccounts = loadSocialAccounts();
  const linkedCount = socialAccounts.filter((account) => socialStatus(account) === "linked").length;
  const routeRow = (modality, label) => {
    const provs = providersFor(cfg, modality === "enhance" ? "enhance" : modality);
    return `<label class="set-route"><span>${label}</span>
      <select data-route="${modality}">${provs.length ? provs.map((p) => `<option value="${p.id}" ${cfg.routing[modality] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("") : `<option>— none enabled —</option>`}</select></label>`;
  };
  el.innerHTML = `
    <div class="settings">
      <div class="set-section">
        <h3>Media generation</h3>
        <p class="set-note">PhantomForce routes generation through your connected providers server-side — the browser never holds a key. Enable a provider, pick default models, and set which one handles each job. Adding a new provider is one config entry + one server route.</p>
        <div class="set-routes">
          ${routeRow("image", "Image engine")}
          ${routeRow("video", "Video engine")}
          ${routeRow("enhance", "Prompt intelligence")}
        </div>
        <label class="set-inline"><input type="checkbox" data-set-approval ${cfg.requireApproval ? "checked" : ""}/> Require approval before paid generation</label>
        <label class="set-field"><span>Generation endpoint (advanced)</span>
          <input data-set-base placeholder="https://ai.phantomforce.online" value="${esc(cfg.endpointBase)}"/>
          <em>Where /generate and /chat are served. Leave blank to auto-detect.</em></label>
      </div>

      <div class="set-section set-social-section">
        <div class="set-sec-head">
          <div>
            <h3>Social accounts</h3>
            <p class="set-note">Connect each platform with one sign-in button. The platform handles login and OAuth; PhantomForce never reads cookies, tokens, saved passwords, private messages, or browser sessions.</p>
          </div>
          <span class="set-safe-pill">${linkedCount}/${socialAccounts.length} linked</span>
        </div>
        ${socialNotice ? `<div class="set-social-notice">${esc(socialNotice)}</div>` : ""}
        <div class="set-social-grid">
          ${socialAccounts.map((account) => socialCard(account, esc)).join("")}
        </div>
      </div>

      <div class="set-section">
        <div class="set-sec-head"><h3>Providers</h3><button class="set-add" data-set-addprov>${svgIc("bolt")} Add provider</button></div>
        <div class="set-providers" data-set-providers>
          ${cfg.providers.map((p) => providerCard(p, esc)).join("")}
        </div>
      </div>
    </div>`;

  // routing
  el.querySelectorAll("[data-route]").forEach((s) => s.onchange = () => { cfg.routing[s.dataset.route] = s.value; saveCfg(cfg); });
  const ap = el.querySelector("[data-set-approval]"); ap.onchange = () => { cfg.requireApproval = ap.checked; saveCfg(cfg); };
  const base = el.querySelector("[data-set-base]"); base.onchange = () => { cfg.endpointBase = base.value.trim(); saveCfg(cfg); };

  // social account linking stays local and never reads browser cookies/tokens
  el.querySelectorAll("[data-social-card]").forEach((card) => {
    const id = card.dataset.socialCard;
    const account = socialAccounts.find((row) => row.id === id);
    if (!account) return;
    const saveAndRender = () => { saveSocialAccounts(socialAccounts); renderMediaSettings(el, opts); };
    const clear = card.querySelector("[data-social-clear]");
    if (clear) clear.onclick = () => {
      account.handle = ""; account.url = ""; account.loginIdentity = ""; account.enabled = false; account.connectMode = "manual"; account.lastConnectAt = "";
      delete account.hermesProof;
      socialNotice = `${account.name} link cleared locally. No remote account was changed.`;
      saveAndRender();
    };
    const open = card.querySelector("[data-social-open]");
    if (open) open.onclick = () => {
      requestHermesExtensionProfileLink(account.id);
      window.open(socialLoginTarget(account), "_blank", "noopener,noreferrer");
      account.connectMode = "browser-bridge";
      account.lastConnectAt = new Date().toISOString();
      socialNotice = `${account.name} sign-in opened. PhantomForce will link it automatically when the browser bridge sees the signed-in public profile.`;
      startSocialBridgePolling(account.id);
      saveAndRender();
    };
  });

  // provider cards
  el.querySelectorAll("[data-prov-card]").forEach((card) => {
    const id = card.dataset.provCard;
    const p = provider(cfg, id);
    const en = card.querySelector("[data-prov-enable]");
    if (en) en.onchange = () => { p.enabled = en.checked; saveCfg(cfg); renderMediaSettings(el, opts); };
    const ep = card.querySelector("[data-prov-endpoint]"); if (ep) ep.onchange = () => { p.endpoint = ep.value.trim(); saveCfg(cfg); };
    const lk = card.querySelector("[data-prov-key]"); if (lk) lk.onchange = () => { p.localKey = lk.value.trim(); saveCfg(cfg); };
    card.querySelectorAll("[data-prov-defmodel]").forEach((sel) => sel.onchange = () => { p.defaultModel[sel.dataset.provDefmodel] = sel.value; saveCfg(cfg); });
    const del = card.querySelector("[data-prov-del]"); if (del) del.onclick = () => { cfg.providers = cfg.providers.filter((x) => x.id !== id); saveCfg(cfg); renderMediaSettings(el, opts); };
  });

  const add = el.querySelector("[data-set-addprov]");
  if (add) add.onclick = () => {
    const name = prompt("Provider name (e.g. Luma, Kling, Ideogram):"); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cfg.providers.find((x) => x.id === id)) { alert("A provider with that id already exists."); return; }
    const modalities = (prompt("Modalities it supports (comma-separated: image, video, edit, enhance):", "image, video") || "image").split(",").map((s) => s.trim()).filter(Boolean);
    const models = {};
    modalities.forEach((m) => { const mm = prompt(`Model names for ${m} (comma-separated):`, ""); if (mm) models[m] = mm.split(",").map((s) => s.trim()).filter(Boolean); });
    cfg.providers.push({ id, name: name.trim(), tagline: "Custom provider", brand: "#41ffa1", keyEnv: `${id.toUpperCase().replace(/-/g, "_")}_API_KEY`, enabled: true, modalities, models, custom: true, endpoint: "", localKey: "", defaultModel: {} });
    saveCfg(cfg); renderMediaSettings(el, opts);
  };
}

function socialCard(account, esc) {
  const status = socialStatus(account);
  const profile = socialProfileTarget(account);
  const lastConnect = status === "linked"
    ? (profile ? `Linked profile: ${profile}` : "Linked locally")
    : status === "pending"
      ? "Waiting for browser bridge confirmation."
      : "Password is never stored here";
  const hermesProof = account.hermesProof
    ? `<div class="set-social-hermes-proof">${svgIc("spark")} Linked profile · ${esc(account.hermesProof.displayName || account.hermesProof.handle || account.name)}</div>`
    : "";
  return `<article class="set-social-card is-${status}" data-social-card="${account.id}">
    <button class="set-card-x" data-social-clear aria-label="Clear ${esc(account.name)} link" title="Clear ${esc(account.name)} link" type="button">×</button>
    <div class="set-social-top">
      <span class="set-social-dot" style="background:${account.color}"></span>
      <span><b>${esc(account.name)}</b><i>${esc(socialStatusLabel(account))}</i></span>
    </div>
    <div class="set-social-connect-state">
      <span>Official sign-in</span>
      <b>${esc(socialPostingState(account))}</b>
    </div>
    ${hermesProof}
    <div class="set-social-actions">
      <button class="set-social-open set-social-action set-social-signin" data-social-open type="button">${esc(socialActionLabel(account))}</button>
      <span>${esc(lastConnect)}</span>
    </div>
  </article>`;
}

function providerCard(p, esc) {
  return `<div class="set-prov ${p.enabled ? "is-on" : ""}" data-prov-card="${p.id}">
    ${p.custom ? `<button class="set-card-x" data-prov-del aria-label="Remove custom provider">×</button>` : ""}
    <div class="set-prov-top">
      <span class="set-prov-dot" style="background:${p.brand}"></span>
      <div class="set-prov-id"><b>${esc(p.name)}${p.custom ? ` <em class="set-tag">custom</em>` : ""}</b><i>${esc(p.tagline || "")}</i></div>
      <label class="set-switch"><input type="checkbox" data-prov-enable ${p.enabled ? "checked" : ""}/><span></span></label>
    </div>
    <div class="set-prov-mods">${p.modalities.map((m) => `<span class="set-mod">${m}</span>`).join("")}</div>
    ${p.enabled ? `
    <div class="set-prov-body">
      <div class="set-prov-key">${svgIc("lock")} Key: <code>${esc(p.keyEnv || "—")}</code> <span class="set-keystate ${p.localKey ? "local" : "server"}">${p.localKey ? "local override set" : "managed server-side"}</span></div>
      ${Object.keys(p.models || {}).filter((m) => (p.models[m] || []).length).map((m) => `
        <label class="set-mini"><span>Default ${m}</span>
          <select data-prov-defmodel="${m}">${p.models[m].map((mo) => `<option ${(p.defaultModel && p.defaultModel[m]) === mo ? "selected" : ""}>${esc(mo)}</option>`).join("")}</select></label>`).join("")}
      <details class="set-adv"><summary>Advanced</summary>
        <label class="set-mini"><span>Endpoint override</span><input data-prov-endpoint placeholder="default: /generate" value="${esc(p.endpoint || "")}"/></label>
        <label class="set-mini"><span>API key (self-host only)</span><input data-prov-key type="password" placeholder="stored locally; prefer server env" value="${esc(p.localKey || "")}"/></label>
        ${p.custom ? `<button class="ml-link set-del" data-prov-del>Remove provider</button>` : ""}
      </details>
    </div>` : ""}
  </div>`;
}

/* ---------------- tiny icon set (self-contained) ---------------- */
function svgIc(k) {
  const P = {
    image: `<rect x="2.5" y="4" width="11" height="8" rx="1.5"/><path d="M7 6.5l3 1.5-3 1.5z"/>`,
    film: `<rect x="2.5" y="4" width="11" height="8" rx="1"/><path d="M2.5 6.5h11M5.5 4v8M10.5 4v8"/>`,
    spark: `<path d="M8 2.6l1.4 3.4 3.6.3-2.7 2.4.8 3.5L8 10.8 4.9 12.6l.8-3.5L3 6.7l3.6-.3z"/>`,
    bolt: `<path d="M8.5 2L4 9h3l-.5 5L11 7H8z"/>`,
    upload: `<path d="M8 10.5V4M5.5 6L8 3.5 10.5 6M3.5 11.5h9"/>`,
    check: `<circle cx="8" cy="8" r="5.2"/><path d="M6 8l1.5 1.5L10.5 6.5"/>`,
    edit: `<path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3z"/>`,
    play: `<path d="M5 3.5l7 4.5-7 4.5z"/>`,
    lock: `<rect x="3.5" y="7" width="9" height="6" rx="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`,
    undo: `<path d="M6 4L3 7l3 3M3 7h6a4 4 0 0 1 0 8H6"/>`,
    redo: `<path d="M10 4l3 3-3 3M13 7H7a4 4 0 0 0 0 8h3"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}
