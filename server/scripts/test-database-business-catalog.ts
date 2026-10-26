import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizedBusinessWorkspaces, databaseBusinessWorkspaces, databaseOrganizationSwitchError } from "../src/business-workspaces/business-scope.js";
import type { AccessSession } from "../src/access/session.js";

// Read-only database adapter fixture: actual Org rows only. No Prisma client,
// live database, accounts, memberships or credentials are opened or modified.
process.env.PHANTOMFORCE_BUSINESS_WORKSPACES = "";
const rows = [
  { id: "phantomforce-internal", name: "Existing PhantomForce" },
  { id: "client-chicagoshots", name: "ChicagoShots" },
  { id: "occasionally-odd", name: "Occasionally Odd" },
  { id: "customer-fixture", name: "Customer workspace" },
];
const before = structuredClone(rows);
const db = { org: {
  findMany: async () => structuredClone(rows),
  findUnique: async ({ where }: { where: { id: string } }) => rows.find(row => row.id === where.id) || null,
} };
const owner: AccessSession = { id: "db:owner-fixture", label: "Verified owner", role: "admin", isSuperAdmin: true, canManageAccess: true,
  orgId: "phantomforce-internal", memberships: [{ orgId: "phantomforce-internal", orgName: "Existing PhantomForce", role: "owner" }] };
const customer: AccessSession = { id: "db:customer-fixture", label: "Customer", role: "client", isSuperAdmin: false, canManageAccess: false,
  orgId: "customer-fixture", memberships: [{ orgId: "customer-fixture", orgName: "Customer workspace", role: "owner" }] };
let checks = 0;
const check = (run: () => void) => { run(); checks++; };

const catalog = databaseBusinessWorkspaces(owner, await db.org.findMany());
check(() => assert.deepEqual(catalog.map(item => item.tenantId), rows.map(row => row.id)));
check(() => assert.equal(catalog.some(item => ["phantomforce", "phantomforce-owner"].includes(item.tenantId)), false, "Synthetic legacy namespaces are not database organization choices."));
check(() => assert.equal(catalog.find(item => item.tenantId === "phantomforce-internal")?.businessId, "phantomforce"));
check(() => assert.equal(catalog.find(item => item.tenantId === "phantomforce-internal")?.name, "Existing PhantomForce"));
check(() => assert.ok(catalog.every(item => item.legacy === false)));
for (const choice of catalog) {
  const row = await db.org.findUnique({ where: { id: choice.tenantId } });
  check(() => assert.equal(databaseOrganizationSwitchError(owner, choice.tenantId, Boolean(row)), null, "Every advertised database ID passes the actual switch target validator."));
}
for (const absent of ["phantomforce", "phantomforce-owner"]) {
  const row = await db.org.findUnique({ where: { id: absent } });
  check(() => assert.equal(databaseOrganizationSwitchError(owner, absent, Boolean(row)), "org_not_found"));
}
const customerCatalog = databaseBusinessWorkspaces(customer, await db.org.findMany());
check(() => assert.deepEqual(customerCatalog.map(item => item.tenantId), ["customer-fixture"], "A customer cannot inherit other rows even if an adapter supplies them."));
check(() => assert.equal(customerCatalog[0].canManage, true, "Business ownership remains separate from platform administration."));
check(() => assert.equal(databaseOrganizationSwitchError(customer, "occasionally-odd", true), "not_a_member"));
check(() => assert.deepEqual(databaseBusinessWorkspaces(owner, []), [], "An empty database cannot fabricate switchable organizations."));
check(() => assert.equal(databaseBusinessWorkspaces(owner, [...rows, rows[0]]).length, rows.length));
check(() => assert.deepEqual(rows, before));
check(() => assert.ok(authorizedBusinessWorkspaces({ id: "owner-admin", label: "Legacy owner", role: "admin", canManageAccess: true }).some(item => item.tenantId === "phantomforce-owner"), "Non-database owner compatibility keeps its existing private namespace."));

const accounts = readFileSync(new URL("../src/access/user-accounts.ts", import.meta.url), "utf8");
check(() => assert.match(accounts, /databaseOrganizationSwitchError\(session, orgId, Boolean\(org\)\)[\s\S]*authSession\.update/, "The production DB switch validates the same target before updating session selection."));
const server = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
check(() => assert.match(server, /dbSession \? databaseBusinessWorkspaces\(session, await listOrganizationsForSession\(dbSession\)\) : authorizedBusinessWorkspaces\(session\)/, "The real catalog uses database organization rows and retains only the non-DB legacy fallback."));
console.log(`Database business catalog: ${checks} checks passed (actual-row selection, shared switch guard, existing IDs, customer isolation and zero writes).`);
