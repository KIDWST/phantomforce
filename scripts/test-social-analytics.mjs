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
assert.match(contentHubSource, /social-analytics\.js/);
assert.match(contentHubSource, /parseAnalyticsReport/);
assert.match(contentHubSource, /Social media analytics/, "Analytics must be framed as social media analytics, not workspace analytics.");
assert.match(contentHubSource, /Connect your social accounts to start analytics/, "Empty state must tell the user to connect social accounts.");
assert.match(contentHubSource, /Local uploads are not counted here/, "Local media must not be treated as social analytics.");
assert.match(contentHubSource, /Import platform report/);
assert.match(contentHubSource, /Manual fallback · CSV · TSV · JSON/);
assert.match(contentHubSource, /an-channel-line/);
assert.match(contentHubSource, /an-coverage-ring/);
assert.match(contentHubSource, /officialchicagoshots/, "Social handles should default to Jordan's ChicagoShots handle.");
assert.match(contentHubSource, /function normalizeSocialAccount\(base, saved = \{\}\)/, "Saved social profile rows must be normalized before analytics uses them.");
assert.match(contentHubSource, /if \(!String\(merged\.handle \|\| ""\)\.trim\(\)\) merged\.handle = fallbackHandle;/, "Blank saved social handles must fall back to officialchicagoshots instead of hiding the handle.");
assert.match(contentHubSource, /LIVE_ANALYTICS_PLATFORMS = new Set\(PLATFORMS\.map/, "Analytics should show every social channel, not only the original four.");
assert.match(contentHubSource, /data-an-oauth/, "Analytics rows should start official account authorization when OAuth is ready.");
assert.doesNotMatch(contentHubSource, /Workspace analytics are live\. Platform APIs are optional/, "Analytics must not present local workspace activity as social analytics.");
assert.doesNotMatch(contentHubSource, /Optional live social APIs/, "Social APIs must be the core analytics source, not optional enrichment.");
assert.doesNotMatch(contentHubSource, /<h3>PhantomForce workspace<\/h3>/, "Analytics must not show a local workspace analytics card.");
assert.doesNotMatch(contentHubSource, /local analytics|added to local analytics|visible in local analytics/i, "Local post history must not be described as analytics.");
assert.match(contentHubSource, /Post now saves a local post-history record/, "Publishing without OAuth must be framed as local post history only.");
assert.match(contentHubSource, /analyticsVisible: false/, "Local post-history rows must not be treated as analytics rows.");
assert.match(contentHubSource, /analyticsConnectorState\.error = force \? message : ""/, "Silent social API checks must not interrupt the social analytics page.");
assert.doesNotMatch(contentHubSource, /OAuth is required before real stats appear/, "Analytics should not make the page look empty before OAuth is configured.");
assert.match(mediaLabSource, /Editable handle or profile URL/, "Media settings must let Jordan change handles per channel.");
assert.match(mediaLabSource, /cross-posting remain locked until OAuth\/API authorization/, "Profile handles must not imply cross-posting is authorized.");
assert.match(mediaLabSource, /requestSocialOAuthStart/, "Social connection buttons must use the backend OAuth-start route.");
assert.match(mediaLabSource, /\/phantom-ai\/ops\/social-oauth\/start/, "OAuth login should not be a hard-coded provider guess in the browser.");
console.log("Social analytics import checks passed.");
