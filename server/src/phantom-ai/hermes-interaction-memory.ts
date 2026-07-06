import { createHash } from "node:crypto";

import { redactSensitiveText } from "./hermes-ledger.js";

// Phase 1c: PhantomAI interaction memory capture contract (write-side).
//
// This defines HOW a PhantomAI interaction may become a durable Hermes memory
// record. It is PREVIEW-ONLY: it prepares a redacted, bounded record that WOULD
// be captured, but writes nothing. Combined with Phase 1a/1b (recall +
// context injection), this makes PhantomAI clearly Hermes-backed on both sides.
//
// Hard boundaries (same dry-run/local ladder):
// - PREVIEW ONLY: never writes the ledger/queue/store. production_ledger_write
//   is a hard literal false; a real durable write is a separate future phase.
// - TENANT SCOPED: the record is bound to exactly the input tenant. There is no
//   path to target another tenant (cross-tenant writes are impossible).
// - REDACTED: every stored string passes through redactSensitiveText.
// - NO RAW PROMPT: the contract only accepts a safe summary, never a raw prompt;
//   raw_prompt_stored is a hard literal false.
// - BOUNDED: summary, interaction type, and metadata are all capped.
// - NO provider call, NO transport, NO network client, NO sendable request body,
//   NO queue write, NO approval execution.

const MAX_SUMMARY_CHARS = 280;
const MAX_INTERACTION_TYPE_CHARS = 80;
const MAX_SCOPE_ID_CHARS = 120;
const MAX_METADATA_KEYS = 12;
const MAX_METADATA_KEY_CHARS = 60;
const MAX_METADATA_VALUE_CHARS = 200;
const SENSITIVE_METADATA_KEY_PATTERN =
  /(api[_-]?key|authorization|bearer|card|cc|credit|password|secret|token)/i;

export const PHANTOM_AI_INTERACTION_SOURCE = "phantom_ai_interaction" as const;

export type HermesInteractionMemoryMetadataValue = string | number | boolean | null;

export type HermesInteractionMemoryInput = {
  tenant_id: string;
  actor_user_id?: string | null;
  task_id?: string | null;
  interaction_type: string;
  summary: string;
  metadata?: Record<string, HermesInteractionMemoryMetadataValue>;
};

export type HermesInteractionMemoryScope = {
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
};

export type HermesInteractionMemoryRecordPreview = {
  record_id: string;
  source: typeof PHANTOM_AI_INTERACTION_SOURCE;
  captured_at: string;
  tenant_id: string;
  actor_user_id: string | null;
  task_id: string | null;
  interaction_type: string;
  safe_summary: string;
  metadata: Record<string, string>;
  metadata_keys_dropped: number;
  redaction: {
    redacted: true;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
    raw_prompt_returned: false;
  };
  ledger_write_preview_only: true;
  production_ledger_write: false;
  safety_flags: {
    local_only: true;
    dry_run_only: true;
    tenant_scoped: true;
    bounded: true;
    redacted: true;
    provider_request_body_created: false;
    provider_transport_allowed: false;
    network_client_implemented: false;
    provider_called: false;
    network_call_performed: false;
    live_call_allowed: false;
    execution_disabled: true;
    ready_for_send: false;
    queue_written: false;
    approval_executed: false;
    ledger_written: false;
    production_ledger_write: false;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
  };
};

export type HermesInteractionMemoryPreview = {
  prepared_at: string;
  scope: HermesInteractionMemoryScope;
  capture_status: "preview_only_blocked";
  record: HermesInteractionMemoryRecordPreview;
  redaction: {
    redacted: true;
    raw_secret_exposed: false;
    raw_prompt_stored: false;
  };
  ledger_write_preview_only: true;
  provider_request_body_created: false;
  provider_called: false;
  network_call_performed: false;
  queue_written: false;
  approval_executed: false;
  production_ledger_write: false;
  live_call_allowed: false;
  execution_disabled: true;
  ready_for_send: false;
  provider_transport_allowed: false;
};

function redactBounded(value: string, maxChars: number) {
  return redactSensitiveText(value).slice(0, maxChars);
}

function redactMetadataValue(rawKey: string, value: string) {
  if (SENSITIVE_METADATA_KEY_PATTERN.test(rawKey)) {
    return "[redacted]";
  }

  return redactBounded(value, MAX_METADATA_VALUE_CHARS);
}

function scopeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return redactBounded(trimmed, MAX_SCOPE_ID_CHARS);
}

function boundMetadata(metadata: HermesInteractionMemoryInput["metadata"]): {
  metadata: Record<string, string>;
  dropped: number;
} {
  if (!metadata || typeof metadata !== "object") {
    return { metadata: {}, dropped: 0 };
  }

  const entries = Object.entries(metadata);
  const kept = entries.slice(0, MAX_METADATA_KEYS);
  const dropped = Math.max(0, entries.length - kept.length);
  const out: Record<string, string> = {};

  for (const [rawKey, rawValue] of kept) {
    const key = redactBounded(String(rawKey), MAX_METADATA_KEY_CHARS);
    if (!key) continue;
    const stringified =
      rawValue === null || rawValue === undefined ? "" : typeof rawValue === "string" ? rawValue : String(rawValue);
    out[key] = redactMetadataValue(rawKey, stringified);
  }

  return { metadata: out, dropped };
}

function createRecordId(scope: HermesInteractionMemoryScope, interactionType: string, capturedAt: string) {
  const digest = createHash("sha256")
    .update(`${scope.tenant_id}:${scope.actor_user_id ?? ""}:${scope.task_id ?? ""}:${interactionType}:${capturedAt}`)
    .digest("hex")
    .slice(0, 24);
  return `phantom-ai-memory-${digest}`;
}

function recordSafetyFlags(): HermesInteractionMemoryRecordPreview["safety_flags"] {
  return {
    local_only: true,
    dry_run_only: true,
    tenant_scoped: true,
    bounded: true,
    redacted: true,
    provider_request_body_created: false,
    provider_transport_allowed: false,
    network_client_implemented: false,
    provider_called: false,
    network_call_performed: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    queue_written: false,
    approval_executed: false,
    ledger_written: false,
    production_ledger_write: false,
    raw_secret_exposed: false,
    raw_prompt_stored: false,
  };
}

export function buildHermesInteractionMemoryPreview(
  input: HermesInteractionMemoryInput,
  options: { now?: string } = {},
): HermesInteractionMemoryPreview {
  const preparedAt = options.now ?? new Date().toISOString();
  const capturedAt = preparedAt;

  // Tenant is bound from the input only. There is no cross-tenant path.
  const tenantId = redactBounded(String(input.tenant_id ?? "").trim(), MAX_SCOPE_ID_CHARS);
  const scope: HermesInteractionMemoryScope = {
    tenant_id: tenantId,
    actor_user_id: scopeId(input.actor_user_id),
    task_id: scopeId(input.task_id),
  };

  const interactionType = redactBounded(String(input.interaction_type ?? "interaction").trim(), MAX_INTERACTION_TYPE_CHARS);
  // The contract stores only a safe summary, never a raw prompt.
  const safeSummary = redactBounded(String(input.summary ?? "").replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS);
  const { metadata, dropped } = boundMetadata(input.metadata);

  const record: HermesInteractionMemoryRecordPreview = {
    record_id: createRecordId(scope, interactionType, capturedAt),
    source: PHANTOM_AI_INTERACTION_SOURCE,
    captured_at: capturedAt,
    tenant_id: scope.tenant_id,
    actor_user_id: scope.actor_user_id,
    task_id: scope.task_id,
    interaction_type: interactionType,
    safe_summary: safeSummary,
    metadata,
    metadata_keys_dropped: dropped,
    redaction: {
      redacted: true,
      raw_secret_exposed: false,
      raw_prompt_stored: false,
      raw_prompt_returned: false,
    },
    ledger_write_preview_only: true,
    production_ledger_write: false,
    safety_flags: recordSafetyFlags(),
  };

  return {
    prepared_at: preparedAt,
    scope,
    capture_status: "preview_only_blocked",
    record,
    redaction: {
      redacted: true,
      raw_secret_exposed: false,
      raw_prompt_stored: false,
    },
    ledger_write_preview_only: true,
    provider_request_body_created: false,
    provider_called: false,
    network_call_performed: false,
    queue_written: false,
    approval_executed: false,
    production_ledger_write: false,
    live_call_allowed: false,
    execution_disabled: true,
    ready_for_send: false,
    provider_transport_allowed: false,
  };
}
