// App-level usage totals + spending limits. Pure decision/aggregation
// functions live here (unit-testable without a PTY or server); server.js
// wires them to the live session registry, the usage-history.jsonl append
// log, and the /api/usage/summary endpoint.
//
// Honesty rules: a session whose model has no verified rate keeps costUsd
// null (it is never coerced to $0-but-real), and its `estimated` flag rides
// along unchanged into the summary. Limits never kill running sessions —
// "over" only blocks NEW session starts and shows a banner.
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const WARN_FRACTION = 0.8;

// Local date string — daily budgets are a human concept, and the human is
// sitting in this machine's timezone.
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// entries: [{ts, sessionId, costUsd}] per-poll cost DELTAS from
// usage-history.jsonl. Null costs (unpriced models) are skipped, not
// counted as zero-dollar-but-real spend.
export function bucketHistoryByDay(entries) {
  const buckets = {};
  for (const entry of entries ?? []) {
    if (typeof entry?.costUsd !== "number" || !Number.isFinite(entry.costUsd)) continue;
    const day = dayKey(entry.ts);
    buckets[day] = (buckets[day] ?? 0) + entry.costUsd;
  }
  return buckets;
}

// sessions: iterable of [sessionId, session] pairs (the server's session
// registry Map); only sessions that actually have a usage snapshot appear —
// a plain shell has no adapter, no data, and therefore no row.
export function summarizeUsage(sessions, historyByDay, { limits = {}, now = Date.now() } = {}) {
  const perSession = [];
  let sessionTotalUsd = 0;
  for (const [sessionId, session] of sessions) {
    const usage = session?.usage;
    if (!usage) continue;
    perSession.push({
      sessionId,
      name: session.name ?? session.profileId ?? null,
      provider: usage.provider ?? session.provider ?? null,
      model: usage.model ?? null,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheTokens: usage.cacheTokens ?? 0,
      costUsd: typeof usage.costUsd === "number" ? usage.costUsd : null,
      estimated: Boolean(usage.estimated),
    });
    if (typeof usage.costUsd === "number") sessionTotalUsd += usage.costUsd;
  }
  const date = dayKey(now);
  const todayTotalUsd = historyByDay?.[date] ?? 0;
  const normalizedLimits = {
    sessionLimitUsd: typeof limits.sessionLimitUsd === "number" ? limits.sessionLimitUsd : null,
    dailyLimitUsd: typeof limits.dailyLimitUsd === "number" ? limits.dailyLimitUsd : null,
  };
  const { state } = checkLimits({ sessionTotalUsd, todayTotalUsd }, normalizedLimits);
  return { perSession, sessionTotalUsd, todayTotalUsd, date, limits: normalizedLimits, limitState: state };
}

// warn at 80% of a limit, over at/above 100%. Unconfigured limits never
// breach anything.
export function checkLimits(totals, limits = {}) {
  const breached = [];
  const evaluate = (limitName, totalUsd, limitUsd) => {
    if (typeof limitUsd !== "number" || !(limitUsd > 0)) return;
    if (typeof totalUsd !== "number" || !Number.isFinite(totalUsd)) return;
    if (totalUsd >= limitUsd) breached.push({ limit: limitName, level: "over", totalUsd, limitUsd });
    else if (totalUsd >= limitUsd * WARN_FRACTION) breached.push({ limit: limitName, level: "warn", totalUsd, limitUsd });
  };
  evaluate("session", totals?.sessionTotalUsd, limits.sessionLimitUsd);
  evaluate("daily", totals?.todayTotalUsd, limits.dailyLimitUsd);
  const state = breached.some((b) => b.level === "over") ? "over" : breached.length ? "warn" : "ok";
  return { state, breached };
}

// Only a breached DAILY limit blocks new session starts (the 409's message
// says exactly that); a session-limit overage or a warn only ever shows a
// banner. Never kills anything already running.
export function shouldBlockSessionStart(check) {
  return Boolean(check?.breached?.some((b) => b.limit === "daily" && b.level === "over"));
}

// ---- app-level history persistence (usage-history.jsonl) --------------------
// Same plain-file pattern as mission/store.js's tokens-history.jsonl, but for
// the whole app: one {ts, sessionId, costUsd} line per positive per-poll cost
// delta, under the .termina data dir.

export function usageHistoryPath(appDir) {
  return path.join(appDir, ".termina", "usage-history.jsonl");
}

export async function appendUsageHistory(appDir, entry) {
  await appendFile(usageHistoryPath(appDir), JSON.stringify(entry) + "\n", "utf8");
}

export function readUsageHistory(appDir) {
  const file = usageHistoryPath(appDir);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// usage: { sessionLimitUsd, dailyLimitUsd } from termina.config.json — both
// optional; absent or malformed config means no limits.
export function loadUsageLimits(appDir) {
  const configPath = path.join(appDir, "termina.config.json");
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const usage = parsed?.usage;
    if (!usage || typeof usage !== "object") return {};
    return {
      sessionLimitUsd: typeof usage.sessionLimitUsd === "number" ? usage.sessionLimitUsd : null,
      dailyLimitUsd: typeof usage.dailyLimitUsd === "number" ? usage.dailyLimitUsd : null,
    };
  } catch {
    return {};
  }
}
