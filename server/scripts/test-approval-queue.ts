import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeApprovalQueueLimit,
  persistApprovalQueuePreview,
  readApprovalQueueRecords,
} from "../src/phantom-ai/approval-queue.js";
import { readHermesLedgerRecords } from "../src/phantom-ai/hermes-ledger.js";
import { previewModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), "phantom-approval-queue-"));
const queuePath = join(tempDir, "hermes-approvals.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");

try {
  const baseRequest: ModelRouterRequest = {
    tenant_id: "demo-trainer",
    business_name: "West Loop Strength Lab",
    actor_user_id: "demo-owner",
    actor_role: "platform_admin",
    request_id: "approval-queue-test-001",
    task_type: "content_idea_summary",
    sensitivity_level: "low",
    user_request: "Summarize internal training ideas for owner review only.",
    business_summary: "Owner-only personal training simulation. Employees disabled. External actions approval-only.",
    module_data: [
      {
        module: "Approvals",
        summary: "Approval previews are local only.",
        items: [{ title: "Review local draft", status: "preview", detail: "No live action." }],
      },
    ],
  };

  const safePreview = previewModelRouterFoundation(baseRequest, {
    env: { PHANTOM_MODEL_ROUTER_MODE: "mock" },
  });
  const safeWrite = await persistApprovalQueuePreview(safePreview.approval_request, { queuePath });
  assert(!safeWrite.queued, "Safe preview should not queue by default.");
  assert(safeWrite.reason === "preview_only_not_queued", "Safe preview should explain that it was not queued.");

  const forcedSafeWrite = await persistApprovalQueuePreview(safePreview.approval_request, {
    queuePath,
    allowPreviewOnly: true,
  });
  assert(forcedSafeWrite.queued, "Safe preview should be queueable only when explicitly requested.");
  assert(forcedSafeWrite.record?.queue_status === "preview_only", "Explicit safe queue record should be preview-only.");

  const destructivePreview = previewModelRouterFoundation(
    {
      ...baseRequest,
      request_id: "approval-queue-test-002",
      task_type: "delete_client_record",
      user_request: "Delete the client record using API_KEY=abc123456789 and card 4242 4242 4242 4242.",
    },
    { env: { PHANTOM_MODEL_ROUTER_MODE: "mock" } },
  );
  const destructiveWrite = await persistApprovalQueuePreview(destructivePreview.approval_request, { queuePath });
  assert(destructiveWrite.queued, "Destructive preview should queue.");
  assert(destructiveWrite.record?.queue_status === "blocked_preview", "Destructive preview should be blocked_preview.");
  assert(destructiveWrite.record?.execution_disabled, "Destructive queue record must disable execution.");
  assert(
    destructiveWrite.record?.approval.safety_flags.destructive_action,
    "Destructive queue record should keep destructive flag.",
  );

  const localProviderPreview = previewModelRouterFoundation(
    {
      ...baseRequest,
      request_id: "approval-queue-test-003",
      task_type: "content_idea_summary",
      user_request: "Summarize content ideas through the selected route without executing.",
    },
    {
      env: {
        PHANTOM_MODEL_ROUTER_MODE: "local",
        PHANTOM_LOCAL_MODEL_AVAILABLE: "true",
      },
    },
  );
  assert(
    localProviderPreview.action_preview.status === "live_provider_required",
    "Configured non-mock route should remain live-provider-required preview only.",
  );
  const liveProviderWrite = await persistApprovalQueuePreview(localProviderPreview.approval_request, { queuePath });
  assert(liveProviderWrite.queued, "Live-provider-required preview should queue.");
  assert(liveProviderWrite.record?.queue_status === "pending", "Live-provider-required queue record should be pending.");
  assert(liveProviderWrite.record?.execution_disabled, "Live-provider-required queue record must disable execution.");
  assert(
    liveProviderWrite.record?.queue_safety.live_action_allowed === false,
    "Queued approval must not allow live action.",
  );

  await appendFile(queuePath, "{malformed approval queue line\n", "utf8");

  const queue = await readApprovalQueueRecords({ queuePath, limit: 10 });
  assert(queue.records.length === 3, "Queue should contain three valid records before bulk limit test.");
  assert(queue.malformed_lines === 1, "Malformed JSONL line should be skipped and counted.");
  assert(queue.records.every((record) => record.execution_disabled), "Every queue record must disable execution.");
  assert(
    queue.records.every((record) => record.queue_safety.approval_execution_implemented === false),
    "Queue records must not implement approval execution.",
  );

  const rawQueue = await readFile(queuePath, "utf8");
  assert(!rawQueue.includes("abc123456789"), "Queue file must not store raw key-like text.");
  assert(!rawQueue.includes("4242 4242 4242 4242"), "Queue file must not store raw card-like text.");
  assert(rawQueue.includes("API_KEY=[redacted]"), "Queue file should store redacted key marker.");
  assert(rawQueue.includes("[redacted-card]"), "Queue file should store redacted card marker.");

  const ledgerRecords = await readHermesLedgerRecords({ ledgerPath, limit: 10 });
  assert(ledgerRecords.length === 0, "Approval queue writes must not write the Hermes ledger.");

  for (let index = 0; index < 60; index += 1) {
    await persistApprovalQueuePreview(
      {
        ...destructivePreview.approval_request,
        approval_id: `appr-bulk-${index}`,
      },
      { queuePath },
    );
  }

  const limitedQueue = await readApprovalQueueRecords({ queuePath, limit: 999 });
  assert(normalizeApprovalQueueLimit(999) === 50, "Queue limit should clamp to 50.");
  assert(limitedQueue.limit === 50, "Read result should report clamped limit.");
  assert(limitedQueue.records.length === 50, "Queue read should return at most 50 records.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        queuePath,
        safeQueuedByDefault: safeWrite.queued,
        safeQueuedWhenExplicit: forcedSafeWrite.queued,
        validRecordsBeforeLimit: queue.records.length,
        malformedLines: queue.malformed_lines,
        limitedRecords: limitedQueue.records.length,
        clampedLimit: limitedQueue.limit,
        destructiveStatus: destructiveWrite.record?.queue_status,
        liveProviderStatus: liveProviderWrite.record?.queue_status,
        ledgerRecords: ledgerRecords.length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
