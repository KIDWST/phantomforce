import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccessSession } from "../src/access/session.js";

// A fresh application process, real login/signed bearer verification, real route
// registration and an isolated document store. No live database or provider.
const root = await mkdtemp(join(tmpdir(), "pf-commerce-http-"));
const oddA = "occasionally-odd";
const oddB = "commerce-http-second-org";
const endpoint = "/api/business-workspaces/commerce";
Object.assign(process.env, {
  NODE_ENV: "development", PHANTOMFORCE_SERVER_LISTEN: "false", PHANTOMFORCE_SERVER_LOGGER: "false",
  PHANTOMFORCE_AUTH_PROVIDER: "demo", PHANTOMFORCE_ENABLE_DEMO_AUTH: "true",
  PHANTOMFORCE_SKIP_SERVER_DOTENV: "true", PHANTOMFORCE_ALLOW_UNSIGNED_SESSION_HEADER: "false",
  PHANTOMFORCE_SESSION_SECRET: "commerce-http-only-synthetic-session-secret-20260927",
  PHANTOMFORCE_ACCESS_REPOSITORY: "json-file", DATABASE_URL: "", PHANTOM_FREE_WRITE: "false",
  PHANTOMFORCE_BUSINESS_COMMERCE_DIR: join(root, "commerce"),
  PHANTOMFORCE_BUSINESS_RECORDS_DIR: join(root, "records"), PHANTOMFORCE_DATA_DIR: join(root, "data"),
  PHANTOMFORCE_AI_CREDENTIALS_DIR: join(root, "credentials"), PHANTOMFORCE_SOCIAL_DATA_DIR: join(root, "social"),
  PHANTOMFORCE_CRM_PIPELINE_DIR: join(root, "crm"), PHANTOMFORCE_WORKSPACE_APPROVAL_DIR: join(root, "approvals"),
  PHANTOMFORCE_CONTENT_ASSET_DIR: join(root, "assets"), PHANTOMFORCE_FINANCE_LEDGER_DIR: join(root, "finance"),
  PHANTOMFORCE_BUSINESS_WORKSPACES: JSON.stringify([
    { id: "occasionallyodd", tenantId: oddB, name: "Second isolated commerce fixture", assistantContext: "Synthetic HTTP test fixtures only." },
  ]),
});

const realFetch = globalThis.fetch;
let providerRequests = 0;
globalThis.fetch = (async () => { providerRequests += 1; throw new Error("Live network is forbidden in commerce HTTP tests."); }) as typeof fetch;
const { app } = await import("../src/index.js");
const { listAccessSessions, setAccessSessions } = await import("../src/access/session.js");
const initialSessions = listAccessSessions({ includeHidden: true });
const member = (sessionId: string, orgRole: "admin" | "member", tenantId = oddA): AccessSession => ({
  id: sessionId, label: sessionId, role: "client", canManageAccess: false, userId: sessionId,
  orgId: tenantId, clientId: tenantId, orgRole, subscriptionActive: true,
  memberships: [{ orgId: tenantId, orgName: "Synthetic organization", role: orgRole }],
});
setAccessSessions([...initialSessions, member("commerce-http-admin", "admin"), member("commerce-http-viewer", "member")]);

let requests = 0;
const inject = async (options: Parameters<typeof app.inject>[0]) => { requests += 1; return app.inject(options); };
async function login(sessionId: string) {
  const response = await inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().tokenType, "Bearer");
  return response.json().token as string;
}
const headers = (token: string, tenant = oddA) => ({ authorization: "Bearer " + token, "x-phantomforce-business": tenant });
async function read(token: string, tenant = oddA) {
  const response = await inject({ method: "GET", url: endpoint, headers: headers(token, tenant) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().tenant_id, tenant);
  assert.equal(response.json().state.tenantId, tenant);
  return response.json();
}
async function command(token: string, type: string, payload: Record<string, unknown>, options: { tenant?: string; status?: number; revision?: number } = {}) {
  const response = await inject({ method: "POST", url: endpoint + "/commands", headers: headers(token, options.tenant),
    payload: { type, payload, ...(options.revision !== undefined ? { expectedRevision: options.revision } : {}) } });
  assert.equal(response.statusCode, options.status ?? 200, response.body);
  return response.json();
}

try {
  const owner = await login("admin-jordan");
  const admin = await login("commerce-http-admin");
  const viewer = await login("commerce-http-viewer");
  const outsider = await login("client-chicagoshots");
  for (const method of ["GET", "POST"] as const) {
    const response = await inject({ method, url: endpoint + (method === "POST" ? "/commands" : ""),
      headers: { "x-phantomforce-business": oddA }, ...(method === "POST" ? { payload: { type: "create-material", payload: { name: "Denied", unit: "g" } } } : {}) });
    assert.equal(response.statusCode, 401, response.body);
  }
  const forged = await inject({ method: "GET", url: endpoint, headers: headers("not-a-signed-session") });
  assert.equal(forged.statusCode, 401);
  const unauthenticated = await inject({ method: "GET", url: endpoint });
  assert.equal(unauthenticated.statusCode, 401);
  const denied = await inject({ method: "GET", url: endpoint, headers: headers(outsider) });
  assert.equal(denied.statusCode, 403, denied.body);
  const chicago = await inject({ method: "GET", url: endpoint, headers: headers(owner, "client-chicagoshots") });
  assert.equal(chicago.statusCode, 403, chicago.body);
  assert.equal(chicago.json().code, "COMMERCE_WORKSPACE_REQUIRED");
  await command(owner, "create-material", { name: "Wrong profile", unit: "g" }, { tenant: "client-chicagoshots", status: 403 });

  for (const mismatch of [
    { method: "GET" as const, url: endpoint + "?tenant_id=" + oddB },
    { method: "POST" as const, url: endpoint + "/commands", payload: { tenant_id: oddB, type: "create-material", payload: { name: "Scope bypass", unit: "g" } } },
    { method: "POST" as const, url: endpoint + "/commands", payload: { orgId: oddB, type: "create-material", payload: { name: "Alternate scope bypass", unit: "g" } } },
  ]) {
    const response = await inject({ ...mismatch, headers: headers(owner) });
    assert.equal(response.statusCode, 403, response.body);
  }
  const empty = await read(admin);
  assert.equal(empty.canManage, true);
  assert.equal(empty.state.revision, 0);
  const viewerRead = await read(viewer);
  assert.equal(viewerRead.canManage, false);
  // Paid viewer reaches the role guard; denial is not merely a paywall side effect.
  const viewerWrite = await command(viewer, "create-material", { name: "Denied viewer write", unit: "g" }, { status: 403 });
  assert.match(viewerWrite.error, /owner|administrator/i);
  await command(admin, "create-material", { name: "Nested forged scope", unit: "g", tenantId: oddB }, { status: 400 });
  assert.equal((await read(admin)).state.revision, 0);

  const materialResult = await command(admin, "create-material", { name: "HTTP fixture filament", unit: "g", onHand: 500, unitCost: 0.03 }, { revision: 0 });
  const materialId = materialResult.state.materials[0].id;
  const printerResult = await command(admin, "create-printer", { name: "HTTP fixture printer", hoursPerDay: 8, status: "idle" });
  const printerId = printerResult.state.printers[0].id;
  const productResult = await command(admin, "create-product", { sku: "http-original", name: "Original HTTP fixture", price: 24, finishedStock: 1,
    printHours: 2, rightsStatus: "original", bom: [{ materialId, quantity: 100 }] });
  const productId = productResult.state.products[0].id;
  assert.equal(productResult.state.products[0].sku, "HTTP-ORIGINAL");
  assert.equal(productResult.state.products[0].tenantId, oddA);
  const stale = await command(admin, "create-material", { name: "Stale write", unit: "g" }, { revision: 0, status: 409 });
  assert.equal(stale.code, "COMMERCE_REVISION_CONFLICT");

  const orderPayload = { externalId: "HTTP-ORDER-001", channel: "etsy", customer: { name: "Synthetic buyer A", externalCustomerId: "buyer-001" },
    due: "2035-10-20", lines: [{ sku: "http-original", quantity: 2 }] };
  const intake = await command(admin, "create-order", orderPayload);
  const orderId = intake.state.orders[0].id;
  const jobId = intake.state.jobs[0].id;
  const revision = intake.state.revision;
  assert.equal(intake.duplicate, false);
  assert.equal(intake.state.customers.length, 1);
  assert.equal(intake.state.orders.length, 1);
  assert.equal(intake.state.jobs.length, 1);
  assert.equal(intake.state.jobs[0].stockQuantity, 1);
  assert.equal(intake.state.jobs[0].makeQuantity, 1);
  assert.equal(intake.summary.products[0].reserved, 1);
  assert.equal(intake.summary.products[0].available, 0);
  assert.equal(intake.summary.materials[0].reserved, 100);
  const duplicate = await command(admin, "create-order", orderPayload, { revision: 0 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.revision, revision);
  assert.deepEqual(duplicate.state, intake.state);
  const conflicting = await command(admin, "create-order", { ...orderPayload, lines: [{ sku: "HTTP-ORIGINAL", quantity: 3 }] }, { status: 409 });
  assert.equal(conflicting.code, "ORDER_IDEMPOTENCY_CONFLICT");
  assert.equal((await read(admin)).state.revision, revision);

  // Same provider/SKU/order IDs are valid inside another authorized tenant,
  // while internal material/job/order IDs never grant cross-tenant access.
  const otherEmpty = await read(owner, oddB);
  assert.equal(otherEmpty.state.orders.length, 0);
  assert.equal(otherEmpty.state.materials.length, 0);
  await command(owner, "create-product", { sku: "HTTP-FOREIGN", name: "Cross-tenant material", price: 10, bom: [{ materialId, quantity: 1 }] }, { tenant: oddB, status: 404 });
  assert.equal((await read(owner, oddB)).state.revision, 0);
  await command(owner, "create-product", { sku: "HTTP-ORIGINAL", name: "Separate organization product", price: 7, finishedStock: 2, rightsStatus: "original" }, { tenant: oddB });
  const otherIntake = await command(owner, "create-order", { ...orderPayload, customer: { name: "Synthetic buyer B", externalCustomerId: "buyer-001" } }, { tenant: oddB });
  assert.equal(otherIntake.duplicate, false);
  assert.equal(otherIntake.state.orders[0].total, 14);
  assert.equal(otherIntake.state.customers[0].name, "Synthetic buyer B");
  assert.notEqual(otherIntake.state.orders[0].id, orderId);
  await command(owner, "advance-job", { jobId, to: "printing", printerId }, { tenant: oddB, status: 404 });
  await command(owner, "cancel-order", { orderId }, { tenant: oddB, status: 404 });
  const membershipDenied = await inject({ method: "GET", url: endpoint, headers: headers(admin, oddB) });
  assert.equal(membershipDenied.statusCode, 403);
  const isolated = await read(admin);
  assert.equal(isolated.state.orders[0].total, 48);
  assert.equal(isolated.state.customers[0].name, "Synthetic buyer A");
  assert.ok(!JSON.stringify(isolated).includes("Synthetic buyer B"));

  await command(admin, "advance-job", { jobId, to: "ready" }, { status: 409 });
  await command(admin, "ship-order", { orderId, carrier: "Test carrier", trackingNumber: "TEST-ONLY-001" }, { status: 409 });
  await command(admin, "adjust-stock", { kind: "product", id: productId, delta: -1, reason: "Must preserve open reservation" }, { status: 409 });
  const configured = await command(admin, "configure-channel", { channel: "etsy", enabled: true, accountLabel: "Fixture requires authorization" });
  assert.equal(configured.state.channels[0].status, "blocked");
  assert.equal(configured.state.channels[0].adapterReady, false);
  assert.equal(configured.state.outbox.find((row: any) => row.type === "inventory").available, 0);
  const printing = await command(admin, "advance-job", { jobId, to: "printing", printerId });
  assert.equal(printing.state.materials[0].onHand, 400);
  assert.equal(printing.summary.materials[0].reserved, 0);
  assert.equal(printing.state.printers[0].currentJobId, jobId);
  assert.equal(printing.state.jobs[0].attempts, 1);
  await command(admin, "advance-job", { jobId, to: "printing", printerId }, { status: 409 });
  for (const to of ["quality-check", "packing", "ready"]) await command(admin, "advance-job", { jobId, to });
  const shipped = await command(admin, "ship-order", { orderId, carrier: "Test carrier", trackingNumber: "TEST-ONLY-001" });
  assert.equal(shipped.state.orders[0].status, "shipped");
  assert.equal(shipped.state.jobs[0].status, "shipped");
  assert.equal(shipped.state.products[0].finishedStock, 0);
  assert.equal(shipped.state.materials[0].onHand, 400);
  assert.equal(shipped.state.printers[0].currentJobId, null);
  assert.equal(shipped.state.outbox.filter((row: any) => row.type === "fulfillment").length, 1);
  assert.ok(shipped.state.outbox.every((row: any) => row.status === "blocked"));
  const persisted = JSON.parse(await readFile(join(root, "commerce", createHash("sha256").update(oddA).digest("hex") + ".json"), "utf8"));
  assert.deepEqual(persisted, shipped.state);
  assert.deepEqual((await read(viewer)).state, shipped.state);
  assert.equal((await read(owner, oddB)).state.orders[0].status, "open");

  // Competing distinct orders cannot both claim the last finished unit.
  await command(owner, "create-product", { sku: "HTTP-LAST", name: "Last unit fixture", price: 9, finishedStock: 1, rightsStatus: "original" }, { tenant: oddB });
  const raced = await Promise.all(["A", "B"].map((suffix) => inject({ method: "POST", url: endpoint + "/commands", headers: headers(owner, oddB),
    payload: { type: "create-order", payload: { externalId: "HTTP-RACE-" + suffix, channel: "manual",
      customer: { name: "Concurrent buyer " + suffix, externalCustomerId: "race-" + suffix }, due: "2035-10-20", lines: [{ sku: "HTTP-LAST", quantity: 1 }] } } })));
  assert.deepEqual(raced.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal(raced.find((response) => response.statusCode === 409)!.json().code, "PRODUCTION_RECIPE_REQUIRED");
  const afterRace = await read(owner, oddB);
  assert.equal(afterRace.state.orders.filter((order: any) => order.externalId.startsWith("HTTP-RACE-")).length, 1);
  assert.equal(afterRace.state.customers.filter((customer: any) => customer.name.startsWith("Concurrent buyer")).length, 1);
  assert.equal(afterRace.summary.products.find((product: any) => product.sku === "HTTP-LAST").reserved, 1);
  assert.equal(afterRace.summary.products.find((product: any) => product.sku === "HTTP-LAST").available, 0);

  // The existing signed token cannot retain authority after its trusted role or
  // organization membership changes; no token regeneration or route mocks.
  setAccessSessions([...initialSessions, member("commerce-http-admin", "member"), member("commerce-http-viewer", "member")]);
  assert.equal((await read(admin)).canManage, false);
  await command(admin, "create-material", { name: "Revoked admin write", unit: "g" }, { status: 403 });
  const revoked = { ...member("commerce-http-admin", "member"), memberships: [] };
  setAccessSessions([...initialSessions, revoked, member("commerce-http-viewer", "member")]);
  const revokedRead = await inject({ method: "GET", url: endpoint, headers: headers(admin) });
  assert.equal(revokedRead.statusCode, 403, revokedRead.body);
  assert.equal(providerRequests, 0, "HTTP commands must not call an unconfigured channel or any other live provider");
  console.log(`PASS commerce HTTP: ${requests} real app requests; signed auth, role/membership revocation, profile/scope denial, two-tenant records, idempotent intake, concurrent last-unit protection, lifecycle, durable blocked synchronization; no database/provider.`);
} finally {
  setAccessSessions(initialSessions);
  await app.close();
  globalThis.fetch = realFetch;
}
