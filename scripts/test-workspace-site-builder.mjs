import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {} };

const { baseSiteDraft, extractStoreProducts, applyWebsitePrompt, SITE_TEMPLATES, applySiteTemplate } = await import("../app/js/workspaces.js?v=test-workspace-site-builder");

assert.ok(SITE_TEMPLATES.phantomforce, "site studio must ship with a PhantomForce public-site starter.");
assert.equal(SITE_TEMPLATES.termina, undefined, "the default website/store starter must not be the old Termina store.");

const starter = baseSiteDraft("PhantomForce");
assert.equal(applySiteTemplate(starter, "phantomforce"), true, "PhantomForce starter should apply.");
assert.equal(starter.title, "PhantomForce — public site", "starter should identify the public PhantomForce site.");
assert.equal(starter.design.brand, "PhantomForce", "starter should use the PhantomForce brand.");
assert.equal(starter.design.existingUrl, "phantomforce.online", "starter should be anchored to phantomforce.online.");
assert.equal(starter.store.checkoutMode, "test", "public site starter must still use test checkout until payments are connected.");
assert.ok(starter.sections.includes("Media Lab"), "public site starter should include real product sections.");
assert.ok(starter.catalog.some((product) => product.name === "Free Plan" && product.price === 0), "free plan should be visible in the public-site catalog.");

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
const brief = "Build the official PhantomForce website and store at phantomforce.online for an AI business operating system. Use a premium black and neon green design. Include Home, Services, How it works, Pricing, Store, About, FAQ, Contact, Privacy, Refunds, and Checkout. Add Starter Setup Sprint for $750, Core Setup Sprint for $1,500, Pro Setup Sprint for $2,500, and Operator Support for $775 per month. Include a cart, checkout, booking call to action, proof, mobile layout, and AI-assisted human-approved language.";
applyWebsitePrompt(phantomForce, brief);
assert.deepEqual(
  phantomForce.sections,
  ["Home", "Services", "How it works", "Pricing", "Store", "About", "FAQ", "Contact", "Privacy", "Refunds", "Checkout"],
  "natural-language section order must be preserved."
);
for (const expected of [
  ["Free Plan", 0, "monthly"],
  ["Starter Setup Sprint", 750, "one_time"],
  ["Core Setup Sprint", 1500, "one_time"],
  ["Pro Setup Sprint", 2500, "one_time"],
  ["Operator Support", 775, "monthly"],
]) {
  assert.ok(
    phantomForce.catalog.some((product) => product.name === expected[0] && product.price === expected[1] && product.cadence === expected[2]),
    `${expected[0]} should exist with the exact price and cadence.`
  );
}
assert.equal(phantomForce.design.cta, "Book a call", "booking intent should become the primary CTA.");
assert.equal(phantomForce.design.existingUrl, "phantomforce.online", "official PhantomForce prompts should keep the real public domain.");
assert.equal(phantomForce.store.checkoutMode, "test", "checkout must remain explicit test mode until payments are connected.");
assert.equal(phantomForce.store.paymentsConnected, false, "the builder must never imply a payment connection.");

console.log("Workspace site builder prompt parsing checks passed.");
