import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactSensitiveText } from "./hermes-ledger.js";
import type { HermesLedgerRecord, ModelRouterRunResult } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const MAX_LEARNING_DATASET_LIMIT = 100;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;
const MAX_PROMPT_SUMMARY_CHARS = 700;
const MAX_RESPONSE_SUMMARY_CHARS = 900;
const MAX_ID_CHARS = 120;
const MAX_RATING = 5;

export const DEFAULT_HERMES_LEARNING_DATASET_PATH = resolve(
  repoRoot,
  ".phantom",
  "hermes-learning-examples.jsonl",
);

export type HermesLearningQualityLabel =
  | "unreviewed"
  | "approved"
  | "corrected"
  | "needs_review"
  | "rejected";

export type HermesLearningSourceTool = "phantom_ai" | "codex" | "claude" | "jordan" | "import";

export type HermesLearningDatasetExampleInput = {
  tenant_id: string;
  actor_user_id?: string | null;
  task_id?: string | null;
  task_type?: string | null;
  interaction_type?: string | null;
  source_tool?: HermesLearningSourceTool;
  source_run_id?: string | null;
  source_record_id?: string | null;
  prompt_summary: string;
  assistant_response_summary: string;
  ideal_response_summary?: string | null;
  correction_summary?: string | null;
  quality_label?: HermesLearningQualityLabel;
  rating?: number | null;
  tags?: string[];
  approved_for_finetune?: boolean;
  source_provider_called?: boolean;
  source_network_call_performed?: boolean;
};

export type HermesLearningDatasetExample = {
  example_id: string;
  created_at: string;
  dataset_kind: "hermes_local_learning_example";
  dataset_version: 1;
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
  task_type: string;
  interaction_type: string;
  source_tool: HermesLearningSourceTool;
  source_run_id: string | null;
  source_record_id: string | null;
  prompt_summary: string;
  assistant_response_summary: string;
  ideal_response_summary: string | null;
  correction_summary: string | null;
  quality_label: HermesLearningQualityLabel;
  rating: number | null;
  tags: string[];
  approved_for_finetune: boolean;
  training_split: "unassigned";
  local_dev_only: true;
  redaction: {
    redacted: true;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
    raw_prompt_returned: false;
    full_transcript_stored: false;
  };
  source_safety: {
    source_provider_called: boolean;
    source_network_call_performed: boolean;
  };
  safety_flags: {
    local_file_only: true;
    local_dev_only: true;
    tenant_scoped: true;
    bounded: true;
    redacted: true;
    review_required_before_finetune: boolean;
    fine_tune_export_allowed: boolean;
    provider_request_body_created: false;
    provider_called: false;
    network_call_performed: false;
    queue_written: false;
    approval_executed: false;
    production_ledger_written: false;
    external_action_executed: false;
    live_call_allowed: false;
    execution_disabled: true;
    raw_secret_exposed: false;
  };
};

export type HermesLearningDatasetPersistenceResult = {
  persisted: boolean;
  reason: "persisted_local_dev_only" | "production_write_blocked" | "capture_disabled";
  dataset_path: string;
  example: HermesLearningDatasetExample | null;
  provider_request_body_created: false;
  provider_called: false;
  network_call_performed: false;
  queue_written: false;
  approval_executed: false;
  production_ledger_written: false;
  external_action_executed: false;
  live_call_allowed: false;
  execution_disabled: true;
};

export type HermesLearningDatasetReadResult = {
  dataset_path: string;
  limit: number;
  examples: HermesLearningDatasetExample[];
  malformed_lines: number;
};

export type HermesLearningDatasetStatus = {
  enabled: boolean;
  exists: boolean;
  dataset_path: string;
  bytes: number;
  local_dev_only: true;
  production_write_allowed: false;
  estimated_examples_at_current_size: number;
  storage_note: string;
};

export type HermesTrainingExportPreview = {
  exported_at: string;
  dataset_path: string;
  source_examples_scanned: number;
  exported_examples: number;
  include_unreviewed: boolean;
  format: "chat_messages_jsonl_preview";
  jsonl_preview: string;
  records: Array<{
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    metadata: {
      example_id: string;
      tenant_id: string;
      task_type: string;
      source_tool: HermesLearningSourceTool;
      quality_label: HermesLearningQualityLabel;
      approved_for_finetune: boolean;
    };
  }>;
  safety_flags: {
    preview_only: true;
    local_file_only: true;
    redacted: true;
    approved_examples_only: boolean;
    provider_called: false;
    network_call_performed: false;
    queue_written: false;
    approval_executed: false;
    external_action_executed: false;
    production_ledger_written: false;
  };
};

const blockedPersistenceFlags = {
  provider_request_body_created: false,
  provider_called: false,
  network_call_performed: false,
  queue_written: false,
  approval_executed: false,
  production_ledger_written: false,
  external_action_executed: false,
  live_call_allowed: false,
  execution_disabled: true,
} as const;

export function resolveHermesLearningDatasetPath(
  pathFromEnv = process.env.PHANTOM_HERMES_LEARNING_DATASET_PATH,
) {
  return pathFromEnv?.trim() ? resolve(pathFromEnv) : DEFAULT_HERMES_LEARNING_DATASET_PATH;
}

export function normalizeHermesLearningDatasetLimit(value: number | string | undefined, fallback = 25) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(Math.floor(parsed), 1), MAX_LEARNING_DATASET_LIMIT)
    : fallback;
}

function isLocalLearningDatasetAllowed(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return (env.NODE_ENV ?? "development") !== "production";
}

function isLearningCaptureEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return env.PHANTOM_HERMES_LEARNING_CAPTURE_ENABLED !== "false";
}

function boundText(value: unknown, maxChars: number) {
  return redactSensitiveText(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, maxChars);
}

function idValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const safe = boundText(value, MAX_ID_CHARS);
  return safe || null;
}

function cleanQualityLabel(value: unknown): HermesLearningQualityLabel {
  if (
    value === "approved" ||
    value === "corrected" ||
    value === "needs_review" ||
    value === "rejected" ||
    value === "unreviewed"
  ) {
    return value;
  }
  return "unreviewed";
}

function cleanSourceTool(value: unknown): HermesLearningSourceTool {
  if (value === "codex" || value === "claude" || value === "jordan" || value === "import") return value;
  return "phantom_ai";
}

function cleanRating(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(Math.round(parsed), 1), MAX_RATING);
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => boundText(tag, MAX_TAG_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
}

function createExampleId(input: {
  tenant_id: string;
  actor_user_id: string | null;
  source_run_id: string | null;
  prompt_summary: string;
  created_at: string;
}) {
  const digest = createHash("sha256")
    .update(
      `${input.tenant_id}:${input.actor_user_id ?? ""}:${input.source_run_id ?? ""}:${input.prompt_summary}:${input.created_at}`,
    )
    .digest("hex")
    .slice(0, 24);
  return `hermes-learning-${digest}`;
}

function buildSafetyFlags(
  approvedForFinetune: boolean,
): HermesLearningDatasetExample["safety_flags"] {
  return {
    local_file_only: true,
    local_dev_only: true,
    tenant_scoped: true,
    bounded: true,
    redacted: true,
    review_required_before_finetune: !approvedForFinetune,
    fine_tune_export_allowed: approvedForFinetune,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    queue_written: false,
    approval_executed: false,
    production_ledger_written: false,
    external_action_executed: false,
    live_call_allowed: false,
    execution_disabled: true,
    raw_secret_exposed: false,
  };
}

export function buildHermesLearningDatasetExample(
  input: HermesLearningDatasetExampleInput,
  options: { now?: string } = {},
): HermesLearningDatasetExample {
  const createdAt = options.now ?? new Date().toISOString();
  const tenantId = boundText(input.tenant_id, MAX_ID_CHARS);
  const actorUserId = idValue(input.actor_user_id);
  const sourceRunId = idValue(input.source_run_id);
  const qualityLabel = cleanQualityLabel(input.quality_label);
  const approvedForFinetune = Boolean(input.approved_for_finetune) && (
    qualityLabel === "approved" || qualityLabel === "corrected"
  );
  const promptSummary = boundText(input.prompt_summary, MAX_PROMPT_SUMMARY_CHARS);

  return {
    example_id: createExampleId({
      tenant_id: tenantId,
      actor_user_id: actorUserId,
      source_run_id: sourceRunId,
      prompt_summary: promptSummary,
      created_at: createdAt,
    }),
    created_at: createdAt,
    dataset_kind: "hermes_local_learning_example",
    dataset_version: 1,
    tenant_id: tenantId,
    actor_user_id: actorUserId,
    task_id: idValue(input.task_id),
    task_type: boundText(input.task_type ?? "phantom_ai_response", MAX_ID_CHARS) || "phantom_ai_response",
    interaction_type: boundText(input.interaction_type ?? "response_example", MAX_ID_CHARS) || "response_example",
    source_tool: cleanSourceTool(input.source_tool),
    source_run_id: sourceRunId,
    source_record_id: idValue(input.source_record_id),
    prompt_summary: promptSummary,
    assistant_response_summary: boundText(input.assistant_response_summary, MAX_RESPONSE_SUMMARY_CHARS),
    ideal_response_summary: input.ideal_response_summary
      ? boundText(input.ideal_response_summary, MAX_RESPONSE_SUMMARY_CHARS)
      : null,
    correction_summary: input.correction_summary
      ? boundText(input.correction_summary, MAX_RESPONSE_SUMMARY_CHARS)
      : null,
    quality_label: qualityLabel,
    rating: cleanRating(input.rating),
    tags: cleanTags(input.tags),
    approved_for_finetune: approvedForFinetune,
    training_split: "unassigned",
    local_dev_only: true,
    redaction: {
      redacted: true,
      raw_secret_exposed: false,
      raw_prompt_stored: false,
      raw_prompt_returned: false,
      full_transcript_stored: false,
    },
    source_safety: {
      source_provider_called: Boolean(input.source_provider_called),
      source_network_call_performed: Boolean(input.source_network_call_performed),
    },
    safety_flags: buildSafetyFlags(approvedForFinetune),
  };
}

export function buildHermesLearningExampleFromLedgerRecord(
  record: HermesLedgerRecord,
  options: {
    assistantResponseSummary?: string;
    qualityLabel?: HermesLearningQualityLabel;
    approvedForFinetune?: boolean;
    sourceProviderCalled?: boolean;
    sourceNetworkCallPerformed?: boolean;
    now?: string;
  } = {},
) {
  return buildHermesLearningDatasetExample(
    {
      tenant_id: record.tenant_id,
      actor_user_id: record.actor_user_id,
      task_id: record.parent_task_id ?? record.request_id,
      task_type: record.task_type,
      interaction_type: "phantom_ai_chat_response",
      source_tool: "phantom_ai",
      source_run_id: record.agent_run_id ?? record.request_id,
      source_record_id: record.request_id,
      prompt_summary: record.user_request_summary,
      assistant_response_summary: options.assistantResponseSummary ?? record.result_summary,
      quality_label: options.qualityLabel ?? "unreviewed",
      approved_for_finetune: options.approvedForFinetune ?? false,
      tags: ["auto-captured", record.provider_route, record.task_type],
      source_provider_called: options.sourceProviderCalled ?? record.provider_route !== "mock",
      source_network_call_performed: options.sourceNetworkCallPerformed ?? false,
    },
    { now: options.now },
  );
}

export function buildHermesLearningExampleFromRun(
  result: ModelRouterRunResult,
  options: {
    assistantResponseSummary?: string;
    qualityLabel?: HermesLearningQualityLabel;
    approvedForFinetune?: boolean;
    now?: string;
  } = {},
) {
  return buildHermesLearningExampleFromLedgerRecord(result.ledger_record, {
    assistantResponseSummary: options.assistantResponseSummary,
    qualityLabel: options.qualityLabel,
    approvedForFinetune: options.approvedForFinetune,
    sourceProviderCalled: false,
    sourceNetworkCallPerformed: false,
    now: options.now,
  });
}

export async function persistHermesLearningDatasetExample(
  example: HermesLearningDatasetExample,
  options: {
    datasetPath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  } = {},
): Promise<HermesLearningDatasetPersistenceResult> {
  const env = options.env ?? process.env;
  const datasetPath = options.datasetPath ?? resolveHermesLearningDatasetPath();

  if (!isLearningCaptureEnabled(env)) {
    return {
      persisted: false,
      reason: "capture_disabled",
      dataset_path: datasetPath,
      example: null,
      ...blockedPersistenceFlags,
    };
  }

  if (!isLocalLearningDatasetAllowed(env)) {
    return {
      persisted: false,
      reason: "production_write_blocked",
      dataset_path: datasetPath,
      example: null,
      ...blockedPersistenceFlags,
    };
  }

  await mkdir(dirname(datasetPath), { recursive: true });
  await appendFile(datasetPath, `${JSON.stringify(example)}\n`, "utf8");

  return {
    persisted: true,
    reason: "persisted_local_dev_only",
    dataset_path: datasetPath,
    example,
    ...blockedPersistenceFlags,
  };
}

export async function recordHermesLearningExampleFromRun(
  result: ModelRouterRunResult,
  options: {
    datasetPath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    assistantResponseSummary?: string;
    now?: string;
  } = {},
) {
  const example = buildHermesLearningExampleFromRun(result, {
    assistantResponseSummary: options.assistantResponseSummary,
    now: options.now,
  });
  return persistHermesLearningDatasetExample(example, {
    datasetPath: options.datasetPath,
    env: options.env,
  });
}

export async function recordHermesLearningExampleFromLedgerRecord(
  record: HermesLedgerRecord,
  options: {
    datasetPath?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
    assistantResponseSummary?: string;
    sourceProviderCalled?: boolean;
    sourceNetworkCallPerformed?: boolean;
    now?: string;
  } = {},
) {
  const example = buildHermesLearningExampleFromLedgerRecord(record, {
    assistantResponseSummary: options.assistantResponseSummary,
    sourceProviderCalled: options.sourceProviderCalled,
    sourceNetworkCallPerformed: options.sourceNetworkCallPerformed,
    now: options.now,
  });
  return persistHermesLearningDatasetExample(example, {
    datasetPath: options.datasetPath,
    env: options.env,
  });
}

export async function getHermesLearningDatasetStatus(
  options: { datasetPath?: string; env?: NodeJS.ProcessEnv | Record<string, string | undefined> } = {},
): Promise<HermesLearningDatasetStatus> {
  const datasetPath = options.datasetPath ?? resolveHermesLearningDatasetPath();
  const env = options.env ?? process.env;
  let bytes = 0;
  let exists = false;

  try {
    const info = await stat(datasetPath);
    bytes = info.size;
    exists = true;
  } catch {
    exists = false;
  }

  const estimatedExamples = bytes > 0 ? Math.max(1, Math.round(bytes / 1600)) : 0;

  return {
    enabled: isLearningCaptureEnabled(env),
    exists,
    dataset_path: datasetPath,
    bytes,
    local_dev_only: true,
    production_write_allowed: false,
    estimated_examples_at_current_size: estimatedExamples,
    storage_note:
      "Redacted JSONL summaries are small. Thousands of examples are usually megabytes; media and full transcripts are intentionally not stored here.",
  };
}

function parseLearningExample(line: string): HermesLearningDatasetExample | null {
  try {
    const parsed = JSON.parse(line) as HermesLearningDatasetExample;
    if (parsed?.dataset_kind !== "hermes_local_learning_example" || parsed.dataset_version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readHermesLearningDatasetExamples(options: {
  datasetPath?: string;
  limit?: number | string;
  tenantId?: string | null;
  actorUserId?: string | null;
  taskType?: string | null;
  qualityLabel?: HermesLearningQualityLabel | null;
} = {}): Promise<HermesLearningDatasetReadResult> {
  const datasetPath = options.datasetPath ?? resolveHermesLearningDatasetPath();
  const limit = normalizeHermesLearningDatasetLimit(options.limit);
  let raw = "";

  try {
    raw = await readFile(datasetPath, "utf8");
  } catch {
    return {
      dataset_path: datasetPath,
      limit,
      examples: [],
      malformed_lines: 0,
    };
  }

  const tenantId = options.tenantId?.trim() || null;
  const actorUserId = options.actorUserId?.trim() || null;
  const taskType = options.taskType?.trim() || null;
  const qualityLabel = options.qualityLabel ?? null;
  let malformed = 0;
  const examples: HermesLearningDatasetExample[] = [];

  for (const line of raw.split(/\r?\n/).filter(Boolean).reverse()) {
    const example = parseLearningExample(line);
    if (!example) {
      malformed += 1;
      continue;
    }
    if (tenantId && example.tenant_id !== tenantId) continue;
    if (actorUserId && example.actor_user_id !== actorUserId) continue;
    if (taskType && example.task_type !== taskType) continue;
    if (qualityLabel && example.quality_label !== qualityLabel) continue;

    examples.push(example);
    if (examples.length >= limit) break;
  }

  return {
    dataset_path: datasetPath,
    limit,
    examples,
    malformed_lines: malformed,
  };
}

export async function buildHermesTrainingExportPreview(options: {
  datasetPath?: string;
  limit?: number | string;
  tenantId?: string | null;
  includeUnreviewed?: boolean;
} = {}): Promise<HermesTrainingExportPreview> {
  const read = await readHermesLearningDatasetExamples({
    datasetPath: options.datasetPath,
    limit: options.limit,
    tenantId: options.tenantId,
  });
  const includeUnreviewed = Boolean(options.includeUnreviewed);
  const selected = read.examples.filter((example) => {
    if (includeUnreviewed) return example.quality_label !== "rejected";
    return example.approved_for_finetune && (example.quality_label === "approved" || example.quality_label === "corrected");
  });
  const records = selected.map((example) => {
    const assistantContent =
      example.ideal_response_summary || example.correction_summary || example.assistant_response_summary;

    return {
      messages: [
        {
          role: "system" as const,
          content:
            "You are PhantomAI, a private, human-approved business operator. Be useful, direct, safe, and never claim external actions were executed unless proof says they were.",
        },
        {
          role: "user" as const,
          content: example.prompt_summary,
        },
        {
          role: "assistant" as const,
          content: assistantContent,
        },
      ],
      metadata: {
        example_id: example.example_id,
        tenant_id: example.tenant_id,
        task_type: example.task_type,
        source_tool: example.source_tool,
        quality_label: example.quality_label,
        approved_for_finetune: example.approved_for_finetune,
      },
    };
  });

  return {
    exported_at: new Date().toISOString(),
    dataset_path: read.dataset_path,
    source_examples_scanned: read.examples.length,
    exported_examples: records.length,
    include_unreviewed: includeUnreviewed,
    format: "chat_messages_jsonl_preview",
    jsonl_preview: records.map((record) => JSON.stringify(record)).join("\n"),
    records,
    safety_flags: {
      preview_only: true,
      local_file_only: true,
      redacted: true,
      approved_examples_only: !includeUnreviewed,
      provider_called: false,
      network_call_performed: false,
      queue_written: false,
      approval_executed: false,
      external_action_executed: false,
      production_ledger_written: false,
    },
  };
}
