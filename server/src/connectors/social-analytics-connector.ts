import { randomBytes } from "node:crypto";

export type SocialAnalyticsPlatform = "youtube" | "instagram" | "facebook" | "tiktok" | "x" | "linkedin" | "pinterest";

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
  oauthConfigured: () => boolean;
  oauthRequired: string[];
  defaultHandle: string;
  handle: () => string;
  scopes: string[];
};

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const cleanHandle = (value: unknown) => text(value).replace(/^@/, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 100);
const env = (name: string) => text(process.env[name]);
const firstEnv = (...names: string[]) => names.map(env).find(Boolean) || "";
const defaultHandle = "officialchicagoshots";
const metaOauthConfigured = () => Boolean(env("META_APP_ID") && env("META_APP_SECRET"));
const socialPlatforms = ["youtube", "instagram", "facebook", "tiktok", "x", "linkedin", "pinterest"] as const;

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "youtube",
    name: "YouTube",
    provider: "YouTube Data API",
    configured: () => Boolean(env("YOUTUBE_API_KEY") && (env("YOUTUBE_CHANNEL_ID") || env("YOUTUBE_CHANNEL_HANDLE"))),
    required: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE"],
    oauthConfigured: () => Boolean(firstEnv("YOUTUBE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") && firstEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET")),
    oauthRequired: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "YouTube analytics scopes"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("YOUTUBE_CHANNEL_HANDLE", "SOCIAL_YOUTUBE_HANDLE")) || defaultHandle,
    scopes: ["youtube.readonly", "yt-analytics.readonly", "youtube.upload"],
  },
  {
    id: "instagram",
    name: "Instagram",
    provider: "Instagram Graph API",
    configured: () => Boolean(env("INSTAGRAM_ACCESS_TOKEN") && env("INSTAGRAM_BUSINESS_ACCOUNT_ID")),
    required: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
    oauthConfigured: metaOauthConfigured,
    oauthRequired: ["META_APP_ID", "META_APP_SECRET", "Instagram Business permissions"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("INSTAGRAM_HANDLE", "SOCIAL_INSTAGRAM_HANDLE")) || defaultHandle,
    scopes: ["instagram_basic", "instagram_manage_insights", "instagram_content_publish"],
  },
  {
    id: "facebook",
    name: "Facebook",
    provider: "Facebook Graph API",
    configured: () => Boolean(env("FACEBOOK_PAGE_ACCESS_TOKEN") && env("FACEBOOK_PAGE_ID")),
    required: ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
    oauthConfigured: metaOauthConfigured,
    oauthRequired: ["META_APP_ID", "META_APP_SECRET", "Facebook Page permissions"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("FACEBOOK_PAGE_HANDLE", "SOCIAL_FACEBOOK_HANDLE")) || defaultHandle,
    scopes: ["pages_read_engagement", "read_insights", "pages_manage_posts"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    provider: "TikTok Display API",
    configured: () => Boolean(env("TIKTOK_ACCESS_TOKEN")),
    required: ["TIKTOK_ACCESS_TOKEN"],
    oauthConfigured: () => Boolean(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
    oauthRequired: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TikTok Login Kit scopes"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("TIKTOK_HANDLE", "SOCIAL_TIKTOK_HANDLE")) || defaultHandle,
    scopes: ["user.info.basic", "video.list", "video.upload"],
  },
  {
    id: "x",
    name: "X",
    provider: "X API v2",
    configured: () => Boolean(firstEnv("X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN") && firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME")),
    required: ["X_BEARER_TOKEN or TWITTER_BEARER_TOKEN", "X_USERNAME or X_HANDLE"],
    oauthConfigured: () => Boolean(env("X_CLIENT_ID") && env("X_CLIENT_SECRET")),
    oauthRequired: ["X_CLIENT_ID", "X_CLIENT_SECRET", "X OAuth scopes"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME", "SOCIAL_X_HANDLE")) || defaultHandle,
    scopes: ["tweet.read", "users.read", "offline.access", "tweet.write"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    provider: "LinkedIn Marketing API",
    configured: () => Boolean(env("LINKEDIN_ACCESS_TOKEN") && env("LINKEDIN_ORGANIZATION_ID")),
    required: ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORGANIZATION_ID"],
    oauthConfigured: () => Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET")),
    oauthRequired: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LinkedIn organization permissions"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("LINKEDIN_HANDLE", "SOCIAL_LINKEDIN_HANDLE")) || defaultHandle,
    scopes: ["r_organization_social", "rw_organization_admin", "w_organization_social"],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    provider: "Pinterest API v5",
    configured: () => Boolean(env("PINTEREST_ACCESS_TOKEN")),
    required: ["PINTEREST_ACCESS_TOKEN"],
    oauthConfigured: () => Boolean(env("PINTEREST_CLIENT_ID") && env("PINTEREST_CLIENT_SECRET")),
    oauthRequired: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "Pinterest OAuth scopes"],
    defaultHandle,
    handle: () => cleanHandle(firstEnv("PINTEREST_HANDLE", "SOCIAL_PINTEREST_HANDLE")) || defaultHandle,
    scopes: ["user_accounts:read", "boards:read", "pins:read", "pins:write"],
  },
];

export function getSocialAnalyticsConnectorStatus() {
  const connectors = CONNECTORS.map((connector) => ({
    id: connector.id,
    name: connector.name,
    provider: connector.provider,
    configured: connector.configured(),
    live: connector.configured(),
    oauthConfigured: connector.oauthConfigured(),
    oauthRequired: connector.oauthRequired,
    defaultHandle: connector.defaultHandle,
    handle: connector.handle(),
    scopes: connector.scopes,
    crossPostCapable: connector.scopes.some((scope) => /write|upload|publish|posts/i.test(scope)),
    readOnly: true,
    required: connector.required,
    reason: connector.configured()
      ? "Ready for official read-only analytics sync."
      : connector.oauthConfigured()
        ? "OAuth app credentials exist, but this channel still needs an authorized account token for live analytics."
        : "Connect this channel with OAuth credentials before live analytics or cross-posting can run.",
  }));
  return {
    mode: "official_oauth_required" as const,
    live: connectors.length > 0 && connectors.every((connector) => connector.live),
    anyLive: connectors.some((connector) => connector.live),
    allRequiredLive: connectors.every((connector) => connector.live),
    connectors,
    secretsExposed: false,
    importFallbackAvailable: true,
    defaultHandle,
    crossPostingRequiresApproval: true,
  };
}

export function isSocialAnalyticsPlatform(value: unknown): value is SocialAnalyticsPlatform {
  return typeof value === "string" && socialPlatforms.includes(value as SocialAnalyticsPlatform);
}

function requiredOAuthRedirectUri(platform: SocialAnalyticsPlatform) {
  const specific = env(`${platform.toUpperCase()}_OAUTH_REDIRECT_URI`);
  const social = env("SOCIAL_OAUTH_REDIRECT_URI");
  return specific || social;
}

function oauthState(platform: SocialAnalyticsPlatform) {
  return `phantomforce:${platform}:${randomBytes(16).toString("hex")}`;
}

function scopeValue(platform: SocialAnalyticsPlatform, scopes: string[]) {
  if (platform === "youtube") {
    return [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ].join(" ");
  }
  if (platform === "tiktok") return scopes.join(",");
  return scopes.join(" ");
}

export function createSocialOAuthStart(platform: SocialAnalyticsPlatform) {
  const connector = CONNECTORS.find((item) => item.id === platform);
  if (!connector) throw new Error("Unsupported social platform.");
  if (!connector.oauthConfigured()) {
    throw new Error(`${connector.name} OAuth app is not configured. Missing: ${connector.oauthRequired.join(", ")}.`);
  }
  const redirectUri = requiredOAuthRedirectUri(platform);
  if (!redirectUri) {
    throw new Error(`${connector.name} OAuth needs ${platform.toUpperCase()}_OAUTH_REDIRECT_URI or SOCIAL_OAUTH_REDIRECT_URI.`);
  }
  const state = oauthState(platform);
  const scopes = scopeValue(platform, connector.scopes);
  let authorizationUrl = "";
  if (platform === "youtube") {
    authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: firstEnv("YOUTUBE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      state,
    })}`;
  } else if (platform === "instagram" || platform === "facebook") {
    authorizationUrl = `https://www.facebook.com/${env("META_GRAPH_VERSION") || "v21.0"}/dialog/oauth?${new URLSearchParams({
      client_id: env("META_APP_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
    })}`;
  } else if (platform === "tiktok") {
    authorizationUrl = `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
      client_key: env("TIKTOK_CLIENT_KEY"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
    })}`;
  } else if (platform === "x") {
    authorizationUrl = `https://x.com/i/oauth2/authorize?${new URLSearchParams({
      client_id: env("X_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
      code_challenge: env("X_OAUTH_CODE_CHALLENGE") || "configure-server-generated-pkce",
      code_challenge_method: "S256",
    })}`;
  } else if (platform === "linkedin") {
    authorizationUrl = `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
      client_id: env("LINKEDIN_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
    })}`;
  } else {
    authorizationUrl = `https://www.pinterest.com/oauth/?${new URLSearchParams({
      client_id: env("PINTEREST_CLIENT_ID"),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes,
      state,
    })}`;
  }

  return {
    platform,
    provider: connector.provider,
    authorizationUrl,
    redirectUri,
    scopes: connector.scopes,
    state,
    handle: connector.handle(),
    readOnlyAnalytics: true,
    crossPostingRequiresApproval: true,
    storesSecretsInBrowser: false,
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

async function syncX(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = firstEnv("X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN");
  const username = cleanHandle(firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME")) || defaultHandle;
  if (!token || !username) throw new Error("X is not connected.");
  const headers = { Authorization: `Bearer ${token}` };
  const user = await requestJson(fetcher, `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics`, { headers });
  const metrics = user?.data?.public_metrics || {};
  return {
    platform: "x",
    reach: 0,
    impressions: 0,
    engagement: 0,
    followers: number(metrics.followers_count),
    posts: number(metrics.tweet_count),
    source: "Official X profile metrics",
    provider: "X API v2",
    syncedAt: new Date().toISOString(),
    period: "Current profile totals",
    series: [{
      label: new Date().toISOString().slice(0, 10),
      reach: 0,
      impressions: 0,
      engagement: 0,
      followers: number(metrics.followers_count),
    }],
  };
}

async function syncLinkedIn(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = env("LINKEDIN_ACCESS_TOKEN");
  const organizationId = env("LINKEDIN_ORGANIZATION_ID");
  if (!token || !organizationId) throw new Error("LinkedIn is not connected.");
  const organizationUrn = organizationId.startsWith("urn:li:organization:")
    ? organizationId
    : `urn:li:organization:${organizationId}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": env("LINKEDIN_API_VERSION") || "202506",
    "X-Restli-Protocol-Version": "2.0.0",
  };
  const query = new URLSearchParams({
    q: "organizationalEntity",
    organizationalEntity: organizationUrn,
  });
  const stats = await requestJson(fetcher, `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?${query}`, { headers });
  const elements = Array.isArray(stats?.elements) ? stats.elements : [];
  const latest = elements.at(-1) || {};
  const followerCount = number(
    latest?.followerCounts?.totalFollowerCounts
      || latest?.totalFollowerCounts
      || stats?.paging?.total,
  );
  return {
    platform: "linkedin",
    reach: 0,
    impressions: 0,
    engagement: 0,
    followers: followerCount,
    posts: 0,
    source: "Official LinkedIn organization follower statistics",
    provider: "LinkedIn Marketing API",
    syncedAt: new Date().toISOString(),
    period: "Current organization totals",
    series: elements.map((item: any) => ({
      label: text(item?.timeRange?.end ? new Date(number(item.timeRange.end)).toISOString().slice(0, 10) : "").slice(0, 10) || "Current",
      reach: 0,
      impressions: 0,
      engagement: 0,
      followers: number(item?.followerCounts?.totalFollowerCounts || item?.totalFollowerCounts),
    })).filter((point: SocialAnalyticsPoint) => point.followers > 0).slice(-30),
  };
}

async function syncPinterest(fetcher: typeof fetch): Promise<SocialAnalyticsSnapshot> {
  const token = env("PINTEREST_ACCESS_TOKEN");
  if (!token) throw new Error("Pinterest is not connected.");
  const headers = { Authorization: `Bearer ${token}` };
  const profile = await requestJson(fetcher, "https://api.pinterest.com/v5/user_account", { headers });
  const followers = number(profile?.follower_count || profile?.followers_count);
  const monthlyViews = number(profile?.monthly_views || profile?.profile_views);
  return {
    platform: "pinterest",
    reach: monthlyViews,
    impressions: monthlyViews,
    engagement: 0,
    followers,
    posts: number(profile?.pin_count || profile?.pins_count),
    source: "Official Pinterest user account metrics",
    provider: "Pinterest API v5",
    syncedAt: new Date().toISOString(),
    period: "Current profile totals",
    series: [{
      label: new Date().toISOString().slice(0, 10),
      reach: monthlyViews,
      impressions: monthlyViews,
      engagement: 0,
      followers,
    }],
  };
}

export async function syncSocialAnalytics(platform: SocialAnalyticsPlatform, fetcher: typeof fetch = fetch) {
  const connector = CONNECTORS.find((item) => item.id === platform);
  if (!connector) throw new Error("Unsupported social analytics platform.");
  if (!connector.configured()) throw new Error(`${connector.name} is not connected. Add its official API connection in Settings first.`);
  if (platform === "youtube") return syncYouTube(fetcher);
  if (platform === "instagram") return syncInstagram(fetcher);
  if (platform === "facebook") return syncFacebook(fetcher);
  if (platform === "tiktok") return syncTikTok(fetcher);
  if (platform === "x") return syncX(fetcher);
  if (platform === "linkedin") return syncLinkedIn(fetcher);
  return syncPinterest(fetcher);
}
