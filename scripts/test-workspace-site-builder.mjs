import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {} };

const { baseSiteDraft, extractStoreProducts, applyWebsitePrompt } = await import("../app/js/workspaces.js?v=test-workspace-site-builder");

const parsed = extractStoreProducts("Make a store and add setup sprint for $1,500 and include monthly care for $300/mo.");
assert.equal(parsed.length, 2, "valid one-time and monthly products should parse.");
assert.deepEqual(
  parsed.map((product) => [product.name, product.price, product.cadence]),
  [
    ["setup sprint", 1500, "one_time"],
    ["monthly care", 300, "monthly"],
  ],
  "product parser should clean command words and preserve cadence."
);

const malformed = extractStoreProducts("Make a store and add broken offer for $12,34 and include support at $1,25 per month.");
assert.equal(malformed.length, 0, "malformed comma prices must not become partial products.");

const site = baseSiteDraft("ChicagoShots");
site.sections = ["Hero", "Store", "Checkout"];
applyWebsitePrompt(site, "Make this a store with checkout and products.");
assert.equal(site.sections.filter((section) => /^(store|products)$/i.test(section)).length, 1, "store/product section should not duplicate.");
assert.equal(site.sections.filter((section) => /^checkout$/i.test(section)).length, 1, "checkout section should not duplicate.");
assert.equal(site.design.storeEnabled, true, "store prompts should enable the storefront.");

console.log("Workspace site builder prompt parsing checks passed.");
