export type SocialAnalyticsPlatform = "youtube" | "instagram" | "facebook" | "tiktok";

export type SocialAnalyticsPoint = {
  label: string;
  reach: number;
  impressions: number;
  engagement: number;
  followers: number;
};

export type SocialAnalyticsSnapshot = {
  platform: SocialAnalyticsPlatform;
  reach: number;
  impressions: number;
  engagement: number;
  followers: number;
  posts: number;
  source: string;
  provider: string;
  syncedAt: string;
  period: string;
  series: SocialAnalyticsPoint[];
};

type ConnectorDefinition = {
  id: SocialAnalyticsPlatform;
  name: string;
  provider: string;
  configured: () => boolean;
  required: string[];
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cleanHandle = (value: unknown) => text(value).replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 100);
const env = (name: string) => text(process.env[name]);

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "youtube",
    name: "YouTube",
    provider: "YouTube Data API",
    configured: () => Boolean(env("YOUTUBE_API_KEY") && (env("YOUTUBE_CHANNEL_ID") || env("YOUTUBE_CHANNEL_HANDLE"))),
    required: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE"],
  },
  {
    id: "instagram",
    name: "Instagram",
    provider: "Instagram Graph API",
    configured: () => Boolean(env("INSTAGRAM_ACCESS_TOKEN") && env("INSTAGRAM_BUSINESS_ACCOUNT_ID")),
    required: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
  },
  {
    id: "facebook",
    name: "Facebook",
    provider: "Facebook Graph API",
    configured: () => Boolean(env("FACEBOOK_PAGE_ACCESS_TOKEN") && env("FACEBOOK_PAGE_ID")),
    required: ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    provider: "TikTok Display API",
    configured: () => Boolean(env("TIKTOK_ACCESS_TOKEN")),
    required: ["TIKTOK_ACCESS_TOKEN"],
  },
];

export function getSocialAnalyticsConnectorStatus() {
  const connectors = CONNECTORS.map((connector) => ({
    id: connector.id,
    name: connector.name,
    provider: connector.provider,
    configured: connector.configured(),
    live: connector.configured(),
    readOnly: true,
    required: connector.required,
    reason: connector.configured()
      ? "Ready for official read-only analytics sync."
      : "Connect this channel in Settings to start live analytics.",
  }));
  return {
    mode: "official_read_only_apis" as const,
    live: connectors.some((connector) => connector.live),
    connectors,
    secretsExposed: false,
    importFallbackAvailable: true,
  };
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const providerMessage = text(payload?.error?.message || payload?.error?.code || payload?.message);
      throw new Error(providerMessage ? `Provider rejected the analytics request: ${providerMessage}` : `Provider returned HTTP ${response.status}.`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function syncYouTube(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const apiKey = env("YOUTUBE_API_KEY");
  const channelId = env("YOUTUBE_CHANNEL_ID");
  const handle = cleanHandle(env("YOUTUBE_CHANNEL_HANDLE"));
  if (!apiKey || (!channelId && !handle)) throw new Error("YouTube is not connected.");
  const lookup = new URLSearchParams({ part: "snippet,statistics,contentDetails", key: apiKey });
  if (channelId) lookup.set("id", channelId); else lookup.set("forHandle", handle);
  const channelPayload = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/channels?${lookup}`);
  const channel = channelPayload?.items?.[0];
  if (!channel) throw new Error("The configured YouTube channel could not be found.");
  const uploads = text(channel?.contentDetails?.relatedPlaylists?.uploads);
  const videos: any[] = [];
  if (uploads) {
    const playlistQuery = new URLSearchParams({ part: "snippet,contentDetails", playlistId: uploads, maxResults: "20", key: apiKey });
    const playlist = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/playlistItems?${playlistQuery}`);
    const ids = (playlist?.items || []).map((item: any) => text(item?.contentDetails?.videoId)).filter(Boolean);
    if (ids.length) {
      const videoQuery = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: apiKey });
      const videoPayload = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/videos?${videoQuery}`);
      videos.push(...(videoPayload?.items || []));
    }
  }
  const series = videos
    .map((video) => ({
      label: text(video?.snippet?.publishedAt).slice(0, 10),
      reach: number(video?.statistics?.viewCount),
      impressions: number(video?.statistics?.viewCount),
      engagement: number(video?.statistics?.likeCount) + number(video?.statistics?.commentCount),
      followers: 0,
    }))
    .reverse();
  return {
    platform: "youtube",
    reach: series.reduce((sum, point) => sum + point.reach, 0),
    impressions: series.reduce((sum, point) => sum + point.impressions, 0),
    engagement: series.reduce((sum, point) => sum + point.engagement, 0),
    followers: number(channel?.statistics?.subscriberCount),
    posts: videos.length || number(channel?.statistics?.videoCount),
    source: "Official YouTube channel and recent video statistics",
    provider: "YouTube Data API",
    syncedAt: new Date().toISOString(),
    period: videos.length ? `Latest ${videos.length} videos` : "Channel lifetime totals",
    series,
  };
}

function graphSeries(payload: any, metricMap: Record<string, Exclude<keyof SocialAnalyticsPoint, "label">>) {
  const byDate = new Map<string, SocialAnalyticsPoint>();
  for (const metric of payload?.data || []) {
    const key = metricMap[text(metric?.name)];
    if (!key) continue;
    const values = metric?.values || (metric?.total_value ? [{ value: metric.total_value.value, end_time: new Date().toISOString() }] : []);
    for (const item of values) {
      const label = text(item?.end_time).slice(0, 10) || "Current";
      const point = byDate.get(label) || { label, reach: 0, impressions: 0, engagement: 0, followers: 0 };
      point[key] = number(item?.value);
      byDate.set(label, point);
    }
  }
  return [...byDate.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(-30);
}

async function syncInstagram(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = env("INSTAGRAM_ACCESS_TOKEN");
  const accountId = env("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  const version = env("META_GRAPH_VERSION") || "v21.0";
  if (!token || !accountId) throw new Error("Instagram is not connected.");
  const profileQuery = new URLSearchParams({ fields: "username,followers_count,media_count", access_token: token });
  const profile = await requestJson(fetcher, `https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}?${profileQuery}`);
  const since = Math.floor(Date.now() / 1000) - 29 * 86400;
  const insightQuery = new URLSearchParams({ metric: "reach,impressions,total_interactions", period: "day", since: String(since), access_token: token });
  const insights = await requestJson(fetcher, `https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/insights?${insightQuery}`);
  const series = graphSeries(insights, { reach: "reach", impressions: "impressions", total_interactions: "engagement" });
  return {
    platform: "instagram",
    reach: series.reduce((sum, point) => sum + point.reach, 0),
    impressions: series.reduce((sum, point) => sum + point.impressions, 0),
    engagement: series.reduce((sum, point) => sum + point.engagement, 0),
    followers: number(profile?.followers_count),
    posts: number(profile?.media_count),
    source: "Official Instagram business account insights",
    provider: "Instagram Graph API",
    syncedAt: new Date().toISOString(),
    period: "Last 30 days",
    series,
  };
}

async function syncFacebook(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = env("FACEBOOK_PAGE_ACCESS_TOKEN");
  const pageId = env("FACEBOOK_PAGE_ID");
  const version = env("META_GRAPH_VERSION") || "v21.0";
  if (!token || !pageId) throw new Error("Facebook is not connected.");
  const profileQuery = new URLSearchParams({ fields: "name,followers_count,fan_count", access_token: token });
  const profile = await requestJson(fetcher, `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}?${profileQuery}`);
  const since = Math.floor(Date.now() / 1000) - 29 * 86400;
  const insightQuery = new URLSearchParams({ metric: "page_impressions,page_post_engagements,page_views_total", period: "day", since: String(since), access_token: token });
  const insights = await requestJson(fetcher, `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/insights?${insightQuery}`);
  const series = graphSeries(insights, { page_impressions: "impressions", page_post_engagements: "engagement", page_views_total: "reach" });
  return {
    platform: "facebook",
    reach: series.reduce((sum, point) => sum + point.reach, 0),
    impressions: series.reduce((sum, point) => sum + point.impressions, 0),
    engagement: series.reduce((sum, point) => sum + point.engagement, 0),
    followers: number(profile?.followers_count || profile?.fan_count),
    posts: 0,
    source: "Official Facebook Page insights",
    provider: "Facebook Graph API",
    syncedAt: new Date().toISOString(),
    period: "Last 30 days",
    series,
  };
}

async function syncTikTok(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = env("TIKTOK_ACCESS_TOKEN");
  if (!token) throw new Error("TikTok is not connected.");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const user = await requestJson(fetcher, "https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count", { headers });
  const videos = await requestJson(fetcher, "https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,view_count,like_count,comment_count,share_count", {
    method: "POST",
    headers,
    body: JSON.stringify({ max_count: 20 }),
  });
  const items = videos?.data?.videos || [];
  const series = items.map((video: any) => ({
    label: new Date(number(video?.create_time) * 1000).toISOString().slice(0, 10),
    reach: number(video?.view_count),
    impressions: number(video?.view_count),
    engagement: number(video?.like_count) + number(video?.comment_count) + number(video?.share_count),
    followers: 0,
  })).sort((a: SocialAnalyticsPoint, b: SocialAnalyticsPoint) => a.label.localeCompare(b.label));
  const stats = user?.data?.user || {};
  return {
    platform: "tiktok",
    reach: series.reduce((sum: number, point: SocialAnalyticsPoint) => sum + point.reach, 0),
    impressions: series.reduce((sum: number, point: SocialAnalyticsPoint) => sum + point.impressions, 0),
    engagement: series.reduce((sum: number, point: SocialAnalyticsPoint) => sum + point.engagement, 0),
    followers: number(stats?.follower_count),
    posts: items.length || number(stats?.video_count),
    source: "Official TikTok profile and recent video statistics",
    provider: "TikTok Display API",
    syncedAt: new Date().toISOString(),
    period: items.length ? `Latest ${items.length} videos` : "Current profile totals",
    series,
  };
}

export async function syncSocialAnalytics(platform: SocialAnalyticsPlatform, fetcher: typeof fetch = fetch) {
  const connector = CONNECTORS.find((item) => item.id === platform);
  if (!connector) throw new Error("Unsupported social analytics platform.");
  if (!connector.configured()) throw new Error(`${connector.name} is not connected. Add its official API connection in Settings first.`);
  if (platform === "youtube") return syncYouTube(fetcher);
  if (platform === "instagram") return syncInstagram(fetcher);
  if (platform === "facebook") return syncFacebook(fetcher);
  return syncTikTok(fetcher);
}
