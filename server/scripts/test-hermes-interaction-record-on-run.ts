import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readHermesInteractionMemoryStoreRecords,
  recordHermesInteractionMemoryFromRun,
} from "../src/phantom-ai/hermes-interaction-memory-store.js";
import { runModelRouterFoundation } from "../src/phantom-ai/model-router.js";
import type { ModelRouterRequest } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-record-on-run-"));
const storePath = join(tempDir, "hermes-interaction-memory.jsonl");
const productionBlockedPath = join(tempDir, "production-blocked.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const queuePath = join(tempDir, "hermes-approvals.jsonl");

const fakeApiKeyValue = ["sk", "recordonrun", "0123456789abcdef"].join("-");
const fakeTokenValue = ["tok", "recordonrun", "0123456789"].join("-");
const fakeCardValue = ["4000", "0000", "0000", "0002"].join(" ");
const fakePasswordValue = ["PASSWORD", "record-on-run-secret"].join("=");
const rawPromptBlob = "raw prompt body ".repeat(80);
const rawContextMarker = "BUSINESS_RAW_CONTEXT_MARKER_SHOULD_NOT_STORE";

function request(overrides: Partial<ModelRouterRequest> & {
  tenant_id: string;
  actor_user_id: string;
  request_id: string;
}): ModelRouterRequest {
  return {
    tenant_id: overrides.tenant_id,
    business_name: overrides.business_name ?? "West Loop Strength Lab",
    actor_user_id: overrides.actor_user_id,
    actor_role: overrides.actor_role ?? "platform_admin",
    request_id: overrides.request_id,
    task_type: overrides.task_type ?? "content_idea_summary",
    sensitivity_level: overrides.sensitivity_level ?? "low",
    user_request:
      overrides.user_request ??
      `Summarize safe trainer follow-ups. ${rawPromptBlob} api_key=${fakeApiKeyValue} Bearer ${fakeTokenValue} card ${fakeCardValue} ${fakePasswordValue}`,
    business_summary: overrides.business_summary ?? `Owner-only local proof. ${rawContextMarker}`,
    module_data: overrides.module_data ?? [
      {
        module: "Content",
        summary: "Local proof data only.",
        items: [{ title: "Draft only", status: "preview", detail: "No external send." }],
      },
    ],
  };
}

try {
  const source = readFileSync(
    new URL("../src/phantom-ai/hermes-interaction-memory-store.ts", import.meta.url),
    "utf8",
  );
  assert(!/\bfetch\s*\(/i.test(source), "Record-on-run helper must not add fetch calls.");
  assert(!/\bhttps?\.request\b/i.test(source), "Record-on-run helper must not add HTTP request calls.");
  assert(!/\baxios\s*\(/i.test(source), "Record-on-run helper must not add axios calls.");
  assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Record-on-run helper must not write approval queue.");
  assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Record-on-run helper must not write transitions.");

  const tenantARun = await runModelRouterFoundation(
    request({
      tenant_id: "tenant-a",
      actor_user_id: "owner-a",
      request_id: "task-a",
    }),
    {
      ledgerPath,
      env: { PHANTOM_MODEL_ROUTER_MODE: "mock" },
    },
  );
  const tenantARecord = await recordHermesInteractionMemoryFromRun(tenantARun, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:00:00.000Z",
    now: "2026-06-29T00:00:00.000Z",
  });

  const tenantBRun = await runModelRouterFoundation(
    request({
      tenant_id: "tenant-b",
      actor_user_id: "owner-b",
      request_id: "task-b",
      user_request: "Tenant-b safe summary only.",
      business_summary: "Tenant-b local proof.",
    }),
    {
      ledgerPath,
      env: { PHANTOM_MODEL_ROUTER_MODE: "mock" },
    },
  );
  await recordHermesInteractionMemoryFromRun(tenantBRun, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:01:00.000Z",
    now: "2026-06-29T00:01:00.000Z",
  });

  const tenantAEmployeeRun = await runModelRouterFoundation(
    request({
      tenant_id: "tenant-a",
      actor_user_id: "employee-a",
      request_id: "employee-task-a",
      user_request: "Employee-a safe summary only.",
      business_summary: "Tenant-a employee local proof.",
    }),
    {
      ledgerPath,
      env: { PHANTOM_MODEL_ROUTER_MODE: "mock" },
    },
  );
  await recordHermesInteractionMemoryFromRun(tenantAEmployeeRun, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:02:00.000Z",
    now: "2026-06-29T00:02:00.000Z",
  });

  const serialized = readFileSync(storePath, "utf8");

  assert(tenantARecord.persistence.persisted === true, "Record-on-run should persist in local/dev mode.");
  assert(
    tenantARecord.persistence.reason === "persisted_local_dev_only",
    "Record-on-run persistence reason should be local/dev only.",
  );
  assert(
    tenantARecord.hermes_interaction_memory_store_written === true,
    "Record-on-run should report interaction memory store write.",
  );
  assert(tenantARecord.memory_preview.scope.tenant_id === "tenant-a", "Memory preview tenant scope must match run.");
  assert(tenantARecord.memory_preview.scope.actor_user_id === "owner-a", "Memory preview user scope must match run.");
  assert(tenantARecord.memory_preview.scope.task_id === "task-a", "Memory preview task scope must use request id.");
  assert(
    tenantARecord.memory_preview.record.interaction_type === "content_idea_summary",
    "Memory preview interaction type must use task type.",
  );
  assert(
    tenantARecord.persistence.record?.memory_record.safe_summary.includes("Request summary:"),
    "Memory record should include the redacted request summary.",
  );
  assert(
    tenantARecord.persistence.record?.memory_record.safe_summary.includes("Result:"),
    "Memory record should include the run result summary.",
  );
  assert(
    tenantARecord.persistence.record?.memory_record.safe_summary.includes("Next action:"),
    "Memory record should include the next action.",
  );

  for (const blocked of [tenantARecord, tenantARecord.persistence, tenantARecord.persistence.record]) {
    assert(blocked?.provider_request_body_created === false, "No provider request body may be created.");
    assert(blocked?.provider_called === false, "No provider call may occur.");
    assert(blocked?.network_call_performed === false, "No network call may occur.");
    assert(blocked?.queue_written === false, "No queue write may occur.");
    assert(blocked?.approval_executed === false, "No approval execution may occur.");
    assert(blocked?.ready_for_send === false, "Nothing may be ready for send.");
    assert(blocked?.provider_transport_allowed === false, "Provider transport must stay blocked.");
  }
  assert(
    tenantARecord.persistence.record?.production_ledger_written === false,
    "No production ledger write may occur.",
  );
  assert(
    tenantARecord.persistence.record?.production_write_allowed === false,
    "Production writes must remain disallowed.",
  );

  for (const secret of [
    fakeApiKeyValue,
    fakeTokenValue,
    fakeCardValue,
    "record-on-run-secret",
    rawPromptBlob,
    rawContextMarker,
  ]) {
    assert(!serialized.includes(secret), `Store must not persist raw prompt/context/secret value ${secret}.`);
    assert(!JSON.stringify(tenantARecord).includes(secret), `Response must not return raw value ${secret}.`);
  }

  assert(!existsSync(queuePath), "Record-on-run must not create approval queue file.");

  const tenantARead = await readHermesInteractionMemoryStoreRecords({ storePath, tenantId: "tenant-a", limit: 5000 });
  assert(tenantARead.limit === 50, "Read limit should clamp to 50.");
  assert(tenantARead.records.length === 2, "Tenant-a read should include only tenant-a records.");
  assert(tenantARead.records.every((record) => record.tenant_id === "tenant-a"), "Tenant-a read must not leak tenant-b.");

  const ownerARead = await readHermesInteractionMemoryStoreRecords({
    storePath,
    tenantId: "tenant-a",
    actorUserId: "owner-a",
  });
  assert(ownerARead.records.length === 1, "Owner-a read should return only owner-a memory.");
  assert(ownerARead.records[0]?.actor_user_id === "owner-a", "Owner-a read must not include employee-a.");

  const taskRead = await readHermesInteractionMemoryStoreRecords({
    storePath,
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    taskId: "task-a",
    interactionType: "content_idea_summary",
  });
  assert(taskRead.records.length === 1, "Task/type scoped read should return the one matching interaction.");

  const blockedProduction = await recordHermesInteractionMemoryFromRun(tenantARun, {
    storePath: productionBlockedPath,
    env: { NODE_ENV: "production" },
  });
  assert(blockedProduction.persistence.persisted === false, "Production persistence must be blocked.");
  assert(blockedProduction.persistence.reason === "production_write_blocked", "Production block reason must be explicit.");
  assert(!existsSync(productionBlockedPath), "Production block must not create a store file.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        persisted: tenantARecord.persistence.persisted,
        storeWritten: tenantARecord.hermes_interaction_memory_store_written,
        tenantARecords: tenantARead.records.length,
        ownerARecords: ownerARead.records.length,
        taskScopedRecords: taskRead.records.length,
        clampedLimit: tenantARead.limit,
        providerRequestBodyCreated: tenantARecord.provider_request_body_created,
        providerCalled: tenantARecord.provider_called,
        networkCallPerformed: tenantARecord.network_call_performed,
        queueWritten: tenantARecord.queue_written,
        approvalExecuted: tenantARecord.approval_executed,
        readyForSend: tenantARecord.ready_for_send,
        providerTransportAllowed: tenantARecord.provider_transport_allowed,
        productionBlocked: !blockedProduction.persistence.persisted,
        secretsLeaked:
          serialized.includes(fakeApiKeyValue) ||
          serialized.includes(fakeTokenValue) ||
          serialized.includes(fakeCardValue) ||
          serialized.includes("record-on-run-secret") ||
          serialized.includes(rawPromptBlob) ||
          serialized.includes(rawContextMarker),
        queueFileCreated: existsSync(queuePath),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
