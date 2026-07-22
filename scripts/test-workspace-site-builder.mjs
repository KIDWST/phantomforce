import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
assert.equal(starter.design.sourceKind, "phantomforce_public_source", "starter must identify the real public-site source instead of a generated mock.");
assert.deepEqual(starter.design.sourceFiles, ["/index.html", "/void.css", "/void.js"], "starter must point at the real public website source files.");
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

const siteStudioSource = readFileSync(new URL("../app/js/sitestudio.js", import.meta.url), "utf8");
const siteStudioCss = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
assert.ok(siteStudioSource.includes("AI Website Editor"), "public site editor should default to an AI visual editor, not source loading.");
assert.ok(siteStudioSource.includes("Easy edit") && siteStudioSource.includes("Code"), "code must remain available as the secondary editor mode.");
assert.ok(siteStudioSource.includes("data-ss-inspect-target"), "public site preview must expose click-to-edit target controls.");
assert.ok(siteStudioSource.includes("data-ss-ai-style"), "easy editor must offer AI style actions for selected regions.");
assert.ok(siteStudioSource.includes("data-ss-asset-preset"), "easy editor must offer Media Pool asset and quick-element actions.");
assert.ok(siteStudioSource.includes("workspaceStorageGetItem(CONTENT_ASSETS_KEY)"), "Site Studio should read real Media Pool assets from workspace storage.");
assert.equal(siteStudioSource.includes("Load current code"), false, "the old oversized load-code affordance should not return.");
assert.ok(siteStudioCss.includes(".ss-live-hotspots"), "click-to-edit hotspots must be styled.");
assert.ok(siteStudioCss.includes(".ss-site-editor-panel"), "AI website editor panel must be styled.");
assert.ok(siteStudioCss.includes(".ss-asset-bank"), "Media Pool and quick-element asset bank must be styled.");

console.log("Workspace site builder prompt parsing checks passed.");
