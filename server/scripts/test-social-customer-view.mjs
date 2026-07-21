/*
 * Runnable proof for the P0 social hotfix: the customer-facing social status
 * projection is truthful and leaks no infrastructure or credentials.
 *
 * Run:  tsc the pure module to JS, then: node test-social-customer-view.mjs <compiledDir>
 * (The CI wrapper compiles server/src/connectors/social-customer-view.ts first.)
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const dir = process.argv[2] || "/tmp/sctest";
const mod = await import(pathToFileURL(join(dir, "social-customer-view.js")).href);
const { buildCustomerSocialStatus, deriveConnectionStatus, assertNoForbiddenKeys, FORBIDDEN_CUSTOMER_KEYS } = mod;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } };

// Fixtures modelling the real internal connector rows.
const rows = [
  // provider not globally configured -> customers must see temporarily unavailable
  { id: "tiktok", name: "TikTok", oauthConfigured: false, live: false, handle: "someone", typedHandleReference: "someone", savedConnection: null },
  // globally configured, nothing connected -> Connect account
  { id: "x", name: "X", oauthConfigured: true, live: false, handle: "brand", typedHandleReference: "brand", savedConnection: null },
  // SAVED HANDLE ONLY (no token) -> must NOT be connected/live/ready
  { id: "pinterest", name: "Pinterest", oauthConfigured: true, live: false, handle: "myboards", typedHandleReference: "myboards", savedConnection: null },
  // fully connected with analytics + publish scopes -> CONNECTED + READY
  { id: "youtube", name: "YouTube", oauthConfigured: true, live: true, handle: "chan",
    savedConnection: { connected: true, accountName: "Chan", accountHandle: "@chan", avatarUrl: "https://x/a.png",
      selectedAssetName: "Main Channel", grantedScopes: ["yt-analytics.readonly", "youtube.upload"],
      verifiedIdentity: true, requiresAssetSelection: false, assetSelected: true, analyticsReady: true, publishReady: true } },
  // token expired -> REAUTH_REQUIRED
  { id: "facebook", name: "Facebook", oauthConfigured: true, live: true, handle: "page",
    savedConnection: { connected: true, accountName: "Page", accountHandle: "page", tokenExpired: true,
      grantedScopes: ["pages_read_engagement"], verifiedIdentity: true, requiresAssetSelection: true, assetSelected: true } },
  // multiple assets not yet selected -> ASSET_SELECTION_REQUIRED
  { id: "linkedin", name: "LinkedIn", oauthConfigured: true, live: true, handle: "org",
    savedConnection: { connected: true, accountName: "Org", accountHandle: "org",
      grantedScopes: ["r_organization_social"], verifiedIdentity: true, requiresAssetSelection: true, assetSelected: false } },
  // connected but identity-only scopes -> LIMITED_PERMISSIONS (live but not ready)
  { id: "instagram", name: "Instagram", oauthConfigured: true, live: true, handle: "ig",
    savedConnection: { connected: true, accountName: "IG", accountHandle: "ig",
      grantedScopes: ["instagram_basic"], verifiedIdentity: true, requiresAssetSelection: false, assetSelected: true } },
];

const status = buildCustomerSocialStatus(rows);
const byId = Object.fromEntries(status.providers.map((p) => [p.provider, p]));

t("no forbidden keys anywhere in the customer payload (deep scan)", () => assertNoForbiddenKeys(status));

t("forbidden guard actually catches an injected leak", () => {
  assert.throws(() => assertNoForbiddenKeys({ nested: [{ callbackUrl: "https://x/cb" }] }));
  assert.throws(() => assertNoForbiddenKeys({ client_secret: "abc" }));
  assert.throws(() => assertNoForbiddenKeys({ providers: [{ redirectUri: "x" }] }));
});

t("stringified payload contains none of the forbidden substrings", () => {
  const json = JSON.stringify(status).toLowerCase();
  for (const k of ["callback", "client_secret", "clientsecret", "app_secret", "redirect_uri", "redirecturi", "access_token", "accesstoken", "console.cloud", "developers.facebook", "meta_app", "_env"]) {
    assert.ok(!json.includes(k), `payload leaked "${k}"`);
  }
});

t("provider not globally configured -> Temporarily unavailable / PLATFORM_UNCONFIGURED", () => {
  assert.equal(byId.tiktok.connectionStatus, "PLATFORM_UNCONFIGURED");
  assert.equal(byId.tiktok.action, "Temporarily unavailable");
  assert.equal(byId.tiktok.globallyAvailable, false);
});

t("configured + nothing connected -> Connect account", () => {
  assert.equal(byId.x.connectionStatus, "AVAILABLE_TO_CONNECT");
  assert.equal(byId.x.action, "Connect account");
});

t("SAVED HANDLE never counts as connected/live/ready", () => {
  assert.equal(byId.pinterest.connectionStatus, "AVAILABLE_TO_CONNECT");
  assert.equal(byId.pinterest.action, "Connect account");
  assert.equal(byId.pinterest.savedHandleReference, "myboards"); // preserved as reference
  assert.equal(byId.pinterest.displayName, "");                  // no fabricated identity
  assert.deepEqual(byId.pinterest.grantedCapabilities, []);
});

t("fully connected + scopes -> CONNECTED + capabilities + selected asset", () => {
  assert.equal(byId.youtube.connectionStatus, "CONNECTED");
  assert.equal(byId.youtube.action, "Connected");
  assert.equal(byId.youtube.displayName, "Chan");
  assert.equal(byId.youtube.username, "@chan");
  assert.equal(byId.youtube.selectedAssetName, "Main Channel");
  assert.equal(byId.youtube.capabilityStatus, "FULL");
  assert.ok(byId.youtube.grantedCapabilities.includes("canReadAnalytics"));
  assert.ok(byId.youtube.grantedCapabilities.includes("canPublishText"));
});

t("expired token -> REAUTH_REQUIRED / Permission required", () => {
  assert.equal(byId.facebook.connectionStatus, "REAUTH_REQUIRED");
  assert.equal(byId.facebook.action, "Permission required");
  assert.equal(byId.facebook.reconnectRequired, true);
});

t("multiple assets unselected -> ASSET_SELECTION_REQUIRED", () => {
  assert.equal(byId.linkedin.connectionStatus, "ASSET_SELECTION_REQUIRED");
});

t("connected identity-only -> LIMITED_PERMISSIONS (live but not ready)", () => {
  assert.equal(byId.instagram.connectionStatus, "LIMITED_PERMISSIONS");
  assert.equal(byId.instagram.capabilityStatus, "IDENTITY_ONLY");
});

t("LIVE count = truly-authorized providers only (youtube, facebook*, linkedin*, instagram) not saved handles", () => {
  // LIVE = CONNECTED or LIMITED_PERMISSIONS. facebook is REAUTH_REQUIRED (not live),
  // linkedin is ASSET_SELECTION_REQUIRED (not live). So live = youtube + instagram = 2.
  assert.equal(status.counts.live, 2, JSON.stringify(status.counts));
});

t("READY count = providers with feature-capable scopes only (youtube)", () => {
  assert.equal(status.counts.ready, 1, JSON.stringify(status.counts));
});

t("saving a handle does not move LIVE/READY (pinterest handle-only excluded)", () => {
  const withoutHandle = buildCustomerSocialStatus(rows.map((r) => r.id === "pinterest" ? { ...r, typedHandleReference: "" } : r));
  assert.equal(withoutHandle.counts.live, status.counts.live);
  assert.equal(withoutHandle.counts.ready, status.counts.ready);
});

t("customerMessage is plain language, never a raw provider payload", () => {
  for (const p of status.providers) {
    assert.ok(p.customerMessage.length > 0);
    assert.ok(!/error|exception|http|401|403|invalid_grant|token/i.test(p.customerMessage), `technical leak in message: ${p.customerMessage}`);
  }
});

t("feature flag name is exposed for reversible rollout", () => assert.equal(status.featureFlag, "SOCIAL_CONNECT_V2"));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
