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
assert.match(contentHubSource, /social-analytics\.js/);
assert.match(contentHubSource, /parseAnalyticsReport/);
assert.match(contentHubSource, /PhantomForce local site\/content signals/);
assert.match(contentHubSource, /signalLabel/);
assert.match(contentHubSource, /activeWorkspaceSites/);
assert.match(contentHubSource, /Import official report/);
assert.match(contentHubSource, /Auto · CSV · TSV · JSON/);
assert.match(contentHubSource, /Connect your channels for live data\./);
assert.match(contentHubSource, /\/phantom-ai\/ops\/social-analytics\/status/);
assert.match(contentHubSource, /\/phantom-ai\/ops\/social-analytics\/sync/);
assert.match(contentHubSource, /Start live sync/);
assert.match(contentHubSource, /Use a report file/);
assert.match(contentHubSource, /an-channel-line/);
assert.match(contentHubSource, /an-coverage-ring/);
console.log("Social analytics import checks passed.");
