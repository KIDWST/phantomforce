import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const localCustomers = read("server/src/access/local-customer-accounts.ts");
const server = read("server/src/index.ts");
const entitlements = read("server/src/access/entitlements.ts");
const orgs = read("app/js/orgs.js");
const settings = read("app/js/settings.js");
const main = read("app/js/main.js");
const packageJson = read("package.json");

assert.match(entitlements, /key: "free"[\s\S]*name: "Legacy Preview"[\s\S]*isInternal: true/u,
  "The removed free tier must remain compatibility-only.");
assert.match(entitlements, /key: "starter"[\s\S]*name: "Basic"[\s\S]*isInternal: false/u,
  "Basic must be the public starting plan.");
assert.match(entitlements, /name: "Pro"[\s\S]*competitorIntelligence: true[\s\S]*aggressiveIntelligence: false/u,
  "Pro must expose useful business intelligence without aggressive intelligence.");
assert.match(entitlements, /name: "Elite"[\s\S]*customDomains: true[\s\S]*advancedWorkflows: true/u,
  "Elite must unlock the advanced operator tier.");
assert.match(entitlements, /key: "developer"[\s\S]*isInternal: true/u,
  "Developer must be a workspace identity, not a public payment tier.");
assert.match(entitlements, /key: "enterprise"[\s\S]*isInternal: true/u,
  "Enterprise compatibility must not add a fourth public payment plan.");
assert.match(entitlements, /CUSTOMER_SWITCHABLE_PLAN_KEYS = new Set\(\["starter", "professional", "elite"\]\)/u,
  "Customer tier switching must expose only Basic, Pro, and Elite.");

assert.match(localCustomers, /listCustomerPlanDefinitions\(\)/u,
  "Customer tier switching must expose public plans only.");
assert.match(localCustomers, /export function listLocalCustomerPlanDefinitions\(\)/u,
  "Local customer accounts must list public test plans.");
assert.match(localCustomers, /export async function getLocalCustomerPlanSummary\(session: AccessSession\)/u,
  "Local customer accounts must resolve backend entitlement summaries.");
assert.match(localCustomers, /export async function assignLocalCustomerPlan\(session: AccessSession, planKey: string\)/u,
  "Local customer accounts must be able to switch test tiers.");
assert.match(localCustomers, /planKey: DEFAULT_LOCAL_CUSTOMER_PLAN_KEY/u,
  "New local customer accounts must start on a deterministic default plan.");
assert.doesNotMatch(localCustomers, /planKey:\s*"internal"/u,
  "Customer test accounts must not default to the internal admin plan.");

assert.match(server, /app\.get\("\/customer\/plan-preview"/u,
  "Backend must expose a customer plan preview read endpoint.");
assert.match(server, /app\.post\("\/customer\/plan-preview"/u,
  "Backend must expose a customer plan switching endpoint.");
assert.match(server, /getLocalCustomerPlanSummary\(session\)/u,
  "Auth/me must include local customer entitlement truth.");
assert.match(server, /Customer plan testing is only available on the customer app/u,
  "Customer plan switching must not run from admin.phantomforce.online.");

assert.match(orgs, /export async function fetchCustomerPlanPreview\(\)/u,
  "Frontend org client must read customer plan preview.");
assert.match(orgs, /export async function switchCustomerPlan\(planKey\)/u,
  "Frontend org client must switch local customer tiers.");
assert.match(orgs, /if \(ctx\.session\?\.localCustomer\) return fetchCustomerPlanPreview\(\);/u,
  "Local customer entitlement summaries must not return null.");

assert.match(settings, /id: "plan", label: "Plan & access", category: "Workspace"/u,
  "Settings must own plan and entitlement testing.");
assert.match(settings, /data-plan-switch="\$\{esc\(plan\.key\)\}"/u,
  "Settings must render public tier switch controls.");
assert.match(settings, /Switch Basic, Pro, and Elite instantly\. Workspace type is configured separately/u,
  "Settings must separate workspace identity from billing.");

assert.match(main, /const FEATURE_BY_NAV_ID = \{/u,
  "Navigation must know which workspace features are plan-gated.");
assert.match(main, /const PLAN_NAV_WORKFLOWS = \{/u,
  "Navigation must define tier-specific workspace workflows.");
assert.match(main, /starter: null/u,
  "Basic users must see the whole ecosystem; tier differences are enforced by limits, not hidden tabs.");
assert.match(main, /const PROFILE_NAV_WORKFLOWS = \{[\s\S]*developer: new Set\([\s\S]*"developer"[\s\S]*"phantomstore"/u,
  "Developer workspace identity must control builder navigation.");
assert.match(main, /return \{ label: "Phantom", detail: "Owner mode · all modules · safe self-editing", tone: "active" \};/u,
  "Owner/admin access must display the hidden Phantom tier, not a customer plan.");
assert.match(main, /function isDeveloperTier\(\) \{\s*return false;\s*\}/u,
  "Developer Mode must stay owner-only instead of following a customer workspace identity.");
assert.match(main, /workspaceProfileChoices\("business"\)/u,
  "Signup must ask which workspace the user wants.");
assert.match(main, /function navFeatureDisabled\(item\) \{\s*return false;\s*\}/u,
  "Customer tabs must stay clickable; usage restrictions belong inside the workspace, not the nav.");
assert.match(main, /data-open-ws="settings"[\s\S]*No real work loaded yet\./u,
  "Empty setup must route to Settings instead of Clients.");
assert.doesNotMatch(main, /data-open-ws="leads"[\s\S]*No real work loaded yet\./u,
  "Empty setup must not send users to the client pipeline.");

assert.match(packageJson, /"test:customer-plan-switching": "node scripts\/test-customer-plan-switching\.mjs"/u,
  "Package scripts must expose the customer plan switching guard.");

console.log("Customer plan switching checks passed.");
