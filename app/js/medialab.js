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

import { session as accessSession } from "./store.js?v=phantom-live-20260708-80";
import { PLATFORMS, registerContentAsset } from "./contenthub.js?v=phantom-live-20260708-80";

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
      image: ["gpt_image_2", "nano_banana_2"],
      video: ["seedance_2_0", "kling3_0", "marketing_studio_video"],
      edit: ["nano_banana_2", "gpt_image_2"],
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
  "gpt_image_2": "GPT Image 2",
  "nano_banana_2": "Nano Banana 2",
  "marketing_studio_image": "Marketing Studio image",
  "seedance_2_0": "Seedance 2.0",
  "kling3_0": "Kling 3.0",
  "marketing_studio_video": "Marketing Studio video",
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

/* ---------------- engine health (shared by doctor + generate) ----------------
   Lanes, best first:
   - CREATIVE ENGINE (primary): same-origin /api/creative-engine/status — the
     transport-aware backend that brokers UI -> backend -> Hermes -> Higgsfield
     MCP/tools. The higgsfield CLI is only an explicit admin/dev fallback.
   - API lane: the ai-proxy with a provider key (HIGGSFIELD_API_KEY).
   - Legacy BRIDGE lane: direct Hermes draft via /phantom-ai/* (older backends
     without the Creative Engine route). Hermes has NO /phantom-ai/health — the
     real route is GET /phantom-ai/media-lab/higgsfield/status, and the static
     proxy answers 502 {"error":"Admin API unavailable."} when Hermes is down. */
let engineHealth = { at: 0, engine: null, studio: false, proxy: false, media: {}, bridge: false, bridgeAuth: false };
let lastRenderIssue = null;   // most recent failed render — the doctor reports it over a rosy probe
async function checkEngineHealth(cfg, force = false) {
  const now = Date.now();
  if (!force && now - engineHealth.at < 60000) return engineHealth;
  const next = { at: now, engine: null, studio: false, studioCli: null, studioCliDetail: "", proxy: false, media: {}, bridge: false, bridgeAuth: false };
  const probe = async (url, ms, headers) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { signal: ctrl.signal, headers }); }
    finally { clearTimeout(t); }
  };
  const token = accessSession.token();
  const auth = token ? { Authorization: `Bearer ${token}` } : undefined;
  const jobs = [
    (async () => {   // PRIMARY: transport-aware Creative Engine (Hermes/MCP)
      const r = await probe("/api/creative-engine/status", 9000, auth);
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.transport) next.engine = d;
    })(),
    (async () => {   // legacy studio backend on this origin
      const r = await probe("/health", 3000);
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && /admin-static/i.test(String(d.service || ""))) {
        next.studio = true;
        // present:false = CLI confirmed missing; absent field (older server) = unknown
        next.studioCli = d.higgsfield_cli ? d.higgsfield_cli.present !== false : null;
        next.studioCliDetail = d.higgsfield_cli?.detail || "";
      }
    })(),
    (async () => {   // bridge lane: probe the route Hermes ACTUALLY serves
      const r = await probe("/phantom-ai/media-lab/higgsfield/status", 4000, auth);
      const d = await r.json().catch(() => null);
      if (!d) return;                                    // static 404 → no bridge
      if (r.ok && d.ok) { next.bridge = true; next.bridgeAuth = true; return; }
      // 401/403 JSON = Hermes answered, session just isn't authorized;
      // the proxy's 502 "Admin API unavailable." = Hermes is truly down.
      if ((r.status === 401 || r.status === 403) && !/unavailable/i.test(String(d.error || ""))) next.bridge = true;
    })(),
    (async () => {   // API lane: remote ai-proxy
      const r = await probe(`${genBase(cfg)}/health`, 5000);
      const d = await r.json().catch(() => null);
      if (d && d.ok) { next.proxy = true; next.media = d.media || {}; }
    })(),
  ];
  await Promise.allSettled(jobs);
  engineHealth = next;
  return next;
}

/* ---------------- generation client ---------------- */
function cleanBrief(value = "", limit = 2200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function normalizeHiggsfieldModel(req = {}) {
  if (req.provider !== "higgsfield") return req.model || "";
  if (req.modality === "image") {
    return ["gpt_image_2", "nano_banana_2"].includes(req.model) ? req.model : "gpt_image_2";
  }
  return ["seedance_2_0", "kling3_0", "marketing_studio_video"].includes(req.model) ? req.model : "seedance_2_0";
}
function buildGenerationSpec(req = {}) {
  const params = req.params || {};
  const rawPrompt = cleanBrief(req.prompt);
  const negative = cleanBrief(req.negative, 700);
  const model = normalizeHiggsfieldModel(req) || req.model || "";
  /* THE PROMPT IS THE PROMPT. Diffusion models are caption-matchers, not
     instruction-followers: meta-text like "Output: image. Frame: 1:1.
     Honor the request literally" gets DRAWN, not obeyed — it was actively
     destroying prompt fidelity. Aspect, count, duration, negative, and the
     reference image all travel as structured API fields; the only thing we
     may append is a short photography-language style tag. */
  const STYLE_TAGS = {
    "Cinematic": "cinematic lighting, film still",
    "Product": "clean product photography, studio lighting",
    "Portrait": "portrait photography, shallow depth of field",
    "Neon": "neon glow, night, vibrant colors",
    "Editorial": "editorial photography, magazine quality",
    "3D render": "polished 3d render",
    "Analog film": "analog film photo, natural grain",
  };
  const styleTag = req.style && req.style !== "None" && !rawPrompt.toLowerCase().includes(String(req.style).toLowerCase())
    ? (STYLE_TAGS[req.style] || String(req.style).toLowerCase())
    : "";
  const providerPromptParts = styleTag ? `${rawPrompt}, ${styleTag}` : rawPrompt;
  return {
    original_prompt: rawPrompt,
    provider_prompt: cleanBrief(providerPromptParts, 2600),
    negative_prompt: negative,
    modality: req.modality === "video" ? "video" : "image",
    provider: req.provider || "",
    model,
    preset: req.preset || "Custom",
    style: req.style || "None",
    aspect: params.aspect || "1:1",
    count: Math.max(1, Math.min(4, Number(params.count || 1))),
    duration: Math.max(2, Math.min(30, Number(params.duration || 6))),
    quality: params.quality || "standard",
    reference_attached: !!req.ref,
  };
}
function normalizeGeneratedAssets(list = [], req = {}, spec = {}) {
  return (Array.isArray(list) ? list : [])
    .map((asset) => ({
      type: asset?.type || spec.modality || req.modality,
      url: asset?.url || asset?.image_url || asset?.video_url || asset?.src || "",
      meta: {
        ...(asset?.meta || {}),
        prompt: spec.original_prompt || req.prompt,
        provider_prompt: spec.provider_prompt,
        generation_spec: spec,
      },
    }))
    .filter((asset) => asset.url);
}
function higgsfieldDraftMode(req = {}, spec = {}) {
  const model = spec.model || normalizeHiggsfieldModel(req);
  if (model === "marketing_studio_video") return "marketing";
  return spec.modality === "image" ? "image" : "video";
}
function higgsfieldResolution(spec = {}) {
  if (spec.quality === "high") return spec.modality === "image" ? "2k" : "1080p";
  return spec.modality === "image" ? "1k" : "720p";
}
async function draftHiggsfieldRequest(req = {}, spec = {}) {
  const token = accessSession.token();
  if (req.provider !== "higgsfield") return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch("/phantom-ai/media-lab/higgsfield/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        prompt: spec.provider_prompt,
        mode: higgsfieldDraftMode(req, spec),
        model: spec.model,
        duration: String(spec.duration),
        aspect_ratio: spec.aspect,
        resolution: higgsfieldResolution(spec),
        media_role: req.ref ? "start-image" : "image",
        product_url: "",
        generate_audio: "",
      }),
      signal: ctrl.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) return null;
    return payload.draft || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
// Returns { assets:[{type,url,meta}], live:boolean } — never throws; falls back
// to a procedural preview so the studio is always usable.
async function generate(cfg, req) {
  const base = genBase(cfg);
  const p = provider(cfg, req.provider) || {};
  const spec = buildGenerationSpec(req);
  const health = await checkEngineHealth(cfg).catch(() => engineHealth);
  /* BACKEND LANE FIRST: the same-origin transport-aware backend brokers the
     brief PhantomForce -> Hermes -> Higgsfield MCP/tools (primary). The CLI
     exists only behind an explicit admin fallback flag on the backend. */
  const backendLane = req.provider === "higgsfield" && !p.endpoint
    && (!!health.engine || (health.studio && health.studioCli !== false));
  const url = p.endpoint || (backendLane ? "/generate" : `${base}/generate`);
  /* LEGACY DIRECT QUEUE: no transport-aware backend on this origin, no API
     key, but Hermes answers -> draft straight into the owner's account. */
  if (req.provider === "higgsfield" && !backendLane && !health.media.higgsfield && health.bridge) {
    const draft = await draftHiggsfieldRequest({ ...req, prompt: spec.provider_prompt, model: spec.model }, spec);
    if (draft) {
      const assets = [];
      for (let i = 0; i < (req.modality === "video" ? 1 : spec.count); i++) {
        assets.push(previewAsset({ ...req, prompt: spec.provider_prompt, params: { ...req.params } }, i, { spec, queued: true, draft }));
      }
      return { assets, live: false, queued: true, spec, draft };
    }
  }
  const providerReq = {
    ...req,
    model: spec.model,
    prompt: spec.provider_prompt,
    original_prompt: spec.original_prompt,
    negative: spec.negative_prompt,
    generation_spec: spec,
    params: {
      ...(req.params || {}),
      aspect: spec.aspect,
      count: spec.modality === "video" ? 1 : spec.count,
      quality: spec.quality,
      duration: spec.duration,
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), spec.modality === "video" ? 31 * 60_000 : 16 * 60_000);
  let fallbackReason = "provider_unavailable";
  let fallbackDetail = "";
  try {
    const token = accessSession.token();
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(p.localKey ? { "x-provider-key": p.localKey } : {}),
    };
    const r = await fetch(url, {
      method: "POST",
      headers,
      // async on the backend lane: the box answers instantly (Hermes draft or
      // a CLI job id we poll) — a tunnel that cuts long requests can't kill it
      body: JSON.stringify(backendLane
        ? { ...providerReq, async: true, approved: req.approved === true, credit_warning_shown: req.creditWarningShown === true }
        : providerReq),
      signal: ctrl.signal,
    });
    let d = await r.json().catch(() => null);
    if (d && d.error === "approval_required") {
      return { assets: [], live: false, approvalRequired: true, transport: d.transport || "cli_fallback", spec, message: d.message || "" };
    }
    // background job (hermes MCP draft or CLI render): poll until it lands.
    // A draft (hermes_mcp) is a quick tool call, not a render — it gets a
    // short leash so the UI never sits frozen for the render-length timeout.
    if (d && d.job && !d.queued && !(Array.isArray(d.assets) && d.assets.length)) {
      const jobKind = d.transport === "hermes_mcp" ? "draft" : "render";
      d = await pollStudioJob(d.job, spec, headers, jobKind);
    }
    // Hermes/MCP transport: the brief is queued as a draft — no credits spent
    if (d && d.queued && d.transport === "hermes_mcp") {
      const assets = [];
      for (let i = 0; i < (req.modality === "video" ? 1 : spec.count); i++) {
        assets.push(previewAsset({ ...req, prompt: spec.provider_prompt, params: { ...req.params } }, i, { spec, queued: true, draft: d.draft, via: "hermes" }));
      }
      return { assets, live: false, queued: true, transport: "hermes_mcp", spec, draft: d.draft };
    }
    if (d && Array.isArray(d.assets) && d.assets.length) {
      const assets = normalizeGeneratedAssets(d.assets, req, spec);
      if (assets.length) return { assets, live: true, spec, provider: d.provider || req.provider, model: d.model || spec.model };
    }
    fallbackReason = d?.blocked ? "blocked" : (d?.error || `provider_http_${r.status}`);
    fallbackDetail = cleanBrief(d?.message || "", 220);
  } catch (err) {
    fallbackReason = err?.name === "AbortError" ? "provider_timeout" : "provider_unreachable";
  }
  finally { clearTimeout(timer); }
  const draft = await draftHiggsfieldRequest(providerReq, spec);
  const assets = [];
  for (let i = 0; i < (providerReq.params.count || 1); i++) assets.push(previewAsset(providerReq, i, { spec, fallbackReason, draft }));
  return { assets, live: false, spec, fallbackReason, fallbackDetail, fallbackLane: url, draft };
}

/* Poll a studio background job until it lands. Transient network blips while
   polling must NOT kill a render that's still cooking on the box.
   A DRAFT (hermes_mcp tool call) is a quick request, not a render — it gets
   a short leash (3 min) instead of the render-length timeout, so a slow/dead
   MCP lane surfaces as an honest timeout instead of a silent, endless spinner.
   Callers show their own elapsed-time feedback while this awaits. */
async function pollStudioJob(jobId, spec, headers, kind = "render") {
  const startedAt = Date.now();
  const deadline = kind === "draft" ? startedAt + 3 * 60_000 : startedAt + (spec.modality === "video" ? 31 : 16) * 60_000;
  let misses = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const r = await fetch(`/generate/job/${encodeURIComponent(jobId)}`, { headers });
      const d = await r.json().catch(() => null);
      if (r.status === 404) return { error: "job_lost", message: d?.message || "the studio server restarted mid-render" };
      if (!d) continue;
      misses = 0;
      if (d.status === "done" || d.status === "failed" || d.status === "blocked") return d;
    } catch {
      if (++misses >= 24) return { error: "provider_unreachable", message: "lost contact with the studio box for 2 minutes" };
    }
  }
  if (kind === "draft") return { error: "provider_timeout", message: "the draft tool call took longer than 3 minutes — the operator lane may be stuck" };
  return { error: "provider_timeout", message: "" };
}

/* Turn a raw studio/CLI failure into the exact next move for the owner. */
function explainMediaFailure(reason = "", detail = "", lane = "") {
  const text = `${reason} ${detail}`.toLowerCase();
  const studioLane = lane.startsWith("/");
  if (reason === "blocked")
    return detail || "the Creative Engine reported a blocked state — open the banner above for the exact reason";
  if (/enoent|not recognized|command not found|no such file/.test(text))
    return "the higgsfield CLI isn't installed on the admin box — install it and sign in (higgsfield login), then Re-check";
  if (/login|logged|sign[ -]?in|auth|unauthoriz|credential|expired|forbidden/.test(text))
    return "the higgsfield CLI is signed out — run `higgsfield login` on the admin box, then Re-check";
  if (/quota|credit|insufficient|billing|payment|limit reached/.test(text))
    return "Higgsfield says the plan is out of renders — check your Higgsfield account";
  if (/job_lost/.test(text))
    return "the studio server restarted mid-render — run it again";
  if (/unreachable/.test(text))
    return studioLane
      ? "the connection to the admin box dropped mid-render (tunnels cut long requests) — pull the latest build on the box and restart the static server once; renders then run as background jobs that survive any tunnel"
      : `nothing answered at ${lane || "the render endpoint"} — start the studio box or bash ai-proxy/run.sh for the API lane`;
  if (/timeout/.test(text))
    return "Higgsfield took too long — run it again or drop the quality a notch";
  if (/admin_session_required/.test(text))
    return "this session isn't signed in as admin — sign in and try again";
  if (/no_assets/.test(text))
    return "Higgsfield finished but handed back no files — run it again or simplify the prompt";
  return detail ? `the studio said: ${detail}` : "";
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
  return `${prompt.trim()}, ${add}`;
}

/* ---------------- procedural preview (looks real, works offline) ---------------- */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); }
function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = cleanBrief(text, 360).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((row, idx) => ctx.fillText(row, x, y + idx * lineHeight));
  return y + lines.length * lineHeight;
}
/* ---- prompt-aware sketching: the offline preview must LOOK like the ask.
   The prompt picks a palette and a scene archetype; the fallback becomes a
   directional storyboard frame instead of generic brand-colored noise. ---- */
const SCENE_PALETTES = [
  [/sunset|golden hour|dusk|dawn|sunrise|warm light|amber/i, ["#160802", "#5c1f06", "#c95d1a", "#ffb45e", "#ffe3b3"]],
  [/ocean|sea|beach|underwater|lake|river|wave|water/i, ["#02121f", "#053655", "#0f6f8f", "#2fb3c9", "#a8ecf5"]],
  [/forest|jungle|garden|moss|greenery/i, ["#04140a", "#0d3a1c", "#1f6b33", "#4faf5d", "#c0f0b0"]],
  [/night|midnight|neon|cyber|synth|club|glow/i, ["#070313", "#1d0f3d", "#452a8a", "#8f5cff", "#4ef0ff"]],
  [/fire|flame|lava|explosion|crimson/i, ["#160303", "#4d0e05", "#a3300e", "#ff7a2f", "#ffd0a0"]],
  [/snow|winter|ice|arctic|frozen/i, ["#04101c", "#12374e", "#3d7ba0", "#9cc9e8", "#eef8ff"]],
  [/luxury|gold|premium|elegant|champagne/i, ["#0a0804", "#2a2008", "#6b5316", "#c9a227", "#f4e3a1"]],
  [/city|urban|downtown|skyline|street|chicago|new york|architecture/i, ["#050a12", "#101d31", "#23405e", "#3f6f96", "#9fd0ef"]],
];
function scenePalette(prompt) {
  for (const [re, pal] of SCENE_PALETTES) if (re.test(prompt)) return pal;
  return ["#03130d", "#07301f", "#12613c", "#2fbf7a", "#b6ffd9"];   // brand emerald default
}
function sceneKind(prompt) {
  const s = String(prompt).toLowerCase();
  if (/skyline|cityscape|city|urban|downtown|street|building|chicago|new york|architecture/.test(s)) return "city";
  if (/portrait|person|man\b|woman|face|model|athlete|barber|chef|owner|team|people|client/.test(s)) return "portrait";
  if (/product|bottle|watch|shoe|sneaker|phone|device|\bcan\b|package|cosmetic|jar|box|merch|offer/.test(s)) return "product";
  if (/sunset|sunrise|mountain|beach|desert|ocean|lake|field|horizon|landscape|sky|forest|nature|road/.test(s)) return "landscape";
  if (/food|burger|pizza|coffee|plate|dish|restaurant|drink|cocktail|menu/.test(s)) return "food";
  return "abstract";
}
function drawScene(g, kind, pal, W, H, rng) {
  const glow = (x, y, r, color, a) => {
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, color + Math.round(a * 255).toString(16).padStart(2, "0"));
    rad.addColorStop(1, color + "00");
    g.fillStyle = rad; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  };
  if (kind === "landscape") {
    const horizon = H * (0.58 + rng() * 0.08);
    const sunX = W * (0.3 + rng() * 0.4);
    glow(sunX, horizon - H * 0.08, W * 0.34, pal[3], 0.55);
    g.fillStyle = pal[4]; g.beginPath(); g.arc(sunX, horizon - H * 0.08, W * 0.05, 0, TAU); g.fill();
    for (let band = 0; band < 3; band++) {          // layered terrain
      g.fillStyle = pal[Math.max(0, 1 - band)] + (band ? "e6" : "");
      g.beginPath(); g.moveTo(0, H);
      const by = horizon + band * H * 0.13;
      g.lineTo(0, by);
      for (let x = 0; x <= W; x += W / 7) g.lineTo(x, by - rng() * H * (0.06 - band * 0.015));
      g.lineTo(W, H); g.closePath(); g.fill();
    }
  } else if (kind === "city") {
    const horizon = H * 0.72;
    glow(W * 0.5, horizon - H * 0.2, W * 0.5, pal[3], 0.3);
    for (const [alpha, hMul, wMin] of [[0.75, 0.42, 26], [1, 0.3, 34]]) {   // two skyline depths
      g.globalAlpha = alpha;
      let x = -10;
      while (x < W) {
        const bw = wMin + rng() * 40, bh = H * (0.1 + rng() * hMul);
        g.fillStyle = pal[1];
        g.fillRect(x, horizon - bh, bw, bh);
        g.fillStyle = pal[4] + "55";                 // lit windows
        for (let wy = horizon - bh + 8; wy < horizon - 8; wy += 12) {
          for (let wx = x + 5; wx < x + bw - 6; wx += 11) if (rng() > 0.55) g.fillRect(wx, wy, 3.4, 4.6);
        }
        x += bw + 6 + rng() * 12;
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = pal[0]; g.fillRect(0, horizon, W, H - horizon);
  } else if (kind === "portrait") {
    const cx = W / 2, cy = H * 0.46, r = Math.min(W, H) * 0.17;
    glow(cx - r * 1.6, cy - r, r * 3.4, pal[3], 0.4);        // key light
    g.fillStyle = pal[1];
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();       // head
    g.beginPath(); g.ellipse(cx, cy + r * 2.15, r * 1.9, r * 1.45, 0, Math.PI, 0); g.fill(); // shoulders
    g.strokeStyle = pal[4]; g.lineWidth = 3; g.lineCap = "round";
    g.beginPath(); g.arc(cx, cy, r + 2, -Math.PI * 0.85, -Math.PI * 0.15); g.stroke();       // rim light
  } else if (kind === "product") {
    const cx = W / 2, py = H * 0.72;
    glow(cx, H * 0.4, W * 0.3, pal[3], 0.5);                 // spotlight
    g.fillStyle = pal[1];
    g.beginPath(); g.ellipse(cx, py, W * 0.22, H * 0.045, 0, 0, TAU); g.fill();               // pedestal
    const pw = W * 0.16, ph = H * 0.34;
    const body = g.createLinearGradient(cx - pw / 2, 0, cx + pw / 2, 0);
    body.addColorStop(0, pal[2]); body.addColorStop(0.5, pal[4]); body.addColorStop(1, pal[1]);
    g.fillStyle = body;
    roundRect(g, cx - pw / 2, py - ph, pw, ph, 10); g.fill();                                 // the hero object
    g.globalAlpha = 0.25; g.scale(1, -0.4);
    roundRect(g, cx - pw / 2, -(py / 0.4) - ph, pw, ph, 10); g.fill();                        // reflection
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  } else if (kind === "food") {
    const cx = W / 2, cy = H * 0.58;
    glow(cx, cy - H * 0.2, W * 0.3, pal[3], 0.4);
    g.fillStyle = pal[4]; g.beginPath(); g.ellipse(cx, cy, W * 0.26, W * 0.16, 0, 0, TAU); g.fill();  // plate
    g.fillStyle = pal[2]; g.beginPath(); g.ellipse(cx, cy - 6, W * 0.16, W * 0.1, 0, 0, TAU); g.fill(); // dish
    g.fillStyle = pal[1];
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(cx + (rng() - 0.5) * W * 0.2, cy - 8 + (rng() - 0.5) * W * 0.09, 6 + rng() * 8, 0, TAU); g.fill(); }
  } else {
    for (let b = 0; b < 5; b++) {                            // abstract: palette-true blobs
      glow(rng() * W, rng() * H, (0.2 + rng() * 0.4) * W, pal[2 + Math.floor(rng() * 3)], 0.2 + rng() * 0.16);
    }
  }
}
function previewAsset(req, i, context = {}) {
  const spec = context.spec || buildGenerationSpec(req);
  const [, ar] = (req.modality === "video" ? VID_ASPECTS : IMG_ASPECTS).find(([k]) => k === req.params.aspect) || ["1:1", 1];
  const W = 640, H = Math.round(W / ar);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const promptText = spec.original_prompt || req.prompt || "phantom";
  const seed = hashStr(promptText + "|" + req.style + "|" + i);
  const rng = mulberry(seed);
  const pal = scenePalette(promptText);
  const kind = sceneKind(promptText);
  // sky/base from the prompt's palette
  const g1 = g.createLinearGradient(0, 0, 0, H);
  g1.addColorStop(0, pal[0]); g1.addColorStop(0.55, pal[1]); g1.addColorStop(1, pal[0]);
  g.fillStyle = g1; g.fillRect(0, 0, W, H);
  drawScene(g, kind, pal, W, H, rng);
  // light flow-field haze for texture, tinted to the scene
  g.globalCompositeOperation = "screen";
  g.strokeStyle = pal[3];
  for (let s = 0; s < 120; s++) {
    let x = rng() * W, y = rng() * H;
    g.globalAlpha = 0.03 + rng() * 0.04;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      const a = (Math.sin(x * 0.01 + seed) + Math.cos(y * 0.012 - seed)) * Math.PI;
      x += Math.cos(a) * 7; y += Math.sin(a) * 7;
      g.lineTo(x, y);
    }
    g.lineWidth = 0.8 + rng() * 1.2; g.stroke();
  }
  g.globalAlpha = 1;
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
  // spec plate: the fallback should prove what was requested instead of posing
  // as a finished provider render.
  const plateW = Math.min(W - 32, Math.max(300, W * 0.74));
  const plateH = Math.min(H - 36, Math.max(118, H * 0.28));
  const px = 16;
  const py = Math.max(16, H - plateH - 18);
  g.fillStyle = "rgba(3, 12, 10, 0.72)";
  roundRect(g, px, py, plateW, plateH, 18);
  g.fill();
  g.strokeStyle = "rgba(120,255,190,0.36)";
  g.lineWidth = 1;
  roundRect(g, px, py, plateW, plateH, 18);
  g.stroke();
  g.fillStyle = "rgba(120,255,190,0.88)";
  g.font = "800 10px 'DM Mono', monospace";
  const plateTag = context.queued
    ? (context.via === "hermes" ? "QUEUED VIA HERMES · APPROVE IN HIGGSFIELD" : "RENDERING IN YOUR HIGGSFIELD STUDIO")
    : context.fallbackReason
      ? "OFFLINE SKETCH · " + String(context.fallbackReason).replace(/^provider_/i, "").replace(/_/g, " ").toUpperCase().slice(0, 26)
      : "PREVIEW";
  g.fillText(`${plateTag} · ${String(spec.aspect || "").toUpperCase()}`, px + 16, py + 25);
  g.fillStyle = "rgba(236,255,246,0.95)";
  g.font = "700 18px 'Space Grotesk', sans-serif";
  drawWrappedText(g, spec.original_prompt || req.prompt || "Untitled media generation", px + 16, py + 52, plateW - 32, 22, 3);
  g.fillStyle = "rgba(180,210,205,0.86)";
  g.font = "600 11px 'DM Mono', monospace";
  const tail = [
    spec.modality,
    spec.model ? laneLabel(spec.model) : "",
    spec.style && spec.style !== "None" ? spec.style : "",
    spec.duration && spec.modality === "video" ? `${spec.duration}s` : "",
  ].filter(Boolean).join(" · ");
  g.fillText(tail.slice(0, 78), px + 16, py + plateH - 18);
  return {
    type: req.modality,
    url: c.toDataURL("image/webp", 0.85),
    meta: {
      preview: true,
      prompt: spec.original_prompt || req.prompt,
      provider_prompt: spec.provider_prompt,
      generation_spec: spec,
      fallback_reason: context.fallbackReason || "",
      draft: context.draft || null,
      style: req.style,
      preset: req.preset || "Custom",
    },
  };
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
  if (session.tab === "briefs") session.tab = "pending";
  const tabs = [["generate", "Generate"], ["pending", "Pending"], ["library", `Generated${session.assets.length ? ` · ${session.assets.length}` : ""}`], ["edit", "Edit"]];
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
  else if (session.tab === "pending") (opts.renderPending ? opts.renderPending(body) : renderPending(body));
  else if (session.tab === "edit") renderEdit(body, cfg, opts, el);
  else if (session.tab === "library") renderLibrary(body, opts, el);
}

function renderPending(body) {
  body.innerHTML = `
    <div class="ml-idle">
      <b>No pending media.</b>
      <i>Generate an image or video when you are ready. Outputs land under Generated.</i>
    </div>`;
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
    <div class="ml-doctor" data-ml-doctor>
      <i class="ml-doctor-dot"></i>
      <b data-ml-doctor-title>Checking the media engine…</b>
      <span data-ml-doctor-msg></span>
      <button class="ml-doctor-retry" data-ml-doctor-retry type="button">Re-check</button>
    </div>
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

        <label class="ml-field ml-field-brief"><span>Prompt</span>
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
          ${genState.busy ? `${svgIc("spark")} <span data-ml-busy-label>Working…</span>` : `${svgIc("bolt")} Generate ${genState.modality} · ~${estCredits()} credits`}
        </button>
      </aside>

      <section class="ml-stage" data-ml-results aria-label="Preview Stage">
        <div class="ml-stage-frame ${genState.busy ? "is-busy" : ""}">
          <header class="ml-stage-top">
            <span class="ml-rec ${genState.busy ? "is-live" : ""}"><i aria-hidden="true"></i><span data-ml-busy-stage>${genState.busy ? "Rendering" : "Stage ready"}</span></span>
            <b>Preview Stage</b>
            <span class="ml-stage-chip">${genState.aspect}${genState.modality === "video" ? ` · ${genState.duration}s` : ""}</span>
          </header>
          <div class="ml-stage-view">
            ${genState.busy ? skeletons(genState.modality === "video" ? 1 : genState.count) : resultsHtml(esc)}
          </div>
          <footer class="ml-stage-meta">${settingsChips(esc)}</footer>
        </div>
      </section>

      ${railHtml(cfg, esc)}
    </div>`;

  wireGenerate(body, cfg, opts, root, esc);
}

function settingsChips(esc) {
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
  return `<div class="ml-brief-chips" aria-label="Current generation settings">${chips.map((c) => `<span>${esc(String(c))}</span>`).join("")}</div>`;
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
const IDLE_HINTS = [
  "Game trailer teaser: neon dusk city",
  "Landing page hero for an indie game launch",
  "Social kit: three posts for a product drop",
  "Emerald smoke logo reveal",
];
function resultsHtml(esc) {
  const recent = session.assets.filter((a) => a.fromGen);
  if (!recent.length) return `
    <div class="ml-idle">
      <div class="ml-idle-orb" aria-hidden="true"><span></span><span></span><span></span></div>
      <b>Create with context</b>
      <i>Phantom preps the brief, routes it to your creative engine, reviews the output, and turns it into campaigns, sites, and follow-ups. Finished media lands here — and in Content Hub.</i>
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

  /* Engine Doctor: silent fallbacks looked like a dumb brain. Say EXACTLY
     what state the pipeline is in and what fixes it. */
  const doctor = body.querySelector("[data-ml-doctor]");
  const runDoctor = async (force = false) => {
    if (!doctor) return;
    const title = doctor.querySelector("[data-ml-doctor-title]");
    const msg = doctor.querySelector("[data-ml-doctor-msg]");
    doctor.dataset.state = "checking";
    title.textContent = "Checking the media engine…"; msg.textContent = "";
    const base = genBase(cfg).replace(/^https?:\/\//, "");
    const h = await checkEngineHealth(cfg, force).catch(() => engineHealth);
    if (!doctor.isConnected) return;
    const prov = genState.provider || "higgsfield";
    if (force) lastRenderIssue = null;
    if (lastRenderIssue) {
      // a green "connected" banner must never contradict a failing render —
      // the most recent failure is THE state until it's cleared or fixed
      doctor.dataset.state = "warn";
      title.textContent = "The last render didn't finish";
      msg.textContent = explainMediaFailure(lastRenderIssue.reason, lastRenderIssue.detail, lastRenderIssue.lane)
        || `${String(lastRenderIssue.reason || "unknown error")} — fix it on the admin box, then hit Re-check.`;
      return;
    }
    if (h.engine && prov === "higgsfield") {
      // transport-aware Creative Engine: Hermes/MCP is the primary route.
      // Customer-facing copy stays provider-simple; admin detail rides along
      // only when the CLI fallback is explicitly enabled.
      const e = h.engine;
      const adminTail = e.cliFallbackEnabled
        ? " · Admin: transport Hermes/MCP, CLI fallback ENABLED."
        : "";
      if (e.status === "connected") {
        doctor.dataset.state = "ok";
        title.textContent = "Creative Engine connected through Hermes";
        msg.textContent = `Briefs route PhantomForce → Hermes → Higgsfield tools. Render approval required — nothing spends credits without you.${adminTail}`;
      } else if (e.status === "not_configured") {
        doctor.dataset.state = "warn";
        title.textContent = "Creative Engine needs Hermes connection";
        msg.textContent = `${e.message || "Hermes isn't answering on this box."}${adminTail}`;
      } else {
        doctor.dataset.state = "warn";
        title.textContent = "Creative Engine blocked";
        msg.textContent = `${e.message || "Hermes answered but the creative tools aren't available."}${adminTail}`;
      }
    } else if (h.studio && prov === "higgsfield") {
      doctor.dataset.state = "ok";
      title.textContent = "Studio render backend connected";
      msg.textContent = "This box accepts render briefs on its own backend. Render approval required — nothing spends credits without you.";
    } else if (h.media[prov]) {
      doctor.dataset.state = "ok";
      title.textContent = "Media engine connected (API)";
      msg.textContent = `${base} · ${prov} key loaded — real renders will run.`;
    } else if (h.bridge && !h.bridgeAuth) {
      doctor.dataset.state = "warn";
      title.textContent = "Bridge is up, but this session can't use it";
      msg.textContent = "Hermes answered but rejected this session — sign in with your admin account, then hit Re-check.";
    } else if (h.bridge) {
      doctor.dataset.state = "ok";
      title.textContent = "Higgsfield subscription bridge ready";
      msg.textContent = "No API key needed — prompts queue straight into your Higgsfield account through the desktop bridge, and finished renders land in Content Hub.";
    } else if (h.proxy) {
      doctor.dataset.state = "warn";
      title.textContent = "No render lane yet";
      msg.textContent = `The proxy at ${base} answered, but there's no HIGGSFIELD_API_KEY in ai-proxy/.env and the desktop bridge isn't running. Start the desktop bridge (subscription) or add a key — until then you get offline sketches.`;
    } else {
      doctor.dataset.state = "down";
      title.textContent = "Media engine unreachable";
      msg.textContent = `Nothing is answering: no Hermes at /phantom-ai on this origin, and no proxy at ${base}. On the admin box, start Hermes (the desktop bridge) — or bash ai-proxy/run.sh for the API lane. Prompts render as offline sketches until then.`;
    }
  };
  doctor?.querySelector("[data-ml-doctor-retry]")?.addEventListener("click", () => runDoctor(true));
  runDoctor();

  body.querySelectorAll("[data-tile-act]").forEach((b) => b.onclick = () => tileAction(b.dataset.tileAct, b.dataset.id, cfg, opts, root, esc, body));
}

async function runGenerate(body, cfg, opts, root, esc) {
  if (!genState.prompt.trim()) { const t = body.querySelector("[data-ml-prompt]"); if (t) { t.focus(); t.classList.add("shake"); setTimeout(() => t.classList.remove("shake"), 500); } return; }
  /* APPROVAL-FIRST: any lane that can spend credits (provider API key, or the
     admin CLI fallback) asks the owner before rendering. The Hermes draft
     lane never spends — its paid approval happens inside Higgsfield itself. */
  const health = await checkEngineHealth(cfg).catch(() => engineHealth);
  const spendLane = !!(health.media?.[genState.provider] || health.engine?.cliFallbackEnabled);
  let approved = false;
  if (spendLane) {
    approved = window.confirm("This will use your connected creative engine credits. Approve render?");
    if (!approved) {
      if (opts.notify) opts.notify("Media Factory", "Render cancelled — nothing was charged.");
      return;
    }
  }
  genState.busy = true;
  renderGenerate(body, cfg, opts, root);
  /* A draft/render can legitimately take a while — a frozen "Rendering…"
     button with no feedback reads as broken. Tick a live elapsed readout and
     step through reassuring copy the longer it runs, updated in place so we
     never disturb the mounted busy view with a full re-render. */
  const busyStartedAt = Date.now();
  const busyTick = () => {
    const s = Math.round((Date.now() - busyStartedAt) / 1000);
    const stageText = s < 15 ? "Rendering" : s < 45 ? "Still working" : s < 120 ? "Taking longer than usual — hang tight" : "Well past normal — checking Hermes/Higgsfield";
    const label = s < 60 ? `Working… ${s}s` : `Working… ${Math.floor(s / 60)}m ${s % 60}s`;
    const stageEl = body.querySelector("[data-ml-busy-stage]");
    const labelEl = body.querySelector("[data-ml-busy-label]");
    if (stageEl) stageEl.textContent = stageText;
    if (labelEl) labelEl.textContent = label;
  };
  const busyTimer = setInterval(busyTick, 1000);
  try {
    const req = {
      modality: genState.modality, provider: genState.provider, model: genState.model,
      prompt: genState.prompt, negative: genState.negative, style: genState.style,
      preset: activePreset()?.label || "Custom",
      approved, creditWarningShown: spendLane,
      ref: genState.ref, params: { aspect: genState.aspect, count: genState.modality === "video" ? 1 : genState.count, quality: genState.quality, duration: genState.duration },
    };
    const out = await generate(cfg, req);
    if (out.approvalRequired) {
      // the backend refused to render without an explicit approval — honor it
      if (opts.notify) opts.notify("Media Factory", out.message || "This render needs your approval before it can use credits.");
      genState.busy = false;
      renderGenerate(body, cfg, opts, root);
      return;
    }
    const stamp = Date.now();
    const created = out.assets.map((a, i) => ({ id: `gen-${stamp}-${i}`, ...a, fromGen: true, at: stamp }));
    created.forEach((asset) => {
      session.assets.unshift(asset);
      captureForContentHub(asset, {
        title: `${genState.modality === "video" ? "Generated video" : "Generated image"} · ${genState.style}`,
        prompt: out.spec?.original_prompt || genState.prompt,
        provider: genState.provider,
        model: out.spec?.model || genState.model,
        style: genState.style,
        aspect: genState.aspect,
        duration: genState.duration,
        preset: activePreset()?.label || "Custom",
        live: out.live,
      });
    });
    session.assets = session.assets.slice(0, 60);
    lastRenderIssue = out.live || out.queued
      ? null
      : { reason: out.fallbackReason || "unreachable", detail: out.fallbackDetail || "", lane: out.fallbackLane || "", at: Date.now() };
    refreshGeneratePanel(body, cfg, opts, root);
    if (opts.notify) {
      const why = out.live || out.queued ? "" : explainMediaFailure(out.fallbackReason, out.fallbackDetail, out.fallbackLane);
      const status = out.live
        ? "generated"
        : out.queued
          ? out.transport === "hermes_mcp"
            ? "queued through Hermes into your Higgsfield studio — approve the render there (no credits spent yet) for"
            : "queued in your Higgsfield Studio — the desktop bridge renders it with your subscription; finished cuts land in Content Hub for"
          : `render failed (${out.fallbackReason || "unreachable"})${why ? ` — ${why};` : " —"} sketched the request locally for`;
      opts.notify("Media Factory", `${status} ${out.assets.length} ${genState.modality}${out.assets.length > 1 ? "s" : ""} - "${genState.prompt.slice(0, 40)}".`);
    }
    // spend credits only after a live provider asset returns; previews are free.
    if (out.live) {
      cfg.credits = Math.max(0, cfg.credits - estCredits());
      saveCfg(cfg);
    }
  } finally {
    clearInterval(busyTimer);
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
