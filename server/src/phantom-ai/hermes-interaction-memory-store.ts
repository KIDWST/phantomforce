import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import { buildHermesInteractionMemoryPreview } from "./hermes-interaction-memory.js";
import type { HermesInteractionMemoryPreview, HermesInteractionMemoryRecordPreview } from "./hermes-interaction-memory.js";
import type { ModelRouterRunResult } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_INTERACTION_MEMORY_STORE_LIMIT = 50;
const SENSITIVE_OBJECT_KEY_PATTERN =
  /(api[_-]?key|authorization|bearer|card|cc|credit|password|secret|token)/i;

export const DEFAULT_HERMES_INTERACTION_MEMORY_STORE_PATH = resolve(
  repoRoot,
  ".phantom",
  "hermes-interaction-memory.jsonl",
);

export type HermesInteractionMemoryStoreRecord = {
  record_id: string;
  persisted_at: string;
  store_kind: "local_dev_only_interaction_memory_store";
  store_version: 1;
  source: HermesInteractionMemoryRecordPreview["source"];
  interaction_record_id: string;
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
  interaction_type: string;
  captured_at: string;
  memory_record: HermesInteractionMemoryRecordPreview;
  redaction: {
    redacted: true;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
    raw_prompt_returned: false;
  };
  local_dev_only: true;
  interaction_memory_store_written: true;
  hermes_ledger_written: false;
  external_ledger_written: false;
  production_ledger_written: false;
  production_write_allowed: false;
  provider_request_body_created: false;
  provider_called: false;
  network_call_performed: false;
  queue_written: false;
  approval_executed: false;
  live_call_allowed: false;
  execution_disabled: true;
  ready_for_send: false;
  provider_transport_allowed: false;
  safety_flags: {
    local_file_only: true;
    local_dev_only: true;
    redacted: true;
    tenant_scoped: true;
    bounded: true;
    provider_request_body_created: false;
    provider_transport_allowed: false;
    network_client_implemented: false;
    provider_called: false;
    network_call_performed: false;
    live_call_allowed: false;
    execution_disabled: true;
    ready_for_send: false;
    hermes_ledger_written: false;
    external_ledger_written: false;
    production_ledger_written: false;
    queue_written: false;
    approval_executed: false;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
  };
};

export type HermesInteractionMemoryStorePersistenceResult = {
  persisted: boolean;
  reason: "persisted_local_dev_only" | "production_write_blocked";
  store_path: string;
  record: HermesInteractionMemoryStoreRecord | null;
  provider_request_body_created: false;
  provider_called: false;
  network_call_performed: false;
  hermes_ledger_written: false;
  external_ledger_written: false;
  production_ledger_written: false;
  production_write_allowed: false;
  queue_written: false;
  approval_executed: false;
  live_call_allowed: false;
  execution_disabled: true;
  ready_for_send: false;
  provider_transport_allowed: false;
};

export type HermesInteractionMemoryStoreReadResult = {
  store_path: string;
  limit: number;
  records: HermesInteractionMemoryStoreRecord[];
  malformed_lines: number;
};

export type HermesInteractionMemoryStoreStatus = {
  enabled: true;
  exists: boolean;
  store_path: string;
  bytes: number;
  local_dev_only: true;
  production_write_allowed: false;
};

export type HermesInteractionMemoryRecordOnRunResult = {
  memory_preview: HermesInteractionMemoryPreview;
  persistence: HermesInteractionMemoryStorePersistenceResult;
  provider_request_body_created: false;
  provider_called: false;
  network_call_performed: false;
  hermes_interaction_memory_store_written: boolean;
  queue_written: false;
  approval_executed: false;
  production_ledger_written: false;
  production_write_allowed: false;
  live_call_allowed: false;
  execution_disabled: true;
  ready_for_send: false;
  provider_transport_allowed: false;
};

const blockedStoreFlags = {
  provider_request_body_created: false,
  provider_called: false,
  network_call_performed: false,
  hermes_ledger_written: false,
  external_ledger_written: false,
  production_ledger_written: false,
  production_write_allowed: false,
  queue_written: false,
  approval_executed: false,
  live_call_allowed: false,
  execution_disabled: true,
  ready_for_send: false,
  provider_transport_allowed: false,
} as const;

export function resolveHermesInteractionMemoryStorePath(
  pathFromEnv = process.env.PHANTOM_HERMES_INTERACTION_MEMORY_STORE_PATH,
) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_INTERACTION_MEMORY_STORE_PATH;
}

export function normalizeHermesInteractionMemoryStoreLimit(value: number | string | undefined, fallback = 25) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_INTERACTION_MEMORY_STORE_LIMIT)
    : fallback;
}

function isLocalDevInteractionMemoryStoreAllowed(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return (env.NODE_ENV ?? "development") !== "production";
}

function redactValue<T>(value: T, keyHint = ""): T {
  if (typeof value === "string") {
    return (SENSITIVE_OBJECT_KEY_PATTERN.test(keyHint) ? "[redacted]" : redactSensitiveText(value)) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, keyHint)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, key)]),
    ) as T;
  }

  return value;
}

function assertPreviewStillBlocked(preview: HermesInteractionMemoryPreview) {
  return (
    preview.provider_request_body_created === false &&
    preview.provider_called === false &&
    preview.network_call_performed === false &&
    preview.queue_written === false &&
    preview.approval_executed === false &&
    preview.production_ledger_write === false &&
    preview.live_call_allowed === false &&
    preview.execution_disabled === true &&
    preview.ready_for_send === false &&
    preview.provider_transport_allowed === false &&
    preview.record.safety_flags.provider_request_body_created === false &&
    preview.record.safety_flags.network_client_implemented === false &&
    preview.record.safety_flags.provider_called === false &&
    preview.record.safety_flags.network_call_performed === false &&
    preview.record.safety_flags.ledger_written === false &&
    preview.record.safety_flags.queue_written === false &&
    preview.record.safety_flags.approval_executed === false
  );
}

function createStoreRecordId(record: HermesInteractionMemoryRecordPreview, persistedAt: string) {
  const digest = createHash("sha256")
    .update(`${record.record_id}:${record.tenant_id}:${record.actor_user_id ?? ""}:${record.task_id ?? ""}:${persistedAt}`)
    .digest("hex")
    .slice(0, 24);
  return `hermes-interaction-store-${digest}`;
}

function storeSafetyFlags(): HermesInteractionMemoryStoreRecord["safety_flags"] {
  return {
    local_file_only: true,
    local_dev_only: true,
    redacted: true,
    tenant_scoped: true,
    bounded: true,
    provider_request_body_created: false,
    provider_transport_allowed: false,
    network_client_implemented: false,
    provider_called: false,
    network_call_performed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    hermes_ledger_written: false,
    external_ledger_written: false,
    production_ledger_written: false,
    queue_written: false,
    approval_executed: false,
    raw_secret_exposed: false,
    raw_prompt_stored: false,
  };
}

export function createHermesInteractionMemoryStoreRecord(
  preview: HermesInteractionMemoryPreview,
  options: { persistedAt?: string } = {},
): HermesInteractionMemoryStoreRecord {
  if (!assertPreviewStillBlocked(preview)) {
    throw new Error("Hermes interaction memory store requires a fully blocked preview.");
  }

  const persistedAt = options.persistedAt ?? new Date().toISOString();
  const memoryRecord = redactValue(preview.record);

  return {
    ...blockedStoreFlags,
    record_id: createStoreRecordId(memoryRecord, persistedAt),
    persisted_at: persistedAt,
    store_kind: "local_dev_only_interaction_memory_store",
    store_version: 1,
    source: memoryRecord.source,
    interaction_record_id: memoryRecord.record_id,
    tenant_id: memoryRecord.tenant_id,
    actor_user_id: memoryRecord.actor_user_id,
    task_id: memoryRecord.task_id,
    interaction_type: memoryRecord.interaction_type,
    captured_at: memoryRecord.captured_at,
    memory_record: memoryRecord,
    redaction: {
      redacted: true,
      raw_secret_exposed: false,
      raw_prompt_stored: false,
      raw_prompt_returned: false,
    },
    local_dev_only: true,
    interaction_memory_store_written: true,
    hermes_ledger_written: false,
    external_ledger_written: false,
    production_ledger_written: false,
    production_write_allowed: false,
    safety_flags: storeSafetyFlags(),
  };
}

export async function persistHermesInteractionMemoryPreview(
  preview: HermesInteractionMemoryPreview,
  options: {
    storePath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    persistedAt?: string;
  } = {},
): Promise<HermesInteractionMemoryStorePersistenceResult> {
  const storePath = options.storePath ?? resolveHermesInteractionMemoryStorePath();

  if (!isLocalDevInteractionMemoryStoreAllowed(options.env ?? process.env)) {
    return {
      ...blockedStoreFlags,
      persisted: false,
      reason: "production_write_blocked",
      store_path: storePath,
      record: null,
    };
  }

  const record = createHermesInteractionMemoryStoreRecord(preview, {
    persistedAt: options.persistedAt,
  });
  await mkdir(dirname(storePath), { recursive: true });
  await appendFile(storePath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    ...blockedStoreFlags,
    persisted: true,
    reason: "persisted_local_dev_only",
    store_path: storePath,
    record,
  };
}

function summarizeRunForMemory(run: ModelRouterRunResult) {
  const record = run.ledger_record;
  const segment = (value: string, maxChars: number) => redactSensitiveText(value).replace(/\s+/g, " ").trim().slice(0, maxChars);
  const lines = [
    `Task: ${segment(record.task_type, 40)}`,
    `Approval: ${segment(record.approval_status, 16)}`,
    `Next action: ${segment(record.next_action, 50)}`,
    `Request summary: ${segment(record.user_request_summary, 55)}`,
    `Result: ${segment(record.result_summary, 55)}`,
  ];

  return redactSensitiveText(lines.join(" | "));
}

export async function recordHermesInteractionMemoryFromRun(
  run: ModelRouterRunResult,
  options: {
    storePath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    persistedAt?: string;
    now?: string;
  } = {},
): Promise<HermesInteractionMemoryRecordOnRunResult> {
  const record = run.ledger_record;
  const memoryPreview = buildHermesInteractionMemoryPreview(
    {
      tenant_id: record.tenant_id,
      actor_user_id: record.actor_user_id,
      task_id: record.parent_task_id ?? record.request_id,
      interaction_type: record.task_type,
      summary: summarizeRunForMemory(run),
      metadata: {
        approval_status: record.approval_status,
        approval_required: record.approval_required,
        sensitivity_level: record.sensitivity_level,
        provider_called: run.provider_invocation.dry_run_result.provider_called,
        network_call_performed: run.provider_invocation.dry_run_result.network_call_performed,
        ready_for_send: run.provider_invocation.live_call_allowed,
        execution_disabled: run.provider_invocation.execution_disabled,
      },
    },
    { now: options.now },
  );
  const persistence = await persistHermesInteractionMemoryPreview(memoryPreview, {
    storePath: options.storePath,
    env: options.env,
    persistedAt: options.persistedAt,
  });

  return {
    ...blockedStoreFlags,
    memory_preview: memoryPreview,
    persistence,
    hermes_interaction_memory_store_written: persistence.persisted,
  };
}

function isHermesInteractionMemoryStoreRecord(value: unknown): value is HermesInteractionMemoryStoreRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HermesInteractionMemoryStoreRecord>;
  return (
    typeof record.record_id === "string" &&
    record.store_kind === "local_dev_only_interaction_memory_store" &&
    record.local_dev_only === true &&
    record.interaction_memory_store_written === true &&
    record.hermes_ledger_written === false &&
    record.external_ledger_written === false &&
    record.production_ledger_written === false &&
    record.production_write_allowed === false &&
    record.provider_request_body_created === false &&
    record.provider_called === false &&
    record.network_call_performed === false &&
    record.queue_written === false &&
    record.approval_executed === false &&
    record.ready_for_send === false &&
    typeof record.tenant_id === "string" &&
    record.memory_record !== undefined
  );
}

function matchesScope(
  record: HermesInteractionMemoryStoreRecord,
  options: {
    tenantId?: string | null;
    actorUserId?: string | null;
    taskId?: string | null;
    interactionType?: string | null;
  },
) {
  if (options.tenantId?.trim() && record.tenant_id !== options.tenantId.trim()) return false;
  if (options.actorUserId?.trim() && record.actor_user_id !== options.actorUserId.trim()) return false;
  if (options.taskId?.trim() && record.task_id !== options.taskId.trim()) return false;
  if (options.interactionType?.trim() && record.interaction_type !== options.interactionType.trim()) return false;
  return true;
}

export async function readHermesInteractionMemoryStoreRecords(
  options: {
    storePath?: string;
    limit?: number | string;
    tenantId?: string | null;
    actorUserId?: string | null;
    taskId?: string | null;
    interactionType?: string | null;
  } = {},
): Promise<HermesInteractionMemoryStoreReadResult> {
  const storePath = options.storePath ?? resolveHermesInteractionMemoryStorePath();
  const limit = normalizeHermesInteractionMemoryStoreLimit(options.limit);

  try {
    const raw = await readFile(storePath, "utf8");
    const records: HermesInteractionMemoryStoreRecord[] = [];
    let malformedLines = 0;

    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed = redactValue(JSON.parse(line));

        if (isHermesInteractionMemoryStoreRecord(parsed)) {
          records.push(parsed);
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    return {
      store_path: storePath,
      limit,
      records: records.filter((record) => matchesScope(record, options)).slice(-limit),
      malformed_lines: malformedLines,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        store_path: storePath,
        limit,
        records: [],
        malformed_lines: 0,
      };
    }

    throw error;
  }
}

export async function getHermesInteractionMemoryStoreStatus(
  options: { storePath?: string } = {},
): Promise<HermesInteractionMemoryStoreStatus> {
  const storePath = options.storePath ?? resolveHermesInteractionMemoryStorePath();

  try {
    const fileStat = await stat(storePath);
    return {
      enabled: true,
      exists: true,
      store_path: storePath,
      bytes: fileStat.size,
      local_dev_only: true,
      production_write_allowed: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        store_path: storePath,
        bytes: 0,
        local_dev_only: true,
        production_write_allowed: false,
      };
    }

    throw error;
  }
}
