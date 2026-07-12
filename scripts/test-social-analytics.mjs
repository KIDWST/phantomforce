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
console.log("Social analytics import checks passed.");
