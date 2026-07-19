import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent {};

const { ctx, store, moneyView } = await import("../app/js/store.js?v=organization-record-isolation");
store.state.finance.connectors = [
  { id: "bank", type: "bank", name: "Bank account", provider: "Plaid", status: "requested", ws: "org-a" },
];
store.state.finance.transactions = [
  { id: "a", ws: "org-a", date: "2026-07-18", description: "Alpha", amount: 100, category: "Sales income", account: "A", source: "manual" },
  { id: "b", ws: "org-b", date: "2026-07-18", description: "Beta", amount: 200, category: "Sales income", account: "B", source: "manual" },
];

ctx.session = { role: "admin", database: true, orgId: "org-a" };
const alpha = moneyView();
assert.deepEqual(alpha.transactions.map((item) => item.description), ["Alpha"]);
assert.equal(alpha.connectors.find((item) => item.id === "bank")?.status, "requested");

ctx.session = { role: "admin", database: true, orgId: "org-b" };
const beta = moneyView();
assert.deepEqual(beta.transactions.map((item) => item.description), ["Beta"]);
assert.equal(beta.connectors.find((item) => item.id === "bank")?.status, "not-connected");

const root = new URL("../", import.meta.url);
for (const file of [
  "server/src/crm/crm-pipeline-store.ts",
  "server/src/proposals/proposal-store.ts",
  "server/src/workspace-approvals/workspace-approval-store.ts",
]) {
  const source = readFileSync(new URL(file, root), "utf8");
  assert.match(source, /ws:\s*safeTenantId\(tenantId\)/u, `${file} must derive ws from the authenticated tenant.`);
  assert.doesNotMatch(source, /ws:\s*cleanText\(source\.ws/u, `${file} must not trust a client-supplied ws label.`);
}

const workspaces = readFileSync(new URL("app/js/workspaces.js", root), "utf8");
assert.match(workspaces, /proposal\.ws !== tenant \|\| !proposal\.serverBacked/u, "Proposal hydration must replace the active tenant's server slice.");
assert.match(workspaces, /approval\.ws !== tenant \|\| !approval\.serverBacked/u, "Approval hydration must replace the active tenant's server slice.");

const server = readFileSync(new URL("server/src/index.ts", root), "utf8");
assert.match(server, /session\.memberships\.some\(\(membership\) => membership\.orgId === requested\)/u, "Tenant query authorization must use database memberships.");
assert.match(server, /TENANT_MEMBERSHIP_REQUIRED/u, "Unauthorized tenant queries must fail closed with a stable code.");

console.log(JSON.stringify({ ok: true, suite: "organization-record-isolation", organizations: 2 }));
