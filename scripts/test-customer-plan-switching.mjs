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

assert.match(entitlements, /name: "Free"[\s\S]*websitePublishing: false[\s\S]*customDomains: false/u,
  "Free must clearly restrict publishing and custom domains.");
assert.match(entitlements, /name: "Pro"[\s\S]*competitorIntelligence: true[\s\S]*aggressiveIntelligence: false/u,
  "Pro must expose useful business intelligence without aggressive intelligence.");
assert.match(entitlements, /name: "Elite"[\s\S]*customDomains: true[\s\S]*advancedWorkflows: true/u,
  "Elite must unlock the advanced operator tier.");
assert.match(entitlements, /name: "Enterprise"[\s\S]*businesses: 25/u,
  "Enterprise must stay available for full-access customer testing.");

assert.match(localCustomers, /PLAN_DEFINITIONS\.filter\(\(plan\) => !plan\.isInternal\)/u,
  "Customer tier switching must expose public plans only.");
assert.match(localCustomers, /export function listLocalCustomerPlanDefinitions\(\)/u,
  "Local customer accounts must list public test plans.");
assert.match(localCustomers, /export async function getLocalCustomerPlanSummary\(session: AccessSession\)/u,
  "Local customer accounts must resolve backend entitlement summaries.");
assert.match(localCustomers, /export async function assignLocalCustomerPlan\(session: AccessSession, planKey: string\)/u,
  "Local customer accounts must be able to switch test tiers.");
assert.match(localCustomers, /export async function loginLocalCustomer\(emailRaw: string, password: string\)/u,
  "Local customer accounts must have a login primitive.");
assert.match(localCustomers, /export async function registerLocalCustomer\(input: LocalCustomerRegisterInput\)/u,
  "Local customer accounts must have a registration primitive.");
assert.match(localCustomers, /export async function requestLocalCustomerPasswordReset\(emailRaw: string\)/u,
  "Local customer accounts must have a password-reset request primitive.");
assert.match(localCustomers, /planKey: DEFAULT_LOCAL_CUSTOMER_PLAN_KEY/u,
  "New local customer accounts must start on a deterministic default plan.");
assert.doesNotMatch(localCustomers, /planKey:\s*"internal"/u,
  "Customer test accounts must not default to the internal admin plan.");

assert.match(server, /app\.get\("\/customer\/plan-preview"/u,
  "Backend must expose a customer plan preview read endpoint.");
assert.match(server, /app\.post\("\/customer\/plan-preview"/u,
  "Backend must expose a customer plan switching endpoint.");
assert.match(server, /app\.post\("\/auth\/customer-login"/u,
  "Backend must expose a local customer login route without replacing database /auth/login.");
assert.match(server, /app\.post\("\/auth\/customer-signup"/u,
  "Backend must expose a local customer registration route.");
assert.match(server, /app\.post\("\/auth\/customer-forgot-password"/u,
  "Backend must expose a local customer password reset request route.");
assert.match(server, /app\.post\("\/auth\/customer-reset-password"/u,
  "Backend must expose a local customer password reset completion route.");
assert.match(server, /customerLoginEndpoint[\s\S]*\/auth\/customer-login/u,
  "/sessions must advertise the local customer login endpoint on customer/local hosts.");
assert.match(server, /customerAuthForbiddenOnHost\(request\)[\s\S]*localCustomerHostDenied/u,
  "Local customer account routes must be denied on admin.phantomforce.online.");
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
assert.match(orgs, /customerAuthEndpoint\("customerLoginEndpoint", "\/auth\/login"\)/u,
  "Frontend login must use the customer login endpoint advertised by /sessions.");
assert.match(orgs, /customerAuthEndpoint\("customerSignupEndpoint", "\/auth\/signup"\)/u,
  "Frontend signup must use the customer signup endpoint advertised by /sessions.");

assert.match(settings, /id: "plan", label: "Plan & access", category: "Workspace"/u,
  "Settings must own plan and entitlement testing.");
assert.match(settings, /data-plan-switch="\$\{esc\(plan\.key\)\}"/u,
  "Settings must render public tier switch controls.");
assert.match(settings, /Customer test mode: switch tiers instantly/u,
  "Settings must make clear this is a safe customer tier simulator.");

assert.match(main, /const FEATURE_BY_NAV_ID = \{/u,
  "Navigation must know which workspace features are plan-gated.");
assert.match(main, /!ctx\.session\?\.database && !ctx\.session\?\.localCustomer/u,
  "Plan gating must include local customer sessions.");
assert.match(main, /localCustomerMode = !databaseMode && !!auth\?\.localCustomerAuthEnabled/u,
  "Customer app login gate must render when local customer auth is enabled without database auth.");
assert.match(main, /localStorage\.setItem\("pf\.settings\.tab\.v1", "plan"\)/u,
  "Clicking a locked nav item must open Plan & access.");
assert.match(main, /data-open-ws="settings"[\s\S]*No real work loaded yet\./u,
  "Empty setup must route to Settings instead of Clients.");
assert.doesNotMatch(main, /data-open-ws="leads"[\s\S]*No real work loaded yet\./u,
  "Empty setup must not send users to the client pipeline.");

assert.match(packageJson, /"test:customer-plan-switching": "node scripts\/test-customer-plan-switching\.mjs"/u,
  "Package scripts must expose the customer plan switching guard.");
assert.match(packageJson, /"test:local-customer-auth": "npm run test:local-customer-auth --workspace @phantomforce\/server"/u,
  "Package scripts must expose the local customer auth route test.");

console.log("Customer plan switching checks passed.");
