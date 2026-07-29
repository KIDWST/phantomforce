import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const main = read("app/js/main.js");
const index = read("app/index.html");
const customizationClient = read("app/js/customization.js");
const customizationService = read("server/src/customization/customization-service.ts");
const workspaceProfiles = read("server/src/customization/workspace-profiles.ts");
const schemas = read("server/src/customization/schemas.ts");
const entitlements = read("server/src/access/entitlements.ts");
const localCustomers = read("server/src/access/local-customer-accounts.ts");
const clientSetup = read("app/js/clientsetup.js");
const clientSetupServer = read("server/src/client-setup/client-setup-store.ts");

assert.match(main, /starter: null/u, "Customer navigation tiers must be open by default.");
assert.match(main, /function navFeatureDisabled\(item\) \{\s*return false;\s*\}/u, "Plan limits must not render customer nav items as disabled.");
assert.match(main, /function isDeveloperTier\(\) \{\s*return false;\s*\}/u, "Customer plans must not unlock the owner Developer surface.");
assert.match(main, /openNavTabs = new Set\(\[[\s\S]*"planner"[\s\S]*"phantomplay"/u, "PhantomPlay and Planner must be normal working-set tabs.");
assert.match(index, /data-nav-id="phantomplay"[^>]*>PhantomPlay</u, "Command rail must expose PhantomPlay as a visible clickable module.");

assert.match(customizationClient, /phantomplay[\s\S]*forceEnabled: true[\s\S]*accessMode: "entire_organization"/u, "Frontend customization fallback must force PhantomPlay open.");
assert.match(customizationClient, /if \(moduleId === "phantomplay"\) return true;/u, "Frontend access checks must not preserve selected-member PhantomPlay locks.");

assert.match(customizationService, /if \(moduleId === "phantomplay"\) return true;/u, "Server defaults must enable PhantomPlay.");
assert.match(customizationService, /accessMode: "entire_organization"/u, "Server defaults must not create owner-only PhantomPlay.");
assert.match(customizationService, /module\.id === "phantomplay"[\s\S]*enabled: true[\s\S]*accessMode: "entire_organization"/u, "Stored config repair must unlock old PhantomPlay modules.");

for (const profile of ["athlete", "coach", "sports_management", "business"]) {
  assert.match(workspaceProfiles, new RegExp(`${profile}[\\s\\S]*phantomplay`, "u"), `${profile} profile must include PhantomPlay.`);
}
assert.match(schemas, /"athlete", "coach", "sports_management"/u, "Workspace profile schema must allow sports workspace choices.");

assert.match(entitlements, /CUSTOMER_SWITCHABLE_PLAN_KEYS = new Set\(\["starter", "professional", "elite"\]\)/u, "Customer plan picker must be Basic, Pro, Elite.");
assert.match(localCustomers, /DEFAULT_LOCAL_CUSTOMER_PLAN_KEY = "starter"/u, "New customers must start on Basic.");

for (const template of ["athlete", "coach", "sports_management"]) {
  assert.match(clientSetup, new RegExp(`key: "${template}"`, "u"), `${template} local setup template must exist.`);
  assert.match(clientSetupServer, new RegExp(`key: "${template}"`, "u"), `${template} server setup template must exist.`);
}

console.log("PhantomPlay unlocked workspace checks passed.");
