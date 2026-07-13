import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";

const dir = await mkdtemp(join(tmpdir(), "phantom-social-analytics-"));
process.env.PHANTOMFORCE_SOCIAL_ANALYTICS_PATH = join(dir, "social-analytics.json");
delete process.env.APIFY_TOKEN;
delete process.env.APIFY_API_TOKEN;

const { getSocialAnalyticsSnapshot, syncSocialAnalytics } = await import("../src/phantom-ai/social-analytics.js");
const profiles = [
  { id: "instagram" as const, name: "Instagram", handle: "officialchicagoshots" },
  { id: "youtube" as const, name: "YouTube", handle: "OfficialChicagoShots" },
];

const empty = await getSocialAnalyticsSnapshot("test-tenant", profiles);
assert.equal(empty.configured, false);
assert.equal(empty.status, "waiting");
assert.equal(empty.channels.length, 2);

const synced = await syncSocialAnalytics("test-tenant", profiles);
assert.equal(synced.configured, false);
assert.equal(synced.status, "waiting");
assert.ok(synced.channels.every((channel) => channel.status === "waiting"));
assert.ok(synced.channels.every((channel) => channel.followers === null));

const mock = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url?.includes("instagram")) {
    response.end(JSON.stringify([{ followersCount: 1250, postsCount: 44, latestPosts: [{ likesCount: 80, commentsCount: 7, videoViewCount: 900 }] }]));
    return;
  }
  response.end(JSON.stringify([{ numberOfSubscribers: 620, viewCount: 2100, likes: 90, commentsCount: 11 }]));
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const address = mock.address();
assert.ok(address && typeof address === "object");
process.env.APIFY_TOKEN = "test-token";
process.env.PHANTOMFORCE_APIFY_BASE_URL = `http://127.0.0.1:${address.port}`;

const live = await syncSocialAnalytics("test-tenant", profiles, { force: true });
assert.equal(live.configured, true);
assert.equal(live.status, "live");
assert.equal(live.channels[0].followers, 1250);
assert.equal(live.channels[0].views, 900);
assert.equal(live.channels[0].engagement, 87);
assert.equal(live.channels[1].followers, 620);
assert.equal(live.history.length, 1);
await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));

await rm(dir, { recursive: true, force: true });
console.log("Social analytics live-sync checks passed.");
