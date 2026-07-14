import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {} };

const { baseSiteDraft, extractStoreProducts, applyWebsitePrompt } = await import("../app/js/workspaces.js?v=test-workspace-site-builder");
const { store } = await import("../app/js/store.js?v=test-workspace-site-builder");

const termina = store.state.sites.find((site) => site.id === "site-termina-workflow-store");
assert.ok(termina, "Termina store should be seeded for admin Sites.");
assert.equal(termina.title, "Termina - Terminal Workflow Manager Store");
assert.equal(termina.kind, "Store");
assert.equal(termina.store.enabled, true);
assert.equal(termina.store.checkoutMode, "test");
assert.equal(termina.store.paymentsConnected, false);
assert.deepEqual(
  termina.catalog.map((product) => [product.name, product.price, product.cadence]),
  [
    ["Termina Workflow Manager", 49, "monthly"],
    ["Termina Pro Command Seat", 149, "monthly"],
    ["Terminal Setup Sprint", 750, "one_time"],
    ["Workflow Automation Buildout", 1500, "one_time"],
  ],
  "Termina store products should be visible by default.",
);

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

const phantomForce = baseSiteDraft("PhantomForce");
const brief = "Build the official PhantomForce website and store at phantomforce.shop for an AI business operating system. Use a premium black and neon green design. Include Home, Services, How it works, Pricing, Store, About, FAQ, Contact, Privacy, Refunds, and Checkout. Add Starter Setup Sprint for $750, Core Setup Sprint for $1,500, Pro Setup Sprint for $2,500, and Operator Support for $775 per month. Include a cart, checkout, booking call to action, proof, mobile layout, and AI-assisted human-approved language.";
applyWebsitePrompt(phantomForce, brief);
assert.deepEqual(
  phantomForce.sections,
  ["Home", "Services", "How it works", "Pricing", "Store", "About", "FAQ", "Contact", "Privacy", "Refunds", "Checkout"],
  "natural-language section order must be preserved."
);
assert.deepEqual(
  phantomForce.catalog.map((product) => [product.name, product.price, product.cadence]),
  [
    ["Starter Setup Sprint", 750, "one_time"],
    ["Core Setup Sprint", 1500, "one_time"],
    ["Pro Setup Sprint", 2500, "one_time"],
    ["Operator Support", 775, "monthly"],
  ],
  "the exact named offers and prices must survive normal comma punctuation."
);
assert.equal(phantomForce.design.cta, "Book a call", "booking intent should become the primary CTA.");
assert.equal(phantomForce.store.checkoutMode, "test", "checkout must remain explicit test mode until payments are connected.");
assert.equal(phantomForce.store.paymentsConnected, false, "the builder must never imply a payment connection.");

console.log("Workspace site builder prompt parsing checks passed.");
