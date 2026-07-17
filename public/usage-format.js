// Pure usage-telemetry formatters, shared between the browser (loaded as a
// module script; attaches window.UsageFormat for app.js, which is a classic
// script) and node --test (plain ESM imports). No DOM access here.

export function formatTokens(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// null/undefined means "no verified rate for this model" — render nothing
// rather than a made-up $0.00. Real-but-tiny costs show <$0.01 so they are
// never mistaken for free.
export function formatUsd(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "";
  if (x > 0 && x < 0.005) return "<$0.01";
  return `$${x.toFixed(2)}`;
}

// One tile-meta line, e.g.:
//   "claude · Sonnet 5 · in 12.4k out 3.1k cache 41.0k · 37% ctx · $0.42"
// Unknown pieces are omitted, never invented; estimated data keeps the app's
// existing "~" prefix convention.
export function usageLine({ provider, modelLabel, inputTokens, outputTokens, cacheTokens, contextPercent, costUsd, estimated } = {}) {
  const segments = [];
  if (provider) segments.push(provider);
  if (modelLabel) segments.push(modelLabel);
  const tokenBits = [];
  if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) tokenBits.push(`in ${formatTokens(inputTokens)}`);
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) tokenBits.push(`out ${formatTokens(outputTokens)}`);
  if (typeof cacheTokens === "number" && Number.isFinite(cacheTokens) && cacheTokens > 0) tokenBits.push(`cache ${formatTokens(cacheTokens)}`);
  if (tokenBits.length) segments.push(tokenBits.join(" "));
  if (typeof contextPercent === "number" && Number.isFinite(contextPercent)) segments.push(`${contextPercent}% ctx`);
  const cost = formatUsd(costUsd);
  if (cost) segments.push(cost);
  const line = segments.join(" · ");
  return estimated && line ? `~${line}` : line;
}

if (typeof window !== "undefined") {
  window.UsageFormat = { formatTokens, formatUsd, usageLine };
}
