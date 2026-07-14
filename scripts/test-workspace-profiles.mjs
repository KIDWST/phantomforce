import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const profileSource = readFileSync(new URL("../server/src/customization/workspace-profiles.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../server/src/customization/customization-service.ts", import.meta.url), "utf8");
const schemaSource = readFileSync(new URL("../server/src/customization/schemas.ts", import.meta.url), "utf8");
const userAccountsSource = readFileSync(new URL("../server/src/access/user-accounts.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../server/src/index.ts", import.meta.url), "utf8");
const orgsSource = readFileSync(new URL("../app/js/orgs.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../app/js/store.js", import.meta.url), "utf8");
const customizationSource = readFileSync(new URL("../app/js/customization.js", import.meta.url), "utf8");

for (const profile of ["business", "creator", "developer"]) {
  assert.match(profileSource, new RegExp(`${profile}:\\s*\\{`, "u"), `${profile} workspace profile must be defined.`);
  assert.match(serverSource, new RegExp(`"${profile}"`, "u"), `${profile} must be accepted by the signup route.`);
  assert.match(mainSource, new RegExp(`value="${profile}"`, "u"), `${profile} must be selectable in the signup UI.`);
}

assert.match(profileSource, /developer:[\s\S]*enabledModules: \["dashboard", "planner", "phantomplay", "approvals", "settings", "customize"\]/u, "Developer profile must default to dev-focused modules only.");
for (const blocked of ["crm", "media", "sites", "money", "intelligence", "analytics", "automation"]) {
  assert.match(serviceSource, new RegExp(`const blocked = \\[[^\\]]*"${blocked}"`, "u"), `Developer validation must block ${blocked}.`);
}

assert.match(schemaSource, /workspaceProfile/u, "Organization policy schema must record workspace profile.");
assert.match(schemaSource, /apiCredentialPolicy/u, "Organization policy schema must record credential isolation.");
assert.match(schemaSource, /subscriptionPolicy/u, "Organization policy schema must record subscription isolation.");
assert.match(schemaSource, /historyPolicy/u, "Organization policy schema must record history policy.");
assert.match(schemaSource, /localBrainInstall/u, "Organization policy schema must record local brain install policy.");

assert.match(userAccountsSource, /registerWorkspaceAccount/u, "Database auth must expose self-serve workspace creation.");
assert.match(userAccountsSource, /role: "owner"/u, "Signup must make the creator an org owner.");
assert.match(userAccountsSource, /assignOrgPlan[\s\S]*planKey: "free"/u, "Signup must put new workspaces on the Free Preview plan.");
assert.match(readFileSync(new URL("../server/src/access/entitlements.ts", import.meta.url), "utf8"), /key: "free"[\s\S]*name: "Free Preview"/u, "Plan catalog must include the Free Preview plan.");
assert.match(userAccountsSource, /persistConfiguration/u, "Signup must persist profile-scoped workspace defaults.");
assert.match(serverSource, /app\.post\("\/auth\/signup"/u, "Server must expose a public signup endpoint.");

assert.match(orgsSource, /databaseSignup/u, "Frontend auth client must call signup.");
assert.match(orgsSource, /\/auth\/signup/u, "Frontend auth client must target the signup endpoint.");
assert.match(mainSource, /data-db-signup/u, "Customer gate must include create-workspace form.");
assert.match(mainSource, /No shared admin data, keys, subscriptions, or silent local installs/u, "Signup UI must communicate isolation policy.");
assert.match(storeSource, /ctx\.session\?\.database && !ctx\.session\?\.canManageAccess && ctx\.session\?\.orgId/u, "Tenant id must prefer active database org for non-platform users.");
assert.match(customizationSource, /apiCredentialPolicy: "tenant_owned_only"/u, "Local customization fallback must keep tenant-owned credential policy.");

console.log("Workspace profile signup and isolation checks passed.");
