/*
 * Proves the customer-app tier simulator uses real plan keys and real
 * restrictions: Free is view-only, Pro and Elite unlock writes, and switching
 * back to Free immediately blocks writes again. No server or Docker required.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const dir = mkdtempSync(join(tmpdir(), "pf-local-customer-plan-"));
process.env.NODE_ENV = "test";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_AUTH = "true";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_STORE = join(dir, "customer-auth.json");
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_EMAIL = "customer1@phantomforce.test";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_PASSWORD = "Customer1!TestPass";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_NAME = "Customer 1";
process.env.PHANTOMFORCE_LOCAL_CUSTOMER_SEED_BUSINESS = "Customer 1 Workspace";

const accounts = await import("../src/access/local-customer-accounts.js");

await accounts.initializeLocalCustomerAuthState();
const session = await accounts.loginLocalCustomer("customer1@phantomforce.test", "Customer1!TestPass");
assert(session, "customer1 can log in");

let summary = await accounts.getLocalCustomerPlanSummary(session!);
assert(summary?.entitlements.planKey === "free", "seed starts on Free Preview");
assert(summary?.entitlements.canWrite === false, "Free Preview is view-only");
assert(summary?.plans.map((plan) => plan.key).join(",") === "free,professional,elite", "customer can inspect exactly Free, Pro, and Elite");

const pro = await accounts.assignLocalCustomerPlan(session!, "professional");
assert(pro.ok === true, "customer1 can switch to Pro");
assert(pro.ok && pro.entitlements.planKey === "professional", "Pro is current after switch");
assert(pro.ok && pro.entitlements.canWrite === true, "Pro allows writes");
assert(pro.ok && pro.entitlements.features.competitorIntelligence === true, "Pro unlocks competitor intelligence");
assert(pro.ok && pro.entitlements.features.customDomains === false, "Pro keeps custom domains restricted");

const elite = await accounts.assignLocalCustomerPlan(session!, "elite");
assert(elite.ok === true, "customer1 can switch to Elite");
assert(elite.ok && elite.entitlements.planKey === "elite", "Elite is current after switch");
assert(elite.ok && elite.entitlements.canWrite === true, "Elite allows writes");
assert(
  elite.ok &&
    Object.entries(elite.entitlements.features).every(([key, value]) =>
      key === "modelTier" ? value === "advanced" : value === true,
    ),
  "Elite has no locked feature flags",
);

const free = await accounts.assignLocalCustomerPlan(session!, "free");
assert(free.ok === true, "customer1 can switch back to Free Preview");
assert(free.ok && free.entitlements.planKey === "free", "Free Preview is current after switch back");
assert(free.ok && free.entitlements.canWrite === false, "Free Preview blocks writes after switch back");

console.log(
  JSON.stringify(
    {
      ok: true,
      customer1Login: true,
      freeViewOnly: true,
      proUnlocksWrites: true,
      eliteUnlocksWrites: true,
      eliteHasNoLockedFeatures: true,
      switchBackRestricts: true,
      store: process.env.PHANTOMFORCE_LOCAL_CUSTOMER_STORE,
    },
    null,
    2,
  ),
);
