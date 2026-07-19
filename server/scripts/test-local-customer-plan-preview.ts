/*
 * Proves the customer-app tier simulator uses real plan keys and real
 * restrictions: Free/starter is view-only, Elite unlocks writes, and switching
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
assert(summary?.entitlements.planKey === "starter", "seed starts on Starter");
assert(summary?.entitlements.canWrite === false, "Starter is view-only");

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

const free = await accounts.assignLocalCustomerPlan(session!, "starter");
assert(free.ok === true, "customer1 can switch back to Starter");
assert(free.ok && free.entitlements.planKey === "starter", "Starter is current after switch back");
assert(free.ok && free.entitlements.canWrite === false, "Starter blocks writes after switch back");

console.log(
  JSON.stringify(
    {
      ok: true,
      customer1Login: true,
      freeViewOnly: true,
      eliteUnlocksWrites: true,
      eliteHasNoLockedFeatures: true,
      switchBackRestricts: true,
      store: process.env.PHANTOMFORCE_LOCAL_CUSTOMER_STORE,
    },
    null,
    2,
  ),
);
