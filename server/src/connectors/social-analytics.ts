export type SocialProviderId = "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "x";

export type SocialProviderStatus = {
  id: SocialProviderId;
  name: string;
  configured: boolean;
  connected: boolean;
  analyticsReady: boolean;
  authUrl: string | null;
  scopes: string[];
  reason: string;
};

export type SocialAnalyticsMetric = {
  label: string;
  value: string;
  delta: string;
};

export type SocialAnalyticsSnapshot = {
  connectedProviders: number;
  analyticsReadyProviders: number;
  metrics: SocialAnalyticsMetric[];
  providerBreakdown: Array<{
    providerId: SocialProviderId;
    providerName: string;
    followers: number;
    reach: number;
    engagement: number;
    posts: number;
  }>;
  reason: string;
};

const providerDefinitions: Array<{
  id: SocialProviderId;
  name: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  accessTokenEnv: string;
  accountIdEnv?: string;
  redirectUriEnv: string;
  defaultRedirectPath: string;
  oauthBaseUrl: string;
  scopes: string[];
  analyticsReader: boolean;
}> = [
  {
    id: "instagram",
    name: "Instagram",
    clientIdEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    accessTokenEnv: "INSTAGRAM_ACCESS_TOKEN",
    accountIdEnv: "INSTAGRAM_BUSINESS_ACCOUNT_ID",
    redirectUriEnv: "INSTAGRAM_REDIRECT_URI",
    defaultRedirectPath: "/oauth/instagram/callback",
    oauthBaseUrl: "https://www.instagram.com/oauth/authorize",
    scopes: ["instagram_business_basic", "instagram_business_manage_insights"],
    analyticsReader: true,
  },
  {
    id: "facebook",
    name: "Facebook",
    clientIdEnv: "FACEBOOK_CLIENT_ID",
    clientSecretEnv: "FACEBOOK_CLIENT_SECRET",
    accessTokenEnv: "FACEBOOK_ACCESS_TOKEN",
    redirectUriEnv: "FACEBOOK_REDIRECT_URI",
    defaultRedirectPath: "/oauth/facebook/callback",
    oauthBaseUrl: "https://www.facebook.com/v20.0/dialog/oauth",
    scopes: ["pages_read_engagement", "read_insights"],
    analyticsReader: false,
  },
  {
    id: "tiktok",
    name: "TikTok",
    clientIdEnv: "TIKTOK_CLIENT_ID",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    accessTokenEnv: "TIKTOK_ACCESS_TOKEN",
    redirectUriEnv: "TIKTOK_REDIRECT_URI",
    defaultRedirectPath: "/oauth/tiktok/callback",
    oauthBaseUrl: "https://www.tiktok.com/v2/auth/authorize",
    scopes: ["user.info.basic", "video.list"],
    analyticsReader: false,
  },
  {
    id: "youtube",
    name: "YouTube",
    clientIdEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    accessTokenEnv: "YOUTUBE_ACCESS_TOKEN",
    redirectUriEnv: "YOUTUBE_REDIRECT_URI",
    defaultRedirectPath: "/oauth/youtube/callback",
    oauthBaseUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"],
    analyticsReader: false,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    accessTokenEnv: "LINKEDIN_ACCESS_TOKEN",
    redirectUriEnv: "LINKEDIN_REDIRECT_URI",
    defaultRedirectPath: "/oauth/linkedin/callback",
    oauthBaseUrl: "https://www.linkedin.com/oauth/v2/authorization",
    scopes: ["openid", "profile", "r_organization_social"],
    analyticsReader: false,
  },
  {
    id: "x",
    name: "X",
    clientIdEnv: "X_CLIENT_ID",
    clientSecretEnv: "X_CLIENT_SECRET",
    accessTokenEnv: "X_ACCESS_TOKEN",
    redirectUriEnv: "X_REDIRECT_URI",
    defaultRedirectPath: "/oauth/x/callback",
    oauthBaseUrl: "https://twitter.com/i/oauth2/authorize",
    scopes: ["tweet.read", "users.read", "offline.access"],
    analyticsReader: false,
  },
];

function readEnv(name: string) {
  return process.env[`PHANTOMFORCE_${name}`] ?? process.env[name] ?? "";
}

function buildRedirectUri(definition: (typeof providerDefinitions)[number]) {
  const explicit = readEnv(definition.redirectUriEnv);
  if (explicit) return explicit;
  const publicUrl = process.env.PHANTOMFORCE_PUBLIC_URL;
  return publicUrl ? `${publicUrl.replace(/\/$/, "")}${definition.defaultRedirectPath}` : "";
}

function buildAuthUrl(definition: (typeof providerDefinitions)[number]) {
  const clientId = readEnv(definition.clientIdEnv);
  const redirectUri = buildRedirectUri(definition);
  if (!clientId || !redirectUri) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: definition.scopes.join(" "),
    state: `phantomforce-${definition.id}`,
  });

  if (definition.id === "youtube") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }

  return `${definition.oauthBaseUrl}?${params.toString()}`;
}

export function listSocialProviderStatuses(): SocialProviderStatus[] {
  return providerDefinitions.map((definition) => {
    const clientId = readEnv(definition.clientIdEnv);
    const clientSecret = readEnv(definition.clientSecretEnv);
    const accessToken = readEnv(definition.accessTokenEnv);
    const accountId = definition.accountIdEnv ? readEnv(definition.accountIdEnv) : "";
    const configured = Boolean(clientId && clientSecret && buildRedirectUri(definition));
    const connected = Boolean(accessToken);
    const analyticsReady = connected && definition.analyticsReader && (!definition.accountIdEnv || Boolean(accountId));

    return {
      id: definition.id,
      name: definition.name,
      configured,
      connected,
      analyticsReady,
      authUrl: configured ? buildAuthUrl(definition) : null,
      scopes: definition.scopes,
      reason: analyticsReady
        ? "Access token and analytics account id are present; the backend can read this provider."
        : connected && definition.analyticsReader
          ? `Access token is present, but ${definition.accountIdEnv} is missing, so analytics cannot be queried yet.`
        : connected
          ? "Access token is present, but the live analytics reader for this provider is not implemented yet."
        : configured
          ? "OAuth is configured. User still needs to authorize this provider."
          : `Missing OAuth environment config: ${definition.clientIdEnv}, ${definition.clientSecretEnv}, and ${definition.redirectUriEnv} or PHANTOMFORCE_PUBLIC_URL.`,
    };
  });
}

export function buildConnectAllSocialsPlan() {
  const providers = listSocialProviderStatuses();
  return {
    providers,
    attempts: providers.map((provider) => ({
      providerId: provider.id,
      providerName: provider.name,
      status: provider.connected ? "already_connected" : provider.authUrl ? "ready_to_open_oauth" : "missing_oauth_config",
      authUrl: provider.authUrl,
      reason: provider.reason,
    })),
  };
}

type InstagramAccountResponse = {
  followers_count?: number;
  media_count?: number;
};

type InstagramMediaResponse = {
  data?: Array<{
    like_count?: number;
    comments_count?: number;
  }>;
};

type InstagramInsightResponse = {
  data?: Array<{
    name?: string;
    values?: Array<{ value?: number }>;
  }>;
};

async function fetchInstagramBreakdown(): Promise<SocialAnalyticsSnapshot["providerBreakdown"][number] | null> {
  const accessToken = readEnv("INSTAGRAM_ACCESS_TOKEN");
  const accountId = readEnv("INSTAGRAM_BUSINESS_ACCOUNT_ID");

  if (!accessToken || !accountId) return null;

  const graphVersion = process.env.PHANTOMFORCE_META_GRAPH_VERSION ?? "v20.0";
  const baseUrl = `https://graph.facebook.com/${graphVersion}`;
  const tokenParam = `access_token=${encodeURIComponent(accessToken)}`;

  const accountResponse = await fetch(
    `${baseUrl}/${encodeURIComponent(accountId)}?fields=followers_count,media_count&${tokenParam}`,
  );
  if (!accountResponse.ok) {
    throw new Error(`Instagram account analytics failed with HTTP ${accountResponse.status}.`);
  }
  const account = (await accountResponse.json()) as InstagramAccountResponse;

  const mediaResponse = await fetch(
    `${baseUrl}/${encodeURIComponent(accountId)}/media?fields=like_count,comments_count&limit=25&${tokenParam}`,
  );
  const media = mediaResponse.ok ? ((await mediaResponse.json()) as InstagramMediaResponse) : { data: [] };
  const engagement = (media.data ?? []).reduce(
    (sum, item) => sum + (item.like_count ?? 0) + (item.comments_count ?? 0),
    0,
  );

  let reach = 0;
  const insightsResponse = await fetch(
    `${baseUrl}/${encodeURIComponent(accountId)}/insights?metric=reach&period=day&${tokenParam}`,
  );
  if (insightsResponse.ok) {
    const insights = (await insightsResponse.json()) as InstagramInsightResponse;
    reach =
      insights.data
        ?.find((item) => item.name === "reach")
        ?.values?.reduce((sum, value) => sum + (value.value ?? 0), 0) ?? 0;
  }

  return {
    providerId: "instagram",
    providerName: "Instagram",
    followers: account.followers_count ?? 0,
    reach,
    engagement,
    posts: account.media_count ?? media.data?.length ?? 0,
  };
}

export async function getSocialAnalyticsSnapshot(): Promise<SocialAnalyticsSnapshot> {
  const providers = listSocialProviderStatuses();
  const readyProviders = providers.filter((provider) => provider.analyticsReady);

  if (!readyProviders.length) {
    return {
      connectedProviders: providers.filter((provider) => provider.connected).length,
      analyticsReadyProviders: 0,
      metrics: [
        { label: "Total reach", value: "0", delta: "Connect analytics permissions" },
        { label: "Engagement", value: "0", delta: "No readable provider yet" },
        { label: "Audience", value: "0", delta: "Waiting on OAuth" },
      ],
      providerBreakdown: [],
      reason:
        "No social provider has a backend analytics token yet. A profile can appear connected in the UI while insights still fail if OAuth scopes or tokens were never stored server-side.",
    };
  }

  const providerBreakdown = (
    await Promise.all(readyProviders.map((provider) => (provider.id === "instagram" ? fetchInstagramBreakdown() : null)))
  ).filter((provider): provider is SocialAnalyticsSnapshot["providerBreakdown"][number] => Boolean(provider));

  if (!providerBreakdown.length) {
    return {
      connectedProviders: providers.filter((provider) => provider.connected).length,
      analyticsReadyProviders: readyProviders.length,
      metrics: [
        { label: "Total reach", value: "0", delta: "Provider reader returned no rows" },
        { label: "Engagement", value: "0", delta: "No readable posts yet" },
        { label: "Audience", value: "0", delta: "No follower total yet" },
      ],
      providerBreakdown: [],
      reason: "A provider is configured for analytics, but the live API returned no readable rows.",
    };
  }

  const totals = providerBreakdown.reduce(
    (sum, provider) => ({
      followers: sum.followers + provider.followers,
      reach: sum.reach + provider.reach,
      engagement: sum.engagement + provider.engagement,
      posts: sum.posts + provider.posts,
    }),
    { followers: 0, reach: 0, engagement: 0, posts: 0 },
  );

  return {
    connectedProviders: providers.filter((provider) => provider.connected).length,
    analyticsReadyProviders: readyProviders.length,
    metrics: [
      { label: "Total reach", value: totals.reach.toLocaleString(), delta: `${readyProviders.length} sources` },
      { label: "Engagement", value: totals.engagement.toLocaleString(), delta: `${totals.posts} recent posts` },
      { label: "Audience", value: totals.followers.toLocaleString(), delta: "combined followers" },
    ],
    providerBreakdown,
    reason: "Combined social analytics are available for providers with backend tokens.",
  };
}
