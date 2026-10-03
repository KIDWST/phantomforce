import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccessSession } from "../src/access/session.js";

const root = mkdtempSync(join(tmpdir(), "pf-social-lifecycle-"));
const tenant = "client-chicagoshots";
const otherTenant = "occasionally-odd";
Object.assign(process.env, {
  NODE_ENV: "development", PHANTOMFORCE_SERVER_LISTEN: "false", PHANTOMFORCE_SERVER_LOGGER: "false",
  PHANTOMFORCE_AUTH_PROVIDER: "demo", PHANTOMFORCE_ENABLE_DEMO_AUTH: "true", PHANTOMFORCE_SKIP_SERVER_DOTENV: "true",
  PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER: "false", PHANTOMFORCE_SESSION_SECRET: "synthetic-social-fixture-session-key-only-20261003",
  PHANTOMFORCE_ACCESS_REPOSITORY: "json-file", DATABASE_URL: "", PHANTOM_FREE_WRITE: "false",
  PHANTOMFORCE_DATA_DIR: join(root, "data"), PHANTOMFORCE_SOCIAL_DATA_DIR: join(root, "social"),
  PHANTOMFORCE_BUSINESS_RECORDS_DIR: join(root, "records"), PHANTOMFORCE_AI_CREDENTIALS_DIR: join(root, "credentials"),
  GOOGLE_OAUTH_CLIENT_ID: "fixture-google-id", GOOGLE_OAUTH_CLIENT_SECRET: "fixture-google-secret",
  META_APP_ID: "fixture-meta-id", META_APP_SECRET: "fixture-meta-secret",
  LINKEDIN_CLIENT_ID: "fixture-linkedin-id", LINKEDIN_CLIENT_SECRET: "fixture-linkedin-secret",
  TIKTOK_CLIENT_KEY: "fixture-tiktok-id", TIKTOK_CLIENT_SECRET: "fixture-tiktok-secret",
  X_CLIENT_ID: "fixture-x-id", X_CLIENT_SECRET: "fixture-x-secret",
  SOCIAL_OAUTH_REDIRECT_URI: "https://admin.phantomforce.online/phantom-ai/ops/social-oauth/callback",
});
for (const key of ["SOCIAL_CONNECT_V2", "SOCIAL_CONNECT_V2_DISABLED", "YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_OAUTH_REDIRECT_URI", "FACEBOOK_OAUTH_REDIRECT_URI", "INSTAGRAM_OAUTH_REDIRECT_URI"]) delete process.env[key];
const social = await import("../src/connectors/social-analytics-connector.js");
const store = await import("../src/connectors/social-connection-store.js");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const forbiddenFetch = async () => { throw new Error("Unmocked external network is forbidden."); };
let calls = 0;
let providerFixture: typeof fetch = forbiddenFetch as typeof fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => { calls += 1; return providerFixture(...args); }) as typeof fetch;
const customer = (platform: string, scope = tenant) => social.getCustomerSocialConnectionStatus(scope).providers.find((item) => item.provider === platform)!;
const page = (id: string, instagram = true) => ({ id, name: `Fixture Page ${id}`, access_token: `fixture-page-token-${id}`, ...(instagram ? { instagram_business_account: { id: `ig-${id}`, username: `fixture${id}` } } : {}) });
const metaFixture = (pages: unknown[], options: { secondPage?: unknown[]; grants?: string[] } = {}): typeof fetch => (async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/oauth/access_token")) return json({ access_token: "fixture-meta-user-token", expires_in: 3600 });
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-meta-user-token");
  if (url.pathname.endsWith("/me/permissions")) return json({ data: [...(options.grants || ["pages_read_engagement", "read_insights", "instagram_basic", "instagram_manage_insights"]).map(permission => ({ permission, status: "granted" })), { permission: "pages_manage_posts", status: "declined" }] });
  if (url.pathname.endsWith("/me/accounts")) return json({ data: url.searchParams.has("after") ? options.secondPage : pages,
    ...(!url.searchParams.has("after") && options.secondPage ? { paging: { next: "https://untrusted.example/never-follow-this-url", cursors: { after: "next-fixture-page" } } } : {}) });
  throw new Error("Unexpected fixture request.");
}) as typeof fetch;
async function metaStart(platform: "facebook" | "instagram", pages: unknown[], scope = tenant, options = {}) {
  const start = social.createSocialOAuthStart(platform, scope);
  return social.completeSocialOAuthCallback({ state: start.state, code: "fixture-code" }, metaFixture(pages, options));
}

// Preserve the redirect actually authorized; record only provider-granted scopes.
const google = social.createSocialOAuthStart("youtube", tenant);
process.env.SOCIAL_OAUTH_REDIRECT_URI = "https://admin.phantomforce.online/new-callback";
const googleFixture: typeof fetch = (async (input, init) => {
  if (String(input).includes("oauth2.googleapis.com/token")) {
    assert.equal(new URLSearchParams(String(init?.body)).get("redirect_uri"), google.redirectUri);
    return json({ access_token: "fixture-google-token", expires_in: 3600, scope: "https://www.googleapis.com/auth/youtube.readonly" });
  }
  return json({ items: [{ id: "fixture-youtube-channel", snippet: { title: "Fixture YouTube" } }] });
}) as typeof fetch;
const googleResult = await social.completeSocialOAuthCallback({ state: google.state, code: "fixture-code" }, googleFixture);
assert.equal(googleResult.tenant_id, tenant);
assert.deepEqual(googleResult.connected?.scopes, ["https://www.googleapis.com/auth/youtube.readonly"]);
assert.equal(customer("youtube").capabilityStatus, "ANALYTICS_READY");
assert.equal(customer("youtube").grantedCapabilities.includes("canPublishImage"), false);
assert.equal(customer("youtube").authorizationPending, false);
await assert.rejects(social.completeSocialOAuthCallback({ state: google.state, code: "replay" }, forbiddenFetch as typeof fetch));
assert.equal(customer("youtube", otherTenant).connectionStatus, "AVAILABLE_TO_CONNECT");

// Reconnect remains pending while the token exchange is in flight, and Disconnect wins.
const reconnect = social.createSocialOAuthStart("youtube", tenant);
assert.equal(customer("youtube").authorizationPending, true);
const baselineRevision = customer("youtube").connectionUpdatedAt;
let releaseExchange!: () => void;
const held = new Promise<void>(resolve => { releaseExchange = resolve; });
const reconnectWork = social.completeSocialOAuthCallback({ state: reconnect.state, code: "fixture-reconnect" }, (async (input, init) => {
  if (String(input).includes("oauth2.googleapis.com/token")) await held;
  return googleFixture(input, init);
}) as typeof fetch);
assert.equal(customer("youtube").authorizationPending, true, "Consuming state must not end in-flight reconnect status.");
assert.equal(customer("youtube").connectionUpdatedAt, baselineRevision);
social.disconnectSocialOAuth("youtube", tenant);
releaseExchange();
await assert.rejects(reconnectWork);
assert.equal(store.getStoredSocialConnection("youtube", tenant), null, "An in-flight callback cannot resurrect a disconnected account.");

// Meta enumerates subsequent result pages without following untrusted URLs and never picks first.
const staged = await metaStart("facebook", [page("one")], tenant, { secondPage: [page("two")] });
assert.equal(staged.type, "asset_selection_required");
assert.equal(staged.connected, null);
const selection = store.listPendingSocialAssetSelections(tenant)[0];
assert.equal(selection.pages.length, 2);
assert.equal(store.listPendingSocialAssetSelections(otherTenant).length, 0);
assert.equal(customer("facebook").connectionStatus, "ASSET_SELECTION_REQUIRED");
assert.equal(customer("facebook").authorizationPending, true);
assert.equal(store.getStoredSocialConnection("facebook", tenant), null);
assert.equal(JSON.stringify(social.getCustomerSocialConnectionStatus(tenant)).includes("fixture-page-token"), false);
assert.throws(() => social.selectSocialOAuthAsset("facebook", selection.selectionId, "two", otherTenant));
assert.throws(() => social.selectSocialOAuthAsset("facebook", selection.selectionId, "unknown", tenant));
assert.equal(store.listPendingSocialAssetSelections(tenant).length, 1, "Rejected scope/choice must not consume the valid selection.");
const selected = social.selectSocialOAuthAsset("facebook", selection.selectionId, "two", tenant);
assert.equal(selected.connected?.pageId, "two");
assert.equal(selected.connected?.scopes.includes("pages_manage_posts"), false, "Declined permissions stay ungranted.");
assert.equal(customer("facebook").capabilityStatus, "ANALYTICS_READY");
assert.equal(customer("facebook").authorizationPending, false);
assert.throws(() => social.selectSocialOAuthAsset("facebook", selection.selectionId, "two", tenant), "Selections are single use.");
assert.equal(store.getStoredSocialConnection("instagram", tenant), null, "Choosing Facebook cannot change Instagram.");

// Instagram cannot report a Facebook-only Page as an Instagram account.
await assert.rejects(metaStart("instagram", [page("facebook-only", false)]));
assert.equal(store.getStoredSocialConnection("instagram", tenant), null);
const instagram = await metaStart("instagram", [page("unlinked", false), page("eligible")]);
assert.equal(instagram.type, "connected");
assert.equal(instagram.connected?.businessAccountId, "ig-eligible");
assert.equal(store.getStoredSocialConnection("facebook", tenant)?.pageId, "two");

// Later Connect and Disconnect invalidate earlier selections; expired candidates cannot be applied.
await metaStart("facebook", [page("three"), page("four")]);
const superseded = store.listPendingSocialAssetSelections(tenant)[0];
social.createSocialOAuthStart("facebook", tenant);
assert.throws(() => social.selectSocialOAuthAsset("facebook", superseded.selectionId, "three", tenant));
await metaStart("facebook", [page("five"), page("six")]);
const expiring = store.listPendingSocialAssetSelections(tenant)[0];
const originalNow = Date.now;
Date.now = () => originalNow() + 20 * 60_000 + 1;
try {
  assert.equal(store.listPendingSocialAssetSelections(tenant).length, 0);
  assert.throws(() => social.selectSocialOAuthAsset("facebook", expiring.selectionId, "five", tenant));
} finally { Date.now = originalNow; }
await metaStart("facebook", [page("seven"), page("eight")]);
social.disconnectSocialOAuth("facebook", tenant);
assert.equal(store.listPendingSocialAssetSelections(tenant).length, 0);
assert.equal(customer("instagram").connectionStatus, "CONNECTED", "Disconnect changes only the named provider.");

// Missing scopes never inherit requested permissions; unverified identities fail before persistence.
const scopeMissing = social.createSocialOAuthStart("youtube", tenant);
await social.completeSocialOAuthCallback({ state: scopeMissing.state, code: "fixture" }, (async input => String(input).includes("oauth2.googleapis.com/token") ? json({ access_token: "fixture-no-scopes", expires_in: 3600 }) : json({ items: [{ id: "verified-id" }] })) as typeof fetch);
assert.equal(customer("youtube").capabilityStatus, "IDENTITY_ONLY");
for (const platform of ["youtube", "tiktok", "x"] as const) {
  const previous = store.getStoredSocialConnection(platform, tenant)?.updatedAt;
  const start = social.createSocialOAuthStart(platform, tenant);
  await assert.rejects(social.completeSocialOAuthCallback({ state: start.state, code: "fixture" }, (async input => /token/.test(String(input)) ? json({ access_token: "fixture-no-identity", expires_in: 3600 }) : json({ items: [], data: { user: {} } })) as typeof fetch));
  assert.equal(store.getStoredSocialConnection(platform, tenant)?.updatedAt, previous);
}
for (const granted of ["user.info.basic", "user.info.basic,user.info.profile", "user.info.basic,user.info.stats,video.list"]) {
  const start = social.createSocialOAuthStart("tiktok", tenant);
  await social.completeSocialOAuthCallback({ state: start.state, code: "fixture" }, (async input => {
    const url = new URL(String(input));
    if (url.pathname.includes("/oauth/token")) return json({ access_token: "fixture-tiktok", scope: granted });
    assert.equal(url.searchParams.get("fields")?.includes("username"), granted.includes("user.info.profile"), "TikTok identity requests only fields covered by granted scopes.");
    return json({ data: { user: { open_id: "fixture-tiktok-id", display_name: "Fixture business" } } });
  }) as typeof fetch);
  assert.equal(customer("tiktok").capabilityStatus, granted.includes("user.info.stats") ? "ANALYTICS_READY" : "IDENTITY_ONLY");
}
const linkedin = social.createSocialOAuthStart("linkedin", tenant);
await assert.rejects(social.completeSocialOAuthCallback({ state: linkedin.state, code: "fixture" }, (async (input, init) => {
  if (String(input).includes("accessToken")) return json({ access_token: "fixture-linkedin" });
  assert.equal(new Headers(init?.headers).get("LinkedIn-Version"), "202609", "LinkedIn uses a supported API version.");
  return String(input).includes("organizationAcls") ? json({ elements: [{ organization: "urn:li:organization:1" }, { organization: "urn:li:organization:2" }] }) : json({ sub: "fixture-person" });
}) as typeof fetch));
assert.equal(store.getStoredSocialConnection("linkedin", tenant), null);

// Actual signed-session routes: tenant/role isolation, callback HTML and error redaction.
const { app } = await import("../src/index.js");
const { listAccessSessions, setAccessSessions } = await import("../src/access/session.js");
const priorSessions = listAccessSessions({ includeHidden: true });
const member = (id: string, role: "admin" | "member"): AccessSession => ({ id, label: id, role: "client", canManageAccess: false, userId: id, orgId: tenant, clientId: tenant, orgRole: role, subscriptionActive: true, memberships: [{ orgId: tenant, orgName: "Fixture studio", role }] });
setAccessSessions([...priorSessions, member("social-fixture-admin", "admin"), member("social-fixture-viewer", "member")]);
let requests = 0;
const inject = async (options: Parameters<typeof app.inject>[0]) => { requests += 1; return app.inject(options); };
const prefix = "/phantom-ai/ops/social-oauth";
const headers = (token: string, scope = tenant) => ({ authorization: `Bearer ${token}`, "x-phantomforce-business": scope });
const login = async (sessionId: string) => { const reply = await inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } }); assert.equal(reply.statusCode, 200, reply.body); return reply.json().token as string; };
try {
  const owner = await login("admin-jordan");
  const admin = await login("social-fixture-admin");
  const viewer = await login("social-fixture-viewer");
  for (const route of ["start", "select-asset", "disconnect"]) {
    const payload = { platform: "facebook", selectionId: "fixture", pageId: "one" };
    const denied = await inject({ method: "POST", url: `${prefix}/${route}`, payload });
    assert.equal(denied.statusCode, 401);
    const readonly = await inject({ method: "POST", url: `${prefix}/${route}`, payload, headers: headers(viewer) });
    assert.equal(readonly.statusCode, 403, readonly.body);
  }
  const startReply = await inject({ method: "POST", url: `${prefix}/start`, headers: headers(admin), payload: { platform: "facebook" } });
  assert.equal(startReply.statusCode, 200, startReply.body);
  providerFixture = metaFixture([page("route-a"), page("route-b")]);
  const callback = await inject({ method: "GET", url: `${prefix}/callback?state=${encodeURIComponent(startReply.json().oauth.state)}&code=fixture` });
  assert.equal(callback.statusCode, 200, callback.body);
  assert.match(callback.body, /asset_selection_required/);
  assert.match(callback.body, /tenant_id: "client-chicagoshots"/);
  assert.equal(callback.body.includes("fixture-page-token"), false);
  let routeSelection = "";
  for (const token of [owner, admin]) {
    const status = await inject({ method: "GET", url: "/phantom-ai/ops/social-analytics/status", headers: headers(token) });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().can_manage_accounts, true);
    routeSelection = status.json().asset_selections[0].selectionId;
    assert.equal(status.json().asset_selections[0].pages.length, 2);
    assert.equal(status.body.includes("fixture-page-token"), false);
    const provider = status.json().social_connections.providers.find((p: any) => p.provider === "facebook");
    assert.equal(provider.authorizationPending, true);
    assert.equal(typeof provider.connectionUpdatedAt, "string");
  }
  const readerStatus = await inject({ method: "GET", url: "/phantom-ai/ops/social-analytics/status", headers: headers(viewer) });
  assert.equal(readerStatus.statusCode, 200);
  assert.equal(readerStatus.json().can_manage_accounts, false);
  assert.deepEqual(readerStatus.json().asset_selections, []);
  assert.deepEqual(readerStatus.json().social_connections.asset_selections, []);
  assert.equal(readerStatus.body.includes("route-a"), false, "Read-only business members cannot inspect the owner's other Page candidates.");
  const wrongScope = await inject({ method: "POST", url: `${prefix}/select-asset`, headers: headers(owner, otherTenant), payload: { platform: "facebook", selectionId: routeSelection, pageId: "route-b" } });
  assert.equal(wrongScope.statusCode, 409);
  const mismatch = await inject({ method: "POST", url: `${prefix}/disconnect`, headers: headers(admin), payload: { platform: "instagram", tenant_id: otherTenant } });
  assert.equal(mismatch.statusCode, 403);
  const selectionReply = await inject({ method: "POST", url: `${prefix}/select-asset`, headers: headers(admin), payload: { platform: "facebook", selectionId: routeSelection, pageId: "route-b" } });
  assert.equal(selectionReply.statusCode, 200, selectionReply.body);
  assert.equal(selectionReply.json().tenant_id, tenant);
  assert.equal(store.getStoredSocialConnection("facebook", tenant)?.pageId, "route-b");
  const replay = await inject({ method: "POST", url: `${prefix}/select-asset`, headers: headers(admin), payload: { platform: "facebook", selectionId: routeSelection, pageId: "route-a" } });
  assert.equal(replay.statusCode, 409);
  const disconnect = await inject({ method: "POST", url: `${prefix}/disconnect`, headers: headers(admin), payload: { platform: "facebook" } });
  assert.equal(disconnect.statusCode, 200, disconnect.body);
  assert.equal(store.getStoredSocialConnection("facebook", tenant), null);
  const errorStart = social.createSocialOAuthStart("youtube", tenant);
  providerFixture = (async () => json({ error_description: "fixture-secret-token-leak <script>unsafe</script>" }, 400)) as typeof fetch;
  const errorReply = await inject({ method: "GET", url: `${prefix}/callback?state=${encodeURIComponent(errorStart.state)}&code=fixture` });
  assert.equal(errorReply.statusCode, 400);
  assert.equal(errorReply.body.includes("fixture-secret-token-leak"), false);
  assert.equal(errorReply.body.includes("<script>unsafe"), false);
  assert.equal(customer("youtube").authorizationPending, false);
  console.log(JSON.stringify({ ok: true, suite: "social-oauth-lifecycle", requests, fixtureProviderRequests: calls,
    explicitMetaSelection: true, tenantAndRoleIsolation: true, grantedScopesOnly: true, callbackReplayDenied: true,
    staleSelectionDenied: true, expiresIn20Minutes: true, disconnectWinsInFlight: true, redirectCaptured: true, callbackSecretsRedacted: true }));
} finally { setAccessSessions(priorSessions); await app.close(); }
