/*
 * test-subscription.ts — proves the trusted subscription path end to end.
 *
 * A signed-in gateway account is view-only until the OWNER grants a subscription;
 * once granted (server-side, case-insensitive), that account's session resolves
 * subscriptionActive=true and the paywall lets it write. Revoking flips it back.
 * Uses a throwaway data dir so it never touches real state. No server, no network.
 *
 * Run: npx tsx scripts/test-subscription.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const dir = mkdtempSync(join(tmpdir(), "pf-sub-"));
process.env.PHANTOMFORCE_ACCESS_DATA_DIR = dir;
process.env.NODE_ENV = "test";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "gateway-forwarded";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "false";
process.env.PHANTOMFORCE_GATEWAY_SHARED_SECRET = "sub-test-secret-0123456789";
process.env.PHANTOMFORCE_GATEWAY_USER_HEADER = "remote-user";
process.env.PHANTOMFORCE_GATEWAY_SECRET_HEADER = "x-phantomforce-gateway";
process.env.PHANTOMFORCE_GATEWAY_CLIENT_MAP = "paid@acme.com=client-chicagoshots,free@acme.com=client-past-due";

const store = await import("../src/access/subscription-store.js");
const session = await import("../src/access/session.js");
const { canWrite } = await import("../src/access/paywall.js");

const SECRET = "sub-test-secret-0123456789";
const req = (user: string): any => ({ headers: { "x-phantomforce-gateway": SECRET, "remote-user": user } });

// unpaid gateway account: signed in, view only
let s = session.resolveAccessSession(req("free@acme.com"));
assert(s !== undefined, "gateway session resolves");
assert(s!.subscriptionActive === false, "unpaid account -> subscriptionActive false");
assert(canWrite(s) === false, "unpaid account cannot write");

// owner grants a subscription (case-insensitive email)
store.setSubscription({ email: "PAID@acme.com", active: true, source: "owner-grant" });
assert(store.isSubscriptionActive("paid@acme.com") === true, "granted subscription is active");

// that account's session is now pro and may write
s = session.resolveAccessSession(req("paid@acme.com"));
assert(s!.subscriptionActive === true, "paid account -> subscriptionActive true");
assert(canWrite(s) === true, "paid account CAN write");

// other accounts are unaffected
assert(canWrite(session.resolveAccessSession(req("free@acme.com"))) === false, "free account still view-only");

// revoke -> back to view only
store.setSubscription({ email: "paid@acme.com", active: false, source: "owner-grant" });
assert(canWrite(session.resolveAccessSession(req("paid@acme.com"))) === false, "revoked -> view only again");

assert(store.listSubscriptions().length === 1, "one subscription record persisted");

console.log(
  JSON.stringify(
    {
      ok: true,
      unpaidViewOnly: true,
      ownerGrantUnlocksWrite: true,
      caseInsensitive: true,
      revokeReverts: true,
      others_unaffected: true,
    },
    null,
    2,
  ),
);
