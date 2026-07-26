import assert from "node:assert/strict";

const { rehydrateAgentRuns } = await import("../../src/phantom-ai/agent-runs.js");
const { reopenHermesOperatorSession } = await import("../../src/phantom-ai/hermes-acp-operator.js");

await rehydrateAgentRuns();

const id = String(process.env.OPERATOR_TEST_SESSION_ID || "");
const expectedState = String(process.env.OPERATOR_TEST_EXPECTED_STATE || "");
assert(id);
assert(expectedState);

const accessSession = {
  id: "operator-test-user",
  label: "Operator Test User",
  role: "admin" as const,
  canManageAccess: true,
};

const reopened = await reopenHermesOperatorSession(accessSession, id);
assert(reopened, "session should reopen in a new process");
assert.equal(reopened.state, expectedState);
assert.equal(reopened.reopenCount >= 1, true);
if (expectedState === "completed") {
  assert(reopened.receiptId, "completed session should recover its receipt");
  assert(reopened.memoryId, "completed session should recover its memory reference");
}

console.log(JSON.stringify({
  ok: true,
  sessionId: id,
  state: reopened.state,
  receiptRecovered: Boolean(reopened.receiptId),
  memoryRecovered: Boolean(reopened.memoryId),
}));
