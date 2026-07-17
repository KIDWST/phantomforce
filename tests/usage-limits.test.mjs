import assert from "node:assert/strict";
import { test } from "node:test";

import { bucketHistoryByDay, checkLimits, dayKey, shouldBlockSessionStart, summarizeUsage } from "../usage-limits.js";

// ---- day bucketing -----------------------------------------------------------

test("dayKey uses the local date", () => {
  const ts = new Date(2026, 6, 17, 9, 30).getTime(); // 2026-07-17 local
  assert.equal(dayKey(ts), "2026-07-17");
});

test("bucketHistoryByDay sums per-poll cost deltas into local-date buckets", () => {
  const day1 = new Date(2026, 6, 16, 23, 59).getTime();
  const day2a = new Date(2026, 6, 17, 0, 1).getTime();
  const day2b = new Date(2026, 6, 17, 12, 0).getTime();
  const buckets = bucketHistoryByDay([
    { ts: day1, sessionId: "a", costUsd: 0.5 },
    { ts: day2a, sessionId: "a", costUsd: 0.25 },
    { ts: day2b, sessionId: "b", costUsd: 0.1 },
    { ts: day2b, sessionId: "b", costUsd: null }, // unpriced model — never counted as $0-but-real
  ]);
  assert.equal(buckets["2026-07-16"], 0.5);
  assert.ok(Math.abs(buckets["2026-07-17"] - 0.35) < 1e-9);
});

// ---- summarizeUsage ----------------------------------------------------------

function fakeSessions() {
  return [
    [
      "s1",
      {
        profileId: "claude",
        provider: "claude",
        usage: { model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 200, cacheTokens: 300, costUsd: 0.4, estimated: false },
      },
    ],
    [
      "s2",
      {
        profileId: "openrouter",
        provider: "openrouter",
        usage: { model: "org/model-x", inputTokens: 50, outputTokens: 10, cacheTokens: 0, costUsd: null, estimated: true },
      },
    ],
    ["s3", { profileId: "pwsh", provider: "pwsh", usage: null }], // plain shell: no usage, never listed
  ];
}

test("summarizeUsage lists only sessions with real usage snapshots and totals their cost", () => {
  const now = new Date(2026, 6, 17, 12, 0).getTime();
  const summary = summarizeUsage(fakeSessions(), { "2026-07-17": 1.25 }, { limits: {}, now });
  assert.equal(summary.perSession.length, 2);
  const s1 = summary.perSession.find((p) => p.sessionId === "s1");
  assert.equal(s1.provider, "claude");
  assert.equal(s1.model, "claude-sonnet-5");
  assert.equal(s1.costUsd, 0.4);
  assert.equal(s1.estimated, false);
  const s2 = summary.perSession.find((p) => p.sessionId === "s2");
  assert.equal(s2.costUsd, null, "unpriced model stays null, never coerced to 0");
  assert.equal(s2.estimated, true, "estimated flag must survive aggregation");
  assert.equal(summary.sessionTotalUsd, 0.4);
  assert.equal(summary.todayTotalUsd, 1.25);
  assert.equal(summary.date, "2026-07-17");
  assert.equal(summary.limitState, "ok");
});

test("summarizeUsage reports the configured limits and their state", () => {
  const now = new Date(2026, 6, 17, 12, 0).getTime();
  const summary = summarizeUsage(fakeSessions(), { "2026-07-17": 0.9 }, { limits: { dailyLimitUsd: 1 }, now });
  assert.deepEqual(summary.limits, { sessionLimitUsd: null, dailyLimitUsd: 1 });
  assert.equal(summary.limitState, "warn");
});

// ---- checkLimits -------------------------------------------------------------

test("checkLimits: ok well under every limit", () => {
  const res = checkLimits({ sessionTotalUsd: 0.1, todayTotalUsd: 0.2 }, { sessionLimitUsd: 5, dailyLimitUsd: 10 });
  assert.equal(res.state, "ok");
  assert.deepEqual(res.breached, []);
});

test("checkLimits: warn at 80% of a limit", () => {
  const res = checkLimits({ sessionTotalUsd: 4, todayTotalUsd: 0.2 }, { sessionLimitUsd: 5, dailyLimitUsd: 10 });
  assert.equal(res.state, "warn");
  assert.equal(res.breached.length, 1);
  assert.equal(res.breached[0].limit, "session");
  assert.equal(res.breached[0].level, "warn");
});

test("checkLimits: over at/above 100% of a limit", () => {
  const res = checkLimits({ sessionTotalUsd: 0.1, todayTotalUsd: 10 }, { sessionLimitUsd: 5, dailyLimitUsd: 10 });
  assert.equal(res.state, "over");
  assert.equal(res.breached[0].limit, "daily");
  assert.equal(res.breached[0].level, "over");
});

test("checkLimits: no configured limits means always ok", () => {
  const res = checkLimits({ sessionTotalUsd: 999, todayTotalUsd: 999 }, {});
  assert.equal(res.state, "ok");
});

// ---- start-block decision ----------------------------------------------------

test("shouldBlockSessionStart blocks only when the DAILY limit is over — warn never blocks, session-limit overage never blocks", () => {
  const overDaily = checkLimits({ sessionTotalUsd: 0, todayTotalUsd: 11 }, { dailyLimitUsd: 10 });
  assert.equal(shouldBlockSessionStart(overDaily), true);

  const warnDaily = checkLimits({ sessionTotalUsd: 0, todayTotalUsd: 9 }, { dailyLimitUsd: 10 });
  assert.equal(shouldBlockSessionStart(warnDaily), false);

  const overSession = checkLimits({ sessionTotalUsd: 6, todayTotalUsd: 0 }, { sessionLimitUsd: 5, dailyLimitUsd: 10 });
  assert.equal(shouldBlockSessionStart(overSession), false);
});
