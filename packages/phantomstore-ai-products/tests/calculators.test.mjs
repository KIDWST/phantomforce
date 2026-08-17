import test from "node:test";
import assert from "node:assert/strict";
import { analyzeProduct } from "../src/calculators.mjs";
import { PRODUCTS } from "../src/catalog.mjs";

const context = { now: "2026-08-17T00:00:00.000Z", path: "deterministic-domain-v1" };

test("all ten domain calculators emit validated, source-linked, reviewable zero-cost output", () => {
  for (const product of PRODUCTS) {
    const result = analyzeProduct(product.id, product.sample, ["evidence-1"], context);
    assert.equal(result.taskId, product.taskId, product.name);
    assert.equal(result.providerPath, "deterministic-domain-v1", product.name);
    assert.equal(result.externalModelUsed, false, product.name);
    assert.deepEqual(result.cost, { usd: 0, inputTokens: 0, outputTokens: 0 }, product.name);
    assert.equal(result.reviewRequired, true, product.name);
    assert.ok(result.metrics.every((item) => item.unit && item.formula && item.rounding && item.inputs), product.name);
    assert.ok(result.claims.every((item) => item.evidenceIds.length > 0), product.name);
    assert.ok(result.method.length > 20, product.name);
  }
});

test("golden fixtures prove each product uses different domain logic", () => {
  const byId = Object.fromEntries(PRODUCTS.map((product) => [product.id, analyzeProduct(product.id, product.sample, ["evidence-1"], context)]));
  assert.equal(byId["phantom-oracle"].table[0].name, "Dual source");
  assert.equal(byId["phantom-chronicle"].metrics[0].value, 5);
  assert.equal(byId["phantom-foundry"].table.length, 20);
  assert.equal(byId["phantom-twin"].table.sort((a, b) => b.utilizationPercent - a.utilizationPercent)[0].name, "Catalog");
  assert.equal(byId["phantom-dealroom"].table[0].name, "Stable core");
  assert.equal(byId["phantom-blueprint"].metrics[0].value, 100);
  assert.equal(byId["phantom-terrain"].table[0].name, "North yard");
  assert.equal(byId["phantom-proof"].metrics[0].value, 47.8);
  assert.equal(byId["phantom-loom-dependency"].metrics[0].value, 100);
  assert.equal(byId["phantom-causal"].metrics[0].value, 7);
  assert.equal(new Set(PRODUCTS.map((product) => byId[product.id].metrics[0].formula)).size, 10);
});

test("fallback path preserves the output contract and deterministic values", () => {
  const product = PRODUCTS[9];
  const primary = analyzeProduct(product.id, product.sample, ["fixed-evidence"], context);
  const fallback = analyzeProduct(product.id, product.sample, ["fixed-evidence"], { ...context, path: "deterministic-conservative-v1" });
  assert.equal(fallback.providerPath, "deterministic-conservative-v1");
  assert.deepEqual({ ...fallback, providerPath: primary.providerPath }, primary);
});
