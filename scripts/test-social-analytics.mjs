import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAnalyticsReport } from "../app/js/social-analytics.js";

const csv = `Date,Reach,Impressions,Likes,Comments,Shares,Saves,Followers
2026-07-10,"1,200","2,400",100,12,8,20,5400
2026-07-11,800,1600,80,10,6,14,5425`;
const csvResult = parseAnalyticsReport(csv, { source: "Instagram analytics export", syncedAt: "2026-07-12T12:00:00.000Z" });
assert.equal(csvResult.reach, 2000);
assert.equal(csvResult.impressions, 4000);
assert.equal(csvResult.engagement, 250);
assert.equal(csvResult.followers, 5425);
assert.equal(csvResult.importedRows, 2);
assert.equal(csvResult.series.length, 2);
assert.equal(csvResult.series[0].reach, 1200);

const jsonResult = parseAnalyticsReport(JSON.stringify({ data: [
  { metrics: { views: "2.5k", likes: 200, comments: 20, shares: 15, subscribers: 900 } },
] }));
assert.equal(jsonResult.impressions, 2500);
assert.equal(jsonResult.engagement, 235);
assert.equal(jsonResult.followers, 900);

assert.throws(() => parseAnalyticsReport("Name,Title\nA,B"), /No recognized metrics/);
const contentHubSource = readFileSync(new URL("../app/js/contenthub.js", import.meta.url), "utf8");
const mediaLabSource = readFileSync(new URL("../app/js/medialab.js", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
const phantomCss = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
assert.match(contentHubSource, /social-analytics\.js/);
assert.match(contentHubSource, /parseAnalyticsReport/);
assert.match(contentHubSource, /Social media analytics/, "Analytics must be framed as social media analytics, not workspace analytics.");
assert.match(contentHubSource, /Connect your social accounts to start the live feed/, "Empty state must tell the user to connect social accounts for a live feed.");
assert.match(contentHubSource, /Local uploads are not counted here/, "Local media must not be treated as social analytics.");
assert.match(contentHubSource, /Sync live feed/);
assert.match(contentHubSource, /OAuth apps ready/);
assert.doesNotMatch(contentHubSource, /Import platform report/);
assert.doesNotMatch(contentHubSource, /Manual fallback · CSV · TSV · JSON/);
assert.match(contentHubSource, /an-channel-line/);
assert.match(contentHubSource, /an-coverage-ring/);
assert.match(contentHubSource, /officialchicagoshots/, "Social handles should default to Jordan's ChicagoShots handle.");
assert.match(contentHubSource, /LIVE_ANALYTICS_PLATFORMS = new Set\(PLATFORMS\.map/, "Analytics should show every social channel, not only the original four.");
assert.match(contentHubSource, /data-an-oauth/, "Analytics rows should start official account authorization when OAuth is ready.");
assert.match(contentHubSource, /phantomforce\.social-oauth\.v1/, "Analytics must listen for OAuth callback completion.");
assert.match(contentHubSource, /pf\.social\.oauth\.last/, "Analytics must support the isolated popup storage completion path.");
assert.doesNotMatch(contentHubSource, /Workspace analytics are live\. Platform APIs are optional/, "Analytics must not present local workspace activity as social analytics.");
assert.doesNotMatch(contentHubSource, /Optional live social APIs/, "Social APIs must be the core analytics source, not optional enrichment.");
assert.doesNotMatch(contentHubSource, /<h3>PhantomForce workspace<\/h3>/, "Analytics must not show a local workspace analytics card.");
assert.match(contentHubSource, /analyticsConnectorState\.error = force \? message : ""/, "Silent social API checks must not interrupt the social analytics page.");
assert.doesNotMatch(contentHubSource, /OAuth is required before real stats appear/, "Analytics should not make the page look empty before OAuth is configured.");
assert.match(mediaLabSource, /Editable handle or profile URL/, "Media settings must let Jordan change handles per channel.");
assert.match(mediaLabSource, /cross-posting remain locked until OAuth\/API authorization/, "Profile handles must not imply cross-posting is authorized.");
assert.match(mediaLabSource, /refreshSocialOAuthStatus/, "Media settings must preload backend OAuth readiness instead of discovering it only after clicks.");
assert.match(mediaLabSource, /OAuth app ready for authorization/, "Media settings should show when a provider app is ready for real OAuth.");
assert.match(mediaLabSource, /OAuth setup needed/, "Media settings should clearly show missing provider app setup.");
assert.match(mediaLabSource, /data-oauth-setup-form/, "Media settings must include the owner-only OAuth app setup form.");
assert.match(mediaLabSource, /\/phantom-ai\/ops\/social-oauth\/setup/, "Media settings must save provider OAuth app credentials server-side.");
assert.match(mediaLabSource, /Callback URL for provider consoles/, "Media settings must show the exact callback URL to paste into provider consoles.");
assert.match(mediaLabSource, /requestSocialOAuthStart/, "Social connection buttons must use the backend OAuth-start route.");
assert.match(mediaLabSource, /\/phantom-ai\/ops\/social-oauth\/start/, "OAuth login should not be a hard-coded provider guess in the browser.");
assert.match(mediaLabSource, /phantomforce\.social-oauth\.v1/, "Media settings must refresh when OAuth callback completes.");
assert.match(mediaLabSource, /pf\.social\.oauth\.last/, "Media settings must support the isolated popup storage completion path.");
assert.doesNotMatch(mediaLabSource, /Opened normal login only/, "Failed OAuth start must not fall back to a normal browser login.");
assert.match(serverSource, /social-oauth\/setup/, "Server must expose an owner-gated OAuth app setup route.");
assert.match(serverSource, /saveSocialOAuthSetup/, "Server must write OAuth app setup through the connector boundary.");
assert.match(serverSource, /window\.opener.*postMessage/, "OAuth callback should notify the opener when available.");
assert.match(serverSource, /pf\.social\.oauth\.last/, "OAuth callback should write a same-origin completion marker for noopener popups.");
assert.match(phantomCss, /Mobile navigation is owned by the "Mobile shell cleanup" block below/, "Old horizontal mobile sidebar rules must stay disabled.");
console.log("Social analytics live OAuth checks passed.");
