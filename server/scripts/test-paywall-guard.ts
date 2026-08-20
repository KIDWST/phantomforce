/*
 * test-paywall-guard.ts — proves the paywall enforcement is un-bypassable.
 *
 * The classifier is FAIL CLOSED: views are free, known read-only POSTs are free,
 * and everything else that mutates needs write access. The preHandler 403s a
 * free (view-only) session on any write, lets it view, and lets owners write —
 * even when the free client calls the write API directly (no UI involved).
 *
 * Run: npx tsx scripts/test-paywall-guard.ts
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const { requiresWrite, makePaywallPreHandler } = await import("../src/access/paywall-guard.js");

// ---- classifier: views + read-only POSTs are free ----
assert(requiresWrite("GET", "/client-access-workflow") === false, "GET is free (view)");
assert(requiresWrite("HEAD", "/anything") === false, "HEAD is free");
assert(requiresWrite("POST", "/auth/demo-login") === false, "login is free");
assert(requiresWrite("POST", "/phantom-ai/security/scan/preview") === false, "preview is free");
assert(requiresWrite("POST", "/phantom-ai/hermes/interaction-memory/persist-preview") === false, "persist-preview is free");
assert(requiresWrite("POST", "/client-provisioning/dry-run") === false, "dry-run is free");
assert(requiresWrite("POST", "/actions/validate") === false, "validate is free");
assert(requiresWrite("POST", "/falcon/jobs/validate") === false, "falcon validate is free");
assert(requiresWrite("POST", "/phantom-ai/chat") === false, "chat view is free");
assert(requiresWrite("POST", "/api/phantomplay/ai-edit") === false, "loopback-gated PhantomPlay desktop edit bypasses account paywall");
assert(requiresWrite("POST", "/api/phantomplay/ai-edit?provider=codex") === false, "PhantomPlay desktop edit query variants bypass account paywall");

// ---- classifier: real mutations require write ----
assert(requiresWrite("POST", "/client-access/abc/status/propose") === true, "propose needs write");
assert(requiresWrite("POST", "/client-access-approvals/xyz/decision") === true, "approval decision needs write");
assert(requiresWrite("POST", "/client-provisioning/propose") === true, "provisioning propose needs write");
assert(requiresWrite("POST", "/phantom-ai/ops/chicagoshots/proposal-history/save") === true, "save needs write");
assert(requiresWrite("PATCH", "/phantom-ai/ops/chicagoshots/proposal-history/7/status") === true, "status change needs write");
assert(requiresWrite("POST", "/phantom-ai/agents/actions/run") === true, "action run needs write");
assert(requiresWrite("POST", "/client-access-workflow/snapshot") === true, "snapshot needs write");
assert(requiresWrite("DELETE", "/anything") === true, "DELETE needs write");
assert(requiresWrite("POST", "/some/brand-new/write-route") === true, "unknown mutation needs write (fail closed)");
assert(requiresWrite("POST", "/api/phantomplay/ai-edit/anything") === true, "only the exact PhantomPlay desktop edit route is exempt");

// ---- preHandler behaviour ----
const freeSession = { id: "gateway:member@acme.com" };            // signed in, view only
const ownerSession = { id: "owner-admin", canManageAccess: true }; // full access

function fakeReply() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    code(c: number) { this.statusCode = c; return this; },
    send(b: unknown) { this.body = b; return this; },
  };
}

const asFree = makePaywallPreHandler(() => freeSession);
const asOwner = makePaywallPreHandler(() => ownerSession);
const asAnon = makePaywallPreHandler(() => null);

// free session hitting a write endpoint directly (bypassing any UI) is refused
let r = fakeReply();
await asFree({ method: "POST", url: "/client-access/abc/status/propose", headers: {} } as never, r as never);
assert(r.statusCode === 403, "free member is 403'd on a write endpoint");
assert((r.body as { error?: string })?.error === "read_only_plan", "403 says read_only_plan");

// free session may still VIEW
r = fakeReply();
await asFree({ method: "GET", url: "/client-access-workflow", headers: {} } as never, r as never);
assert(r.statusCode === 0, "free member is NOT blocked from viewing");

// free session may still hit a read-only preview
r = fakeReply();
await asFree({ method: "POST", url: "/phantom-ai/security/scan/preview", headers: {} } as never, r as never);
assert(r.statusCode === 0, "free member is NOT blocked from a read-only preview");

// Native PhantomPlay has no account bearer token. The route itself applies a
// loopback-only gate, so this global paywall must allow the request to reach it.
r = fakeReply();
await asAnon({ method: "POST", url: "/api/phantomplay/ai-edit", headers: {} } as never, r as never);
assert(r.statusCode === 0, "anonymous local desktop edit is NOT rejected before its route-level loopback gate");

// owner may write
r = fakeReply();
await asOwner({ method: "POST", url: "/client-access/abc/status/propose", headers: {} } as never, r as never);
assert(r.statusCode === 0, "owner is NOT blocked from writing");

// anonymous caller hitting a write is refused
r = fakeReply();
await asAnon({ method: "POST", url: "/client-access/abc/status/propose", headers: {} } as never, r as never);
assert(r.statusCode === 401, "anonymous caller is 401'd on a write endpoint");

console.log(
  JSON.stringify(
    {
      ok: true,
      failClosedClassifier: true,
      freeMemberWriteBlocked: true,
      freeMemberCanViewAndPreview: true,
      ownerCanWrite: true,
      anonWriteBlocked: true,
      anonWriteStatus: 401,
      phantomPlayDesktopBridgeReachesRouteGate: true,
      directApiBypassBlocked: true,
    },
    null,
    2,
  ),
);
