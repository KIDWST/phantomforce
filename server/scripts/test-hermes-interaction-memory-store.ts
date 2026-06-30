import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory.js";
import {
  persistHermesInteractionMemoryPreview,
  readHermesInteractionMemoryStoreRecords,
} from "../src/phantom-ai/hermes-interaction-memory-store.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-interaction-memory-store-"));
const storePath = join(tempDir, "hermes-interaction-memory.jsonl");
const productionBlockedPath = join(tempDir, "production-blocked.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");
const queuePath = join(tempDir, "hermes-approvals.jsonl");

const fakeApiKeyValue = ["sk", "interactionstore", "0123456789abcdef"].join("-");
const fakeTokenValue = ["tok", "interactionstore", "0123456789"].join("-");
const fakeCardValue = ["4000", "0000", "0000", "0002"].join(" ");
const fakePasswordValue = ["PASSWORD", "interaction-store-secret"].join("=");
const sensitiveMetadataKey = ["to", "ken"].join("");

try {
  const source = readFileSync(
    new URL("../src/phantom-ai/hermes-interaction-memory-store.ts", import.meta.url),
    "utf8",
  );
  assert(!/\bfetch\s*\(/i.test(source), "Interaction memory store must not add fetch calls.");
  assert(!/\bhttps?\.request\b/i.test(source), "Interaction memory store must not add HTTP request calls.");
  assert(!/\baxios\s*\(/i.test(source), "Interaction memory store must not add axios calls.");
  assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Interaction memory store must not append Hermes ledger.");
  assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Interaction memory store must not write approval queue.");
  assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Interaction memory store must not write transitions.");

  const tenantAPreview = buildHermesInteractionMemoryPreview({
    tenant_id: "tenant-a",
    actor_user_id: "owner-a",
    task_id: "task-a",
    interaction_type: "content_idea_summary",
    summary: `Store redacted interaction. api_key=${fakeApiKeyValue} Bearer ${fakeTokenValue} card ${fakeCardValue} ${fakePasswordValue}`,
    metadata: {
      [sensitiveMetadataKey]: fakeTokenValue,
      secret_note: "plain-secret-like-value",
      safe_note: `api_key=${fakeApiKeyValue}`,
    },
  });
  const tenantBPreview = buildHermesInteractionMemoryPreview({
    tenant_id: "tenant-b",
    actor_user_id: "owner-b",
    task_id: "task-b",
    interaction_type: "content_idea_summary",
    summary: "Tenant-b private summary.",
  });
  const tenantAOtherUserPreview = buildHermesInteractionMemoryPreview({
    tenant_id: "tenant-a",
    actor_user_id: "employee-a",
    task_id: "task-a",
    interaction_type: "content_idea_summary",
    summary: "Employee memory should not appear in owner-a scoped read.",
  });

  const tenantAStore = await persistHermesInteractionMemoryPreview(tenantAPreview, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:00:00.000Z",
  });
  await persistHermesInteractionMemoryPreview(tenantBPreview, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:01:00.000Z",
  });
  await persistHermesInteractionMemoryPreview(tenantAOtherUserPreview, {
    storePath,
    env: { NODE_ENV: "development" },
    persistedAt: "2026-06-29T00:02:00.000Z",
  });

  const serialized = readFileSync(storePath, "utf8");

  assert(tenantAStore.persisted === true, "Interaction memory should persist in local/dev mode.");
  assert(tenantAStore.reason === "persisted_local_dev_only", "Persistence reason must be explicit.");
  assert(tenantAStore.record !== null, "Persistence should return the persisted record.");
  assert(
    tenantAStore.record.store_kind === "local_dev_only_interaction_memory_store",
    "Store kind must identify local/dev interaction memory.",
  );
  assert(tenantAStore.record.local_dev_only === true, "Store record must be local/dev only.");
  assert(tenantAStore.record.interaction_memory_store_written === true, "Store write should be explicit.");
  assert(tenantAStore.record.hermes_ledger_written === false, "Store must not write Hermes ledger.");
  assert(tenantAStore.record.external_ledger_written === false, "Store must not write external ledger.");
  assert(tenantAStore.record.production_ledger_written === false, "Store must not write production ledger.");
  assert(tenantAStore.record.production_write_allowed === false, "Production writes must not be allowed.");
  assert(tenantAStore.record.provider_request_body_created === false, "No provider request body.");
  assert(tenantAStore.record.provider_called === false, "No provider call.");
  assert(tenantAStore.record.network_call_performed === false, "No network call.");
  assert(tenantAStore.record.queue_written === false, "No queue write.");
  assert(tenantAStore.record.approval_executed === false, "No approval execution.");
  assert(tenantAStore.record.ready_for_send === false, "Nothing may be ready for send.");
  assert(tenantAStore.record.provider_transport_allowed === false, "Provider transport must stay blocked.");
  assert(
    tenantAStore.record.memory_record.metadata[sensitiveMetadataKey] === "[redacted]",
    "Sensitive metadata-key values must be fully redacted before persistence.",
  );

  for (const secret of [
    fakeApiKeyValue,
    fakeTokenValue,
    fakeCardValue,
    "interaction-store-secret",
    "plain-secret-like-value",
  ]) {
    assert(!serialized.includes(secret), `Store file must not persist raw secret value ${secret}.`);
    assert(!JSON.stringify(tenantAStore).includes(secret), `Store response must not return raw secret value ${secret}.`);
  }

  assert(!existsSync(ledgerPath), "Interaction memory store must not create Hermes ledger file.");
  assert(!existsSync(queuePath), "Interaction memory store must not create approval queue file.");

  const tenantARead = await readHermesInteractionMemoryStoreRecords({ storePath, tenantId: "tenant-a", limit: 5000 });
  assert(tenantARead.limit === 50, "Read limit must clamp to 50.");
  assert(tenantARead.records.length === 2, "Tenant-a read should return only tenant-a records.");
  assert(
    tenantARead.records.every((record) => record.tenant_id === "tenant-a"),
    "Tenant-a scoped read must not include tenant-b.",
  );

  const ownerARead = await readHermesInteractionMemoryStoreRecords({
    storePath,
    tenantId: "tenant-a",
    actorUserId: "owner-a",
  });
  assert(ownerARead.records.length === 1, "Owner-a scoped read should return only owner-a memory.");
  assert(ownerARead.records[0]?.actor_user_id === "owner-a", "Owner-a scoped read must not include employee-a.");

  const taskRead = await readHermesInteractionMemoryStoreRecords({
    storePath,
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    taskId: "task-a",
    interactionType: "content_idea_summary",
  });
  assert(taskRead.records.length === 1, "Task scoped read should return the one matching task.");

  const blockedProduction = await persistHermesInteractionMemoryPreview(tenantAPreview, {
    storePath: productionBlockedPath,
    env: { NODE_ENV: "production" },
  });
  assert(blockedProduction.persisted === false, "Production persistence must be blocked.");
  assert(blockedProduction.reason === "production_write_blocked", "Production block reason must be explicit.");
  assert(!existsSync(productionBlockedPath), "Production block must not create a store file.");

  writeFileSync(storePath, `${serialized}not json\n`, "utf8");
  const malformedRead = await readHermesInteractionMemoryStoreRecords({ storePath, limit: 10 });
  assert(malformedRead.records.length === 3, "Malformed line should not hide valid records.");
  assert(malformedRead.malformed_lines === 1, "Malformed line should be counted.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        storePath,
        persisted: tenantAStore.persisted,
        reason: tenantAStore.reason,
        recordId: tenantAStore.record.record_id,
        tenantARecords: tenantARead.records.length,
        ownerARecords: ownerARead.records.length,
        taskScopedRecords: taskRead.records.length,
        malformedLines: malformedRead.malformed_lines,
        clampedLimit: tenantARead.limit,
        providerRequestBodyCreated: tenantAStore.record.provider_request_body_created,
        providerCalled: tenantAStore.record.provider_called,
        networkCallPerformed: tenantAStore.record.network_call_performed,
        hermesLedgerWritten: tenantAStore.record.hermes_ledger_written,
        queueWritten: tenantAStore.record.queue_written,
        approvalExecuted: tenantAStore.record.approval_executed,
        readyForSend: tenantAStore.record.ready_for_send,
        productionBlocked: !blockedProduction.persisted,
        secretsLeaked:
          serialized.includes(fakeApiKeyValue) ||
          serialized.includes(fakeTokenValue) ||
          serialized.includes(fakeCardValue) ||
          serialized.includes("interaction-store-secret") ||
          serialized.includes("plain-secret-like-value"),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
