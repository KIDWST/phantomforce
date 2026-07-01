/*
 * test-paywall.ts — proves the dashboard subscription gate.
 *
 * Free launch (default): every signed-in account is entitled, the paywall is
 * "open", anonymous callers are refused. Paid mode: members are blocked until a
 * subscription exists, operator/owner always gets in. Pure unit test, no server.
 *
 * Run: npx tsx scripts/test-paywall.ts
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const { getPaywallState, isEntitled } = await import("../src/access/paywall.js");

const member = { id: "gateway:member@acme.com" };
const owner = { id: "owner-admin", canManageAccess: true };

// ---- default: FREE launch ----
delete process.env.PHANTOM_PAYWALL_MODE;
const free = getPaywallState(member);
assert(free.mode === "free", "defaults to free mode");
assert(free.open === true, "paywall is open during free launch");
assert(free.entitled === true, "signed-in member is entitled while free");
assert(free.tier === "free", "member tier is free");

assert(getPaywallState(null).entitled === false, "anonymous caller is not entitled (fail closed)");
assert(getPaywallState(null).open === true, "paywall still reports open in free mode even for anon");
assert(getPaywallState(owner).entitled === true, "owner is entitled in free mode");

// ---- flip to PAID enforcement ----
process.env.PHANTOM_PAYWALL_MODE = "paid";
const paidMember = getPaywallState(member);
assert(paidMember.mode === "paid", "paid mode reported");
assert(paidMember.open === false, "paywall is closed in paid mode");
assert(paidMember.entitled === false, "member without a subscription is blocked in paid mode");

assert(getPaywallState(owner).entitled === true, "owner still gets in under paid mode");
assert(getPaywallState({ id: "sub", subscriptionActive: true }).entitled === true, "active subscriber is entitled");
assert(isEntitled(null) === false, "anonymous caller blocked in paid mode");

// restore default so nothing leaks
delete process.env.PHANTOM_PAYWALL_MODE;

console.log(
  JSON.stringify(
    {
      ok: true,
      freeLaunch: { mode: free.mode, open: free.open, memberEntitled: free.entitled },
      paidMode: { open: paidMember.open, memberBlocked: !paidMember.entitled, ownerEntitled: true, subscriberEntitled: true },
      anonymousFailClosed: true,
    },
    null,
    2,
  ),
);
