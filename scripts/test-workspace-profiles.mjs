import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const profileSource = read("server/src/customization/workspace-profiles.ts");
const schemaSource = read("server/src/customization/schemas.ts");
const userAccountsSource = read("server/src/access/user-accounts.ts");
const localAccountsSource = read("server/src/access/local-customer-accounts.ts");
const entitlementsSource = read("server/src/access/entitlements.ts");
const serverSource = read("server/src/index.ts");
const orgsSource = read("app/js/orgs.js");
const mainSource = read("app/js/main.js");
const tenantProviderSource = read("server/src/access/tenant-provider-connections.ts");

for (const profile of ["business", "athlete", "coach", "sports_management", "creator", "developer", "agency", "education"]) {
  assert.match(profileSource, new RegExp(`${profile}:\\s*\\{`, "u"), `${profile} workspace profile must be defined.`);
  assert.match(mainSource, new RegExp(`id:\\s*"${profile}"`, "u"), `${profile} must be selectable in the workspace chooser.`);
}
assert.match(serverSource, /CustomerWorkspaceProfileSchema = WorkspaceProfileSchema/u, "Signup must accept every workspace profile through the shared schema.");

assert.match(profileSource, /athlete:[\s\S]*"crm"[\s\S]*"media"[\s\S]*"analytics"[\s\S]*"phantomplay"/u, "Athlete workspaces must include recruiting, media, analytics, and PhantomPlay.");
assert.match(profileSource, /sports_management:[\s\S]*"money"[\s\S]*"phantomplay"/u, "Sports management workspaces must include accounting visibility and PhantomPlay.");
assert.match(profileSource, /developer:[\s\S]*"phantomplay"[\s\S]*"phantomstore"/u, "Developer workspaces must include Play and Store.");
assert.match(schemaSource, /z\.enum\(\["business", "athlete", "coach", "sports_management", "creator", "developer", "agency", "education"\]\)/u, "Customization schema must enforce the workspace identities.");

assert.match(userAccountsSource, /workspaceProfile\?: WorkspaceProfileId/u, "Database signup must accept workspace identity.");
assert.match(userAccountsSource, /defaultOrganizationConfiguration\(result\.org\.id, email, profile\.id\)/u, "Database signup must persist profile-scoped defaults.");
assert.match(userAccountsSource, /planKey: "starter"/u, "New database workspaces must start on Basic.");
assert.match(localAccountsSource, /workspaceProfile\?: WorkspaceProfileId/u, "Local customer accounts must persist workspace identity.");
assert.match(serverSource, /workspaceProfile: CustomerWorkspaceProfileSchema\.default\("business"\)/u, "Both signup paths must validate workspace identity.");

assert.match(entitlementsSource, /CUSTOMER_SWITCHABLE_PLAN_KEYS = new Set\(\["starter", "professional", "elite"\]\)/u, "Only Basic, Pro, and Elite may be customer-switchable.");
assert.match(entitlementsSource, /key: "free"[\s\S]*isInternal: true/u, "Free must remain compatibility-only.");
assert.match(entitlementsSource, /key: "developer"[\s\S]*isInternal: true/u, "Developer must not remain a payment method.");

assert.match(mainSource, /What workspace do you want\?/u, "Signup and first-run setup must ask one clear workspace question.");
assert.match(mainSource, /name="workspaceProfile"/u, "Workspace choices must submit as structured data.");
assert.match(mainSource, /workspaceProfile,\s*\n\s*\}\)/u, "Signup must send workspace identity to the account API.");
assert.match(mainSource, /const PROFILE_NAV_WORKFLOWS = \{/u, "Navigation must customize itself by workspace identity.");
assert.match(mainSource, /function isDeveloperTier\(\) \{\s*return false;\s*\}/u, "Developer Mode must stay owner-only and not depend on billing or workspace choice.");
assert.match(orgsSource, /workspaceProfile: payload\.workspaceProfile/u, "The local signup adapter must preserve workspace identity.");

assert.match(tenantProviderSource, /SECRET_PATTERN/u, "Provider connection storage must reject raw-looking secrets.");
assert.match(tenantProviderSource, /secretStored: false/u, "Provider connection storage must never report storing secrets.");

console.log("Workspace identity and billing separation checks passed.");
