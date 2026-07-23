import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CANONICAL_OPERATION_STATUSES,
  createLatestOperation,
  createRouteRegistry,
  createScopedSelection,
  knownCount,
  normalizeOperationStatus,
  operationStatusMeta,
  productStateHtml,
  validateActionReceipt,
} from "../app/js/product-grammar.js";
import {
  ActionReceiptSchema,
  parseActionReceipt,
} from "../packages/contracts/dist/product-grammar.js";

assert.equal(new Set(CANONICAL_OPERATION_STATUSES).size, CANONICAL_OPERATION_STATUSES.length);
assert.equal(normalizeOperationStatus("running"), "executing");
assert.equal(normalizeOperationStatus("pending_approval"), "needs-approval");
assert.equal(normalizeOperationStatus("published"), "verifying", "Unverified terminal claims must remain in verification.");
assert.equal(normalizeOperationStatus("published", { verified: true }), "published");
assert.equal(operationStatusMeta("failed").terminal, true);
assert.equal(operationStatusMeta("something-new").status, "unknown");
assert.deepEqual(knownCount(null), { known: false, value: null, label: "—" }, "Unknown counts must never become zero.");
assert.equal(knownCount(0).known, true);
assert.equal(knownCount(0).label, "0");

const stateHtml = productStateHtml("loading", { detail: "Loading the active organization." });
assert.match(stateHtml, /role="status"/);
assert.match(stateHtml, /aria-busy="true"/);
assert.doesNotMatch(productStateHtml("empty", { actionLabel: "Unsafe", actionAttribute: "onclick=alert(1)" }), /onclick=/);

const selection = createScopedSelection("org-a");
selection.add("contact-1");
assert.equal(selection.first(), "contact-1");
assert.equal(selection.switchScope("org-b"), true);
assert.equal(selection.first(), "", "Selections must clear across organization boundaries.");

const routes = createRouteRegistry([{ id: "dashboard", title: "Dashboard" }, { id: "workforce", title: "Workforce" }], { brain: "workforce" });
assert.equal(routes.resolve("brain")?.id, "workforce");
assert.equal(routes.recover("missing"), "dashboard");
assert.throws(() => routes.register({ title: "Missing id" }), /Route id is required/);

let releaseFirst;
const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
const owner = createLatestOperation("test-owner");
const first = owner.run(async () => {
  await firstBlocked;
  return "old";
});
const second = owner.run(async () => "new");
assert.deepEqual(await second.then((result) => ({ ok: result.ok, value: result.value })), { ok: true, value: "new" });
releaseFirst();
assert.equal((await first).stale, true, "A superseded response must not own state.");

const baseReceipt = {
  id: "receipt-1",
  actor: { type: "agent", id: "phantom" },
  orgId: "org-1",
  workspaceId: "workspace-1",
  module: "sites",
  objectType: "site",
  objectId: "site-1",
  action: "publish",
  timestamp: "2026-07-23T12:00:00.000Z",
  nextState: { status: "published" },
  status: "published",
  verification: {
    status: "verified",
    checkedAt: "2026-07-23T12:00:01.000Z",
    method: "http",
    summary: "Public URL returned the expected build.",
    references: ["https://example.test"],
  },
  summary: "Published and verified the site.",
};
assert.equal(ActionReceiptSchema.parse(baseReceipt).status, "published");
assert.equal(parseActionReceipt(baseReceipt).status, "published");
assert.throws(
  () => parseActionReceipt({ ...baseReceipt, verification: { ...baseReceipt.verification, status: "unverified" } }),
  /requires verified evidence/,
);
assert.equal(validateActionReceipt(baseReceipt).ok, true);
assert.equal(validateActionReceipt({ ...baseReceipt, verification: { ...baseReceipt.verification, status: "unverified" } }).ok, false);

const mainSource = fs.readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const workspaceSource = fs.readFileSync(new URL("../app/js/workspaces.js", import.meta.url), "utf8");
const pulseSource = fs.readFileSync(new URL("../app/js/organizationpulse.js", import.meta.url), "utf8");
assert.match(mainSource, /createRouteRegistry[\s\S]*ROUTE_REGISTRY\.register[\s\S]*ROUTE_REGISTRY\.has/u);
assert.match(mainSource, /history\.replaceState\(null,\s*["']["']?,?\s*["']#page\/dashboard["']\)|history\.replaceState\(null,\s*[""],\s*["']#page\/dashboard["']\)/u);
assert.match(workspaceSource, /createScopedSelection[\s\S]*syncCrmSelectionScope\(ws\)[\s\S]*productStateHtml\("empty"/u);
assert.match(pulseSource, /createLatestOperation[\s\S]*signal:\s*request\.signal[\s\S]*request\.isCurrent\(\)/u);

console.log("Product grammar contract passed: canonical statuses, receipts, routing, scoped selection, accessible states, and stale-response ownership.");
