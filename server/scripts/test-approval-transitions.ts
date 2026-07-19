import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendApprovalQueueTransition,
  isForbiddenApprovalTransitionStatus,
  normalizeApprovalTransitionLimit,
  parseApprovalTransitionStatus,
  persistApprovalQueuePreview,
  readApprovalQueueTransitions,
  readApprovalQueueWithTransitions,
} from "../src/phantom-ai/approval-queue.js";
import { readHermesLedgerRecords } from "../src/phantom-ai/hermes-ledger.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "phantom-approval-transitions-"));
const queuePath = join(tempDir, "hermes-approvals.jsonl");
const transitionsPath = join(tempDir, "hermes-approval-transitions.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");

try {
  assert(parseApprovalTransitionStatus("reviewed") === "reviewed", "Reviewed status should be allowed.");
  assert(parseApprovalTransitionStatus("approved") === null, "Approved status must not be allowed.");
  assert(isForbiddenApprovalTransitionStatus("approved_for_execution"), "Execution-like status should be forbidden.");
  assert(isForbiddenApprovalTransitionStatus("execute"), "Execute status should be forbidden.");
  assert(normalizeApprovalTransitionLimit(999) === 50, "Transition read limit should clamp to 50.");

  const request: ModelRouterRequest = {
    tenant_id: "demo-trainer",
    business_name: "West Loop Strength Lab",
    actor_user_id: "demo-owner",
    actor_role: "platform_admin",
    request_id: "transition-test-001",
    task_type: "delete_client_record",
    sensitivity_level: "high",
    user_request: "Delete the client record using API_KEY=abc123456789.",
    business_summary: "Owner-only transition proof. No live execution.",
    module_data: [],
  };
  const preview = previewModelRouterFoundation(request, { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } });
  const queueWrite = await persistApprovalQueuePreview(preview.approval_request, { queuePath });
  const queueId = queueWrite.record?.queue_id;
  assert(Boolean(queueId), "Destructive preview should create a queue id.");

  const missingTransition = await appendApprovalQueueTransition({
    queueId: "queue-missing",
    toStatus: "reviewed",
    requestedBy: {
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
    },
    note: "Missing record should not append.",
    queuePath,
    transitionsPath,
  });
  assert(missingTransition === null, "Missing queue id should fail closed.");

  const reviewedTransition = await appendApprovalQueueTransition({
    queueId: queueId ?? "",
    toStatus: "reviewed",
    requestedBy: {
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
    },
    note: "Reviewed after checking API_KEY=abc123456789 and card 4242 4242 4242 4242.",
    queuePath,
    transitionsPath,
  });
  assert(reviewedTransition?.transitioned, "Reviewed transition should append.");
  assert(reviewedTransition.transition.from_status === "unreviewed", "First transition should start from unreviewed.");
  assert(reviewedTransition.transition.to_status === "reviewed", "First transition should mark reviewed.");
  assert(reviewedTransition.transition.execution_disabled, "Transition must disable execution.");
  assert(
    reviewedTransition.transition.safety_flags.status_only,
    "Transition safety flags should mark status-only.",
  );

  const needsChangesTransition = await appendApprovalQueueTransition({
    queueId: queueId ?? "",
    toStatus: "needs_changes",
    requestedBy: {
      actor_user_id: "admin-jordan",
      actor_role: "platform_admin",
    },
    note: "Needs changes before any message is sent.",
    queuePath,
    transitionsPath,
  });
  assert(
    needsChangesTransition?.transition.from_status === "reviewed",
    "Second transition should derive from reviewed.",
  );
  assert(
    needsChangesTransition?.record.latest_review_status === "needs_changes",
    "Derived record should show latest status.",
  );
  assert(needsChangesTransition?.record.transition_count === 2, "Derived record should count transitions.");

  await appendFile(transitionsPath, "{bad transition line\n", "utf8");

  const transitions = await readApprovalQueueTransitions({ transitionsPath, limit: 10 });
  assert(transitions.records.length === 2, "Transition reader should return valid transitions.");
  assert(transitions.malformed_lines === 1, "Malformed transition line should be counted.");

  const derivedQueue = await readApprovalQueueWithTransitions({ queuePath, transitionsPath, limit: 10 });
  assert(derivedQueue.records.length === 1, "Derived queue should include queued record.");
  assert(
    derivedQueue.records[0]?.latest_review_status === "needs_changes",
    "Derived queue should expose latest review status.",
  );
  assert(derivedQueue.records[0]?.transition_count === 2, "Derived queue should expose transition count.");
  assert(derivedQueue.transition_malformed_lines === 1, "Derived queue should report malformed transition lines.");

  const rawTransitions = await readFile(transitionsPath, "utf8");
  assert(!rawTransitions.includes("abc123456789"), "Transition file must not store raw key-like text.");
  assert(!rawTransitions.includes("4242 4242 4242 4242"), "Transition file must not store raw card-like text.");
  assert(rawTransitions.includes("API_KEY=[redacted]"), "Transition file should store redacted key marker.");
  assert(rawTransitions.includes("[redacted-card]"), "Transition file should store redacted card marker.");

  const ledgerRecords = await readHermesLedgerRecords({ ledgerPath, limit: 10 });
  assert(ledgerRecords.length === 0, "Transition writes must not write the Hermes ledger.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        queuePath,
        transitionsPath,
        queueId,
        latestReviewStatus: derivedQueue.records[0]?.latest_review_status,
        transitionCount: derivedQueue.records[0]?.transition_count,
        malformedTransitionLines: derivedQueue.transition_malformed_lines,
        forbiddenApproved: isForbiddenApprovalTransitionStatus("approved_for_execution"),
        ledgerRecords: ledgerRecords.length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
