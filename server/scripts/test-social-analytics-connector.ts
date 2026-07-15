import {
  completeSocialOAuthCallback,
  createSocialOAuthStart,
  getSocialAnalyticsConnectorStatus,
  getSocialOAuthSetupStatus,
  saveSocialOAuthSetup,
  syncSocialAnalytics,
} from "../src/connectors/social-analytics-connector.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const keys = [
  "YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID", "YOUTUBE_CHANNEL_HANDLE",
  "INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_BUSINESS_ACCOUNT_ID",
  "FACEBOOK_PAGE_ACCESS_TOKEN", "FACEBOOK_PAGE_ID", "TIKTOK_ACCESS_TOKEN",
  "X_BEARER_TOKEN", "X_USERNAME", "X_HANDLE", "TWITTER_BEARER_TOKEN", "TWITTER_USERNAME",
  "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORGANIZATION_ID",
  "PINTEREST_ACCESS_TOKEN",
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  "META_APP_ID", "META_APP_SECRET",
  "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET",
  "X_CLIENT_ID", "X_CLIENT_SECRET",
  "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET",
  "PINTEREST_CLIENT_ID", "PINTEREST_CLIENT_SECRET",
  "SOCIAL_OAUTH_REDIRECT_URI",
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalDataDir = process.env.PHANTOMFORCE_SOCIAL_DATA_DIR;
const originalEnvFile = process.env.PHANTOMFORCE_ENV_FILE;
const tempSocialDir = mkdtempSync(join(tmpdir(), "phantom-social-test-"));
const tempEnvDir = mkdtempSync(join(tmpdir(), "phantom-social-env-test-"));

try {
  process.env.PHANTOMFORCE_SOCIAL_DATA_DIR = tempSocialDir;
  process.env.PHANTOMFORCE_ENV_FILE = tempEnvDir;
  keys.forEach((key) => delete process.env[key]);
  const empty = getSocialAnalyticsConnectorStatus();
  assert(empty.live === false, "Unconfigured connector status must not claim live data.");
  assert(empty.connectors.every((item) => !item.configured), "Every unconfigured connector must fail closed.");
  assert(empty.connectors.length === 7, "Every supported social channel must appear in connector status.");
  assert(empty.connectors.every((item) => item.handle === "officialchicagoshots"), "Default handles should be officialchicagoshots.");
  assert(empty.crossPostingRequiresApproval === true, "Cross-posting must remain approval-gated.");
  assert(empty.postingMode === "approval_gated", "Social posting must be explicitly approval-gated.");
  assert(empty.connectors.every((item) => item.analyticsReadOnly === true), "Social analytics sync must stay read-only.");
  assert(empty.connectors.every((item) => item.postingRequiresApproval === true), "Posting-capable connections must still require approval.");
  assert(empty.connectors.find((item) => item.id === "youtube")?.postingScopes.includes("youtube.upload"), "YouTube OAuth must request upload scope for future approval-gated posting.");
  assert(empty.connectors.find((item) => item.id === "instagram")?.postingScopes.includes("instagram_content_publish"), "Instagram OAuth must request publish scope for future approval-gated posting.");
  assert(empty.connectors.find((item) => item.id === "facebook")?.postingScopes.includes("pages_manage_posts"), "Facebook OAuth must request page posting scope for future approval-gated posting.");
  assert(empty.connectors.find((item) => item.id === "tiktok")?.postingScopes.includes("video.publish"), "TikTok OAuth must request publish scope for future approval-gated posting.");

  const setupEmpty = getSocialOAuthSetupStatus();
  assert(setupEmpty.readyCount === 0, "Provider app setup must start unconfigured when no env credentials exist.");
  assert(setupEmpty.providers.length === 6, "Setup status should collapse Meta into one Instagram/Facebook provider app row.");
  assert(setupEmpty.providers.every((provider) => provider.oauthConfigured === false), "Provider setup status must not pretend apps are ready.");
  assert(setupEmpty.providers.every((provider) => /^https:\/\//.test(provider.consoleUrl)), "Every provider setup row should include a safe console URL.");
  assert(setupEmpty.providers.find((provider) => provider.id === "instagram")?.scopes.includes("instagram_content_publish"), "Meta setup row must show posting-capable Instagram scope.");

  const savedSetup = saveSocialOAuthSetup({
    platform: "youtube",
    clientId: "google-client-from-ui",
    clientSecret: "google-secret-from-ui",
    redirectUri: "http://127.0.0.1:5190/phantom-ai/ops/social-oauth/callback",
  });
  assert(savedSetup.readyCount === 1, "Saving a provider app should make it ready for account OAuth.");
  assert(!JSON.stringify(savedSetup).includes("google-secret-from-ui"), "Provider app setup response must not expose saved client secrets.");

  process.env.YOUTUBE_API_KEY = "test-only-key";
  process.env.YOUTUBE_CHANNEL_ID = "channel-1";
  const configured = getSocialAnalyticsConnectorStatus();
  assert(configured.connectors.find((item) => item.id === "youtube")?.live === true, "YouTube should be ready when both server references exist.");
  assert(!JSON.stringify(configured).includes("test-only-key"), "Status must never expose credentials.");

  const mockFetch = async (input: string | URL | Request) => {
    const url = String(input);
    let payload: unknown;
    if (url.includes("/channels?")) {
      payload = { items: [{ statistics: { subscriberCount: "1200", videoCount: "44" }, contentDetails: { relatedPlaylists: { uploads: "uploads-1" } } }] };
    } else if (url.includes("/playlistItems?")) {
      payload = { items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }] };
    } else if (url.includes("/videos?")) {
      payload = { items: [
        { snippet: { publishedAt: "2026-07-10T12:00:00Z" }, statistics: { viewCount: "300", likeCount: "30", commentCount: "4" } },
        { snippet: { publishedAt: "2026-07-11T12:00:00Z" }, statistics: { viewCount: "500", likeCount: "50", commentCount: "6" } },
      ] };
    } else {
      throw new Error(`Unexpected URL ${url}`);
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const snapshot = await syncSocialAnalytics("youtube", mockFetch as typeof fetch);
  assert(snapshot.impressions === 800, "YouTube sync must aggregate real recent video views.");
  assert(snapshot.engagement === 90, "YouTube sync must aggregate likes and comments.");
  assert(snapshot.followers === 1200, "YouTube sync must report current subscribers.");
  assert(snapshot.series.length === 2, "YouTube sync must return a trend series.");

  let rejected = false;
  try { await syncSocialAnalytics("instagram", mockFetch as typeof fetch); } catch { rejected = true; }
  assert(rejected, "Missing platform credentials must reject rather than fabricate analytics.");

  process.env.X_BEARER_TOKEN = "test-x-token";
  process.env.X_USERNAME = "officialchicagoshots";
  const xFetch = async (input: string | URL | Request) => {
    const url = String(input);
    assert(url.includes("/2/users/by/username/officialchicagoshots"), "X sync must use the configured handle.");
    return new Response(JSON.stringify({
      data: {
        username: "officialchicagoshots",
        public_metrics: { followers_count: 3210, tweet_count: 88 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const xSnapshot = await syncSocialAnalytics("x", xFetch as typeof fetch);
  assert(xSnapshot.followers === 3210, "X sync must read official profile metrics.");
  assert(xSnapshot.posts === 88, "X sync must read official post count.");

  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-secret";
  process.env.SOCIAL_OAUTH_REDIRECT_URI = "http://127.0.0.1:5190/phantom-ai/ops/social-oauth/callback";
  const oauth = createSocialOAuthStart("youtube");
  assert(oauth.authorizationUrl.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"), "YouTube OAuth must use Google's official authorization endpoint.");
  assert(oauth.authorizationUrl.includes("client_id=google-client"), "OAuth URL must include the client id.");
  assert(!oauth.authorizationUrl.includes("google-secret"), "OAuth URL must never expose a client secret.");
  assert(oauth.crossPostingRequiresApproval === true, "OAuth-enabled cross-posting must remain approval-gated.");

  const oauthFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "stored-youtube-token", refresh_token: "refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/channels?") && url.includes("mine=true")) {
      return new Response(JSON.stringify({ items: [{ id: "youtube-channel", snippet: { title: "officialchicagoshots", customUrl: "@officialchicagoshots" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected OAuth URL ${url}`);
  };
  const connected = await completeSocialOAuthCallback({ state: oauth.state, code: "code-123" }, oauthFetch as typeof fetch);
  assert(connected.connected?.hasAccessToken === true, "OAuth callback must store an account token without exposing it.");
  assert(!JSON.stringify(connected).includes("stored-youtube-token"), "OAuth callback response must not expose saved tokens.");

  process.env.META_APP_ID = "meta-app";
  process.env.META_APP_SECRET = "meta-secret";
  process.env.SOCIAL_OAUTH_REDIRECT_URI = "http://127.0.0.1:5190/phantom-ai/ops/social-oauth/callback";
  const metaOauth = createSocialOAuthStart("facebook");
  const metaFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/oauth/access_token?")) {
      return new Response(JSON.stringify({ access_token: "meta-user-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/me/accounts?")) {
      return new Response(JSON.stringify({ data: [{
        id: "page-1",
        name: "ChicagoShots",
        access_token: "page-token",
        instagram_business_account: { id: "ig-1", username: "officialchicagoshots" },
      }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected Meta URL ${url}`);
  };
  const metaConnected = await completeSocialOAuthCallback({ state: metaOauth.state, code: "meta-code" }, metaFetch as typeof fetch);
  assert(metaConnected.linkedFacebookPage?.pageId === "page-1", "Meta callback must save the Facebook Page, not a user profile.");
  assert(metaConnected.linkedInstagramBusiness?.businessAccountId === "ig-1", "Meta callback must save the linked Instagram business account.");
  assert(!JSON.stringify(metaConnected).includes("page-token"), "Meta callback response must not expose page tokens.");

  process.env.TIKTOK_CLIENT_KEY = "tiktok-client";
  process.env.TIKTOK_CLIENT_SECRET = "tiktok-secret";
  const tiktokOauth = createSocialOAuthStart("tiktok");
  assert(tiktokOauth.authorizationUrl.startsWith("https://www.tiktok.com/v2/auth/authorize/?"), "TikTok OAuth must use the official authorization endpoint.");
  const tiktokFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
      return new Response(JSON.stringify({ access_token: "stored-tiktok-token", refresh_token: "tt-refresh", expires_in: 3600, open_id: "tt-open-id" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("open.tiktokapis.com/v2/user/info/")) {
      return new Response(JSON.stringify({ data: { user: { open_id: "tt-open-id", display_name: "ChicagoShots", username: "officialchicagoshots" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected TikTok URL ${url}`);
  };
  const tiktokConnected = await completeSocialOAuthCallback({ state: tiktokOauth.state, code: "tt-code" }, tiktokFetch as typeof fetch);
  assert(tiktokConnected.connected?.hasAccessToken === true, "TikTok callback must store the account token.");
  assert(tiktokConnected.connected?.accountHandle === "officialchicagoshots", "TikTok callback must save the account handle.");
  assert(!JSON.stringify(tiktokConnected).includes("stored-tiktok-token"), "TikTok callback response must not expose saved tokens.");

  process.env.X_CLIENT_ID = "x-client";
  process.env.X_CLIENT_SECRET = "x-secret";
  const xOauth2 = createSocialOAuthStart("x");
  assert(xOauth2.authorizationUrl.startsWith("https://x.com/i/oauth2/authorize?"), "X OAuth must use the official OAuth 2 authorization endpoint.");
  assert(!xOauth2.authorizationUrl.includes("configure-server-generated-pkce"), "X OAuth must use a real server-generated PKCE challenge.");
  const xCallbackFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.x.com/2/oauth2/token") {
      const body = String(init?.body || "");
      assert(body.includes("code_verifier="), "X token exchange must include the saved PKCE verifier.");
      return new Response(JSON.stringify({ access_token: "stored-x-token", refresh_token: "x-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.x.com/2/users/me?user.fields=username,name,public_metrics") {
      return new Response(JSON.stringify({ data: { id: "x-user", name: "ChicagoShots", username: "officialchicagoshots" } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected X callback URL ${url}`);
  };
  const xConnected = await completeSocialOAuthCallback({ state: xOauth2.state, code: "x-code" }, xCallbackFetch as typeof fetch);
  assert(xConnected.connected?.accountHandle === "officialchicagoshots", "X callback must save the account handle.");
  assert(!JSON.stringify(xConnected).includes("stored-x-token"), "X callback response must not expose saved tokens.");

  process.env.LINKEDIN_CLIENT_ID = "li-client";
  process.env.LINKEDIN_CLIENT_SECRET = "li-secret";
  const linkedinOauth = createSocialOAuthStart("linkedin");
  assert(linkedinOauth.authorizationUrl.startsWith("https://www.linkedin.com/oauth/v2/authorization?"), "LinkedIn OAuth must use the official authorization endpoint.");
  assert(linkedinOauth.authorizationUrl.includes("openid+profile"), "LinkedIn OAuth must request profile identity so Phantom can label the connection.");
  const linkedinFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://www.linkedin.com/oauth/v2/accessToken") {
      return new Response(JSON.stringify({ access_token: "stored-linkedin-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.linkedin.com/v2/userinfo") {
      return new Response(JSON.stringify({ sub: "li-user", name: "ChicagoShots" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/organizationAcls?")) {
      return new Response(JSON.stringify({ elements: [{ organization: "urn:li:organization:12345" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected LinkedIn URL ${url}`);
  };
  const linkedinConnected = await completeSocialOAuthCallback({ state: linkedinOauth.state, code: "li-code" }, linkedinFetch as typeof fetch);
  assert(linkedinConnected.connected?.accountId === "12345", "LinkedIn callback must save the authorized organization when available.");
  assert(!JSON.stringify(linkedinConnected).includes("stored-linkedin-token"), "LinkedIn callback response must not expose saved tokens.");

  process.env.PINTEREST_CLIENT_ID = "pin-client";
  process.env.PINTEREST_CLIENT_SECRET = "pin-secret";
  const pinOauth = createSocialOAuthStart("pinterest");
  assert(pinOauth.authorizationUrl.startsWith("https://www.pinterest.com/oauth/?"), "Pinterest OAuth must use the official authorization endpoint.");
  const pinFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.pinterest.com/v5/oauth/token") {
      const auth = String((init?.headers as Record<string, string>)?.Authorization || "");
      assert(auth === `Basic ${Buffer.from("pin-client:pin-secret").toString("base64")}`, "Pinterest token exchange must authenticate with HTTP Basic app credentials.");
      const body = String(init?.body || "");
      assert(body.includes("grant_type=authorization_code") && body.includes("code=pin-code"), "Pinterest token exchange must send the authorization code.");
      return new Response(JSON.stringify({ access_token: "stored-pinterest-token", refresh_token: "pin-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.pinterest.com/v5/user_account") {
      return new Response(JSON.stringify({ id: "pin-user-1", username: "officialchicagoshots", business_name: "ChicagoShots" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected Pinterest URL ${url}`);
  };
  const pinConnected = await completeSocialOAuthCallback({ state: pinOauth.state, code: "pin-code" }, pinFetch as typeof fetch);
  assert(pinConnected.connected?.hasAccessToken === true, "Pinterest callback must store the account token.");
  assert(pinConnected.connected?.accountHandle === "officialchicagoshots", "Pinterest callback must save the account handle.");
  assert(!JSON.stringify(pinConnected).includes("stored-pinterest-token"), "Pinterest callback response must not expose saved tokens.");
  const pinStatus = getSocialAnalyticsConnectorStatus().connectors.find((connector) => connector.id === "pinterest");
  assert(pinStatus?.configured === true, "Pinterest must report configured after the OAuth callback stores its token.");
  const isolatedPinStatus = getSocialAnalyticsConnectorStatus("client-other").connectors.find((connector) => connector.id === "pinterest");
  assert(isolatedPinStatus?.configured === false, "Stored social OAuth tokens must be scoped to one workspace, not global.");
  assert(getSocialAnalyticsConnectorStatus("client-other").tokenStore.workspaceKey === "client-other", "Token store status must reveal the active workspace key without exposing tokens.");

  console.log(JSON.stringify({ ok: true, provider: snapshot.provider, views: snapshot.impressions, followers: snapshot.followers, xFollowers: xSnapshot.followers, oauthCallback: true, metaPageLinked: true, pinterestCallback: true, workspaceScoped: true, credentialsExposed: false }));
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  if (originalDataDir === undefined) delete process.env.PHANTOMFORCE_SOCIAL_DATA_DIR;
  else process.env.PHANTOMFORCE_SOCIAL_DATA_DIR = originalDataDir;
  if (originalEnvFile === undefined) delete process.env.PHANTOMFORCE_ENV_FILE;
  else process.env.PHANTOMFORCE_ENV_FILE = originalEnvFile;
  rmSync(tempSocialDir, { recursive: true, force: true });
  rmSync(tempEnvDir, { recursive: true, force: true });
}
