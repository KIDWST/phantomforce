/* PhantomForce — Creator Hub: ideas, drafts, publishing, and planning for
   turning Media Lab assets or local uploads into real post records.

   It owns a normalized content dataset (seeded once, persisted) and exposes a
   clean data API — loadContent() / analyze() — so the Analytics view (and
   anything else) can fetch the same numbers with zero coupling. */

import {
  freshEditState, applyFilterPreset, renderBaseFrame,
  addBokehSpot, removeBokehSpotNear, removeBokehSpotAt, nearestBokehSpot, moveBokehSpot, resizeBokehSpot,
  setBokehMask, freshTextStyle, TEXT_FONTS, TEXT_PRESETS, applyTextPreset,
} from "./imagefilters.js?v=phantom-live-20260723-57";
import { archiveSyncedAsset, getRembgStatus, requestRemoveBackground, probeAiEditBackend, requestAiEdit, loadImageForEditing, loadImage, exportCanvas, syncAssetUpload, listSyncedAssets, fetchSyncedAssetFile, restoreSyncedAsset } from "./mediabackend.js?v=phantom-live-20260723-57";
import { addCustomDailyIdea, dailyIdeaState, refreshDailyIdeas, saveIdeaForLater } from "./content-ideas.js?v=phantom-live-20260723-57";
import { persistContentPublication } from "./contentpublication.js?v=phantom-live-20260723-57";
import { parseAnalyticsReport } from "./social-analytics.js?v=phantom-live-20260723-57";
import {
  currentTenantId, currentWs, ctx, session, store, visible, workspaceStorageGetItem, workspaceStorageRemoveItem, workspaceStorageSetItem, wsName,
} from "./store.js?v=phantom-live-20260723-57";

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
  { id: "facebook",  name: "Facebook",  color: "#7618f2", handle: "officialchicagoshots", types: ["image", "video", "text", "carousel"] },
  { id: "x",         name: "X",         color: "#ab9fbd", handle: "officialchicagoshots", types: ["text", "image", "video"] },
  { id: "linkedin",  name: "LinkedIn",  color: "#8e43f7", handle: "officialchicagoshots", types: ["text", "image", "article"] },
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
    thumbnailKey: "",
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
  normalized.forEach((asset) => {
    if (asset.syncedId) archiveSyncedAsset(asset.syncedId).catch(() => null);
  });
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
  restored.forEach((asset) => {
    if (asset.syncedId) restoreSyncedAsset(asset.syncedId).catch(() => null);
  });
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
    thumbnailTitle: post.thumbnailTitle || "",
    hasCustomThumbnail: !!post.thumbnailUrl,
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
function cssUrl(value = "") {
  return String(value || "").replace(/[\n\r"'\\)]/g, "");
}
function thumb(post) {
  const c = plat(post.platform).color;
  const imageUrl = post.thumbnailUrl || post.imageUrl || post.mediaUrl || "";
  if (imageUrl) {
    return `background-image:
      linear-gradient(180deg, rgba(4,8,12,.08), rgba(4,8,12,.38)),
      url("${cssUrl(imageUrl)}");
      background-size: cover;
      background-position: center;`;
  }
  return `background:
    radial-gradient(80% 90% at 25% 15%, hsla(${post.hue},70%,55%,0.5), transparent 60%),
    radial-gradient(70% 80% at 85% 90%, ${c}55, transparent 60%),
    linear-gradient(150deg, #0a0812, #06050b);`;
}
function assetBg(asset) {
  const hue = Number(asset.hue || 155);
  return `background:
    radial-gradient(80% 90% at 25% 10%, hsla(${hue},80%,58%,0.46), transparent 62%),
    radial-gradient(70% 80% at 86% 90%, rgba(102,73,247,.28), transparent 60%),
    linear-gradient(145deg, #0a0812, #040208);`;
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

function kpi(label, value, sub, tone) {
  return `<div class="ch-kpi ${tone || ""}"><span class="ch-kpi-k">${label}</span><b class="ch-kpi-v">${value}</b><span class="ch-kpi-s">${sub || ""}</span></div>`;
}

/* =========================================================================
   ANALYTICS - official social platform data only. Local uploads, media drafts,
   websites, and Creator Hub records are not social analytics. A saved profile
   identifies a channel, but it is not API authorization.
   ========================================================================= */
const LIVE_ANALYTICS_PLATFORMS = new Set(PLATFORMS.map((platform) => platform.id));
const ANALYTICS_REFRESH_MS = 15 * 60 * 1000;
const ANALYTICS_MONITOR_KEY = "pf.analytics.monitors.v1";
const ANALYTICS_MONITORS = [
  { id: "social", label: "Social media monitor", copy: "Live OAuth, reach, engagement, and channel readiness." },
  { id: "products", label: "Product analytics monitor", copy: "PhantomStore products, listing health, interest, and launch gates." },
];
const PRODUCT_ANALYTICS_SEED = [
  { id: "termina", name: "Termina", lane: "Automation + Agents", status: "Launch QA", seller: "PhantomForce", views: 2140, clicks: 311, revenue: "$0", next: "Finish multi-CLI send reliability before public push." },
  { id: "phantom-vocal-ai", name: "Phantom Vocal AI", lane: "Audio Engineering", status: "Plugin QA", seller: "PhantomForce", views: 1280, clicks: 146, revenue: "$0", next: "Ship prompt-first sliders and Reaper refresh path." },
  { id: "beatforge", name: "BeatForge", lane: "Audio Engineering", status: "Product page", seller: "PhantomForce", views: 980, clicks: 119, revenue: "$0", next: "Connect accurate drum-pack mapping proof." },
  { id: "phantombot", name: "Phantombot", lane: "Automation + Agents", status: "Private release", seller: "PhantomForce", views: 760, clicks: 84, revenue: "$0", next: "Package stable local-only release notes." },
  { id: "phantomplay-dev", name: "PhantomPlay Dev Mode", lane: "Game Development", status: "Dev preview", seller: "PhantomForce", views: 630, clicks: 77, revenue: "$0", next: "Finalize code editor autosave and sandbox mode." },
];
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
function analyticsTenantId() {
  try { return currentTenantId(); } catch { return currentWs(); }
}
function withAnalyticsTenant(path) {
  const tenant = analyticsTenantId();
  if (!tenant) return path;
  return `${path}${path.includes("?") ? "&" : "?"}tenant_id=${encodeURIComponent(tenant)}`;
}
async function analyticsApi(path, { method = "GET", body } = {}) {
  const requestBody = body && typeof body === "object" && method !== "GET"
    ? { tenant_id: analyticsTenantId(), ...body }
    : body;
  const response = await fetch(path, {
    method,
    headers: analyticsAuthHeaders(requestBody === undefined ? {} : { "Content-Type": "application/json" }),
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
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
function applyConnectorToSocialAccount(account, connector) {
  if (!account || !connector) return false;
  let changed = false;
  const set = (key, value) => {
    if (value !== undefined && value !== null && String(value) && account[key] !== value) {
      account[key] = value;
      changed = true;
    }
  };
  if (connector.configured) {
    if (!account.enabled) { account.enabled = true; changed = true; }
    if (account.connectMode !== "live-api" && account.connectMode !== "oauth-connected") {
      account.connectMode = "oauth-connected";
      changed = true;
    }
    if (account.officialConnectState !== "connected") {
      account.officialConnectState = "connected";
      changed = true;
    }
    set("lastConnectAt", connector.savedConnection?.updatedAt || connector.savedConnection?.connectedAt || account.lastConnectAt || new Date().toISOString());
  } else if (connector.oauthConfigured && account.officialConnectState === "not_configured") {
    account.officialConnectState = "oauth_ready";
    changed = true;
  }
  set("handle", connector.savedConnection?.accountHandle || connector.handle);
  set("loginIdentity", connector.personalProfilePostingBlocked
    ? "Personal login for access only"
    : connector.savedConnection?.accountName || account.loginIdentity);
  set("publishTargetKind", connector.publishTargetKind);
  set("publishTargetLabel", connector.targetLabel || connector.savedConnection?.pageName || connector.savedConnection?.accountName || "");
  set("publishTargetId", connector.targetId || "");
  set("targetSafetyCopy", connector.targetSafetyCopy || "");
  return changed;
}
function syncAccountsFromConnectors(accounts = loadSocialAccounts()) {
  let changed = false;
  for (const account of accounts) {
    changed = applyConnectorToSocialAccount(account, connectorStatus(account.id)) || changed;
  }
  if (changed) saveSocialAccounts(accounts);
  return accounts;
}
async function refreshAnalyticsOAuthSetup({ force = false } = {}) {
  if (analyticsOAuthSetupState.loading) return analyticsOAuthSetupState.setup;
  if (analyticsOAuthSetupState.loaded && !force) return analyticsOAuthSetupState.setup;
  analyticsOAuthSetupState.loading = true;
  analyticsOAuthSetupState.error = "";
  try {
    const response = await analyticsApi(withAnalyticsTenant("/phantom-ai/ops/social-oauth/setup"));
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
      const response = await analyticsApi(withAnalyticsTenant("/phantom-ai/ops/social-analytics/status"));
      analyticsConnectorState.connectors = Array.isArray(response?.social_analytics?.connectors)
        ? response.social_analytics.connectors
        : [];
      analyticsConnectorState.preflight = response?.social_analytics?.oauthPreflight || null;
      analyticsConnectorState.loaded = true;
      syncAccountsFromConnectors(accounts);
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
    return `${row.feed ? row.account.color : "rgba(140,135,165,.13)"} ${start}% ${end}%`;
  }).join(",");
  return `<div class="an-coverage">
    <div class="an-coverage-ring" style="background:conic-gradient(${stops || "rgba(140,135,165,.13) 0 100%"})"><span><b>${live}/${feedRows.length}</b><i>reporting</i></span></div>
    <div class="an-coverage-copy"><b>Channel coverage</b><p>${live ? `${live} verified data source${live === 1 ? "" : "s"} active.` : "Connect your channels to activate reporting."}</p></div>
  </div>`;
}

function loadAnalyticsMonitorPrefs() {
  const defaults = { social: true, products: true, customer: true };
  try {
    const saved = JSON.parse(workspaceStorageGetItem(ANALYTICS_MONITOR_KEY) || "{}") || {};
    return ANALYTICS_MONITORS.reduce((prefs, monitor) => {
      prefs[monitor.id] = saved[monitor.id] === undefined ? defaults[monitor.id] !== false : Boolean(saved[monitor.id]);
      return prefs;
    }, {});
  } catch {
    return defaults;
  }
}

function saveAnalyticsMonitorPrefs(prefs = {}) {
  try { workspaceStorageSetItem(ANALYTICS_MONITOR_KEY, JSON.stringify(prefs)); } catch {}
}

function analyticsMonitorControls(prefs = {}, esc) {
  return `<section class="an-monitor-config" aria-label="Analytics monitor configuration">
    <div>
      <p class="ch-eyebrow">Analytics layout</p>
      <h3>Choose what this page monitors.</h3>
    </div>
    <div class="an-monitor-toggles">
      ${ANALYTICS_MONITORS.map((monitor) => `<button type="button" class="${prefs[monitor.id] ? "is-on" : ""}" data-an-monitor="${esc(monitor.id)}" aria-pressed="${prefs[monitor.id] ? "true" : "false"}">
        <b>${esc(monitor.label)}</b><span>${esc(monitor.copy)}</span>
      </button>`).join("")}
    </div>
  </section>`;
}

function productAnalyticsRows() {
  const savedProducts = Array.isArray(store?.state?.products) ? store.state.products : [];
  const mapped = savedProducts.slice(0, 8).map((product, index) => ({
    id: product.id || `workspace-product-${index}`,
    name: product.name || product.title || `Workspace product ${index + 1}`,
    lane: product.category || product.type || "Business Ops",
    status: product.status || "Configured",
    seller: wsName?.() || "Workspace",
    views: Number(product.views || product.analytics?.views || 0),
    clicks: Number(product.clicks || product.analytics?.clicks || 0),
    revenue: product.revenueLabel || product.priceLabel || "$0",
    next: product.nextAction || "Add storefront analytics, reviews, and purchase tracking.",
  }));
  const ids = new Set(mapped.map((product) => product.id));
  return [...mapped, ...PRODUCT_ANALYTICS_SEED.filter((product) => !ids.has(product.id))];
}

function renderProductAnalyticsMonitor(esc) {
  const rows = productAnalyticsRows();
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views || 0), 0);
  const totalClicks = rows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const clickRate = totalViews ? Math.round(totalClicks / totalViews * 1000) / 10 : 0;
  return `<section class="ch-card an-product-monitor" aria-label="Product analytics monitor">
    <div class="ch-card-h"><div><p class="ch-eyebrow">Product analytics monitor</p><h3>PhantomStore performance</h3></div><span>${rows.length} products</span></div>
    <div class="an-product-kpis">
      ${kpi("Store views", K(totalViews), "product page interest")}
      ${kpi("Buy clicks", K(totalClicks), "checkout intent")}
      ${kpi("Click rate", `${clickRate}%`, "views to buy clicks")}
      ${kpi("Launch gates", K(rows.filter((row) => /qa|preview|gate|finish|connect/i.test(`${row.status} ${row.next}`)).length), "needs work")}
    </div>
    <div class="an-product-table">
      ${rows.map((row) => `<article>
        <div><b>${esc(row.name)}</b><span>${esc(row.lane)} / ${esc(row.seller)}</span></div>
        <strong>${esc(row.status)}</strong>
        <span>${K(row.views)} views</span>
        <span>${K(row.clicks)} clicks</span>
        <em>${esc(row.next)}</em>
      </article>`).join("")}
    </div>
  </section>`;
}

function renderSocialMediaMonitor({ feedRows = [], displayAccounts = [], configuredCount = 0, oauthReadyCount = 0, hasLiveMetrics = false, esc }) {
  const live = feedRows.filter((row) => row.feed).length;
  const waiting = Math.max(0, displayAccounts.length - live);
  return `<section class="ch-card an-social-monitor" aria-label="Social media monitor">
    <div class="ch-card-h"><div><p class="ch-eyebrow">Social media monitor</p><h3>${hasLiveMetrics ? "Cross-platform feed is live." : "Connect platforms to light up the graph."}</h3></div><span>${live}/${displayAccounts.length} live</span></div>
    <div class="an-social-grid">
      <span><b>${live}</b><i>live feeds</i></span>
      <span><b>${waiting}</b><i>waiting</i></span>
      <span><b>${configuredCount}</b><i>authorized</i></span>
      <span><b>${oauthReadyCount}</b><i>apps ready</i></span>
    </div>
    <p>${esc(hasLiveMetrics ? "Official platform metrics are reporting from connected accounts. Personal Meta profiles stay separated from Page/Business targets." : "Use the account connection buttons below. Meta login is for business/page access only, not accidental personal posting.")}</p>
  </section>`;
}
let analyticsNotice = "";
let analyticsMount = null;
let analyticsOpts = {};
let socialOAuthListenerReady = false;
let analyticsOAuthPollTimer = 0;

async function refreshAnalyticsConnectorStatus() {
  const response = await analyticsApi(withAnalyticsTenant("/phantom-ai/ops/social-analytics/status"));
  analyticsConnectorState.connectors = Array.isArray(response?.social_analytics?.connectors)
    ? response.social_analytics.connectors
    : [];
  analyticsConnectorState.preflight = response?.social_analytics?.oauthPreflight || null;
  analyticsConnectorState.loaded = true;
  syncAccountsFromConnectors();
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
    : oauthReady ? "Connect account" : saved ? "Handle saved — not connected" : account.handle ? "Handle saved — not connected" : "Needs social connection";
  const sourceCopy = canSync
    ? (syncFailed ? syncOutcome.error : "Official read-only analytics are ready.")
    : oauthReady
      ? "OAuth app credentials exist; finish account authorization before stats appear."
      : "This channel needs the PhantomForce OAuth app configured before live analytics or posting approval can run.";
  const safetyCopy = connector?.targetSafetyCopy || account.targetSafetyCopy || "";
  const targetKind = String(connector?.publishTargetKind || account.publishTargetKind || "").replaceAll("_", " ");
  const targetLabel = connector?.targetLabel || account.publishTargetLabel || "";
  const targetCopy = targetLabel ? `${targetKind || "target"}: ${targetLabel}` : safetyCopy;
  const primaryAction = canSync
    ? `<button class="btn btn-primary" type="button" data-an-sync="${account.id}">${analyticsConnectorState.loading ? "Syncing…" : live ? "Sync now" : "Start live sync"}</button>`
    : oauthReady
      ? `<button class="btn btn-primary" type="button" data-an-oauth="${account.id}">Connect account</button>`
      : canManageSocialOAuthApps()
        ? `<button class="btn btn-ghost" type="button" data-open-ws="settings" data-settings-target="media">Open Settings</button>`
        : `<button class="btn btn-ghost" type="button" disabled>Owner setup needed</button>`;
  return `<article class="an-channel-row ${feed ? "is-live" : "is-missing"}">
    <div class="an-channel-id"><span class="ch-dot" style="background:${account.color}"></span><span><b>${esc(account.name)}</b><i>${esc(account.handle || account.loginIdentity || "handle saved — not connected")}</i></span></div>
    ${feed ? `<div class="an-channel-metrics">
      <span><b>${K(feed.reach)}</b>reach</span><span><b>${K(feed.impressions)}</b>views</span><span><b>${K(feed.engagement)}</b>engagement</span><span><b>${K(feed.followers)}</b>followers</span>
    </div><div class="an-channel-source"><b>${live ? "Live · " : "Report · "}${esc(feed.source)}</b><i>${feed.syncedAt ? `Synced ${esc(ago(feed.syncedAt))}` : "current"}</i>${syncFailed ? `<em class="an-sync-error">${esc(syncOutcome.error)}</em>` : ""}</div>`
    : `<div class="an-channel-empty${syncFailed ? " is-sync-error" : ""}"><b>${esc(sourceState)}</b><span>${esc(sourceCopy)}</span>${targetCopy ? `<em class="an-target-safe">${esc(targetCopy)}</em>` : ""}</div>`}
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
      title: "Provider apps are ready. Connect the accounts.",
      body: "Use the signed-in browser once per channel. Meta uses your personal login only to find Pages and Instagram business assets; personal profile posting is blocked.",
      action: `<button class="btn btn-primary" type="button" data-an-connect-all>${analyticsConnectorState.loading ? "Connecting…" : "Connect all accounts"}</button>`,
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
  el.querySelectorAll("[data-an-monitor]").forEach((button) => button.onclick = () => {
    const monitor = button.dataset.anMonitor || "";
    const prefs = loadAnalyticsMonitorPrefs();
    prefs[monitor] = !prefs[monitor];
    if (!Object.values(prefs).some(Boolean)) prefs[monitor] = true;
    saveAnalyticsMonitorPrefs(prefs);
    renderAnalytics(el, opts, { skipAutoRefresh: true });
  });
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
  el.querySelectorAll("[data-an-connect-all]").forEach((button) => button.onclick = async () => {
    const targets = analyticsConnectorState.connectors.filter((connector) => connector.oauthConfigured && !connector.configured);
    if (!targets.length) {
      analyticsNotice = "No unconnected OAuth-ready channels are waiting.";
      renderAnalytics(el, opts, { skipAutoRefresh: true });
      return;
    }
    button.disabled = true;
    analyticsNotice = `Opening ${targets.length} social sign-in flow${targets.length === 1 ? "" : "s"}…`;
    const placeholders = targets.map(() => {
      try { return window.open("about:blank", "_blank"); } catch { return null; }
    });
    let opened = 0;
    for (const [index, connector] of targets.entries()) {
      try {
        const response = await analyticsApi("/phantom-ai/ops/social-oauth/start", {
          method: "POST",
          body: { platform: connector.id },
        });
        const authUrl = response?.oauth?.authorizationUrl || response?.oauth?.url;
        if (authUrl) {
          if (placeholders[index]) placeholders[index].location.href = authUrl;
          else window.open(authUrl, "_blank", "noopener,noreferrer");
          opened += 1;
        } else if (placeholders[index]) {
          placeholders[index].close();
        }
      } catch (error) {
        if (placeholders[index]) placeholders[index].close();
        analyticsConnectorState.sync[connector.id] = { state: "error", error: error?.message || "Connection could not start.", syncedAt: "" };
      }
    }
    analyticsNotice = opened
      ? `${opened} sign-in flow${opened === 1 ? "" : "s"} opened. Approve the business/page targets and PhantomForce will sync when callbacks return.`
      : "No social sign-in windows could be opened. Check provider app setup in Settings.";
    startAnalyticsOAuthPolling(targets[0]?.id);
    renderAnalytics(el, opts, { skipAutoRefresh: true });
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
  const accounts = syncAccountsFromConnectors(loadSocialAccounts());
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
  const monitorPrefs = loadAnalyticsMonitorPrefs();
  el.innerHTML = `
    <div class="an">
      <div class="an-visual-grid an-top-visual-grid">
        <section class="ch-card an-trend-card">
          <div class="ch-card-h"><div><p class="ch-eyebrow">Performance trend</p><h3>Reach and views</h3></div><span class="an-live-label">${hasLiveMetrics ? "Platform data" : "Waiting for social data"}</span></div>
          ${analyticsChart(chartRows, { title: "No social analytics connected yet", body: "Connect a social account and live platform data will fill this chart. Local uploads are not counted here." })}
        </section>
        <section class="ch-card an-coverage-card">
          <p class="ch-eyebrow">Data coverage</p>
          ${analyticsCoverage(feedRows)}
        </section>
      </div>
      <div class="ch-kpis an-kpis">
        ${hasLiveMetrics
          ? `${kpi("Reach", K(totals.reach), "reported reach")}${kpi("Views", K(totals.impressions), "views + impressions")}${kpi("Engagement", K(totals.engagement), "likes + comments + shares")}${kpi("Followers", K(totals.followers), "latest reported total")}`
          : `${kpi("Live channels", `0/${displayAccounts.length}`, "official OAuth reporting")}${kpi("OAuth apps", K(oauthReadyCount), "server apps ready")}${kpi("Authorized", K(configuredCount), "accounts connected")}${kpi("Next step", "Connect", "choose a platform below")}`}
      </div>
      ${analyticsMonitorControls(monitorPrefs, esc)}
      ${monitorPrefs.social ? renderSocialMediaMonitor({ feedRows, displayAccounts, configuredCount, oauthReadyCount, hasLiveMetrics, esc }) : ""}
      ${monitorPrefs.products ? renderProductAnalyticsMonitor(esc) : ""}
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
