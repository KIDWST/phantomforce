import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "phantomforce-connections-"));
process.env.PHANTOMFORCE_CONNECTION_REQUESTS_PATH = join(root, "requests.json");

const requests = await import("../src/connectors/connection-request-store.js");
const catalog = await import("../src/connectors/customer-connection-catalog.js");

try {
  const first = catalog.startCustomerConnection({ tenantId: "org-a", connectorId: "finance-bank", actor: "owner-a" });
  assert.equal(first.state, "requested");
  assert.equal(first.authorizationUrl, null);
  assert.equal(first.secretsExposed, false);
  assert.match(first.customerMessage, /Nothing else is needed from you/u);

  const second = catalog.startCustomerConnection({ tenantId: "org-a", connectorId: "finance-bank", actor: "owner-a" });
  assert.equal(second.request.id, first.request.id, "Repeated Connect clicks must be idempotent for an active request.");
  assert.equal(second.request.attempts, 2);

  catalog.startCustomerConnection({ tenantId: "org-b", connectorId: "finance-bank", actor: "owner-b" });
  assert.equal(requests.listCustomerConnectionRequests("org-a").length, 1);
  assert.equal(requests.listCustomerConnectionRequests("org-b").length, 1);

  const orgA = catalog.customerConnectionCatalog("org-a");
  assert.equal(orgA.find((item) => item.id === "finance-bank")?.state, "requested");
  assert.equal(orgA.find((item) => item.id === "calendar-google")?.action, "Connect");
  assert.equal(requests.connectionRequestStoreStatus().secretsStored, false);
  assert.doesNotMatch(JSON.stringify(orgA), /client.?secret|access.?token|api.?key/iu);

  console.log(JSON.stringify({ ok: true, idempotent: true, tenantIsolation: true, customerCredentialsRequired: false }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
