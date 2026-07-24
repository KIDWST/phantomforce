import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { addEventListener: () => {} };

const { baseSiteDraft, extractStoreProducts, applyWebsitePrompt, SITE_TEMPLATES, applySiteTemplate } = await import("../app/js/workspaces.js?v=test-workspace-site-builder");
const { compareSiteVersion, websiteReadiness } = await import("../app/js/sitestudio.js?v=test-workspace-site-builder");

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

phantomForce.history = [{
  at: new Date().toISOString(),
  label: "before headline",
  data: {
    title: phantomForce.title,
    kind: phantomForce.kind,
    sections: [...phantomForce.sections],
    design: { ...phantomForce.design, headline: "Old headline" },
    catalog: structuredClone(phantomForce.catalog),
    store: structuredClone(phantomForce.store),
    copy: {},
    domain: phantomForce.domain || "",
    url: phantomForce.url || "",
  },
}];
const versionDiff = compareSiteVersion(phantomForce, 0);
assert.ok(versionDiff.some((change) => change.label === "Headline"), "version compare must expose changed headline content.");
const ready = websiteReadiness(phantomForce, true);
assert.equal(ready.total, 7, "readiness must evaluate the complete launch checklist.");
assert.ok(ready.checks.some((check) => check.id === "history" && check.pass), "saved recovery points must count toward readiness.");

const siteStudioSource = readFileSync(new URL("../app/js/sitestudio.js", import.meta.url), "utf8");
const siteStudioCss = readFileSync(new URL("../app/phantom.css", import.meta.url), "utf8");
assert.ok(siteStudioSource.includes("AI Website Editor"), "public site editor should default to an AI visual editor, not source loading.");
assert.ok(siteStudioSource.includes("Easy edit") && siteStudioSource.includes("Code"), "code must remain available as the secondary editor mode.");
assert.ok(siteStudioSource.includes("data-ss-inspect-target") && siteStudioSource.includes("ss-inspector-list"), "AI side panel must expose edit targets without covering the live website.");
assert.equal(siteStudioSource.includes("ss-live-hotspots"), false, "live public preview must not render hotspot buttons over the website.");
assert.ok(siteStudioSource.includes("data-ss-hot-reload"), "live public preview must offer an explicit reload control.");
assert.ok(siteStudioSource.includes("data-ss-editor-toggle"), "live public preview must let owners collapse the AI side panel for full-width site interaction.");
assert.ok(siteStudioSource.includes("data-ss-live-frame"), "live public preview iframe must be targetable without overlay interference.");
assert.ok(siteStudioSource.includes("data-ss-ai-style"), "easy editor must offer AI style actions for selected regions.");
assert.ok(siteStudioSource.includes("data-ss-asset-preset"), "easy editor must offer Media Pool asset and quick-element actions.");
assert.ok(siteStudioSource.includes("workspaceStorageGetItem(CONTENT_ASSETS_KEY)"), "Site Studio should read real Media Pool assets from workspace storage.");
assert.ok(siteStudioSource.includes("data-ss-direct-form"), "selected website regions must support direct manual editing.");
assert.ok(siteStudioSource.includes("Preview before applying"), "AI website edits must show a proposal diff before mutation.");
assert.ok(siteStudioSource.includes("data-ss-compare"), "saved website versions must support comparison before restore.");
assert.ok(siteStudioSource.includes("Launch readiness"), "Website Builder must expose explicit launch readiness.");
assert.ok(siteStudioSource.includes("data-act=\"ss-connect-domain\""), "server-backed sites must expose domain connection.");
assert.ok(siteStudioSource.includes("data-act=\"ss-rollback-live\""), "verified deployments must expose rollback when a prior version exists.");
assert.equal(siteStudioSource.includes("Load current code"), false, "the old oversized load-code affordance should not return.");
assert.ok(siteStudioCss.includes(".ss-live-hotspots") && siteStudioCss.includes("pointer-events: none !important"), "legacy hotspot styles must stay disabled so live websites receive clicks.");
assert.ok(siteStudioCss.includes(".ss-public-source.is-editor-collapsed"), "public site preview must support full-width interaction by collapsing the AI panel.");
assert.ok(siteStudioCss.includes("@media (max-width: 1180px)"), "public site editor must stop squeezing the preview at browser zoom and smaller desktop widths.");
assert.ok(siteStudioCss.includes(".ss-site-editor-panel"), "AI website editor panel must be styled.");
assert.ok(siteStudioCss.includes(".ss-asset-bank"), "Media Pool and quick-element asset bank must be styled.");
assert.ok(siteStudioCss.includes(".ss-proposal-diff"), "proposal comparison must be styled.");
assert.ok(siteStudioCss.includes(".ss-readiness"), "launch readiness must be styled.");

console.log("Workspace site builder prompt parsing checks passed.");
