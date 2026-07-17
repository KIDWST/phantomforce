import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";
import { persistApprovalQueuePreview } from "../src/phantom-ai/approval-queue.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantom-vacation-"));
process.env.PHANTOMFORCE_VACATION_MODE_PATH = join(root, "vacation.json");
process.env.PHANTOMFORCE_HERMES_LEDGER_PATH = join(root, "ledger.jsonl");
// NOTE: the approval-queue reader/writer (server/src/phantom-ai/approval-queue.ts)
// actually keys off PHANTOM_HERMES_APPROVAL_QUEUE_PATH / _TRANSITIONS_PATH, not a
// PHANTOMFORCE_-prefixed name — without these, /api/vacation-mode/approvals/*
// routes silently fall back to this repo's real default queue file instead of
// this test's temp dir.
process.env.PHANTOM_HERMES_APPROVAL_QUEUE_PATH = join(root, "approvals.jsonl");
process.env.PHANTOM_HERMES_APPROVAL_TRANSITIONS_PATH = join(root, "approval-transitions.jsonl");
process.env.PHANTOMFORCE_OWNER_OPERATOR_CREDITS = "12";
process.env.PHANTOMFORCE_HUMAN_OPERATOR_ENABLED = "true";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
// Demo client sessions have no real subscription; grant write so the
// cross-tenant approval-decision test below exercises POST, not the paywall.
process.env.PHANTOM_FREE_WRITE = "true";

const session: AccessSession = { id: "owner-admin", label: "Owner", role: "admin", canManageAccess: true };

try {
  const module = await import("../src/phantom-ai/vacation-mode.js");
  const initial = await module.getVacationModeStatus(session);
  assert(initial.enabled === false, "Away Mode should start off.");
  assert(initial.operatorWallet.available === 12, "Owner should receive configured Operator Credits.");
  assert(initial.operatorWallet.separateFromAiCredits === true, "Operator Credits must be separate from AI credits.");
  assert((await module.getVacationModeApprovals(session)).length === 0, "No fake approvals should be seeded.");

  const activated = await module.activateVacationMode(session, {
    operatorCoverage: { allowCalls: true, allowMeetings: true, ownerInterruptionPolicy: "emergencies_only" },
  });
  assert(activated.status.mode === "hands_off", "Activation should use hands-off mode.");

  const queued = await module.createVacationOperatorTask(session, {
    type: "phone_call",
    title: "Return a client call",
    instructions: "Confirm availability and record the outcome.",
  });
  assert(queued.task.status === "queued", "Connected staffing should queue the call.");
  assert(queued.task.creditCost === 2, "Phone call should reserve two Operator Credits.");
  assert(queued.wallet.reserved === 2, "Wallet should show reserved credits.");

  const check = await module.runVacationModeCheckIn("test");
  assert(check.active === 1, "Check-in should inspect the active workspace.");

  await module.cancelVacationOperatorTask(session, queued.task.id);
  const afterCancel = await module.getVacationModeStatus(session);
  assert(afterCancel.operatorWallet.reserved === 0, "Cancel should release reserved credits.");

  /* Bounded-autonomy enforcement regression: the coverage-plan toggles are
     the "what Phantom can decide alone vs. must ask about" contract. Turning
     allowCalls off must actually block a phone_call operator task instead of
     just being stored and displayed. */
  await module.updateVacationModeSettings(session, {
    operatorCoverage: { allowCalls: false, allowMeetings: true, ownerInterruptionPolicy: "emergencies_only" },
  });
  const policyBlocked = await module.createVacationOperatorTask(session, {
    type: "phone_call",
    title: "Call a lead while the owner is away",
    instructions: "This should be refused by the coverage plan, not queued.",
  });
  assert(policyBlocked.task.status === "blocked", "A phone_call task must be blocked when allowCalls is off.");
  assert(policyBlocked.task.blockedReason === "policy", "The block reason must be reported as a policy block, not a credit block.");
  assert(policyBlocked.wallet.reserved === 0, "A policy-blocked task must not reserve Operator Credits.");

  const stillAllowed = await module.createVacationOperatorTask(session, {
    type: "attend_meeting",
    title: "Join a scheduled meeting",
    instructions: "allowMeetings is still on; this should queue normally.",
  });
  assert(stillAllowed.task.status === "queued", "A task type whose coverage toggle is still on must not be blocked by an unrelated toggle.");
  await module.cancelVacationOperatorTask(session, stillAllowed.task.id);

  const untoggledType = await module.createVacationOperatorTask(session, {
    type: "research",
    title: "Look something up",
    instructions: "research has no coverage toggle at all; it must never be policy-blocked.",
  });
  assert(untoggledType.task.status !== "blocked" || untoggledType.task.blockedReason !== "policy", "Task types with no coverage toggle must never be reported as policy-blocked.");
  if (untoggledType.task.status === "queued") await module.cancelVacationOperatorTask(session, untoggledType.task.id);

  const final = await module.getVacationModeStatus(session);
  assert(final.operatorWallet.reserved === 0, "No reserved credits should remain after the coverage-enforcement checks clean up.");
  await module.deactivateVacationMode(session);

  const { app } = await import("../src/index.js");
  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should log in.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");
  const ownerRoute = await app.inject({ method: "GET", url: "/api/vacation-mode/status", headers: { Authorization: `Bearer ${ownerToken}` } });
  const clientRoute = await app.inject({ method: "GET", url: "/api/vacation-mode/status", headers: { Authorization: `Bearer ${clientToken}` } });
  assert(ownerRoute.statusCode === 200, "Owner Vacation status route should work.");
  assert(clientRoute.statusCode === 200, "Authenticated client Vacation status route should work.");
  const clientBody = clientRoute.json() as { operatorWallet: { included: number }; readiness: Array<{ id: string; detail: string }> };
  assert(clientBody.operatorWallet.included === 0, "Client credits should be isolated from owner credits.");
  assert(clientBody.readiness.some((item) => item.id === "workspace" && item.detail.includes("isolated")), "Client workspace should report isolation.");

  /* Regression for a cross-tenant IDOR: the shared Hermes approval queue file has
     no per-tenant partition, so /api/vacation-mode/approvals/:id/decision must
     itself refuse to transition another tenant's queued approval. */
  const otherClientToken = await login("client-chicagoshots");
  const fabricatedRequest: ModelRouterRequest = {
    tenant_id: "client-chicagoshots",
    business_name: "ChicagoShots",
    actor_user_id: "client-chicagoshots",
    actor_role: "business_owner",
    request_id: "vacation-isolation-test-001",
    task_type: "delete_client_record",
    sensitivity_level: "high",
    user_request: "Delete a client record.",
    business_summary: "Cross-tenant vacation-mode approval isolation proof.",
    module_data: [],
  };
  const fabricatedPreview = previewModelRouterFoundation(fabricatedRequest, { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } });
  const fabricatedWrite = await persistApprovalQueuePreview(fabricatedPreview.approval_request, {
    queuePath: process.env.PHANTOM_HERMES_APPROVAL_QUEUE_PATH,
  });
  const otherTenantQueueId = fabricatedWrite.record?.queue_id;
  assert(Boolean(otherTenantQueueId), "Fabricated ChicagoShots approval should get a queue id.");

  const crossTenantDecision = await app.inject({
    method: "POST",
    url: `/api/vacation-mode/approvals/${otherTenantQueueId}/decision`,
    headers: { Authorization: `Bearer ${clientToken}` },
    payload: { decision: "approve" },
  });
  assert(
    crossTenantDecision.statusCode === 404,
    `A client of one org must not be able to decide another org's queued approval (got ${crossTenantDecision.statusCode}).`,
  );

  const sameTenantDecision = await app.inject({
    method: "POST",
    url: `/api/vacation-mode/approvals/${otherTenantQueueId}/decision`,
    headers: { Authorization: `Bearer ${otherClientToken}` },
    payload: { decision: "approve" },
  });
  assert(sameTenantDecision.statusCode === 200, "The owning tenant should still be able to decide its own queued approval.");

  const ownerDecision = await app.inject({
    method: "POST",
    url: `/api/vacation-mode/approvals/${otherTenantQueueId}/decision`,
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: { decision: "snooze" },
  });
  assert(ownerDecision.statusCode === 200, "The platform owner must retain cross-tenant review access.");

  await app.close();

  console.log(JSON.stringify({
    ok: true,
    mode: activated.status.mode,
    operatorCreditsSeparate: initial.operatorWallet.separateFromAiCredits,
    initialCredits: initial.operatorWallet.available,
    queuedTaskStatus: queued.task.status,
    queuedTaskCredits: queued.task.creditCost,
    checkInWorkspaces: check.active,
    fakeApprovals: 0,
    finalReservedCredits: final.operatorWallet.reserved,
    clientWorkspaceIsolated: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
