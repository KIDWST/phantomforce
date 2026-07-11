import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const tempDir = await mkdtemp(join(tmpdir(), "phantom-vacation-operator-"));
process.env.PHANTOMFORCE_VACATION_MODE_PATH = join(tempDir, "vacation-mode.json");
process.env.PHANTOM_HERMES_LEDGER_PATH = join(tempDir, "hermes-ledger.jsonl");
process.env.PHANTOM_HERMES_APPROVAL_QUEUE_PATH = join(tempDir, "approvals.jsonl");
process.env.PHANTOM_HERMES_APPROVAL_TRANSITIONS_PATH = join(tempDir, "approval-transitions.jsonl");
process.env.PHANTOMFORCE_OWNER_OPERATOR_CREDITS = "12";
process.env.PHANTOMFORCE_HUMAN_OPERATOR_ENABLED = "false";

const {
  activateVacationMode,
  cancelVacationOperatorTask,
  createVacationOperatorTask,
  deactivateVacationMode,
  getVacationModeActivity,
  getVacationModeApprovals,
  getVacationModeStatus,
  getVacationOperatorTasks,
  runVacationModeCheckIn,
} = await import("../src/phantom-ai/vacation-mode.js");

const owner = {
  id: "owner-admin",
  label: "PhantomForce Owner",
  role: "admin" as const,
  canManageAccess: true,
};

try {
  const initial = await getVacationModeStatus(owner);
  assert(initial.enabled === false, "Vacation Mode should begin off.");
  assert(initial.operator.wallet.available === 12, "Owner operator credits should load separately.");
  assert(initial.operator.wallet.separateFromAiCredits === true, "Operator credits must be separate from AI credits.");
  assert((await getVacationModeApprovals(owner)).length === 0, "New workspaces must not contain fake approvals.");

  const activated = await activateVacationMode(owner, {
    operatorCoverage: {
      ownerInterruptionPolicy: "emergencies_only",
      handoffNotes: "Handle routine work and keep me offline.",
      dailyCreditLimit: 6,
    },
  });
  assert(activated.status.enabled === true, "Hands-off coverage should activate.");
  assert(activated.status.mode === "hands_off", "Vacation Mode should have one hands-off mode.");

  const queued = await createVacationOperatorTask(owner, {
    type: "phone_call",
    title: "Return an important client call",
    instructions: "Call the client, collect the missing details, and record the outcome.",
    contactName: "Test client",
  });
  assert(queued?.task.status === "queued", "Valid human work should enter the operator queue.");
  assert(queued?.task.estimatedCredits === 2, "Phone calls should reserve two operator credits.");
  assert(queued?.operator.wallet.reserved === 2, "Queued work should reserve operator credits.");
  assert(queued?.operator.wallet.available === 10, "Reserved credits should reduce availability.");

  const tasks = await getVacationOperatorTasks(owner);
  assert(tasks.length === 1, "Operator task should persist.");
  assert(tasks[0]?.source === "owner", "Test task should preserve its source.");

  const checkIn = await runVacationModeCheckIn("test");
  assert(checkIn.workspacesChecked === 1, "Autonomous check-in should inspect the active workspace.");
  const afterCheckIn = await getVacationModeStatus(owner);
  assert(Boolean(afterCheckIn.lastCheckInAt), "Autonomous check-in should persist proof time.");

  const canceled = await cancelVacationOperatorTask(owner, tasks[0]!.id);
  assert(canceled?.task.status === "canceled", "Owner should be able to cancel queued human work.");
  assert(canceled?.operator.wallet.reserved === 0, "Cancellation should release reserved credits.");
  assert(canceled?.operator.wallet.available === 12, "Cancellation should restore availability.");

  const activity = await getVacationModeActivity(owner);
  assert(activity.some((event) => event.eventType === "operator_queued"), "Operator queue activity should be proven.");
  assert(activity.some((event) => event.relatedEntity === "Vacation Mode check-in"), "Check-in should leave proof.");

  const deactivated = await deactivateVacationMode(owner);
  assert(deactivated.status.enabled === false, "Instant stop should disable Vacation Mode.");

  console.log(JSON.stringify({
    ok: true,
    mode: activated.status.mode,
    operatorCreditsSeparate: initial.operator.wallet.separateFromAiCredits,
    initialCredits: initial.operator.wallet.available,
    queuedTaskStatus: queued?.task.status,
    queuedTaskCredits: queued?.task.estimatedCredits,
    checkInWorkspaces: checkIn.workspacesChecked,
    fakeApprovals: 0,
    finalReservedCredits: canceled?.operator.wallet.reserved,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
