import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "phantomforce-connections-"));
process.env.PHANTOMFORCE_CONNECTION_REQUESTS_PATH = join(root, "requests.json");

const requests = await import("../src/connectors/connection-request-store.js");
const catalog = await import("../src/connectors/customer-connection-catalog.js");

try {
  delete process.env.PHANTOMFORCE_CONNECTION_BROKER_URL;
  delete process.env.PHANTOMFORCE_CONNECTION_BROKER_SECRET;
  delete process.env.PHANTOMFORCE_SESSION_SECRET;
  const unavailable = catalog.customerConnectionCatalog("org-a");
  assert.equal(unavailable.find((item) => item.id === "finance-bank")?.state, "configuration_required");
  assert.equal(unavailable.find((item) => item.id === "finance-bank")?.action, "Needs configuration");
  assert.throws(
    () => catalog.startCustomerConnection({ tenantId: "org-a", connectorId: "finance-bank", actor: "owner-a" }),
    /broker configuration/u,
  );

  process.env.PHANTOMFORCE_CONNECTION_BROKER_URL = "http://127.0.0.1:5999/connect";
  process.env.PHANTOMFORCE_CONNECTION_BROKER_SECRET = "test-only-connection-broker-secret";
  const first = catalog.startCustomerConnection({ tenantId: "org-a", connectorId: "finance-bank", actor: "owner-a" });
  assert.equal(first.state, "requested");
  assert.match(first.authorizationUrl, /^http:\/\/127\.0\.0\.1:5999\/connect\?connector=finance-bank&state=/u);
  assert.equal(first.secretsExposed, false);
  assert.match(first.customerMessage, /Secure provider sign-in opened/u);

  const second = catalog.startCustomerConnection({ tenantId: "org-a", connectorId: "finance-bank", actor: "owner-a" });
  assert.equal(second.request.id, first.request.id, "Repeated Connect clicks must be idempotent for an active request.");
  assert.equal(second.request.attempts, 2);

  catalog.startCustomerConnection({ tenantId: "org-b", connectorId: "finance-bank", actor: "owner-b" });
  assert.equal(requests.listCustomerConnectionRequests("org-a").length, 1);
  assert.equal(requests.listCustomerConnectionRequests("org-b").length, 1);

  const orgA = catalog.customerConnectionCatalog("org-a");
  assert.equal(orgA.find((item) => item.id === "finance-bank")?.state, "available");
  assert.equal(orgA.find((item) => item.id === "finance-bank")?.action, "Connect");
  assert.equal(orgA.find((item) => item.id === "calendar-google")?.action, "Connect");
  assert.equal(requests.connectionRequestStoreStatus().secretsStored, false);
  assert.doesNotMatch(JSON.stringify(orgA), /client.?secret|access.?token|api.?key/iu);

  console.log(JSON.stringify({ ok: true, configurationTruthful: true, signedBrokerHandoff: true, idempotent: true, tenantIsolation: true, customerCredentialsRequired: false }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
