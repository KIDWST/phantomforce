import { redactSensitiveText } from "./hermes-ledger.js";
import {
  readHermesInteractionMemoryStoreRecords,
  resolveHermesInteractionMemoryStorePath,
} from "./hermes-interaction-memory-store.js";
import type { HermesInteractionMemoryStoreRecord } from "./hermes-interaction-memory-store.js";

// Phase 1f: recall from the Hermes interaction memory store.
//
// Phase 1d/1e capture redacted PhantomAI interactions into a local-dev-only
// interaction memory store, but until now nothing recalled them back into
// context (recallHermesMemory reads only the Hermes ledger). This closes the
// loop: it reads the dedicated interaction memory store, scoped to a single
// tenant (and optionally user/task/type), and returns a bounded, redacted
// memory packet plus an injectable compact_memory block.
//
// Hard boundaries (same dry-run/local ladder):
// - READ ONLY: never writes any store/ledger/queue.
// - LOCAL ONLY: reads the local interaction memory store window.
// - REDACTED: store records are already redacted; every returned string is
//   re-passed through redactSensitiveText defensively.
// - BOUNDED: scan window and returned item count are both capped.
// - TENANT SCOPED: tenant A recall can never include tenant B records.
// - NO live provider / model / network call; no sendable request body.

const DEFAULT_RECALL_LIMIT = 8;
const MAX_RECALL_LIMIT = 25;
const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 500;
const MAX_SUMMARY_CHARS = 280;
const MAX_COMPACT_MEMORY_CHARS = 2400;

export type HermesInteractionRecallScope = {
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
  interaction_type: string | null;
};

export type HermesInteractionRecallItem = {
  record_id: string;
  interaction_record_id: string;
  captured_at: string;
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
  interaction_type: string;
  safe_summary: string;
  metadata: Record<string, string>;
};

export type HermesInteractionRecallResult = {
  recalled_at: string;
  source: "hermes_interaction_memory_store";
  scope: HermesInteractionRecallScope;
  store_path: string;
  scanned_records: number;
  matched_records: number;
  returned_records: number;
  malformed_records: number;
  items: HermesInteractionRecallItem[];
  compact_memory: string;
  has_memory: boolean;
  safety_flags: {
    local_file_only: true;
    read_only: true;
    redacted: true;
    tenant_scoped: true;
    bounded: true;
    provider_request_body_created: false;
    provider_called: false;
    network_call_performed: false;
    network_client_implemented: false;
    live_call_allowed: false;
    execution_disabled: true;
    ready_for_send: false;
    provider_transport_allowed: false;
    ledger_written: false;
    queue_written: false;
    approval_executed: false;
    production_ledger_written: false;
    raw_secret_exposed: false;
  };
};

function clampLimit(value: number | string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function scopeValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return redactSensitiveText(trimmed).slice(0, 120);
}

function redactMetadata(metadata: Record<string, string> | undefined): Record<string, string> {
  if (!metadata || typeof metadata !== "object") return {};
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      redactSensitiveText(String(key)).slice(0, 60),
      redactSensitiveText(String(value)).slice(0, 200),
    ]),
  );
}

function toItem(record: HermesInteractionMemoryStoreRecord): HermesInteractionRecallItem {
  const memory = record.memory_record;
  return {
    record_id: redactSensitiveText(record.record_id).slice(0, 120),
    interaction_record_id: redactSensitiveText(record.interaction_record_id).slice(0, 120),
    captured_at: record.captured_at,
    tenant_id: redactSensitiveText(record.tenant_id).slice(0, 120),
    actor_user_id: record.actor_user_id ? redactSensitiveText(record.actor_user_id).slice(0, 120) : null,
    task_id: record.task_id ? redactSensitiveText(record.task_id).slice(0, 120) : null,
    interaction_type: redactSensitiveText(record.interaction_type).slice(0, 120),
    safe_summary: redactSensitiveText(memory.safe_summary ?? "").slice(0, MAX_SUMMARY_CHARS),
    metadata: redactMetadata(memory.metadata),
  };
}

function buildCompactMemory(items: HermesInteractionRecallItem[]): string {
  if (!items.length) {
    return "No prior Hermes interaction memory for this user yet.";
  }
  const lines = items.map(
    (item) => `- [${item.captured_at}] ${item.interaction_type}: ${item.safe_summary || "(no summary)"}`,
  );
  return redactSensitiveText(lines.join("\n")).slice(0, MAX_COMPACT_MEMORY_CHARS);
}

function recallSafetyFlags(): HermesInteractionRecallResult["safety_flags"] {
  return {
    local_file_only: true,
    read_only: true,
    redacted: true,
    tenant_scoped: true,
    bounded: true,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    network_client_implemented: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_transport_allowed: false,
    ledger_written: false,
    queue_written: false,
    approval_executed: false,
    production_ledger_written: false,
    raw_secret_exposed: false,
  };
}

export async function recallHermesInteractionMemory(options: {
  tenantId: string;
  actorUserId?: string | null;
  taskId?: string | null;
  interactionType?: string | null;
  limit?: number | string;
  scanLimit?: number | string;
  storePath?: string;
  now?: string;
}): Promise<HermesInteractionRecallResult> {
  const storePath = options.storePath ?? resolveHermesInteractionMemoryStorePath();
  const tenantId = options.tenantId.trim();
  const actorUserId = options.actorUserId?.trim() ? options.actorUserId.trim() : null;
  const taskId = options.taskId?.trim() ? options.taskId.trim() : null;
  const interactionType = options.interactionType?.trim() ? options.interactionType.trim() : null;
  const limit = clampLimit(options.limit, DEFAULT_RECALL_LIMIT, MAX_RECALL_LIMIT);
  const scanLimit = clampLimit(options.scanLimit, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);

  const scope: HermesInteractionRecallScope = {
    tenant_id: scopeValue(tenantId) ?? "",
    actor_user_id: scopeValue(actorUserId),
    task_id: scopeValue(taskId),
    interaction_type: scopeValue(interactionType),
  };

  // Empty tenant never matches anything (no cross-tenant fallback).
  if (!tenantId) {
    return {
      recalled_at: options.now ?? new Date().toISOString(),
      source: "hermes_interaction_memory_store",
      scope,
      store_path: storePath,
      scanned_records: 0,
      matched_records: 0,
      returned_records: 0,
      malformed_records: 0,
      items: [],
      compact_memory: buildCompactMemory([]),
      has_memory: false,
      safety_flags: recallSafetyFlags(),
    };
  }

  // The store read already scopes by tenant/user/task/type and redacts on read.
  const scoped = await readHermesInteractionMemoryStoreRecords({
    storePath,
    limit: scanLimit,
    tenantId,
    actorUserId,
    taskId,
    interactionType,
  });
  // Defense in depth: re-assert tenant scoping locally.
  const matched = scoped.records.filter((record) => record.tenant_id === tenantId);
  const ordered = matched
    .slice()
    .sort((left, right) => right.captured_at.localeCompare(left.captured_at))
    .slice(0, limit);
  const items = ordered.map((record) => toItem(record));

  return {
    recalled_at: options.now ?? new Date().toISOString(),
    source: "hermes_interaction_memory_store",
    scope,
    store_path: storePath,
    scanned_records: scoped.records.length,
    matched_records: matched.length,
    returned_records: items.length,
    malformed_records: scoped.malformed_lines,
    items,
    compact_memory: buildCompactMemory(items),
    has_memory: items.length > 0,
    safety_flags: recallSafetyFlags(),
  };
}
