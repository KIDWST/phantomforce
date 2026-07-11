import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantom-vacation-"));
process.env.PHANTOMFORCE_VACATION_MODE_PATH = join(root, "vacation.json");
process.env.PHANTOMFORCE_HERMES_LEDGER_PATH = join(root, "ledger.jsonl");
process.env.PHANTOMFORCE_APPROVAL_QUEUE_PATH = join(root, "approvals.jsonl");
process.env.PHANTOMFORCE_OWNER_OPERATOR_CREDITS = "12";
process.env.PHANTOMFORCE_HUMAN_OPERATOR_ENABLED = "true";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";

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
  const final = await module.getVacationModeStatus(session);
  assert(final.operatorWallet.reserved === 0, "Cancel should release reserved credits.");
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
