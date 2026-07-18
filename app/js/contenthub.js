/* PhantomForce — Creator Hub: ideas, drafts, publishing, and planning for
   turning Media Lab assets or local uploads into real post records.

   It owns a normalized content dataset (seeded once, persisted) and exposes a
   clean data API — loadContent() / analyze() — so the Analytics view (and
   anything else) can fetch the same numbers with zero coupling. */

import {
  freshEditState, applyFilterPreset, renderBaseFrame,
  addBokehSpot, removeBokehSpotNear, removeBokehSpotAt, nearestBokehSpot, moveBokehSpot, resizeBokehSpot,
  setBokehMask, freshTextStyle, TEXT_FONTS, TEXT_PRESETS, applyTextPreset,
} from "./imagefilters.js?v=phantom-live-20260718-31";
import { getRembgStatus, requestRemoveBackground, probeAiEditBackend, requestAiEdit, loadImageForEditing, loadImage, exportCanvas, syncAssetUpload, listSyncedAssets, fetchSyncedAssetFile } from "./mediabackend.js?v=phantom-live-20260718-31";
import { addCustomDailyIdea, dailyIdeaState, refreshDailyIdeas, saveIdeaForLater } from "./content-ideas.js?v=phantom-live-20260718-31";
import { parseAnalyticsReport } from "./social-analytics.js?v=phantom-live-20260718-31";
import {
  freshComposition, compositionSnapshot, restoreComposition, addImageLayer, replaceImageLayerSource, addTextLayer, addColorLayer,
  duplicateLayer, removeSelectedLayers, moveLayerOrder, selectedLayers, selectLayer, selectAllLayers,
  loadCompositionImages, renderComposition, drawCompositionOverlay, drawDetectedSubjectOverlay, canvasPoint, hitTestLayer, hitTestResizeHandle,
  setCanvasPreset, zoomComposition, canvasPointToLayer, layerPointToCanvas,
  imageEditSnapshot, restoreImageEditSnapshot, pushEditorSnapshot,
} from "./content-editor.js?v=phantom-live-20260718-31";
import {
  currentTenantId, currentWs, ctx, session, store, visible, workspaceStorageGetItem, workspaceStorageRemoveItem, workspaceStorageSetItem, wsName,
} from "./store.js?v=phantom-live-20260718-31";

const CH_KEY = "pf.contenthub.v2";
const CH_REMOVED_KEY = "pf.contenthub.removed.v1";
const CH_ASSETS_KEY = "pf.contenthub.assets.v1";
const CH_ASSET_RECYCLE_KEY = "pf.contenthub.assets.recycle.v1";
const CH_MEDIA_EDIT_INTENT_KEY = "pf.medialab.editIntent.v1";
const CH_OPEN_TAB_KEY = "pf.contenthub.openTab.v1";
const CH_OPEN_ASSET_KEY = "pf.contenthub.openAsset.v1";
const CH_PUBLISH_STATE_KEY = "pf.contenthub.publish.state.v1";
const CH_PUBLISH_DRAFTS_KEY = "pf.contenthub.publish.drafts.v1";
const CH_PLANNER_ITEMS_KEY = "pf.contenthub.planner.items.v1";
const DAY = 864e5;
export const CONTENT_ASSET_LIMITS = Object.freeze({
  retentionDays: 30,
  maxItems: 30,
  budgetBytes: 8000000,
  maxInlineChars: 2400000,
});

export const PLATFORMS = [
  { id: "instagram", name: "Instagram", color: "#e1306c", handle: "officialchicagoshots", types: ["image", "carousel", "reel", "story"] },
  { id: "tiktok",    name: "TikTok",    color: "#ff2b55", handle: "officialchicagoshots", types: ["short", "video"] },
  { id: "youtube",   name: "YouTube",   color: "#ff3b30", handle: "officialchicagoshots", types: ["video", "short"] },
  { id: "facebook",  name: "Facebook",  color: "#1877f2", handle: "officialchicagoshots", types: ["image", "video", "text", "carousel"] },
  { id: "x",         name: "X",         color: "#9fb0bd", handle: "officialchicagoshots", types: ["text", "image", "video"] },
  { id: "linkedin",  name: "LinkedIn",  color: "#3b9dff", handle: "officialchicagoshots", types: ["text", "image", "article"] },
  { id: "pinterest", name: "Pinterest", color: "#e60023", handle: "officialchicagoshots", types: ["image", "carousel"] },
];
export const TYPES = { image: "Image", carousel: "Carousel", reel: "Reel", short: "Short", video: "Video", story: "Story", text: "Post", article: "Article" };
const plat = (id) => PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
const isVideo = (t) => ["reel", "short", "video"].includes(t);

/* ---------------- social profiles (shared with Media Lab settings) ----------------
   A saved profile is a public identity reference, not API authorization. Analytics
   renders only imported or adapter-provided metrics and never invents numbers. */
const SOCIAL_KEY = "pf.social.accounts.v1";
const PUBLISH_PRESETS = [
  { id: "enabled", name: "Enabled", hint: "saved profiles", platforms: null },
  { id: "all", name: "Post everywhere", hint: "every channel", platforms: PLATFORMS.map((p) => p.id) },
  { id: "short-form", name: "Short-form", hint: "reels, shorts, TikTok", platforms: ["instagram", "tiktok", "youtube"] },
  { id: "business", name: "Business", hint: "LinkedIn, Facebook, X", platforms: ["linkedin", "facebook", "x"] },
  { id: "visual", name: "Visual push", hint: "IG, Pinterest, Facebook", platforms: ["instagram", "pinterest", "facebook"] },
];
const PUBLISH_FORMATS = [
  ["auto", "Auto-fit"],
  ["image", "Image"],
  ["carousel", "Carousel"],
  ["video", "Video"],
  ["reel", "Reel"],
  ["short", "Short"],
  ["story", "Story"],
  ["text", "Text post"],
];
const PUBLISH_TONES = [
  ["clean", "Clean"],
  ["hype", "Hype"],
  ["coach", "Coach"],
  ["premium", "Premium"],
  ["local", "Local"],
];
const PLANNER_CONNECTORS = [
  { id: "gmail", group: "Email", name: "Gmail", method: "Google OAuth", capability: "Inbox, drafts, replies", guide: "https://support.google.com/accounts/answer/3466521" },
  { id: "outlook-mail", group: "Email", name: "Outlook", method: "Microsoft OAuth", capability: "Inbox, drafts, replies", guide: "https://account.live.com/consent/Manage" },
  { id: "proton-mail", group: "Email", name: "Proton Mail", method: "Proton Mail Bridge", capability: "Desktop Bridge connection", guide: "https://proton.me/mail/bridge" },
  { id: "other-mail", group: "Email", name: "Other email", method: "OAuth or IMAP/SMTP adapter", capability: "Provider-specific setup", guide: "" },
  { id: "google-calendar", group: "Calendar", name: "Google Calendar", method: "Google OAuth", capability: "Events, availability, reminders", guide: "https://support.google.com/calendar/answer/37648" },
  { id: "outlook-calendar", group: "Calendar", name: "Outlook Calendar", method: "Microsoft OAuth", capability: "Events, availability, reminders", guide: "https://support.microsoft.com/outlook" },
  { id: "calendly", group: "Calendar", name: "Calendly", method: "Calendly integration", capability: "Bookings and event types", guide: "https://calendly.com/integrations" },
  { id: "icloud-calendar", group: "Calendar", name: "Apple / iCloud", method: "CalDAV connector", capability: "Calendar events and availability", guide: "https://support.apple.com/102654" },
];
const plannerState = { weekOffset: 0, openConnector: "" };
function defaultSocialAccounts() {
  return PLATFORMS.map((p) => ({
    id: p.id, name: p.name, color: p.color, handle: p.handle, url: "", loginIdentity: "",
    enabled: false, connectMode: "manual", officialConnectState: "not_configured", lastConnectAt: "",
  }));
}
export function loadSocialAccounts() {
  let saved = [];
  try { saved = JSON.parse(workspaceStorageGetItem(SOCIAL_KEY) || "[]"); } catch {}
  const rows = Array.isArray(saved) ? saved : [];
  return defaultSocialAccounts().map((base) => ({ ...base, ...(rows.find((row) => row && row.id === base.id) || {}) }));
}
export function saveSocialAccounts(accounts) {
  try { workspaceStorageSetItem(SOCIAL_KEY, JSON.stringify(accounts)); } catch {}
}
export function socialStatus(account) {
  if (account.hermesProof || account.enabled) return "linked";
  if (account.lastConnectAt || account.loginIdentity) return "pending";
  return "empty";
}
function enabledPlatformIds(accounts = loadSocialAccounts()) {
  return accounts.filter((account) => socialStatus(account) !== "empty").map((account) => account.id);
}
function normalizePlatformIds(ids = [], fallback = []) {
  const valid = new Set(PLATFORMS.map((p) => p.id));
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => valid.has(id)))];
  return clean.length ? clean : (fallback.length ? fallback : ["instagram"]);
}
function defaultPublishPlatforms(accounts = loadSocialAccounts()) {
  const enabled = enabledPlatformIds(accounts);
  return enabled.length ? enabled : ["instagram", "facebook", "linkedin"];
}
function localDateTimeValue(value = Date.now() + 4 * 3600e3) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function defaultPublishState() {
  const accounts = loadSocialAccounts();
  return {
    platforms: defaultPublishPlatforms(accounts),
    sourceKey: "",
    postType: "auto",
    brief: "",
    tone: "clean",
    cta: "Book a 15-minute setup call",
    caption: "",
    scheduleAt: localDateTimeValue(),
    updatedAt: Date.now(),
  };
}
function loadPublishState() {
  let saved = {};
  try { saved = JSON.parse(workspaceStorageGetItem(CH_PUBLISH_STATE_KEY) || "{}") || {}; } catch {}
  const base = defaultPublishState();
  const merged = { ...base, ...saved };
  merged.platforms = normalizePlatformIds(merged.platforms, base.platforms);
  if (!PUBLISH_TONES.find(([id]) => id === merged.tone)) merged.tone = "clean";
  if (!PUBLISH_FORMATS.find(([id]) => id === merged.postType)) merged.postType = "auto";
  if (!merged.scheduleAt) merged.scheduleAt = localDateTimeValue();
  return merged;
}
function savePublishState(state = {}) {
  const base = defaultPublishState();
  const merged = { ...base, ...state, updatedAt: Date.now() };
  merged.platforms = normalizePlatformIds(merged.platforms, base.platforms);
  if (!PUBLISH_FORMATS.find(([id]) => id === merged.postType)) merged.postType = "auto";
  try { workspaceStorageSetItem(CH_PUBLISH_STATE_KEY, JSON.stringify(merged)); } catch {}
  return merged;
}
function loadPublishDrafts() {
  let rows = [];
  try { rows = JSON.parse(workspaceStorageGetItem(CH_PUBLISH_DRAFTS_KEY) || "[]"); } catch {}
  return (Array.isArray(rows) ? rows : []).filter(Boolean).slice(0, 50);
}
function savePublishDrafts(rows = []) {
  const clean = rows.filter(Boolean).slice(0, 50);
  try { workspaceStorageSetItem(CH_PUBLISH_DRAFTS_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}

/* ---------------- seeded generation (stable across reloads) ---------------- */
function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CAPTIONS = [
  "Your business, running while you sleep 👻", "One prompt. A whole campaign.", "Watch PhantomForce close a lead in real time",
  "The operator you couldn't afford to hire", "Before / after: an inbox on autopilot", "5 things PhantomForce did before your coffee",
  "How we turned a DM into a $2,400 booking", "The green ghost never misses a follow-up", "AI that drafts, checks risk, and ships safe work",
  "Behind the scenes: the Media Lab", "Threat watch caught this scam in 3 seconds", "From quote to paid in one thread",
  "Your calendar, booked without the back-and-forth", "Meet the phantom that runs the boring half", "We generated this ad in 11 seconds",
  "Risky sends stop for you. Safe work keeps moving.", "The dashboard that reads your whole business", "Reels that write themselves",
  "Proof: 24/7 and never tired", "Ask for an outcome, not a task",
];
const COMMENTS = [
  ["marketing_mia", "okay this is actually insane 🔥", "pos"], ["deshawn.builds", "how much is it??", "neu"],
  ["the_realtor_kate", "just signed up, wish me luck", "pos"], ["gymowner_rob", "does it do DMs on IG too?", "neu"],
  ["skeptic_sam", "seems too good to be true tbh", "neg"], ["salonbyleah", "the follow-ups alone are worth it", "pos"],
  ["local_media", "the media lab is unreal 👻", "pos"], ["frank_hvac", "finally something that just works", "pos"],
  ["nina.codes", "the privacy angle sold me", "pos"], ["coach_will", "can it post for me automatically?", "neu"],
  ["mant_detail", "booked 3 jobs this week off this", "pos"], ["quiet_lurker", "commenting so i remember this", "neu"],
];
const HASHTAGS = ["#AI", "#smallbusiness", "#automation", "#phantomforce", "#entrepreneur", "#marketing", "#solopreneur", "#contentcreation", "#business", "#productivity"];
function genPosts() {
  const rng = mulberry(20260705);
  const posts = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const p = PLATFORMS[Math.floor(rng() * PLATFORMS.length)];
    const type = p.types[Math.floor(rng() * p.types.length)];
    const daysAgo = Math.floor(rng() * 44);
    const scheduled = i < 3;                 // a few upcoming
    const publishedAt = new Date(Date.now() + (scheduled ? (1 + i) * DAY : -daysAgo * DAY)).toISOString();
    // reach scaled by platform + type virality
    const base = { instagram: 5200, tiktok: 14000, youtube: 3800, facebook: 4200, x: 2600, linkedin: 3100, pinterest: 2200 }[p.id];
    const viral = 0.4 + rng() * (isVideo(type) ? 3.4 : 1.6);
    const reach = Math.round(base * viral);
    const impressions = Math.round(reach * (1.15 + rng() * 0.5));
    const erBase = { instagram: 0.045, tiktok: 0.09, youtube: 0.05, facebook: 0.03, x: 0.025, linkedin: 0.04, pinterest: 0.02 }[p.id];
    const er = erBase * (0.6 + rng() * 1.1);
    const likes = Math.round(reach * er);
    const comments = Math.round(likes * (0.05 + rng() * 0.12));
    const shares = Math.round(likes * (0.03 + rng() * 0.14));
    const saves = Math.round(likes * (0.06 + rng() * 0.22));
    const views = isVideo(type) ? Math.round(reach * (1.4 + rng() * 2.6)) : 0;
    const watch = isVideo(type) ? Math.round(6 + rng() * 44) : 0;
    const clicks = Math.round(reach * (0.008 + rng() * 0.03));
    const followersGained = Math.round((likes + shares * 4) * (0.01 + rng() * 0.05));
    const reactions = p.id === "facebook" || p.id === "linkedin"
      ? { like: Math.round(likes * 0.62), love: Math.round(likes * 0.2), haha: Math.round(likes * 0.08), wow: Math.round(likes * 0.06), sad: Math.round(likes * 0.02), angry: Math.round(likes * 0.02) }
      : null;
    const nc = 2 + Math.floor(rng() * 4);
    const cmts = [];
    for (let k = 0; k < nc; k++) { const c = COMMENTS[Math.floor(rng() * COMMENTS.length)]; cmts.push({ user: c[0], text: c[1], sentiment: c[2], at: new Date(Date.parse(publishedAt) + Math.floor(rng() * 6) * 3600e3).toISOString(), likes: Math.floor(rng() * 40) }); }
    const tags = HASHTAGS.slice().sort(() => rng() - 0.5).slice(0, 3 + Math.floor(rng() * 3));
    const hue = Math.floor(rng() * 360);
    posts.push({
      id: `post-${i}`, platform: p.id, type, caption: CAPTIONS[i % CAPTIONS.length],
      publishedAt, status: scheduled ? "scheduled" : "published", hue,
      hashtags: tags, mentions: [],
      metrics: { reach, impressions, likes, comments, shares, saves, views, watchAvg: watch, clicks, followersGained, engagementRate: +(100 * (likes + comments + shares + saves) / Math.max(1, reach)).toFixed(1), reactions },
      comments: cmts,
    });
  }
  return posts.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/* ---------------- data API (Analytics + Hub both use this) ---------------- */
export function loadContent() {
  let saved = null;
  try { saved = JSON.parse(workspaceStorageGetItem(CH_KEY) || "null"); } catch {}
  if (saved && Array.isArray(saved.posts) && saved.posts.length) return saved;
  const data = { posts: genPosts(), updatedAt: Date.now() };
  try { workspaceStorageSetItem(CH_KEY, JSON.stringify(data)); } catch {}
  return data;
}
function saveContent(data = {}) {
  const clean = { ...data, posts: Array.isArray(data.posts) ? data.posts : [], updatedAt: Date.now() };
  try { workspaceStorageSetItem(CH_KEY, JSON.stringify(clean)); } catch {}
  return clean;
}
function dataBytes(url) {
  if (!url || typeof url !== "string") return 0;
  return url.startsWith("data:") ? url.length * 2 : Math.min(url.length * 2, 2048);
}
function assetBytes(asset) {
  const copy = { ...asset, url: asset.url ? `[${asset.url.length} chars]` : "" };
  let meta = 0;
  try { meta = JSON.stringify(copy).length * 2; } catch { meta = 512; }
  return meta + dataBytes(asset.url);
}
function normalizeContentAsset(input = {}) {
  const meta = input.meta || {};
  const createdAt = Number(input.createdAt || input.at || Date.now()) || Date.now();
  const rawType = String(input.type || input.kind || "image").toLowerCase();
  const type = isVideo(rawType) ? "video" : "image";
  let url = typeof input.url === "string" ? input.url : "";
  let trimmed = !!input.trimmed;
  if (url.startsWith("data:") && url.length > CONTENT_ASSET_LIMITS.maxInlineChars) {
    url = "";
    trimmed = true;
  }
  return {
    id: String(input.id || `media-${createdAt}-${Math.random().toString(36).slice(2, 8)}`),
    type,
    title: String(input.title || meta.title || (type === "video" ? "Generated video" : "Generated image")),
    prompt: String(input.prompt || meta.prompt || ""),
    source: String(input.source || "Media Lab"),
    provider: String(input.provider || meta.provider || ""),
    model: String(input.model || meta.model || ""),
    style: String(input.style || meta.style || ""),
    aspect: String(input.aspect || meta.aspect || ""),
    duration: Number(input.duration || meta.duration || 0) || 0,
    hue: Number(input.hue || meta.hue || 155) || 155,
    createdAt,
    expiresAt: createdAt + CONTENT_ASSET_LIMITS.retentionDays * DAY,
    url,
    trimmed,
    live: !!input.live,
    saved: !!input.saved,
    batchLabel: String(input.batchLabel || ""),
    aiEditPlan: String(input.aiEditPlan || ""),
    updatedAt: Number(input.updatedAt || 0) || 0,
    bytes: dataBytes(url),
    syncedId: String(input.syncedId || ""),
  };
}
function pruneContentAssets(items = []) {
  const cutoff = Date.now() - CONTENT_ASSET_LIMITS.retentionDays * DAY;
  const seen = new Set();
  const ordered = items
    .map(normalizeContentAsset)
    .filter((asset) => asset.createdAt >= cutoff)
    .sort((a, b) => b.createdAt - a.createdAt);
  const kept = [];
  let used = 0;
  for (const item of ordered) {
    if (seen.has(item.id) || kept.length >= CONTENT_ASSET_LIMITS.maxItems) continue;
    seen.add(item.id);
    let candidate = { ...item };
    let nextBytes = assetBytes(candidate);
    if (used + nextBytes > CONTENT_ASSET_LIMITS.budgetBytes && candidate.url) {
      candidate = { ...candidate, url: "", trimmed: true, bytes: 0 };
      nextBytes = assetBytes(candidate);
    }
    if (used + nextBytes > CONTENT_ASSET_LIMITS.budgetBytes) continue;
    used += nextBytes;
    kept.push(candidate);
  }
  return kept;
}
export function loadContentAssets() {
  let raw = null;
  try { raw = JSON.parse(workspaceStorageGetItem(CH_ASSETS_KEY) || "null"); } catch {}
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : []);
  const pruned = pruneContentAssets(list);
  if (pruned.length !== list.length) saveContentAssets(pruned);
  return pruned;
}
export function saveContentAssets(items = []) {
  let clean = pruneContentAssets(items);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      workspaceStorageSetItem(CH_ASSETS_KEY, JSON.stringify({ assets: clean, updatedAt: Date.now(), limits: CONTENT_ASSET_LIMITS }));
      return clean;
    } catch {
      const withUrl = clean.filter((asset) => asset.url);
      if (!withUrl.length) break;
      const dropId = withUrl[withUrl.length - 1].id;
      clean = clean.map((asset) => asset.id === dropId ? { ...asset, url: "", trimmed: true, bytes: 0 } : asset);
    }
  }
  return clean;
}

function normalizeRecycledContentAsset(input = {}) {
  const asset = normalizeContentAsset(input);
  const trashedAt = Number(input.trashedAt || input.deletedAt || Date.now()) || Date.now();
  return {
    ...asset,
    trashedAt,
    trashExpiresAt: trashedAt + CONTENT_ASSET_LIMITS.retentionDays * DAY,
  };
}
function pruneRecycledContentAssets(items = []) {
  const now = Date.now();
  const seen = new Set();
  return items
    .map(normalizeRecycledContentAsset)
    .filter((asset) => asset.trashExpiresAt > now)
    .sort((a, b) => b.trashedAt - a.trashedAt)
    .filter((asset) => {
      if (seen.has(asset.id)) return false;
      seen.add(asset.id);
      return true;
    })
    .slice(0, CONTENT_ASSET_LIMITS.maxItems * 2);
}
export function loadRecycledContentAssets() {
  let raw = null;
  try { raw = JSON.parse(workspaceStorageGetItem(CH_ASSET_RECYCLE_KEY) || "null"); } catch {}
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : []);
  const pruned = pruneRecycledContentAssets(list);
  if (pruned.length !== list.length) saveRecycledContentAssets(pruned);
  return pruned;
}
export function saveRecycledContentAssets(items = []) {
  const clean = pruneRecycledContentAssets(items);
  try {
    workspaceStorageSetItem(CH_ASSET_RECYCLE_KEY, JSON.stringify({
      assets: clean,
      updatedAt: Date.now(),
      retentionDays: CONTENT_ASSET_LIMITS.retentionDays,
    }));
  } catch {}
  return clean;
}
export function recycleContentAssets(assets = []) {
  const list = Array.isArray(assets) ? assets : [assets];
  const normalized = list.filter(Boolean).map((asset) => normalizeRecycledContentAsset({ ...asset, trashedAt: Date.now() }));
  if (!normalized.length) return { recycled: [], active: loadContentAssets(), bin: loadRecycledContentAssets() };
  const ids = new Set(normalized.map((asset) => asset.id));
  const active = saveContentAssets(loadContentAssets().filter((asset) => !ids.has(asset.id)));
  const bin = saveRecycledContentAssets([
    ...normalized,
    ...loadRecycledContentAssets().filter((asset) => !ids.has(asset.id)),
  ]);
  return { recycled: normalized, active, bin };
}
export function restoreRecycledContentAssets(ids = []) {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const bin = loadRecycledContentAssets();
  const restored = bin.filter((asset) => wanted.has(asset.id));
  if (!restored.length) return [];
  const current = loadContentAssets();
  const restoredAt = Date.now();
  saveContentAssets([
    ...restored.map(({ trashedAt, trashExpiresAt, ...asset }) => ({
      ...asset,
      createdAt: restoredAt,
      expiresAt: restoredAt + CONTENT_ASSET_LIMITS.retentionDays * DAY,
      updatedAt: restoredAt,
    })),
    ...current.filter((asset) => !wanted.has(asset.id)),
  ]);
  saveRecycledContentAssets(bin.filter((asset) => !wanted.has(asset.id)));
  return restored;
}
export function purgeRecycledContentAssets(ids = []) {
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const bin = loadRecycledContentAssets();
  const kept = wanted.size ? bin.filter((asset) => !wanted.has(asset.id)) : [];
  saveRecycledContentAssets(kept);
  return bin.length - kept.length;
}
/* In-memory bridge for oversized media: the persisted copy drops data URLs
   over the inline budget, so previews for those assets come from this cache
   (seeded at save time) or get re-fetched from the sync backend on demand.
   Without this, a big render "saves" but can never be seen again. */
const contentAssetUrlCache = new Map();
export function contentAssetDisplayUrl(asset) {
  if (!asset) return "";
  return asset.url || contentAssetUrlCache.get(asset.id) || "";
}
export async function hydrateContentAssetUrl(asset) {
  const known = contentAssetDisplayUrl(asset);
  if (known || !asset?.syncedId) return known;
  const result = await fetchSyncedAssetFile(asset.syncedId);
  if (result.ok && result.dataUrl) {
    contentAssetUrlCache.set(asset.id, result.dataUrl);
    return result.dataUrl;
  }
  return "";
}

export function registerContentAsset(asset, options = {}) {
  const normalized = normalizeContentAsset(asset);
  const current = loadContentAssets().filter((item) => item.id !== normalized.id);
  const saved = saveContentAssets([normalized, ...current]);
  const finalAsset = saved.find((item) => item.id === normalized.id) || normalized;
  /* Sync from the ORIGINAL url, not the stored one — normalization trims
     oversized data URLs to "", so the biggest renders were never backed up
     and their previews were unrecoverable. */
  const originalUrl = typeof asset.url === "string" && asset.url.startsWith("data:") ? asset.url : "";
  if (originalUrl && !finalAsset.url) contentAssetUrlCache.set(finalAsset.id, originalUrl);
  const uploadUrl = finalAsset.url && finalAsset.url.startsWith("data:") ? finalAsset.url : originalUrl;
  if (!options.skipSync && !finalAsset.syncedId && uploadUrl) {
    queueAssetSync(finalAsset.id, uploadUrl);
  }
  return { asset: finalAsset, stats: contentAssetStats(saved) };
}

/* ---------------- cross-device sync (backs up to the real server) ----------------
   Fire-and-forget: a new/edited photo saves locally first (instant, works
   offline), then quietly backs up to the Fastify server so the same photo
   becomes editable from any other device logged into the same account.
   Failures are silent here by design — the local save already succeeded,
   and syncing is a best-effort convenience, not a requirement to keep
   working. syncedId marks an asset as already backed up so it's never
   re-uploaded on every re-render. */
async function queueAssetSync(assetId, urlOverride = "") {
  const asset = loadContentAssets().find((item) => item.id === assetId);
  const uploadUrl = (asset?.url && asset.url.startsWith("data:") ? asset.url : "") || urlOverride;
  if (!asset || asset.syncedId || !uploadUrl || !uploadUrl.startsWith("data:")) return;
  const result = await syncAssetUpload(uploadUrl, asset.title);
  if (!result.ok) return;
  const fresh = loadContentAssets();
  const target = fresh.find((item) => item.id === assetId);
  if (!target) return; // deleted locally while the upload was in flight
  saveContentAssets(fresh.map((item) => item.id === assetId ? { ...item, syncedId: result.asset.id } : item));
}

let assetPullState = { tenant: "", pulled: false, pulling: false };
let chRenderedTenant = "";
function syncCreatorTenant() {
  const tenant = currentTenantId();
  if (chRenderedTenant && chRenderedTenant !== tenant) {
    chSelection.clear();
    chLightbox = null;
    chSelectAnchor = null;
    chLastDeleted = null;
    if (chLbKeyHandler) { document.removeEventListener("keydown", chLbKeyHandler); chLbKeyHandler = null; }
    if (chLibraryKeyHandler) { document.removeEventListener("keydown", chLibraryKeyHandler); chLibraryKeyHandler = null; }
    chState.tab = "publish";
    chState.platform = "all";
    chState.ctype = "all";
    chState.eng = "likes";
  }
  chRenderedTenant = tenant;
}

/* Runs once per Content Hub mount: pulls the list of server-synced assets
   and merges in any this device doesn't have locally yet (registered with
   skipSync so pulling never triggers a re-upload right back to the
   server). This is what makes a photo edited on one device show up on
   another — same account, same synced pool. */
async function pullSyncedAssetsOnce(el, opts) {
  const tenant = currentTenantId();
  if (assetPullState.tenant !== tenant) assetPullState = { tenant, pulled: false, pulling: false };
  if (assetPullState.pulled || assetPullState.pulling) return;
  assetPullState.pulling = true;
  const listResult = await listSyncedAssets();
  if (!listResult.ok) { assetPullState.pulling = false; assetPullState.pulled = true; return; }

  const known = new Set(loadContentAssets().map((item) => item.syncedId).filter(Boolean));
  const missing = listResult.assets.filter((remote) => !known.has(remote.id));
  let mergedAny = false;

  for (const remote of missing) {
    const fileResult = await fetchSyncedAssetFile(remote.id);
    if (!fileResult.ok) continue;
    registerContentAsset({
      id: `synced-${remote.id}`,
      type: remote.mime_type.startsWith("video/") ? "video" : "image",
      title: remote.original_name.replace(/\.[^.]+$/, "") || "Synced photo",
      prompt: "Synced from another device.",
      source: "Cross-device sync",
      url: fileResult.dataUrl,
      createdAt: Date.parse(remote.created_at) || Date.now(),
      saved: true,
      syncedId: remote.id,
    }, { skipSync: true });
    mergedAny = true;
  }

  assetPullState.pulling = false;
  assetPullState.pulled = true;
  if (mergedAny && document.body.contains(el)) renderContentHub(el, opts);
}
export function contentAssetStats(items = loadContentAssets()) {
  const bytes = items.reduce((sum, asset) => sum + assetBytes(asset), 0);
  return {
    count: items.length,
    bytes,
    budgetBytes: CONTENT_ASSET_LIMITS.budgetBytes,
    percent: Math.min(100, Math.round((bytes / CONTENT_ASSET_LIMITS.budgetBytes) * 100)),
    trimmed: items.filter((asset) => asset.trimmed).length,
  };
}
function safeFileName(value = "phantomforce-content") {
  return String(value || "phantomforce-content")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "phantomforce-content";
}
function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadUrl(url, filename) {
  if (!url) return false;
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
function selectionKey(kind, id) {
  return `${kind}:${id}`;
}
function itemFromSelectionKey(key, data = loadContent(), assets = loadContentAssets()) {
  const sep = String(key).indexOf(":");
  const kind = sep >= 0 ? key.slice(0, sep) : "";
  const id = sep >= 0 ? key.slice(sep + 1) : "";
  if (kind === "asset") {
    const asset = assets.find((item) => item.id === id);
    return asset ? { kind, id, asset, title: asset.title, type: asset.type, hasDownload: !!asset.url } : null;
  }
  if (kind === "post") {
    const post = data.posts.find((item) => item.id === id);
    return post ? { kind, id, post, title: post.caption, type: post.type, hasDownload: false } : null;
  }
  return null;
}
function selectedLibraryItems(data, assets) {
  return [...chSelection].map((key) => itemFromSelectionKey(key, data, assets)).filter(Boolean);
}
function compactAssetForExport(asset) {
  return {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    prompt: asset.prompt,
    source: asset.source,
    provider: asset.provider,
    model: asset.model,
    style: asset.style,
    aspect: asset.aspect,
    duration: asset.duration,
    saved: !!asset.saved,
    batchLabel: asset.batchLabel || "",
    aiEditPlan: asset.aiEditPlan || "",
    createdAt: new Date(asset.createdAt).toISOString(),
    expiresAt: new Date(asset.expiresAt).toISOString(),
    bytes: assetBytes(asset),
    hasInlinePreview: !!asset.url,
  };
}
function compactPostForExport(post) {
  return {
    id: post.id,
    platform: post.platform,
    type: post.type,
    caption: post.caption,
    status: post.status,
    publishedAt: post.publishedAt,
    hashtags: post.hashtags,
    metrics: post.metrics,
  };
}
function exportPayload(items, label = "selection") {
  return {
    exported_at: new Date().toISOString(),
    scope: label,
    safety: {
      local_only: true,
      external_upload: false,
      public_post: false,
      provider_call: false,
      send: false,
    },
    assets: items.filter((item) => item.kind === "asset").map((item) => compactAssetForExport(item.asset)),
    posts: items.filter((item) => item.kind === "post").map((item) => compactPostForExport(item.post)),
  };
}
function exportMarkdown(items, label = "selection") {
  const payload = exportPayload(items, label);
  const assetRows = payload.assets.map((asset) => `- ${asset.title} (${asset.type}) - ${asset.prompt || "No prompt saved."}`);
  const postRows = payload.posts.map((post) => `- ${post.caption} (${post.platform} / ${post.type})`);
  return [
    "# PhantomForce Content Export",
    "",
    `Exported: ${payload.exported_at}`,
    `Scope: ${label}`,
    "",
    "Safety: local export only. No upload, post, send, external generation, queue write, or outside action was performed.",
    "",
    "## Media Assets",
    assetRows.length ? assetRows.join("\n") : "- None",
    "",
    "## Posts",
    postRows.length ? postRows.join("\n") : "- None",
    "",
  ].join("\n");
}
function downloadLibraryItems(items, label = "selection") {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = `phantomforce-content-${safeFileName(label)}-${stamp}`;
  const downloadable = items.filter((item) => item.kind === "asset" && item.asset.url);
  downloadable.slice(0, 12).forEach((item, index) => {
    const ext = item.asset.type === "video" ? "webm" : "webp";
    setTimeout(() => downloadUrl(item.asset.url, `${base}-${index + 1}-${safeFileName(item.asset.title)}.${ext}`), index * 120);
  });
  downloadText(`${base}-manifest.json`, JSON.stringify(exportPayload(items, label), null, 2));
}
function exportLibraryItems(items, label = "selection") {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `phantomforce-content-${safeFileName(label)}-${stamp}`;
  downloadText(`${base}.md`, exportMarkdown(items, label), "text/markdown");
  downloadText(`${base}.json`, JSON.stringify(exportPayload(items, label), null, 2));
}
function setSelectedAssetMetadata(ids, patch) {
  const updated = loadContentAssets().map((asset) => ids.has(asset.id) ? { ...asset, ...patch, updatedAt: Date.now() } : asset);
  saveContentAssets(updated);
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}
function loadRemovedContent() {
  try {
    const saved = JSON.parse(workspaceStorageGetItem(CH_REMOVED_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}
function saveRemovedContent(removed) {
  try { workspaceStorageSetItem(CH_REMOVED_KEY, JSON.stringify([...removed].slice(0, 200))); } catch {}
}
function isRemoved(id) {
  return loadRemovedContent().has(id);
}
function activeIdeas() {
  const removed = loadRemovedContent();
  return dailyIdeaState().ideas.filter((idea) => !removed.has(`idea:${idea.id}`));
}
function savedIdeas() {
  return dailyIdeaState().savedIdeas.filter((idea) => !isRemoved(`saved-idea:${idea.id}`));
}
function removeButton(id, label) {
  const safeLabel = String(label || "Remove item").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<button class="ch-remove" data-ch-remove="${id}" aria-label="${safeLabel}" title="${safeLabel}" type="button">x</button>`;
}
function wireRemovals(body, opts, root) {
  body.querySelectorAll("[data-ch-remove]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const removed = loadRemovedContent();
    removed.add(btn.dataset.chRemove);
    saveRemovedContent(removed);
    opts.notify?.("Creator Hub", "Removed local scheduled item. No live post, task, or external action was touched.");
    if (root) renderContentHub(root, opts);
  }));
}
export function analyze(posts) {
  const pub = posts.filter((p) => p.status === "published");
  const sum = (f) => pub.reduce((a, p) => a + f(p.metrics), 0);
  const totals = {
    posts: pub.length, reach: sum((m) => m.reach), impressions: sum((m) => m.impressions),
    likes: sum((m) => m.likes), comments: sum((m) => m.comments), shares: sum((m) => m.shares),
    saves: sum((m) => m.saves), views: sum((m) => m.views), clicks: sum((m) => m.clicks),
    followers: sum((m) => m.followersGained),
  };
  totals.engagement = totals.likes + totals.comments + totals.shares + totals.saves;
  totals.engagementRate = +(100 * totals.engagement / Math.max(1, totals.reach)).toFixed(1);
  const byPlatform = PLATFORMS.map((p) => {
    const rows = pub.filter((x) => x.platform === p.id);
    return { ...p, count: rows.length, reach: rows.reduce((a, x) => a + x.metrics.reach, 0), engagement: rows.reduce((a, x) => a + x.metrics.likes + x.metrics.comments + x.metrics.shares + x.metrics.saves, 0), followers: rows.reduce((a, x) => a + x.metrics.followersGained, 0) };
  }).filter((p) => p.count).sort((a, b) => b.reach - a.reach);
  const byType = Object.keys(TYPES).map((t) => {
    const rows = pub.filter((x) => x.type === t);
    return { type: t, label: TYPES[t], count: rows.length, reach: rows.reduce((a, x) => a + x.metrics.reach, 0) };
  }).filter((t) => t.count).sort((a, b) => b.count - a.count);
  // 30-day reach + engagement timeseries
  const days = 30, series = [];
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = Date.now() - d * DAY, dayEnd = dayStart + DAY;
    const rows = pub.filter((x) => { const t = Date.parse(x.publishedAt); return t >= dayStart && t < dayEnd; });
    series.push({ t: dayStart, reach: rows.reduce((a, x) => a + x.metrics.reach, 0), engagement: rows.reduce((a, x) => a + x.metrics.likes + x.metrics.comments, 0) });
  }
  const topPosts = pub.slice().sort((a, b) => (b.metrics.likes + b.metrics.comments + b.metrics.shares) - (a.metrics.likes + a.metrics.comments + a.metrics.shares)).slice(0, 6);
  return { totals, byPlatform, byType, series, topPosts };
}

/* ---------------- formatting + thumbs ---------------- */
const K = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0);
function ago(iso) { const s = (Date.now() - Date.parse(iso)) / 1000; if (s < 0) return "in " + rel(-s); return rel(s) + " ago"; }
function rel(s) { if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m"; if (s < 86400) return Math.round(s / 3600) + "h"; return Math.round(s / 86400) + "d"; }
function thumb(post) {
  const c = plat(post.platform).color;
  return `background:
    radial-gradient(80% 90% at 25% 15%, hsla(${post.hue},70%,55%,0.5), transparent 60%),
    radial-gradient(70% 80% at 85% 90%, ${c}55, transparent 60%),
    linear-gradient(150deg, #08120e, #050b09);`;
}
function assetBg(asset) {
  const hue = Number(asset.hue || 155);
  return `background:
    radial-gradient(80% 90% at 25% 10%, hsla(${hue},80%,58%,0.46), transparent 62%),
    radial-gradient(70% 80% at 86% 90%, rgba(65,255,161,.28), transparent 60%),
    linear-gradient(145deg, #08120e, #020807);`;
}
function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 9 * 1024 * 1024 ? 0 : 1)} MB`;
}
function expiresText(asset) {
  const days = Math.ceil(((asset.expiresAt || 0) - Date.now()) / DAY);
  if (days <= 1) return "expires soon";
  return `${days} days left`;
}
const PGLYPH = { instagram: "◉", tiktok: "♪", youtube: "▶", facebook: "f", x: "𝕏", linkedin: "in", pinterest: "P" };
function svgIc(k) {
  const P = {
    heart: `<path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z"/>`, chat: `<path d="M3 4h10v7H7l-3 2v-2H3z"/>`, share: `<path d="M11 5.5a2 2 0 1 0-2-2M5 8a2 2 0 1 0 0 .1M11 12.5a2 2 0 1 0-2-2M9.2 4.6L6.8 6.9M6.8 9.1l2.4 2.3"/>`, save: `<path d="M4 3h8v10l-4-2.5L4 13z"/>`, eye: `<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`, users: `<circle cx="6" cy="6" r="2.1"/><path d="M2.6 13c0-2 1.5-3.3 3.4-3.3S9.4 11 9.4 13"/>`, up: `<path d="M8 13V4M4.5 7.5L8 4l3.5 3.5"/>`,
    close: `<path d="M4 4l8 8M12 4l-8 8"/>`, spark: `<path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5l-1.4-4.1-4.1-1.4 4.1-1.4z"/>`,
    check: `<path d="M3 8.5l3 3 7-7"/>`, undo: `<path d="M6 3.5L2.5 7 6 10.5M2.5 7h6a4.5 4.5 0 1 1 0 9H7"/>`,
    redo: `<path d="M10 3.5L13.5 7 10 10.5M13.5 7h-6a4.5 4.5 0 1 0 0 9H9"/>`, download: `<path d="M8 2.5v7.5M4.8 7.3L8 10.5l3.2-3.2M3 12.5h10"/>`,
  };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}

/* =========================================================================
   Content Hub
   ========================================================================= */
const chState = { tab: "publish", platform: "all", ctype: "all", eng: "likes" };
const CONTENT_TYPE_FILTERS = [["all", "All"], ["reel", "Reels"], ["video", "Video"], ["carousel", "Carousels"], ["text", "Posts"], ["image", "Images"]];
const chSelection = new Set();
let chLightbox = null;
let chLbKeyHandler = null;
let chSelectAnchor = null;
let chLibraryKeyHandler = null;
let chLastDeleted = null;

export function renderContentHub(el, opts = {}) {
  syncCreatorTenant();
  let requestedAssetId = "";
  try {
    const requestedTab = workspaceStorageGetItem(CH_OPEN_TAB_KEY, { migrateGlobal: false });
    if (requestedTab === "production") chState.tab = "drafts";
    else if (requestedTab === "library") chState.tab = "publish";
    else if (requestedTab && ["ideas", "drafts", "publish", "calendar"].includes(requestedTab)) chState.tab = requestedTab;
    if (requestedTab) workspaceStorageRemoveItem(CH_OPEN_TAB_KEY);
    requestedAssetId = workspaceStorageGetItem(CH_OPEN_ASSET_KEY, { migrateGlobal: false }) || "";
    if (requestedAssetId) workspaceStorageRemoveItem(CH_OPEN_ASSET_KEY);
  } catch {}
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const mediaAssets = loadContentAssets();
  if (requestedAssetId) {
    const requestedAsset = mediaAssets.find((asset) => asset.id === requestedAssetId && (asset.url || contentAssetUrlCache.get(asset.id) || asset.syncedId));
    if (requestedAsset) {
      savePublishState({ ...loadPublishState(), sourceKey: `asset:${requestedAsset.id}` });
      chState.tab = "publish";
      chState.ctype = "all";
    }
  }
  const mediaStats = contentAssetStats(mediaAssets);
  const ideas = activeIdeas();
  const scheduled = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).length;
  const publishDrafts = loadPublishDrafts();
  if (!["ideas", "drafts", "publish", "calendar"].includes(chState.tab)) chState.tab = "publish";
  const tabs = [["ideas", "Ideas"], ["drafts", "Drafts"], ["publish", "Publish"], ["calendar", "Planner"]];
  el.innerHTML = `
    <div class="ch">
      <section class="ch-workbar">
        <div><h3>Creator Hub</h3><span>${esc(wsName(currentWs()))} · ${esc(tabs.find(([id]) => id === chState.tab)?.[1] || "Publish")}</span></div>
        <div class="ch-tenant-actions"><span class="ch-tenant-pill">Isolated workspace</span><button class="btn btn-primary" data-open-ws="media">Open Media Pool</button></div>
      </section>
      <div class="ch-tabs">
        ${tabs.map(([id, l]) => `<button class="ch-tab ${chState.tab === id ? "is-active" : ""}" data-ch-tab="${id}">${l}</button>`).join("")}
        <span class="ch-src">${ideas.length} ideas · ${publishDrafts.length} post drafts · ${scheduled} scheduled · ${mediaAssets.length} Media Pool items · ${formatBytes(mediaStats.bytes)}/${formatBytes(mediaStats.budgetBytes)}</span>
      </div>
      <div class="ch-body" data-ch-body></div>
    </div>
    ${chLightbox ? lightboxMarkup(chLightbox, esc) : ""}`;
  el.querySelectorAll("[data-ch-tab]").forEach((b) => b.onclick = () => { chState.tab = b.dataset.chTab; renderContentHub(el, opts); });
  el.querySelectorAll("[data-ch-type] button").forEach((b) => b.onclick = () => { chState.ctype = b.dataset.v; renderContentHub(el, opts); });
  pullSyncedAssetsOnce(el, opts);
  const body = el.querySelector("[data-ch-body]");
  const t = chState.tab;
  if (t === "ideas") renderCreatorIdeas(body, data, esc, el, opts);
  else if (t === "publish") renderPostPublish(body, data, esc, el, opts);
  else if (t === "drafts") renderDraftQueue(body, data, esc, el, opts);
  else if (t === "calendar") renderContentPlanner(body, data, esc, el, opts);
  if (chLightbox) wireLightbox(el, opts);
  hydrateTrimmedMedia(el, esc);
}

/* Swap "loading preview from backup…" placeholders for the real media by
   pulling each oversized asset back from the sync backend. Patches the DOM
   in place so an async fetch never fights a fresh render. */
async function hydrateTrimmedMedia(el, esc) {
  const slots = [...el.querySelectorAll("[data-ch-hydrate-asset]")];
  if (!slots.length) return;
  const assets = loadContentAssets();
  for (const slot of slots) {
    const asset = assets.find((item) => item.id === slot.dataset.chHydrateAsset);
    if (!asset) continue;
    const url = await hydrateContentAssetUrl(asset);
    if (!url || !slot.isConnected) continue;
    const holder = document.createElement("span");
    holder.innerHTML = asset.type === "video"
      ? `<video src="${esc(url)}" muted playsinline preload="metadata"></video><span class="ch-post-play">▶</span>`
      : `<img src="${esc(url)}" alt="${esc(asset.title)}" loading="lazy"/>`;
    slot.replaceWith(...holder.childNodes);
  }
}

function kpi(label, value, sub, tone) {
  return `<div class="ch-kpi ${tone || ""}"><span class="ch-kpi-k">${label}</span><b class="ch-kpi-v">${value}</b><span class="ch-kpi-s">${sub || ""}</span></div>`;
}
function ideaCard(idea, esc, i) {
  return `<article class="ch-idea-card ch-removable">
    ${removeButton(`idea:${idea.id}`, `Remove ${idea.title}`)}
    <div class="ch-idea-top"><span>${esc(idea.format)}</span><b>${esc(idea.title)}</b></div>
    <p>${esc(idea.angle)}</p>
    <div class="ch-idea-platforms">${idea.platforms.map((id) => `<span><i class="ch-dot" style="background:${plat(id).color}"></i>${esc(plat(id).name)}</span>`).join("")}</div>
    <div class="ch-idea-next"><b>Next:</b> ${esc(idea.next)}</div>
    <div class="ch-idea-actions">
      <button class="btn btn-good" data-ch-action="draft" data-idea-i="${i}" data-idea-id="${idea.id}">Draft from this</button>
      <button class="btn btn-quiet" data-ch-idea-save="${idea.id}" type="button">Save idea</button>
    </div>
  </article>`;
}
function renderCreatorIdeas(body, data, esc, root, opts) {
  const ideaInfo = dailyIdeaState();
  const auto = ideaInfo.config;
  const ideas = activeIdeas();
  const saved = savedIdeas();
  const scheduled = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).length;
  const profileHint = ideaInfo.missingProfile
    ? `<p class="ch-profile-hint">This batch is working from partial business context. Fill the business profile in Automation so each account gets ideas that fit their actual offer, audience, and voice.</p>`
    : `<p class="ch-profile-hint">Using ${esc(auto.profile.businessName || "this workspace")} profile: ${esc(auto.profile.audience || "audience")} · ${esc(auto.profile.offer || "offer")}.</p>`;
  body.innerHTML = `
    <div class="ch-kpis">
      ${kpi("Today", ideas.length, `new idea${ideas.length === 1 ? "" : "s"}`)}
      ${kpi("Saved", saved.length, "kept by user")}
      ${kpi("Autopilot queue", scheduled, "safe scheduled items")}
      ${kpi("Clears", "Daily", `refreshes at ${auto.refreshHour}:00`)}
      ${kpi("Daily idea drop", auto.enabled ? "On" : "Off", "editable in Automation", auto.enabled ? "good" : "")}
    </div>
    <div class="ch-creator-layout">
      <section class="ch-card">
        <div class="ch-card-h">
          <h3>Today's new ideas</h3>
          <span class="ch-src">${esc(auto.style)} · ${esc(auto.focus)} · disposable daily batch</span>
        </div>
        <div class="ch-idea-grid">${ideas.map((idea, i) => ideaCard(idea, esc, i)).join("") || `<p class="empty-line">Daily ideas are off or all of today's ideas were removed. Turn the automation on or refresh from Automation.</p>`}</div>
      </section>
      <aside class="ch-card ch-creator-side">
        <h3>Daily idea automation</h3>
        ${profileHint}
        <div class="ch-idea-form">
          <label>Quick add for today<input data-ch-custom-title placeholder="Add your own idea..." /></label>
          <label>Angle<textarea data-ch-custom-angle placeholder="Optional detail, audience, or offer angle..."></textarea></label>
          <button class="btn btn-primary" data-ch-add-idea type="button">Add idea</button>
          <button class="btn btn-quiet" data-ch-refresh-ideas type="button">Refresh today's batch</button>
          <button class="btn btn-quiet" data-open-ws="automation" type="button">Configure automation</button>
        </div>
        <div class="ch-brief-list">
          <span><b>Count</b>${auto.count} per day</span>
          <span><b>Content</b>${esc(auto.contentTypes.join(", "))}</span>
          <span><b>Channels</b>${esc(auto.channels.join(", "))}</span>
          <span><b>Rule</b>Gone tomorrow unless saved</span>
        </div>
        ${saved.length ? `<div class="ch-saved-ideas"><b>Saved ideas</b>${saved.slice(0, 5).map((idea) => `<span>${esc(idea.title)}</span>`).join("")}</div>` : ""}
      </aside>
    </div>`;
  wireCreatorActions(body, opts, root);
  wireRemovals(body, opts, root);
}
function renderDraftQueue(body, data, esc, root, opts) {
  const drafts = activeIdeas().slice(1, 5).filter((idea) => !isRemoved(`draft:${idea.id}`));
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Draft queue</h3><span class="ch-src">Safe drafts move on autopilot; risky claims stop for review</span></div>
      <div class="ch-draft-list">
        ${drafts.length ? drafts.map((idea, i) => `<article class="ch-draft ch-removable">
          ${removeButton(`draft:${idea.id}`, `Remove ${idea.title} draft`)}
          <span class="ch-draft-step">${i + 1}</span>
          <div>
            <h4>${esc(idea.title)}</h4>
            <p>${esc(idea.angle)}</p>
            <div class="ch-draft-meta"><span>${esc(idea.format)}</span><span>Autopilot copy pass</span><span>Asset direction</span></div>
          </div>
          <button class="btn" data-ch-action="approve-draft" data-idea-id="${idea.id}">Prepare autopilot</button>
        </article>`).join("") : `<p class="empty-line">No draft items are waiting. Removed items stay local to this browser.</p>`}
      </div>
    </div>`;
  wireCreatorActions(body, opts, root);
  wireRemovals(body, opts, root);
}
function loadPlannerItems() {
  try {
    const saved = JSON.parse(workspaceStorageGetItem(CH_PLANNER_ITEMS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item) => item?.id && item?.title && item?.startsAt) : [];
  } catch { return []; }
}
function savePlannerItems(items) {
  workspaceStorageSetItem(CH_PLANNER_ITEMS_KEY, JSON.stringify(items.slice(0, 250)));
  return items;
}
function plannerWeekStart(offset = plannerState.weekOffset) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7) + offset * 7);
  return value;
}
function plannerDayKey(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
}
function plannerTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function plannerRows(data) {
  const own = loadPlannerItems().map((item) => ({ ...item, source: "planner", removable: true }));
  const content = data.posts
    .filter((post) => post.status === "scheduled" && !isRemoved(`schedule:${post.id}`))
    .map((post) => ({ id: `content:${post.id}`, postId: post.id, title: post.caption, kind: "content", startsAt: post.publishedAt, source: plat(post.platform).name, detail: TYPES[post.type] || post.type, removable: false }));
  return [...own, ...content].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
function plannerConnectorMarkup(connector, esc) {
  const open = plannerState.openConnector === connector.id;
  return `<article class="ch-planner-connector ${open ? "is-open" : ""}">
    <button type="button" class="ch-planner-connector-head" data-planner-connector="${esc(connector.id)}" aria-expanded="${open}">
      <span><b>${esc(connector.name)}</b><i>${esc(connector.capability)}</i></span><em>Not connected</em>
    </button>
    ${open ? `<div class="ch-planner-connector-body"><p><b>${esc(connector.method)}</b> is required. PhantomForce will not store a password in this page or pretend the account is connected.</p>${connector.guide ? `<button type="button" class="btn btn-quiet" data-planner-guide="${esc(connector.guide)}">Open setup guide</button>` : `<span class="ch-src">A provider-specific adapter must be configured by the workspace owner.</span>`}</div>` : ""}
  </article>`;
}
function renderContentPlanner(body, data, esc, root, opts) {
  const weekStart = plannerWeekStart();
  const days = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * DAY));
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const rows = plannerRows(data);
  const visibleRows = rows.filter((item) => Date.parse(item.startsAt) >= weekStart.getTime() && Date.parse(item.startsAt) < weekEnd.getTime());
  const todayKey = plannerDayKey(Date.now());
  const waiting = rows.filter((item) => Date.parse(item.startsAt) >= Date.now()).length;
  body.innerHTML = `
    <section class="ch-planner-hero ch-card">
      <div><p class="ch-planner-kicker">BUSINESS PLANNER</p><h3>Everything that needs a time and place.</h3><span>Content, calls, follow-ups, meetings, and deadlines in one week.</span></div>
      <div class="ch-planner-metrics"><span><b>${visibleRows.length}</b><i>This week</i></span><span><b>${waiting}</b><i>Upcoming</i></span><span><b>${PLANNER_CONNECTORS.length}</b><i>Connectors ready to set up</i></span></div>
    </section>
    <section class="ch-planner-layout">
      <div class="ch-card ch-planner-calendar">
        <div class="ch-card-h ch-planner-head"><div><h3>${weekStart.toLocaleDateString([], { month: "long", day: "numeric" })} – ${new Date(weekEnd.getTime() - DAY).toLocaleDateString([], { month: "short", day: "numeric" })}</h3><span class="ch-src">Your week at a glance</span></div><div class="ch-planner-nav"><button type="button" data-planner-week="-1" aria-label="Previous week">←</button><button type="button" data-planner-today>Today</button><button type="button" data-planner-week="1" aria-label="Next week">→</button></div></div>
        <div class="ch-planner-week">
          ${days.map((day) => {
            const key = plannerDayKey(day);
            const dayRows = visibleRows.filter((item) => plannerDayKey(item.startsAt) === key);
            return `<section class="ch-planner-day ${key === todayKey ? "is-today" : ""}"><header><b>${day.toLocaleDateString([], { weekday: "short" })}</b><span>${day.getDate()}</span></header><div>${dayRows.map((item) => `<article class="ch-planner-event is-${esc(item.kind || "task")}" ${item.postId ? `data-ch-open="${esc(item.postId)}" role="button" tabindex="0"` : ""}><time>${esc(plannerTime(item.startsAt))}</time><b>${esc(item.title)}</b><i>${esc(item.source || item.kind || "Planner")}${item.detail ? ` · ${esc(item.detail)}` : ""}</i>${item.removable ? `<button type="button" data-planner-remove="${esc(item.id)}" aria-label="Remove ${esc(item.title)}">×</button>` : ""}</article>`).join("") || `<span class="ch-planner-open">Open</span>`}</div></section>`;
          }).join("")}
        </div>
      </div>
      <aside class="ch-card ch-planner-add">
        <div class="ch-card-h"><div><h3>Add to planner</h3><span class="ch-src">Saved to this business only</span></div></div>
        <form data-planner-form>
          <label>What<input name="title" maxlength="90" placeholder="Client call, follow-up, deadline…" required/></label>
          <label>When<input name="startsAt" type="datetime-local" value="${esc(localDateTimeValue(Date.now() + 3600e3))}" required/></label>
          <label>Type<select name="kind"><option value="meeting">Meeting</option><option value="call">Call</option><option value="follow_up">Follow-up</option><option value="deadline">Deadline</option><option value="task">Task</option><option value="content">Content</option></select></label>
          <label>Note<textarea name="detail" rows="3" maxlength="240" placeholder="Optional details"></textarea></label>
          <button class="btn btn-primary" type="submit">Add to planner</button>
        </form>
      </aside>
    </section>
    <section class="ch-card ch-planner-connectors">
      <div class="ch-card-h"><div><h3>Connect your workday</h3><span class="ch-src">Email + calendar setup · credentials stay in approved provider adapters</span></div></div>
      <div class="ch-planner-connector-groups">
        ${["Email", "Calendar"].map((group) => `<section><h4>${group}</h4><div>${PLANNER_CONNECTORS.filter((connector) => connector.group === group).map((connector) => plannerConnectorMarkup(connector, esc)).join("")}</div></section>`).join("")}
      </div>
    </section>`;
  body.querySelectorAll("[data-planner-week]").forEach((button) => { button.onclick = () => { plannerState.weekOffset += Number(button.dataset.plannerWeek); renderContentHub(root, opts); }; });
  body.querySelector("[data-planner-today]")?.addEventListener("click", () => { plannerState.weekOffset = 0; renderContentHub(root, opts); });
  body.querySelector("[data-planner-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startsAt = new Date(String(form.get("startsAt") || ""));
    if (!Number.isFinite(startsAt.getTime())) return;
    const items = loadPlannerItems();
    items.push({ id: `planner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: String(form.get("title") || "").trim(), startsAt: startsAt.toISOString(), kind: String(form.get("kind") || "task"), detail: String(form.get("detail") || "").trim(), createdAt: Date.now() });
    savePlannerItems(items);
    opts.notify?.("Content Hub", "Added to this business planner.");
    renderContentHub(root, opts);
  });
  body.querySelectorAll("[data-planner-remove]").forEach((button) => { button.onclick = (event) => { event.stopPropagation(); savePlannerItems(loadPlannerItems().filter((item) => item.id !== button.dataset.plannerRemove)); renderContentHub(root, opts); }; });
  body.querySelectorAll("[data-planner-connector]").forEach((button) => { button.onclick = () => { plannerState.openConnector = plannerState.openConnector === button.dataset.plannerConnector ? "" : button.dataset.plannerConnector; renderContentHub(root, opts); }; });
  body.querySelectorAll("[data-planner-guide]").forEach((button) => { button.onclick = () => window.open(button.dataset.plannerGuide, "_blank", "noopener,noreferrer"); });
  wirePostCards(body, data, esc, root, opts);
}
function publishSources(data, assets) {
  const assetRows = assets.slice(0, 24).map((asset) => ({
    key: `asset:${asset.id}`,
    kind: "asset",
    asset,
    title: asset.title || (asset.type === "video" ? "Generated video" : "Generated image"),
    sub: `${asset.source || "Media Lab"} · ${asset.type}`,
    copy: asset.prompt || "Generated media ready for a caption.",
    type: asset.type,
    hue: asset.hue || 155,
  }));
  const postRows = data.posts
    .filter((post) => !isRemoved(`post:${post.id}`))
    .slice(0, 8)
    .map((post) => ({
      key: `post:${post.id}`,
      kind: "post",
      post,
      title: post.caption,
      sub: `${plat(post.platform).name} · ${TYPES[post.type] || post.type}`,
      copy: post.caption,
      type: post.type,
      hue: post.hue || 155,
    }));
  return [...assetRows, ...postRows];
}
function publishSourceFromState(data, assets, state) {
  const sources = publishSources(data, assets);
  return sources.find((source) => source.key === state.sourceKey) || sources[0] || null;
}
function sourceMediaMarkup(source, esc, size = "large") {
  if (!source) return `<span class="ch-pub-media-empty">Choose or upload media</span>`;
  if (source.kind === "asset") {
    const asset = source.asset;
    const url = contentAssetDisplayUrl(asset);
    if (url) {
      return asset.type === "video"
        ? `<video src="${esc(url)}" muted playsinline preload="metadata"></video><span class="ch-post-play">▶</span>`
        : `<img src="${esc(url)}" alt="${esc(asset.title)}" loading="lazy"/>`;
    }
    if (asset.syncedId) {
      return `<span class="ch-pub-media-empty" style="${assetBg(asset)}" data-ch-hydrate-asset="${esc(asset.id)}" data-ch-hydrate-type="${esc(asset.type)}" data-ch-hydrate-title="${esc(asset.title)}">${size === "tiny" ? "media" : "loading preview from backup…"}</span>`;
    }
    return `<span class="ch-pub-media-empty" style="${assetBg(asset)}">${size === "tiny" ? "media" : "preview unavailable on this device"}</span>`;
  }
  if (source.post) {
    return `<span class="ch-pub-media-empty" style="${thumb(source.post)}"><span class="ch-post-plat" style="background:${plat(source.post.platform).color}">${PGLYPH[source.post.platform] || "●"}</span>${isVideo(source.post.type) ? `<span class="ch-post-play">▶</span>` : ""}</span>`;
  }
  return `<span class="ch-pub-media-empty">No source</span>`;
}
function publishTypeFor(platformId, source, preferredType = "auto") {
  const types = plat(platformId).types || ["text"];
  const raw = preferredType && preferredType !== "auto" ? preferredType : (source?.type || "text");
  if (["video", "reel", "short"].includes(raw)) {
    if (types.includes("reel")) return "reel";
    if (types.includes("short")) return "short";
    if (types.includes("video")) return "video";
  }
  if (["image", "carousel", "story"].includes(raw)) {
    if (types.includes("image")) return "image";
    if (types.includes("carousel")) return "carousel";
    if (types.includes("story")) return "story";
  }
  return types.includes("text") ? "text" : (types[0] || "text");
}
function publishScheduleIso(value) {
  const d = value ? new Date(value) : new Date(Date.now() + 4 * 3600e3);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(Date.now() + 4 * 3600e3).toISOString();
}
function toneLead(tone) {
  return ({
    hype: "This is what it looks like when the busy work stops winning.",
    coach: "Here is the simple way to get the work moving without chasing every task yourself.",
    premium: "A cleaner operating layer for the business owners who cannot afford messy follow-up.",
    local: "For the local business owner who needs leads, content, and follow-up handled without drama.",
    clean: "PhantomForce turns content, follow-up, and daily operations into one controlled workflow.",
  })[tone] || "PhantomForce turns content, follow-up, and daily operations into one controlled workflow.";
}
function suggestPublishCaption(state, source, platformIds) {
  const sourceText = (state.brief || source?.copy || source?.title || "").trim();
  const cta = (state.cta || "Book a 15-minute setup call").trim();
  const platforms = platformIds.map((id) => plat(id).name).join(", ");
  const detail = sourceText
    ? `\n\nBuilt around: ${sourceText.replace(/\s+/g, " ").slice(0, 170)}`
    : "";
  const hashtagSet = new Set(["#PhantomForce", "#SmallBusiness", "#ContentWorkflow"]);
  if (platformIds.includes("instagram") || platformIds.includes("tiktok")) hashtagSet.add("#AIContent");
  if (platformIds.includes("linkedin")) hashtagSet.add("#Operations");
  return `${toneLead(state.tone)}${detail}\n\nAI-assisted. Human-approved. Ready for ${platforms || "your channels"}.\n\n${cta}.\n\n${[...hashtagSet].join(" ")}`;
}
function captionForPlatform(caption, platformId) {
  const clean = String(caption || "").trim();
  if (platformId === "x" && clean.length > 260) return `${clean.slice(0, 253).trim()}...`;
  if (platformId === "linkedin") return clean.replace(/#AIContent/g, "#AIForBusiness");
  return clean;
}
function publishSourceRail(sources, state, esc) {
  if (!sources.length) return `<p class="empty-line">No Media Pool source yet. Open Media Lab, create or upload media there, then organize the post here.</p>`;
  const activeKey = state.sourceKey || sources[0].key;
  return sources.map((source) => `<button type="button" class="ch-pub-source ${activeKey === source.key ? "is-on" : ""}" data-ch-pub-source="${esc(source.key)}">
    <span class="ch-pub-source-thumb">${sourceMediaMarkup(source, esc, "tiny")}</span>
    <span><b>${esc(source.title.slice(0, 54))}${source.title.length > 54 ? "..." : ""}</b><i>${esc(source.sub)}</i></span>
  </button>`).join("");
}
function publishUnifiedPreview(platformIds, state, source, accounts, esc) {
  const ids = normalizePlatformIds(platformIds, ["instagram"]);
  const primary = plat(ids[0]);
  const linked = ids.filter((id) => socialStatus(accounts[id] || {}) === "linked").length;
  const caption = state.caption || suggestPublishCaption(state, source, ids);
  const formats = [...new Set(ids.map((id) => TYPES[publishTypeFor(id, source, state.postType)] || publishTypeFor(id, source, state.postType)))];
  return `<article class="ch-pub-preview-card ch-pub-preview-unified" style="--pc:${primary.color}">
    <div class="ch-pub-preview-top">
      <span class="ch-pub-preview-destinations">${ids.map((id) => `<i class="ch-post-plat" style="background:${plat(id).color}" title="${esc(plat(id).name)}">${PGLYPH[id] || "●"}</i>`).join("")}</span>
      <span><b>Universal post preview</b><i>${ids.map((id) => esc(plat(id).name)).join(" · ")}</i></span>
      <em>${linked}/${ids.length} ready</em>
    </div>
    <div class="ch-pub-preview-media">${sourceMediaMarkup(source, esc)}</div>
    <div class="ch-pub-preview-actions"><span>${svgIc("heart")}</span><span>${svgIc("chat")}</span><span>${svgIc("share")}</span><span>${svgIc("save")}</span></div>
    <p class="ch-pub-preview-caption">${esc(caption)}</p>
    <div class="ch-pub-preview-foot">${esc(formats.join(" / "))} · one preview for every selected channel · final crop may vary</div>
  </article>`;
}
function draftStatusLabel(status) {
  if (status === "scheduled") return "Scheduled";
  if (status === "posted") return "Posted";
  if (status === "approval") return "Approval required";
  if (status === "manual-posted") return "Manual posted";
  return "Draft";
}
function enhancedPublishBrief(state, source) {
  const seed = (state.brief || source?.copy || source?.title || "").trim();
  const format = PUBLISH_FORMATS.find(([id]) => id === state.postType)?.[1] || "Auto-fit";
  const platforms = normalizePlatformIds(state.platforms, ["instagram"]).map((id) => plat(id).name).join(", ");
  const angle = seed || "Show the business value clearly and make the next step easy.";
  return [
    `Post goal: ${angle.replace(/\s+/g, " ").slice(0, 180)}`,
    `Format: ${format}`,
    `Destinations: ${platforms}`,
    "Hook: Lead with the outcome, not the tool.",
    "Body: Explain the offer in plain language and tie it to a real customer problem.",
    `CTA: ${(state.cta || "Book a 15-minute setup call").trim()}`,
  ].join("\n");
}
function buildPublishDraft(state, source, status) {
  const createdAt = Date.now();
  return {
    id: `publish-${createdAt}-${Math.random().toString(36).slice(2, 7)}`,
    status,
    platforms: normalizePlatformIds(state.platforms, ["instagram"]),
    caption: state.caption || suggestPublishCaption(state, source, state.platforms),
    brief: state.brief || "",
    tone: state.tone || "clean",
    cta: state.cta || "",
    sourceKey: source?.key || state.sourceKey || "",
    sourceTitle: source?.title || "Manual post",
    sourceKind: source?.kind || "text",
    postType: state.postType || "auto",
    sourceType: state.postType && state.postType !== "auto" ? state.postType : (source?.type || "text"),
    sourceHue: source?.hue || 155,
    scheduleAt: state.scheduleAt,
    scheduledFor: publishScheduleIso(state.scheduleAt),
    localOnly: true,
    externalSent: false,
    createdAt,
    updatedAt: createdAt,
  };
}
function blankMetrics() {
  return { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, views: 0, watchAvg: 0, clicks: 0, followersGained: 0, engagementRate: 0, reactions: null };
}
function addPublishPosts(data, draft, status) {
  const publishedAt = status === "published" ? new Date().toISOString() : draft.scheduledFor;
  const rows = Array.isArray(data.posts) ? data.posts : [];
  const existing = new Set(rows.map((post) => post.id));
  draft.platforms.forEach((platformId) => {
    const id = `${draft.id}-${platformId}-${status}`;
    if (existing.has(id)) return;
    const type = publishTypeFor(platformId, { type: draft.sourceType }, draft.postType || "auto");
    rows.unshift({
      id,
      platform: platformId,
      type,
      caption: captionForPlatform(draft.caption, platformId),
      publishedAt,
      status,
      hue: draft.sourceHue || 155,
      hashtags: (draft.caption.match(/#[A-Za-z0-9_]+/g) || ["#PhantomForce"]).slice(0, 6),
      mentions: [],
      metrics: blankMetrics(),
      comments: [],
      localOnly: true,
      analyticsVisible: status === "published",
      sourceDraftId: draft.id,
    });
  });
  return saveContent({ ...data, posts: rows });
}
function publishQueueMarkup(drafts, esc) {
  if (!drafts.length) return `<p class="empty-line">No post drafts yet. Create a post, save it, schedule it, or record it as posted.</p>`;
  return drafts.slice(0, 6).map((draft) => `<article class="ch-pub-queue-item">
    <span class="ch-pub-status ch-pub-status-${esc(draft.status)}">${esc(draftStatusLabel(draft.status))}</span>
    <b>${esc(draft.sourceTitle || "Manual post")}</b>
    <p>${esc((draft.caption || "").slice(0, 150))}${(draft.caption || "").length > 150 ? "..." : ""}</p>
    <i>${draft.platforms.map((id) => esc(plat(id).name)).join(" · ")} · ${draft.status === "scheduled" ? "scheduled" : draft.status === "posted" || draft.status === "manual-posted" ? "visible in local analytics" : "draft"}</i>
  </article>`).join("");
}
function renderPostPublish(body, data, esc, root, opts) {
  const assets = loadContentAssets();
  const accounts = loadSocialAccounts();
  const accountById = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const state = loadPublishState();
  const selectedPlatforms = normalizePlatformIds(state.platforms, defaultPublishPlatforms(accounts));
  state.platforms = selectedPlatforms;
  const sources = publishSources(data, assets);
  const source = publishSourceFromState(data, assets, state);
  const drafts = loadPublishDrafts();
  const linkedCount = enabledPlatformIds(accounts).length;
  const selectedPostType = state.postType || "auto";
  body.innerHTML = `
    <section class="ch-publish-grid">
      <div class="ch-card ch-pub-composer">
        <div class="ch-card-h">
          <div><h3>Publish</h3><span class="ch-src">create a post · choose media · post everywhere when connected</span></div>
          <button type="button" class="ch-tool" data-ch-new-post>New post</button>
          <span class="ch-pub-safe">${linkedCount ? `${linkedCount} profile${linkedCount === 1 ? "" : "s"} saved` : "Manual preview mode"}</span>
        </div>
        <div class="ch-pub-section">
          <b class="ch-pub-label">Presets</b>
          <div class="ch-pub-presets">
            ${PUBLISH_PRESETS.map((preset) => {
              const ids = preset.id === "enabled" ? defaultPublishPlatforms(accounts) : preset.platforms;
              const on = ids && ids.length === selectedPlatforms.length && ids.every((id) => selectedPlatforms.includes(id));
              return `<button type="button" class="ch-chip ${on ? "is-on" : ""}" data-ch-pub-preset="${preset.id}">${esc(preset.name)} <em>${esc(preset.hint)}</em></button>`;
            }).join("")}
          </div>
        </div>
        <div class="ch-pub-section">
          <b class="ch-pub-label">Type of post</b>
          <div class="ch-pub-format-row">
            ${PUBLISH_FORMATS.map(([id, label]) => `<button type="button" class="ch-chip ${selectedPostType === id ? "is-on" : ""}" data-ch-pub-format="${id}">${esc(label)}</button>`).join("")}
          </div>
        </div>
        <div class="ch-pub-section">
          <b class="ch-pub-label">Platforms</b>
          <div class="ch-pub-platforms">
            ${PLATFORMS.map((P) => {
              const account = accountById[P.id] || {};
              const status = socialStatus(account);
              const copy = status === "linked" ? "enabled" : status === "pending" ? "pending" : "manual";
              return `<button type="button" class="ch-pub-platform ${selectedPlatforms.includes(P.id) ? "is-on" : ""}" data-ch-pub-platform="${P.id}" style="--pc:${P.color}">
                <span class="ch-post-plat" style="background:${P.color}">${PGLYPH[P.id] || "●"}</span>
                <span><b>${esc(P.name)}</b><i>${esc(account.handle || account.loginIdentity || P.handle)} · ${copy}</i></span>
              </button>`;
            }).join("")}
          </div>
        </div>
        <div class="ch-pub-section ch-pub-source-section">
          <div class="ch-pub-source-head">
            <b class="ch-pub-label">Source</b>
            <div class="ch-action-row">
              <button type="button" class="ch-tool" data-ch-pub-pc>Select from PC</button>
              <button type="button" class="ch-tool" data-open-ws="media">Media Pool</button>
            </div>
          </div>
          <div class="ch-pub-drop" data-ch-pub-drop>
            <input data-ch-pub-file type="file" accept="image/*,video/*" multiple hidden />
            <b>Drop files here</b>
            <span>or select from PC. Files become Media Pool post sources, then stay available for this workspace.</span>
          </div>
          <div class="ch-pub-source-grid">${publishSourceRail(sources, state, esc)}</div>
        </div>
        <div class="ch-pub-section ch-pub-ai-box">
          <div class="ch-pub-row">
            <label class="ch-pub-brief-field"><span>What do you want to post? <button type="button" data-ch-pub-enhance-brief>AI enhance</button></span><textarea data-ch-pub-brief data-ch-pub-field rows="4" placeholder="Describe the offer, clip, image, campaign, customer, or angle...">${esc(state.brief || "")}</textarea></label>
            <label><span>Call to action</span><input data-ch-pub-cta data-ch-pub-field value="${esc(state.cta || "")}" placeholder="Book a 15-minute setup call"/></label>
          </div>
          <div class="ch-pub-tone-row">
            ${PUBLISH_TONES.map(([id, label]) => `<button type="button" class="ch-chip ${state.tone === id ? "is-on" : ""}" data-ch-pub-tone="${id}">${esc(label)}</button>`).join("")}
            <label class="ch-pub-schedule"><span>Target time</span><input type="datetime-local" data-ch-pub-schedule data-ch-pub-field value="${esc(state.scheduleAt || localDateTimeValue())}"/></label>
          </div>
          <label class="ch-pub-caption"><span>Caption</span><textarea data-ch-pub-caption data-ch-pub-field rows="7" placeholder="Generate or write the final caption here...">${esc(state.caption || "")}</textarea></label>
          <div class="ch-action-row ch-pub-actions">
            <button type="button" class="ch-tool is-on" data-ch-pub-ai>${svgIc("spark")} Write caption</button>
            <button type="button" class="ch-tool" data-ch-pub-save>Save draft</button>
            <button type="button" class="ch-tool" data-ch-pub-schedule-post>Schedule</button>
            <button type="button" class="ch-tool" data-ch-pub-post-now>Post now</button>
            <button type="button" class="ch-tool" data-ch-pub-live disabled title="OAuth publishing adapters are not authorized in this local build.">OAuth live post</button>
          </div>
          <p class="ch-pub-note">Post now records the post across every selected channel in the local analytics ledger. Live external posting stays locked until OAuth scopes and account approvals are connected.</p>
        </div>
      </div>
      <aside class="ch-card ch-pub-preview">
        <div class="ch-card-h"><h3>Post preview</h3><span class="ch-src">One clean preview · ${selectedPlatforms.length} destinations</span></div>
        <div class="ch-pub-preview-stack">
          ${publishUnifiedPreview(selectedPlatforms, state, source, accountById, esc)}
        </div>
      </aside>
    </section>
    <section class="ch-card ch-pub-queue">
      <div class="ch-card-h"><h3>Post status</h3><span class="ch-src">drafts · scheduled · posted locally</span></div>
      <div class="ch-pub-queue-grid">${publishQueueMarkup(drafts, esc)}</div>
    </section>`;
  wirePostPublish(body, data, assets, esc, root, opts);
}
function readPublishForm(body, fallback = loadPublishState()) {
  const selected = [...body.querySelectorAll("[data-ch-pub-platform].is-on")].map((button) => button.dataset.chPubPlatform);
  const source = body.querySelector("[data-ch-pub-source].is-on")?.dataset.chPubSource || fallback.sourceKey || "";
  const postType = body.querySelector("[data-ch-pub-format].is-on")?.dataset.chPubFormat || fallback.postType || "auto";
  const tone = body.querySelector("[data-ch-pub-tone].is-on")?.dataset.chPubTone || fallback.tone || "clean";
  return savePublishState({
    ...fallback,
    platforms: normalizePlatformIds(selected, fallback.platforms || ["instagram"]),
    sourceKey: source,
    postType,
    brief: body.querySelector("[data-ch-pub-brief]")?.value || "",
    tone,
    cta: body.querySelector("[data-ch-pub-cta]")?.value || "",
    caption: body.querySelector("[data-ch-pub-caption]")?.value || "",
    scheduleAt: body.querySelector("[data-ch-pub-schedule]")?.value || localDateTimeValue(),
  });
}
function wirePostPublish(body, data, assets, esc, root, opts) {
  const notify = (msg) => opts.notify?.("Creator Hub", msg);
  const importPublishFiles = async (files = []) => {
    const usable = [...files].filter((file) => file?.type?.startsWith("image/") || file?.type?.startsWith("video/"));
    if (!usable.length) {
      notify("Drop or select an image/video file.");
      return;
    }
    const imported = [];
    for (let i = 0; i < usable.length; i++) {
      const file = usable[i];
      const url = await readFileAsDataUrl(file);
      const result = registerContentAsset({
        id: `pc-post-${Date.now()}-${i}`,
        type: file.type.startsWith("video/") ? "video" : "image",
        title: file.name.replace(/\.[^.]+$/, "") || "PC upload",
        prompt: "PC file selected for a Content Hub post.",
        source: "PC upload",
        provider: "local",
        model: "browser-file",
        style: "Post source",
        url,
        saved: true,
      }, { skipSync: true });
      imported.push(result.asset);
    }
    const state = readPublishForm(body);
    const first = imported[0];
    savePublishState({
      ...state,
      sourceKey: first ? `asset:${first.id}` : state.sourceKey,
      postType: usable.length > 1 && usable.every((file) => file.type.startsWith("image/")) ? "carousel" : (first?.type === "video" ? "video" : state.postType || "image"),
      brief: state.brief || (usable.length > 1 ? `Create a carousel from ${usable.length} selected PC files.` : `Create a post from ${first?.title || "the selected PC file"}.`),
    });
    notify(`Added ${usable.length} file${usable.length === 1 ? "" : "s"} as Media Pool post source${usable.length === 1 ? "" : "s"}.`);
    renderContentHub(root, opts);
  };
  body.querySelectorAll("[data-ch-pub-field]").forEach((field) => {
    field.oninput = () => readPublishForm(body);
    field.onchange = () => readPublishForm(body);
  });
  body.querySelectorAll("[data-ch-pub-platform]").forEach((button) => {
    button.onclick = () => {
      const state = readPublishForm(body);
      let next = state.platforms.includes(button.dataset.chPubPlatform)
        ? state.platforms.filter((id) => id !== button.dataset.chPubPlatform)
        : [...state.platforms, button.dataset.chPubPlatform];
      if (!next.length) next = [button.dataset.chPubPlatform];
      savePublishState({ ...state, platforms: next });
      renderContentHub(root, opts);
    };
  });
  body.querySelectorAll("[data-ch-pub-preset]").forEach((button) => {
    button.onclick = () => {
      const state = readPublishForm(body);
      const preset = PUBLISH_PRESETS.find((item) => item.id === button.dataset.chPubPreset);
      const next = preset?.id === "enabled" ? defaultPublishPlatforms(loadSocialAccounts()) : (preset?.platforms || state.platforms);
      savePublishState({ ...state, platforms: normalizePlatformIds(next, state.platforms) });
      renderContentHub(root, opts);
    };
  });
  body.querySelectorAll("[data-ch-pub-format]").forEach((button) => {
    button.onclick = () => {
      const state = readPublishForm(body);
      savePublishState({ ...state, postType: button.dataset.chPubFormat });
      renderContentHub(root, opts);
    };
  });
  body.querySelectorAll("[data-ch-pub-source]").forEach((button) => {
    button.onclick = () => {
      const state = readPublishForm(body);
      savePublishState({ ...state, sourceKey: button.dataset.chPubSource });
      renderContentHub(root, opts);
    };
  });
  body.querySelectorAll("[data-ch-pub-tone]").forEach((button) => {
    button.onclick = () => {
      const state = readPublishForm(body);
      savePublishState({ ...state, tone: button.dataset.chPubTone });
      renderContentHub(root, opts);
    };
  });
  body.querySelector("[data-ch-new-post]")?.addEventListener("click", () => {
    const current = readPublishForm(body);
    savePublishState({ ...defaultPublishState(), platforms: current.platforms, scheduleAt: localDateTimeValue() });
    notify("New post started.");
    renderContentHub(root, opts);
  });
  const fileInput = body.querySelector("[data-ch-pub-file]");
  body.querySelector("[data-ch-pub-pc]")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", async () => {
    await importPublishFiles(fileInput.files || []);
    fileInput.value = "";
  });
  const drop = body.querySelector("[data-ch-pub-drop]");
  drop?.addEventListener("click", () => fileInput?.click());
  drop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop?.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    importPublishFiles(event.dataTransfer?.files || []);
  });
  body.querySelector("[data-ch-pub-enhance-brief]")?.addEventListener("click", (event) => {
    event.preventDefault();
    const state = readPublishForm(body);
    const source = publishSourceFromState(data, loadContentAssets(), state);
    savePublishState({ ...state, brief: enhancedPublishBrief(state, source) });
    notify("Description enhanced. Now write the caption or schedule it.");
    renderContentHub(root, opts);
  });
  body.querySelector("[data-ch-pub-ai]")?.addEventListener("click", () => {
    let state = readPublishForm(body);
    const source = publishSourceFromState(data, assets, state);
    if (!state.brief.trim()) state = savePublishState({ ...state, brief: enhancedPublishBrief(state, source) });
    const caption = suggestPublishCaption(state, source, state.platforms);
    savePublishState({ ...state, caption });
    notify("Caption drafted. Review before posting or scheduling.");
    renderContentHub(root, opts);
  });
  const saveDraft = (status) => {
    let state = readPublishForm(body);
    const source = publishSourceFromState(data, assets, state);
    if (!state.caption.trim()) state = savePublishState({ ...state, caption: suggestPublishCaption(state, source, state.platforms) });
    const draft = buildPublishDraft(state, source, status);
    savePublishDrafts([draft, ...loadPublishDrafts()]);
    if (status === "scheduled") addPublishPosts(data, draft, "scheduled");
    if (status === "posted") addPublishPosts(data, draft, "published");
    notify(status === "scheduled"
      ? "Post scheduled locally and added to Planner. No external post was sent."
      : status === "posted"
        ? "Post recorded across selected channels and added to local analytics. OAuth live posting still requires connected accounts."
        : "Post draft saved locally.");
    renderContentHub(root, opts);
  };
  body.querySelector("[data-ch-pub-save]")?.addEventListener("click", () => saveDraft("draft"));
  body.querySelector("[data-ch-pub-schedule-post]")?.addEventListener("click", () => saveDraft("scheduled"));
  body.querySelector("[data-ch-pub-post-now]")?.addEventListener("click", () => saveDraft("posted"));
}
function renderContentLibrary(body, data, esc, root, opts) {
  const assets = loadContentAssets();
  const stats = contentAssetStats(assets);
  const assetFilter = (asset) => chState.ctype === "all" || asset.type === chState.ctype || (asset.type === "video" && ["reel", "short"].includes(chState.ctype));
  const shownAssets = assets.filter(assetFilter);
  const rows = data.posts.filter((p) => !isRemoved(`post:${p.id}`)).slice(0, 18);
  const shownPosts = rows.filter((p) => chState.ctype === "all" || p.type === chState.ctype);
  const selected = selectedLibraryItems(data, assets);
  const selectedAssets = selected.filter((item) => item.kind === "asset").length;
  const selectedPosts = selected.filter((item) => item.kind === "post").length;
  const allItemsCount = allLibraryItems(data, assets).length;
  body.innerHTML = `
    <section class="ch-card ch-created-media">
      <div class="ch-card-h ch-library-head">
        <div>
          <h3>Post sources</h3>
          <span class="ch-src">selected from Media Pool or PC upload · clears after ${CONTENT_ASSET_LIMITS.retentionDays} days</span>
        </div>
        <div class="ch-storage">
          <span>${formatBytes(stats.bytes)} / ${formatBytes(stats.budgetBytes)}</span>
          <i><b style="width:${stats.percent}%"></b></i>
        </div>
      </div>
      <div class="ch-library-actions ${chState.selectMode || chSelection.size ? "is-open" : ""}" data-ch-library-actions>
        ${chState.selectMode || chSelection.size ? `
        <div class="ch-select-summary">
          <b>${chSelection.size ? `${chSelection.size} selected` : "Selection tools"}</b>
          <span>${selectedAssets} media · ${selectedPosts} posts · use Select for multi-select, Shift/Ctrl for desktop ranges</span>
        </div>
        <div class="ch-action-row">
          <button class="ch-tool is-on" data-ch-select-mode type="button">Done selecting</button>
          <button class="ch-tool" data-ch-select-everything type="button" ${allItemsCount ? "" : "disabled"}>Select all</button>
          <button class="ch-tool" data-ch-select-all type="button" title="Ctrl+A" ${shownAssets.length || shownPosts.length ? "" : "disabled"}>Select visible <kbd class="ch-kbd">Ctrl+A</kbd></button>
          <button class="ch-tool" data-ch-clear-selected type="button" ${chSelection.size ? "" : "disabled"}>Clear</button>
          <button class="ch-tool" data-ch-download-selected type="button" ${chSelection.size ? "" : "disabled"}>Download selected</button>
          <button class="ch-tool" data-ch-download-all type="button" ${shownAssets.length || shownPosts.length ? "" : "disabled"}>Download all</button>
          <button class="ch-tool" data-ch-export-selected type="button" ${chSelection.size ? "" : "disabled"}>Export</button>
          <button class="ch-tool" data-ch-save-selected type="button" ${selectedAssets ? "" : "disabled"}>Save</button>
          <button class="ch-tool" data-ch-edit-selected type="button" ${selectedAssets ? "" : "disabled"}>Edit</button>
          <button class="ch-tool" data-ch-batch-edit type="button" ${selectedAssets ? "" : "disabled"}>Batch edit</button>
          <button class="ch-tool" data-ch-batch-ai type="button" ${selectedAssets ? "" : "disabled"}>Batch AI edit</button>
          <button class="ch-tool" data-ch-upload-local type="button">Upload local</button>
          <button class="ch-tool ch-tool-danger" data-ch-delete-selected type="button" ${chSelection.size ? "" : "disabled"}>Delete</button>
          <input data-ch-upload-input type="file" accept="image/*,video/*" multiple hidden />
        </div>` : `
        <button class="ch-tool" data-ch-select-mode type="button">Select</button>
        <input data-ch-upload-input type="file" accept="image/*,video/*" multiple hidden />
        <button class="ch-tool" data-ch-upload-local type="button">Upload local</button>`}
      </div>
      ${shownAssets.length ? `<div class="ch-asset-grid">${shownAssets.map((asset) => contentAssetCard(asset, esc)).join("")}</div>`
      : `<p class="empty-line">No post source media yet. Save media in Media Lab, select from PC, or open Publish to build a post.</p>`}
      ${stats.trimmed ? `<p class="ch-src">Space saver active: ${stats.trimmed} older/heavier preview${stats.trimmed === 1 ? "" : "s"} kept as metadata only.</p>` : ""}
    </section>
    <div class="ch-grid ch-grid-lg">${shownPosts.map((p) => postCard(p, esc, { creator: true })).join("")}</div>`;
  wireLibraryActions(body, data, assets, shownAssets, shownPosts, esc, root, opts);
  wirePostCards(body, data, esc, root, opts);
}
function contentAssetCard(asset, esc) {
  const hasUrl = !!asset.url;
  const typeLabel = asset.type === "video" ? "Video" : "Image";
  const prompt = asset.prompt || "No prompt saved.";
  const meta = asset.type === "video" ? "Media Lab video" : "Media Lab image";
  const key = selectionKey("asset", asset.id);
  const selected = chSelection.has(key);
  const flags = [asset.saved ? "saved" : "", asset.batchLabel ? asset.batchLabel : "", asset.aiEditPlan ? "AI edit plan" : ""].filter(Boolean);
  return `<article class="ch-asset-card ch-selectable ${selected ? "is-selected" : ""}" data-ch-select-item="${esc(key)}" data-ch-asset-id="${esc(asset.id)}" title="${hasUrl ? "Click to open" : ""}">
    <button class="ch-remove ch-asset-x" data-ch-delete-asset="${esc(asset.id)}" aria-label="Remove ${esc(asset.title)}" title="Remove ${esc(asset.title)}" type="button">x</button>
    <span class="ch-select-box" data-ch-select-hit aria-hidden="true">${selected ? "✓" : ""}</span>
    <span class="ch-asset-thumb ${hasUrl ? "has-real-media" : "is-missing-media"}" style="${hasUrl ? "" : assetBg(asset)}">
      ${hasUrl ? (asset.type === "video"
        ? `<video src="${esc(asset.url)}" muted playsinline preload="metadata"></video>`
        : `<img src="${esc(asset.url)}" alt="${esc(asset.title)}" loading="lazy"/>`) : `<em>${asset.syncedId ? "synced · loading preview" : "preview unavailable"}</em>`}
      ${asset.type === "video" ? `<span class="ch-post-play">▶</span>` : ""}
      <b>${typeLabel}</b>
    </span>
    <span class="ch-asset-body">
      <strong>${esc(asset.title)}</strong>
      <small>${esc(meta)} · ${expiresText(asset)} · ${formatBytes(assetBytes(asset))}${flags.length ? ` · ${flags.map((flag) => esc(flag)).join(" · ")}` : ""}</small>
      <span>${esc(prompt)}</span>
    </span>
  </article>`;
}
/* ---------------- inline lightbox: expand + AI-prompt image editor ----------------
   Reuses the same tested canvas filter engine as Media Lab's Edit tab (see
   imagefilters.js) but stays entirely local to Content Hub — its own isolated
   edit state per open, mounted right over the grid instead of navigating away. */
function freshLightbox(asset, extra = {}) {
  const extraLayers = extra.layers || {};
  const cleanExtra = { ...extra };
  delete cleanExtra.layers;
  const baseEffects = freshEditState();
  return {
    asset, originalUrl: asset.url, baseUrl: extra.baseUrl || asset.url, cutoutUrl: extra.cutoutUrl || "",
    state: baseEffects, layerEffects: { base: baseEffects }, bokehPicking: false, bokehCursor: null, showTutorial: false,
    selectedSpot: null, rememberBokehSize: true, _probed: false,
    layers: { image: true, cutout: true, bokeh: true, text: true, ...extraLayers },
    openSections: { adjust: false, transform: false, presets: false, text: false },
    layerMenuOpen: false,
    aiEdit: { status: "idle", message: "", provider: null },
    bg: { status: "idle", message: "" },
    bokehDetect: { status: "idle", message: "" },
    text: { open: false },
    composition: freshComposition(), editorUndo: [], editorRedo: [], editorGesture: null, subjectMaskUrls: {},
    ...cleanExtra,
  };
}

function editStateSnapshot(state) {
  return imageEditSnapshot(state);
}

function editorSnapshot(lb) {
  return {
    composition: compositionSnapshot(lb.composition),
    layerEffects: Object.fromEntries(Object.entries(lb.layerEffects || {}).map(([id, state]) => [id, editStateSnapshot(state)])),
  };
}

function restoreEditorSnapshot(lb, snapshot) {
  const masks = Object.fromEntries(Object.entries(lb.layerEffects || {}).map(([id, state]) => [id, state?.bokeh?.maskImg || null]));
  restoreComposition(lb.composition, snapshot.composition);
  const source = snapshot.layerEffects || (snapshot.state ? { base: snapshot.state } : {});
  lb.layerEffects = Object.fromEntries(Object.entries(source).map(([id, state]) => {
    return [id, restoreImageEditSnapshot(state, { maskImg: masks[id] })];
  }));
  if (!lb.layerEffects.base) lb.layerEffects.base = freshEditState();
  lb.state = lb.layerEffects.base;
}

function commitEditorChange(lb, before) {
  const after = editorSnapshot(lb);
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  pushEditorSnapshot(lb.editorUndo, before, 60);
  lb.editorRedo = [];
  return true;
}

function editorUndo(lb) {
  const snapshot = lb.editorUndo.pop();
  if (!snapshot) return false;
  lb.editorRedo.push(editorSnapshot(lb));
  restoreEditorSnapshot(lb, snapshot);
  return true;
}

function editorRedo(lb) {
  const snapshot = lb.editorRedo.pop();
  if (!snapshot) return false;
  lb.editorUndo.push(editorSnapshot(lb));
  restoreEditorSnapshot(lb, snapshot);
  return true;
}
const REMBG_EDITOR_MAX_SIDE = 1800;
function layerVisible(lb, key) {
  return lb.layers?.[key] !== false;
}
function activeLightboxImageUrl(lb) {
  return lb.cutoutUrl && layerVisible(lb, "cutout") ? lb.cutoutUrl : (lb.baseUrl || lb.asset?.url || "");
}
function selectedImageLayer(lb) {
  const selected = selectedLayers(lb.composition || freshComposition());
  if (selected.length !== 1) return null;
  return selected[0].type === "base" || selected[0].type === "image" ? selected[0] : null;
}
function layerEditState(lb, layerId = "base") {
  lb.layerEffects ||= {};
  if (!lb.layerEffects[layerId]) lb.layerEffects[layerId] = freshEditState();
  return lb.layerEffects[layerId];
}
function selectedImageEditState(lb) {
  const layer = selectedImageLayer(lb);
  return layer ? layerEditState(lb, layer.id) : null;
}
function selectedImageLabel(lb) {
  return selectedImageLayer(lb)?.name || "";
}
function effectsForRender(lb) {
  return Object.fromEntries(Object.entries(lb.layerEffects || {}).map(([id, state]) => [id, {
    ...state,
    bokeh: layerVisible(lb, `bokeh:${id}`) ? state.bokeh : null,
  }]));
}
function renderSourceCanvas(img, maxSide = REMBG_EDITOR_MAX_SIDE) {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c._img = img;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
async function exportSourceImage(img) {
  const c = renderSourceCanvas(img);
  const repaintRaw = (rescued) => {
    const fresh = renderSourceCanvas(rescued);
    c.width = fresh.width;
    c.height = fresh.height;
    c._img = rescued;
    c.getContext("2d").drawImage(fresh, 0, 0);
  };
  return exportCanvas(c, repaintRaw, "image/png");
}
function waitForCanvasImage(canvas, timeoutMs = 2500) {
  if (canvas._img) return Promise.resolve(canvas._img);
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const tick = () => {
      if (canvas._img) { resolvePromise(canvas._img); return; }
      if (Date.now() - started >= timeoutMs) { resolvePromise(null); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}
async function selectedImageSource(lb, canvas) {
  const layer = selectedImageLayer(lb);
  if (!layer) return null;
  if (layer.type === "base") {
    const image = await waitForCanvasImage(canvas);
    return image ? { layer, image } : null;
  }
  let image = lb.composition.imageCache.get(layer.src);
  if (!image && layer.src) {
    try {
      image = await loadImageForEditing(layer.src);
      lb.composition.imageCache.set(layer.src, image);
    } catch { image = null; }
  }
  return image ? { layer, image } : null;
}
function chSlider(label, key, min, max, val) {
  return `<label class="ch-lb-slider"><span>${label} <b data-out="${key}">${val}</b></span><input type="range" min="${min}" max="${max}" value="${val}" data-ch-lb-slider="${key}"/></label>`;
}
function chBSlider(label, key, min, max, val) {
  return `<label class="ch-lb-slider"><span>${label} <b data-bout="${key}">${val}</b></span><input type="range" min="${min}" max="${max}" value="${val}" data-ch-lb-bslider="${key}"/></label>`;
}
function chTSlider(label, key, min, max, val, esc) {
  return `<label class="ch-lb-slider"><span>${esc(label)} <b data-tout="${key}">${val}</b></span><input type="range" min="${min}" max="${max}" value="${val}" data-ch-lb-tslider="${key}"/></label>`;
}

function aiEditBody(lb, esc) {
  const ai = lb.aiEdit || { mode: "unavailable", status: "idle" };
  const target = selectedImageLayer(lb);
  const checking = ai.status === "checking";
  const loading = ai.status === "loading";
  const busy = checking || loading;

  if (ai.mode !== "connected") return "";

  const presets = [
    ["Auto enhance", "Improve lighting, color balance, clarity, and composition while keeping the subject natural."],
    ["Relight", "Relight this image with clean professional studio lighting and realistic skin tones."],
    ["Clean up", "Remove visual distractions and imperfections while preserving the main subject exactly."],
    ["Headshot", "Polish this into a premium professional business headshot with a natural realistic finish."],
    ["Product", "Polish this into a premium product image with crisp detail and commercially clean lighting."],
  ];
  return `
    <p class="ch-lb-ai-note">${target ? `Editing selected layer: <b>${esc(target.name)}</b>` : "Select one image layer to use AI tools."}</p>
    <div class="ch-ai-quick-grid">
      ${presets.map(([label, prompt]) => `<button type="button" data-ch-ai-preset="${esc(prompt)}" ${busy || !target ? "disabled" : ""}>${esc(label)}</button>`).join("")}
    </div>
    <div class="ch-lb-ai-row">
      <input class="ch-lb-ai-input" data-ch-lb-ai placeholder="Describe the finished result..."/>
      <button class="btn btn-primary" type="button" data-ch-lb-ai-run ${busy || !target ? "disabled" : ""}>${loading ? "Generating..." : checking ? "Checking..." : "Edit selected"}</button>
    </div>
    ${ai.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(ai.message || "Edit failed.")}</p>` : ""}
    ${ai.status === "success" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">AI edit applied to the selected layer.</p>` : ""}
  `;
}
function removeBgBody(lb, esc) {
  const bg = lb.bg || { status: "idle" };
  const target = selectedImageLayer(lb);
  const targetName = bg.targetName || target?.name || "";
  const checking = bg.status === "checking";
  const loading = bg.status === "loading";
  const unavailable = bg.status === "unavailable";
  if (bg.status === "preview") {
    return `
      <div class="ch-lb-bg-preview">
        <div class="ch-lb-bg-preview-imgs">
          <figure><img src="${esc(bg.beforeUrl)}" alt="Before"/><figcaption>${esc(targetName || "Before")}</figcaption></figure>
          <figure><img src="${esc(bg.afterUrl)}" alt="After"/><figcaption>Background removed</figcaption></figure>
        </div>
        <div class="ch-lb-chips">
          <button class="btn btn-primary" type="button" data-ch-lb-bg-apply>Apply</button>
          <button class="btn btn-quiet" type="button" data-ch-lb-bg-cancel>Cancel</button>
        </div>
      </div>`;
  }
  return `
    <button class="btn btn-primary ch-lb-bg-one" type="button" data-ch-lb-bg-run ${checking || loading || unavailable || !target ? "disabled" : ""}>${loading ? "Removing…" : "Remove"}</button>
    ${!target ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">Select an image layer.</p>` : ""}
    ${checking ? `<p class="ch-lb-ai-note">Checking the local image engine…</p>` : ""}
    ${unavailable ? `
      <p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(bg.message || "The local image engine is not ready yet.")}</p>
      <button class="btn btn-quiet" type="button" data-ch-lb-rembg-recheck>Re-check</button>
    ` : ""}
    ${bg.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(bg.message || "Background removal failed.")}</p>` : ""}
    ${bg.status === "applied" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">Applied to ${esc(targetName || "selected layer")}.</p>` : ""}
  `;
}

function bokehBody(lb, s, esc) {
  const spots = s.bokeh?.spots || [];
  const hasMask = !!s.bokeh?.maskImg;
  const selected = lb.selectedSpot != null ? spots[lb.selectedSpot] : null;
  const detect = lb.bokehDetect || { status: "idle" };
  const detecting = detect.status === "loading";
  const detectUnavailable = detect.status === "unavailable";
  return `
    <p class="ch-lb-ai-label">${svgIc("spark")} Subject bokeh ${hasMask ? `<i class="ch-lb-bokeh-count">AI subject</i>` : ""}${spots.length ? `<i class="ch-lb-bokeh-count">+${spots.length} spot${spots.length === 1 ? "" : "s"}</i>` : ""}</p>
    <div class="ch-lb-chips">
      <button type="button" data-ch-lb-bokeh-detect ${detecting || detectUnavailable ? "disabled" : ""}>${svgIc("spark")} ${detecting ? "Detecting subject…" : hasMask ? "Re-detect subject" : "AI detect subject"}</button>
    </div>
    ${detectUnavailable ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(detect.message || "Subject detection is waiting for the local image engine. Use Re-check under Remove Background.")}</p>` : ""}
    ${detect.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(detect.message || "Subject detection failed.")}</p>` : ""}
    ${hasMask && detect.status !== "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">AI detected the subject — the background blurs around its real shape, gaps included (e.g. between a cat's ears). Add focus spots below to touch it up.</p>` : ""}
    <p class="ch-lb-bokeh-note">${esc(lb.subjectHint || (hasMask ? "The detected subject is protected from blur and outlined on canvas. Add a small touch-up only if part of the subject was missed." : spots.length ? "Manual touch-ups keep those circles sharp. AI Detect is better for a full person or object." : "Detect the full subject first. Manual touch-ups are only for small areas the detector misses."))}</p>
    ${chBSlider("Touch-up size", "r", 4, 30, s.bokehBrush || 12)}
    ${s.bokeh ? chBSlider("Background blur", "strength", 4, 32, s.bokeh.strength) : ""}
    ${s.bokeh ? chBSlider("Feather", "feather", 5, 90, Math.round((s.bokeh.feather ?? 0.45) * 100)) : ""}
    <label class="ch-lb-check"><input type="checkbox" data-ch-lb-remember-size ${lb.rememberBokehSize ? "checked" : ""}/> Remember size for next point</label>
    <div class="ch-lb-chips">
      <button type="button" data-ch-lb-bokeh-pick class="${lb.bokehPicking ? "is-on" : ""}">${svgIc("spark")} ${lb.bokehPicking ? "Done" : spots.length ? "Edit touch-ups" : "Add touch-up"}</button>
      ${s.bokeh ? `<button type="button" data-ch-lb-bokeh-off>Clear bokeh</button>` : ""}
    </div>
    ${selected ? `
    <div class="ch-lb-bokeh-selected">
      <p class="ch-lb-ai-label">Selected spot</p>
      ${chBSlider("Radius", "spotR", 2, 90, Math.round(selected.r * 100))}
      <button class="btn btn-quiet" type="button" data-ch-lb-bokeh-remove-selected>Remove this spot</button>
    </div>` : ""}
  `;
}

function textToolBody(s, esc) {
  const st = { ...freshTextStyle(), ...(s.textStyle || {}) };
  return `
    <input class="ch-lb-ai-input" data-ch-lb-text placeholder="Add a caption / headline…" value="${esc(s.text)}"/>
    <div class="ch-lb-text-presets">
      ${Object.keys(TEXT_PRESETS).map((id) => `<button type="button" class="ch-lb-preset-chip ${st.preset === id ? "is-on" : ""}" data-ch-lb-text-preset="${id}">${esc(id.replace(/-/g, " "))}</button>`).join("")}
    </div>
    <div class="ch-lb-text-grid">
      <label class="ch-lb-mini"><span>Font</span>
        <select data-ch-lb-text-field="font">${TEXT_FONTS.map((f) => `<option value="${esc(f)}" ${st.font === f ? "selected" : ""}>${esc(f)}</option>`).join("")}</select>
      </label>
      <label class="ch-lb-mini"><span>Align</span>
        <select data-ch-lb-text-field="align">
          <option value="left" ${st.align === "left" ? "selected" : ""}>Left</option>
          <option value="center" ${st.align === "center" ? "selected" : ""}>Center</option>
          <option value="right" ${st.align === "right" ? "selected" : ""}>Right</option>
        </select>
      </label>
    </div>
    <div class="ch-lb-chips">
      <button type="button" class="${st.bold ? "is-on" : ""}" data-ch-lb-text-toggle="bold"><b>B</b></button>
      <button type="button" class="${st.italic ? "is-on" : ""}" data-ch-lb-text-toggle="italic"><i>I</i></button>
      <button type="button" class="${st.outline ? "is-on" : ""}" data-ch-lb-text-toggle="outline">Outline</button>
      <button type="button" class="${st.shadow ? "is-on" : ""}" data-ch-lb-text-toggle="shadow">Shadow</button>
    </div>
    <div class="ch-lb-text-grid">
      <label class="ch-lb-mini"><span>Color</span><input type="color" data-ch-lb-text-field="color" value="${esc(st.color)}"/></label>
      <label class="ch-lb-mini"><span>Outline color</span><input type="color" data-ch-lb-text-field="outlineColor" value="${esc(st.outlineColor)}"/></label>
    </div>
    ${chTSlider("Size", "size", 2, 16, st.size, esc)}
    ${chTSlider("Box width", "width", 20, 100, st.width, esc)}
    ${chTSlider("Position X", "x", 0, 100, st.x, esc)}
    ${chTSlider("Position Y", "y", 0, 100, st.y, esc)}
    ${chTSlider("Opacity", "opacity", 0, 100, st.opacity, esc)}
    ${st.outline ? chTSlider("Outline width", "outlineWidth", 0, 40, st.outlineWidth, esc) : ""}
  `;
}
function layerPropertySlider(label, key, value, min, max, step = 1) {
  return `<label class="ch-layer-prop"><span>${label}<b data-ch-layer-out="${key}">${value}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-ch-layer-prop="${key}"/></label>`;
}

const COLOR_LAYER_PALETTE = [
  "#000000", "#ffffff", "#111827", "#334155", "#64748b", "#e2e8f0",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#7f1d1d",
  "#78350f", "#14532d", "#134e4a", "#164e63", "#1e3a8a", "#4c1d95"
];

function selectedLayerInspector(lb, esc) {
  const layer = selectedLayers(lb.composition)[0];
  if (!layer || lb.composition.selectedIds.length !== 1) {
    return `<div class="ch-layer-inspector is-empty"><span>${lb.composition.selectedIds.length > 1 ? `${lb.composition.selectedIds.length} layers selected` : "Select a layer to edit it"}</span></div>`;
  }
  const common = `
    <div class="ch-layer-prop-grid">
      ${layerPropertySlider("X", "x", Math.round(layer.x * 100), 0, 100)}
      ${layerPropertySlider("Y", "y", Math.round(layer.y * 100), 0, 100)}
      ${layerPropertySlider("Width", "w", Math.round(layer.w * 100), 5, 200)}
      ${layerPropertySlider("Height", "h", Math.round(layer.h * 100), 5, 200)}
      ${layerPropertySlider("Rotate", "rotation", Math.round(layer.rotation || 0), -180, 180)}
      ${layerPropertySlider("Opacity", "opacity", Math.round((layer.opacity ?? 1) * 100), 0, 100)}
    </div>`;
  let typeFields = "";
  if (layer.type === "image" || layer.type === "base") {
    typeFields = `<label class="ch-layer-field"><span>Image fit</span><select data-ch-layer-field="fit"><option value="cover" ${layer.fit === "cover" ? "selected" : ""}>Fill frame</option><option value="contain" ${layer.fit === "contain" ? "selected" : ""}>Fit inside</option></select></label>`;
  } else if (layer.type === "text") {
    typeFields = `
      <label class="ch-layer-field"><span>Text</span><textarea rows="3" data-ch-layer-field="text">${esc(layer.text || "")}</textarea></label>
      <div class="ch-layer-field-grid">
        <label class="ch-layer-field"><span>Font</span><select data-ch-layer-field="font">${TEXT_FONTS.map((font) => `<option value="${esc(font)}" ${layer.font === font ? "selected" : ""}>${esc(font)}</option>`).join("")}</select></label>
        <label class="ch-layer-field"><span>Align</span><select data-ch-layer-field="align"><option value="left" ${layer.align === "left" ? "selected" : ""}>Left</option><option value="center" ${layer.align === "center" ? "selected" : ""}>Center</option><option value="right" ${layer.align === "right" ? "selected" : ""}>Right</option></select></label>
        <label class="ch-layer-field"><span>Text color</span><input type="color" data-ch-layer-field="color" value="${esc(layer.color || "#ffffff")}"/></label>
        <label class="ch-layer-field"><span>Box color</span><input type="color" data-ch-layer-field="background" value="${esc(layer.background || "#000000")}"/></label>
      </div>
      ${layerPropertySlider("Type size", "fontSize", layer.fontSize || 8, 2, 22, 0.5)}
      ${layerPropertySlider("Box fill", "backgroundOpacity", Math.round((layer.backgroundOpacity || 0) * 100), 0, 100)}
      <div class="ch-lb-chips"><button type="button" data-ch-layer-toggle="bold" class="${layer.bold ? "is-on" : ""}"><b>B</b></button><button type="button" data-ch-layer-toggle="shadow" class="${layer.shadow ? "is-on" : ""}">Shadow</button></div>`;
  } else if (layer.type === "color") {
    const current = layer.color || "#10251c";
    typeFields = `
      <label class="ch-layer-field"><span>Fill color</span><input type="color" data-ch-layer-field="color" value="${esc(current)}"/></label>
      <div class="ch-color-palette" aria-label="Color palette">
        ${COLOR_LAYER_PALETTE.map((color) => `<button type="button" data-ch-layer-color="${color}" class="${color.toLowerCase() === current.toLowerCase() ? "is-selected" : ""}" style="--swatch:${color}" title="${color}" aria-label="Use ${color}"></button>`).join("")}
      </div>
      ${layerPropertySlider("Corner radius", "radius", Math.round((layer.radius || 0) * 100), 0, 50)}`;
  }
  return `
    <div class="ch-layer-inspector">
      <div class="ch-layer-inspector-head"><b>${esc(layer.name)}</b><span>${esc(layer.type)}</span></div>
      ${typeFields}${common}
    </div>`;
}

function layerEffectLabel(lb, layer) {
  if (layer.type !== "base" && layer.type !== "image") return layer.type;
  const state = layerEditState(lb, layer.id);
  const effects = [];
  if (state.bokeh) effects.push("bokeh");
  if (state.blur || state.brightness !== 100 || state.contrast !== 100 || state.saturate !== 100 || state.hue) effects.push("adjusted");
  if (layer.hasTransparency || (layer.id === "base" && lb.cutoutUrl)) effects.push("cutout");
  return [layer.type === "base" ? "image" : layer.type, ...effects].join(" · ");
}

function layerStackBody(lb, esc) {
  const compositionLayers = [...lb.composition.layers].reverse();
  const selected = new Set(lb.composition.selectedIds);
  return `
    <div class="ch-lb-layers" data-ch-lb-layers>
      <div class="ch-layer-head"><p class="ch-lb-ai-label">${svgIc("eye")} Layers</p><span>${lb.composition.layers.length}</span></div>
      <div class="ch-new-layer">
        <button class="ch-new-layer-trigger" type="button" data-ch-layer-menu-toggle>
          <span>+ New layer</span><small>${lb.layerMenuOpen ? "Close" : "Media, text, or color"}</small>
        </button>
        <div class="ch-new-layer-menu" ${lb.layerMenuOpen ? "" : "hidden"}>
          <div class="ch-new-layer-actions">
            <button type="button" data-ch-layer-add="image">Image</button>
            <button type="button" data-ch-layer-add="text">Text</button>
            <button type="button" data-ch-layer-add="color">Color</button>
          </div>
          <button class="ch-layer-dropzone" type="button" data-ch-layer-drop>
            <b>Drop media here</b><span>or choose one or more images</span>
          </button>
          <input type="file" accept="image/*" multiple data-ch-layer-file hidden/>
        </div>
      </div>
      <div class="ch-lb-layer-list" data-ch-layer-list>
        ${compositionLayers.map((layer) => `
          <div class="ch-lb-layer ch-compose-layer ${layer.visible ? "is-on" : "is-off"} ${selected.has(layer.id) ? "is-selected" : ""}" draggable="true" data-ch-layer-row="${esc(layer.id)}">
            <button type="button" data-ch-layer-visible="${esc(layer.id)}" title="${layer.visible ? "Hide layer" : "Show layer"}">${svgIc("eye")}</button>
            <button class="ch-layer-name" type="button" data-ch-layer-select="${esc(layer.id)}"><b>${esc(layer.name)}</b><small>${esc(layerEffectLabel(lb, layer))}</small></button>
            <span class="ch-layer-row-actions">
              <button type="button" data-ch-layer-order="1" data-layer-id="${esc(layer.id)}" title="Move up">&uarr;</button>
              <button type="button" data-ch-layer-order="-1" data-layer-id="${esc(layer.id)}" title="Move down">&darr;</button>
              ${layer.id === "base" ? "" : `<button type="button" data-ch-layer-duplicate="${esc(layer.id)}" title="Duplicate">&#x2398;</button><button type="button" data-ch-layer-delete="${esc(layer.id)}" title="Delete">&times;</button>`}
            </span>
          </div>`).join("")}
      </div>
      ${selectedLayerInspector(lb, esc)}
    </div>`;
}
function lightboxMarkup(lb, esc) {
  const asset = lb.asset;
  if (lb.viewOnly) {
    return `
      <div class="ch-lightbox" data-ch-lightbox>
        <div class="ch-lb-backdrop" data-ch-lb-close></div>
        <div class="ch-lb-shell ch-lb-view-only">
          <header class="ch-lb-head">
            <div><b>${esc(asset.title)}</b><span>${esc(asset.prompt || "No prompt saved.")}</span></div>
            <button class="ch-lb-x" type="button" data-ch-lb-close aria-label="Close">${svgIc("close")}</button>
          </header>
          <div class="ch-lb-view-body"><video src="${esc(asset.url)}" controls autoplay muted playsinline></video></div>
        </div>
      </div>`;
  }
  const selectedImage = selectedImageLayer(lb);
  const s = selectedImageEditState(lb) || freshEditState();
  return `
    <div class="ch-lightbox" data-ch-lightbox>
      <div class="ch-lb-backdrop" data-ch-lb-close></div>
      <div class="ch-lb-shell">
        <header class="ch-lb-head">
          <div><b>${esc(asset.title)}</b><span>${esc(asset.prompt || "No prompt saved.")}</span></div>
          <div class="ch-lb-head-actions">
            <button class="ch-lb-x" type="button" data-ch-lb-tutorial aria-label="How to use this editor" title="How to use this editor">?</button>
            <button class="ch-lb-x" type="button" data-ch-lb-close aria-label="Close">${svgIc("close")}</button>
          </div>
        </header>
        ${lb.showTutorial ? tutorialMarkup() : ""}
        <div class="ch-lb-body">
          <div class="ch-lb-canvas-wrap">
            ${lb.loadError ? `<div class="ch-lb-load-error"><b>Couldn't load this image</b><span>${esc(lb.loadError)}</span></div>` : ""}
            <div class="ch-editor-toolbar" role="toolbar" aria-label="Canvas tools">
              <div class="ch-editor-toolgroup">
                <button type="button" data-ch-editor-undo ${lb.editorUndo.length ? "" : "disabled"} title="Undo (Ctrl+Z)">${svgIc("undo")}</button>
                <button type="button" data-ch-editor-redo ${lb.editorRedo.length ? "" : "disabled"} title="Redo (Ctrl+R)">${svgIc("redo")}</button>
              </div>
              <div class="ch-editor-toolgroup ch-editor-presets">
                <button type="button" data-ch-canvas-preset="1280x720">16:9 Thumbnail</button>
                <button type="button" data-ch-canvas-preset="1080x1080">1:1 Headshot</button>
                <button type="button" data-ch-canvas-preset="1080x1350">4:5 Portrait</button>
              </div>
              <div class="ch-editor-toolgroup">
                <button type="button" data-ch-editor-zoom="-0.1" title="Zoom out">−</button>
                <span data-ch-editor-zoom-label>${Math.round((lb.composition.zoom || 1) * 100)}%</span>
                <button type="button" data-ch-editor-zoom="0.1" title="Zoom in">+</button>
                <button type="button" data-ch-editor-fit title="Fit canvas">Fit</button>
              </div>
            </div>
            <div class="ch-editor-stage" data-ch-editor-stage>
              <div class="ch-editor-surface" data-ch-editor-surface>
                <canvas class="ch-lb-canvas" data-ch-lb-canvas></canvas>
                <canvas class="ch-editor-overlay ${lb.bokehPicking ? "is-picking" : ""}" data-ch-editor-overlay></canvas>
              </div>
              <div class="ch-lb-bokeh-markers ${(selectedImage && layerVisible(lb, `bokeh:${selectedImage.id}`) && (lb.bokehPicking || lb.selectedSpot != null)) ? "" : "is-hidden"}" data-ch-lb-bokeh-markers></div>
              <div class="ch-lb-pick-hint" data-ch-lb-pick-hint hidden>${svgIc("spark")} Click to add a sharp area · Done hides the guides</div>
            </div>
          </div>
          <aside class="ch-lb-tools">
            ${layerStackBody(lb, esc)}
            ${selectedImage && lb.aiEdit?.mode === "connected" ? `<div class="ch-lb-ai">
              <p class="ch-lb-ai-label">${svgIc("spark")} Describe an edit</p>
              ${aiEditBody(lb, esc)}
            </div>` : ""}
            ${selectedImage ? `<div class="ch-image-tools">
            <div class="ch-lb-ai ch-lb-ai-compact">
              <p class="ch-lb-ai-label">${svgIc("spark")} Remove background</p>
              ${removeBgBody(lb, esc)}
            </div>
            <div class="ch-lb-ai ch-lb-bokeh">
              ${bokehBody(lb, s, esc)}
            </div>
            <details class="ch-lb-section" data-ch-lb-section="adjust" ${lb.openSections?.adjust !== false ? "open" : ""}>
              <summary>Adjust</summary>
              ${chSlider("Brightness", "brightness", 0, 200, s.brightness)}
              ${chSlider("Contrast", "contrast", 0, 200, s.contrast)}
              ${chSlider("Saturation", "saturate", 0, 250, s.saturate)}
              ${chSlider("Hue", "hue", 0, 360, s.hue)}
              ${chSlider("Blur", "blur", 0, 12, s.blur)}
            </details>
            <details class="ch-lb-section" data-ch-lb-section="presets" ${lb.openSections?.presets ? "open" : ""}>
              <summary>Style presets</summary>
              <div class="ch-lb-chips ch-lb-chips-wrap" data-ch-lb-filter>
                <button type="button" data-v="none">None</button><button type="button" data-v="noir">Noir</button>
                <button type="button" data-v="emerald">Emerald</button><button type="button" data-v="warm">Warm</button>
                <button type="button" data-v="cold">Cold</button><button type="button" data-v="vivid">Vivid</button>
              </div>
            </details>
            </div>` : `<div class="ch-layer-tool-empty">Select an image layer to use Effects and AI.</div>`}
            <div class="ch-lb-actions">
              <button class="btn btn-primary" type="button" data-ch-lb-save>${svgIc("check")} Save</button>
              <button class="btn btn-quiet" type="button" data-ch-lb-save-copy>Save as copy</button>
              <button class="btn btn-quiet" type="button" data-ch-lb-download>${svgIc("download")} Download</button>
              <button class="ml-link" type="button" data-ch-lb-reset>Reset</button>
            </div>
          </aside>
        </div>
      </div>
    </div>`;
}
function tutorialMarkup() {
  const rows = [
    ["Build in layers", "Add an image, background, text, or color from Layers. Reorder, hide, duplicate, or delete anything without flattening your work."],
    ["Move and resize", "Click a layer on the canvas, drag to move it, and use the corner handles to resize. Shift-click selects more than one layer."],
    ["Zoom and shortcuts", "Scroll over the canvas to zoom. Ctrl+Z undoes, Ctrl+R redoes, Ctrl+A selects all layers, and Delete removes selected layers."],
    ["Describe an edit", "Type what you want and hit Generate. This appears only when AI Edit is connected, so the editor never shows a dead control."],
    ["Remove background", "Runs for real when background removal is connected, shows a before/after, then Apply or Cancel."],
    ["Subject bokeh", "Click \"AI detect subject\" — it uses your local background-removal engine to find the real subject shape, so gaps like the space between a cat's ears blur correctly. Then use \"Add focus spots\" to touch up anything it missed; drag a spot to move it, click to select and resize, right-click to remove it."],
    ["Camera controls", "Adjust, transform, presets, bokeh, and cutout remain non-destructive. Use layer text for movable headlines and labels."],
    ["Save vs. Save as copy", "Save updates this asset in place. Save as copy keeps the original and creates a new one."],
  ];
  return `
    <div class="ch-lb-tutorial">
      ${rows.map(([t, d]) => `<div class="ch-lb-tutorial-row"><b>${t}</b><span>${d}</span></div>`).join("")}
    </div>`;
}
function wireLightbox(root, opts) {
  const lb = chLightbox;
  if (!lb) return;
  const rerender = () => renderContentHub(root, opts);
  let onResize = null;
  const close = () => {
    if (chLbKeyHandler) { document.removeEventListener("keydown", chLbKeyHandler); chLbKeyHandler = null; }
    if (onResize) { window.removeEventListener("resize", onResize); onResize = null; }
    chLightbox = null;
    rerender();
  };
  root.querySelectorAll("[data-ch-lb-close]").forEach((b) => b.addEventListener("click", close));
  root.querySelector("[data-ch-lb-tutorial]")?.addEventListener("click", () => { lb.showTutorial = !lb.showTutorial; rerender(); });
  if (chLbKeyHandler) document.removeEventListener("keydown", chLbKeyHandler);
  chLbKeyHandler = (event) => {
    if (event.key === "Escape") { close(); return; }
    if (lb.viewOnly) return;
    const typing = event.target?.matches?.("input, textarea, select, [contenteditable='true']");
    if (typing) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      const changed = event.shiftKey ? editorRedo(lb) : editorUndo(lb);
      if (changed) rerender();
    } else if (mod && key === "r") {
      event.preventDefault();
      if (editorRedo(lb)) rerender();
    } else if (mod && key === "a") {
      event.preventDefault();
      selectAllLayers(lb.composition);
      rerender();
    } else if ((event.key === "Delete" || event.key === "Backspace") && lb.composition.selectedIds.some((id) => id !== "base")) {
      event.preventDefault();
      const before = editorSnapshot(lb);
      removeSelectedLayers(lb.composition);
      commitEditorChange(lb, before);
      rerender();
    }
  };
  document.addEventListener("keydown", chLbKeyHandler);
  if (lb.viewOnly) return;

  // rerender() fully rebuilds this DOM, which would otherwise silently
  // re-collapse any <details> the user just opened — track state explicitly
  // and sync silently on toggle (no rerender needed for this).
  root.querySelectorAll("[data-ch-lb-section]").forEach((d) => {
    d.addEventListener("toggle", () => { lb.openSections[d.dataset.chLbSection] = d.open; });
  });

  const asset = lb.asset;
  const selectedLayer = selectedImageLayer(lb);
  const s = selectedImageEditState(lb) || freshEditState();
  const canvas = root.querySelector("[data-ch-lb-canvas]");
  const overlay = root.querySelector("[data-ch-editor-overlay]");
  const editorStage = root.querySelector("[data-ch-editor-stage]");
  const editorSurface = root.querySelector("[data-ch-editor-surface]");
  const markerLayer = root.querySelector("[data-ch-lb-bokeh-markers]");
  const applyEditorZoom = () => {
    if (!editorSurface) return;
    const zoom = lb.composition.zoom || 1;
    editorSurface.style.width = `${Math.max(25, zoom * 100)}%`;
    const label = root.querySelector("[data-ch-editor-zoom-label]");
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  };
  const positionBrushCursor = () => {
    const brush = markerLayer?.querySelector("[data-ch-bokeh-brush-cursor]");
    if (!brush) return;
    if (!selectedLayer || !lb.bokehPicking || !lb.bokehCursor) { brush.classList.remove("is-visible"); return; }
    const stageRect = editorStage?.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const local = canvasPointToLayer(selectedLayer, lb.bokehCursor, canvas);
    const point = layerPointToCanvas(selectedLayer, local, canvas);
    const radius = (s.bokehBrush || 12) / 100 * Math.min(selectedLayer.w * canvasRect.width, selectedLayer.h * canvasRect.height);
    brush.style.left = `${canvasRect.left - (stageRect?.left || 0) + (point.x / canvas.width) * canvasRect.width}px`;
    brush.style.top = `${canvasRect.top - (stageRect?.top || 0) + (point.y / canvas.height) * canvasRect.height}px`;
    brush.style.width = `${radius * 2}px`;
    brush.style.height = `${radius * 2}px`;
    brush.classList.add("is-visible");
  };
  const positionMarkers = () => {
    if (!markerLayer) return;
    const spots = selectedLayer ? (s.bokeh?.spots || []) : [];
    markerLayer.innerHTML = `${spots.map((_, i) => `<div class="ch-lb-bokeh-marker ${i === lb.selectedSpot ? "is-selected" : ""}" data-spot-index="${i}"></div>`).join("")}<div class="ch-bokeh-brush-cursor" data-ch-bokeh-brush-cursor></div>`;
    const stageRect = editorStage?.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    [...markerLayer.querySelectorAll("[data-spot-index]")].forEach((el) => {
      const spot = spots[Number(el.dataset.spotIndex)];
      const point = layerPointToCanvas(selectedLayer, spot, canvas);
      const cssX = canvasRect.left - (stageRect?.left || 0) + (point.x / canvas.width) * canvasRect.width;
      const cssY = canvasRect.top - (stageRect?.top || 0) + (point.y / canvas.height) * canvasRect.height;
      const r = spot.r * Math.min(selectedLayer.w * canvasRect.width, selectedLayer.h * canvasRect.height);
      el.style.left = `${cssX}px`;
      el.style.top = `${cssY}px`;
      el.style.width = `${r * 2}px`;
      el.style.height = `${r * 2}px`;
    });
    positionBrushCursor();
  };
  const repaint = () => {
    if (!canvas._img) return;
    renderComposition(canvas, canvas._img, lb.layerEffects?.base || lb.state, lb.composition, effectsForRender(lb));
    if (overlay) drawCompositionOverlay(overlay, canvas, lb.composition);
    if (overlay && selectedLayer && layerVisible(lb, `bokeh:${selectedLayer.id}`) && s.bokeh?.maskImg) {
      drawDetectedSubjectOverlay(overlay, canvas, lb.composition, s.bokeh.maskImg, selectedLayer.id);
    }
    applyEditorZoom();
    positionMarkers();
  };
  // Cross-origin sources without CORS headers would otherwise silently
  // taint the canvas — every later toDataURL() call (Save/Download) throws
  // with no visible error. loadImageForEditing() requests CORS, then falls
  // back to a same-origin media proxy so this never happens silently.
  const requestedImageUrl = activeLightboxImageUrl(lb);
  loadImageForEditing(requestedImageUrl)
    .then(async (img) => {
      if (chLightbox !== lb || activeLightboxImageUrl(lb) !== requestedImageUrl) return;
      lb.loadError = "";
      canvas._img = img;
      await loadCompositionImages(lb.composition, loadImageForEditing);
      if (chLightbox !== lb) return;
      repaint();
    })
    .catch((error) => {
      if (chLightbox !== lb) return;
      lb.loadError = error.message || "Could not load this image.";
      rerender();
    });
  onResize = () => { repaint(); positionMarkers(); };
  window.addEventListener("resize", onResize);
  applyEditorZoom();

  const mutateLayer = (mutation, { rerenderAfter = true } = {}) => {
    const before = editorSnapshot(lb);
    mutation();
    commitEditorChange(lb, before);
    repaint();
    if (rerenderAfter) rerender();
  };
  const layerFile = root.querySelector("[data-ch-layer-file]");
  root.querySelector("[data-ch-layer-menu-toggle]")?.addEventListener("click", () => {
    lb.layerMenuOpen = !lb.layerMenuOpen;
    rerender();
  });
  root.querySelectorAll("[data-ch-layer-add]").forEach((button) => button.onclick = () => {
    const type = button.dataset.chLayerAdd;
    if (type === "image") {
      layerFile?.click();
      return;
    }
    mutateLayer(() => type === "text" ? addTextLayer(lb.composition) : addColorLayer(lb.composition));
  });
  const addMediaFiles = async (files, point = null) => {
    const images = [...(files || [])].filter((file) => file.type?.startsWith("image/"));
    if (!images.length) return;
    const before = editorSnapshot(lb);
    for (const file of images) {
      const url = await readFileAsDataUrl(file);
      const image = await loadImageForEditing(url);
      const layer = addImageLayer(lb.composition, url, file.name.replace(/\.[^.]+$/, "") || "Image layer");
      lb.layerEffects[layer.id] = freshEditState();
      const ratio = (image.naturalWidth || image.width || 1) / (image.naturalHeight || image.height || 1);
      if (ratio >= 1) { layer.w = 0.64; layer.h = Math.max(0.18, layer.w / ratio); }
      else { layer.h = 0.64; layer.w = Math.max(0.18, layer.h * ratio); }
      if (point) { layer.x = point.x; layer.y = point.y; }
      lb.composition.imageCache.set(url, image);
    }
    commitEditorChange(lb, before);
    lb.layerMenuOpen = false;
    if (layerFile) layerFile.value = "";
    rerender();
  };
  if (layerFile) layerFile.onchange = () => addMediaFiles(layerFile.files);
  const layerDrop = root.querySelector("[data-ch-layer-drop]");
  layerDrop?.addEventListener("click", () => layerFile?.click());
  [layerDrop, editorStage].filter(Boolean).forEach((target) => {
    target.addEventListener("dragover", (event) => {
      if (![...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) return;
      event.preventDefault();
      target.classList.add("is-drop-target");
    });
    target.addEventListener("dragleave", () => target.classList.remove("is-drop-target"));
    target.addEventListener("drop", (event) => {
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      event.preventDefault();
      target.classList.remove("is-drop-target");
      let point = null;
      if (target === editorStage) {
        const rect = canvas.getBoundingClientRect();
        point = {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
      }
      addMediaFiles(files, point);
    });
  });
  root.querySelectorAll("[data-ch-layer-select]").forEach((button) => button.onclick = (event) => {
    selectLayer(lb.composition, button.dataset.chLayerSelect, event.shiftKey || event.ctrlKey || event.metaKey);
    lb.selectedSpot = null;
    lb.bokehPicking = false;
    rerender();
  });
  root.querySelectorAll("[data-ch-layer-visible]").forEach((button) => button.onclick = () => mutateLayer(() => {
    const layer = lb.composition.layers.find((item) => item.id === button.dataset.chLayerVisible);
    if (layer) layer.visible = !layer.visible;
  }));
  root.querySelectorAll("[data-ch-layer-order]").forEach((button) => button.onclick = () => mutateLayer(() => {
    moveLayerOrder(lb.composition, button.dataset.layerId, Number(button.dataset.chLayerOrder));
  }));
  root.querySelectorAll("[data-ch-layer-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/phantom-layer", row.dataset.chLayerRow);
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
    row.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types?.includes("text/phantom-layer")) return;
      event.preventDefault();
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop-target"));
    row.addEventListener("drop", (event) => {
      const sourceId = event.dataTransfer?.getData("text/phantom-layer");
      const targetId = row.dataset.chLayerRow;
      row.classList.remove("is-drop-target");
      if (!sourceId || sourceId === targetId) return;
      event.preventDefault();
      mutateLayer(() => {
        const sourceIndex = lb.composition.layers.findIndex((item) => item.id === sourceId);
        const targetIndex = lb.composition.layers.findIndex((item) => item.id === targetId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const [layer] = lb.composition.layers.splice(sourceIndex, 1);
        const nextTarget = lb.composition.layers.findIndex((item) => item.id === targetId);
        lb.composition.layers.splice(nextTarget + (sourceIndex < targetIndex ? 1 : 0), 0, layer);
        lb.composition.selectedIds = [sourceId];
      });
    });
  });
  root.querySelectorAll("[data-ch-layer-duplicate]").forEach((button) => button.onclick = () => mutateLayer(() => {
    const sourceId = button.dataset.chLayerDuplicate;
    const copy = duplicateLayer(lb.composition, sourceId);
    if (copy && lb.layerEffects[sourceId]) lb.layerEffects[copy.id] = { ...editStateSnapshot(lb.layerEffects[sourceId]), bokeh: lb.layerEffects[sourceId].bokeh ? { ...lb.layerEffects[sourceId].bokeh, spots: lb.layerEffects[sourceId].bokeh.spots.map((spot) => ({ ...spot })) } : null };
  }));
  root.querySelectorAll("[data-ch-layer-delete]").forEach((button) => button.onclick = () => mutateLayer(() => {
    selectLayer(lb.composition, button.dataset.chLayerDelete);
    removeSelectedLayers(lb.composition);
  }));

  root.querySelectorAll("[data-ch-layer-prop]").forEach((input) => {
    let before = null;
    const capture = () => { if (!before) before = editorSnapshot(lb); };
    input.addEventListener("pointerdown", capture);
    input.addEventListener("focus", capture);
    input.oninput = () => {
      const layer = selectedLayers(lb.composition)[0];
      if (!layer || lb.composition.selectedIds.length !== 1) return;
      const key = input.dataset.chLayerProp;
      const raw = Number(input.value);
      layer[key] = ["x", "y", "w", "h", "opacity", "backgroundOpacity", "radius"].includes(key) ? raw / 100 : raw;
      const output = root.querySelector(`[data-ch-layer-out="${key}"]`);
      if (output) output.textContent = input.value;
      repaint();
    };
    input.onchange = () => { if (before) commitEditorChange(lb, before); before = null; };
  });
  root.querySelectorAll("[data-ch-layer-field]").forEach((field) => {
    const apply = () => {
      const layer = selectedLayers(lb.composition)[0];
      if (!layer || lb.composition.selectedIds.length !== 1) return;
      const before = editorSnapshot(lb);
      layer[field.dataset.chLayerField] = field.value;
      commitEditorChange(lb, before);
      repaint();
    };
    field.addEventListener(field.type === "color" ? "input" : "change", apply);
    if (field.tagName === "TEXTAREA") field.addEventListener("input", apply);
  });
  root.querySelectorAll("[data-ch-layer-color]").forEach((button) => button.onclick = () => mutateLayer(() => {
    const layer = selectedLayers(lb.composition)[0];
    if (layer?.type === "color") layer.color = button.dataset.chLayerColor;
  }));
  root.querySelectorAll("[data-ch-layer-toggle]").forEach((button) => button.onclick = () => mutateLayer(() => {
    const layer = selectedLayers(lb.composition)[0];
    if (layer) layer[button.dataset.chLayerToggle] = !layer[button.dataset.chLayerToggle];
  }));

  root.querySelector("[data-ch-editor-undo]")?.addEventListener("click", () => { if (editorUndo(lb)) rerender(); });
  root.querySelector("[data-ch-editor-redo]")?.addEventListener("click", () => { if (editorRedo(lb)) rerender(); });
  root.querySelectorAll("[data-ch-editor-zoom]").forEach((button) => button.onclick = () => {
    zoomComposition(lb.composition, Number(button.dataset.chEditorZoom));
    applyEditorZoom();
    positionMarkers();
  });
  root.querySelector("[data-ch-editor-fit]")?.addEventListener("click", () => { lb.composition.zoom = 1; applyEditorZoom(); positionMarkers(); });
  root.querySelectorAll("[data-ch-canvas-preset]").forEach((button) => button.onclick = () => mutateLayer(() => {
    const [width, height] = button.dataset.chCanvasPreset.split("x").map(Number);
    setCanvasPreset(lb.composition, width, height);
  }));
  if (editorStage) editorStage.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomComposition(lb.composition, event.deltaY < 0 ? 0.1 : -0.1);
    applyEditorZoom();
    positionMarkers();
  }, { passive: false });

  if (overlay) overlay.onpointerdown = (event) => {
    if (lb.bokehPicking) return;
    const point = canvasPoint(event, canvas);
    const rect = canvas.getBoundingClientRect();
    const handle = hitTestResizeHandle(lb.composition, point, canvas, rect.width / canvas.width);
    const hit = handle?.layer || hitTestLayer(lb.composition, point, canvas);
    const before = editorSnapshot(lb);
    if (hit) selectLayer(lb.composition, hit.id, !handle && (event.shiftKey || event.ctrlKey || event.metaKey));
    else selectLayer(lb.composition, null);
    const targets = selectedLayers(lb.composition).filter((layer) => !layer.locked);
    const starts = targets.map((layer) => ({ layer, x: layer.x, y: layer.y, w: layer.w, h: layer.h }));
    const start = point;
    overlay.setPointerCapture?.(event.pointerId);
    overlay.classList.add("is-dragging");
    overlay.onpointermove = (moveEvent) => {
      const next = canvasPoint(moveEvent, canvas);
      const dx = next.x - start.x;
      const dy = next.y - start.y;
      if (handle && starts.length === 1) {
        const item = starts[0];
        item.layer.w = Math.max(0.05, item.w + dx * (handle.index === 0 || handle.index === 3 ? -2 : 2));
        item.layer.h = Math.max(0.05, item.h + dy * (handle.index === 0 || handle.index === 1 ? -2 : 2));
      } else {
        starts.forEach((item) => { item.layer.x = item.x + dx; item.layer.y = item.y + dy; });
      }
      repaint();
    };
    overlay.onpointerup = () => {
      overlay.classList.remove("is-dragging");
      overlay.onpointermove = null;
      overlay.onpointerup = null;
      commitEditorChange(lb, before);
      rerender();
    };
  };

  root.querySelectorAll("[data-ch-lb-slider]").forEach((slider) => {
    let before = null;
    const capture = () => { if (!before) before = editorSnapshot(lb); };
    slider.addEventListener("pointerdown", capture);
    slider.addEventListener("focus", capture);
    slider.oninput = () => {
      s[slider.dataset.chLbSlider] = +slider.value;
      repaint();
      const out = root.querySelector(`[data-out="${slider.dataset.chLbSlider}"]`);
      if (out) out.textContent = slider.value;
    };
    slider.onchange = () => { if (before) commitEditorChange(lb, before); before = null; };
  });
  root.querySelectorAll("[data-ch-lb-rot]").forEach((b) => b.onclick = () => mutateLayer(() => { s.rotate = (s.rotate + (+b.dataset.chLbRot) + 360) % 360; }));
  const flip = root.querySelector("[data-ch-lb-flip]");
  if (flip) flip.onclick = () => mutateLayer(() => { s.flip = !s.flip; });
  root.querySelectorAll("[data-ch-lb-filter] button").forEach((b) => b.onclick = () => {
    const before = editorSnapshot(lb);
    applyFilterPreset(b.dataset.v, s);
    root.querySelectorAll("[data-ch-lb-slider]").forEach((slider) => {
      slider.value = s[slider.dataset.chLbSlider];
      const out = root.querySelector(`[data-out="${slider.dataset.chLbSlider}"]`);
      if (out) out.textContent = slider.value;
    });
    commitEditorChange(lb, before);
    repaint();
  });
  const textInput = root.querySelector("[data-ch-lb-text]");
  if (textInput) {
    let before = null;
    textInput.onfocus = () => { before = editorSnapshot(lb); };
    textInput.oninput = () => {
      s.text = textInput.value;
      lb.layers = { image: true, cutout: true, bokeh: true, text: true, ...(lb.layers || {}), text: true };
      repaint();
    };
    textInput.onchange = () => { if (before) commitEditorChange(lb, before); before = null; };
  }
  root.querySelectorAll("[data-ch-lb-text-field]").forEach((field) => {
    const apply = () => {
      const key = field.dataset.chLbTextField;
      s.textStyle = { ...freshTextStyle(), ...(s.textStyle || {}), [key]: field.value, preset: "custom" };
      repaint();
    };
    field.addEventListener(field.type === "color" ? "input" : "change", apply);
  });
  root.querySelectorAll("[data-ch-lb-text-toggle]").forEach((btn) => btn.onclick = () => mutateLayer(() => {
    const key = btn.dataset.chLbTextToggle;
    const st = { ...freshTextStyle(), ...(s.textStyle || {}) };
    s.textStyle = { ...st, [key]: !st[key], preset: "custom" };
  }));
  root.querySelectorAll("[data-ch-lb-tslider]").forEach((slider) => slider.oninput = () => {
    const key = slider.dataset.chLbTslider;
    s.textStyle = { ...freshTextStyle(), ...(s.textStyle || {}), [key]: +slider.value, preset: "custom" };
    repaint();
    const out = root.querySelector(`[data-tout="${key}"]`);
    if (out) out.textContent = slider.value;
  });
  root.querySelectorAll("[data-ch-lb-text-preset]").forEach((btn) => btn.onclick = () => {
    const before = editorSnapshot(lb);
    applyTextPreset(s, btn.dataset.chLbTextPreset);
    commitEditorChange(lb, before);
    rerender();
  });

  const pickHint = root.querySelector("[data-ch-lb-pick-hint]");
  if (lb.bokehPicking) { overlay?.classList.add("is-picking"); if (pickHint) pickHint.hidden = false; }
  root.querySelectorAll("[data-ch-lb-bokeh-pick]").forEach((b) => b.onclick = () => {
    lb.bokehPicking = !lb.bokehPicking;
    if (lb.bokehPicking && selectedLayer) {
      lb.layers = { ...(lb.layers || {}), [`bokeh:${selectedLayer.id}`]: true };
    } else {
      lb.selectedSpot = null;
      lb.bokehCursor = null;
    }
    rerender();
  });
  const bokehOff = root.querySelector("[data-ch-lb-bokeh-off]");
  if (bokehOff) bokehOff.onclick = () => {
    s.bokeh = null; if (selectedLayer) delete lb.subjectMaskUrls[selectedLayer.id]; lb.selectedSpot = null; lb.subjectHint = null; lb.subjectEstimated = false;
    lb.bokehDetect = { status: lb.bokehDetect.status === "unavailable" ? "unavailable" : "idle", message: "" };
    repaint(); rerender();
  };
  root.querySelectorAll("[data-ch-lb-bslider]").forEach((slider) => slider.oninput = () => {
    const key = slider.dataset.chLbBslider;
    if (key === "r") { s.bokehBrush = +slider.value; if (lb.selectedSpot != null) { resizeBokehSpot(s, lb.selectedSpot, +slider.value / 100); repaint(); } }
    else if (key === "spotR") { if (lb.selectedSpot != null) { resizeBokehSpot(s, lb.selectedSpot, +slider.value / 100); repaint(); } }
    else if (key === "feather") { if (s.bokeh) { s.bokeh.feather = +slider.value / 100; repaint(); } }
    else if (s.bokeh) { s.bokeh.strength = +slider.value; repaint(); }
    const out = root.querySelector(`[data-bout="${key}"]`);
    if (out) out.textContent = slider.value;
  });
  const rememberSize = root.querySelector("[data-ch-lb-remember-size]");
  if (rememberSize) rememberSize.onchange = () => { lb.rememberBokehSize = rememberSize.checked; };
  const removeSelected = root.querySelector("[data-ch-lb-bokeh-remove-selected]");
  if (removeSelected) removeSelected.onclick = () => {
    if (lb.selectedSpot != null) { removeBokehSpotAt(s, lb.selectedSpot); lb.selectedSpot = null; repaint(); rerender(); }
  };
  const editHitSurface = overlay || canvas;
  const trackBokehBrush = (event) => {
    if (!lb.bokehPicking) return;
    const rect = canvas.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    lb.bokehCursor = inside ? canvasPoint(event, canvas) : null;
    positionBrushCursor();
  };
  // Track on the whole stage in capture mode. Existing focus markers sit above
  // the canvas and must not interrupt the live brush preview.
  editorStage?.addEventListener("pointermove", trackBokehBrush, true);
  editorStage?.addEventListener("pointerleave", () => {
    if (!lb.bokehPicking) return;
    lb.bokehCursor = null;
    positionBrushCursor();
  });
  editHitSurface.onclick = (event) => {
    if (!selectedLayer) return;
    const local = canvasPointToLayer(selectedLayer, canvasPoint(event, canvas), canvas);
    const { x, y } = local;
    if (lb.bokehPicking) {
      const brush = lb.rememberBokehSize ? (s.bokehBrush || 12) / 100 : 0.12;
      const idx = addBokehSpot(s, x, y, brush);
      lb.selectedSpot = idx;
      repaint();
      rerender();
      return;
    }
    // not adding — a click near an existing spot selects it for resize/remove
    const near = nearestBokehSpot(s, x, y, 0.12);
    if (near !== lb.selectedSpot) { lb.selectedSpot = near === -1 ? null : near; rerender(); }
  };
  editHitSurface.oncontextmenu = (event) => {
    if (!selectedLayer || !s.bokeh?.spots?.length) return;
    event.preventDefault();
    const { x, y } = canvasPointToLayer(selectedLayer, canvasPoint(event, canvas), canvas);
    if (removeBokehSpotNear(s, x, y)) { lb.selectedSpot = null; repaint(); rerender(); }
  };
  // drag an existing marker to reposition its spot. repaint() is safe to call
  // on every pointermove (it only repaints the canvas + repositions markers
  // in place); rerender() fully rebuilds the DOM (including this canvas
  // reference), so it's deferred to pointerup — calling it mid-drag would
  // invalidate `canvas` for the rest of the gesture.
  if (markerLayer) markerLayer.onpointerdown = (event) => {
    const marker = event.target.closest("[data-spot-index]");
    if (!marker) return;
    const index = +marker.dataset.spotIndex;
    event.preventDefault();
    lb.selectedSpot = index;
    const move = (e) => {
      if (!selectedLayer) return;
      const point = canvasPointToLayer(selectedLayer, canvasPoint(e, canvas), canvas);
      moveBokehSpot(s, index, point.x, point.y);
      repaint();
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      rerender();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const aiRun = root.querySelector("[data-ch-lb-ai-run]");
  const runAiEdit = async (promptOverride = "") => {
    const q = (promptOverride || root.querySelector("[data-ch-lb-ai]")?.value || "").trim();
    const target = selectedImageLayer(lb);
    if (!q || !target || lb.aiEdit.mode !== "connected") return;
    const source = await selectedImageSource(lb, canvas);
    if (!source) {
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: "The selected image layer could not be read." };
      rerender();
      return;
    }
    const sourceFrame = renderBaseFrame(source.image, layerEditState(lb, target.id));
    const exported = await exportCanvas(sourceFrame, () => {}, "image/png");
    if (chLightbox !== lb) return;
    if (!exported.ok) {
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: exported.error };
      rerender();
      return;
    }
    const before = editorSnapshot(lb);
    lb.aiEdit = { ...lb.aiEdit, status: "loading" };
    rerender();
    const width = source.image.naturalWidth || source.image.width || 1;
    const height = source.image.naturalHeight || source.image.height || 1;
    const ratio = width / height;
    const aspect = ratio > 1.55 ? "16:9" : ratio > 1.15 ? "3:2" : ratio < 0.7 ? "9:16" : ratio < 0.9 ? "4:5" : "1:1";
    const result = await requestAiEdit({ dataUrl: exported.url, prompt: q, provider: lb.aiEdit.provider || "cinematic", aspect });
    if (chLightbox !== lb) return;
    if (!result.ok) {
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: result.message };
      rerender();
      opts.notify?.("Content Hub", `AI edit failed on "${asset.title}": ${result.message}`);
      return;
    }
    try {
      const editedImg = await loadImageForEditing(result.url);
      if (chLightbox !== lb) return;
      if (target.type === "base") {
        lb.baseUrl = result.url;
        lb.cutoutUrl = "";
        lb.hasTransparency = false;
        canvas._img = editedImg;
      } else {
        replaceImageLayerSource(lb.composition, target.id, result.url, editedImg);
      }
      commitEditorChange(lb, before);
      lb.aiEdit = { ...lb.aiEdit, status: "success", message: "" };
      repaint();
      rerender();
      opts.notify?.("Content Hub", `AI edited the selected layer in "${asset.title}".`);
    } catch {
      if (chLightbox !== lb) return;
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: "The media engine returned an image that could not be loaded." };
      rerender();
    }
  };
  if (aiRun) aiRun.onclick = () => runAiEdit();
  root.querySelectorAll("[data-ch-ai-preset]").forEach((button) => button.onclick = () => runAiEdit(button.dataset.chAiPreset));

  const applyRembgAvailability = (status) => {
    if (chLightbox !== lb) return;
    const available = !!status?.available;
    if (lb.bg.status === "checking" || lb.bg.status === "unavailable" || lb.bg.status === "idle") {
      lb.bg = {
        status: available ? "idle" : "unavailable",
        message: available ? "" : (status?.error || "The local image engine is not ready yet."),
      };
    }
    if (lb.bokehDetect.status === "idle" || lb.bokehDetect.status === "unavailable") {
      lb.bokehDetect = {
        status: available ? "idle" : "unavailable",
        message: available ? "" : (status?.error || "Subject detection is waiting for the local image engine."),
      };
    }
    rerender();
  };

  const refreshRembgAvailability = async ({ force = false, retryOnce = false } = {}) => {
    if (force && chLightbox === lb) {
      lb.bg = { status: "checking", message: "" };
      rerender();
    }
    let status = await getRembgStatus({ recheck: force });
    if (!status.available && retryOnce) {
      // The editor can mount while owner-session verification is still
      // settling. One short forced retry prevents that transient race from
      // becoming a permanent dead control for the rest of the lightbox.
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 650));
      if (chLightbox !== lb) return;
      status = await getRembgStatus({ recheck: true });
    }
    applyRembgAvailability(status);
  };

  const bgRecheck = root.querySelector("[data-ch-lb-rembg-recheck]");
  if (bgRecheck) bgRecheck.onclick = () => refreshRembgAvailability({ force: true });

  const bgRun = root.querySelector("[data-ch-lb-bg-run]");
  if (bgRun) bgRun.onclick = async () => {
    if (lb.bg.status === "unavailable") return;
    const source = await selectedImageSource(lb, canvas);
    if (chLightbox !== lb) return;
    if (!source) {
      lb.bg = { status: "error", message: "Select one loaded image layer first." };
      rerender();
      return;
    }
    lb.bg = { ...lb.bg, status: "loading", targetLayerId: source.layer.id, targetName: source.layer.name };
    rerender();
    const exported = await exportSourceImage(source.image);
    if (chLightbox !== lb) return;
    if (!exported.ok) {
      lb.bg = { status: "error", message: exported.error };
      rerender();
      opts.notify?.("Content Hub", `Background removal failed on "${asset.title}": ${exported.error}`);
      return;
    }
    const beforeUrl = exported.url;
    const result = await requestRemoveBackground(beforeUrl);
    if (chLightbox !== lb) return;
    if (!result.ok) {
      lb.bg = { status: "error", message: result.message };
      rerender();
      opts.notify?.("Content Hub", `Background removal failed on "${asset.title}": ${result.message}`);
      return;
    }
    lb.bg = { status: "preview", beforeUrl, afterUrl: result.image, targetLayerId: source.layer.id, targetName: source.layer.name };
    rerender();
  };
  const bgApply = root.querySelector("[data-ch-lb-bg-apply]");
  if (bgApply) bgApply.onclick = () => {
    const afterUrl = lb.bg.afterUrl;
    if (!afterUrl) return;
    loadImageForEditing(afterUrl).then((afterImg) => {
      if (chLightbox !== lb) return;
      const targetId = lb.bg.targetLayerId || "base";
      const target = lb.composition.layers.find((layer) => layer.id === targetId);
      if (!target || (target.type !== "base" && target.type !== "image")) {
        lb.bg = { status: "error", message: "That image layer no longer exists." };
        rerender();
        return;
      }
      const before = editorSnapshot(lb);
      if (target.type === "base") {
        lb.cutoutUrl = afterUrl;
        lb.layers = { image: true, cutout: true, bokeh: true, text: true, ...(lb.layers || {}), cutout: true };
        canvas._img = afterImg;
      } else {
        replaceImageLayerSource(lb.composition, target.id, afterUrl, afterImg, { transparent: true });
      }
      lb.bg = { status: "applied", message: "", targetLayerId: target.id, targetName: target.name };
      lb.hasTransparency = true;
      commitEditorChange(lb, before);
      repaint();
      rerender();
      opts.notify?.("Content Hub", `removed the background from "${target.name}".`);
    }).catch(() => {
      if (chLightbox !== lb) return;
      lb.bg = { status: "error", message: "The cutout image could not be loaded." };
      rerender();
    });
  };
  const bgCancel = root.querySelector("[data-ch-lb-bg-cancel]");
  if (bgCancel) bgCancel.onclick = () => { lb.bg = { status: "idle", message: "" }; rerender(); };

  const bokehDetect = root.querySelector("[data-ch-lb-bokeh-detect]");
  if (bokehDetect) bokehDetect.onclick = async () => {
    if (!selectedLayer || lb.bokehDetect.status === "unavailable") return;
    lb.bokehDetect = { status: "loading", message: "" };
    rerender();
    const source = await selectedImageSource(lb, canvas);
    if (chLightbox !== lb) return;
    if (!source) {
      lb.bokehDetect = { status: "error", message: "Select one loaded image layer first." };
      rerender();
      return;
    }
    const sourceFrame = renderBaseFrame(source.image, s);
    const exported = await exportCanvas(sourceFrame, () => {}, "image/png");
    if (!exported.ok) {
      lb.bokehDetect = { status: "error", message: exported.error };
      rerender();
      opts.notify?.("Content Hub", `AI subject detection failed on "${asset.title}": ${exported.error}`);
      return;
    }
    const result = await requestRemoveBackground(exported.url);
    if (chLightbox !== lb) return;
    if (!result.ok) {
      lb.bokehDetect = { status: "error", message: result.message };
      rerender();
      opts.notify?.("Content Hub", `AI subject detection failed on "${asset.title}": ${result.message}`);
      return;
    }
    try {
      const maskImg = await loadImage(result.image);
      if (chLightbox !== lb) return;
      setBokehMask(s, maskImg);
      s.bokeh.spots = [];
      lb.subjectMaskUrls[selectedLayer.id] = result.image;
      lb.selectedSpot = null;
      lb.bokehPicking = false;
      lb.subjectHint = "Subject selected. The mint silhouette is an editor-only guide; the clean edge and background blur are baked into Save or Download.";
      lb.layers = { ...(lb.layers || {}), [`bokeh:${selectedLayer.id}`]: true };
      lb.bokehDetect = { status: "success", message: "" };
      repaint();
      rerender();
      opts.notify?.("Content Hub", `AI-detected the subject on "${asset.title}" for bokeh.`);
    } catch {
      if (chLightbox !== lb) return;
      lb.bokehDetect = { status: "error", message: "The detected subject image could not be loaded." };
      rerender();
    }
  };

  // Probe real media services exactly once per lightbox session — never on every
  // keystroke/rerender. Both probes are honest: unreachable/unconfigured
  // always resolves to "unavailable", never a fake "connected" state.
  if (!lb._probed) {
    lb._probed = true;
    probeAiEditBackend().then((r) => {
      if (chLightbox !== lb) return;
      // mode is the persistent connectivity classification: connected or
      // unavailable. status is the transient state of the current
      // action (idle/loading/error/success/local-applied) layered on top.
      lb.aiEdit = { mode: r.mode, status: "idle", message: "", provider: r.provider };
      rerender();
    });
    refreshRembgAvailability({ retryOnce: true });
  }

  root.querySelector("[data-ch-lb-reset]").onclick = () => { chLightbox = freshLightbox(asset, { showTutorial: lb.showTutorial }); rerender(); };
  const exportsTransparent = () => !!(lb.hasTransparency && (
    (lb.cutoutUrl && layerVisible(lb, "cutout"))
    || lb.composition.layers.some((layer) => layer.type === "image" && layer.visible && layer.hasTransparency)
  ));
  const exportFormat = () => exportsTransparent() ? "image/png" : "image/webp";
  const exportExt = () => exportsTransparent() ? "png" : "webp";
  const repaintWithImg = (img) => { canvas._img = img; repaint(); };
  root.querySelector("[data-ch-lb-download]").onclick = async () => {
    const exported = await exportCanvas(canvas, repaintWithImg, exportFormat(), 0.92);
    if (chLightbox !== lb) return;
    if (!exported.ok) { opts.notify?.("Content Hub", `Couldn't download "${asset.title}": ${exported.error}`); return; }
    const link = document.createElement("a");
    link.href = exported.url;
    link.download = `phantomforce-${asset.id}.${exportExt()}`;
    link.click();
  };
  root.querySelector("[data-ch-lb-save]").onclick = async () => {
    const exported = await exportCanvas(canvas, repaintWithImg, exportFormat(), 0.9);
    if (chLightbox !== lb) return;
    if (!exported.ok) { opts.notify?.("Content Hub", `Couldn't save "${asset.title}": ${exported.error}`); return; }
    registerContentAsset({ ...asset, url: exported.url, prompt: s.text || asset.prompt, saved: true, syncedId: "", trimmed: false, updatedAt: Date.now() });
    // close (and its rerender) must run before notify(), since notify() triggers a global
    // store-change listener that can fully remount this page and invalidate this closure's
    // DOM references — closing first ensures the lightbox-closed state lands on live DOM.
    close();
    opts.notify?.("Content Hub", `saved your edit to "${asset.title}".`);
  };
  root.querySelector("[data-ch-lb-save-copy]").onclick = async () => {
    const exported = await exportCanvas(canvas, repaintWithImg, exportFormat(), 0.9);
    if (chLightbox !== lb) return;
    if (!exported.ok) { opts.notify?.("Content Hub", `Couldn't save a copy of "${asset.title}": ${exported.error}`); return; }
    const at = Date.now();
    registerContentAsset({ ...asset, id: `edit-${at}-${Math.random().toString(36).slice(2, 6)}`, url: exported.url, title: `${asset.title} (edit)`, prompt: s.text || asset.prompt, createdAt: at, saved: true, syncedId: "", trimmed: false });
    close();
    opts.notify?.("Content Hub", `saved a copy of "${asset.title}" with your edits.`);
  };
}
function visibleLibraryItems(shownAssets, shownPosts) {
  return [
    ...shownAssets.map((asset) => ({ kind: "asset", id: asset.id, asset, title: asset.title, type: asset.type, hasDownload: !!asset.url })),
    ...shownPosts.map((post) => ({ kind: "post", id: post.id, post, title: post.caption, type: post.type, hasDownload: false })),
  ];
}
function allLibraryItems(data, assets) {
  return [
    ...assets.map((asset) => ({ kind: "asset", id: asset.id, asset, title: asset.title, type: asset.type, hasDownload: !!asset.url })),
    ...data.posts.filter((post) => !isRemoved(`post:${post.id}`)).map((post) => ({ kind: "post", id: post.id, post, title: post.caption, type: post.type, hasDownload: false })),
  ];
}
function toggleLibrarySelection(key) {
  if (chSelection.has(key)) chSelection.delete(key);
  else chSelection.add(key);
}
function captureDeleteForUndo(deletedAssets, deletedPostIds) {
  if (!deletedAssets.length && !deletedPostIds.length) return;
  chLastDeleted = { assets: deletedAssets, postIds: deletedPostIds, at: Date.now() };
}
function undoLastDelete(root, opts) {
  if (!chLastDeleted) return;
  const { assets: restoredAssets, postIds } = chLastDeleted;
  if (restoredAssets.length) {
    const restored = restoreRecycledContentAssets(restoredAssets.map((asset) => asset.id));
    if (!restored.length) {
      const current = loadContentAssets();
      saveContentAssets([...restoredAssets, ...current.filter((a) => !restoredAssets.some((r) => r.id === a.id))]);
    }
  }
  if (postIds.length) {
    const removed = loadRemovedContent();
    postIds.forEach((id) => removed.delete(`post:${id}`));
    saveRemovedContent(removed);
  }
  const count = restoredAssets.length + postIds.length;
  chLastDeleted = null;
  renderContentHub(root, opts);
  opts.notify?.("Content Hub", `Restored ${count} item${count === 1 ? "" : "s"}.`);
}
function openAssetInMediaLabEditor(asset, opts = {}) {
  if (!asset?.url || asset.type !== "image") return false;
  try {
    workspaceStorageSetItem(CH_MEDIA_EDIT_INTENT_KEY, JSON.stringify({
      id: asset.id,
      url: asset.url,
      type: asset.type,
      title: asset.title,
      prompt: asset.prompt,
      source: asset.source || "Creator Hub",
      at: Date.now(),
    }));
  } catch {}
  opts.notify?.("Creator Hub", `Opening ${asset.title || "image"} in Media Lab edit.`);
  opts.openWorkspace?.("media");
  return true;
}
function wireLibraryActions(body, data, assets, shownAssets, shownPosts, esc, root, opts) {
  const shownItems = visibleLibraryItems(shownAssets, shownPosts);
  const orderedKeys = shownItems.map((item) => selectionKey(item.kind, item.id));
  const allItems = allLibraryItems(data, assets);
  const rerender = () => renderContentHub(root, opts);

  // Standard OS selection conventions: click toggles/opens per the existing rules below,
  // Shift+click range-selects from the last-clicked item, Ctrl/Cmd+click toggles one item
  // without needing "select mode" first — both stop the event so the post-card open()
  // handler (wired separately in wirePostCards, registered after this) doesn't also fire.
  body.querySelectorAll("[data-ch-select-item]").forEach((card) => card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    const key = card.dataset.chSelectItem;
    const isRangeClick = event.shiftKey;
    const isToggleClick = event.ctrlKey || event.metaKey;
    const isHitBox = !!event.target.closest("[data-ch-select-hit]");
    if (!chState.selectMode && !isHitBox && !isRangeClick && !isToggleClick) {
      const asset = assets.find((a) => a.id === card.dataset.chAssetId);
      if (!asset || !asset.url) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (asset.type === "image") openAssetInMediaLabEditor(asset, opts);
      else { chLightbox = { asset, state: null, viewOnly: true }; rerender(); }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isRangeClick && chSelectAnchor && orderedKeys.includes(chSelectAnchor)) {
      const from = orderedKeys.indexOf(chSelectAnchor);
      const to = orderedKeys.indexOf(key);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i++) chSelection.add(orderedKeys[i]);
      } else {
        toggleLibrarySelection(key);
        chSelectAnchor = key;
      }
    } else {
      toggleLibrarySelection(key);
      chSelectAnchor = key;
    }
    chState.selectMode = true;
    rerender();
  }));

  // Ctrl/Cmd+A selects everything currently visible (the OS convention — "select all in
  // this view"); Ctrl/Cmd+Z undoes the most recent delete. Self-removes once this render's
  // body is no longer live, since there's no explicit "Content Hub unmounted" hook to hang
  // cleanup off of.
  if (chLibraryKeyHandler) document.removeEventListener("keydown", chLibraryKeyHandler);
  chLibraryKeyHandler = (event) => {
    if (!document.body.contains(body)) { document.removeEventListener("keydown", chLibraryKeyHandler); chLibraryKeyHandler = null; return; }
    const typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable;
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "a" || event.key === "A")) {
      event.preventDefault();
      shownItems.forEach((item) => chSelection.add(selectionKey(item.kind, item.id)));
      chState.selectMode = true;
      rerender();
    } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === "z" || event.key === "Z")) {
      event.preventDefault();
      undoLastDelete(root, opts);
    }
  };
  document.addEventListener("keydown", chLibraryKeyHandler);
  body.querySelectorAll("[data-ch-delete-asset]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.chDeleteAsset;
    const deleted = loadContentAssets().filter((asset) => asset.id === id);
    recycleContentAssets(deleted);
    chSelection.delete(selectionKey("asset", id));
    captureDeleteForUndo(deleted, []);
    // rerender before notify(): notify() triggers a global store-change listener that can
    // fully remount this page and invalidate this closure's DOM references.
    rerender();
    opts.notify?.("Content Hub", "Removed the selected local media item — Ctrl+Z to undo. No external file or post was touched.");
  }));
  body.querySelector("[data-ch-select-mode]")?.addEventListener("click", () => {
    chState.selectMode = !chState.selectMode;
    rerender();
  });
  body.querySelector("[data-ch-select-all]")?.addEventListener("click", () => {
    shownItems.forEach((item) => chSelection.add(selectionKey(item.kind, item.id)));
    chState.selectMode = true;
    rerender();
  });
  body.querySelector("[data-ch-select-everything]")?.addEventListener("click", () => {
    allItems.forEach((item) => chSelection.add(selectionKey(item.kind, item.id)));
    chState.selectMode = true;
    opts.notify?.("Content Hub", `Selected all ${allItems.length} local content item${allItems.length === 1 ? "" : "s"}.`);
    rerender();
  });
  body.querySelector("[data-ch-clear-selected]")?.addEventListener("click", () => {
    chSelection.clear();
    rerender();
  });
  body.querySelector("[data-ch-download-selected]")?.addEventListener("click", () => {
    const selected = selectedLibraryItems(data, loadContentAssets());
    downloadLibraryItems(selected, "selected");
    opts.notify?.("Content Hub", `Downloaded/exported ${selected.length} selected item${selected.length === 1 ? "" : "s"}.`);
  });
  body.querySelector("[data-ch-download-all]")?.addEventListener("click", () => {
    downloadLibraryItems(shownItems, "shown");
    opts.notify?.("Content Hub", `Downloaded/exported ${shownItems.length} visible item${shownItems.length === 1 ? "" : "s"}.`);
  });
  body.querySelector("[data-ch-export-selected]")?.addEventListener("click", () => {
    const selected = selectedLibraryItems(data, loadContentAssets());
    exportLibraryItems(selected, "selected");
    opts.notify?.("Content Hub", "Exported a local selected-content packet.");
  });
  body.querySelector("[data-ch-save-selected]")?.addEventListener("click", () => {
    const ids = new Set(selectedLibraryItems(data, loadContentAssets()).filter((item) => item.kind === "asset").map((item) => item.id));
    setSelectedAssetMetadata(ids, { saved: true });
    opts.notify?.("Content Hub", `Saved ${ids.size} media item${ids.size === 1 ? "" : "s"} locally.`);
    rerender();
  });
  body.querySelector("[data-ch-batch-edit]")?.addEventListener("click", () => {
    const ids = new Set(selectedLibraryItems(data, loadContentAssets()).filter((item) => item.kind === "asset").map((item) => item.id));
    setSelectedAssetMetadata(ids, { batchLabel: "batch edit ready" });
    opts.notify?.("Content Hub", `Marked ${ids.size} media item${ids.size === 1 ? "" : "s"} for batch edit.`);
    rerender();
  });
  body.querySelector("[data-ch-batch-ai]")?.addEventListener("click", () => {
    const ids = new Set(selectedLibraryItems(data, loadContentAssets()).filter((item) => item.kind === "asset").map((item) => item.id));
    setSelectedAssetMetadata(ids, { aiEditPlan: "Local AI edit plan drafted; external generation still gated." });
    exportLibraryItems(selectedLibraryItems(data, loadContentAssets()).filter((item) => item.kind === "asset" && ids.has(item.id)), "batch-ai-edit-plan");
    opts.notify?.("Content Hub", "Created a local batch AI edit plan. No external generation ran.");
    rerender();
  });
  body.querySelector("[data-ch-edit-selected]")?.addEventListener("click", () => {
    const assetItem = selectedLibraryItems(data, loadContentAssets()).find((item) => item.kind === "asset" && item.asset.type === "image" && item.asset.url);
    if (!assetItem) {
      opts.notify?.("Content Hub", "Select an image with a live preview to open it in the local editor.");
      return;
    }
    openAssetInMediaLabEditor(assetItem.asset, opts);
  });
  body.querySelector("[data-ch-delete-selected]")?.addEventListener("click", () => {
    const selected = selectedLibraryItems(data, loadContentAssets());
    const assetIds = new Set(selected.filter((item) => item.kind === "asset").map((item) => item.id));
    const postIds = selected.filter((item) => item.kind === "post").map((item) => item.id);
    const deletedAssets = loadContentAssets().filter((asset) => assetIds.has(asset.id));
    if (assetIds.size) recycleContentAssets(deletedAssets);
    if (postIds.length) {
      const removed = loadRemovedContent();
      postIds.forEach((id) => removed.add(`post:${id}`));
      saveRemovedContent(removed);
    }
    captureDeleteForUndo(deletedAssets, postIds);
    chSelection.clear();
    chState.selectMode = false;
    // rerender before notify(): notify() triggers a global store-change listener that can
    // fully remount this page and invalidate this closure's DOM references.
    rerender();
    opts.notify?.("Content Hub", `Removed ${selected.length} local content item${selected.length === 1 ? "" : "s"} — Ctrl+Z to undo. No external post or file was touched.`);
  });
  const uploadInput = body.querySelector("[data-ch-upload-input]");
  body.querySelector("[data-ch-upload-local]")?.addEventListener("click", () => uploadInput?.click());
  uploadInput?.addEventListener("change", async () => {
    const files = [...(uploadInput.files || [])].filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/"));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = await readFileAsDataUrl(file);
      registerContentAsset({
        id: `upload-${Date.now()}-${i}`,
        type: file.type.startsWith("video/") ? "video" : "image",
        title: file.name.replace(/\.[^.]+$/, "") || "Local upload",
        prompt: "Local file selected as a Publish source.",
        source: "Local upload",
        provider: "local",
        model: "browser-file",
        style: "Imported",
        url,
        saved: true,
      });
    }
    uploadInput.value = "";
    opts.notify?.("Creator Hub", `Added ${files.length} local file${files.length === 1 ? "" : "s"} as Publish source${files.length === 1 ? "" : "s"}.`);
    rerender();
  });
}
function wireCreatorActions(body, opts, root) {
  body.querySelectorAll("[data-ch-action]").forEach((btn) => btn.addEventListener("click", () => {
    const idea = activeIdeas().find((row) => row.id === btn.dataset.ideaId) || savedIdeas().find((row) => row.id === btn.dataset.ideaId) || activeIdeas()[Number(btn.dataset.ideaI || 0)];
    if (!idea) return;
    const action = btn.dataset.chAction === "approve-draft" ? "Draft prep reviewed" : "Draft prep started";
    opts.notify?.("Content Hub", `${action} for ${idea.title}. Safe preparation can continue automatically; no live post was sent.`);
    if (root) renderContentHub(root, opts);
  }));
  body.querySelectorAll("[data-ch-idea-save]").forEach((btn) => btn.addEventListener("click", () => {
    const idea = activeIdeas().find((row) => row.id === btn.dataset.chIdeaSave);
    if (!idea) return;
    saveIdeaForLater(idea);
    opts.notify?.("Content Hub", `Saved "${idea.title}" so tomorrow's refresh won't erase it.`);
    if (root) renderContentHub(root, opts);
  }));
  body.querySelector("[data-ch-add-idea]")?.addEventListener("click", () => {
    const title = body.querySelector("[data-ch-custom-title]")?.value || "";
    const angle = body.querySelector("[data-ch-custom-angle]")?.value || "";
    const idea = addCustomDailyIdea({ title, angle });
    if (!idea) {
      opts.notify?.("Content Hub", "Add a short idea title first.");
      return;
    }
    opts.notify?.("Content Hub", `Added "${idea.title}" to today's ideas. It clears tomorrow unless saved.`);
    if (root) renderContentHub(root, opts);
  });
  body.querySelector("[data-ch-refresh-ideas]")?.addEventListener("click", () => {
    refreshDailyIdeas();
    opts.notify?.("Content Hub", "Refreshed today's disposable idea batch.");
    if (root) renderContentHub(root, opts);
  });
}
function renderOverview(body, data, esc, root, opts) {
  const a = analyze(data.posts);
  const maxP = Math.max(1, ...a.byPlatform.map((p) => p.reach));
  body.innerHTML = `
    <div class="ch-kpis">
      ${kpi("Total reach", K(a.totals.reach), `${K(a.totals.impressions)} impressions`)}
      ${kpi("Engagement", K(a.totals.engagement), `${a.totals.engagementRate}% rate`)}
      ${kpi("Likes", K(a.totals.likes), `${K(a.totals.comments)} comments`)}
      ${kpi("Video views", K(a.totals.views), "reels · shorts · video")}
      ${kpi("Followers gained", "+" + K(a.totals.followers), "last 45 days", "good")}
    </div>
    <div class="ch-cols">
      <div class="ch-card">
        <div class="ch-card-h"><h3>Reach by platform</h3></div>
        <div class="ch-bars">
          ${a.byPlatform.map((p) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${p.color}"></i>${esc(p.name)}</span>
            <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * p.reach / maxP)}%;background:${p.color}"></span></span>
            <b class="ch-bar-val">${K(p.reach)}</b></div>`).join("")}
        </div>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Content mix</h3></div>
        <div class="ch-mix">
          ${a.byType.map((t) => `<div class="ch-mix-row"><span>${esc(t.label)}</span><span class="ch-mix-bar"><span style="width:${Math.round(100 * t.count / a.totals.posts)}%"></span></span><b>${t.count}</b></div>`).join("")}
        </div>
      </div>
    </div>
    <div class="ch-card">
      <div class="ch-card-h"><h3>Top posts</h3><span class="ch-src">by engagement</span></div>
      <div class="ch-grid">${a.topPosts.map((p) => postCard(p, esc)).join("")}</div>
    </div>`;
  wirePostCards(body, data, esc, root, opts);
}

function renderPlatforms(body, data, esc, root, opts) {
  const counts = {}; data.posts.forEach((p) => counts[p.platform] = (counts[p.platform] || 0) + 1);
  const chips = [["all", "All", data.posts.length]].concat(PLATFORMS.filter((p) => counts[p.id]).map((p) => [p.id, p.name, counts[p.id]]));
  if (!chips.find((c) => c[0] === chState.platform)) chState.platform = "all";
  const rows = data.posts.filter((p) => chState.platform === "all" || p.platform === chState.platform);
  const sub = chState.platform === "all" ? null : platStrip(rows, esc);
  body.innerHTML = `
    <div class="ch-chips" data-ch-plat>
      ${chips.map(([id, l, n]) => `<button class="ch-chip ${chState.platform === id ? "is-on" : ""}" data-v="${id}">${id !== "all" ? `<i class="ch-dot" style="background:${plat(id).color}"></i>` : ""}${esc(l)} <em>${n}</em></button>`).join("")}
    </div>
    ${sub || ""}
    <div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("") || `<p class="empty-line">No posts on this platform.</p>`}</div>`;
  body.querySelectorAll("[data-ch-plat] button").forEach((b) => b.onclick = () => { chState.platform = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}
function platStrip(rows, esc) {
  const pub = rows.filter((r) => r.status === "published");
  const s = (f) => pub.reduce((a, x) => a + f(x.metrics), 0);
  const p = plat(rows[0].platform);
  return `<div class="ch-platstrip" style="--pc:${p.color}">
    ${kpi("Reach", K(s((m) => m.reach)), p.handle)}
    ${kpi("Likes", K(s((m) => m.likes)), "")}
    ${kpi("Comments", K(s((m) => m.comments)), "")}
    ${kpi("Shares", K(s((m) => m.shares)), "")}
    ${kpi("Saves", K(s((m) => m.saves)), "")}
    ${kpi("Followers", "+" + K(s((m) => m.followersGained)), "")}
  </div>`;
}

function renderContentTypes(body, data, esc, root, opts) {
  const groups = [["all", "All"], ["image", "Images"], ["carousel", "Carousels"], ["reel", "Reels"], ["short", "Shorts"], ["video", "Videos"], ["story", "Stories"], ["text", "Posts"], ["article", "Articles"]];
  const counts = {}; data.posts.forEach((p) => counts[p.type] = (counts[p.type] || 0) + 1);
  const avail = groups.filter(([id]) => id === "all" || counts[id]);
  if (!avail.find((c) => c[0] === chState.ctype)) chState.ctype = "all";
  const rows = data.posts.filter((p) => chState.ctype === "all" || p.type === chState.ctype);
  body.innerHTML = `
    <div class="ch-chips" data-ch-type>
      ${avail.map(([id, l]) => `<button class="ch-chip ${chState.ctype === id ? "is-on" : ""}" data-v="${id}">${esc(l)} <em>${id === "all" ? data.posts.length : counts[id]}</em></button>`).join("")}
    </div>
    <div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("")}</div>`;
  body.querySelectorAll("[data-ch-type] button").forEach((b) => b.onclick = () => { chState.ctype = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}

function renderEngagement(body, data, esc, root, opts) {
  const tabs = [["likes", "Likes"], ["comments", "Comments"], ["reactions", "Reactions"], ["shares", "Shares & saves"]];
  if (!tabs.find((t) => t[0] === chState.eng)) chState.eng = "likes";
  const pub = data.posts.filter((p) => p.status === "published");
  let inner = "";
  if (chState.eng === "likes") {
    const rows = pub.slice().sort((a, b) => b.metrics.likes - a.metrics.likes);
    inner = `<div class="ch-table"><div class="ch-tr ch-th"><span>Post</span><span>Platform</span><span>${svgIc("heart")} Likes</span><span>Rate</span></div>
      ${rows.map((p) => `<button class="ch-tr" data-ch-open="${p.id}"><span class="ch-tr-post"><i class="ch-tr-thumb" style="${thumb(p)}"></i>${esc(p.caption)}</span>
        <span><i class="ch-dot" style="background:${plat(p.platform).color}"></i>${plat(p.platform).name}</span><span class="ch-num">${K(p.metrics.likes)}</span><span class="ch-num">${p.metrics.engagementRate}%</span></button>`).join("")}</div>`;
  } else if (chState.eng === "comments") {
    const stream = [];
    pub.forEach((p) => p.comments.forEach((c) => stream.push({ ...c, post: p })));
    stream.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    inner = `<div class="ch-comments">${stream.slice(0, 40).map((c) => `<div class="ch-comment ch-s-${c.sentiment}">
      <span class="ch-c-av">${esc(c.user[0].toUpperCase())}</span>
      <span class="ch-c-body"><b>@${esc(c.user)} <span class="ch-c-sent">${c.sentiment === "pos" ? "positive" : c.sentiment === "neg" ? "critical" : "neutral"}</span></b>
        <span class="ch-c-text">${esc(c.text)}</span>
        <span class="ch-c-meta"><i class="ch-dot" style="background:${plat(c.post.platform).color}"></i>${plat(c.post.platform).name} · ${esc(c.post.caption.slice(0, 28))}… · ${ago(c.at)} · ${svgIc("heart")} ${c.likes}</span></span></div>`).join("")}</div>`;
  } else if (chState.eng === "reactions") {
    const R = { like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0 };
    pub.forEach((p) => { if (p.metrics.reactions) for (const k in R) R[k] += p.metrics.reactions[k]; });
    const total = Object.values(R).reduce((a, b) => a + b, 0) || 1;
    const EMO = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😠" };
    inner = `<div class="ch-react">${Object.entries(R).map(([k, v]) => `<div class="ch-react-row"><span class="ch-react-emo">${EMO[k]}</span><span class="ch-react-lab">${k}</span>
      <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * v / total)}%"></span></span><b>${K(v)}</b></div>`).join("")}
      <p class="ch-src">Reactions from Facebook & LinkedIn posts. Others report likes only.</p></div>`;
  } else {
    const rows = pub.slice().sort((a, b) => (b.metrics.shares + b.metrics.saves) - (a.metrics.shares + a.metrics.saves));
    inner = `<div class="ch-table"><div class="ch-tr ch-th"><span>Post</span><span>Platform</span><span>${svgIc("share")} Shares</span><span>${svgIc("save")} Saves</span></div>
      ${rows.map((p) => `<button class="ch-tr" data-ch-open="${p.id}"><span class="ch-tr-post"><i class="ch-tr-thumb" style="${thumb(p)}"></i>${esc(p.caption)}</span>
        <span><i class="ch-dot" style="background:${plat(p.platform).color}"></i>${plat(p.platform).name}</span><span class="ch-num">${K(p.metrics.shares)}</span><span class="ch-num">${K(p.metrics.saves)}</span></button>`).join("")}</div>`;
  }
  body.innerHTML = `<div class="ch-chips" data-ch-eng>${tabs.map(([id, l]) => `<button class="ch-chip ${chState.eng === id ? "is-on" : ""}" data-v="${id}">${l}</button>`).join("")}</div>${inner}`;
  body.querySelectorAll("[data-ch-eng] button").forEach((b) => b.onclick = () => { chState.eng = b.dataset.v; renderContentHub(root, opts); });
  wirePostCards(body, data, esc, root, opts);
}

function renderScheduled(body, data, esc) {
  const rows = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  body.innerHTML = rows.length ? `<div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("")}</div>` : `<p class="empty-line">Nothing scheduled. Create a post in Publish and schedule it here.</p>`;
}

function postCard(p, esc, options = {}) {
  const P = plat(p.platform);
  const key = selectionKey("post", p.id);
  const selected = chSelection.has(key);
  return `<button class="ch-post ch-selectable ${selected ? "is-selected" : ""}" data-ch-open="${p.id}" data-ch-select-item="${esc(key)}">
    <span class="ch-select-box" data-ch-select-hit aria-hidden="true">${selected ? "✓" : ""}</span>
    <span class="ch-post-thumb" style="${thumb(p)}">
      <span class="ch-post-plat" style="background:${P.color}">${PGLYPH[p.platform] || "●"}</span>
      <span class="ch-post-type">${TYPES[p.type]}</span>
      ${isVideo(p.type) ? `<span class="ch-post-play">▶</span>` : ""}
      ${p.status === "scheduled" ? `<span class="ch-post-sched">Scheduled ${ago(p.publishedAt)}</span>` : ""}
    </span>
    <span class="ch-post-cap">${esc(p.caption)}</span>
    <span class="ch-post-meta">${P.name} · ${p.status === "scheduled" ? "upcoming" : ago(p.publishedAt)}</span>
    ${options.creator ? `<span class="ch-post-stats ch-post-creator">
      <span>${esc(TYPES[p.type])}</span>
      <span>${p.hashtags.slice(0, 2).map((h) => esc(h)).join(" ")}</span>
    </span>` : `<span class="ch-post-stats">
      <span>${svgIc("eye")}${K(p.metrics.reach)}</span>
      <span>${svgIc("heart")}${K(p.metrics.likes)}</span>
      <span>${svgIc("chat")}${K(p.metrics.comments)}</span>
      <span>${svgIc("share")}${K(p.metrics.shares)}</span>
    </span>`}
  </button>`;
}

function wirePostCards(body, data, esc, root, opts) {
  body.querySelectorAll("[data-ch-open]").forEach((b) => {
    const open = () => openPost(data.posts.find((p) => p.id === b.dataset.chOpen), esc);
    b.onclick = (event) => {
      if (chState.selectMode || event.target.closest("[data-ch-select-hit]")) {
        event.preventDefault();
        event.stopPropagation();
        toggleLibrarySelection(b.dataset.chSelectItem || selectionKey("post", b.dataset.chOpen));
        chState.selectMode = true;
        if (root) renderContentHub(root, opts);
        return;
      }
      open();
    };
    b.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (chState.selectMode) {
          toggleLibrarySelection(b.dataset.chSelectItem || selectionKey("post", b.dataset.chOpen));
          if (root) renderContentHub(root, opts);
        } else {
          open();
        }
      }
    };
  });
}
function openPost(p, esc) {
  if (!p) return;
  const P = plat(p.platform), m = p.metrics;
  let modal = document.querySelector("[data-ch-modal]");
  if (!modal) { modal = document.createElement("div"); modal.className = "ch-modal"; modal.setAttribute("data-ch-modal", ""); document.body.appendChild(modal); }
  const stat = (ic, lab, v) => `<div class="ch-dstat"><span>${svgIc(ic)} ${lab}</span><b>${K(v)}</b></div>`;
  modal.innerHTML = `<button class="ch-modal-bg" data-ch-x></button>
    <div class="ch-detail">
      <button class="ch-detail-x" data-ch-x>✕</button>
      <div class="ch-detail-media" style="${thumb(p)}"><span class="ch-post-plat" style="background:${P.color}">${PGLYPH[p.platform] || "●"}</span>${isVideo(p.type) ? `<span class="ch-post-play big">▶</span>` : ""}<span class="ch-post-type">${TYPES[p.type]}</span></div>
      <div class="ch-detail-side">
        <div class="ch-detail-h"><i class="ch-dot" style="background:${P.color}"></i><b>${P.name}</b><span>${P.handle}</span><em>${p.status === "scheduled" ? "Scheduled " + ago(p.publishedAt) : ago(p.publishedAt)}</em></div>
        <p class="ch-detail-cap">${esc(p.caption)}</p>
        <p class="ch-detail-tags">${p.hashtags.map((h) => `<span>${esc(h)}</span>`).join("")}</p>
        <div class="ch-dstats">
          ${stat("eye", "Reach", m.reach)}${stat("eye", "Impressions", m.impressions)}
          ${stat("heart", "Likes", m.likes)}${stat("chat", "Comments", m.comments)}
          ${stat("share", "Shares", m.shares)}${stat("save", "Saves", m.saves)}
          ${m.views ? stat("eye", "Views", m.views) : ""}${m.views ? `<div class="ch-dstat"><span>Avg watch</span><b>${m.watchAvg}s</b></div>` : ""}
          <div class="ch-dstat"><span>Eng. rate</span><b>${m.engagementRate}%</b></div>${stat("up", "Followers", m.followersGained)}
        </div>
        ${m.reactions ? `<div class="ch-detail-react">${Object.entries({ like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😠" }).map(([k, e]) => `<span>${e} ${K(m.reactions[k])}</span>`).join("")}</div>` : ""}
        <div class="ch-detail-cmh">Comments (${p.comments.length})</div>
        <div class="ch-detail-comments">${p.comments.map((c) => `<div class="ch-comment ch-s-${c.sentiment}"><span class="ch-c-av">${esc(c.user[0].toUpperCase())}</span><span class="ch-c-body"><b>@${esc(c.user)}</b><span class="ch-c-text">${esc(c.text)}</span><span class="ch-c-meta">${ago(c.at)} · ${svgIc("heart")} ${c.likes}</span></span></div>`).join("")}</div>
      </div>
    </div>`;
  modal.hidden = false;
  modal.querySelectorAll("[data-ch-x]").forEach((x) => x.onclick = () => { modal.hidden = true; modal.innerHTML = ""; });
}

/* =========================================================================
   ANALYTICS - official social platform data only. Local uploads, media drafts,
   websites, and Creator Hub records are not social analytics. A saved profile
   identifies a channel, but it is not API authorization.
   ========================================================================= */
const LIVE_ANALYTICS_PLATFORMS = new Set(PLATFORMS.map((platform) => platform.id));
const ANALYTICS_REFRESH_MS = 15 * 60 * 1000;
const analyticsConnectorState = {
  loaded: false,
  loading: false,
  connectors: [],
  preflight: null,
  error: "",
  /* per-platform sync outcome: { state: "synced"|"error", error, syncedAt } */
  sync: {},
};
const analyticsOAuthSetupState = {
  loaded: false,
  loading: false,
  setup: null,
  error: "",
};
function analyticsAuthHeaders(extra = {}) {
  const token = typeof session?.token === "function" ? session.token() : "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function analyticsApi(path, { method = "GET", body } = {}) {
  const response = await fetch(path, {
    method,
    headers: analyticsAuthHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in to check your live social connections.");
    if (response.status === 403) throw new Error("Only a business owner or admin can manage live social connections.");
    throw new Error(String(json?.error || `Analytics request failed (${response.status}).`));
  }
  return json;
}
function connectorStatus(platformId) {
  return analyticsConnectorState.connectors.find((connector) => connector.id === platformId) || null;
}
async function refreshAnalyticsOAuthSetup({ force = false } = {}) {
  if (analyticsOAuthSetupState.loading) return analyticsOAuthSetupState.setup;
  if (analyticsOAuthSetupState.loaded && !force) return analyticsOAuthSetupState.setup;
  analyticsOAuthSetupState.loading = true;
  analyticsOAuthSetupState.error = "";
  try {
    const response = await analyticsApi("/phantom-ai/ops/social-oauth/setup");
    analyticsOAuthSetupState.setup = response?.setup || null;
    analyticsOAuthSetupState.loaded = true;
  } catch (error) {
    analyticsOAuthSetupState.error = error?.message || "OAuth provider setup could not be checked.";
  } finally {
    analyticsOAuthSetupState.loading = false;
  }
  return analyticsOAuthSetupState.setup;
}
async function saveAnalyticsOAuthAppSetup({ platform, clientId, clientSecret, redirectUri }) {
  const response = await analyticsApi("/phantom-ai/ops/social-oauth/setup", {
    method: "POST",
    body: { platform, clientId, clientSecret, redirectUri },
  });
  analyticsOAuthSetupState.setup = response?.setup || null;
  analyticsOAuthSetupState.loaded = true;
  analyticsConnectorState.connectors = Array.isArray(response?.social_analytics?.connectors)
    ? response.social_analytics.connectors
    : analyticsConnectorState.connectors;
  analyticsConnectorState.preflight = response?.social_analytics?.oauthPreflight || analyticsConnectorState.preflight;
  analyticsConnectorState.loaded = false;
  await refreshAnalyticsConnectorStatus();
  return response;
}
function liveAnalyticsIsFresh(account = {}) {
  const synced = Date.parse(account?.analytics?.syncedAt || "");
  return account.connectMode === "live-api" && Number.isFinite(synced) && Date.now() - synced < ANALYTICS_REFRESH_MS;
}
async function syncLiveAnalyticsAccount(account, accounts) {
  const response = await analyticsApi("/phantom-ai/ops/social-analytics/sync", {
    method: "POST",
    body: { platform: account.id },
  });
  account.analytics = { ...response.analytics, live: true };
  account.enabled = true;
  account.connectMode = "live-api";
  account.officialConnectState = "connected";
  account.lastConnectAt = response.analytics?.syncedAt || new Date().toISOString();
  saveSocialAccounts(accounts);
  analyticsConnectorState.sync[account.id] = { state: "synced", error: "", syncedAt: account.lastConnectAt };
  return account.analytics;
}
async function refreshLiveAnalytics(el, accounts, opts, { force = false, platform = "" } = {}) {
  if (analyticsConnectorState.loading) return;
  analyticsConnectorState.loading = true;
  analyticsConnectorState.error = "";
  try {
    if (!analyticsConnectorState.loaded || force) {
      const response = await analyticsApi("/phantom-ai/ops/social-analytics/status");
      analyticsConnectorState.connectors = Array.isArray(response?.social_analytics?.connectors)
        ? response.social_analytics.connectors
        : [];
      analyticsConnectorState.preflight = response?.social_analytics?.oauthPreflight || null;
      analyticsConnectorState.loaded = true;
    }
    const ready = analyticsConnectorState.connectors.filter((connector) => connector.configured && (!platform || connector.id === platform));
    const failed = [];
    let syncedCount = 0;
    for (const connector of ready) {
      const account = accounts.find((row) => row.id === connector.id);
      if (!account) continue;
      if (!force && liveAnalyticsIsFresh(account)) {
        analyticsConnectorState.sync[connector.id] = { state: "synced", error: "", syncedAt: account.analytics?.syncedAt || "" };
        continue;
      }
      try {
        await syncLiveAnalyticsAccount(account, accounts);
        syncedCount += 1;
      } catch (error) {
        /* One channel failing must never hide another channel's live data:
           record the server's exact failure per platform and keep going. */
        analyticsConnectorState.sync[connector.id] = {
          state: "error",
          error: error?.message || "The platform analytics sync failed.",
          syncedAt: account.analytics?.syncedAt || "",
        };
        failed.push(connector.name || connector.id);
      }
    }
    if (force && platform && !ready.length) {
      const connector = connectorStatus(platform);
      throw new Error(connector?.reason || "Connect this channel in Settings before syncing live data.");
    }
    if (force) {
      analyticsNotice = !ready.length
        ? "No live social connector is configured yet."
        : failed.length
          ? `${syncedCount ? `${syncedCount} channel${syncedCount === 1 ? "" : "s"} synced. ` : ""}${failed.join(", ")} did not sync — the exact platform error is shown on each channel below.`
          : "Live platform data synced.";
    }
  } catch (error) {
    const message = error?.message || "Live analytics could not be reached.";
    analyticsConnectorState.error = force ? message : "";
    if (force) analyticsNotice = message;
  } finally {
    analyticsConnectorState.loading = false;
    if (el?.isConnected) renderAnalytics(el, opts, { skipAutoRefresh: true });
  }
}
function numericMetric(source = {}, keys = []) {
  const key = keys.find((name) => Number.isFinite(Number(source?.[name])));
  return key ? Number(source[key]) : 0;
}
function analyticsFeedForAccount(account = {}) {
  const raw = account.analytics || account.insights || account.metrics || null;
  if (!raw || typeof raw !== "object") return null;
  const reach = numericMetric(raw, ["reach", "accountsReached", "account_reach"]);
  const impressions = numericMetric(raw, ["impressions", "views", "profileViews"]);
  const likes = numericMetric(raw, ["likes", "likeCount"]);
  const comments = numericMetric(raw, ["comments", "commentCount"]);
  const shares = numericMetric(raw, ["shares", "shareCount"]);
  const saves = numericMetric(raw, ["saves", "saveCount"]);
  const followers = numericMetric(raw, ["followers", "followersGained", "followerCount"]);
  const engagement = numericMetric(raw, ["engagement", "engagements"]) || likes + comments + shares + saves;
  const hasMetrics = [reach, impressions, engagement, followers].some((value) => value > 0);
  if (!hasMetrics) return null;
  return {
    reach, impressions, engagement, followers,
    source: raw.source || raw.provider || "platform analytics",
    syncedAt: raw.syncedAt || raw.lastSyncedAt || raw.updatedAt || account.analyticsLastSyncAt || "",
    series: Array.isArray(raw.series) ? raw.series.slice(-90).map((point) => ({
      label: String(point?.label || ""),
      reach: numericMetric(point, ["reach"]),
      impressions: numericMetric(point, ["impressions"]),
      engagement: numericMetric(point, ["engagement"]),
      followers: numericMetric(point, ["followers"]),
    })) : [],
  };
}
function analyticsTotals(feeds = []) {
  return feeds.reduce((sum, row) => ({
    reach: sum.reach + row.feed.reach,
    impressions: sum.impressions + row.feed.impressions,
    engagement: sum.engagement + row.feed.engagement,
    followers: sum.followers + row.feed.followers,
  }), { reach: 0, impressions: 0, engagement: 0, followers: 0 });
}
function analyticsLinePath(values = [], maxValue = 1, width = 680, height = 190) {
  const points = values.length > 1 ? values : [0, ...(values.length ? values : [0]), 0];
  return points.map((value, index) => {
    const x = points.length === 1 ? 0 : index / (points.length - 1) * width;
    const y = height - 14 - (Number(value || 0) / Math.max(1, maxValue)) * (height - 30);
    return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}
function analyticsChart(feedRows = [], emptyCopy = {}) {
  const width = 680;
  const height = 190;
  const rows = feedRows.map((row) => ({
    ...row,
    values: row.feed?.series?.length
      ? row.feed.series.map((point) => point.reach || point.impressions || 0)
      : [0, 0, 0, 0, 0, 0, 0],
  }));
  const maxValue = Math.max(1, ...rows.flatMap((row) => row.values));
  return `
    <div class="an-chart-wrap ${rows.some((row) => row.feed) ? "has-data" : "is-empty"}">
      <svg class="an-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Reach and views trend">
        ${[.2, .4, .6, .8].map((fraction) => `<line class="an-grid-line" x1="0" x2="${width}" y1="${(height * fraction).toFixed(1)}" y2="${(height * fraction).toFixed(1)}"/>`).join("")}
        ${rows.map((row) => `<path class="an-channel-line ${row.feed ? "" : "is-waiting"}" style="--channel:${row.account.color}" d="${analyticsLinePath(row.values, maxValue, width, height)}"/>`).join("")}
      </svg>
      ${rows.some((row) => row.feed) ? "" : `<div class="an-chart-empty"><b>${emptyCopy.title || "Waiting for live performance"}</b><span>${emptyCopy.body || "Connect one social account and this chart updates automatically."}</span></div>`}
      <div class="an-chart-legend">${rows.map((row) => `<span><i style="background:${row.account.color}"></i>${row.account.name}${row.feed ? "" : " · waiting"}</span>`).join("")}</div>
    </div>`;
}
function analyticsCoverage(feedRows = []) {
  const count = feedRows.length || 1;
  const live = feedRows.filter((row) => row.feed).length;
  const stops = feedRows.map((row, index) => {
    const start = (index / count * 100).toFixed(2);
    const end = ((index + 1) / count * 100).toFixed(2);
    return `${row.feed ? row.account.color : "rgba(135,165,151,.13)"} ${start}% ${end}%`;
  }).join(",");
  return `<div class="an-coverage">
    <div class="an-coverage-ring" style="background:conic-gradient(${stops || "rgba(135,165,151,.13) 0 100%"})"><span><b>${live}/${feedRows.length}</b><i>reporting</i></span></div>
    <div class="an-coverage-copy"><b>Channel coverage</b><p>${live ? `${live} verified data source${live === 1 ? "" : "s"} active.` : "Connect your channels to activate reporting."}</p></div>
  </div>`;
}
let analyticsNotice = "";
let analyticsMount = null;
let analyticsOpts = {};
let socialOAuthListenerReady = false;
let analyticsOAuthPollTimer = 0;

async function refreshAnalyticsConnectorStatus() {
  const response = await analyticsApi("/phantom-ai/ops/social-analytics/status");
  analyticsConnectorState.connectors = Array.isArray(response?.social_analytics?.connectors)
    ? response.social_analytics.connectors
    : [];
  analyticsConnectorState.preflight = response?.social_analytics?.oauthPreflight || null;
  analyticsConnectorState.loaded = true;
  return analyticsConnectorState.connectors;
}

function stopAnalyticsOAuthPolling() {
  if (analyticsOAuthPollTimer) clearInterval(analyticsOAuthPollTimer);
  analyticsOAuthPollTimer = 0;
}

function markAnalyticsOAuthConnected(platform, connectedAt = "") {
  const accounts = loadSocialAccounts();
  const account = accounts.find((row) => row.id === platform);
  if (!account) return accounts;
  account.enabled = true;
  account.connectMode = "oauth-connected";
  account.officialConnectState = "connected";
  account.lastConnectAt = connectedAt || new Date().toISOString();
  saveSocialAccounts(accounts);
  return accounts;
}

function startAnalyticsOAuthPolling(platform = "") {
  if (typeof window === "undefined" || !platform) return;
  stopAnalyticsOAuthPolling();
  let attempts = 0;
  const tick = async () => {
    attempts += 1;
    if (!analyticsMount?.isConnected || attempts > 45) {
      stopAnalyticsOAuthPolling();
      return;
    }
    try {
      await refreshAnalyticsConnectorStatus();
      const connector = connectorStatus(platform);
      if (connector?.configured) {
        const accounts = markAnalyticsOAuthConnected(platform);
        analyticsNotice = `${connector.name || platform} connected. Syncing live analytics…`;
        stopAnalyticsOAuthPolling();
        await refreshLiveAnalytics(analyticsMount, accounts, analyticsOpts, { force: true, platform });
      } else if (attempts === 45) {
        analyticsNotice = `${connector?.name || platform} sign-in is still pending. Finish the provider approval, then tap Sync live feed.`;
        renderAnalytics(analyticsMount, analyticsOpts, { skipAutoRefresh: true });
      }
    } catch (error) {
      if (attempts >= 4) {
        analyticsConnectorState.error = error?.message || "Live social connection check failed.";
        renderAnalytics(analyticsMount, analyticsOpts, { skipAutoRefresh: true });
      }
    }
  };
  setTimeout(tick, 1400);
  analyticsOAuthPollTimer = setInterval(tick, 3500);
}

function handleSocialOAuthComplete(payload = {}) {
  const platform = String(payload.platform || "").toLowerCase();
  if (!platform) return;
  stopAnalyticsOAuthPolling();
  markAnalyticsOAuthConnected(platform, payload.connectedAt);
  analyticsNotice = `${connectorStatus(platform)?.name || platform} connected. Syncing live analytics…`;
  analyticsConnectorState.loaded = false;
  if (!analyticsMount?.isConnected) return;
  const accounts = loadSocialAccounts();
  void refreshLiveAnalytics(analyticsMount, accounts, analyticsOpts, { force: true, platform });
}
function parseSocialOAuthPayload(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}
function ensureSocialOAuthListener() {
  if (socialOAuthListenerReady || typeof window === "undefined") return;
  socialOAuthListenerReady = true;
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const data = parseSocialOAuthPayload(event.data);
    if (data?.protocol === "phantomforce.social-oauth.v1" && data.type === "connected") handleSocialOAuthComplete(data);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== "pf.social.oauth.last") return;
    const data = parseSocialOAuthPayload(event.newValue);
    if (data?.protocol === "phantomforce.social-oauth.v1" && data.type === "connected") handleSocialOAuthComplete(data);
  });
  const refreshWhenReturned = () => {
    if (!analyticsMount?.isConnected) return;
    const accounts = loadSocialAccounts();
    void refreshLiveAnalytics(analyticsMount, accounts, analyticsOpts, { force: true });
  };
  window.addEventListener("focus", refreshWhenReturned);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshWhenReturned();
  });
}
function accountAnalyticsRow(row, esc) {
  const account = row.account;
  const feed = row.feed;
  const saved = socialStatus(account) === "linked";
  const connector = connectorStatus(account.id);
  const live = account.connectMode === "live-api" && !!feed;
  const canSync = !!connector?.configured;
  const oauthReady = !!connector?.oauthConfigured;
  const syncOutcome = analyticsConnectorState.sync[account.id] || null;
  const syncFailed = syncOutcome?.state === "error";
  const sourceState = canSync
    ? (syncFailed ? "Live sync failed" : "Ready to sync")
    : oauthReady ? "Authorize account" : saved ? "Profile saved, analytics not connected" : account.handle ? "Handle saved, analytics not connected" : "Needs social connection";
  const sourceCopy = canSync
    ? (syncFailed ? syncOutcome.error : "Official read-only analytics are ready.")
    : oauthReady
      ? "OAuth app credentials exist; finish account authorization before stats appear."
      : "This channel needs the PhantomForce OAuth app configured before live analytics or posting approval can run.";
  const primaryAction = canSync
    ? `<button class="btn btn-primary" type="button" data-an-sync="${account.id}">${analyticsConnectorState.loading ? "Syncing…" : live ? "Sync now" : "Start live sync"}</button>`
    : oauthReady
      ? `<button class="btn btn-primary" type="button" data-an-oauth="${account.id}">Connect account</button>`
      : canManageSocialOAuthApps()
        ? `<button class="btn btn-ghost" type="button" data-open-ws="settings" data-settings-target="media">Open Settings</button>`
        : `<button class="btn btn-ghost" type="button" disabled>Owner setup needed</button>`;
  return `<article class="an-channel-row ${feed ? "is-live" : "is-missing"}">
    <div class="an-channel-id"><span class="ch-dot" style="background:${account.color}"></span><span><b>${esc(account.name)}</b><i>${esc(account.handle || account.loginIdentity || "profile saved")}</i></span></div>
    ${feed ? `<div class="an-channel-metrics">
      <span><b>${K(feed.reach)}</b>reach</span><span><b>${K(feed.impressions)}</b>views</span><span><b>${K(feed.engagement)}</b>engagement</span><span><b>${K(feed.followers)}</b>followers</span>
    </div><div class="an-channel-source"><b>${live ? "Live · " : "Report · "}${esc(feed.source)}</b><i>${feed.syncedAt ? `Synced ${esc(ago(feed.syncedAt))}` : "current"}</i>${syncFailed ? `<em class="an-sync-error">${esc(syncOutcome.error)}</em>` : ""}</div>`
    : `<div class="an-channel-empty${syncFailed ? " is-sync-error" : ""}"><b>${esc(sourceState)}</b><span>${esc(sourceCopy)}</span></div>`}
    <div class="an-channel-actions">
      ${primaryAction}
      ${feed ? `<button class="btn btn-ghost" type="button" data-an-clear="${account.id}">Clear data</button>` : ""}
    </div>
  </article>`;
}

function canManageSocialOAuthApps() {
  const active = ctx?.session || {};
  return Boolean(active.canManageAccess || active.isSuperAdmin);
}

function analyticsReadinessCopy({ hasLiveMetrics, configuredCount, oauthReadyCount, totalCount }) {
  if (hasLiveMetrics) {
    return {
      tone: "live",
      title: "Live feed is on.",
      body: "Official platform metrics are syncing from authorized social accounts. Posting still stays approval-gated.",
      action: `<button class="btn btn-primary" type="button" data-an-sync-all>${analyticsConnectorState.loading ? "Syncing…" : "Sync live feed"}</button>`,
    };
  }
  if (configuredCount) {
    return {
      tone: "ready",
      title: "Accounts are authorized. Sync the feed.",
      body: "PhantomForce has server-side account tokens. Pull the latest platform metrics now.",
      action: `<button class="btn btn-primary" type="button" data-an-sync-all>${analyticsConnectorState.loading ? "Syncing…" : "Sync live feed"}</button>`,
    };
  }
  if (oauthReadyCount) {
    return {
      tone: "ready",
      title: "Provider apps are ready. Connect accounts.",
      body: "Use the signed-in browser buttons below once per channel. PhantomForce stores tokens server-side and keeps outbound posting gated.",
      action: `<button class="btn btn-primary" type="button" data-an-scroll-sources>Connect accounts</button>`,
    };
  }
  return {
    tone: "blocked",
    title: "Social apps need setup in Settings.",
    body: canManageSocialOAuthApps()
      ? "Provider app credentials are owner-only setup. Keep this page clean; manage them once in Settings."
      : "PhantomForce needs platform OAuth apps configured before this workspace can authorize social accounts.",
    action: canManageSocialOAuthApps()
      ? `<button class="btn btn-primary" type="button" data-open-ws="settings" data-settings-target="media">Open Settings</button>`
      : `<button class="btn btn-ghost" type="button" disabled>Waiting on platform setup</button>`,
  };
}

function analyticsReadinessPanel({ displayAccounts, liveApiRows, configuredCount, oauthReadyCount, hasLiveMetrics, esc }) {
  const totalCount = displayAccounts.length || 1;
  const copy = analyticsReadinessCopy({ hasLiveMetrics, configuredCount, oauthReadyCount, totalCount });
  return `<section class="an-readiness an-readiness-slim is-${copy.tone}" aria-label="Social live feed readiness">
    <div class="an-readiness-main">
      <p class="ch-eyebrow">Live feed setup</p>
      <h3>${copy.title}</h3>
      <p>${copy.body}</p>
    </div>
    <div class="an-readiness-action">${copy.action}</div>
  </section>`;
}

function wireAnalyticsActions(el, accounts, opts) {
  el.querySelectorAll("[data-an-sync]").forEach((button) => button.onclick = async () => {
    button.disabled = true;
    analyticsNotice = `Syncing ${button.dataset.anSync}…`;
    await refreshLiveAnalytics(el, accounts, opts, { force: true, platform: button.dataset.anSync });
  });
  el.querySelectorAll("[data-an-oauth]").forEach((button) => button.onclick = async () => {
    const platform = button.dataset.anOauth;
    button.disabled = true;
    analyticsNotice = `Opening ${platform} account connection…`;
    try {
      const response = await analyticsApi("/phantom-ai/ops/social-oauth/start", {
        method: "POST",
        body: { platform },
      });
      const authUrl = response?.oauth?.authorizationUrl || response?.oauth?.url;
      if (authUrl) {
        window.open(authUrl, "_blank", "noopener,noreferrer");
        analyticsNotice = `${connectorStatus(platform)?.name || platform} sign-in opened. Approve it once; PhantomForce will refresh this page when the callback returns.`;
        startAnalyticsOAuthPolling(platform);
      } else {
        analyticsNotice = "That platform did not return a sign-in link.";
      }
    } catch (error) {
      const connector = connectorStatus(platform);
      analyticsNotice = connector?.oauthConfigured
        ? (error?.message || "The account connection could not start.")
        : `${connector?.name || platform} needs its provider app saved in Settings before account authorization can start.`;
    } finally {
      renderAnalytics(el, opts);
    }
  });
  el.querySelectorAll("[data-an-import]").forEach((input) => input.onchange = async () => {
    const account = accounts.find((row) => row.id === input.dataset.anImport);
    const file = input.files?.[0];
    if (!account || !file) return;
    try {
      account.analytics = parseAnalyticsReport(await file.text(), {
        fileName: file.name,
        source: `${account.name} analytics export`,
      });
      account.enabled = true;
      account.connectMode = "report-import";
      account.officialConnectState = account.officialConnectState || "not_configured";
      saveSocialAccounts(accounts);
      analyticsNotice = `${account.name} metrics imported from ${file.name}.`;
    } catch (error) {
      analyticsNotice = error?.message || "That report could not be read.";
    }
    renderAnalytics(el, opts);
  });
  el.querySelectorAll("[data-an-clear]").forEach((button) => button.onclick = () => {
    const account = accounts.find((row) => row.id === button.dataset.anClear);
    if (!account) return;
    delete account.analytics;
    delete account.insights;
    delete account.metrics;
    saveSocialAccounts(accounts);
    analyticsNotice = `${account.name} analytics were cleared. The saved profile was not removed.`;
    renderAnalytics(el, opts);
  });
  el.querySelectorAll("[data-an-scroll-sources]").forEach((button) => button.onclick = () => {
    el.querySelector("[data-an-sources]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
export function renderAnalytics(el, opts = {}, renderOptions = {}) {
  analyticsMount = el;
  analyticsOpts = opts;
  ensureSocialOAuthListener();
  const esc = opts.esc || ((s) => String(s));
  const accounts = loadSocialAccounts();
  if (canManageSocialOAuthApps() && !analyticsOAuthSetupState.loaded && !analyticsOAuthSetupState.loading) {
    void refreshAnalyticsOAuthSetup().then(() => {
      if (el?.isConnected) renderAnalytics(el, opts, { skipAutoRefresh: true });
    });
  }
  const displayAccounts = accounts.filter((account) => LIVE_ANALYTICS_PLATFORMS.has(account.id));
  const feedRows = displayAccounts.map((account) => ({ account, feed: analyticsFeedForAccount(account) }));
  const liveRows = feedRows.filter((row) => row.feed);
  const liveApiRows = liveRows.filter((row) => row.account.connectMode === "live-api");
  const configuredCount = analyticsConnectorState.connectors.filter((connector) => connector.configured).length;
  const oauthReadyCount = analyticsConnectorState.connectors.filter((connector) => connector.oauthConfigured).length;
  const totals = analyticsTotals(liveRows);
  const hasLiveMetrics = liveRows.length > 0;
  const chartRows = feedRows;
  const maxEngagement = Math.max(1, ...feedRows.map((row) => row.feed?.engagement || 0));
  el.innerHTML = `
    <div class="an">
      <section class="an-hero">
        <div>
          <p class="ch-eyebrow">Social media analytics</p>
          <h3>${hasLiveMetrics ? "Official social analytics are reporting." : "Connect your social accounts to start the live feed."}</h3>
          <p>${hasLiveMetrics ? "This page shows live platform analytics from authorized social accounts. Local media files, drafts, and uploads are not counted as social performance." : "Authorize YouTube, Instagram, Facebook, TikTok, X, LinkedIn, or Pinterest once. PhantomForce stores the account token server-side, syncs real metrics, and keeps posting approval-gated."}</p>
        </div>
      </section>
      <section class="an-toolbar" aria-label="Live analytics actions">
        <div class="an-hero-actions">
          ${analyticsReadinessCopy({ hasLiveMetrics, configuredCount, oauthReadyCount, totalCount: displayAccounts.length || 1 }).action}
          <span class="an-src">${svgIc("up")} ${liveApiRows.length}/${displayAccounts.length} live social · ${configuredCount}/${displayAccounts.length} accounts authorized · ${oauthReadyCount}/${displayAccounts.length} OAuth apps ready</span>
        </div>
      </section>
      ${analyticsNotice || analyticsConnectorState.error ? `<div class="an-flash">${esc(analyticsNotice || analyticsConnectorState.error)}</div>` : ""}
      ${analyticsReadinessPanel({ displayAccounts, liveApiRows, configuredCount, oauthReadyCount, hasLiveMetrics, esc })}
      <div class="ch-kpis an-kpis">
        ${hasLiveMetrics
          ? `${kpi("Reach", K(totals.reach), "reported reach")}${kpi("Views", K(totals.impressions), "views + impressions")}${kpi("Engagement", K(totals.engagement), "likes + comments + shares")}${kpi("Followers", K(totals.followers), "latest reported total")}`
          : `${kpi("Live channels", `0/${displayAccounts.length}`, "official OAuth reporting")}${kpi("OAuth apps", K(oauthReadyCount), "server apps ready")}${kpi("Authorized", K(configuredCount), "accounts connected")}${kpi("Next step", "Connect", "choose a platform below")}`}
      </div>
      <div class="an-visual-grid">
        <section class="ch-card an-trend-card">
          <div class="ch-card-h"><div><p class="ch-eyebrow">Performance trend</p><h3>Reach and views</h3></div><span class="an-live-label">${hasLiveMetrics ? "Platform data" : "Waiting for social data"}</span></div>
          ${analyticsChart(chartRows, { title: "No social analytics connected yet", body: "Connect a social account and live platform data will fill this chart. Local uploads are not counted here." })}
        </section>
        <section class="ch-card an-coverage-card">
          <p class="ch-eyebrow">Data coverage</p>
          ${analyticsCoverage(feedRows)}
        </section>
      </div>
      <section class="ch-card an-engagement-card">
        <div class="ch-card-h"><div><p class="ch-eyebrow">Channel comparison</p><h3>Engagement by platform</h3></div></div>
        <div class="ch-bars">${hasLiveMetrics ? feedRows.map((row) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${row.account.color}"></i>${esc(row.account.name)}</span><span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round((row.feed?.engagement || 0) / maxEngagement * 100)}%;background:${row.account.color}"></span></span><b class="ch-bar-val">${K(row.feed?.engagement || 0)}</b></div>`).join("") : `<div class="an-empty-note"><b>No platform engagement yet.</b><span>Once a channel is connected, this becomes your clean cross-platform comparison.</span></div>`}</div>
      </section>
      <div class="an-section-head" data-an-sources><div><p class="ch-eyebrow">Sources</p><h3>Social account connections</h3></div><span>Official OAuth reach/follower sync</span></div>
      <section class="an-channel-list" aria-label="Social analytics channels">
        ${feedRows.map((row) => accountAnalyticsRow(row, esc)).join("")}
      </section>
    </div>`;
  wireAnalyticsActions(el, accounts, opts);
  const syncAll = el.querySelector("[data-an-sync-all]");
  if (syncAll) syncAll.onclick = () => refreshLiveAnalytics(el, accounts, opts, { force: true });
  if (!renderOptions.skipAutoRefresh && !analyticsConnectorState.loaded && !analyticsConnectorState.loading) {
    void refreshLiveAnalytics(el, accounts, opts);
  }
}
