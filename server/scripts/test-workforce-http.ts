import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "phantomforce-workforce-http-"));
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_WORK_GRAPH_DIR = root;

const { app } = await import("../src/index.js");

const readJson = <T>(response: { body: string }) => JSON.parse(response.body) as T;
const ownerTenant = "http-workforce-owner";

try {
  const unauthorized = await app.inject({ method: "GET", url: `/api/workforce/heartbeat?tenant_id=${ownerTenant}` });
  assert.equal(unauthorized.statusCode, 401, "the heartbeat must reject anonymous reads");

  const login = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    payload: { sessionId: "admin-jordan" },
  });
  assert.equal(login.statusCode, 200);
  const ownerToken = readJson<{ token: string }>(login).token;
  assert.ok(ownerToken);
  const ownerHeaders = { authorization: `Bearer ${ownerToken}` };

  const action = {
    type: "task.create",
    proposedBy: "user",
    rationale: "Prove the owner heartbeat over the real HTTP boundary.",
    policy: { surface: "internal", reversible: true, requiresApproval: false },
    payload: { title: "Verify workforce HTTP lifecycle", priority: "high", project: "Operations" },
  } as const;
  const create = await app.inject({
    method: "POST",
    url: "/api/workforce/actions",
    headers: ownerHeaders,
    payload: { tenant_id: ownerTenant, idempotency_key: "http:task:one", action },
  });
  assert.equal(create.statusCode, 200);
  const created = readJson<{ ok: boolean; action: { id: string; status: string; receipt: { id: string; verifiedAt: string } }; replayed: boolean }>(create);
  assert.equal(created.ok, true);
  assert.equal(created.action.status, "verified_complete");
  assert.ok(created.action.receipt.id);
  assert.ok(created.action.receipt.verifiedAt);

  const replay = await app.inject({
    method: "POST",
    url: "/api/workforce/actions",
    headers: ownerHeaders,
    payload: { tenant_id: ownerTenant, idempotency_key: "http:task:one", action },
  });
  assert.equal(readJson<{ replayed: boolean; action: { id: string } }>(replay).replayed, true);
  assert.equal(readJson<{ action: { id: string } }>(replay).action.id, created.action.id);

  const emailSend = await app.inject({
    method: "POST",
    url: "/api/workforce/actions",
    headers: ownerHeaders,
    payload: {
      tenant_id: ownerTenant,
      idempotency_key: "http:email:blocked",
      action: {
        type: "email.send",
        proposedBy: "ai",
        rationale: "Exercise the governed external-action boundary.",
        policy: { surface: "external", reversible: false, requiresApproval: true },
        payload: { to: ["client@example.com"], subject: "Follow-up", body: "Approved follow-up." },
      },
    },
  });
  const pending = readJson<{ action: { id: string; status: string } }>(emailSend).action;
  assert.equal(pending.status, "awaiting_approval");

  const decision = await app.inject({
    method: "POST",
    url: `/api/workforce/actions/${pending.id}/decision`,
    headers: ownerHeaders,
    payload: { tenant_id: ownerTenant, decision: "approve" },
  });
  assert.equal(decision.statusCode, 200);
  const blocked = readJson<{ action: { status: string; receipt: { blockedReason: string; remediation: string } } }>(decision).action;
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.receipt.blockedReason, /No verified email delivery connector/i);
  assert.match(blocked.receipt.remediation, /Connect and verify Gmail or Outlook/i);

  const heartbeatResponse = await app.inject({
    method: "GET",
    url: `/api/workforce/heartbeat?tenant_id=${ownerTenant}`,
    headers: ownerHeaders,
  });
  assert.equal(heartbeatResponse.statusCode, 200);
  const heartbeat = readJson<{
    heartbeat: { verified: unknown[]; blocked: unknown[]; nothingSlips: { openTaskCount: number } };
    execution: { verification: string; external_actions: string };
    outbound_action_executed: boolean;
  }>(heartbeatResponse);
  assert.equal(heartbeat.heartbeat.verified.length, 1);
  assert.equal(heartbeat.heartbeat.blocked.length, 1);
  assert.equal(heartbeat.heartbeat.nothingSlips.openTaskCount, 1);
  assert.equal(heartbeat.execution.verification, "read_back_required");
  assert.equal(heartbeat.execution.external_actions, "connector_gated");
  assert.equal(heartbeat.outbound_action_executed, false);

  const clientLogin = await app.inject({
    method: "POST",
    url: "/auth/demo-login",
    payload: { sessionId: "client-sports-demo" },
  });
  const clientToken = readJson<{ token: string }>(clientLogin).token;
  const crossTenant = await app.inject({
    method: "GET",
    url: `/api/workforce/heartbeat?tenant_id=${ownerTenant}`,
    headers: { authorization: `Bearer ${clientToken}` },
  });
  assert.equal(crossTenant.statusCode, 403, "an ordinary client cannot read another tenant's work graph");

  console.log(JSON.stringify({
    ok: true,
    suite: "workforce-http",
    anonymousRejected: true,
    tenantBoundaryRejected: true,
    idempotentReplay: true,
    verifiedReceipt: true,
    externalConnectorTruth: true,
  }, null, 2));
} finally {
  await app.close();
  await rm(root, { recursive: true, force: true });
}
