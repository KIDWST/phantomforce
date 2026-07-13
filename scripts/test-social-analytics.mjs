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
assert.match(contentHubSource, /PhantomForce local site\/content signals/);
assert.match(contentHubSource, /signalLabel/);
assert.match(contentHubSource, /activeWorkspaceSites/);
assert.match(contentHubSource, /Import official report/);
assert.match(contentHubSource, /Backup only · CSV · TSV · JSON/);
assert.match(contentHubSource, /an-channel-line/);
assert.match(contentHubSource, /an-coverage-ring/);
assert.match(contentHubSource, /officialchicagoshots/, "Social handles should default to Jordan's ChicagoShots handle.");
assert.match(contentHubSource, /LIVE_ANALYTICS_PLATFORMS = new Set\(PLATFORMS\.map/, "Analytics should show every social channel, not only the original four.");
assert.match(contentHubSource, /OAuth is required before real stats appear/, "Analytics must make the OAuth/live-data boundary explicit.");
assert.match(mediaLabSource, /Editable handle or profile URL/, "Media settings must let Jordan change handles per channel.");
assert.match(mediaLabSource, /cross-posting remain locked until OAuth\/API authorization/, "Profile handles must not imply cross-posting is authorized.");
assert.match(mediaLabSource, /requestSocialOAuthStart/, "Social connection buttons must use the backend OAuth-start route.");
assert.match(mediaLabSource, /\/phantom-ai\/ops\/social-oauth\/start/, "OAuth login should not be a hard-coded provider guess in the browser.");
console.log("Social analytics import checks passed.");
