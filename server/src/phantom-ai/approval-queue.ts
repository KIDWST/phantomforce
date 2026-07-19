import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import type {
  ActorRole,
  ApprovalQueueRecord,
  ApprovalQueueRecordWithTransitions,
  ApprovalQueueReviewStatus,
  ApprovalQueueStatus,
  ApprovalQueueTransitionRecord,
  ApprovalQueueTransitionStatus,
  ApprovalQueueTransitionWriteResult,
  ApprovalQueueWriteResult,
  ApprovalRequestPreview,
} from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_APPROVAL_QUEUE_LIMIT = 50;
const MAX_APPROVAL_TRANSITION_LIMIT = 50;
const MAX_TRANSITION_NOTE_CHARS = 500;

export const DEFAULT_HERMES_APPROVAL_QUEUE_PATH = resolve(repoRoot, ".phantom", "hermes-approvals.jsonl");
export const DEFAULT_HERMES_APPROVAL_TRANSITIONS_PATH = resolve(
  repoRoot,
  ".phantom",
  "hermes-approval-transitions.jsonl",
);
export const ALLOWED_APPROVAL_TRANSITION_STATUSES: ApprovalQueueTransitionStatus[] = [
  "reviewed",
  "dismissed",
  "needs_changes",
  "expired",
];

const FORBIDDEN_APPROVAL_TRANSITION_PATTERN =
  /(approve|approved|execution|execute|run|live|send|post|upload|deploy|delete|payment|charge|billing)/i;

export function resolveHermesApprovalQueuePath(pathFromEnv = process.env.PHANTOM_HERMES_APPROVAL_QUEUE_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_APPROVAL_QUEUE_PATH;
}

export function resolveHermesApprovalTransitionsPath(
  pathFromEnv = process.env.PHANTOM_HERMES_APPROVAL_TRANSITIONS_PATH,
) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_APPROVAL_TRANSITIONS_PATH;
}

export function normalizeApprovalQueueLimit(value: number | string | undefined, fallback = 25) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_APPROVAL_QUEUE_LIMIT) : fallback;
}

export function normalizeApprovalTransitionLimit(value: number | string | undefined, fallback = 50) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit)
    ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_APPROVAL_TRANSITION_LIMIT)
    : fallback;
}

export function parseApprovalTransitionStatus(value: unknown): ApprovalQueueTransitionStatus | null {
  if (typeof value !== "string") return null;
  return (ALLOWED_APPROVAL_TRANSITION_STATUSES as string[]).includes(value)
    ? (value as ApprovalQueueTransitionStatus)
    : null;
}

export function isForbiddenApprovalTransitionStatus(value: unknown) {
  return typeof value === "string" && FORBIDDEN_APPROVAL_TRANSITION_PATTERN.test(value);
}

/* This walker only strips secrets (keys/tokens/cards), not emails/phones/SSNs,
   because it recurses over the WHOLE ApprovalRequestPreview/queue record —
   including actor_user_id/tenant_id/request_id, which must stay intact.
   That's safe today only because every current caller (see the two
   redactApprovalRequestPreview/redactApprovalQueueRecord call sites below,
   and every index.ts caller) passes an object already built by
   model-router.ts's buildApprovalRequestPreview(), which broad-redacts the
   narrative fields (summary, approval_reason, redacted_context_preview) at
   construction time before they ever reach this function. If a future
   caller ever constructs an ApprovalRequestPreview WITHOUT going through
   that function, this walker alone would NOT catch PII in its narrative
   fields — splitting this into an identifier-aware walker (redact by field
   path, not by type) would be needed at that point. */
function redactValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item)]),
    ) as T;
  }

  return value;
}

export function redactApprovalRequestPreview(approvalRequest: ApprovalRequestPreview): ApprovalRequestPreview {
  const redacted = redactValue(approvalRequest);

  return {
    ...redacted,
    action_type: redacted.action_type.slice(0, 120),
    summary: redacted.summary.slice(0, 240),
    approval_reason: redacted.approval_reason.slice(0, 800),
    requested_by: {
      ...redacted.requested_by,
      actor_user_id: redacted.requested_by.actor_user_id.slice(0, 120),
    },
    tenant_context: {
      tenant_id: redacted.tenant_context.tenant_id.slice(0, 120),
      business_name: redacted.tenant_context.business_name.slice(0, 160),
      request_id: redacted.tenant_context.request_id.slice(0, 160),
    },
    estimated_impact: {
      ...redacted.estimated_impact,
      model_id: redacted.estimated_impact.model_id.slice(0, 160),
    },
    redacted_context_preview: redacted.redacted_context_preview.slice(0, 2400),
    safety_flags: {
      ...redacted.safety_flags,
      dry_run: true,
      execution_disabled: true,
      approval_execution_implemented: false,
      live_provider_call_allowed: false,
      ledger_write_allowed: false,
      secrets_redacted: true,
    },
    execution_disabled: true,
  };
}

export function redactApprovalQueueRecord(record: ApprovalQueueRecord): ApprovalQueueRecord {
  return {
    ...redactValue(record),
    approval: redactApprovalRequestPreview(record.approval),
    execution_disabled: true,
    queue_safety: {
      local_file_only: true,
      redacted: true,
      approval_execution_implemented: false,
      live_action_allowed: false,
      ledger_write_allowed: false,
    },
  };
}

export function redactApprovalQueueTransitionRecord(
  record: ApprovalQueueTransitionRecord,
): ApprovalQueueTransitionRecord {
  const redacted = redactValue(record);

  return {
    ...redacted,
    queue_id: redacted.queue_id.slice(0, 120),
    from_status: redacted.from_status,
    to_status: redacted.to_status,
    requested_by: {
      actor_user_id: redacted.requested_by.actor_user_id.slice(0, 120),
      actor_role: redacted.requested_by.actor_role,
    },
    note: redacted.note.slice(0, MAX_TRANSITION_NOTE_CHARS),
    execution_disabled: true,
    safety_flags: {
      local_file_only: true,
      redacted: true,
      status_only: true,
      approval_execution_implemented: false,
      live_action_allowed: false,
      ledger_write_allowed: false,
    },
  };
}

function getApprovalQueueRecordStatus(approvalRequest: ApprovalRequestPreview): ApprovalQueueStatus {
  if (approvalRequest.status === "preview-only") return "preview_only";
  if (approvalRequest.status === "blocked") return "blocked_preview";
  return "pending";
}

function createApprovalQueueId(approvalRequest: ApprovalRequestPreview, queuedAt: string) {
  const digest = createHash("sha256")
    .update(`${approvalRequest.approval_id}:${approvalRequest.status}:${queuedAt}`)
    .digest("hex")
    .slice(0, 24);
  return `queue-${digest}`;
}

export function createApprovalQueueRecord(
  approvalRequest: ApprovalRequestPreview,
  options: { queuedAt?: string } = {},
): ApprovalQueueRecord {
  const queuedAt = options.queuedAt ?? new Date().toISOString();
  const redactedApproval = redactApprovalRequestPreview(approvalRequest);

  return {
    queue_id: createApprovalQueueId(redactedApproval, queuedAt),
    queued_at: queuedAt,
    queue_status: getApprovalQueueRecordStatus(redactedApproval),
    source: "admin-preview",
    approval: redactedApproval,
    execution_disabled: true,
    queue_safety: {
      local_file_only: true,
      redacted: true,
      approval_execution_implemented: false,
      live_action_allowed: false,
      ledger_write_allowed: false,
    },
  };
}

export async function persistApprovalQueuePreview(
  approvalRequest: ApprovalRequestPreview,
  options: {
    queuePath?: string;
    allowPreviewOnly?: boolean;
  } = {},
): Promise<ApprovalQueueWriteResult> {
  if (approvalRequest.status === "preview-only" && !options.allowPreviewOnly) {
    return {
      queued: false,
      reason: "preview_only_not_queued",
      record: null,
    };
  }

  const queuePath = options.queuePath ?? resolveHermesApprovalQueuePath();
  const record = createApprovalQueueRecord(approvalRequest);
  await mkdir(dirname(queuePath), { recursive: true });
  await appendFile(queuePath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    queued: true,
    reason: "queued",
    record,
  };
}

function isApprovalQueueRecord(value: unknown): value is ApprovalQueueRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ApprovalQueueRecord>;
  return (
    typeof record.queue_id === "string" &&
    typeof record.queued_at === "string" &&
    typeof record.queue_status === "string" &&
    record.approval !== undefined &&
    record.execution_disabled === true
  );
}

export async function readApprovalQueueRecords(
  options: { queuePath?: string; limit?: number | string } = {},
): Promise<{
  queuePath: string;
  limit: number;
  records: ApprovalQueueRecord[];
  malformed_lines: number;
}> {
  const queuePath = options.queuePath ?? resolveHermesApprovalQueuePath();
  const limit = normalizeApprovalQueueLimit(options.limit);

  try {
    const raw = await readFile(queuePath, "utf8");
    const records: ApprovalQueueRecord[] = [];
    let malformedLines = 0;

    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isApprovalQueueRecord(parsed)) {
          records.push(redactApprovalQueueRecord(parsed));
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    return {
      queuePath,
      limit,
      records: records.slice(-limit),
      malformed_lines: malformedLines,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        queuePath,
        limit,
        records: [],
        malformed_lines: 0,
      };
    }

    throw error;
  }
}

function isApprovalQueueTransitionRecord(value: unknown): value is ApprovalQueueTransitionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ApprovalQueueTransitionRecord>;
  return (
    typeof record.transition_id === "string" &&
    typeof record.queue_id === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.to_status === "string" &&
    record.execution_disabled === true
  );
}

export async function readApprovalQueueTransitions(
  options: { transitionsPath?: string; limit?: number | string } = {},
): Promise<{
  transitionsPath: string;
  limit: number;
  records: ApprovalQueueTransitionRecord[];
  malformed_lines: number;
}> {
  const transitionsPath = options.transitionsPath ?? resolveHermesApprovalTransitionsPath();
  const limit = normalizeApprovalTransitionLimit(options.limit);

  try {
    const raw = await readFile(transitionsPath, "utf8");
    const records: ApprovalQueueTransitionRecord[] = [];
    let malformedLines = 0;

    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isApprovalQueueTransitionRecord(parsed)) {
          records.push(redactApprovalQueueTransitionRecord(parsed));
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }

    return {
      transitionsPath,
      limit,
      records: records.slice(-limit),
      malformed_lines: malformedLines,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        transitionsPath,
        limit,
        records: [],
        malformed_lines: 0,
      };
    }

    throw error;
  }
}

function deriveRecordTransitions(
  record: ApprovalQueueRecord,
  transitions: ApprovalQueueTransitionRecord[],
): ApprovalQueueRecordWithTransitions {
  const recordTransitions = transitions
    .filter((transition) => transition.queue_id === record.queue_id)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const latestTransition = recordTransitions.at(-1) ?? null;

  return {
    ...record,
    latest_review_status: latestTransition?.to_status ?? "unreviewed",
    transition_count: recordTransitions.length,
    latest_transition_at: latestTransition?.timestamp ?? null,
    latest_transition: latestTransition,
  };
}

export async function readApprovalQueueWithTransitions(
  options: {
    queuePath?: string;
    transitionsPath?: string;
    limit?: number | string;
  } = {},
): Promise<{
  queuePath: string;
  transitionsPath: string;
  limit: number;
  transition_limit: number;
  records: ApprovalQueueRecordWithTransitions[];
  malformed_lines: number;
  transition_malformed_lines: number;
}> {
  const queue = await readApprovalQueueRecords({
    queuePath: options.queuePath,
    limit: options.limit,
  });
  const transitions = await readApprovalQueueTransitions({
    transitionsPath: options.transitionsPath,
    limit: MAX_APPROVAL_TRANSITION_LIMIT,
  });

  return {
    queuePath: queue.queuePath,
    transitionsPath: transitions.transitionsPath,
    limit: queue.limit,
    transition_limit: transitions.limit,
    records: queue.records.map((record) => deriveRecordTransitions(record, transitions.records)),
    malformed_lines: queue.malformed_lines,
    transition_malformed_lines: transitions.malformed_lines,
  };
}

function createApprovalQueueTransitionId(
  queueId: string,
  toStatus: ApprovalQueueTransitionStatus,
  timestamp: string,
  note: string,
) {
  const digest = createHash("sha256").update(`${queueId}:${toStatus}:${timestamp}:${note}`).digest("hex").slice(0, 24);
  return `transition-${digest}`;
}

export function createApprovalQueueTransitionRecord(options: {
  queueId: string;
  fromStatus: ApprovalQueueReviewStatus;
  toStatus: ApprovalQueueTransitionStatus;
  requestedBy: {
    actor_user_id: string;
    actor_role: ActorRole;
  };
  note?: string;
  timestamp?: string;
}): ApprovalQueueTransitionRecord {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const note = redactSensitiveText(options.note ?? "").slice(0, MAX_TRANSITION_NOTE_CHARS);

  return redactApprovalQueueTransitionRecord({
    transition_id: createApprovalQueueTransitionId(options.queueId, options.toStatus, timestamp, note),
    queue_id: options.queueId.slice(0, 120),
    from_status: options.fromStatus,
    to_status: options.toStatus,
    requested_by: {
      actor_user_id: redactSensitiveText(options.requestedBy.actor_user_id),
      actor_role: options.requestedBy.actor_role,
    },
    timestamp,
    note,
    execution_disabled: true,
    safety_flags: {
      local_file_only: true,
      redacted: true,
      status_only: true,
      approval_execution_implemented: false,
      live_action_allowed: false,
      ledger_write_allowed: false,
    },
  });
}

export async function appendApprovalQueueTransition(options: {
  queueId: string;
  toStatus: ApprovalQueueTransitionStatus;
  requestedBy: {
    actor_user_id: string;
    actor_role: ActorRole;
  };
  note?: string;
  queuePath?: string;
  transitionsPath?: string;
  /* Callers outside the platform-admin approval queue (which is meant to see
     every tenant) must pass the caller's own tenant id here. Without it, any
     authenticated session could transition another tenant's approval record
     just by guessing/enumerating its queue_id — the queue file itself has no
     per-tenant partition, so this check is the only tenant boundary. */
  expectedTenantId?: string;
}): Promise<ApprovalQueueTransitionWriteResult | null> {
  const queue = await readApprovalQueueWithTransitions({
    queuePath: options.queuePath,
    transitionsPath: options.transitionsPath,
    limit: MAX_APPROVAL_QUEUE_LIMIT,
  });
  const existingRecord = queue.records.find((record) => record.queue_id === options.queueId);

  if (!existingRecord) {
    return null;
  }

  if (options.expectedTenantId && existingRecord.approval.tenant_context.tenant_id !== options.expectedTenantId) {
    return null;
  }

  const transition = createApprovalQueueTransitionRecord({
    queueId: existingRecord.queue_id,
    fromStatus: existingRecord.latest_review_status,
    toStatus: options.toStatus,
    requestedBy: options.requestedBy,
    note: options.note,
  });
  const transitionsPath = options.transitionsPath ?? resolveHermesApprovalTransitionsPath();
  await mkdir(dirname(transitionsPath), { recursive: true });
  await appendFile(transitionsPath, `${JSON.stringify(transition)}\n`, "utf8");

  return {
    transitioned: true,
    transition,
    record: {
      ...existingRecord,
      latest_review_status: transition.to_status,
      transition_count: existingRecord.transition_count + 1,
      latest_transition_at: transition.timestamp,
      latest_transition: transition,
    },
  };
}

export async function getApprovalQueueFileStatus(options: { queuePath?: string } = {}) {
  const queuePath = options.queuePath ?? resolveHermesApprovalQueuePath();

  try {
    const fileStat = await stat(queuePath);
    return {
      enabled: true,
      exists: true,
      queuePath,
      bytes: fileStat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        queuePath,
        bytes: 0,
      };
    }

    throw error;
  }
}

export async function getApprovalTransitionFileStatus(options: { transitionsPath?: string } = {}) {
  const transitionsPath = options.transitionsPath ?? resolveHermesApprovalTransitionsPath();

  try {
    const fileStat = await stat(transitionsPath);
    return {
      enabled: true,
      exists: true,
      transitionsPath,
      bytes: fileStat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        enabled: true,
        exists: false,
        transitionsPath,
        bytes: 0,
      };
    }

    throw error;
  }
}
