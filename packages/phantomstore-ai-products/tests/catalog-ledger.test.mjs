import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCTS, PRODUCT_IDS, publicProduct } from "../src/catalog.mjs";

const expected = ["PHANTOM ORACLE", "PHANTOM CHRONICLE", "PHANTOM FOUNDRY", "PHANTOM TWIN", "PHANTOM DEALROOM", "PHANTOM BLUEPRINT", "PHANTOM TERRAIN", "PHANTOM PROOF", "PHANTOM LOOM", "PHANTOM CAUSAL"];

test("catalog contains exactly the prescribed ten distinct domain products", () => {
  assert.deepEqual(PRODUCTS.map((product) => product.name), expected);
  assert.equal(new Set(PRODUCT_IDS).size, 10);
  assert.equal(new Set(PRODUCTS.map((product) => product.objectType)).size, 10);
  assert.equal(new Set(PRODUCTS.map((product) => product.taskId)).size, 10);
  assert.equal(new Set(PRODUCTS.map((product) => product.primaryModule)).size, 10);
});

test("every product preserves twelve prescribed modules and a bounded analysis contract", () => {
  for (const product of PRODUCTS) {
    assert.equal(product.modules.length, 12, product.name);
    assert.ok(product.fields.length >= 4, product.name);
    assert.ok(product.nonGoals.length >= 3, product.name);
    const published = publicProduct(product);
    assert.equal(published.analysisContract.externalModelsActive, false, product.name);
    assert.equal(published.analysisContract.humanReviewRequired, true, product.name);
    assert.equal(published.analysisContract.costCeilingUsd, 0, product.name);
    assert.notEqual(published.analysisContract.activePath, published.analysisContract.fallbackPath, product.name);
  }
});

test("machine-readable ledger maps all 5,400 tickets and overclaims none", async () => {
  const path = resolve(import.meta.dirname, "../../../docs/phantomstore-ai-products/REQUIREMENT_LEDGER.json");
  const ledger = JSON.parse(await readFile(path, "utf8"));
  assert.equal(ledger.tickets.length, 5400);
  assert.equal(ledger.globalRequirements.length, 120);
  assert.equal(ledger.tickets[0].id, "PHX-00001");
  assert.equal(ledger.tickets.at(-1).id, "PHX-05400");
  assert.equal(ledger.tickets.filter((item) => item.status === "implemented_vertical_slice").length, 10);
  assert.equal(ledger.tickets.filter((item) => item.status === "implemented_milestone_2").length, 271);
  assert.equal(ledger.tickets.filter((item) => item.status === "deferred").length, 5119);
  assert.equal(ledger.summary.implementedTicketsTotal, 281); assert.equal(ledger.summary.falseClaims, 0);
  assert.ok(ledger.tickets.filter((item) => item.status.startsWith("implemented")).every((item) => item.implementationLocation && item.testEvidence && item.blockedReason == null));
  assert.ok(ledger.tickets.every((item) => ["milestone", "priority", "dependencyClass", "coreLoop", "releaseCritical", "implementationOwner", "verificationType", "blockedReason", "sharedFoundationRequirement"].every((field) => field in item)));
});
