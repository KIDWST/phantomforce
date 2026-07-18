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

/* ---- Sites: domain connect/verify wiring + live-site surface ----
   These exercise the exported markup/state helpers from sitestudio.js with
   MOCKED route responses shaped exactly like the real server routes
   (POST /orgs/:orgId/sites/:siteId/domains and .../domains/:domainId/verify)
   — no DOM and no network needed. */

const {
  domainRecordFromResponse, applyDomainVerifyResult,
  domainRecordMarkup, domainManagerMarkup, liveSiteMarkup, LIVE_SITE_DOMAIN,
} = await import("../app/js/sitestudio.js?v=test-workspace-site-builder");

/* 1) Connect: a mocked POST .../domains response must render real TXT instructions. */
const mockedConnectResponse = {
  ok: true,
  domain: {
    id: "dom_test_1",
    domain: "chicagoshots.com",
    state: "verification_required",
    verificationToken: "pf-verify-0123abcd0123abcd0123abcd0123abcd",
    instructions: "Create a TXT record at _phantomforce-verify.chicagoshots.com with value pf-verify-0123abcd0123abcd0123abcd0123abcd, then call the verify endpoint. PhantomForce never changes your DNS.",
  },
};
const record = domainRecordFromResponse(mockedConnectResponse.domain);
assert.equal(record.state, "verification_required", "a freshly connected domain starts unverified.");
assert.equal(record.verificationToken, mockedConnectResponse.domain.verificationToken, "the server token must be kept verbatim.");

const pendingMarkup = domainRecordMarkup(record);
assert.ok(pendingMarkup.includes("_phantomforce-verify.chicagoshots.com"), "TXT record name must be rendered.");
assert.ok(pendingMarkup.includes(mockedConnectResponse.domain.verificationToken), "TXT record value must be rendered.");
assert.ok(pendingMarkup.includes('data-ss-copy="_phantomforce-verify.chicagoshots.com"'), "TXT name must be copyable.");
assert.ok(pendingMarkup.includes(`data-ss-copy="${mockedConnectResponse.domain.verificationToken}"`), "TXT value must be copyable.");
assert.ok(pendingMarkup.includes("A record") && pendingMarkup.includes("CNAME"), "A/CNAME pointing guidance must be shown.");
assert.ok(pendingMarkup.includes("Awaiting TXT record"), "pending state must be labeled honestly.");
assert.ok(!pendingMarkup.includes(">Verified<"), "must never show Verified before a real DNS check.");
assert.ok(pendingMarkup.includes("Verify now") && !pendingMarkup.includes("disabled"), "idle verify button must be enabled.");

/* 2) Verify button state transitions. */
const verifyingMarkup = domainRecordMarkup(record, { verifying: true });
assert.ok(verifyingMarkup.includes("Checking DNS…") && verifyingMarkup.includes("disabled"), "in-flight verify must disable the button.");

applyDomainVerifyResult(record, {
  ok: true,
  domain: { id: "dom_test_1", domain: "chicagoshots.com", state: "dns_records_pending", sslState: "unknown" },
  check: { state: "dns_records_pending", detail: "Ownership verified, but the domain does not resolve to any address yet.", txtFound: true, addressFound: false, sslState: "unknown", checkedAt: "2026-07-17T00:00:00.000Z" },
});
assert.equal(record.state, "dns_records_pending", "verify result must move the record to the server's state.");
assert.ok(domainRecordMarkup(record).includes("DNS not resolving yet"), "partial verification must be labeled as such.");

applyDomainVerifyResult(record, {
  ok: true,
  domain: { id: "dom_test_1", domain: "chicagoshots.com", state: "verified", sslState: "active" },
  check: { state: "verified", detail: "Ownership token verified and the domain resolves.", txtFound: true, addressFound: true, sslState: "active", checkedAt: "2026-07-17T00:01:00.000Z" },
});
assert.equal(record.state, "verified");
const verifiedMarkup = domainRecordMarkup(record);
assert.ok(verifiedMarkup.includes(">Verified<"), "verified state comes only from the server check.");
assert.ok(verifiedMarkup.includes("SSL active"), "SSL status must be surfaced.");
assert.ok(!verifiedMarkup.includes("data-ss-copy"), "verified domains no longer nag with TXT instructions.");

const failedRecord = domainRecordFromResponse(mockedConnectResponse.domain);
applyDomainVerifyResult(failedRecord, { ok: false, error: "domain_not_found" });
assert.equal(failedRecord.state, "verification_required", "a failed verify REQUEST must not change the real state.");
assert.ok(String(failedRecord.detail).includes("domain_not_found"), "the failure reason must be surfaced.");

const misconfigured = domainRecordFromResponse(mockedConnectResponse.domain);
applyDomainVerifyResult(misconfigured, {
  ok: true,
  domain: { id: "dom_test_1", domain: "chicagoshots.com", state: "misconfigured", sslState: "unknown" },
  check: { state: "misconfigured", detail: "verification TXT record exists but does not match the expected token", txtFound: false, addressFound: true, sslState: "unknown", checkedAt: "2026-07-17T00:02:00.000Z" },
});
assert.ok(domainRecordMarkup(misconfigured).includes("Misconfigured"), "misconfigured DNS must be reported, not glossed over.");
assert.ok(domainRecordMarkup(misconfigured).includes("does not match the expected token"), "the server's failure detail must be shown.");

/* 3) Database-session gating: honest messaging, never a fake flow. */
const draftSite = baseSiteDraft("ChicagoShots");
draftSite.customDomains = [];
const gated = domainManagerMarkup(draftSite, { databaseSession: false });
assert.ok(gated.includes("Local mode"), "without a database session the panel must say it's local mode.");
assert.ok(!gated.includes("data-ss-domain-connect-form"), "no connect form without a database session.");

const noServerRecord = domainManagerMarkup(draftSite, { databaseSession: true });
assert.ok(noServerRecord.includes("Request a publish"), "db session without a server site must explain the publish-first step.");
assert.ok(!noServerRecord.includes("data-ss-domain-connect-form"), "no connect form before the server knows the site.");

draftSite.serverSiteId = "site_srv_1";
const connectable = domainManagerMarkup(draftSite, { databaseSession: true });
assert.ok(connectable.includes("data-ss-domain-connect-form"), "connect form appears with a database session + server site record.");
assert.ok(connectable.includes("never writes DNS"), "the read-only DNS promise stays visible.");

/* 4) Live-site panel for the seeded phantomforce.online site. */
assert.equal(LIVE_SITE_DOMAIN, "phantomforce.online");
const seeded = baseSiteDraft("PhantomForce");
applySiteTemplate(seeded, "phantomforce");
const livePanel = liveSiteMarkup(seeded);
assert.ok(livePanel.includes("data-ss-live-site"), "seeded public site must show the live-site panel.");
assert.ok(livePanel.includes('href="https://phantomforce.online"'), "the real public URL must be linked.");
assert.ok(livePanel.toLowerCase().includes("local working copy"), "the draft must be labeled a local working copy — no fake sync claims.");
assert.ok(livePanel.includes("Load live preview"), "preview must be lazy behind a click.");
assert.ok(!livePanel.includes("<iframe"), "no iframe (network call) before the user clicks load.");
const loadedPanel = liveSiteMarkup(seeded, { loaded: true });
assert.ok(loadedPanel.includes("<iframe") && loadedPanel.includes('src="https://phantomforce.online"'), "loading embeds the actual live site.");
assert.equal(liveSiteMarkup(baseSiteDraft("SomethingElse")), "", "the live panel only appears for the real phantomforce.online site.");

console.log("Sites domain connect/verify + live-site surface checks passed.");
