import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import type {
  ApprovalQueueRecord,
  ApprovalQueueStatus,
  ApprovalQueueWriteResult,
  ApprovalRequestPreview,
} from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_APPROVAL_QUEUE_LIMIT = 50;

export const DEFAULT_HERMES_APPROVAL_QUEUE_PATH = resolve(repoRoot, ".phantom", "hermes-approvals.jsonl");

export function resolveHermesApprovalQueuePath(pathFromEnv = process.env.PHANTOM_HERMES_APPROVAL_QUEUE_PATH) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_APPROVAL_QUEUE_PATH;
}

export function normalizeApprovalQueueLimit(value: number | string | undefined, fallback = 25) {
  const parsedLimit = Number(value ?? fallback);
  return Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), MAX_APPROVAL_QUEUE_LIMIT) : fallback;
}

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
