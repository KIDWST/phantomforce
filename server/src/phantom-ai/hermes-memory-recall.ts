import { createHash } from "node:crypto";

import {
  readHermesLedgerRecords,
  redactSensitiveText,
  resolveHermesLedgerPath,
} from "./hermes-ledger.js";
import type { ActorRole, ApprovalStatus, HermesLedgerRecord, ProviderRoute, SensitivityLevel } from "./types.js";

// Hermes per-user memory recall (Phase 1a of the memory spine).
//
// This is the READ side that makes "Hermes remembers everything PhantomAI does,
// tailored per user" real. It reads the existing append-only Hermes ledger,
// scopes records to a single tenant (and optionally a single actor/user and
// task type), and returns a bounded, redacted memory packet that a future
// context build can inject so responses are personalized.
//
// Hard boundaries (matches the rest of the Hermes safety ladder):
// - READ ONLY: never writes the ledger, queue, or any store.
// - LOCAL ONLY: reads the local `.phantom/hermes-ledger.jsonl` window.
// - REDACTED: every returned string passes through redactSensitiveText.
// - BOUNDED: scan window and returned item count are both capped.
// - TENANT SCOPED: tenant A recall can never include tenant B records.
// - NO LIVE PROVIDER / NO MODEL CALL: pure derivation from stored records.

const DEFAULT_RECALL_LIMIT = 8;
const MAX_RECALL_LIMIT = 25;
const DEFAULT_SCAN_LIMIT = 200;
const MAX_SCAN_LIMIT = 500;
const MAX_SUMMARY_CHARS = 240;
const MAX_NEXT_ACTION_CHARS = 200;
const MAX_COMPACT_MEMORY_CHARS = 2400;

export type HermesMemoryRecallScope = {
  tenant_id: string;
  actor_user_id: string | null;
  task_type: string | null;
};

export type HermesMemoryItem = {
  memory_id: string;
  timestamp: string;
  tenant_id: string;
  actor_user_id: string;
  actor_role: ActorRole;
  task_type: string;
  sensitivity_level: SensitivityLevel;
  provider_route: ProviderRoute;
  model_id: string;
  user_request_summary: string;
  result_summary: string;
  approval_required: boolean;
  approval_status: ApprovalStatus;
  next_action: string;
};

export type HermesMemoryRecallResult = {
  recalled_at: string;
  scope: HermesMemoryRecallScope;
  ledger_path: string;
  scanned_records: number;
  matched_records: number;
  returned_records: number;
  malformed_records: number;
  items: HermesMemoryItem[];
  compact_memory: string;
  has_memory: boolean;
  safety_flags: {
    local_file_only: true;
    read_only: true;
    redacted: true;
    tenant_scoped: true;
    bounded: true;
    ledger_written: false;
    queue_written: false;
    live_provider_call_allowed: false;
    raw_secret_exposed: false;
  };
};

function clampLimit(value: number | string | undefined, fallback: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

function isLedgerRecord(value: unknown): value is HermesLedgerRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HermesLedgerRecord>;
  return (
    typeof record.tenant_id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.task_type === "string" &&
    typeof record.actor_user_id === "string"
  );
}

function createMemoryId(record: HermesLedgerRecord) {
  const digest = createHash("sha256")
    .update(`${record.tenant_id}:${record.actor_user_id}:${record.timestamp}:${record.request_id}:${record.task_type}`)
    .digest("hex")
    .slice(0, 24);
  return `hermes-memory-${digest}`;
}

function toMemoryItem(record: HermesLedgerRecord): HermesMemoryItem {
  return {
    memory_id: createMemoryId(record),
    timestamp: record.timestamp,
    tenant_id: redactSensitiveText(record.tenant_id).slice(0, 120),
    actor_user_id: redactSensitiveText(record.actor_user_id).slice(0, 120),
    actor_role: record.actor_role,
    task_type: redactSensitiveText(record.task_type).slice(0, 120),
    sensitivity_level: record.sensitivity_level,
    provider_route: record.provider_route,
    model_id: redactSensitiveText(record.model_id).slice(0, 160),
    user_request_summary: redactSensitiveText(record.user_request_summary ?? "").slice(0, MAX_SUMMARY_CHARS),
    result_summary: redactSensitiveText(record.result_summary ?? "").slice(0, MAX_SUMMARY_CHARS),
    approval_required: Boolean(record.approval_required),
    approval_status: record.approval_status,
    next_action: redactSensitiveText(record.next_action ?? "").slice(0, MAX_NEXT_ACTION_CHARS),
  };
}

function buildCompactMemory(items: HermesMemoryItem[]): string {
  if (!items.length) {
    return "No prior Hermes memory for this user yet.";
  }

  const lines = items.map((item) => {
    const summary = item.result_summary || item.user_request_summary || "(no summary)";
    return `- [${item.timestamp}] ${item.task_type} (${item.sensitivity_level}): ${summary}`;
  });

  return redactSensitiveText(lines.join("\n")).slice(0, MAX_COMPACT_MEMORY_CHARS);
}

export async function recallHermesMemory(options: {
  tenantId: string;
  actorUserId?: string | null;
  taskType?: string | null;
  limit?: number | string;
  scanLimit?: number | string;
  ledgerPath?: string;
  now?: string;
}): Promise<HermesMemoryRecallResult> {
  const ledgerPath = options.ledgerPath ?? resolveHermesLedgerPath();
  const tenantId = options.tenantId.trim();
  const actorUserId = options.actorUserId?.trim() ? options.actorUserId.trim() : null;
  const taskType = options.taskType?.trim() ? options.taskType.trim() : null;
  const limit = clampLimit(options.limit, DEFAULT_RECALL_LIMIT, MAX_RECALL_LIMIT);
  const scanLimit = clampLimit(options.scanLimit, DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT);

  const scope: HermesMemoryRecallScope = {
    tenant_id: redactSensitiveText(tenantId).slice(0, 120),
    actor_user_id: actorUserId ? redactSensitiveText(actorUserId).slice(0, 120) : null,
    task_type: taskType ? redactSensitiveText(taskType).slice(0, 120) : null,
  };

  // Empty tenant is never allowed to match anything (no cross-tenant fallback).
  if (!tenantId) {
    return {
      recalled_at: options.now ?? new Date().toISOString(),
      scope,
      ledger_path: ledgerPath,
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

  const rawRecords = await readHermesLedgerRecords({ ledgerPath, limit: scanLimit });
  let malformed = 0;
  const matched: HermesLedgerRecord[] = [];

  for (const candidate of rawRecords) {
    if (!isLedgerRecord(candidate)) {
      malformed += 1;
      continue;
    }
    if (candidate.tenant_id !== tenantId) continue;
    if (actorUserId && candidate.actor_user_id !== actorUserId) continue;
    if (taskType && candidate.task_type !== taskType) continue;
    matched.push(candidate);
  }

  // Most recent first, bounded to the recall limit.
  const ordered = matched
    .slice()
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit);
  const items = ordered.map((record) => toMemoryItem(record));

  return {
    recalled_at: options.now ?? new Date().toISOString(),
    scope,
    ledger_path: ledgerPath,
    scanned_records: rawRecords.length,
    matched_records: matched.length,
    returned_records: items.length,
    malformed_records: malformed,
    items,
    compact_memory: buildCompactMemory(items),
    has_memory: items.length > 0,
    safety_flags: recallSafetyFlags(),
  };
}

function recallSafetyFlags(): HermesMemoryRecallResult["safety_flags"] {
  return {
    local_file_only: true,
    read_only: true,
    redacted: true,
    tenant_scoped: true,
    bounded: true,
    ledger_written: false,
    queue_written: false,
    live_provider_call_allowed: false,
    raw_secret_exposed: false,
  };
}
