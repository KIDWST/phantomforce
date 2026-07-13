import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SocialPlatform = "instagram" | "tiktok" | "youtube" | "facebook";

export type SocialProfileInput = {
  id: SocialPlatform;
  handle?: string;
  url?: string;
  name?: string;
};

export type SocialChannelSnapshot = {
  id: SocialPlatform;
  name: string;
  handle: string;
  status: "live" | "waiting" | "error";
  followers: number | null;
  views: number | null;
  engagement: number | null;
  posts: number | null;
  syncedAt: string | null;
  error?: string;
};

export type SocialAnalyticsSnapshot = {
  tenantId: string;
  configured: boolean;
  status: "live" | "partial" | "waiting";
  syncedAt: string | null;
  nextSyncAt: string | null;
  channels: SocialChannelSnapshot[];
  history: Array<{
    timestamp: string;
    channels: Array<Pick<SocialChannelSnapshot, "id" | "followers" | "views" | "engagement" | "posts">>;
  }>;
};

type Store = { version: 1; tenants: Record<string, SocialAnalyticsSnapshot> };

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const STORE_PATH = process.env.PHANTOMFORCE_SOCIAL_ANALYTICS_PATH || resolve(repoRoot, ".phantom", "social-analytics.json");
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_HISTORY = 90;
const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
};

let writeChain = Promise.resolve();
let syncChain: Promise<SocialAnalyticsSnapshot> | null = null;

function cleanTenant(value: string) {
  return String(value || "phantomforce-owner").trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, 80) || "phantomforce-owner";
}

function cleanHandle(value = "") {
  return String(value).trim().replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?[^/]+\//i, "").replace(/[/?#].*$/, "").slice(0, 120);
}

function profileUrl(profile: SocialProfileInput) {
  if (profile.url && /^https:\/\//i.test(profile.url)) return profile.url.slice(0, 500);
  const handle = cleanHandle(profile.handle);
  if (!handle) return "";
  if (profile.id === "instagram") return `https://www.instagram.com/${handle}/`;
  if (profile.id === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (profile.id === "youtube") return `https://www.youtube.com/@${handle}`;
  return `https://www.facebook.com/${handle}/`;
}

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as Store;
    return parsed?.version === 1 && parsed.tenants ? parsed : { version: 1, tenants: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tenants: {} };
    throw error;
  }
}

async function saveStore(store: Store) {
  writeChain = writeChain.then(async () => {
    await mkdir(dirname(STORE_PATH), { recursive: true });
    const temp = `${STORE_PATH}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temp, STORE_PATH);
  });
  await writeChain;
}

function token() {
  return (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || "").trim();
}

function analyticsApiBase() {
  return (process.env.PHANTOMFORCE_APIFY_BASE_URL || "https://api.apify.com/v2").replace(/\/+$/, "");
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/,/g, "");
    const match = normalized.match(/^([0-9.]+)\s*([kmb])?$/);
    if (!match) return null;
    const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "b" ? 1e9 : 1;
    const parsed = Number(match[1]) * multiplier;
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function deepValues(value: unknown, depth = 0): Array<[string, unknown]> {
  if (!value || typeof value !== "object" || depth > 4) return [];
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    entries.push([key.toLowerCase(), child]);
    if (child && typeof child === "object") entries.push(...deepValues(child, depth + 1));
  }
  return entries;
}

function findMetric(items: unknown[], names: string[], mode: "max" | "sum" = "max") {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const values = items.flatMap((item) => deepValues(item))
    .filter(([key]) => wanted.has(key))
    .map(([, value]) => numberFrom(value))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return mode === "sum" ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values);
}

function summarize(id: SocialPlatform, profile: SocialProfileInput, items: unknown[], syncedAt: string): SocialChannelSnapshot {
  const followers = findMetric(items, ["followersCount", "followerCount", "followers", "fans", "fansCount", "subscriberCount", "subscribers", "numberOfSubscribers"]);
  const views = findMetric(items, ["videoViewCount", "viewCount", "views", "playCount", "plays", "totalViews"], "sum");
  const likes = findMetric(items, ["likesCount", "likeCount", "likes", "diggCount", "heartCount", "reactionsCount", "reactions_count"], "sum") || 0;
  const comments = findMetric(items, ["commentsCount", "commentCount", "comments", "comments_count"], "sum") || 0;
  const shares = findMetric(items, ["sharesCount", "shareCount", "shares", "reshareCount", "reshare_count"], "sum") || 0;
  const explicitPosts = findMetric(items, ["postsCount", "postCount", "videoCount", "videosCount", "totalVideos"]);
  const engagement = likes || comments || shares ? likes + comments + shares : null;
  return {
    id,
    name: profile.name || PLATFORM_NAMES[id],
    handle: cleanHandle(profile.handle) || cleanHandle(profile.url),
    status: items.length ? "live" : "error",
    followers,
    views,
    engagement,
    posts: explicitPosts ?? (items.length > 1 ? items.length : null),
    syncedAt,
    ...(items.length ? {} : { error: "No public performance data was returned." }),
  };
}

function actorFor(id: SocialPlatform) {
  const envName = `PHANTOMFORCE_SOCIAL_${id.toUpperCase()}_ACTOR`;
  return process.env[envName] || ({
    instagram: "apify~instagram-profile-scraper",
    tiktok: "clockworks~tiktok-profile-scraper",
    youtube: "streamers~youtube-scraper",
    facebook: "apify~facebook-pages-scraper",
  } satisfies Record<SocialPlatform, string>)[id];
}

function actorInput(profile: SocialProfileInput) {
  const handle = cleanHandle(profile.handle) || cleanHandle(profile.url);
  const url = profileUrl(profile);
  if (profile.id === "instagram") return { usernames: [handle], resultsLimit: 12 };
  if (profile.id === "tiktok") return { profiles: [handle], resultsPerPage: 12, shouldDownloadCovers: false, shouldDownloadVideos: false, shouldDownloadSubtitles: false, shouldDownloadSlideshowImages: false };
  if (profile.id === "youtube") return { startUrls: [{ url }], maxResults: 12, maxResultsShorts: 0, maxResultStreams: 0 };
  return { startUrls: [{ url }] };
}

async function runProfile(profile: SocialProfileInput): Promise<SocialChannelSnapshot> {
  const apiToken = token();
  const syncedAt = new Date().toISOString();
  if (!apiToken) return { id: profile.id, name: profile.name || PLATFORM_NAMES[profile.id], handle: cleanHandle(profile.handle) || cleanHandle(profile.url), status: "waiting", followers: null, views: null, engagement: null, posts: null, syncedAt: null, error: "Live analytics connector is not configured on the server." };
  if (!cleanHandle(profile.handle) && !profileUrl(profile)) return { id: profile.id, name: profile.name || PLATFORM_NAMES[profile.id], handle: "", status: "waiting", followers: null, views: null, engagement: null, posts: null, syncedAt: null, error: "A public profile handle is required." };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const endpoint = `${analyticsApiBase()}/acts/${actorFor(profile.id)}/run-sync-get-dataset-items?token=${encodeURIComponent(apiToken)}&timeout=110`;
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(actorInput(profile)), signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Live source returned ${response.status}.`);
    const items = await response.json() as unknown[];
    return summarize(profile.id, profile, Array.isArray(items) ? items : [], syncedAt);
  } catch (error) {
    return { id: profile.id, name: profile.name || PLATFORM_NAMES[profile.id], handle: cleanHandle(profile.handle) || cleanHandle(profile.url), status: "error", followers: null, views: null, engagement: null, posts: null, syncedAt, error: error instanceof Error ? error.message.slice(0, 160) : "Live sync failed." };
  }
}

function emptySnapshot(tenantId: string, profiles: SocialProfileInput[]): SocialAnalyticsSnapshot {
  return {
    tenantId,
    configured: Boolean(token()),
    status: "waiting",
    syncedAt: null,
    nextSyncAt: null,
    channels: profiles.map((profile) => ({ id: profile.id, name: profile.name || PLATFORM_NAMES[profile.id], handle: cleanHandle(profile.handle) || cleanHandle(profile.url), status: "waiting", followers: null, views: null, engagement: null, posts: null, syncedAt: null })),
    history: [],
  };
}

export async function getSocialAnalyticsSnapshot(tenantValue: string, profiles: SocialProfileInput[] = []) {
  const tenantId = cleanTenant(tenantValue);
  const store = await readStore();
  const existing = store.tenants[tenantId];
  return existing ? { ...existing, configured: Boolean(token()) } : emptySnapshot(tenantId, profiles);
}

export async function syncSocialAnalytics(tenantValue: string, profiles: SocialProfileInput[], options: { force?: boolean } = {}) {
  const tenantId = cleanTenant(tenantValue);
  const current = await getSocialAnalyticsSnapshot(tenantId, profiles);
  const fresh = current.syncedAt && Date.now() - Date.parse(current.syncedAt) < SIX_HOURS;
  if (!options.force && fresh) return current;
  if (syncChain) return syncChain;
  syncChain = (async () => {
    const safeProfiles = profiles.filter((profile): profile is SocialProfileInput => ["instagram", "tiktok", "youtube", "facebook"].includes(profile.id)).slice(0, 4);
    const channels = await Promise.all(safeProfiles.map(runProfile));
    const liveCount = channels.filter((channel) => channel.status === "live").length;
    const syncedAt = liveCount ? new Date().toISOString() : current.syncedAt;
    const history = [...(current.history || [])];
    if (liveCount && syncedAt) history.push({ timestamp: syncedAt, channels: channels.map(({ id, followers, views, engagement, posts }) => ({ id, followers, views, engagement, posts })) });
    const snapshot: SocialAnalyticsSnapshot = {
      tenantId,
      configured: Boolean(token()),
      status: liveCount === channels.length && channels.length ? "live" : liveCount ? "partial" : "waiting",
      syncedAt: syncedAt || null,
      nextSyncAt: syncedAt ? new Date(Date.parse(syncedAt) + SIX_HOURS).toISOString() : null,
      channels,
      history: history.slice(-MAX_HISTORY),
    };
    const store = await readStore();
    store.tenants[tenantId] = snapshot;
    await saveStore(store);
    return snapshot;
  })();
  try { return await syncChain; } finally { syncChain = null; }
}
