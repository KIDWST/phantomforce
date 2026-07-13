import {
  createSocialOAuthStart,
  getSocialAnalyticsConnectorStatus,
  syncSocialAnalytics,
} from "../src/connectors/social-analytics-connector.js";

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

try {
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

  console.log(JSON.stringify({ ok: true, provider: snapshot.provider, views: snapshot.impressions, followers: snapshot.followers, xFollowers: xSnapshot.followers, credentialsExposed: false }));
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}
