import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_SOCIAL_WORKSPACE,
  consumePendingSocialOAuthState,
  getStoredSocialConnection,
  redactedConnection,
  safeSocialWorkspaceKey,
  savePendingSocialOAuthState,
  saveStoredSocialConnection,
  socialConnectionStoreStatus,
} from "./social-connection-store.js";
import { ADMIN_PUBLIC_URL } from "../access/public-hosts.js";

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
  configured: (workspaceKey?: string) => boolean;
  required: string[];
  oauthConfigured: () => boolean;
  oauthRequired: string[];
  defaultHandle: string;
  handle: (workspaceKey?: string) => string;
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
const base64Url = (input: Buffer) => input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const basicAuth = (clientId: string, clientSecret: string) => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

type SocialOAuthSetupProvider = {
  id: SocialAnalyticsPlatform;
  idEnv: string;
  secretEnv: string;
  idLabel: string;
  secretLabel: string;
  consoleUrl: string;
};

const OAUTH_SETUP_PROVIDERS: SocialOAuthSetupProvider[] = [
  { id: "youtube", idEnv: "GOOGLE_OAUTH_CLIENT_ID", secretEnv: "GOOGLE_OAUTH_CLIENT_SECRET", idLabel: "Google client ID", secretLabel: "Google client secret", consoleUrl: "https://console.cloud.google.com/apis/credentials" },
  { id: "instagram", idEnv: "META_APP_ID", secretEnv: "META_APP_SECRET", idLabel: "Meta app ID", secretLabel: "Meta app secret", consoleUrl: "https://developers.facebook.com/apps/" },
  { id: "facebook", idEnv: "META_APP_ID", secretEnv: "META_APP_SECRET", idLabel: "Meta app ID", secretLabel: "Meta app secret", consoleUrl: "https://developers.facebook.com/apps/" },
  { id: "tiktok", idEnv: "TIKTOK_CLIENT_KEY", secretEnv: "TIKTOK_CLIENT_SECRET", idLabel: "TikTok client key", secretLabel: "TikTok client secret", consoleUrl: "https://developers.tiktok.com/apps/" },
  { id: "x", idEnv: "X_CLIENT_ID", secretEnv: "X_CLIENT_SECRET", idLabel: "X client ID", secretLabel: "X client secret", consoleUrl: "https://developer.x.com/en/portal/dashboard" },
  { id: "linkedin", idEnv: "LINKEDIN_CLIENT_ID", secretEnv: "LINKEDIN_CLIENT_SECRET", idLabel: "LinkedIn client ID", secretLabel: "LinkedIn client secret", consoleUrl: "https://www.linkedin.com/developers/apps" },
  { id: "pinterest", idEnv: "PINTEREST_CLIENT_ID", secretEnv: "PINTEREST_CLIENT_SECRET", idLabel: "Pinterest client ID", secretLabel: "Pinterest client secret", consoleUrl: "https://developers.pinterest.com/apps/" },
];

const serverEnvPath = () => resolve(process.env.PHANTOMFORCE_ENV_FILE || process.cwd(), ".env");

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function upsertEnvValues(values: Record<string, string>) {
  const path = serverEnvPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const used = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Z0-9_]+)(\s*=).*/);
    if (!match) return line;
    const name = match[2];
    if (!(name in values)) return line;
    used.add(name);
    return `${match[1]}${name}${match[3]}${quoteEnvValue(values[name])}`;
  });
  const missing = Object.entries(values).filter(([name]) => !used.has(name));
  if (missing.length) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push("# PhantomForce social OAuth app credentials");
    for (const [name, value] of missing) next.push(`${name}=${quoteEnvValue(value)}`);
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${next.join("\n").replace(/\n+$/u, "")}\n`, "utf8");
  renameSync(tmp, path);
  Object.assign(process.env, values);
}

const stored = (platform: SocialAnalyticsPlatform, key: string, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => {
  const connection = getStoredSocialConnection(platform, workspaceKey);
  const value = connection?.[key as keyof typeof connection];
  return typeof value === "string" ? text(value) : "";
};
const firstStored = (platform: SocialAnalyticsPlatform, workspaceKey: string, ...keys: string[]) => keys.map((key) => stored(platform, key, workspaceKey)).find(Boolean) || "";
const hasStoredToken = (platform: SocialAnalyticsPlatform, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean(stored(platform, "accessToken", workspaceKey));

const CONNECTORS: ConnectorDefinition[] = [
  {
    id: "youtube",
    name: "YouTube",
    provider: "YouTube Data API",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean((env("YOUTUBE_API_KEY") && (env("YOUTUBE_CHANNEL_ID") || env("YOUTUBE_CHANNEL_HANDLE"))) || hasStoredToken("youtube", workspaceKey)),
    required: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE"],
    oauthConfigured: () => Boolean(firstEnv("YOUTUBE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID") && firstEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET")),
    oauthRequired: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "YouTube analytics scopes"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("YOUTUBE_CHANNEL_HANDLE", "SOCIAL_YOUTUBE_HANDLE") || firstStored("youtube", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["youtube.readonly", "yt-analytics.readonly"],
  },
  {
    id: "instagram",
    name: "Instagram",
    provider: "Instagram Graph API",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean((env("INSTAGRAM_ACCESS_TOKEN") && env("INSTAGRAM_BUSINESS_ACCOUNT_ID")) || (hasStoredToken("instagram", workspaceKey) && firstStored("instagram", workspaceKey, "businessAccountId", "accountId"))),
    required: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID"],
    oauthConfigured: metaOauthConfigured,
    oauthRequired: ["META_APP_ID", "META_APP_SECRET", "Instagram Business analytics permissions"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("INSTAGRAM_HANDLE", "SOCIAL_INSTAGRAM_HANDLE") || firstStored("instagram", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "read_insights"],
  },
  {
    id: "facebook",
    name: "Facebook",
    provider: "Facebook Graph API",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean((env("FACEBOOK_PAGE_ACCESS_TOKEN") && env("FACEBOOK_PAGE_ID")) || (hasStoredToken("facebook", workspaceKey) && firstStored("facebook", workspaceKey, "pageId", "accountId"))),
    required: ["FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID"],
    oauthConfigured: metaOauthConfigured,
    oauthRequired: ["META_APP_ID", "META_APP_SECRET", "Facebook Page analytics permissions"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("FACEBOOK_PAGE_HANDLE", "SOCIAL_FACEBOOK_HANDLE") || firstStored("facebook", workspaceKey, "accountHandle", "pageName", "accountName")) || defaultHandle,
    scopes: ["pages_show_list", "pages_read_engagement", "read_insights"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    provider: "TikTok Display API",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean(env("TIKTOK_ACCESS_TOKEN") || hasStoredToken("tiktok", workspaceKey)),
    required: ["TIKTOK_ACCESS_TOKEN"],
    oauthConfigured: () => Boolean(env("TIKTOK_CLIENT_KEY") && env("TIKTOK_CLIENT_SECRET")),
    oauthRequired: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TikTok read-only analytics scopes"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("TIKTOK_HANDLE", "SOCIAL_TIKTOK_HANDLE") || firstStored("tiktok", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["user.info.basic", "video.list"],
  },
  {
    id: "x",
    name: "X",
    provider: "X API v2",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean((firstEnv("X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN") && firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME")) || (hasStoredToken("x", workspaceKey) && firstStored("x", workspaceKey, "accountHandle", "accountName"))),
    required: ["X_BEARER_TOKEN or TWITTER_BEARER_TOKEN", "X_USERNAME or X_HANDLE"],
    oauthConfigured: () => Boolean(env("X_CLIENT_ID") && env("X_CLIENT_SECRET")),
    oauthRequired: ["X_CLIENT_ID", "X_CLIENT_SECRET", "X OAuth scopes"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME", "SOCIAL_X_HANDLE") || firstStored("x", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["tweet.read", "users.read", "offline.access"],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    provider: "LinkedIn Marketing API",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean((env("LINKEDIN_ACCESS_TOKEN") && env("LINKEDIN_ORGANIZATION_ID")) || (hasStoredToken("linkedin", workspaceKey) && firstStored("linkedin", workspaceKey, "accountId"))),
    required: ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORGANIZATION_ID"],
    oauthConfigured: () => Boolean(env("LINKEDIN_CLIENT_ID") && env("LINKEDIN_CLIENT_SECRET")),
    oauthRequired: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LinkedIn organization permissions"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("LINKEDIN_HANDLE", "SOCIAL_LINKEDIN_HANDLE") || firstStored("linkedin", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["openid", "profile", "r_organization_social", "rw_organization_admin", "w_organization_social"],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    provider: "Pinterest API v5",
    configured: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => Boolean(env("PINTEREST_ACCESS_TOKEN") || hasStoredToken("pinterest", workspaceKey)),
    required: ["PINTEREST_ACCESS_TOKEN"],
    oauthConfigured: () => Boolean(env("PINTEREST_CLIENT_ID") && env("PINTEREST_CLIENT_SECRET")),
    oauthRequired: ["PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET", "Pinterest OAuth scopes"],
    defaultHandle,
    handle: (workspaceKey = DEFAULT_SOCIAL_WORKSPACE) => cleanHandle(firstEnv("PINTEREST_HANDLE", "SOCIAL_PINTEREST_HANDLE") || firstStored("pinterest", workspaceKey, "accountHandle", "accountName")) || defaultHandle,
    scopes: ["user_accounts:read", "boards:read", "pins:read"],
  },
];

export function getSocialAnalyticsConnectorStatus(workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const scope = safeSocialWorkspaceKey(workspaceKey);
  const connectors = CONNECTORS.map((connector) => ({
    id: connector.id,
    name: connector.name,
    provider: connector.provider,
    configured: connector.configured(scope),
    live: connector.configured(scope),
    oauthConfigured: connector.oauthConfigured(),
    oauthRequired: connector.oauthRequired,
    defaultHandle: connector.defaultHandle,
    handle: connector.handle(scope),
    scopes: connector.scopes,
    analyticsScopes: connector.scopes.filter((scope) => /read|readonly|analytics|insights|basic|profile|openid|list|user\.info/i.test(scope)),
    postingScopes: connector.scopes.filter((scope) => /write|upload|publish|posts|manage_posts/i.test(scope)),
    crossPostCapable: false,
    analyticsReadOnly: true,
    postingRequiresApproval: true,
    required: connector.required,
    savedConnection: redactedConnection(getStoredSocialConnection(connector.id, scope)),
    reason: connector.configured(scope)
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
    postingMode: "approval_gated" as const,
    tokenStore: socialConnectionStoreStatus(scope),
  };
}

export function getSocialOAuthSetupStatus() {
  const redirectUri = requiredOAuthRedirectUri("youtube");
  const providers = OAUTH_SETUP_PROVIDERS.map((setup) => {
    const connector = CONNECTORS.find((item) => item.id === setup.id);
    const idSet = Boolean(env(setup.idEnv));
    const secretSet = Boolean(env(setup.secretEnv));
    return {
      id: setup.id,
      name: connector?.name || setup.id,
      provider: connector?.provider || setup.id,
      oauthConfigured: Boolean(connector?.oauthConfigured()),
      idEnv: setup.idEnv,
      secretEnv: setup.secretEnv,
      idLabel: setup.idLabel,
      secretLabel: setup.secretLabel,
      consoleUrl: setup.consoleUrl,
      idSet,
      secretSet,
      missing: [
        ...(idSet ? [] : [setup.idEnv]),
        ...(secretSet ? [] : [setup.secretEnv]),
      ],
      scopes: connector?.scopes || [],
      callbackUrl: requiredOAuthRedirectUri(setup.id),
    };
  });
  const uniqueProviders = providers.filter((provider, index, all) => (
    provider.id !== "facebook" || !all.some((item, itemIndex) => itemIndex < index && item.id === "instagram")
  ));
  return {
    ok: true as const,
    envFile: serverEnvPath(),
    redirectUri,
    recommendedRedirectUri: `${ADMIN_PUBLIC_URL}/phantom-ai/ops/social-oauth/callback`,
    providers: uniqueProviders,
    readyCount: uniqueProviders.filter((provider) => provider.oauthConfigured).length,
    totalCount: uniqueProviders.length,
    secretsExposed: false,
  };
}

export function saveSocialOAuthSetup(input: {
  platform?: unknown;
  clientId?: unknown;
  clientSecret?: unknown;
  redirectUri?: unknown;
}) {
  const platform = text(input.platform).toLowerCase() as SocialAnalyticsPlatform;
  if (!isSocialAnalyticsPlatform(platform)) throw new Error("Choose a supported social platform.");
  const setup = OAUTH_SETUP_PROVIDERS.find((item) => item.id === platform);
  if (!setup) throw new Error("That social platform does not have an OAuth setup profile.");
  const values: Record<string, string> = {};
  const clientId = text(input.clientId);
  const clientSecret = text(input.clientSecret);
  const redirectUri = text(input.redirectUri);
  if (clientId) values[setup.idEnv] = clientId;
  if (clientSecret) values[setup.secretEnv] = clientSecret;
  if (redirectUri) values.SOCIAL_OAUTH_REDIRECT_URI = redirectUri;
  if (!Object.keys(values).length) throw new Error("Paste at least one OAuth app value before saving.");
  upsertEnvValues(values);
  return getSocialOAuthSetupStatus();
}

export function isSocialAnalyticsPlatform(value: unknown): value is SocialAnalyticsPlatform {
  return typeof value === "string" && socialPlatforms.includes(value as SocialAnalyticsPlatform);
}

function requiredOAuthRedirectUri(platform: SocialAnalyticsPlatform) {
  const specific = env(`${platform.toUpperCase()}_OAUTH_REDIRECT_URI`);
  const social = env("SOCIAL_OAUTH_REDIRECT_URI");
  return specific || social || `${ADMIN_PUBLIC_URL}/phantom-ai/ops/social-oauth/callback`;
}

function oauthState(platform: SocialAnalyticsPlatform) {
  return `phantomforce:${platform}:${randomBytes(16).toString("hex")}`;
}

function pkcePair() {
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function scopeValue(platform: SocialAnalyticsPlatform, scopes: string[]) {
  if (platform === "youtube") {
    return [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ].join(" ");
  }
  if (platform === "tiktok") return scopes.join(",");
  return scopes.join(" ");
}

export function createSocialOAuthStart(platform: SocialAnalyticsPlatform, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const scope = safeSocialWorkspaceKey(workspaceKey);
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
  const pkce = platform === "x" ? pkcePair() : null;
  savePendingSocialOAuthState(state, platform, { ...(pkce ? { codeVerifier: pkce.verifier } : {}), workspaceKey: scope });
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
      code_challenge: pkce?.challenge || "",
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
    handle: connector.handle(scope),
    readOnlyAnalytics: true,
    crossPostingRequiresApproval: true,
    storesSecretsInBrowser: false,
  };
}

function tokenExpiry(expiresIn: unknown) {
  const seconds = number(expiresIn);
  return seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : undefined;
}

async function exchangeToken(fetcher: typeof fetch, url: string, body: URLSearchParams, headers: Record<string, string> = {}) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = text(payload?.error_description || payload?.error?.message || payload?.error || payload?.message);
    throw new Error(message || `OAuth token exchange failed with HTTP ${response.status}.`);
  }
  return payload;
}

function pickChicagoShotsPage(pages: any[]) {
  const target = cleanHandle(firstEnv("FACEBOOK_PAGE_HANDLE", "SOCIAL_FACEBOOK_HANDLE", "INSTAGRAM_HANDLE", "SOCIAL_INSTAGRAM_HANDLE")) || defaultHandle;
  const normalizedTarget = target.toLowerCase();
  return pages.find((page) => {
    const names = [
      page?.id,
      page?.name,
      page?.username,
      page?.instagram_business_account?.username,
    ].map((value) => cleanHandle(value).toLowerCase());
    return names.some((name) => name === normalizedTarget || name.includes(normalizedTarget));
  }) || pages[0];
}

export async function completeSocialOAuthCallback(query: Record<string, unknown>, fetcher: typeof fetch = fetch) {
  const state = text(query.state);
  const code = text(query.code);
  const error = text(query.error || query.error_description);
  if (error) throw new Error(`Provider rejected the account connection: ${error}`);
  if (!state || !code) throw new Error("OAuth callback is missing its state or authorization code.");
  const pending = consumePendingSocialOAuthState(state);
  if (!pending) throw new Error("OAuth callback state was not recognized or expired. Start the connection again.");
  const platform = pending.platform;
  const scope = safeSocialWorkspaceKey(pending.workspaceKey);
  const redirectUri = requiredOAuthRedirectUri(platform);
  if (!redirectUri) throw new Error("OAuth redirect URI is not configured.");

  if (platform === "youtube") {
    const payload = await exchangeToken(fetcher, "https://oauth2.googleapis.com/token", new URLSearchParams({
      client_id: firstEnv("YOUTUBE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: firstEnv("YOUTUBE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }));
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new Error("Google did not return an access token.");
    const channel = await requestJson(
      fetcher,
      "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const item = channel?.items?.[0];
    const saved = saveStoredSocialConnection("youtube", {
      provider: "YouTube Data API",
      accessToken,
      refreshToken: text(payload?.refresh_token) || undefined,
      expiresAt: tokenExpiry(payload?.expires_in),
      accountId: text(item?.id),
      accountName: text(item?.snippet?.title),
      accountHandle: cleanHandle(item?.snippet?.customUrl || item?.snippet?.handle || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "youtube")?.scopes,
    }, scope);
    return { platform, connected: saved };
  }

  if (platform === "instagram" || platform === "facebook") {
    const version = env("META_GRAPH_VERSION") || "v21.0";
    const tokenUrl = `https://graph.facebook.com/${version}/oauth/access_token?${new URLSearchParams({
      client_id: env("META_APP_ID"),
      client_secret: env("META_APP_SECRET"),
      redirect_uri: redirectUri,
      code,
    })}`;
    const tokenPayload = await requestJson(fetcher, tokenUrl);
    const userAccessToken = text(tokenPayload?.access_token);
    if (!userAccessToken) throw new Error("Meta did not return an access token.");
    const accountsQuery = new URLSearchParams({
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: userAccessToken,
    });
    const accounts = await requestJson(fetcher, `https://graph.facebook.com/${version}/me/accounts?${accountsQuery}`);
    const page = pickChicagoShotsPage(Array.isArray(accounts?.data) ? accounts.data : []);
    if (!page?.id || !page?.access_token) {
      throw new Error("No Facebook Page token was returned. Make sure the ChicagoShots Page is selected during Meta authorization.");
    }
    const pageToken = text(page.access_token);
    const facebook = saveStoredSocialConnection("facebook", {
      provider: "Facebook Graph API",
      accessToken: pageToken,
      pageId: text(page.id),
      pageName: text(page.name),
      accountId: text(page.id),
      accountName: text(page.name),
      accountHandle: cleanHandle(page.name || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "facebook")?.scopes,
      metadata: { source: "meta_page_connection" },
    }, scope);
    const ig = page.instagram_business_account;
    const instagram = ig?.id ? saveStoredSocialConnection("instagram", {
      provider: "Instagram Graph API",
      accessToken: pageToken,
      businessAccountId: text(ig.id),
      accountId: text(ig.id),
      accountName: text(ig.username || page.name),
      accountHandle: cleanHandle(ig.username || defaultHandle),
      pageId: text(page.id),
      pageName: text(page.name),
      scopes: CONNECTORS.find((connector) => connector.id === "instagram")?.scopes,
      metadata: { source: "meta_page_instagram_business_connection" },
    }, scope) : null;
    return { platform, connected: platform === "instagram" ? instagram || facebook : facebook, linkedFacebookPage: facebook, linkedInstagramBusiness: instagram };
  }

  if (platform === "tiktok") {
    const payload = await exchangeToken(fetcher, "https://open.tiktokapis.com/v2/oauth/token/", new URLSearchParams({
      client_key: env("TIKTOK_CLIENT_KEY"),
      client_secret: env("TIKTOK_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }));
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new Error("TikTok did not return an access token.");
    const profile = await requestJson(fetcher, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = profile?.data?.user || {};
    const saved = saveStoredSocialConnection("tiktok", {
      provider: "TikTok Display API",
      accessToken,
      refreshToken: text(payload?.refresh_token) || undefined,
      expiresAt: tokenExpiry(payload?.expires_in),
      accountId: text(user?.open_id || payload?.open_id),
      accountName: text(user?.display_name || user?.username),
      accountHandle: cleanHandle(user?.username || user?.display_name || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "tiktok")?.scopes,
      metadata: { source: "tiktok_oauth_login_kit" },
    }, scope);
    return { platform, connected: saved };
  }

  if (platform === "x") {
    if (!pending.codeVerifier) throw new Error("X OAuth callback is missing the server PKCE verifier. Start the connection again.");
    const clientId = env("X_CLIENT_ID");
    const clientSecret = env("X_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("X OAuth needs X_CLIENT_ID and X_CLIENT_SECRET in server/.env.");
    const payload = await exchangeToken(
      fetcher,
      "https://api.x.com/2/oauth2/token",
      new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: pending.codeVerifier,
      }),
      { Authorization: basicAuth(clientId, clientSecret) },
    );
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new Error("X did not return an access token.");
    const me = await requestJson(fetcher, "https://api.x.com/2/users/me?user.fields=username,name,public_metrics", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = me?.data || {};
    const saved = saveStoredSocialConnection("x", {
      provider: "X API v2",
      accessToken,
      refreshToken: text(payload?.refresh_token) || undefined,
      expiresAt: tokenExpiry(payload?.expires_in),
      accountId: text(user?.id),
      accountName: text(user?.name || user?.username),
      accountHandle: cleanHandle(user?.username || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "x")?.scopes,
      metadata: { source: "x_oauth2_pkce" },
    }, scope);
    return { platform, connected: saved };
  }

  if (platform === "linkedin") {
    const payload = await exchangeToken(fetcher, "https://www.linkedin.com/oauth/v2/accessToken", new URLSearchParams({
      client_id: env("LINKEDIN_CLIENT_ID"),
      client_secret: env("LINKEDIN_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }));
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new Error("LinkedIn did not return an access token.");
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": env("LINKEDIN_API_VERSION") || "202506",
      "X-Restli-Protocol-Version": "2.0.0",
    };
    const profile = await requestJson(fetcher, "https://api.linkedin.com/v2/userinfo", { headers }).catch(() => null);
    const orgs = await requestJson(
      fetcher,
      "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
      { headers },
    ).catch(() => null);
    const org = Array.isArray(orgs?.elements) ? orgs.elements[0] : null;
    const organizationUrn = text(org?.organization);
    const organizationId = organizationUrn.replace(/^urn:li:organization:/, "");
    const saved = saveStoredSocialConnection("linkedin", {
      provider: "LinkedIn Marketing API",
      accessToken,
      refreshToken: text(payload?.refresh_token) || undefined,
      expiresAt: tokenExpiry(payload?.expires_in),
      accountId: organizationId || text(profile?.sub),
      accountName: text(profile?.name || profile?.localizedFirstName || "LinkedIn account"),
      accountHandle: cleanHandle(firstEnv("LINKEDIN_HANDLE", "SOCIAL_LINKEDIN_HANDLE") || profile?.name || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "linkedin")?.scopes,
      metadata: {
        source: "linkedin_oauth",
        organizationUrn: organizationUrn || null,
        profileId: text(profile?.sub) || null,
        analyticsLevel: organizationId ? "organization" : "profile_authorized_no_organization_selected",
      },
    }, scope);
    return { platform, connected: saved };
  }

  if (platform === "pinterest") {
    /* Pinterest v5 token exchange authenticates the app with HTTP Basic
       (client_id:client_secret), not form fields. */
    const clientId = env("PINTEREST_CLIENT_ID");
    const clientSecret = env("PINTEREST_CLIENT_SECRET");
    if (!clientId || !clientSecret) throw new Error("Pinterest OAuth needs PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET in server/.env.");
    const payload = await exchangeToken(
      fetcher,
      "https://api.pinterest.com/v5/oauth/token",
      new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
    );
    const accessToken = text(payload?.access_token);
    if (!accessToken) throw new Error("Pinterest did not return an access token.");
    const profile = await requestJson(fetcher, "https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const saved = saveStoredSocialConnection("pinterest", {
      provider: "Pinterest API",
      accessToken,
      refreshToken: text(payload?.refresh_token) || undefined,
      expiresAt: tokenExpiry(payload?.expires_in),
      accountId: text(profile?.id),
      accountName: text(profile?.business_name || profile?.username),
      accountHandle: cleanHandle(profile?.username || defaultHandle),
      scopes: CONNECTORS.find((connector) => connector.id === "pinterest")?.scopes,
    }, scope);
    return { platform, connected: saved };
  }

  throw new Error(`${platform} OAuth callback storage is not implemented yet. Use Settings with an official token for this channel.`);
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

async function syncYouTube(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const apiKey = env("YOUTUBE_API_KEY");
  const accessToken = firstStored("youtube", workspaceKey, "accessToken");
  const channelId = env("YOUTUBE_CHANNEL_ID") || firstStored("youtube", workspaceKey, "accountId");
  const handle = cleanHandle(env("YOUTUBE_CHANNEL_HANDLE") || firstStored("youtube", workspaceKey, "accountHandle"));
  if ((!apiKey && !accessToken) || (!channelId && !handle && !accessToken)) throw new Error("YouTube is not connected.");
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const lookup = new URLSearchParams({ part: "snippet,statistics,contentDetails" });
  if (apiKey) lookup.set("key", apiKey);
  if (channelId) lookup.set("id", channelId);
  else if (handle) lookup.set("forHandle", handle);
  else lookup.set("mine", "true");
  const channelPayload = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/channels?${lookup}`, headers ? { headers } : {});
  const channel = channelPayload?.items?.[0];
  if (!channel) throw new Error("The configured YouTube channel could not be found.");
  const uploads = text(channel?.contentDetails?.relatedPlaylists?.uploads);
  const videos: any[] = [];
  if (uploads) {
    const playlistQuery = new URLSearchParams({ part: "snippet,contentDetails", playlistId: uploads, maxResults: "20" });
    if (apiKey) playlistQuery.set("key", apiKey);
    const playlist = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/playlistItems?${playlistQuery}`, headers ? { headers } : {});
    const ids = (playlist?.items || []).map((item: any) => text(item?.contentDetails?.videoId)).filter(Boolean);
    if (ids.length) {
      const videoQuery = new URLSearchParams({ part: "snippet,statistics", id: ids.join(",") });
      if (apiKey) videoQuery.set("key", apiKey);
      const videoPayload = await requestJson(fetcher, `https://www.googleapis.com/youtube/v3/videos?${videoQuery}`, headers ? { headers } : {});
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

async function syncInstagram(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = env("INSTAGRAM_ACCESS_TOKEN") || firstStored("instagram", workspaceKey, "accessToken");
  const accountId = env("INSTAGRAM_BUSINESS_ACCOUNT_ID") || firstStored("instagram", workspaceKey, "businessAccountId", "accountId");
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

async function syncFacebook(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = env("FACEBOOK_PAGE_ACCESS_TOKEN") || firstStored("facebook", workspaceKey, "accessToken");
  const pageId = env("FACEBOOK_PAGE_ID") || firstStored("facebook", workspaceKey, "pageId", "accountId");
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

async function syncTikTok(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = env("TIKTOK_ACCESS_TOKEN") || firstStored("tiktok", workspaceKey, "accessToken");
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

async function syncX(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = firstEnv("X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN") || firstStored("x", workspaceKey, "accessToken");
  const username = cleanHandle(firstEnv("X_USERNAME", "X_HANDLE", "TWITTER_USERNAME") || firstStored("x", workspaceKey, "accountHandle", "accountName")) || defaultHandle;
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

async function syncLinkedIn(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = env("LINKEDIN_ACCESS_TOKEN") || firstStored("linkedin", workspaceKey, "accessToken");
  const organizationId = env("LINKEDIN_ORGANIZATION_ID") || firstStored("linkedin", workspaceKey, "accountId");
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

async function syncPinterest(fetcher: typeof fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE): Promise<SocialAnalyticsSnapshot> {
  const token = env("PINTEREST_ACCESS_TOKEN") || firstStored("pinterest", workspaceKey, "accessToken");
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

export async function syncSocialAnalytics(platform: SocialAnalyticsPlatform, fetcher: typeof fetch = fetch, workspaceKey = DEFAULT_SOCIAL_WORKSPACE) {
  const scope = safeSocialWorkspaceKey(workspaceKey);
  const connector = CONNECTORS.find((item) => item.id === platform);
  if (!connector) throw new Error("Unsupported social analytics platform.");
  if (!connector.configured(scope)) throw new Error(`${connector.name} is not connected. Add its official API connection in Settings first.`);
  if (platform === "youtube") return syncYouTube(fetcher, scope);
  if (platform === "instagram") return syncInstagram(fetcher, scope);
  if (platform === "facebook") return syncFacebook(fetcher, scope);
  if (platform === "tiktok") return syncTikTok(fetcher, scope);
  if (platform === "x") return syncX(fetcher, scope);
  if (platform === "linkedin") return syncLinkedIn(fetcher, scope);
  return syncPinterest(fetcher, scope);
}
