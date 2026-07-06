/* PhantomForce — Content Hub: every social post, video, image, and its full
   engagement, in one place. Tabs split by SOCIAL PLATFORM and by CONTENT/
   ENGAGEMENT type (images, videos, posts, likes, comments, reactions…).

   It owns a normalized content dataset (seeded once, persisted) and exposes a
   clean data API — loadContent() / analyze() — so the Analytics view (and
   anything else) can fetch the same numbers with zero coupling. */

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
export function registerContentAsset(asset) {
  const normalized = normalizeContentAsset(asset);
  const current = loadContentAssets().filter((item) => item.id !== normalized.id);
  const saved = saveContentAssets([normalized, ...current]);
  return { asset: saved.find((item) => item.id === normalized.id) || normalized, stats: contentAssetStats(saved) };
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
    "Safety: local export only. No upload, post, send, provider call, queue write, or external action was performed.",
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
  const P = { heart: `<path d="M8 13.5S2.5 10 2.5 6.2A2.7 2.7 0 0 1 8 5a2.7 2.7 0 0 1 5.5 1.2C13.5 10 8 13.5 8 13.5z"/>`, chat: `<path d="M3 4h10v7H7l-3 2v-2H3z"/>`, share: `<path d="M11 5.5a2 2 0 1 0-2-2M5 8a2 2 0 1 0 0 .1M11 12.5a2 2 0 1 0-2-2M9.2 4.6L6.8 6.9M6.8 9.1l2.4 2.3"/>`, save: `<path d="M4 3h8v10l-4-2.5L4 13z"/>`, eye: `<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`, users: `<circle cx="6" cy="6" r="2.1"/><path d="M2.6 13c0-2 1.5-3.3 3.4-3.3S9.4 11 9.4 13"/>`, up: `<path d="M8 13V4M4.5 7.5L8 4l3.5 3.5"/>` };
  return `<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
}

/* =========================================================================
   CONTENT HUB
   ========================================================================= */
const chState = { tab: "library", platform: "all", ctype: "all", eng: "likes" };
const chSelection = new Set();

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
    </div>`;
  el.querySelectorAll("[data-ch-tab]").forEach((b) => b.onclick = () => { chState.tab = b.dataset.chTab; renderContentHub(el, opts); });
  const body = el.querySelector("[data-ch-body]");
  const t = chState.tab;
  if (t === "ideas") renderCreatorIdeas(body, data, esc, el, opts);
  else if (t === "drafts") renderDraftQueue(body, data, esc, el, opts);
  else if (t === "calendar") renderContentCalendar(body, data, esc, el, opts);
  else if (t === "production") renderProductionBoard(body, data, esc, el, opts);
  else if (t === "library") renderContentLibrary(body, data, esc, el, opts);
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
      <div class="ch-library-actions" data-ch-library-actions>
        <div class="ch-select-summary">
          <b>${chSelection.size ? `${chSelection.size} selected` : "Selection tools"}</b>
          <span>${selectedAssets} media · ${selectedPosts} posts · local/browser only</span>
        </div>
        <div class="ch-action-row">
          <button class="ch-tool ${chState.selectMode ? "is-on" : ""}" data-ch-select-mode type="button">${chState.selectMode ? "Done selecting" : "Select"}</button>
          <button class="ch-tool" data-ch-select-everything type="button" ${allItemsCount ? "" : "disabled"}>Select all</button>
          <button class="ch-tool" data-ch-select-all type="button" ${shownAssets.length || shownPosts.length ? "" : "disabled"}>Select visible</button>
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
        </div>
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
  return `<article class="ch-asset-card ch-selectable ${selected ? "is-selected" : ""}" data-ch-select-item="${esc(key)}">
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
function wireLibraryActions(body, data, assets, shownAssets, shownPosts, esc, root, opts) {
  const shownItems = visibleLibraryItems(shownAssets, shownPosts);
  const allItems = allLibraryItems(data, assets);
  const rerender = () => renderContentHub(root, opts);
  body.querySelectorAll("[data-ch-select-item]").forEach((card) => card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea")) return;
    if (!chState.selectMode && !event.target.closest("[data-ch-select-hit]")) return;
    event.preventDefault();
    event.stopPropagation();
    toggleLibrarySelection(card.dataset.chSelectItem);
    chState.selectMode = true;
    rerender();
  }));
  body.querySelectorAll("[data-ch-delete-asset]").forEach((btn) => btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = btn.dataset.chDeleteAsset;
    saveContentAssets(loadContentAssets().filter((asset) => asset.id !== id));
    chSelection.delete(selectionKey("asset", id));
    opts.notify?.("Content Hub", "Deleted the selected local media item. No external file or post was touched.");
    rerender();
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
    setSelectedAssetMetadata(ids, { aiEditPlan: "Local AI edit plan drafted; provider call still gated." });
    exportLibraryItems(selectedLibraryItems(data, loadContentAssets()).filter((item) => item.kind === "asset" && ids.has(item.id)), "batch-ai-edit-plan");
    opts.notify?.("Content Hub", "Created a local batch AI edit plan. No provider call ran.");
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
    if (assetIds.size) saveContentAssets(loadContentAssets().filter((asset) => !assetIds.has(asset.id)));
    if (postIds.length) {
      const removed = loadRemovedContent();
      postIds.forEach((id) => removed.add(`post:${id}`));
      saveRemovedContent(removed);
    }
    chSelection.clear();
    chState.selectMode = false;
    opts.notify?.("Content Hub", `Deleted ${selected.length} local content item${selected.length === 1 ? "" : "s"}. No external post or file was touched.`);
    rerender();
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
   ANALYTICS  (fetches the exact same data via analyze())
   ========================================================================= */
export function renderAnalytics(el, opts = {}) {
  const esc = opts.esc || ((s) => String(s));
  const data = loadContent();
  const a = analyze(data.posts);
  const topPlatform = a.byPlatform[0];
  const topType = a.byType[0];
  const clickToLeadRate = +(100 * Math.max(1, Math.round(a.totals.clicks * 0.08)) / Math.max(1, a.totals.clicks)).toFixed(1);
  const modeledLeads = Math.max(1, Math.round(a.totals.clicks * 0.08));
  const modeledPipeline = modeledLeads * 850;
  const trendRows = [
    { label: "Short-form video", signal: `${K(a.totals.views)} views`, take: "Use reels and shorts for discovery, then retarget with offer posts." },
    { label: topPlatform ? `${topPlatform.name} reach` : "Channel reach", signal: topPlatform ? K(topPlatform.reach) : "-", take: "Put the strongest creator ideas on the channel already moving." },
    { label: topType ? `${topType.label} format` : "Content format", signal: topType ? `${topType.count} posts` : "-", take: "Keep the winning format in rotation before adding new experiments." },
    { label: "Audience intent", signal: `${K(a.totals.comments)} comments`, take: "Mine comments for objections, questions, and next content hooks." },
  ];
  const maxR = Math.max(1, ...a.series.map((s) => s.reach));
  const W = 640, H = 150;
  const pts = a.series.map((s, i) => [i / (a.series.length - 1) * W, H - (s.reach / maxR) * (H - 12) - 6]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  const maxPlat = Math.max(1, ...a.byPlatform.map((p) => p.engagement));
  el.innerHTML = `
    <div class="an">
      <section class="an-hero">
        <div>
          <p class="ch-eyebrow">Business intelligence</p>
          <h3>What is trending, what is working, and what should change.</h3>
          <p>Analytics is the business view: performance, audience signals, channel trends, and modeled pipeline impact from local content data.</p>
        </div>
        <span class="an-src">${svgIc("up")} Source: <b>Content Hub data</b> · ${a.totals.posts} published items</span>
      </section>
      <div class="ch-kpis">
        ${kpi("Reach", K(a.totals.reach), "market attention")}
        ${kpi("Engagement rate", a.totals.engagementRate + "%", `${K(a.totals.engagement)} actions`)}
        ${kpi("Site clicks", K(a.totals.clicks), "intent signal")}
        ${kpi("Modeled leads", K(modeledLeads), `${clickToLeadRate}% of clicks`, "good")}
        ${kpi("Modeled pipeline", "$" + K(modeledPipeline), "estimate, not booked")}
      </div>
      <div class="ch-cols">
        <div class="ch-card an-wide">
          <div class="ch-card-h"><h3>Market attention trend</h3><span class="ch-src">reach over time</span></div>
          <svg class="an-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="an-area" d="${area}"/><path class="an-line" d="${line}"/></svg>
        </div>
        <div class="ch-card an-insight-card">
          <div class="ch-card-h"><h3>Top business read</h3></div>
          <b>${topPlatform ? esc(topPlatform.name) : "No channel"} is carrying attention.</b>
          <p>${topPlatform ? `${esc(topPlatform.name)} has the strongest current reach. Use it for proof-led posts and push experimental ideas elsewhere.` : "Publish more content before drawing a conclusion."}</p>
          <button class="section-link" data-open-ws="content">Plan next content -></button>
        </div>
      </div>
      <div class="an-business-grid">
        <section class="ch-card">
          <div class="ch-card-h"><h3>Trend signals</h3><span class="ch-src">what deserves attention</span></div>
          <div class="an-trend-list">
            ${trendRows.map((row) => `<article class="an-trend">
              <span>${esc(row.signal)}</span>
              <b>${esc(row.label)}</b>
              <p>${esc(row.take)}</p>
            </article>`).join("")}
          </div>
        </section>
        <section class="ch-card">
          <div class="ch-card-h"><h3>Channel performance</h3><span class="ch-src">engagement quality</span></div>
          <div class="ch-bars">${a.byPlatform.map((p) => `<div class="ch-bar-row"><span class="ch-bar-lab"><i class="ch-dot" style="background:${p.color}"></i>${esc(p.name)}</span>
            <span class="ch-bar-track"><span class="ch-bar-fill" style="width:${Math.round(100 * p.engagement / maxPlat)}%;background:${p.color}"></span></span><b class="ch-bar-val">${K(p.engagement)}</b></div>`).join("")}</div>
        </section>
      </div>
      <div class="ch-card">
        <div class="ch-card-h"><h3>Business recommendations</h3><span class="ch-src">from content signals</span></div>
        <div class="an-reco-grid">
          <article><b>Double down</b><p>Keep publishing short-form proof and workflow clips where reach is already moving.</p></article>
          <article><b>Convert attention</b><p>Turn comments and clicks into follow-up prompts, lead magnets, and owner-safe offers.</p></article>
          <article><b>Test next</b><p>Run one objection carousel and one offer breakdown before changing the whole strategy.</p></article>
        </div>
      </div>
    </div>`;
  el.querySelectorAll("[data-ch-open]").forEach((b) => b.onclick = () => openPost(data.posts.find((p) => p.id === b.dataset.chOpen), esc));
}
