/* PhantomForce — Media Lab: native image/video creation and editing.
 *
 * The browser only talks to PhantomForce lanes. Vendor routing stays behind
 * the server boundary, so the admin UI never turns into a provider console.
 * When generation is not connected, the UI renders a clear preview state
 * instead of sending people out to another product.
 */

import { currentTenantId, session as accessSession, workspaceStorageGetItem, workspaceStorageRemoveItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260712-217";
import {
  PLATFORMS, registerContentAsset, loadSocialAccounts, saveSocialAccounts, socialStatus,
} from "./contenthub.js?v=phantom-live-20260712-217";
import { freshEditState, applyFilterPreset, paintEdit, heuristicAiEdit, addBokehSpot, removeBokehSpotNear, estimateSubjectPoint } from "./imagefilters.js?v=phantom-live-20260712-217";
import { cloneImageEditState, pushEditorSnapshot } from "./content-editor.js?v=phantom-live-20260712-217";
import { loadImageForEditing, exportCanvas, requestRemoveBackground } from "./mediabackend.js?v=phantom-live-20260712-217";
import { assetsAvailable, saveToAssetCloud } from "./orgs.js?v=phantom-live-20260712-217";

const CFG_KEY = "pf.medialab.v1";
const EDIT_INTENT_KEY = "pf.medialab.editIntent.v1";
const PROMPT_INTENT_KEY = "pf.medialab.promptIntent.v1";
const CONTENT_HUB_OPEN_TAB_KEY = "pf.contenthub.openTab.v1";
const CONTENT_HUB_OPEN_ASSET_KEY = "pf.contenthub.openAsset.v1";
const TAU = Math.PI * 2;

const PRIMARY_MEDIA_LANE = "cinematic";
const normalizeLaneId = (id = "") => String(id || "").toLowerCase();

/* ---------------- media lane registry ---------------- */
export const DEFAULT_PROVIDERS = [
  {
    id: PRIMARY_MEDIA_LANE, name: "Cinematic Engine", tagline: "Image and video production",
    brand: "#8b7bff", keyEnv: "PHANTOM_MEDIA_KEY", enabled: true,
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
    id: "openai", name: "Image Engine", tagline: "Stills, video, and inline edits",
    brand: "#10a37f", keyEnv: "OPENAI_API_KEY", enabled: false,
    modalities: ["image", "video", "edit"],
    models: { image: ["gpt-image-1"], video: ["sora-2"], edit: ["gpt-image-1"] },
  },
  {
    id: "runway", name: "Motion Engine", tagline: "Premium generated video",
    brand: "#ff5c00", keyEnv: "RUNWAY_API_KEY", enabled: false,
    modalities: ["video", "image"],
    models: { video: ["gen-4", "gen-3-alpha-turbo"], image: ["frames"] },
  },
  {
    id: "flux", name: "Still Engine", tagline: "Photoreal stills",
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
   so requests keep sending model ids the backend understands. */
const LANE_LABELS = {
  "gpt_image_2": "GPT Image 2",
  "nano_banana_2": "Nano Banana 2",
  "marketing_studio_image": "Campaign image",
  "seedance_2_0": "Seedance 2.0",
  "kling3_0": "Kling 3.0",
  "marketing_studio_video": "Campaign video",
  "gpt-image-1": "Generated stills",
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
function socialStatusLabel(account) {
  const st = socialStatus(account);
  if (st === "linked") return "profile saved";
  if (st === "pending") return "finish setup";
  return "not saved";
}
function socialPostingState(account) {
  const st = socialStatus(account);
  if (st === "linked") return account.analytics ? "metrics loaded" : "profile only";
  if (st === "pending") return "waiting";
  return "not configured";
}
function socialActionLabel(account) {
  const st = socialStatus(account);
  if (st === "linked") return `Update ${account.name} profile`;
  if (st === "pending") return `Finish ${account.name}`;
  return `Add ${account.name} profile`;
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
    return JSON.parse(workspaceStorageGetItem(HERMES_EXTENSION_KEY) || "{}") || {};
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
  try { workspaceStorageSetItem(HERMES_EXTENSION_KEY, JSON.stringify(next)); } catch {}
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
    socialNotice = `${socialAccountName(pendingPlatform)} is still waiting. Ignored a saved ${socialAccountName(packet.platform)} profile so the wrong profile was not changed.`;
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
  socialNotice = `${account.name} profile saved from the visible browser page. This stores public identity fields only and does not authorize analytics APIs.`;
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
  try { saved = JSON.parse(workspaceStorageGetItem(CFG_KEY) || "{}"); } catch {}
  const providers = DEFAULT_PROVIDERS.map((p) => {
    const savedProviders = saved.providers || {};
    const s = savedProviders[p.id] || {};
    return {
      ...p,
      enabled: s.enabled != null ? s.enabled : p.enabled,
      endpoint: s.endpoint || "",
      localKey: s.localKey || "",
      defaultModel: s.defaultModel || {},
    };
  });
  // Keep older saved accounts working, but do not surface legacy provider ids.
  for (const c of saved.customProviders || []) {
    const id = normalizeLaneId(c.id);
    if (id === PRIMARY_MEDIA_LANE && providers.some((p) => p.id === PRIMARY_MEDIA_LANE)) continue;
    providers.push({ ...c, id, custom: true });
  }
  const savedRouting = saved.routing || {};
  return {
    providers,
    endpointBase: saved.endpointBase || "",
    routing: {
      image: normalizeLaneId(savedRouting.image || PRIMARY_MEDIA_LANE),
      video: normalizeLaneId(savedRouting.video || PRIMARY_MEDIA_LANE),
      enhance: normalizeLaneId(savedRouting.enhance || "claude"),
    },
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
  try { workspaceStorageSetItem(CFG_KEY, JSON.stringify(out)); } catch {}
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
   - Media service: same-origin /api/creative-engine/status for connected boxes.
   - API lane: the ai-proxy with a server-side media key.
   - Legacy bridge lane: same-origin Media Lab draft/status route for older boxes. */
let engineHealth = { at: 0, engine: null, studio: false, proxy: false, media: {}, bridge: false, bridgeAuth: false, hasToken: false };
let lastRenderIssue = null;   // most recent failed render — the doctor reports it over a rosy probe
async function checkEngineHealth(cfg, force = false) {
  const now = Date.now();
  if (!force && now - engineHealth.at < 60000) return engineHealth;
  const next = { at: now, engine: null, studio: false, studioCli: null, studioCliDetail: "", proxy: false, media: {}, bridge: false, bridgeAuth: false, hasToken: !!accessSession.token() };
  const probe = async (url, ms, headers) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { signal: ctrl.signal, headers }); }
    finally { clearTimeout(t); }
  };
  const token = accessSession.token();
  const auth = token ? { Authorization: `Bearer ${token}` } : undefined;
  const jobs = [
    (async () => {
      const r = await probe("/api/creative-engine/status", 9000, auth);
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.transport) next.engine = d;
    })(),
    (async () => {
      const r = await probe("/health", 3000);
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.ok && /admin-static/i.test(String(d.service || ""))) {
        next.studio = true;
        next.studioCli = null;
        next.studioCliDetail = "";
      }
    })(),
    (async () => {
      const r = await probe("/phantom-ai/media-lab/creative/status", 4000, auth);
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
function renderLaneReady(health, providerId = PRIMARY_MEDIA_LANE) {
  const h = health || {};
  const engine = h.engine || null;
  const tools = Array.isArray(engine?.tools) ? engine.tools : [];
  const ownerRenderTool = tools.some((tool) => tool?.available !== false && /render/i.test(String(tool?.name || "")));
  const ownerCliReady = engine?.cliFallbackEnabled === true && engine?.higgsfield?.cli?.present !== false;
  if (providerId === PRIMARY_MEDIA_LANE && engine?.status === "connected" && (ownerRenderTool || ownerCliReady || engine?.higgsfield?.availableThroughHermes)) return true;
  if (h.media?.[providerId]) return true;
  if (providerId === PRIMARY_MEDIA_LANE && h.bridge && h.bridgeAuth) return true;
  return false;
}
function engineAttention(health, providerId = PRIMARY_MEDIA_LANE) {
  const h = health || {};
  if (renderLaneReady(h, providerId)) return "";
  if (h.engine?.status === "error" || h.engine?.status === "not_configured") return h.engine?.message || "Media engine needs attention.";
  if (h.bridge && !h.bridgeAuth) return "Your admin session needs a refresh.";
  if (h.proxy) return "Media generation is not connected yet.";
  return "Media engine is offline.";
}
function updateEngineMini(root, state, label, title = "") {
  const mini = root?.querySelector?.("[data-ml-engine-mini]");
  if (!mini) return;
  mini.classList.toggle("is-ready", state === "ok");
  mini.classList.toggle("is-warn", state === "warn");
  mini.classList.toggle("is-down", state === "down");
  mini.classList.toggle("is-checking", state === "checking");
  mini.title = title || label || "";
  const text = mini.querySelector("[data-ml-engine-mini-label]");
  if (text) text.textContent = label;
}
async function refreshEngineMini(root, cfg, force = false) {
  const hasLane = providersFor(cfg, "image").length + providersFor(cfg, "video").length > 0;
  if (!hasLane) {
    updateEngineMini(root, "down", "Engine off", "No media engine is enabled.");
    return;
  }
  updateEngineMini(root, "checking", "Checking engine", "Checking the media engine.");
  const h = await checkEngineHealth(cfg, force).catch(() => engineHealth);
  const providerId = genState.provider || PRIMARY_MEDIA_LANE;
  if (lastRenderIssue) {
    updateEngineMini(root, "warn", "Needs attention", explainMediaFailure(lastRenderIssue.reason, lastRenderIssue.detail, lastRenderIssue.lane) || "The last render did not finish.");
  } else if (renderLaneReady(h, providerId)) {
    updateEngineMini(root, "ok", "Engine ready", "Media Lab can generate through the active owner render lane.");
  } else {
    const detail = engineAttention(h, providerId);
    updateEngineMini(root, /sign|session|auth/i.test(detail) ? "warn" : "down", /sign|session|auth/i.test(detail) ? "Needs sign-in" : "Engine offline", detail);
  }
}

/* ---------------- generation client ---------------- */
function cleanBrief(value = "", limit = 2200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
function normalizeCinematicModel(req = {}) {
  if (normalizeLaneId(req.provider) !== PRIMARY_MEDIA_LANE) return req.model || "";
  if (req.modality === "image") {
    return ["gpt_image_2", "nano_banana_2"].includes(req.model) ? req.model : "gpt_image_2";
  }
  return ["seedance_2_0", "kling3_0", "marketing_studio_video"].includes(req.model) ? req.model : "seedance_2_0";
}
function buildGenerationSpec(req = {}) {
  const params = req.params || {};
  const rawPrompt = cleanBrief(req.prompt);
  const negative = cleanBrief(req.negative, 700);
  const model = normalizeCinematicModel(req) || req.model || "";
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
      provider: normalizeLaneId(req.provider || PRIMARY_MEDIA_LANE),
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
function cinematicDraftMode(req = {}, spec = {}) {
  const model = spec.model || normalizeCinematicModel(req);
  if (model === "marketing_studio_video") return "marketing";
  return spec.modality === "image" ? "image" : "video";
}
function cinematicResolution(spec = {}) {
  if (spec.quality === "high") return spec.modality === "image" ? "2k" : "1080p";
  return spec.modality === "image" ? "1k" : "720p";
}
async function draftCinematicRequest(req = {}, spec = {}) {
  const token = accessSession.token();
  if (normalizeLaneId(req.provider) !== PRIMARY_MEDIA_LANE) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch("/phantom-ai/media-lab/creative/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        tenant_id: currentTenantId(),
        prompt: spec.provider_prompt,
        mode: cinematicDraftMode(req, spec),
        model: spec.model,
        duration: String(spec.duration),
        aspect_ratio: spec.aspect,
        resolution: cinematicResolution(spec),
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
// to a procedural preview so Media Lab is always usable.
async function generate(cfg, req) {
  const base = genBase(cfg);
  req = { ...req, provider: normalizeLaneId(req.provider || PRIMARY_MEDIA_LANE) };
  const p = provider(cfg, req.provider) || {};
  const spec = buildGenerationSpec(req);
  const health = await checkEngineHealth(cfg).catch(() => engineHealth);
  /* BACKEND LANE FIRST: the same-origin PhantomForce backend brokers the
     brief and returns either real assets or an approval-safe preview packet. */
  const backendLane = req.provider === PRIMARY_MEDIA_LANE && !p.endpoint
    && (!!health.engine || (health.studio && health.studioCli !== false));
  const url = p.endpoint || (backendLane ? "/generate" : `${base}/generate`);
  /* LEGACY DIRECT QUEUE: no newer backend on this origin, but the older
     same-origin draft route answers. */
  if (req.provider === PRIMARY_MEDIA_LANE && !backendLane && !health.media[PRIMARY_MEDIA_LANE] && health.bridge) {
    const draft = await draftCinematicRequest({ ...req, prompt: spec.provider_prompt, model: spec.model }, spec);
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
    tenant_id: currentTenantId(),
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
      // async on the backend lane: the box answers instantly with a draft/job id
      // we poll, so a tunnel that cuts long requests can't kill it
      body: JSON.stringify(backendLane
        ? { ...providerReq, async: true, approved: req.approved === true, credit_warning_shown: req.creditWarningShown === true }
        : providerReq),
      signal: ctrl.signal,
    });
    let d = await r.json().catch(() => null);
    if (d && d.error === "approval_required") {
      return { assets: [], live: false, approvalRequired: true, transport: d.transport || "cli_fallback", spec, message: d.message || "" };
    }
    // background job: poll until it lands.
    // A draft packet is a quick tool call, not a render — it gets a
    // short leash so the UI never sits frozen for the render-length timeout.
    if (d && d.job && !d.queued && !(Array.isArray(d.assets) && d.assets.length)) {
      const jobKind = d.transport === "hermes_mcp" ? "draft" : "render";
      d = await pollStudioJob(d.job, spec, headers, jobKind);
    }
    // Draft transport: the brief is queued as a draft — no credits spent
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
  const draft = await draftCinematicRequest(providerReq, spec);
  const assets = [];
  for (let i = 0; i < (providerReq.params.count || 1); i++) assets.push(previewAsset(providerReq, i, { spec, fallbackReason, draft }));
  return { assets, live: false, spec, fallbackReason, fallbackDetail, fallbackLane: url, draft };
}

/* Poll a Media Lab background job until it lands. Transient network blips while
   polling must NOT kill a render that's still cooking on the box.
   A DRAFT packet is a quick request, not a render — it gets
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
      if (r.status === 404) return { error: "job_lost", message: d?.message || "Media Lab restarted mid-render" };
      if (!d) continue;
      misses = 0;
      if (d.status === "done" || d.status === "failed" || d.status === "blocked") return d;
    } catch {
      if (++misses >= 24) return { error: "provider_unreachable", message: "lost contact with Media Lab for 2 minutes" };
    }
  }
  if (kind === "draft") return { error: "provider_timeout", message: "the draft tool call took longer than 3 minutes — the operator lane may be stuck" };
  return { error: "provider_timeout", message: "" };
}

/* Turn a raw Media Lab failure into the exact next move for the owner. */
function explainMediaFailure(reason = "", detail = "", lane = "") {
  const text = `${reason} ${detail}`.toLowerCase();
  if (reason === "blocked")
    return detail || "Media Lab is blocked — open the banner above for the exact reason";
  if (/enoent|not recognized|command not found|no such file/.test(text))
    return "Media Lab needs setup on the admin box, then Re-check";
  if (/login|logged|sign[ -]?in|auth|unauthoriz|credential|expired|forbidden/.test(text))
    return "Media Lab sign-in needs attention on the admin box, then Re-check";
  if (/quota|credit|insufficient|billing|payment|limit reached/.test(text))
    return "Media Lab is out of render credits — check your plan";
  if (/job_lost/.test(text))
    return "Media Lab restarted mid-render — run it again";
  if (/unreachable/.test(text))
    return "Media Lab did not answer — restart the media service, then Re-check";
  if (/timeout/.test(text))
    return "Media Lab took too long — run it again or drop the quality a notch";
  if (/admin_session_required/.test(text))
    return "this session isn't signed in as admin — sign in and try again";
  if (/no_assets/.test(text))
    return "Media Lab finished but returned no files — run it again or simplify the prompt";
  return detail ? `Media Lab said: ${detail}` : "";
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
    ? (context.via === "hermes" ? "QUEUED · FINAL REVIEW" : "RENDERING IN PHANTOMFORCE")
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
  try { intent = JSON.parse(workspaceStorageGetItem(EDIT_INTENT_KEY, { migrateGlobal: false }) || "null"); } catch {}
  if (!intent || intent.type !== "image" || !intent.url) return;
  try { workspaceStorageRemoveItem(EDIT_INTENT_KEY); } catch {}
  const asset = {
    id: intent.id || `hub-edit-${Date.now()}`,
    type: "image",
    url: intent.url,
    saved: true,
    meta: { prompt: intent.prompt || "", title: intent.title || "Creator Hub edit" },
  };
  if (!session.assets.some((item) => item.id === asset.id)) session.assets.unshift(asset);
  session.edit = { url: asset.url, type: "image", id: asset.id };
  session.tab = "edit";
  resetEdit();
  opts.notify?.("Media Factory", `loaded ${intent.title || "Creator Hub asset"} for local edit.`);
}

function consumePromptIntent(opts = {}) {
  let intent = null;
  try { intent = JSON.parse(workspaceStorageGetItem(PROMPT_INTENT_KEY, { migrateGlobal: false }) || "null"); } catch {}
  if (!intent || !intent.prompt) return;
  try { workspaceStorageRemoveItem(PROMPT_INTENT_KEY); } catch {}
  genState.modality = intent.modality === "video" ? "video" : "image";
  genState.prompt = intent.prompt;
  genState.preset = "custom";
  session.tab = "generate";
  opts.notify?.("Prompt Library", "Prompt loaded into the Shot Builder.");
}

const NAV_TABS = [
  ["generate", "Create"],
  ["library", "Media Pool"],
  ["pending", "Pending"],
  ["edit", "Edit"],
  ["content", "Content Hub"],
];
const NAV_DRAWERS = [
  ["templates", "Templates", "layout"],
  ["history", "History", "clock"],
  ["engine", "Engine", "cpu"],
];
let activeDrawer = null;

export function renderMediaStudio(el, opts = {}) {
  if (opts.initialTab && el.dataset.mlInitialTab !== opts.initialTab) {
    session.tab = opts.initialTab;
    el.dataset.mlInitialTab = opts.initialTab;
  }
  consumeEditIntent(opts);
  consumePromptIntent(opts);
  const esc = opts.esc || ((s) => String(s));
  const cfg = loadCfg();
  if (session.tab === "briefs") session.tab = "pending";
  el.innerHTML = `
    <div class="ml">
      <div class="ml-topbar">
        <nav class="ml-tabs" role="tablist" aria-label="Media Lab views">
          ${NAV_TABS.map(([id, label]) => `<button class="ml-tab ${session.tab === id && !activeDrawer ? "is-active" : ""}" role="tab" aria-selected="${session.tab === id && !activeDrawer}" data-ml-tab="${id}">${label}${id === "library" && session.assets.length ? ` · ${session.assets.length}` : ""}</button>`).join("")}
        </nav>
        <button class="ml-settings-gear ${activeDrawer === "settings" ? "is-active" : ""}" data-ml-open-local-settings type="button" title="Media Lab settings" aria-label="Media Lab settings">${svgIc("gear")}</button>
      </div>
      <div class="ml-body" data-ml-body></div>
      ${activeDrawer ? drawerHtml(activeDrawer, cfg, esc, opts) : ""}
    </div>`;
  el.querySelectorAll("[data-ml-tab]").forEach((b) => b.onclick = () => { session.tab = b.dataset.mlTab; activeDrawer = null; renderMediaStudio(el, opts); });
  el.querySelectorAll("[data-ml-drawer-open]").forEach((b) => b.onclick = () => { activeDrawer = activeDrawer === b.dataset.mlDrawerOpen ? null : b.dataset.mlDrawerOpen; renderMediaStudio(el, opts); });
  el.querySelector("[data-ml-open-local-settings]")?.addEventListener("click", () => { activeDrawer = activeDrawer === "settings" ? null : "settings"; renderMediaStudio(el, opts); });
  el.querySelector("[data-ml-drawer-close]")?.addEventListener("click", () => { activeDrawer = null; renderMediaStudio(el, opts); });
  el.querySelector("[data-ml-drawer-backdrop]")?.addEventListener("click", () => { activeDrawer = null; renderMediaStudio(el, opts); });
  wireDrawer(el, activeDrawer, cfg, opts, esc);
  const body = el.querySelector("[data-ml-body]");
  if (session.tab === "generate") renderGenerate(body, cfg, opts, el);
  else if (session.tab === "pending") (opts.renderPending ? opts.renderPending(body) : renderPending(body));
  else if (session.tab === "edit") renderEdit(body, cfg, opts, el);
  else if (session.tab === "library") renderLibrary(body, opts, el);
  else if (session.tab === "content") opts.renderContentHub?.(body, opts);
}

/* ---- drawers: Templates / History / Engine / Settings — local Media Lab only ---- */
function drawerHtml(kind, cfg, esc, opts) {
  const titleFor = { templates: "Templates", history: "History", engine: "Engine", settings: "Media Lab settings" };
  return `
    <div class="ml-drawer-backdrop" data-ml-drawer-backdrop></div>
    <aside class="ml-drawer" role="dialog" aria-label="${titleFor[kind]}">
      <header class="ml-drawer-head"><b>${titleFor[kind]}</b><button class="ml-drawer-x" data-ml-drawer-close aria-label="Close">${svgIc("close")}</button></header>
      <div class="ml-drawer-body">${kind === "templates" ? templatesDrawerHtml(esc) : kind === "history" ? historyDrawerHtml(esc) : kind === "settings" ? mediaSettingsDrawerHtml(cfg, esc) : engineDrawerHtml(cfg, esc)}</div>
    </aside>`;
}
function templatesDrawerHtml(esc) {
  const visible = MEDIA_PRESETS.filter((p) => p.modality === genState.modality);
  return `
    <p class="ml-drawer-note">Pro formats for ${genState.modality === "video" ? "video" : "image"} — pick one to prefill the Shot Builder.</p>
    <div class="ml-presets" data-ml-presets>
      ${visible.map((p) => `<button class="ml-preset is-${p.modality} ${genState.preset === p.id ? "is-on" : ""}" data-v="${p.id}" title="${esc(p.prompt)}">
        <span class="ml-preset-kicker">${svgIc(p.modality === "video" ? "film" : "image")} ${esc(p.use)}</span>
        <b>${esc(p.label)}</b>
        <span class="ml-preset-meta">${presetCardMeta(p).map((m) => `<i>${esc(m)}</i>`).join("")}</span>
        <em>${esc(p.note || presetSpec(p))}</em>
      </button>`).join("")}
    </div>`;
}
function historyDrawerHtml(esc) {
  if (!jobLog.length) return `<p class="ml-drawer-note">No activity yet — your render history will show up here.</p>`;
  return `<div class="ml-history-rows">${jobLog.map((e) => `<div class="ml-history-row is-${e.kind}"><i></i><div><b>${esc(e.text)}</b><span>${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div></div>`).join("")}</div>`;
}
function engineDrawerHtml(cfg, esc) {
  const provs = providersFor(cfg, genState.modality);
  return `
    <div class="ml-engine-drawer-rows">
      <span><b>Active engine</b><i>${esc((provider(cfg, genState.provider) || {}).name || "None configured")}</i></span>
      <span><b>Render lane</b><i>${esc(laneLabel(genState.model) || "—")}</i></span>
      <span><b>Mode</b><i>${genState.modality === "video" ? "Video" : "Image"}</i></span>
      <span><b>Production credits</b><i>${cfg.credits} available</i></span>
      <span><b>Approval</b><i>${cfg.requireApproval ? "Required before paid renders" : "Owner-approved"}</i></span>
    </div>
    ${provs.length > 1 ? `<p class="ml-drawer-note">${provs.length} engines available for ${genState.modality}. Use the Media Lab gear to change creative defaults.</p>` : ""}`;
}
function mediaSettingsDrawerHtml(cfg, esc) {
  const provs = providersFor(cfg, genState.modality);
  const p = provider(cfg, genState.provider) || provs[0] || {};
  const models = (p.models && p.models[genState.modality]) || [];
  const aspects = genState.modality === "video" ? VID_ASPECTS : IMG_ASPECTS;
  return `
    <p class="ml-drawer-note">Local settings for this Media Lab session. This does not open the full app settings page.</p>
    <div class="ml-drawer-settings">
      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Create</span>
        <div class="ml-seg ml-seg-sm" data-ml-set-modality>
          <button class="${genState.modality === "image" ? "is-on" : ""}" data-v="image">${svgIc("image")} Image</button>
          <button class="${genState.modality === "video" ? "is-on" : ""}" data-v="video">${svgIc("film")} Video</button>
        </div>
      </section>

      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Format</span>
        <div class="ml-settings-grid">
          <label class="ml-field"><span>Ratio</span>
            <select class="ml-select ml-select-pill" data-ml-set-aspect>${aspectOptions(aspectGroups(aspects), esc)}</select>
          </label>
          ${genState.modality === "video" ? `<label class="ml-field"><span>Length</span>
            <div class="ml-chips" data-ml-set-dur>${DURATIONS.map((d) => `<button class="${genState.duration === d ? "is-on" : ""}" data-v="${d}">${d}s</button>`).join("")}</div></label>`
          : `<label class="ml-field"><span>Takes</span>
            <div class="ml-chips" data-ml-set-count>${[1, 2, 3, 4].map((n) => `<button class="${genState.count === n ? "is-on" : ""}" data-v="${n}">${n}</button>`).join("")}</div></label>`}
        </div>
        <label class="ml-field"><span>Style</span>
          <select class="ml-select ml-select-pill" data-ml-set-style>${STYLES.map((s) => `<option value="${esc(s)}" ${genState.style === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        </label>
      </section>

      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Quality</span>
        <div class="ml-seg ml-seg-sm" data-ml-set-quality>
          <button class="${genState.quality === "standard" ? "is-on" : ""}" data-v="standard">Standard</button>
          <button class="${genState.quality === "high" ? "is-on" : ""}" data-v="high">High</button>
        </div>
      </section>

      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Engine</span>
        ${provs.length ? `<label class="ml-field"><span>Lane</span>
          <select class="ml-select ml-select-pill" data-ml-set-provider>${provs.map((x) => `<option value="${x.id}" ${genState.provider === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
        </label>` : `<div class="ml-settings-empty">No Media Lab engine is connected yet.</div>`}
        ${models.length ? `<label class="ml-field"><span>Model</span>
          <select class="ml-select ml-select-pill" data-ml-set-model>${models.map((m) => `<option value="${esc(m)}" ${genState.model === m ? "selected" : ""}>${esc(laneLabel(m) || m)}</option>`).join("")}</select>
        </label>` : ""}
        <button class="ml-generate ml-ghost ml-inline" data-ml-set-recheck type="button">${svgIc("spark")} Re-check Media Lab</button>
      </section>

      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Avoid</span>
        <textarea class="ml-prompt ml-settings-textarea" data-ml-set-neg rows="3" placeholder="Optional: words, styles, or details to avoid...">${esc(genState.negative)}</textarea>
      </section>

      <section class="ml-drawer-section">
        <span class="ml-drawer-label">Status</span>
        <div class="ml-engine-drawer-rows">
          <span><b>Credits</b><i>${cfg.credits} available</i></span>
          <span><b>Approval</b><i>${cfg.requireApproval ? "Required before paid renders" : "Owner-approved"}</i></span>
        </div>
      </section>
    </div>`;
}
function wireDrawer(el, kind, cfg, opts, esc) {
  if (kind === "templates") {
    el.querySelectorAll(".ml-drawer [data-ml-presets] button").forEach((b) => b.onclick = () => {
      const preset = MEDIA_PRESETS.find((p) => p.id === b.dataset.v);
      if (preset) applyPreset(preset);
      session.tab = "generate"; activeDrawer = null;
      renderMediaStudio(el, opts);
    });
  }
  if (kind === "settings") {
    el.querySelectorAll("[data-ml-set-modality] button").forEach((b) => b.onclick = () => { setModality(b.dataset.v); renderMediaStudio(el, opts); });
    const aspect = el.querySelector("[data-ml-set-aspect]");
    if (aspect) aspect.onchange = () => { genState.aspect = aspect.value; markCustomPreset(); renderMediaStudio(el, opts); };
    el.querySelectorAll("[data-ml-set-count] button").forEach((b) => b.onclick = () => { genState.count = +b.dataset.v; markCustomPreset(); renderMediaStudio(el, opts); });
    el.querySelectorAll("[data-ml-set-dur] button").forEach((b) => b.onclick = () => { genState.duration = +b.dataset.v; markCustomPreset(); renderMediaStudio(el, opts); });
    const style = el.querySelector("[data-ml-set-style]");
    if (style) style.onchange = () => { genState.style = style.value; markCustomPreset(); renderMediaStudio(el, opts); };
    el.querySelectorAll("[data-ml-set-quality] button").forEach((b) => b.onclick = () => { genState.quality = b.dataset.v || "standard"; renderMediaStudio(el, opts); });
    const prov = el.querySelector("[data-ml-set-provider]");
    if (prov) prov.onchange = () => { genState.provider = prov.value; genState.model = ""; renderMediaStudio(el, opts); };
    const model = el.querySelector("[data-ml-set-model]");
    if (model) model.onchange = () => { genState.model = model.value; };
    const neg = el.querySelector("[data-ml-set-neg]");
    if (neg) neg.oninput = () => { genState.negative = neg.value; };
    const recheck = el.querySelector("[data-ml-set-recheck]");
    if (recheck) recheck.onclick = async () => {
      recheck.disabled = true;
      recheck.innerHTML = `${svgIc("spark")} Checking...`;
      await checkEngineHealth(cfg, true).catch(() => null);
      opts.notify?.("Media Lab", "Media Lab status refreshed.");
      renderMediaStudio(el, opts);
    };
  }
}

function renderPending(body) {
  body.innerHTML = `
    <div class="ml-idle">
      <b>No pending media.</b>
      <i>Generate an image or video when you are ready. Outputs land under Generated.</i>
    </div>`;
}

/* ---- Generate ---- */
const genState = { modality: "image", provider: PRIMARY_MEDIA_LANE, model: "", prompt: "", negative: "", aspect: "1:1", count: 2, quality: "standard", style: "Cinematic", duration: 6, ref: null, busy: false, showNeg: false, preset: "custom", stageFull: false };

function activePreset() {
  return MEDIA_PRESETS.find((p) => p.id === genState.preset) || null;
}
function presetSpec(p) {
  return `${p.modality === "video" ? "Video" : "Image"} · ${p.aspect}${p.modality === "video" ? ` · ${p.duration}s` : ` · ${p.count || 1} take${(p.count || 1) > 1 ? "s" : ""}`}`;
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

function aspectGroups(aspects) {
  return {
    landscape: aspects.filter(([, r]) => r > 1.2),
    square: aspects.filter(([, r]) => r >= 0.9 && r <= 1.2),
    portrait: aspects.filter(([, r]) => r < 0.9),
  };
}
function aspectOptions(groups, esc) {
  const grp = (label, list) => list.length ? `<optgroup label="${label}">${list.map(([k]) => `<option value="${esc(k)}" ${genState.aspect === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</optgroup>` : "";
  return `${grp("Landscape", groups.landscape)}${grp("Portrait", groups.portrait)}${grp("Square", groups.square)}`;
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

  body.innerHTML = `
    <div class="ml-workspace">
      <section class="ml-brief" aria-label="Shot Builder">
        <div class="ml-brief-head">
          <div class="ml-card-head"><b>Shot Builder</b></div>
          <button class="ml-setup-link" data-ml-open-settings type="button">${svgIc("gear")} ${genState.modality === "video" ? "Video" : "Image"} · ${genState.aspect} · ${esc(genState.style)}</button>
        </div>

        <label class="ml-field"><span>Reference</span>
          <div class="ml-drop ${genState.ref ? "has-ref" : ""}" data-ml-drop>
            ${genState.ref
              ? `<img src="${genState.ref}" alt="reference"/><span class="ml-drop-copy"><b>Reference attached</b><i>Style, logo, continuity</i></span><button class="ml-drop-x" data-ml-clearref aria-label="Remove reference image">${svgIc("close")}</button>`
              : `<span class="ml-drop-ic">${svgIc("upload")}</span><span class="ml-drop-copy"><b>Add reference image</b><i>Optional — style, logo, continuity</i></span><button class="ml-drop-browse" type="button">Browse files</button>`}
            <input type="file" accept="image/*" data-ml-file hidden />
          </div>
        </label>

        <label class="ml-field ml-field-brief ml-field-hero"><span>Prompt</span>
          <div class="ml-prompt-wrap">
            <textarea class="ml-prompt" data-ml-prompt rows="3" placeholder="Describe the shot — subject, setting, light, mood, camera movement, style…">${esc(genState.prompt)}</textarea>
            <button class="ml-enhance" data-ml-enhance title="Improve prompt">${svgIc("spark")} Enhance</button>
          </div>
        </label>

        ${!genState.provider ? `<button class="ml-settings-needed" data-ml-open-settings type="button">${svgIc("gear")} Connect Media Lab</button>` : ""}

        <button class="ml-generate ml-hero" data-ml-generate ${genState.busy || !genState.provider ? "disabled" : ""}>
          <span class="ml-generate-glow" aria-hidden="true"></span>
          <span class="ml-generate-main">${genState.busy ? `${svgIc("spark")} <span data-ml-busy-label>Working…</span>` : `${svgIc("bolt")} Generate ${genState.modality === "video" ? "cut" : "image"}`}</span>
          <i class="ml-generate-hint">${genState.busy ? "Phantom is handling the rest" : "Phantom handles the rest"}</i>
        </button>
      </section>

      <section class="ml-stage" data-ml-results aria-label="Preview Stage">
        <div class="ml-stage-frame ${genState.busy ? "is-busy" : ""} ${genState.stageFull ? "is-full" : ""}">
          <header class="ml-stage-top">
            <span class="ml-rec ${genState.busy ? "is-live" : ""}"><i aria-hidden="true"></i><span data-ml-busy-stage>${genState.busy ? "Rendering" : "Stage ready"}</span></span>
            <b>Preview Stage</b>
            <span class="ml-stage-tools">
              <span class="ml-stage-chip">${genState.aspect}${genState.modality === "video" ? ` · ${genState.duration}s` : ""}</span>
              <button class="ml-stage-ic" data-ml-fullscreen title="${genState.stageFull ? "Exit fullscreen" : "Fullscreen"}" aria-label="Toggle fullscreen preview">${svgIc(genState.stageFull ? "collapse" : "expand")}</button>
            </span>
          </header>
          <div class="ml-stage-view">
            ${genState.busy ? skeletons(genState.modality === "video" ? 1 : genState.count) : resultsHtml(esc)}
          </div>
          <footer class="ml-stage-meta">${settingsChips(esc)}</footer>
        </div>
      </section>
    </div>
    ${nextStepsHtml(esc)}
    ${jobLogHtml(esc)}`;

  wireGenerate(body, cfg, opts, root, esc);
}

/* ---- Next steps: what to do with the latest cut, once one exists ---- */
function nextStepsHtml(esc) {
  const recent = session.assets.filter((a) => a.fromGen);
  if (genState.busy || !recent.length) return "";
  const unsavedCount = recent.filter((a) => !a.saved).length;
  return `
    <div class="ml-next" aria-label="Next steps">
      <div class="ml-next-head">${svgIc("spark")}<b>Next steps</b><span>Choose what happens to this cut</span></div>
      <div class="ml-next-grid">
        <button class="ml-next-card is-neon" data-ml-next="save" ${unsavedCount ? "" : "disabled"}>
          ${svgIc("check")}<b>Save to library</b><span>${unsavedCount ? `${unsavedCount} unsaved` : "All saved"}</span>
        </button>
        <button class="ml-next-card is-cyan" data-ml-next="hub">
          ${svgIc("hub")}<b>Open in Creator Hub</b><span>Auto-captured already</span>
        </button>
        <button class="ml-next-card is-gold" data-ml-next="ref">
          ${svgIc("image")}<b>Use as reference</b><span>Continuity for the next take</span>
        </button>
        <button class="ml-next-card is-ghost" data-ml-next="download">
          ${svgIc("download")}<b>Download</b><span>Save the file locally</span>
        </button>
      </div>
    </div>`;
}

/* ---- Job log: a slim, honest trail of what actually just happened ---- */
let jobLog = [];
function logJob(kind, text) {
  jobLog.unshift({ kind, text, at: Date.now() });
  jobLog = jobLog.slice(0, 40);
}
function jobLogHtml(esc) {
  if (!jobLog.length) return "";
  const recent = jobLog.slice(0, 6);
  return `<div class="ml-joblog" aria-label="Recent activity">
    <span class="ml-joblog-label">${svgIc("play")}Job log</span>
    <div class="ml-joblog-rows">${recent.map((e) => `<span class="ml-joblog-row is-${e.kind}"><i></i>${esc(e.text)}</span>`).join("")}</div>
    <button class="ml-joblog-clear" data-ml-joblog-clear type="button">Clear</button>
  </div>`;
}

function settingsChips(esc) {
  const preset = activePreset();
  const chips = [
    preset ? preset.label : "Custom",
    genState.modality === "video" ? "Video" : "Image",
    genState.style !== "None" ? genState.style : null,
    genState.aspect,
    genState.modality === "video" ? `${genState.duration}s` : `${genState.count} take${genState.count > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return `<div class="ml-brief-chips" aria-label="Current generation settings">${chips.map((c) => `<span>${esc(String(c))}</span>`).join("")}</div>`;
}

/* one slim status strip, not a wall of cards — render mode is already shown
   in the stage's settings chips, and safeguards don't need their own card
   for something as low-stakes as generating an image. Queue tucks into a
   native <details> dropdown instead of always-on real estate. */
function railHtml(cfg, esc) {
  const queue = session.assets.slice(0, 6);
  const meterPct = Math.max(4, Math.min(100, Math.round((cfg.credits / 480) * 100)));
  return `
      <div class="ml-rail" aria-label="Production status">
        <div class="ml-rail-credit" title="Production credits">
          ${svgIc("bolt")}<b>${cfg.credits}</b><span>credits</span>
          <span class="ml-rail-credit-meter"><i style="width:${meterPct}%"></i></span>
        </div>
        <span class="ml-chip is-ready" title="Every finished render is captured to your Creator Hub automatically.">${svgIc("hub")} Auto-capture on</span>
        <details class="ml-queue-drop">
          <summary>${svgIc("play")} Queue <b>${queue.length}</b></summary>
          <div class="ml-queue-pop">
            ${queue.length
              ? `<div class="ml-queue">${queue.map((a) => queueRow(a, esc)).join("")}</div>`
              : `<p class="ml-rail-empty">Queue clear — the stage is yours.</p>`}
          </div>
        </details>
      </div>`;
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
  const title = extra.title || (asset.type === "video" ? "Generated video" : "Generated image");
  /* also push generated media into the permanent Asset Cloud when a business
     session is active — one save, reusable everywhere (best-effort, never
     blocks the local capture) */
  if (asset?.url && /^data:(image|video)\//.test(asset.url) && assetsAvailable()) {
    const ext = asset.type === "video" ? "mp4" : (asset.url.slice(5, asset.url.indexOf(";")).split("/")[1] || "png");
    saveToAssetCloud(asset.url, `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${ext}`, {
      source: "media-lab",
      tags: [extra.style || genState.style, extra.provider || genState.provider].filter(Boolean),
    }).catch(() => {});
  }
  try {
    const result = registerContentAsset({
      ...asset,
      title,
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
      <i>Phantom preps the brief, creates the media, reviews the output, and turns it into campaigns, sites, and follow-ups. Finished media lands here — and in Creator Hub.</i>
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
  seg("[data-ml-provs]", (v) => { genState.provider = v; });
  seg("[data-ml-quality]", (v) => { genState.quality = v; });
  if (body.querySelector("[data-ml-count]")) seg("[data-ml-count]", (v) => { genState.count = +v; markCustomPreset(); });
  if (body.querySelector("[data-ml-dur]")) seg("[data-ml-dur]", (v) => { genState.duration = +v; markCustomPreset(); });
  const aspectSel = body.querySelector("[data-ml-aspect-select]");
  if (aspectSel) aspectSel.onchange = () => { genState.aspect = aspectSel.value; markCustomPreset(); renderGenerate(body, cfg, opts, root); };
  const styleSel = body.querySelector("[data-ml-style-select]");
  if (styleSel) styleSel.onchange = () => { genState.style = styleSel.value; markCustomPreset(); renderGenerate(body, cfg, opts, root); };
  const modelSel = body.querySelector("[data-ml-model]");
  if (modelSel) modelSel.onchange = () => { genState.model = modelSel.value; };
  const pr = body.querySelector("[data-ml-prompt]"); if (pr) pr.oninput = () => { genState.prompt = pr.value; };
  const neg = body.querySelector("[data-ml-neg]"); if (neg) neg.oninput = () => { genState.negative = neg.value; };
  const tgl = body.querySelector("[data-ml-toggleneg]"); if (tgl) tgl.onclick = () => { genState.showNeg = !genState.showNeg; renderGenerate(body, cfg, opts, root); };
  const os = body.querySelector("[data-ml-open-settings]"); if (os) os.onclick = () => { activeDrawer = "settings"; if (root) renderMediaStudio(root, opts); };
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
  /* the curtain stays down: the default view is a short state + a stats
     list, never a transport/vendor name. Anything genuinely technical
     (for whoever actually has to go fix it) lives behind the collapsed
     Details toggle instead of always being on screen. */
  const setDoctor = (state, titleText, stats, raw) => {
    doctor.dataset.state = state;
    doctor.querySelector("[data-ml-doctor-title]").textContent = titleText;
    doctor.querySelector("[data-ml-doctor-msg]").textContent = stats.filter(Boolean).join(" · ");
    const detailsEl = doctor.querySelector("[data-ml-doctor-details]");
    const rawEl = doctor.querySelector("[data-ml-doctor-raw]");
    if (raw) { rawEl.textContent = raw; detailsEl.hidden = false; }
    else { detailsEl.hidden = true; detailsEl.open = false; }
  };
  const runDoctor = async (force = false) => {
    if (!doctor) return;
    setDoctor("checking", "Checking the media engine…", []);
    const base = genBase(cfg).replace(/^https?:\/\//, "");
    const h = await checkEngineHealth(cfg, force).catch(() => engineHealth);
    if (!doctor.isConnected) return;
    const prov = genState.provider || PRIMARY_MEDIA_LANE;
    const ready = renderLaneReady(h, prov);
    if (force) lastRenderIssue = null;
    else if (ready && lastRenderIssue && Date.now() - (lastRenderIssue.at || 0) > 45000) lastRenderIssue = null;
    if (lastRenderIssue) {
      // a green "connected" banner must never contradict a failing render —
      // the most recent failure is THE state until it's cleared or fixed
      setDoctor("warn", "The last render didn't finish", ["Check the details, then re-check"],
        explainMediaFailure(lastRenderIssue.reason, lastRenderIssue.detail, lastRenderIssue.lane)
          || `${String(lastRenderIssue.reason || "unknown error")} — fix it on the admin box, then hit Re-check.`);
      return;
    }
    if (h.engine && prov === PRIMARY_MEDIA_LANE) {
      const e = h.engine;
      const adminTail = null;
      // your session token lives in sessionStorage (tab-scoped) while "signed
      // in" state lives in localStorage (persists) — a new tab or a browser
      // restart can leave you looking signed in with no token to actually
      // authenticate render requests. Say THAT precisely, not a relayed
      // backend auth error that reads like a separate account is needed.
      if (!h.hasToken && e.status !== "connected") {
        setDoctor("warn", "Media Lab — Sign-in expired", ["Sign out, sign back in, then re-check"],
          "Your admin session needs a refresh. Sign out, sign back in, and hit Re-check.");
      } else if (ready) {
        setDoctor("ok", "Media Lab — Ready", ["Owner-approved", "Auto-saved to Creator Hub"], adminTail);
      } else if (e.status === "not_configured") {
        setDoctor("warn", "Media Lab — Offline", ["Generation needs attention"], adminTail);
      } else {
        setDoctor("warn", "Media Lab — Blocked", ["Some creative tools need attention"], adminTail);
      }
    } else if (h.media[prov]) {
      setDoctor("ok", "Media Lab — Ready", ["Live generation enabled"]);
    } else if (h.bridge && !h.bridgeAuth) {
      setDoctor("warn", "Media Lab — Sign-in expired", ["Sign out, sign back in, then re-check"]);
    } else if (h.bridge) {
      setDoctor("ok", "Media Lab — Ready", ["Auto-saved to Creator Hub"]);
    } else if (h.proxy) {
      setDoctor("warn", "Media Lab — Needs setup", ["Offline sketches only until connected"]);
    } else if (h.studio && prov === PRIMARY_MEDIA_LANE) {
      setDoctor("warn", "Media Lab — Needs setup", ["Media service is up", "render lane not ready"]);
    } else {
      setDoctor("down", "Media Lab — Unreachable", ["Generation needs attention"]);
    }
  };
  const runDoctorAndLog = async (force = false) => {
    await runDoctor(force);
    if (!doctor?.isConnected) return;
    const state = doctor.dataset.state;
    if (state === "checking" || (state === lastLoggedDoctorState && !force)) return;
    lastLoggedDoctorState = state;
    logJob(state === "ok" ? "ok" : state === "down" ? "down" : "warn", doctor.querySelector("[data-ml-doctor-title]")?.textContent || "Engine check");
    paintJobLog(body, esc);
  };
  doctor?.querySelector("[data-ml-doctor-retry]")?.addEventListener("click", async () => {
    await runDoctorAndLog(true);
    await refreshEngineMini(root, cfg, true);
  });
  runDoctorAndLog();

  body.querySelectorAll("[data-tile-act]").forEach((b) => b.onclick = () => tileAction(b.dataset.tileAct, b.dataset.id, cfg, opts, root, esc, body));

  /* stage fullscreen toggle — a real, self-contained UI state, not decoration */
  body.querySelector("[data-ml-fullscreen]")?.addEventListener("click", () => {
    genState.stageFull = !genState.stageFull;
    renderGenerate(body, cfg, opts, root);
  });

  /* Next steps: act on the freshest batch of generations */
  body.querySelector("[data-ml-next='save']")?.addEventListener("click", () => {
    const recent = session.assets.filter((a) => a.fromGen && !a.saved);
    recent.forEach((a) => { a.saved = true; captureForContentHub(a); });
    if (opts.notify) opts.notify("Media Factory", `saved ${recent.length} generation${recent.length === 1 ? "" : "s"} to the library.`);
    renderGenerate(body, cfg, opts, root);
  });
  body.querySelector("[data-ml-next='hub']")?.addEventListener("click", () => opts.openWorkspace && opts.openWorkspace("content"));
  body.querySelector("[data-ml-next='ref']")?.addEventListener("click", () => {
    const latest = session.assets.find((a) => a.fromGen);
    if (!latest) return;
    genState.ref = latest.url;
    renderGenerate(body, cfg, opts, root);
  });
  body.querySelector("[data-ml-next='download']")?.addEventListener("click", () => {
    const latest = session.assets.find((a) => a.fromGen);
    if (latest) downloadAsset(latest);
  });
  body.querySelector("[data-ml-joblog-clear]")?.addEventListener("click", () => { jobLog = []; paintJobLog(body, esc); });
}
let lastLoggedDoctorState = null;
function paintJobLog(body, esc) {
  const existing = body.querySelector(".ml-joblog");
  const html = jobLogHtml(esc);
  if (!html) { existing?.remove(); return; }
  if (existing) existing.outerHTML = html; else body.insertAdjacentHTML("beforeend", html);
  body.querySelector("[data-ml-joblog-clear]")?.addEventListener("click", () => { jobLog = []; paintJobLog(body, esc); });
}

async function runGenerate(body, cfg, opts, root, esc) {
  if (!genState.prompt.trim()) { const t = body.querySelector("[data-ml-prompt]"); if (t) { t.focus(); t.classList.add("shake"); setTimeout(() => t.classList.remove("shake"), 500); } return; }
  /* Approval is opt-in (Settings > "Require approval before paid generation",
     off by default) — the owner already knows they're spending their own
     credits on their own account, so don't ask every single time unless
     they've explicitly turned that friction on for themselves or their team. */
  const health = await checkEngineHealth(cfg).catch(() => engineHealth);
  const spendLane = !!(health.media?.[genState.provider] || health.engine?.cliFallbackEnabled);
  let approved = true;
  if (spendLane && cfg.requireApproval) {
    approved = window.confirm("This will use Media Lab credits. Approve render?");
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
      const stageText = s < 15 ? "Rendering" : s < 45 ? "Still working" : s < 120 ? "Taking longer than usual — hang tight" : "Well past normal — checking Media Lab";
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
      logJob("warn", "Awaiting your approval before this render can use credits");
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
    logJob(out.live ? "ok" : out.queued ? "ok" : "warn",
      out.live ? `Generated ${out.assets.length} ${genState.modality}${out.assets.length > 1 ? "s" : ""}`
        : out.queued ? "Queued — waiting for final review in Media Lab"
        : `Render didn't complete — sketched locally (${out.fallbackReason || "unreachable"})`);
    refreshGeneratePanel(body, cfg, opts, root);
    if (opts.notify) {
      const why = out.live || out.queued ? "" : explainMediaFailure(out.fallbackReason, out.fallbackDetail, out.fallbackLane);
      const status = out.live
        ? "generated"
        : out.queued
          ? "queued in Media Lab — final review is waiting for"
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
let editState = { ...freshEditState(), loadedUrl: null };
let mlEditResizeHandler = null;
let mlBokehPicking = false;
let mlShowTutorial = false;
let mlEditLoadError = null;
let mlEditHistory = [];
let mlEditFuture = [];

function cloneEditState(source = editState) {
  return cloneImageEditState(source);
}

function rememberEdit() {
  pushEditorSnapshot(mlEditHistory, cloneEditState(), 30);
  mlEditFuture = [];
}

function restoreEdit(next) {
  const loadedUrl = editState.loadedUrl;
  editState = cloneImageEditState(next);
  editState.loadedUrl = loadedUrl;
}
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
  const bSpots = editState.bokeh?.spots || [];
  body.innerHTML = `
    <div class="ml-editor">
      <div class="ml-canvas-wrap">
        ${mlEditLoadError ? `<div class="ch-lb-load-error"><b>Couldn't load this image</b><span>${esc(mlEditLoadError)}</span></div>` : ""}
        <div class="ml-edit-topbar" aria-label="Edit history and preview">
          <button type="button" data-ml-undo ${mlEditHistory.length ? "" : "disabled"} title="Undo">${svgIc("undo")}</button>
          <button type="button" data-ml-redo ${mlEditFuture.length ? "" : "disabled"} title="Redo">${svgIc("redo")}</button>
          <button type="button" data-ml-before title="Hold to see original">Before</button>
        </div>
        <canvas class="ml-canvas" data-ml-canvas></canvas>
        <div class="ch-lb-bokeh-markers" data-ml-bokeh-markers></div>
        <div class="ch-lb-pick-hint" data-ml-pick-hint hidden>${svgIc("spark")} Click to add focus, right-click a spot to remove it</div>
      </div>
      <div class="ml-tools">
        <div class="ml-edit-title"><div><span>Image editor</span><b>Make it ready to use.</b></div><button class="ml-tutorial-btn" type="button" data-ml-tutorial title="Help">?</button></div>
        ${mlShowTutorial ? tutorialMarkup() : ""}
        <div class="ml-quick-fixes">
          <button type="button" data-ml-clean>${svgIc("spark")} Clean up</button>
          <button type="button" data-ml-rembg>Remove background</button>
        </div>
        <details class="ml-edit-section" open>
          <summary><span>Crop & frame</span><b>${esc(editState.crop?.aspect || "original")}</b></summary>
          <div class="ml-edit-section-body">
            <div class="ml-crop-presets" data-ml-crop-presets>
              <button type="button" data-aspect="original" class="${editState.crop?.aspect === "original" ? "is-on" : ""}"><i class="ml-crop-shape is-original"></i>Original</button>
              <button type="button" data-aspect="1:1" class="${editState.crop?.aspect === "1:1" ? "is-on" : ""}"><i class="ml-crop-shape is-square"></i>Square</button>
              <button type="button" data-aspect="4:5" class="${editState.crop?.aspect === "4:5" ? "is-on" : ""}"><i class="ml-crop-shape is-portrait"></i>Post</button>
              <button type="button" data-aspect="9:16" class="${editState.crop?.aspect === "9:16" ? "is-on" : ""}"><i class="ml-crop-shape is-story"></i>Story</button>
              <button type="button" data-aspect="16:9" class="${editState.crop?.aspect === "16:9" ? "is-on" : ""}"><i class="ml-crop-shape is-wide"></i>Wide</button>
            </div>
            <button class="ml-smart-frame" type="button" data-ml-autoframe>${svgIc("spark")} Center on subject</button>
            ${cropSlider("Zoom", "zoom", 100, 300, Math.round((editState.crop?.zoom || 1) * 100), "%")}
            ${cropSlider("Left / right", "x", 0, 100, Math.round((editState.crop?.x ?? 0.5) * 100), "")}
            ${cropSlider("Up / down", "y", 0, 100, Math.round((editState.crop?.y ?? 0.5) * 100), "")}
          </div>
        </details>
        <details class="ml-edit-section">
          <summary><span>Quick looks</span><b>6</b></summary>
          <div class="ml-edit-section-body"><div class="ml-chips ml-chips-wrap" data-ml-filter>
            <button data-v="none">Clean</button><button data-v="vivid">Pop</button><button data-v="warm">Warm</button>
            <button data-v="cold">Cool</button><button data-v="noir">B&W</button><button data-v="emerald">Neon</button>
          </div></div>
        </details>
        <details class="ml-edit-section">
          <summary><span>Fine tune</span><b>Light + color</b></summary>
          <div class="ml-edit-section-body">
            ${slider("Brightness", "brightness", 0, 200, editState.brightness)}
            ${slider("Contrast", "contrast", 0, 200, editState.contrast)}
            ${slider("Color", "saturate", 0, 250, editState.saturate)}
            ${slider("Hue", "hue", 0, 360, editState.hue)}
            ${slider("Softness", "blur", 0, 12, editState.blur)}
            <div class="ml-chips"><button data-ml-rot="-90">${svgIc("undo")} Rotate</button><button data-ml-rot="90">Rotate ${svgIc("redo")}</button><button data-ml-flip class="${editState.flip ? "is-on" : ""}">Flip</button></div>
          </div>
        </details>
        <details class="ml-edit-section">
          <summary><span>Focus blur</span><b>${bSpots.length ? `${bSpots.length} spots` : "Off"}</b></summary>
          <div class="ml-edit-section-body">
            <p class="ch-lb-bokeh-note">${bSpots.length ? "Add more sharp areas or clear the effect." : "Tap the subject to keep it sharp and soften the background."}</p>
            <label class="ml-slider"><span>Brush size <b data-bout="r">${editState.bokehBrush || 24}</b></span><input type="range" min="8" max="45" value="${editState.bokehBrush || 24}" data-ml-bslider="r"/></label>
            ${bSpots.length ? `<label class="ml-slider"><span>Background blur <b data-bout="strength">${editState.bokeh.strength}</b></span><input type="range" min="4" max="32" value="${editState.bokeh.strength}" data-ml-bslider="strength"/></label>` : ""}
            <div class="ml-chips"><button data-ml-bokeh-pick class="${mlBokehPicking ? "is-on" : ""}">${svgIc("spark")} ${mlBokehPicking ? "Done" : "Choose subject"}</button>${bSpots.length ? `<button data-ml-bokeh-off>Clear</button>` : ""}</div>
          </div>
        </details>
        <details class="ml-edit-section">
          <summary><span>Text</span><b>${editState.text ? "Added" : "Optional"}</b></summary>
          <div class="ml-edit-section-body"><input class="ml-text-in" data-ml-text placeholder="Add a headline…" value="${esc(editState.text)}"/></div>
        </details>
        <details class="ml-edit-section">
          <summary><span>Ask Phantom to edit</span><b>${svgIc("spark")}</b></summary>
          <div class="ml-edit-section-body"><p class="ml-hint">Describe a look, like “brighter product photo” or “moody night.”</p><div class="ml-prompt-wrap"><input class="ml-text-in" data-ml-aiedit placeholder="Describe the change…"/><button class="ml-enhance" data-ml-runai>Apply</button></div></div>
        </details>
        <div class="ml-editor-actions">
          <button class="ml-generate" data-ml-savedit>${svgIc("check")} Save to library</button>
          <button class="ml-generate ml-ghost" data-ml-layeredit>Open layer editor</button>
          <button class="ml-generate ml-ghost" data-ml-dledit>${svgIc("upload")} Download</button>
          <button class="ml-link" data-ml-resetedit>Reset</button>
          <button class="ml-link" data-ml-changeedit>Change image</button>
        </div>
      </div>
    </div>`;
  const canvas = body.querySelector("[data-ml-canvas]");
  const markerLayer = body.querySelector("[data-ml-bokeh-markers]");
  const repaint = () => { if (canvas._img) { paintEdit(canvas, canvas._img, editState); positionMarkers(); } };
  const positionMarkers = () => {
    if (!markerLayer) return;
    const spots = editState.bokeh?.spots || [];
    markerLayer.innerHTML = spots.map(() => `<div class="ch-lb-bokeh-marker"></div>`).join("");
    [...markerLayer.children].forEach((el, i) => {
      el.style.left = `${canvas.offsetLeft + spots[i].x * canvas.offsetWidth}px`;
      el.style.top = `${canvas.offsetTop + spots[i].y * canvas.offsetHeight}px`;
    });
  };
  if (mlBokehPicking) canvas.classList.add("is-picking");
  const pickHint = body.querySelector("[data-ml-pick-hint]");
  if (pickHint) pickHint.hidden = !mlBokehPicking;
  // loadImageForEditing (not a raw new Image()) — a cross-origin source drawn
  // straight onto the canvas taints it, and every later toDataURL()/save then
  // throws with no visible error. Routes anything not same-origin through our
  // own backend proxy instead.
  if (session.edit.url !== editState.loadedUrl || !canvas._img) {
    const targetUrl = session.edit.url;
    loadImageForEditing(targetUrl)
      .then((img) => {
        if (session.edit?.url !== targetUrl) return; // user picked a different image while this was loading
        mlEditLoadError = null;
        editState.loadedUrl = targetUrl;
        paintEdit(canvas, img, editState);
        positionMarkers();
      })
      .catch((error) => {
        if (session.edit?.url !== targetUrl) return;
        mlEditLoadError = error.message || "Could not load this image for editing — the source is on another host and the backend proxy couldn't reach it either.";
        renderMediaStudio(root, opts);
      });
  }
  if (mlEditResizeHandler) window.removeEventListener("resize", mlEditResizeHandler);
  mlEditResizeHandler = () => positionMarkers();
  window.addEventListener("resize", mlEditResizeHandler);
  // wire tools
  body.querySelector("[data-ml-tutorial]")?.addEventListener("click", () => { mlShowTutorial = !mlShowTutorial; renderMediaStudio(root, opts); });
  body.querySelector("[data-ml-undo]")?.addEventListener("click", () => { if (!mlEditHistory.length) return; mlEditFuture.push(cloneEditState()); restoreEdit(mlEditHistory.pop()); renderMediaStudio(root, opts); });
  body.querySelector("[data-ml-redo]")?.addEventListener("click", () => { if (!mlEditFuture.length) return; mlEditHistory.push(cloneEditState()); restoreEdit(mlEditFuture.pop()); renderMediaStudio(root, opts); });
  const before = body.querySelector("[data-ml-before]");
  const showBefore = () => { if (canvas._img) paintEdit(canvas, canvas._img, { ...freshEditState(), loadedUrl: editState.loadedUrl }); };
  if (before) {
    before.onpointerdown = (event) => { event.preventDefault(); showBefore(); before.classList.add("is-on"); };
    before.onpointerup = before.onpointercancel = before.onpointerleave = () => { before.classList.remove("is-on"); repaint(); };
  }
  body.querySelectorAll("[data-ml-crop-presets] button").forEach((button) => button.onclick = () => {
    rememberEdit();
    editState.crop = { aspect: button.dataset.aspect || "original", x: 0.5, y: 0.5, zoom: 1 };
    renderMediaStudio(root, opts);
  });
  body.querySelectorAll("[data-ml-crop-slider]").forEach((slider) => {
    slider.onpointerdown = () => rememberEdit();
    slider.oninput = () => {
      const key = slider.dataset.mlCropSlider;
      editState.crop[key] = key === "zoom" ? (+slider.value / 100) : (+slider.value / 100);
      repaint();
      const out = body.querySelector(`[data-crop-out="${key}"]`);
      if (out) out.textContent = key === "zoom" ? `${slider.value}%` : slider.value;
    };
  });
  body.querySelector("[data-ml-autoframe]")?.addEventListener("click", () => {
    if (!canvas._img) return;
    rememberEdit();
    const original = document.createElement("canvas");
    paintEdit(original, canvas._img, { ...freshEditState(), loadedUrl: editState.loadedUrl });
    const focus = estimateSubjectPoint(original) || { x: 0.5, y: 0.45 };
    editState.crop.x = focus.x;
    editState.crop.y = focus.y;
    editState.crop.zoom = Math.max(1.08, editState.crop.zoom || 1);
    renderMediaStudio(root, opts);
  });
  body.querySelector("[data-ml-clean]")?.addEventListener("click", () => {
    rememberEdit();
    Object.assign(editState, { brightness: 103, contrast: 108, saturate: 108, hue: 0, blur: 0 });
    syncSliders(body); repaint();
    if (opts.notify) opts.notify("Media Lab", "Cleaned up light and color.");
  });
  body.querySelector("[data-ml-rembg]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!canvas._img) return;
    button.disabled = true; button.textContent = "Removing…";
    const exported = await exportCanvas(canvas, (img) => { canvas._img = img; repaint(); }, "image/png");
    const result = exported.ok ? await requestRemoveBackground(exported.url) : { ok: false, message: exported.error };
    if (result.ok) {
      rememberEdit();
      session.edit = { ...session.edit, url: result.image };
      editState = { ...freshEditState(), loadedUrl: null };
      if (opts.notify) opts.notify("Media Lab", "Background removed.");
      renderMediaStudio(root, opts);
      return;
    }
    button.disabled = false; button.textContent = "Remove background";
    if (opts.notify) opts.notify("Media Lab", result.message || "Background removal is not connected.");
  });
  body.querySelectorAll("[data-ml-slider]").forEach((s) => { s.onpointerdown = () => rememberEdit(); s.oninput = () => { editState[s.dataset.mlSlider] = +s.value; repaint(); const o = body.querySelector(`[data-out="${s.dataset.mlSlider}"]`); if (o) o.textContent = s.value; }; });
  body.querySelectorAll("[data-ml-rot]").forEach((b) => b.onclick = () => { rememberEdit(); editState.rotate = (editState.rotate + (+b.dataset.mlRot) + 360) % 360; repaint(); });
  const flip = body.querySelector("[data-ml-flip]"); if (flip) flip.onclick = () => { rememberEdit(); editState.flip = !editState.flip; flip.classList.toggle("is-on"); repaint(); };
  body.querySelectorAll("[data-ml-filter] button").forEach((b) => b.onclick = () => { rememberEdit(); applyFilterPreset(b.dataset.v, editState); syncSliders(body); repaint(); });
  const tin = body.querySelector("[data-ml-text]"); if (tin) { tin.onfocus = () => rememberEdit(); tin.oninput = () => { editState.text = tin.value; repaint(); }; }
  body.querySelectorAll("[data-ml-bokeh-pick]").forEach((b) => b.onclick = () => { mlBokehPicking = !mlBokehPicking; renderMediaStudio(root, opts); });
  const bokehOff = body.querySelector("[data-ml-bokeh-off]");
  if (bokehOff) bokehOff.onclick = () => { rememberEdit(); editState.bokeh = null; repaint(); renderMediaStudio(root, opts); };
  body.querySelectorAll("[data-ml-bslider]").forEach((s) => s.oninput = () => {
    const key = s.dataset.mlBslider;
    if (key === "r") { editState.bokehBrush = +s.value; }
    else if (editState.bokeh) { editState.bokeh.strength = +s.value; if (canvas._img) paintEdit(canvas, canvas._img, editState); }
    const o = body.querySelector(`[data-bout="${key}"]`);
    if (o) o.textContent = s.value;
  });
  canvas.onclick = (event) => {
    if (!mlBokehPicking) return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    rememberEdit(); addBokehSpot(editState, x, y, (editState.bokehBrush || 24) / 100);
    if (canvas._img) paintEdit(canvas, canvas._img, editState);
    renderMediaStudio(root, opts);
  };
  canvas.oncontextmenu = (event) => {
    if (!editState.bokeh?.spots?.length) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    rememberEdit(); if (removeBokehSpotNear(editState, x, y)) { repaint(); renderMediaStudio(root, opts); }
  };
  const runai = body.querySelector("[data-ml-runai]");
  if (runai) runai.onclick = async () => {
    const q = body.querySelector("[data-ml-aiedit]").value || "";
    runai.disabled = true; runai.textContent = "…";
    // local heuristic "AI edit" preview (real backend routes to provider edit)
    rememberEdit(); heuristicAiEdit(q, editState);
    syncSliders(body); if (canvas._img) paintEdit(canvas, canvas._img, editState);
    runai.disabled = false; runai.textContent = "Apply";
    if (opts.notify) opts.notify("Media Factory", `applied an AI edit: "${q.slice(0, 30)}".`);
  };
  body.querySelector("[data-ml-resetedit]").onclick = () => { resetEdit(); renderMediaStudio(root, opts); };
  body.querySelector("[data-ml-changeedit]").onclick = () => { session.edit = null; mlBokehPicking = false; renderMediaStudio(root, opts); };
  const repaintWithImg = (img) => { canvas._img = img; paintEdit(canvas, img, editState); positionMarkers(); };
  body.querySelector("[data-ml-savedit]").onclick = async () => {
    const exported = await exportCanvas(canvas, repaintWithImg, "image/webp", 0.9);
    if (!exported.ok) { if (opts.notify) opts.notify("Media Factory", `Couldn't save this edit: ${exported.error}`); return; }
    const at = Date.now();
    const asset = { id: `edit-${at}`, type: "image", url: exported.url, saved: true, at, meta: { edited: true, prompt: editState.text || "Edited image" } };
    session.assets.unshift(asset);
    captureForContentHub(asset, { title: "Edited image", prompt: editState.text || "Edited image" });
    // switch tab (and its rerender) before notify(): notify() triggers a global store-change
    // listener that can fully remount this page, invalidating this closure's stale DOM/root —
    // landing the tab switch on live DOM first avoids it getting silently overwritten.
    session.tab = "library";
    renderMediaStudio(root, opts);
    if (opts.notify) opts.notify("Media Factory", "saved an edited image to the library.");
  };
  body.querySelector("[data-ml-dledit]").onclick = async () => {
    const exported = await exportCanvas(canvas, repaintWithImg, "image/webp", 0.92);
    if (!exported.ok) { if (opts.notify) opts.notify("Media Factory", `Couldn't download this edit: ${exported.error}`); return; }
    downloadAsset({ url: exported.url, type: "image", id: "edit" });
  };
  body.querySelector("[data-ml-layeredit]")?.addEventListener("click", async () => {
    if (!canvas._img) return;
    const exported = await exportCanvas(canvas, repaintWithImg, "image/webp", 0.9);
    if (!exported.ok) { if (opts.notify) opts.notify("Media Factory", `Couldn't open the layer editor: ${exported.error}`); return; }
    const at = Date.now();
    const title = editState.text ? `Layer edit - ${editState.text.slice(0, 36)}` : "Layer edit draft";
    const result = registerContentAsset({
      id: `layer-edit-${at}`,
      type: "image",
      title,
      prompt: editState.text || "Opened from Media Lab quick editor.",
      source: "Media Lab quick editor",
      url: exported.url,
      createdAt: at,
      saved: true,
    }, { skipSync: true });
    try {
      workspaceStorageSetItem(CONTENT_HUB_OPEN_TAB_KEY, "library");
      workspaceStorageSetItem(CONTENT_HUB_OPEN_ASSET_KEY, result.asset.id);
    } catch {}
    if (opts.notify) opts.notify("Media Factory", "Opened the current edit in Creator Hub's layer editor. Nothing was posted.");
    opts.openWorkspace?.("content");
  });
}
function slider(label, key, min, max, val) {
  return `<label class="ml-slider"><span>${label} <b data-out="${key}">${val}</b></span>
    <input type="range" min="${min}" max="${max}" value="${val}" data-ml-slider="${key}"/></label>`;
}
function cropSlider(label, key, min, max, val, suffix) {
  return `<label class="ml-slider"><span>${label} <b data-crop-out="${key}">${val}${suffix}</b></span><input type="range" min="${min}" max="${max}" value="${val}" data-ml-crop-slider="${key}"/></label>`;
}
function tutorialMarkup() {
  const rows = [
    ["Crop first", "Pick Original, Square, Post, Story, or Wide. Center on subject finds a useful starting point, then Zoom and position finish the frame."],
    ["Fix it fast", "Clean up balances light and color. Remove background uses the connected local media engine when it is available."],
    ["Check your work", "Hold Before to compare with the original. Undo and redo are always above the image."],
    ["Go deeper only when needed", "Open Quick looks, Fine tune, Focus blur, Text, or Ask Phantom. Closed sections stay out of your way."],
    ["Keep the result", "Save to library keeps the edit inside PhantomForce. Download saves a WebP copy to your device."],
  ];
  return `
    <div class="ch-lb-tutorial">
      ${rows.map(([t, d]) => `<div class="ch-lb-tutorial-row"><b>${t}</b><span>${d}</span></div>`).join("")}
    </div>`;
}
function syncSliders(body) { ["brightness", "contrast", "saturate", "hue", "blur"].forEach((k) => { const s = body.querySelector(`[data-ml-slider="${k}"]`); if (s) s.value = editState[k]; const o = body.querySelector(`[data-out="${k}"]`); if (o) o.textContent = editState[k]; }); }
function resetEdit() { editState = { ...freshEditState(), loadedUrl: editState.loadedUrl }; mlBokehPicking = false; mlEditLoadError = null; mlEditHistory = []; mlEditFuture = []; }

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
/* Backend engine identity (Python command, connection lane, raw health) is
   owner-only surface area — it lives exclusively in the Developer tab
   (main.js buildDevPrograms). This tab never re-exposes it. */

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
        <p class="set-note">Media Lab keeps generation inside PhantomForce. Pick the default lanes, set approval behavior, and let PhantomForce handle the routing behind the curtain.</p>
        <div class="set-rembg-rows">
          <div class="set-rembg-row"><span>Production credits</span><b>${esc(String(cfg.credits))}</b></div>
          <div class="set-rembg-row"><span>Default quality</span><b>${esc(genState.quality === "high" ? "High" : "Standard")}</b></div>
        </div>
        <div class="set-routes">
          ${routeRow("image", "Image engine")}
          ${routeRow("video", "Video engine")}
          ${routeRow("enhance", "Prompt intelligence")}
        </div>
        <div class="ml-seg ml-seg-sm set-quality-toggle" data-set-quality>
          <button class="${genState.quality === "standard" ? "is-on" : ""}" data-v="standard">Standard</button>
          <button class="${genState.quality === "high" ? "is-on" : ""}" data-v="high">High</button>
        </div>
        <label class="set-inline"><input type="checkbox" data-set-approval ${cfg.requireApproval ? "checked" : ""}/> Require approval before paid generation</label>
      </div>

      <div class="set-section set-social-section">
        <div class="set-sec-head">
          <div>
            <h3>Social profiles</h3>
            <p class="set-note">Save the public profiles your business uses. A saved profile is not API authorization; real performance appears in Analytics after an authorized feed or platform report is added.</p>
          </div>
          <span class="set-safe-pill">${linkedCount}/${socialAccounts.length} saved</span>
        </div>
        ${socialNotice ? `<div class="set-social-notice">${esc(socialNotice)}</div>` : ""}
        <div class="set-social-grid">
          ${socialAccounts.map((account) => socialCard(account, esc)).join("")}
        </div>
      </div>
    </div>`;

  // routing
  el.querySelectorAll("[data-route]").forEach((s) => s.onchange = () => { cfg.routing[s.dataset.route] = s.value; saveCfg(cfg); });
  el.querySelectorAll("[data-set-quality] button").forEach((b) => b.onclick = () => { genState.quality = b.dataset.v || "standard"; renderMediaSettings(el, opts); });
  const ap = el.querySelector("[data-set-approval]"); ap.onchange = () => { cfg.requireApproval = ap.checked; saveCfg(cfg); };

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
      socialNotice = `${account.name} opened. Come back and save the public handle or profile URL.`;
      startSocialBridgePolling(account.id);
      saveAndRender();
    };
    const confirmForm = card.querySelector("[data-social-confirm-form]");
    if (confirmForm) confirmForm.onsubmit = (event) => {
      event.preventDefault();
      const input = confirmForm.querySelector("[data-social-confirm-input]");
      const value = input?.value.trim();
      if (!value) return;
      account.handle = cleanSocialHandle(value);
      account.url = normalizeSocialUrl(value) || socialProfileFromHandle(account.id, account.handle);
      account.enabled = true;
      account.connectMode = "manual-confirmed";
      account.lastConnectAt = new Date().toISOString();
      delete account.hermesProof;
      if (socialBridgePollTimer) { clearInterval(socialBridgePollTimer); socialBridgePollTimer = 0; }
      socialNotice = `${account.name} profile saved. No API authorization or analytics feed was created.`;
      saveAndRender();
    };
  });

}

function socialCard(account, esc) {
  const status = socialStatus(account);
  const profile = socialProfileTarget(account);
  const lastConnect = status === "linked"
    ? (profile ? `Saved profile: ${profile}` : "Profile saved locally")
    : status === "pending"
      ? "Confirm your handle below once you're signed in, or clear this to start over."
      : "Save a public handle or profile URL";
  const hermesProof = account.hermesProof
    ? `<div class="set-social-hermes-proof">${svgIc("spark")} Saved profile · ${esc(account.hermesProof.displayName || account.hermesProof.handle || account.name)}</div>`
    : "";
  return `<article class="set-social-card is-${status}" data-social-card="${account.id}">
    <button class="set-card-x" data-social-clear aria-label="Clear ${esc(account.name)} link" title="Clear ${esc(account.name)} link" type="button">×</button>
    <div class="set-social-top">
      <span class="set-social-dot" style="background:${account.color}"></span>
      <span><b>${esc(account.name)}</b><i>${esc(socialStatusLabel(account))}</i></span>
    </div>
    <div class="set-social-connect-state">
      <span>Analytics status</span>
      <b>${esc(socialPostingState(account))}</b>
    </div>
    ${hermesProof}
    <div class="set-social-actions">
      <button class="set-social-open set-social-action set-social-signin" data-social-open type="button">${esc(socialActionLabel(account))}</button>
      <span>${esc(lastConnect)}</span>
    </div>
    ${status === "pending" ? `
    <form class="set-social-confirm" data-social-confirm-form>
      <label>Handle or profile URL</label>
      <div class="set-social-confirm-row">
        <input type="text" data-social-confirm-input placeholder="@yourhandle or https://..." value="${esc(account.handle || account.url || "")}"/>
        <button class="btn btn-primary" type="submit">Save profile</button>
      </div>
    </form>` : ""}
  </article>`;
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
    expand: `<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>`,
    collapse: `<path d="M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3"/>`,
    hub: `<circle cx="8" cy="3.6" r="1.5"/><circle cx="3.6" cy="11.4" r="1.5"/><circle cx="12.4" cy="11.4" r="1.5"/><path d="M8 5.1v3.4M8 8.5l-3.7 2M8 8.5l3.7 2"/>`,
    download: `<path d="M8 3v7.5M5.2 8l2.8 2.8L10.8 8M4 13.5h8"/>`,
    target: `<circle cx="8" cy="8" r="5.3"/><circle cx="8" cy="8" r="1.7"/>`,
    grid: `<rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1"/><rect x="9" y="2.4" width="4.6" height="4.6" rx="1"/><rect x="2.4" y="9" width="4.6" height="4.6" rx="1"/><rect x="9" y="9" width="4.6" height="4.6" rx="1"/>`,
    clock: `<circle cx="8" cy="8" r="5.3"/><path d="M8 5.2v3.1l2.1 1.2"/>`,
    layout: `<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.6"/><path d="M2.4 6.6h11.2M6.4 6.6v7"/>`,
    cpu: `<rect x="5" y="5" width="6" height="6" rx="1"/><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M5.1 5.1L3.8 3.8M10.9 5.1l1.3-1.3M5.1 10.9l-1.3 1.3M10.9 10.9l1.3 1.3"/>`,
    gear: `<circle cx="8" cy="8" r="2.2"/><path d="M8 2.8v1.5M8 11.7v1.5M2.8 8h1.5M11.7 8h1.5M4.5 4.5l1.1 1.1M10.4 10.4l1.1 1.1M11.5 4.5l-1.1 1.1M5.6 10.4l-1.1 1.1"/>`,
    close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}
