/*
 * test-paywall.ts — proves the server-side dashboard entitlement gate.
 *
 * Free plan = VIEW ONLY: signed-in members can view but every write is refused.
 * Owner and active subscribers may write. Anonymous callers fail closed. An
 * optional PHANTOM_FREE_WRITE promo can open writes to everyone. No server, no
 * network — pure unit test of the gate logic.
 *
 * Run: npx tsx scripts/test-paywall.ts
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const { getPaywallDecision, canWrite, isEntitled } = await import("../src/access/paywall.js");

const member = { id: "gateway:member@acme.com" };
const owner = { id: "owner-admin", canManageAccess: true };
const subscriber = { id: "gateway:pro@acme.com", subscriptionActive: true };

delete process.env.PHANTOM_FREE_WRITE;

// ---- anonymous: fail closed ----
assert(getPaywallDecision(null).entitled === false, "anon not entitled");
assert(getPaywallDecision(null).canView === false, "anon cannot view");
assert(getPaywallDecision(null).canWrite === false, "anon cannot write");
assert(getPaywallDecision({ id: "" }).entitled === false, "empty id fails closed");

// ---- free member: view only ----
const free = getPaywallDecision(member);
assert(free.entitled === true, "signed-in member is entitled (can enter)");
assert(free.canView === true, "free member can view");
assert(free.canWrite === false, "free member CANNOT write (view only)");
assert(free.tier === "free", "free member is free tier");
assert(canWrite(member) === false, "canWrite() false for free member");

// ---- owner + subscriber: full access ----
assert(canWrite(owner) === true, "owner can write");
assert(getPaywallDecision(owner).tier === "pro", "owner is pro tier");
assert(canWrite(subscriber) === true, "active subscriber can write");
assert(getPaywallDecision(subscriber).tier === "pro", "subscriber is pro tier");

// ---- optional free-write promo opens writes to all signed-in ----
process.env.PHANTOM_FREE_WRITE = "true";
assert(canWrite(member) === true, "promo grants write to a free member");
assert(isEntitled(null) === false, "promo still fails closed for anon");
delete process.env.PHANTOM_FREE_WRITE;
assert(canWrite(member) === false, "write closes again once promo is off");

console.log(
  JSON.stringify(
    {
      ok: true,
      freeMember: { entitled: free.entitled, canView: free.canView, canWrite: free.canWrite, tier: free.tier },
      ownerCanWrite: true,
      subscriberCanWrite: true,
      anonFailClosed: true,
      promoTogglesWrite: true,
    },
    null,
    2,
  ),
);
