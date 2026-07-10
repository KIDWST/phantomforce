/* PhantomForce — Content Hub: every social post, video, image, and its full
   engagement, in one place. Tabs split by SOCIAL PLATFORM and by CONTENT/
   ENGAGEMENT type (images, videos, posts, likes, comments, reactions…).

   It owns a normalized content dataset (seeded once, persisted) and exposes a
   clean data API — loadContent() / analyze() — so the Analytics view (and
   anything else) can fetch the same numbers with zero coupling. */

import {
  freshEditState, applyFilterPreset, paintEdit, renderBaseFrame,
  addBokehSpot, removeBokehSpotNear, removeBokehSpotAt, nearestBokehSpot, moveBokehSpot, resizeBokehSpot,
  estimateSubjectPoint, setBokehMask, freshTextStyle, TEXT_FONTS, TEXT_PRESETS, applyTextPreset,
} from "./imagefilters.js?v=phantom-live-20260710-132";
import { probeRemoveBackground, requestRemoveBackground, probeAiEditBackend, requestAiEdit, loadImageForEditing, loadImage, exportCanvas, syncAssetUpload, listSyncedAssets, fetchSyncedAssetFile } from "./mediabackend.js?v=phantom-live-20260710-132";

const CH_KEY = "pf.contenthub.v2";
const CH_REMOVED_KEY = "pf.contenthub.removed.v1";
const CH_ASSETS_KEY = "pf.contenthub.assets.v1";
const CH_MEDIA_EDIT_INTENT_KEY = "pf.medialab.editIntent.v1";
const DAY = 864e5;
export const CONTENT_ASSET_LIMITS = Object.freeze({
  retentionDays: 30,
  maxItems: 30,
  budgetBytes: 3000000,
  maxInlineChars: 280000,
});

export const PLATFORMS = [
  { id: "instagram", name: "Instagram", color: "#e1306c", handle: "@phantomforce", types: ["image", "carousel", "reel", "story"] },
  { id: "tiktok",    name: "TikTok",    color: "#ff2b55", handle: "@phantomforce", types: ["short", "video"] },
  { id: "youtube",   name: "YouTube",   color: "#ff3b30", handle: "PhantomForce", types: ["video", "short"] },
  { id: "facebook",  name: "Facebook",  color: "#1877f2", handle: "PhantomForce", types: ["image", "video", "text", "carousel"] },
  { id: "x",         name: "X",         color: "#9fb0bd", handle: "@phantomforce", types: ["text", "image", "video"] },
  { id: "linkedin",  name: "LinkedIn",  color: "#3b9dff", handle: "PhantomForce", types: ["text", "image", "article"] },
  { id: "pinterest", name: "Pinterest", color: "#e60023", handle: "PhantomForce", types: ["image", "carousel"] },
];
export const TYPES = { image: "Image", carousel: "Carousel", reel: "Reel", short: "Short", video: "Video", story: "Story", text: "Post", article: "Article" };
const plat = (id) => PLATFORMS.find((p) => p.id === id) || PLATFORMS[0];
const isVideo = (t) => ["reel", "short", "video"].includes(t);

/* ---------------- social account connection (shared with Media Lab settings) ----------------
   A "linked" account means PhantomForce detected the real signed-in public profile through the
   browser bridge — never a fabricated number. Analytics/Overview must not show any metric that
   isn't traceable to a real connected account. */
const SOCIAL_KEY = "pf.social.accounts.v1";
function defaultSocialAccounts() {
  return PLATFORMS.map((p) => ({
    id: p.id, name: p.name, color: p.color, handle: "", url: "", loginIdentity: "",
    enabled: false, connectMode: "manual", officialConnectState: "not_configured", lastConnectAt: "",
  }));
}
export function loadSocialAccounts() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(SOCIAL_KEY) || "[]"); } catch {}
  const rows = Array.isArray(saved) ? saved : [];
  return defaultSocialAccounts().map((base) => ({ ...base, ...(rows.find((row) => row && row.id === base.id) || {}) }));
}
export function saveSocialAccounts(accounts) {
  try { localStorage.setItem(SOCIAL_KEY, JSON.stringify(accounts)); } catch {}
}
export function socialStatus(account) {
  if (account.hermesProof || account.enabled) return "linked";
  if (account.lastConnectAt || account.loginIdentity) return "pending";
  return "empty";
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
const IDEA_BANK = [
  { id: "founder-proof", title: "Founder proof clip", angle: "Show one before/after operator win in 30 seconds.", format: "Reel", platforms: ["instagram", "tiktok", "youtube"], next: "Record screen capture plus owner voiceover." },
  { id: "objection-carousel", title: "Client objection carousel", angle: "Turn the top sales objection into a five-card answer.", format: "Carousel", platforms: ["instagram", "linkedin"], next: "Pull the strongest objection from recent leads." },
  { id: "behind-build", title: "Behind the build", angle: "Show the cockpit, autopilot lanes, and safety gates without naming tools.", format: "Short", platforms: ["youtube", "x"], next: "Clip the dashboard and write a plain-language hook." },
  { id: "offer-breakdown", title: "Offer breakdown", angle: "Explain what the Pro Plan actually handles for a business owner.", format: "Post", platforms: ["linkedin", "facebook"], next: "Draft three outcomes and one proof point." },
  { id: "trend-response", title: "Trend response", angle: "React to the current creator/business automation trend with a PhantomForce take.", format: "Text + image", platforms: ["x", "linkedin"], next: "Use Analytics trend signals before drafting." },
  { id: "trust-safety", title: "Trust and safety note", angle: "Show that safe work runs automatically while risky sends or claims stop for review.", format: "Story", platforms: ["instagram", "facebook"], next: "Turn autopilot and risk gates into a simple visual sequence." },
];
const PRODUCTION_STEPS = [
  ["Idea", "Choose the hook and business outcome."],
  ["Draft", "Write caption, visual direction, and CTA."],
  ["Asset", "Create or attach image/video source."],
  ["Risk check", "Only claims, spend, sends, and public posts need review."],
  ["Autopilot", "Safe steps move forward without sitting in a manual review pile."],
];

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
  try { saved = JSON.parse(localStorage.getItem(CH_KEY) || "null"); } catch {}
  if (saved && Array.isArray(saved.posts) && saved.posts.length) return saved;
  const data = { posts: genPosts(), updatedAt: Date.now() };
  try { localStorage.setItem(CH_KEY, JSON.stringify(data)); } catch {}
  return data;
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
  try { raw = JSON.parse(localStorage.getItem(CH_ASSETS_KEY) || "null"); } catch {}
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.assets) ? raw.assets : []);
  const pruned = pruneContentAssets(list);
  if (pruned.length !== list.length) saveContentAssets(pruned);
  return pruned;
}
export function saveContentAssets(items = []) {
  let clean = pruneContentAssets(items);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      localStorage.setItem(CH_ASSETS_KEY, JSON.stringify({ assets: clean, updatedAt: Date.now(), limits: CONTENT_ASSET_LIMITS }));
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
export function registerContentAsset(asset, options = {}) {
  const normalized = normalizeContentAsset(asset);
  const current = loadContentAssets().filter((item) => item.id !== normalized.id);
  const saved = saveContentAssets([normalized, ...current]);
  const finalAsset = saved.find((item) => item.id === normalized.id) || normalized;
  if (!options.skipSync && !finalAsset.syncedId && finalAsset.url && finalAsset.url.startsWith("data:")) {
    queueAssetSync(finalAsset.id);
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
async function queueAssetSync(assetId) {
  const asset = loadContentAssets().find((item) => item.id === assetId);
  if (!asset || asset.syncedId || !asset.url || !asset.url.startsWith("data:")) return;
  const result = await syncAssetUpload(asset.url, asset.title);
  if (!result.ok) return;
  const fresh = loadContentAssets();
  const target = fresh.find((item) => item.id === assetId);
  if (!target) return; // deleted locally while the upload was in flight
  saveContentAssets(fresh.map((item) => item.id === assetId ? { ...item, syncedId: result.asset.id } : item));
}

let assetPullState = { pulled: false, pulling: false };

/* Runs once per Content Hub mount: pulls the list of server-synced assets
   and merges in any this device doesn't have locally yet (registered with
   skipSync so pulling never triggers a re-upload right back to the
   server). This is what makes a photo edited on one device show up on
   another — same account, same synced pool. */
async function pullSyncedAssetsOnce(el, opts) {
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
    const saved = JSON.parse(localStorage.getItem(CH_REMOVED_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}
function saveRemovedContent(removed) {
  try { localStorage.setItem(CH_REMOVED_KEY, JSON.stringify([...removed].slice(0, 200))); } catch {}
}
function isRemoved(id) {
  return loadRemovedContent().has(id);
}
function activeIdeas() {
  const removed = loadRemovedContent();
  return IDEA_BANK.filter((idea) => !removed.has(`idea:${idea.id}`));
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
    opts.notify?.("Content Hub", "Removed local queued item. No live post, task, or external action was touched.");
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
   CONTENT HUB
   ========================================================================= */
const chState = { tab: "library", platform: "all", ctype: "all", eng: "likes" };
const chSelection = new Set();
let chLightbox = null;
let chLbKeyHandler = null;
let chSelectAnchor = null;
let chLibraryKeyHandler = null;
let chLastDeleted = null;

export function renderContentHub(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const mediaAssets = loadContentAssets();
  const mediaStats = contentAssetStats(mediaAssets);
  const ideas = activeIdeas();
  const scheduled = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).length;
  const tabs = [["library", `Library${mediaAssets.length ? ` · ${mediaAssets.length}` : ""}`], ["ideas", "New ideas"], ["drafts", "Draft queue"], ["calendar", "Calendar"], ["production", "Production"]];
  el.innerHTML = `
    <div class="ch">
      <section class="ch-creator-head">
        <div>
          <p class="ch-eyebrow">Creator workspace</p>
          <h3>Your content library, all in one place.</h3>
          <p>Generated media, saved assets, posts, drafts, and scheduled content start here first. Planning tools are still one tab away.</p>
        </div>
        <button class="btn btn-primary" data-open-ws="media">Create media</button>
      </section>
      <div class="ch-tabs">
        ${tabs.map(([id, l]) => `<button class="ch-tab ${chState.tab === id ? "is-active" : ""}" data-ch-tab="${id}">${l}</button>`).join("")}
        <span class="ch-src">${ideas.length} ideas · ${scheduled} queued · ${mediaAssets.length} media · ${formatBytes(mediaStats.bytes)}/${formatBytes(mediaStats.budgetBytes)}</span>
      </div>
      <div class="ch-body" data-ch-body></div>
    </div>
    ${chLightbox ? lightboxMarkup(chLightbox, esc) : ""}`;
  el.querySelectorAll("[data-ch-tab]").forEach((b) => b.onclick = () => { chState.tab = b.dataset.chTab; renderContentHub(el, opts); });
  pullSyncedAssetsOnce(el, opts);
  const body = el.querySelector("[data-ch-body]");
  const t = chState.tab;
  if (t === "ideas") renderCreatorIdeas(body, data, esc, el, opts);
  else if (t === "drafts") renderDraftQueue(body, data, esc, el, opts);
  else if (t === "calendar") renderContentCalendar(body, data, esc, el, opts);
  else if (t === "production") renderProductionBoard(body, data, esc, el, opts);
  else if (t === "library") renderContentLibrary(body, data, esc, el, opts);
  if (chLightbox) wireLightbox(el, opts);
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
    <button class="btn btn-good" data-ch-action="draft" data-idea-i="${i}" data-idea-id="${idea.id}">Queue autopilot draft</button>
  </article>`;
}
function renderCreatorIdeas(body, data, esc, root, opts) {
  const ideas = activeIdeas();
  const scheduled = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).length;
  body.innerHTML = `
    <div class="ch-kpis">
      ${kpi("Ideas ready", ideas.length, "creator backlog")}
      ${kpi("Draft prompts", Math.min(4, ideas.length), "ready to shape")}
      ${kpi("Autopilot queue", scheduled, "safe scheduled items")}
      ${kpi("Risk checks", 3, "claims, spend, sends")}
      ${kpi("Creator mode", "Active", "content planning", "good")}
    </div>
    <div class="ch-creator-layout">
      <section class="ch-card">
        <div class="ch-card-h"><h3>Recommended next ideas</h3><span class="ch-src">AI-filtered for creator action</span></div>
        <div class="ch-idea-grid">${ideas.slice(0, 4).map((idea, i) => ideaCard(idea, esc, i)).join("") || `<p class="empty-line">All queued ideas were removed locally.</p>`}</div>
      </section>
      <aside class="ch-card ch-creator-side">
        <h3>Creator brief</h3>
        <p>Make content that helps a business owner understand the outcome, trust the system, and know what autopilot should handle next.</p>
        <div class="ch-brief-list">
          <span><b>Hook</b>Outcome first</span>
          <span><b>Proof</b>Show workflow, not tool names</span>
          <span><b>CTA</b>Ask for discovery or next step</span>
          <span><b>Guardrail</b>Review risky sends, claims, spend</span>
        </div>
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
function renderContentCalendar(body, data, esc, root, opts) {
  const rows = data.posts.filter((p) => p.status === "scheduled" && !isRemoved(`schedule:${p.id}`)).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Upcoming content calendar</h3><span class="ch-src">Autopilot schedule view, owner can remove</span></div>
      ${rows.length ? `<div class="ch-calendar-list">${rows.map((p) => `<article class="ch-calendar-item ch-removable" data-ch-open="${p.id}" role="button" tabindex="0">
        ${removeButton(`schedule:${p.id}`, `Remove scheduled ${p.caption}`)}
        <span class="ch-calendar-date">${ago(p.publishedAt)}</span>
        <span class="ch-tr-thumb" style="${thumb(p)}"></span>
        <span><b>${esc(p.caption)}</b><i>${esc(plat(p.platform).name)} · ${esc(TYPES[p.type])}</i></span>
        <em>queued</em>
      </article>`).join("")}</div>` : `<p class="empty-line">Nothing queued. Generate content in the Media Lab and queue it here.</p>`}
    </div>`;
  wirePostCards(body, data, esc, root, opts);
  wireRemovals(body, opts, root);
}
function renderProductionBoard(body, data, esc, root, opts) {
  const assetIdeas = activeIdeas().slice(0, 3).filter((idea) => !isRemoved(`asset:${idea.id}`));
  body.innerHTML = `
    <div class="ch-card">
      <div class="ch-card-h"><h3>Production workflow</h3><span class="ch-src">Creator-side pipeline</span></div>
      <div class="ch-production">
        ${PRODUCTION_STEPS.map(([name, copy], i) => `<article class="ch-production-step">
          <span>${i + 1}</span>
          <h4>${esc(name)}</h4>
          <p>${esc(copy)}</p>
        </article>`).join("")}
      </div>
    </div>
    <div class="ch-card">
      <div class="ch-card-h"><h3>Asset requests</h3><span class="ch-src">safe asset prep can run on autopilot</span></div>
      <div class="ch-draft-list">
        ${assetIdeas.length ? assetIdeas.map((idea, i) => `<article class="ch-draft ch-removable">
          ${removeButton(`asset:${idea.id}`, `Remove ${idea.title} asset request`)}
          <span class="ch-draft-step">${i + 1}</span>
          <div><h4>${esc(idea.title)}</h4><p>${esc(idea.next)}</p><div class="ch-draft-meta"><span>${esc(idea.format)}</span><span>Media Lab optional</span></div></div>
          <button class="btn" data-open-ws="media">Open Media Lab</button>
        </article>`).join("") : `<p class="empty-line">No asset requests are waiting.</p>`}
      </div>
    </div>`;
  wireRemovals(body, opts, root);
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
          <h3>Created media</h3>
          <span class="ch-src">auto-saved from Media Lab · clears after ${CONTENT_ASSET_LIMITS.retentionDays} days</span>
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
          <span>${selectedAssets} media · ${selectedPosts} posts · Shift+click for a range, Ctrl+click for one at a time</span>
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
      : `<p class="empty-line">No generated images or videos yet. Create media in Media Lab and it will land here automatically.</p>`}
      ${stats.trimmed ? `<p class="ch-src">Space saver active: ${stats.trimmed} older/heavier preview${stats.trimmed === 1 ? "" : "s"} kept as metadata only.</p>` : ""}
    </section>
    <div class="ch-chips" data-ch-type>
      ${[["all", "All"], ["reel", "Reels"], ["video", "Video"], ["carousel", "Carousels"], ["text", "Posts"], ["image", "Images"]].map(([id, l]) => `<button class="ch-chip ${chState.ctype === id ? "is-on" : ""}" data-v="${id}">${esc(l)}</button>`).join("")}
    </div>
    <div class="ch-grid ch-grid-lg">${shownPosts.map((p) => postCard(p, esc, { creator: true })).join("")}</div>`;
  body.querySelectorAll("[data-ch-type] button").forEach((b) => b.onclick = () => { chState.ctype = b.dataset.v; renderContentHub(root, opts); });
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
  return `<article class="ch-asset-card ch-selectable ${selected ? "is-selected" : ""}" data-ch-select-item="${esc(key)}" data-ch-asset-id="${esc(asset.id)}" title="${hasUrl ? "Double-click to open" : ""}">
    <button class="ch-remove ch-asset-x" data-ch-delete-asset="${esc(asset.id)}" aria-label="Remove ${esc(asset.title)}" title="Remove ${esc(asset.title)}" type="button">x</button>
    <span class="ch-select-box" data-ch-select-hit aria-hidden="true">${selected ? "✓" : ""}</span>
    <span class="ch-asset-thumb" style="${hasUrl ? "" : assetBg(asset)}">
      ${hasUrl ? (asset.type === "video"
        ? `<video src="${esc(asset.url)}" muted playsinline preload="metadata"></video>`
        : `<img src="${esc(asset.url)}" alt="${esc(asset.title)}" loading="lazy"/>`) : `<em>preview trimmed</em>`}
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
  return {
    asset, state: freshEditState(), bokehPicking: false, showTutorial: false,
    selectedSpot: null, rememberBokehSize: true, _probed: false,
    openSections: { adjust: true, transform: false, presets: false, text: false },
    aiEdit: { status: "idle", message: "", provider: null },
    bg: { status: "idle", message: "" },
    bokehDetect: { status: "idle", message: "" },
    text: { open: false },
    ...extra,
  };
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
  const checking = ai.status === "checking";
  const loading = ai.status === "loading";
  const busy = checking || loading;

  if (ai.mode !== "connected") return "";

  return `
    <div class="ch-lb-ai-row">
      <input class="ch-lb-ai-input" data-ch-lb-ai placeholder="e.g. brighter, cinematic teal, remove background glow…"/>
      <button class="btn btn-primary" type="button" data-ch-lb-ai-run ${busy ? "disabled" : ""}>${loading ? "Generating…" : checking ? "Checking…" : "Generate AI Edit"}</button>
    </div>
    ${ai.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(ai.message || "Edit failed.")}</p>` : ""}
    ${ai.status === "success" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">Edit applied — use Reset to go back to the original.</p>` : ""}
  `;
}

function removeBgBody(lb, esc) {
  const bg = lb.bg || { status: "idle" };
  const checking = bg.status === "checking";
  const loading = bg.status === "loading";
  const unavailable = bg.status === "unavailable";
  if (bg.status === "preview") {
    return `
      <div class="ch-lb-bg-preview">
        <div class="ch-lb-bg-preview-imgs">
          <figure><img src="${esc(bg.beforeUrl)}" alt="Before"/><figcaption>Before</figcaption></figure>
          <figure><img src="${esc(bg.afterUrl)}" alt="After"/><figcaption>After</figcaption></figure>
        </div>
        <div class="ch-lb-chips">
          <button class="btn btn-primary" type="button" data-ch-lb-bg-apply>Apply</button>
          <button class="btn btn-quiet" type="button" data-ch-lb-bg-cancel>Cancel</button>
        </div>
      </div>`;
  }
  return `
    <div class="ch-lb-chips">
      <button class="btn btn-quiet" type="button" data-ch-lb-bg-run ${checking || loading || unavailable ? "disabled" : ""}>${loading ? "Removing…" : checking ? "Checking…" : "Remove Background"}</button>
    </div>
    ${unavailable ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">Background removal is not connected yet.</p>` : ""}
    ${bg.status === "idle" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">Ready — background removal is available.</p>` : ""}
    ${bg.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(bg.message || "Background removal failed.")}</p>` : ""}
    ${bg.status === "applied" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">Background removed — Save/Download now export a transparent PNG.</p>` : ""}
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
    ${detectUnavailable ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">AI subject detection needs Local Background Removal connected — set it up in Settings → Media Engines.</p>` : ""}
    ${detect.status === "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-warn">${esc(detect.message || "Subject detection failed.")}</p>` : ""}
    ${hasMask && detect.status !== "error" ? `<p class="ch-lb-ai-note ch-lb-ai-note-ok">AI detected the subject — the background blurs around its real shape, gaps included (e.g. between a cat's ears). Add focus spots below to touch it up.</p>` : ""}
    <p class="ch-lb-bokeh-note">${esc(lb.subjectHint || (hasMask ? "Use \"Add focus spots\" for anything the AI missed." : spots.length ? "Click to add more focus, click a spot to select it, right-click to remove it." : "No subject detected yet — try \"AI detect subject\" above, or turn on \"Add focus spots\" to drop a manual point."))}</p>
    ${chBSlider("Brush size", "r", 8, 45, s.bokehBrush || 24)}
    ${s.bokeh ? chBSlider("Background blur", "strength", 4, 32, s.bokeh.strength) : ""}
    ${s.bokeh ? chBSlider("Feather", "feather", 5, 90, Math.round((s.bokeh.feather ?? 0.45) * 100)) : ""}
    <label class="ch-lb-check"><input type="checkbox" data-ch-lb-remember-size ${lb.rememberBokehSize ? "checked" : ""}/> Remember size for next point</label>
    <div class="ch-lb-chips">
      <button type="button" data-ch-lb-bokeh-pick class="${lb.bokehPicking ? "is-on" : ""}">${svgIc("spark")} ${lb.bokehPicking ? "Adding focus… (click Done)" : "Add focus spots"}</button>
      ${s.bokeh ? `<button type="button" data-ch-lb-bokeh-off>Clear all</button>` : ""}
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
  const s = lb.state;
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
            <canvas class="ch-lb-canvas" data-ch-lb-canvas></canvas>
            <div class="ch-lb-bokeh-markers ${(lb.bokehPicking || lb.selectedSpot != null) ? "" : "is-hidden"}" data-ch-lb-bokeh-markers></div>
            <div class="ch-lb-pick-hint" data-ch-lb-pick-hint hidden>${svgIc("spark")} Click to add focus, right-click a spot to remove it</div>
          </div>
          <aside class="ch-lb-tools">
            ${lb.aiEdit?.mode === "connected" ? `<div class="ch-lb-ai">
              <p class="ch-lb-ai-label">${svgIc("spark")} Describe an edit</p>
              ${aiEditBody(lb, esc)}
            </div>` : ""}
            <div class="ch-lb-ai">
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
            <details class="ch-lb-section" data-ch-lb-section="transform" ${lb.openSections?.transform ? "open" : ""}>
              <summary>Transform</summary>
              <div class="ch-lb-chips">
                <button type="button" data-ch-lb-rot="-90">${svgIc("undo")} 90°</button>
                <button type="button" data-ch-lb-rot="90">90° ${svgIc("redo")}</button>
                <button type="button" data-ch-lb-flip class="${s.flip ? "is-on" : ""}">Flip</button>
              </div>
            </details>
            <details class="ch-lb-section" data-ch-lb-section="presets" ${lb.openSections?.presets ? "open" : ""}>
              <summary>Style presets</summary>
              <div class="ch-lb-chips ch-lb-chips-wrap" data-ch-lb-filter>
                <button type="button" data-v="none">None</button><button type="button" data-v="noir">Noir</button>
                <button type="button" data-v="emerald">Emerald</button><button type="button" data-v="warm">Warm</button>
                <button type="button" data-v="cold">Cold</button><button type="button" data-v="vivid">Vivid</button>
              </div>
            </details>
            <details class="ch-lb-section" data-ch-lb-section="text" ${lb.openSections?.text ? "open" : ""}>
              <summary>Text overlay</summary>
              ${textToolBody(s, esc)}
            </details>
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
    ["Open an image", "Double-click any image in the library to open it here."],
    ["Describe an edit", "Type what you want and hit Generate. This appears only when AI Edit is connected, so the editor never shows a dead control."],
    ["Remove background", "Runs for real when background removal is connected, shows a before/after, then Apply or Cancel."],
    ["Subject bokeh", "Click \"AI detect subject\" — it uses your local background-removal engine to find the real subject shape, so gaps like the space between a cat's ears blur correctly. Then use \"Add focus spots\" to touch up anything it missed; drag a spot to move it, click to select and resize, right-click to remove it."],
    ["Adjust / Transform / Style presets / Text overlay", "Tucked into the sections below — click a heading to open it. Text overlay has fonts, color, outline, shadow, alignment, position, and layout presets."],
    ["Save vs. Save as copy", "Save updates this asset in place. Save as copy keeps the original and creates a new one."],
    ["In the library grid", "Shift+click selects a range, Ctrl+click adds one at a time, Ctrl+A selects everything visible, Ctrl+Z undoes your last delete."],
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
  chLbKeyHandler = (event) => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", chLbKeyHandler);
  if (lb.viewOnly) return;

  // rerender() fully rebuilds this DOM, which would otherwise silently
  // re-collapse any <details> the user just opened — track state explicitly
  // and sync silently on toggle (no rerender needed for this).
  root.querySelectorAll("[data-ch-lb-section]").forEach((d) => {
    d.addEventListener("toggle", () => { lb.openSections[d.dataset.chLbSection] = d.open; });
  });

  const asset = lb.asset;
  const s = lb.state;
  const canvas = root.querySelector("[data-ch-lb-canvas]");
  const markerLayer = root.querySelector("[data-ch-lb-bokeh-markers]");
  const positionMarkers = () => {
    if (!markerLayer) return;
    const spots = s.bokeh?.spots || [];
    markerLayer.innerHTML = spots.map((_, i) => `<div class="ch-lb-bokeh-marker ${i === lb.selectedSpot ? "is-selected" : ""}" data-spot-index="${i}"></div>`).join("");
    [...markerLayer.children].forEach((el, i) => {
      const spot = spots[i];
      const r = spot.r * Math.min(canvas.offsetWidth, canvas.offsetHeight);
      el.style.left = `${canvas.offsetLeft + spot.x * canvas.offsetWidth}px`;
      el.style.top = `${canvas.offsetTop + spot.y * canvas.offsetHeight}px`;
      el.style.width = `${r * 2}px`;
      el.style.height = `${r * 2}px`;
    });
  };
  // Cross-origin sources without CORS headers would otherwise silently
  // taint the canvas — every later toDataURL() call (Save/Download) throws
  // with no visible error. loadImageForEditing() requests CORS, then falls
  // back to a same-origin media proxy so this never happens silently.
  loadImageForEditing(asset.url)
    .then((img) => { paintEdit(canvas, img, s); positionMarkers(); })
    .catch((error) => {
      if (chLightbox !== lb) return;
      lb.loadError = error.message || "Could not load this image.";
      rerender();
    });
  const repaint = () => { if (canvas._img) paintEdit(canvas, canvas._img, s); positionMarkers(); };
  onResize = () => positionMarkers();
  window.addEventListener("resize", onResize);

  root.querySelectorAll("[data-ch-lb-slider]").forEach((slider) => slider.oninput = () => {
    s[slider.dataset.chLbSlider] = +slider.value;
    repaint();
    const out = root.querySelector(`[data-out="${slider.dataset.chLbSlider}"]`);
    if (out) out.textContent = slider.value;
  });
  root.querySelectorAll("[data-ch-lb-rot]").forEach((b) => b.onclick = () => { s.rotate = (s.rotate + (+b.dataset.chLbRot) + 360) % 360; repaint(); });
  const flip = root.querySelector("[data-ch-lb-flip]");
  if (flip) flip.onclick = () => { s.flip = !s.flip; flip.classList.toggle("is-on"); repaint(); };
  root.querySelectorAll("[data-ch-lb-filter] button").forEach((b) => b.onclick = () => {
    applyFilterPreset(b.dataset.v, s);
    root.querySelectorAll("[data-ch-lb-slider]").forEach((slider) => {
      slider.value = s[slider.dataset.chLbSlider];
      const out = root.querySelector(`[data-out="${slider.dataset.chLbSlider}"]`);
      if (out) out.textContent = slider.value;
    });
    repaint();
  });
  const textInput = root.querySelector("[data-ch-lb-text]");
  if (textInput) textInput.oninput = () => { s.text = textInput.value; repaint(); };
  root.querySelectorAll("[data-ch-lb-text-field]").forEach((field) => {
    const apply = () => {
      const key = field.dataset.chLbTextField;
      s.textStyle = { ...freshTextStyle(), ...(s.textStyle || {}), [key]: field.value, preset: "custom" };
      repaint();
    };
    field.addEventListener(field.type === "color" ? "input" : "change", apply);
  });
  root.querySelectorAll("[data-ch-lb-text-toggle]").forEach((btn) => btn.onclick = () => {
    const key = btn.dataset.chLbTextToggle;
    const st = { ...freshTextStyle(), ...(s.textStyle || {}) };
    s.textStyle = { ...st, [key]: !st[key], preset: "custom" };
    repaint();
    rerender();
  });
  root.querySelectorAll("[data-ch-lb-tslider]").forEach((slider) => slider.oninput = () => {
    const key = slider.dataset.chLbTslider;
    s.textStyle = { ...freshTextStyle(), ...(s.textStyle || {}), [key]: +slider.value, preset: "custom" };
    repaint();
    const out = root.querySelector(`[data-tout="${key}"]`);
    if (out) out.textContent = slider.value;
  });
  root.querySelectorAll("[data-ch-lb-text-preset]").forEach((btn) => btn.onclick = () => {
    applyTextPreset(s, btn.dataset.chLbTextPreset);
    repaint();
    rerender();
  });

  const pickHint = root.querySelector("[data-ch-lb-pick-hint]");
  if (lb.bokehPicking) { canvas.classList.add("is-picking"); if (pickHint) pickHint.hidden = false; }
  root.querySelectorAll("[data-ch-lb-bokeh-pick]").forEach((b) => b.onclick = () => {
    lb.bokehPicking = !lb.bokehPicking;
    if (lb.bokehPicking && !s.bokeh?.spots?.length && !lb.subjectEstimated) {
      lb.subjectEstimated = true;
      const guess = estimateSubjectPoint(canvas);
      if (guess) {
        const idx = addBokehSpot(s, guess.x, guess.y, (s.bokehBrush || 24) / 100);
        lb.selectedSpot = idx;
        lb.subjectHint = "Estimated focus point — drag it into place, or click elsewhere on the subject to add more.";
        repaint();
      }
    }
    rerender();
  });
  const bokehOff = root.querySelector("[data-ch-lb-bokeh-off]");
  if (bokehOff) bokehOff.onclick = () => {
    s.bokeh = null; lb.selectedSpot = null; lb.subjectHint = null; lb.subjectEstimated = false;
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
  canvas.onclick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (lb.bokehPicking) {
      const brush = lb.rememberBokehSize ? (s.bokehBrush || 24) / 100 : 0.24;
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
  canvas.oncontextmenu = (event) => {
    if (!s.bokeh?.spots?.length) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
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
      const rect = canvas.getBoundingClientRect();
      moveBokehSpot(s, index, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
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
  if (aiRun) aiRun.onclick = async () => {
    const q = (root.querySelector("[data-ch-lb-ai]")?.value || "").trim();
    if (!q || lb.aiEdit.mode !== "connected") return;
    lb.aiEdit = { ...lb.aiEdit, status: "loading" };
    rerender();
    const exported = await exportCanvas(canvas, (img) => { canvas._img = img; repaint(); }, "image/png");
    if (chLightbox !== lb) return;
    if (!exported.ok) {
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: exported.error };
      rerender();
      opts.notify?.("Content Hub", `AI edit failed on "${asset.title}": ${exported.error}`);
      return;
    }
    const result = await requestAiEdit({ dataUrl: exported.url, prompt: q, provider: lb.aiEdit.provider || "cinematic" });
    if (chLightbox !== lb) return; // lightbox closed/reset while the request was in flight
    if (!result.ok) {
      lb.aiEdit = { ...lb.aiEdit, status: "error", message: result.message };
      rerender();
      opts.notify?.("Content Hub", `AI edit failed on "${asset.title}": ${result.message}`);
      return;
    }
    // loadImageForEditing (not a raw new Image()) so a media-engine
    // result without CORS headers doesn't silently taint the canvas —
    // that would make every later Save/Download throw with no visible error.
    loadImageForEditing(result.url)
      .then((editedImg) => {
        if (chLightbox !== lb) return;
        canvas._img = editedImg;
        lb.aiEdit = { ...lb.aiEdit, status: "success", message: "" };
        repaint();
        rerender();
        opts.notify?.("Content Hub", `applied an AI edit to "${asset.title}": "${q.slice(0, 40)}".`);
      })
      .catch(() => {
        if (chLightbox !== lb) return;
        lb.aiEdit = { ...lb.aiEdit, status: "error", message: "The media engine returned an image that could not be loaded." };
        rerender();
      });
  };

  const bgRun = root.querySelector("[data-ch-lb-bg-run]");
  if (bgRun) bgRun.onclick = async () => {
    if (lb.bg.status === "unavailable") return;
    lb.bg = { ...lb.bg, status: "loading" };
    rerender();
    const exported = await exportCanvas(canvas, (img) => { canvas._img = img; repaint(); }, "image/png");
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
    lb.bg = { status: "preview", beforeUrl, afterUrl: result.image };
    rerender();
  };
  const bgApply = root.querySelector("[data-ch-lb-bg-apply]");
  if (bgApply) bgApply.onclick = () => {
    const afterImg = new Image();
    afterImg.onload = () => {
      if (chLightbox !== lb) return;
      canvas._img = afterImg;
      lb.bg = { status: "applied", message: "" };
      lb.hasTransparency = true;
      repaint();
      rerender();
      opts.notify?.("Content Hub", `removed the background on "${asset.title}".`);
    };
    afterImg.src = lb.bg.afterUrl;
  };
  const bgCancel = root.querySelector("[data-ch-lb-bg-cancel]");
  if (bgCancel) bgCancel.onclick = () => { lb.bg = { status: "idle", message: "" }; rerender(); };

  const bokehDetect = root.querySelector("[data-ch-lb-bokeh-detect]");
  if (bokehDetect) bokehDetect.onclick = async () => {
    if (lb.bokehDetect.status === "unavailable") return;
    lb.bokehDetect = { status: "loading", message: "" };
    rerender();
    // Confirms (and if needed, rescues) a readable canvas before building the
    // base frame — renderBaseFrame draws the same canvas._img, so it would
    // hit the same taint the main canvas would.
    const exported = await exportCanvas(canvas, (img) => { canvas._img = img; repaint(); }, "image/png");
    if (chLightbox !== lb) return;
    if (!exported.ok) {
      lb.bokehDetect = { status: "error", message: exported.error };
      rerender();
      opts.notify?.("Content Hub", `AI subject detection failed on "${asset.title}": ${exported.error}`);
      return;
    }
    // Send the clean base frame (adjust/rotate/flip only, no existing bokeh
    // or text) so the segmentation isn't confused by a prior mask/overlay.
    const baseUrl = renderBaseFrame(canvas._img, s).toDataURL("image/png");
    const result = await requestRemoveBackground(baseUrl);
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
    probeRemoveBackground().then((available) => {
      if (chLightbox !== lb) return;
      lb.bg = { status: available ? "idle" : "unavailable", message: "" };
      // AI subject detection reuses the same local background-removal engine, so it's honest
      // about being unavailable together with Remove Background — never a
      // fake "connected" state when the real check failed.
      if (lb.bokehDetect.status === "idle" || lb.bokehDetect.status === "unavailable") {
        lb.bokehDetect = { status: available ? "idle" : "unavailable", message: "" };
      }
      rerender();
    });
  }

  root.querySelector("[data-ch-lb-reset]").onclick = () => { chLightbox = freshLightbox(asset, { showTutorial: lb.showTutorial }); rerender(); };
  const exportFormat = () => lb.hasTransparency ? "image/png" : "image/webp";
  const exportExt = () => lb.hasTransparency ? "png" : "webp";
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
    registerContentAsset({ ...asset, url: exported.url, prompt: s.text || asset.prompt, saved: true, updatedAt: Date.now() });
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
    registerContentAsset({ ...asset, id: `edit-${at}-${Math.random().toString(36).slice(2, 6)}`, url: exported.url, title: `${asset.title} (edit)`, prompt: s.text || asset.prompt, createdAt: at, saved: true });
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
    const current = loadContentAssets();
    saveContentAssets([...restoredAssets, ...current.filter((a) => !restoredAssets.some((r) => r.id === a.id))]);
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
    if (!chState.selectMode && !isHitBox && !isRangeClick && !isToggleClick) return;
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
  body.querySelectorAll("[data-ch-asset-id]").forEach((card) => card.addEventListener("dblclick", (event) => {
    if (event.target.closest("button")) return;
    const asset = assets.find((a) => a.id === card.dataset.chAssetId);
    if (!asset || !asset.url) return;
    chLightbox = asset.type === "video" ? { asset, state: null, viewOnly: true } : freshLightbox(asset);
    rerender();
  }));
  body.querySelectorAll("[data-ch-delete-asset]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.chDeleteAsset;
    const deleted = loadContentAssets().filter((asset) => asset.id === id);
    saveContentAssets(loadContentAssets().filter((asset) => asset.id !== id));
    chSelection.delete(selectionKey("asset", id));
    captureDeleteForUndo(deleted, []);
    // rerender before notify(): notify() triggers a global store-change listener that can
    // fully remount this page and invalidate this closure's DOM references.
    rerender();
    opts.notify?.("Content Hub", "Deleted the selected local media item — Ctrl+Z to undo. No external file or post was touched.");
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
    try {
      localStorage.setItem(CH_MEDIA_EDIT_INTENT_KEY, JSON.stringify({
        id: assetItem.asset.id,
        url: assetItem.asset.url,
        type: assetItem.asset.type,
        title: assetItem.asset.title,
        prompt: assetItem.asset.prompt,
        at: Date.now(),
      }));
    } catch {}
    opts.notify?.("Content Hub", `Opening ${assetItem.asset.title} in Media Lab edit.`);
    opts.openWorkspace?.("media");
  });
  body.querySelector("[data-ch-delete-selected]")?.addEventListener("click", () => {
    const selected = selectedLibraryItems(data, loadContentAssets());
    const assetIds = new Set(selected.filter((item) => item.kind === "asset").map((item) => item.id));
    const postIds = selected.filter((item) => item.kind === "post").map((item) => item.id);
    const deletedAssets = loadContentAssets().filter((asset) => assetIds.has(asset.id));
    if (assetIds.size) saveContentAssets(loadContentAssets().filter((asset) => !assetIds.has(asset.id)));
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
    opts.notify?.("Content Hub", `Deleted ${selected.length} local content item${selected.length === 1 ? "" : "s"} — Ctrl+Z to undo. No external post or file was touched.`);
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
        prompt: "Local file imported into Content Hub.",
        source: "Local upload",
        provider: "local",
        model: "browser-file",
        style: "Imported",
        url,
        saved: true,
      });
    }
    uploadInput.value = "";
    opts.notify?.("Content Hub", `Imported ${files.length} local file${files.length === 1 ? "" : "s"} into the library.`);
    rerender();
  });
}
function wireCreatorActions(body, opts, root) {
  body.querySelectorAll("[data-ch-action]").forEach((btn) => btn.addEventListener("click", () => {
    const idea = IDEA_BANK.find((row) => row.id === btn.dataset.ideaId) || activeIdeas()[Number(btn.dataset.ideaI || 0)] || IDEA_BANK[0];
    const action = btn.dataset.chAction === "approve-draft" ? "Risk check prepared" : "Autopilot draft queued";
    opts.notify?.("Content Hub", `${action} for ${idea.title}. Safe preparation can continue automatically; no live post was sent.`);
    if (root) renderContentHub(root, opts);
  }));
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
  body.innerHTML = rows.length ? `<div class="ch-grid ch-grid-lg">${rows.map((p) => postCard(p, esc)).join("")}</div>` : `<p class="empty-line">Nothing queued. Generate content in the Media Lab and queue it here.</p>`;
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
   ANALYTICS — real connections only. If no social account is actually
   linked, this shows nothing but a connect prompt: no KPIs, no charts, no
   modeled numbers. Once linked, it shows what's genuinely real (which
   accounts, real Content Hub asset counts) and is honest that live
   performance metrics need each platform's analytics API wired server-side
   before any reach/engagement number can be shown — never a placeholder.
   ========================================================================= */
export function renderAnalytics(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const accounts = loadSocialAccounts();
  const linked = accounts.filter((acct) => socialStatus(acct) === "linked");

  if (!linked.length) {
    el.innerHTML = `
      <div class="an an-gate">
        <section class="an-hero">
          <div>
            <p class="ch-eyebrow">Business intelligence</p>
            <h3>Connect a social account to see analytics.</h3>
            <p>Analytics only shows numbers pulled from an account you've actually signed in with. Nothing is modeled, estimated, or invented here.</p>
          </div>
        </section>
        <div class="an-connect-card">
          <p class="an-connect-lede">No social account is connected yet.</p>
          <button class="btn btn-primary" type="button" data-open-ws="settings">Connect a social account</button>
        </div>
      </div>`;
    return;
  }

  const assets = loadContentAssets();
  el.innerHTML = `
    <div class="an">
      <section class="an-hero">
        <div>
          <p class="ch-eyebrow">Business intelligence</p>
          <h3>Connected — real accounts only.</h3>
          <p>Analytics only shows data pulled from accounts you've actually connected. Nothing here is modeled or estimated.</p>
        </div>
        <span class="an-src">${svgIc("up")} ${linked.length} account${linked.length === 1 ? "" : "s"} connected</span>
      </section>
      <div class="an-connected-grid">
        ${linked.map((acct) => `<div class="an-account-chip"><span class="ch-dot" style="background:${acct.color}"></span><b>${esc(acct.name)}</b><i>${esc(acct.handle || acct.loginIdentity || "connected")}</i></div>`).join("")}
      </div>
      <div class="ch-card an-notice">
        <b>Live performance metrics aren't wired up yet.</b>
        <p>PhantomForce confirmed the signed-in profile above, but reach, engagement, and pipeline numbers need each platform's real analytics API connected server-side. Nothing shows here until that's actually live — no modeled estimates in the meantime.</p>
      </div>
      ${assets.length ? `
      <div class="ch-card">
        <div class="ch-card-h"><h3>Ready to publish</h3><span class="ch-src">from Content Hub</span></div>
        <p class="an-assets-line">${assets.length} generated asset${assets.length === 1 ? "" : "s"} in Content Hub, ready once publishing is connected.</p>
      </div>` : ""}
    </div>`;
}
