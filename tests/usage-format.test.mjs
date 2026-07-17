import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTokens, formatUsd, usageLine } from "../public/usage-format.js";

// ---- formatTokens ------------------------------------------------------------

test("formatTokens: small counts stay verbatim", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
});

test("formatTokens: thousands get one decimal + k", () => {
  assert.equal(formatTokens(1234), "1.2k");
  assert.equal(formatTokens(41000), "41.0k");
});

test("formatTokens: millions get one decimal + M", () => {
  assert.equal(formatTokens(2_500_000), "2.5M");
});

test("formatTokens: non-numbers render empty", () => {
  assert.equal(formatTokens(null), "");
  assert.equal(formatTokens(undefined), "");
  assert.equal(formatTokens(NaN), "");
});

// ---- formatUsd ---------------------------------------------------------------

test("formatUsd: two decimals", () => {
  assert.equal(formatUsd(0.0312), "$0.03");
  assert.equal(formatUsd(12.3456), "$12.35");
  assert.equal(formatUsd(0.42), "$0.42");
});

test("formatUsd: sub-cent (but nonzero) shows <$0.01, never a fake $0.00", () => {
  assert.equal(formatUsd(0.004), "<$0.01");
});

test("formatUsd: exactly zero is a real $0.00", () => {
  assert.equal(formatUsd(0), "$0.00");
});

test("formatUsd: null/undefined (unpriced model) renders empty — no invented dollar figure", () => {
  assert.equal(formatUsd(null), "");
  assert.equal(formatUsd(undefined), "");
});

// ---- usageLine ---------------------------------------------------------------

test("usageLine renders the full telemetry line", () => {
  const line = usageLine({
    provider: "claude",
    modelLabel: "Sonnet 5",
    inputTokens: 12400,
    outputTokens: 3100,
    cacheTokens: 41000,
    contextPercent: 37,
    costUsd: 0.42,
    estimated: false,
  });
  assert.equal(line, "claude · Sonnet 5 · in 12.4k out 3.1k cache 41.0k · 37% ctx · $0.42");
});

test("usageLine keeps the ~ prefix for estimated data", () => {
  const line = usageLine({
    provider: "claude",
    modelLabel: "Sonnet 5",
    inputTokens: 12400,
    outputTokens: 3100,
    cacheTokens: 41000,
    contextPercent: 37,
    costUsd: 0.42,
    estimated: true,
  });
  assert.ok(line.startsWith("~"), `estimated line must carry the ~ convention, got: ${line}`);
});

test("usageLine omits what it does not know: no cost segment for unpriced models, no ctx for unknown windows, no cache when zero", () => {
  const line = usageLine({
    provider: "openrouter",
    modelLabel: "org/model-x",
    inputTokens: 500,
    outputTokens: 100,
    cacheTokens: 0,
    contextPercent: null,
    costUsd: null,
    estimated: false,
  });
  assert.equal(line, "openrouter · org/model-x · in 500 out 100");
});
