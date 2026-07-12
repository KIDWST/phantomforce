const METRIC_ALIASES = Object.freeze({
  reach: ["reach", "accounts reached", "accounts_reached", "account reach", "unique viewers", "unique_viewers"],
  impressions: ["impressions", "views", "video views", "video_views", "profile views", "profile_views"],
  likes: ["likes", "like count", "like_count", "reactions"],
  comments: ["comments", "comment count", "comment_count"],
  shares: ["shares", "share count", "share_count"],
  saves: ["saves", "saved", "save count", "save_count"],
  followers: ["followers", "follower count", "follower_count", "subscribers", "subscriber count", "subscriber_count"],
  followersGained: ["followers gained", "followers_gained", "new followers", "new_followers", "subscribers gained", "subscribers_gained"],
  engagement: ["engagement", "engagements", "total engagement", "total_engagement"],
});

function normalizedKey(value = "") {
  return String(value).trim().toLowerCase().replace(/[()]/g, "").replace(/[-/]+/g, " ").replace(/\s+/g, " ");
}

function numericValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return 0;
  const multiplier = text.endsWith("k") ? 1_000 : text.endsWith("m") ? 1_000_000 : 1;
  const parsed = Number(text.replace(/[%,$\s]/g, "").replace(/[km]$/, ""));
  return Number.isFinite(parsed) ? parsed * multiplier : 0;
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(normalizedKey);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function jsonRows(text) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["data", "items", "rows", "results", "analytics", "insights"]) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  return parsed && typeof parsed === "object" ? [parsed] : [];
}

function valueFor(row, aliases) {
  const flat = row?.metrics && typeof row.metrics === "object" ? { ...row, ...row.metrics } : row;
  const entries = Object.entries(flat || {});
  for (const alias of aliases) {
    const match = entries.find(([key]) => normalizedKey(key) === normalizedKey(alias));
    if (match) return numericValue(match[1]);
  }
  return 0;
}

export function parseAnalyticsReport(text, options = {}) {
  const sourceText = String(text || "").trim();
  if (!sourceText) throw new Error("The report is empty.");
  let rows;
  try {
    rows = sourceText.startsWith("{") || sourceText.startsWith("[")
      ? jsonRows(sourceText)
      : parseDelimited(sourceText, sourceText.includes("\t") && !sourceText.includes(",") ? "\t" : ",");
  } catch {
    throw new Error("Use a CSV, TSV, or JSON analytics export.");
  }
  rows = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === "object");
  if (!rows.length) throw new Error("No analytics rows were found in that report.");

  const totals = { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, saves: 0, followers: 0, followersGained: 0, engagement: 0 };
  let recognized = 0;
  for (const row of rows) {
    const values = Object.fromEntries(Object.entries(METRIC_ALIASES).map(([metric, aliases]) => [metric, valueFor(row, aliases)]));
    if (Object.values(values).some((value) => value > 0)) recognized += 1;
    totals.reach += values.reach;
    totals.impressions += values.impressions;
    totals.likes += values.likes;
    totals.comments += values.comments;
    totals.shares += values.shares;
    totals.saves += values.saves;
    totals.followers = Math.max(totals.followers, values.followers);
    totals.followersGained += values.followersGained;
    totals.engagement += values.engagement || values.likes + values.comments + values.shares + values.saves;
  }
  if (!recognized) {
    throw new Error("No recognized metrics were found. Include reach, views, impressions, followers, likes, comments, shares, or saves.");
  }
  if (!totals.followers) totals.followers = totals.followersGained;
  return {
    ...totals,
    source: options.source || "Platform analytics export",
    syncedAt: options.syncedAt || new Date().toISOString(),
    importedRows: rows.length,
    fileName: String(options.fileName || "analytics report").slice(0, 120),
  };
}
