import {
  completeSocialOAuthCallback,
  createSocialOAuthStart,
  getSocialAnalyticsConnectorStatus,
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
const tempSocialDir = mkdtempSync(join(tmpdir(), "phantom-social-test-"));

try {
  process.env.PHANTOMFORCE_SOCIAL_DATA_DIR = tempSocialDir;
  keys.forEach((key) => delete process.env[key]);
  const empty = getSocialAnalyticsConnectorStatus();
  assert(empty.live === false, "Unconfigured connector status must not claim live data.");
  assert(empty.connectors.every((item) => !item.configured), "Every unconfigured connector must fail closed.");
  assert(empty.connectors.length === 7, "Every supported social channel must appear in connector status.");
  assert(empty.connectors.every((item) => item.handle === "officialchicagoshots"), "Default handles should be officialchicagoshots.");
  assert(empty.crossPostingRequiresApproval === true, "Cross-posting must remain approval-gated.");

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

  process.env.TIKTOK_CLIENT_KEY = "tiktok-key";
  process.env.TIKTOK_CLIENT_SECRET = "tiktok-secret";
  const badTikTokOauth = createSocialOAuthStart("tiktok");
  const badTikTokFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
      return new Response(JSON.stringify({ access_token: "bad-tiktok-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { message: "profile unavailable" } }), { status: 500, headers: { "Content-Type": "application/json" } });
  };
  let badTikTokRejected = false;
  try { await completeSocialOAuthCallback({ state: badTikTokOauth.state, code: "tt-bad" }, badTikTokFetch as typeof fetch); } catch { badTikTokRejected = true; }
  assert(badTikTokRejected, "TikTok OAuth must reject if the connected account identity cannot be confirmed.");
  const tiktokOauth = createSocialOAuthStart("tiktok");
  const tiktokFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
      return new Response(JSON.stringify({ access_token: "tiktok-token", refresh_token: "tiktok-refresh", expires_in: 3600, open_id: "tt-open" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/v2/user/info/")) {
      return new Response(JSON.stringify({ data: { user: { open_id: "tt-open", display_name: "ChicagoShots", username: "officialchicagoshots" } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected TikTok URL ${url}`);
  };
  const tiktokConnected = await completeSocialOAuthCallback({ state: tiktokOauth.state, code: "tt-code" }, tiktokFetch as typeof fetch);
  assert(tiktokConnected.connected?.hasAccessToken === true, "TikTok OAuth callback must store a token.");
  assert(tiktokConnected.connected?.accountHandle === "officialchicagoshots", "TikTok OAuth callback must store the connected handle.");
  assert(!JSON.stringify(tiktokConnected).includes("tiktok-token"), "TikTok callback response must not expose tokens.");

  process.env.X_CLIENT_ID = "x-client";
  process.env.X_CLIENT_SECRET = "x-secret";
  const badXOauth = createSocialOAuthStart("x");
  const badXOauthFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.x.com/2/oauth2/token") {
      return new Response(JSON.stringify({ access_token: "bad-x-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/2/users/me")) {
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected bad X OAuth URL ${url}`);
  };
  let badXRejected = false;
  try { await completeSocialOAuthCallback({ state: badXOauth.state, code: "x-bad" }, badXOauthFetch as typeof fetch); } catch { badXRejected = true; }
  assert(badXRejected, "X OAuth must reject if the connected account identity cannot be confirmed.");
  const xOauth = createSocialOAuthStart("x");
  assert(xOauth.authorizationUrl.includes("code_challenge="), "X OAuth must include a generated PKCE challenge.");
  assert(!xOauth.authorizationUrl.includes("configure-server-generated-pkce"), "X OAuth must not use the old PKCE placeholder.");
  const xOauthFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.x.com/2/oauth2/token") {
      assert(String(init?.body || "").includes("code_verifier="), "X token exchange must include the saved PKCE verifier.");
      return new Response(JSON.stringify({ access_token: "x-oauth-token", refresh_token: "x-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/2/users/me")) {
      return new Response(JSON.stringify({ data: { id: "x-user", name: "ChicagoShots", username: "officialchicagoshots", public_metrics: { followers_count: 3210 } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected X OAuth URL ${url}`);
  };
  const xConnected = await completeSocialOAuthCallback({ state: xOauth.state, code: "x-code" }, xOauthFetch as typeof fetch);
  assert(xConnected.connected?.accountHandle === "officialchicagoshots", "X OAuth callback must save the connected username.");
  assert(!JSON.stringify(xConnected).includes("x-oauth-token"), "X callback response must not expose tokens.");

  process.env.LINKEDIN_CLIENT_ID = "linkedin-client";
  process.env.LINKEDIN_CLIENT_SECRET = "linkedin-secret";
  const linkedinOauth = createSocialOAuthStart("linkedin");
  assert(!linkedinOauth.authorizationUrl.includes("code_challenge="), "LinkedIn OAuth must not send PKCE unless a verifier is stored for token exchange.");
  const linkedinFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://www.linkedin.com/oauth/v2/accessToken") {
      return new Response(JSON.stringify({ access_token: "linkedin-token", refresh_token: "linkedin-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/v2/organizationAcls")) {
      return new Response(JSON.stringify({ elements: [{ "organization~": { id: "12345", localizedName: "ChicagoShots", vanityName: "officialchicagoshots" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected LinkedIn URL ${url}`);
  };
  const linkedinConnected = await completeSocialOAuthCallback({ state: linkedinOauth.state, code: "li-code" }, linkedinFetch as typeof fetch);
  assert(linkedinConnected.connected?.accountId === "12345", "LinkedIn OAuth callback must store an organization id.");
  assert(!JSON.stringify(linkedinConnected).includes("linkedin-token"), "LinkedIn callback response must not expose tokens.");

  process.env.PINTEREST_CLIENT_ID = "pinterest-client";
  process.env.PINTEREST_CLIENT_SECRET = "pinterest-secret";
  const badPinterestOauth = createSocialOAuthStart("pinterest");
  assert(badPinterestOauth.authorizationUrl.includes("code_challenge="), "Pinterest OAuth must include a generated PKCE challenge.");
  let badPinterestRejected = false;
  const badPinterestFetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.pinterest.com/v5/oauth/token") {
      return new Response(JSON.stringify({ access_token: "bad-pinterest-token", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: { message: "profile unavailable" } }), { status: 500, headers: { "Content-Type": "application/json" } });
  };
  try { await completeSocialOAuthCallback({ state: badPinterestOauth.state, code: "pin-bad" }, badPinterestFetch as typeof fetch); } catch { badPinterestRejected = true; }
  assert(badPinterestRejected, "Pinterest OAuth must reject if the connected account identity cannot be confirmed.");
  const pinterestOauth = createSocialOAuthStart("pinterest");
  assert(pinterestOauth.authorizationUrl.includes("code_challenge="), "Pinterest OAuth must include PKCE on every start.");
  const pinterestFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.pinterest.com/v5/oauth/token") {
      assert(String(init?.body || "").includes("code_verifier="), "Pinterest token exchange must include the saved PKCE verifier.");
      return new Response(JSON.stringify({ access_token: "pinterest-token", refresh_token: "pinterest-refresh", expires_in: 3600 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://api.pinterest.com/v5/user_account") {
      return new Response(JSON.stringify({ username: "officialchicagoshots", account_id: "pin-account", business_name: "ChicagoShots" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected Pinterest URL ${url}`);
  };
  const pinterestConnected = await completeSocialOAuthCallback({ state: pinterestOauth.state, code: "pin-code" }, pinterestFetch as typeof fetch);
  assert(pinterestConnected.connected?.accountHandle === "officialchicagoshots", "Pinterest OAuth callback must store the connected username.");
  assert(!JSON.stringify(pinterestConnected).includes("pinterest-token"), "Pinterest callback response must not expose tokens.");

  const finalStatus = getSocialAnalyticsConnectorStatus();
  assert(finalStatus.connectors.every((connector) => connector.configured), "All seven channels should be configured after OAuth/storage proofs.");

  console.log(JSON.stringify({ ok: true, provider: snapshot.provider, views: snapshot.impressions, followers: snapshot.followers, xFollowers: xSnapshot.followers, oauthCallback: true, metaPageLinked: true, allOAuthCallbacksStored: true, credentialsExposed: false }));
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  if (originalDataDir === undefined) delete process.env.PHANTOMFORCE_SOCIAL_DATA_DIR;
  else process.env.PHANTOMFORCE_SOCIAL_DATA_DIR = originalDataDir;
  rmSync(tempSocialDir, { recursive: true, force: true });
}
