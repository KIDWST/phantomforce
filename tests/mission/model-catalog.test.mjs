import assert from "node:assert/strict";
import { test } from "node:test";

import { MODEL_CATALOG, getModel, costForUsage, contextPercent } from "../../mission/model-catalog.js";
import { costForUsage as tokensCostForUsage } from "../../mission/tokens.js";

test("MODEL_CATALOG entries all carry id/label/provider/contextWindow fields", () => {
  assert.ok(Array.isArray(MODEL_CATALOG) && MODEL_CATALOG.length >= 4);
  for (const entry of MODEL_CATALOG) {
    assert.equal(typeof entry.id, "string");
    assert.equal(typeof entry.label, "string");
    assert.equal(typeof entry.provider, "string");
    assert.equal(typeof entry.contextWindow, "number");
  }
});

test("getModel returns the entry for a known model id", () => {
  const entry = getModel("claude-sonnet-5");
  assert.ok(entry);
  assert.equal(entry.provider, "anthropic");
  assert.equal(entry.contextWindow, 200000);
});

test("getModel returns null for an unknown model id (and for no id at all)", () => {
  assert.equal(getModel("some-future-model-1"), null);
  assert.equal(getModel(null), null);
  assert.equal(getModel(undefined), null);
});

// Rates must stay verbatim from the pre-catalog RATES_PER_MILLION_USD table
// in mission/tokens.js — the catalog is a relocation, not a repricing.
test("costForUsage matches the existing tokens.js rates for sonnet/opus/haiku", () => {
  assert.equal(costForUsage("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 3 + 15);
  assert.equal(costForUsage("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 15 + 75);
  assert.equal(costForUsage("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0.8 + 4);
});

test("costForUsage returns null for an unknown model rather than guessing", () => {
  assert.equal(costForUsage("some-future-model-1", { inputTokens: 100, outputTokens: 100 }), null);
});

test("costForUsage returns null for a cataloged model with no verified rates (gpt-5-codex)", () => {
  assert.ok(getModel("gpt-5-codex"), "gpt-5-codex should be in the catalog for label/context");
  assert.equal(costForUsage("gpt-5-codex", { inputTokens: 1_000_000, outputTokens: 1_000_000 }), null);
});

test("costForUsage bills cache tokens at the cache rate, remaining input at the input rate", () => {
  // 1M input of which 500k came from cache: 0.5M * $3 + 0.5M * $0.30 + 1M * $15.
  const cost = costForUsage("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheTokens: 500_000 });
  assert.equal(cost, 0.5 * 3 + 0.5 * 0.3 + 15);
});

test("contextPercent computes percent of the model's context window", () => {
  assert.equal(contextPercent("claude-sonnet-5", 100000), 50);
});

test("contextPercent returns null for unknown models or unusable token counts", () => {
  assert.equal(contextPercent("some-future-model-1", 100000), null);
  assert.equal(contextPercent("claude-sonnet-5", null), null);
  assert.equal(contextPercent("claude-sonnet-5", NaN), null);
});

// mission/tokens.js keeps its old call shape as a thin wrapper so existing
// imports (server.js pollTokenUsage) keep working unchanged.
test("tokens.js costForUsage wrapper delegates to the catalog", () => {
  assert.equal(tokensCostForUsage({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 1_000_000 }), 18);
  assert.equal(tokensCostForUsage({ model: "nope", inputTokens: 1, outputTokens: 1 }), null);
});
