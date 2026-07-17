// Shared model catalog: one place for model identity (label/provider),
// context-window math, and cost math. Rates are per-1M-token USD, kept
// verbatim from the pre-catalog RATES_PER_MILLION_USD table in
// mission/tokens.js where they existed — an unrecognized or unpriced model
// returns null cost rather than a guessed dollar figure. Cache-read rates
// follow Anthropic's published 0.1x-of-input cache-read pricing.
//
// OpenRouter models are deliberately absent: OpenRouter's own usage log
// reports its own cost per response (see mission/tokens.js
// readOpenrouterUsage), which is more accurate than any rate table Termina
// could maintain — the catalog would only ever supply label/context for
// those when known.

export const MODEL_CATALOG = [
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    provider: "anthropic",
    contextWindow: 200000,
    inputPerM: 5,
    outputPerM: 25,
    cachePerM: 0.5,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    contextWindow: 200000,
    inputPerM: 15,
    outputPerM: 75,
    cachePerM: 1.5,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    contextWindow: 200000,
    inputPerM: 3,
    outputPerM: 15,
    cachePerM: 0.3,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200000,
    inputPerM: 0.8,
    outputPerM: 4,
    cachePerM: 0.08,
  },
  {
    // Known model, no verified local rates at time of writing — cost stays
    // null (never guessed); catalog still supplies label + context window.
    id: "gpt-5-codex",
    label: "GPT-5 Codex",
    provider: "openai",
    contextWindow: 400000,
    inputPerM: null,
    outputPerM: null,
    cachePerM: null,
  },
];

const byId = new Map(MODEL_CATALOG.map((entry) => [entry.id, entry]));

export function getModel(id) {
  if (!id) return null;
  return byId.get(id) ?? null;
}

// cacheTokens (when provided) are the portion of inputTokens that came from
// the cache (readClaudeUsage folds cache tokens into inputTokens), billed at
// the cache rate; the remainder bills at the input rate. Callers without
// cache data get the exact pre-catalog behavior: all input at the input rate.
export function costForUsage(modelId, { inputTokens = 0, outputTokens = 0, cacheTokens = 0 } = {}) {
  const entry = getModel(modelId);
  if (!entry || typeof entry.inputPerM !== "number" || typeof entry.outputPerM !== "number") return null;
  const cached = typeof entry.cachePerM === "number" ? Math.max(0, Math.min(cacheTokens ?? 0, inputTokens)) : 0;
  const freshInput = inputTokens - cached;
  return (freshInput / 1_000_000) * entry.inputPerM + (cached / 1_000_000) * entry.cachePerM + (outputTokens / 1_000_000) * entry.outputPerM;
}

// Percent of the model's context window occupied by the latest turn's input
// (input + cache tokens of the newest assistant message — what the model
// actually saw). Null when the model or the token count is unknown — never
// a made-up percentage.
export function contextPercent(modelId, lastTurnInputTokens) {
  const entry = getModel(modelId);
  if (!entry || typeof entry.contextWindow !== "number") return null;
  if (typeof lastTurnInputTokens !== "number" || !Number.isFinite(lastTurnInputTokens) || lastTurnInputTokens < 0) return null;
  return Math.round((lastTurnInputTokens / entry.contextWindow) * 100);
}
