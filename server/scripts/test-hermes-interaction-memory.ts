import { readFileSync } from "node:fs";

import {
  buildHermesInteractionMemoryPreview,
  PHANTOM_AI_INTERACTION_SOURCE,
} from "../src/phantom-ai/hermes-interaction-memory.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static source guards: the capture contract must not write or call out.
const source = readFileSync(new URL("../src/phantom-ai/hermes-interaction-memory.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Interaction memory must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Interaction memory must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Interaction memory must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Interaction memory must not write files.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Interaction memory must not append Hermes ledger records.");
assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Interaction memory must not write approval queue records.");
assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Interaction memory must not write approval transitions.");

const fakeApiKeyValue = ["sk", "interaction", "0123456789abcdef"].join("-");
const fakeTokenValue = ["token", "interaction", "0123456789"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");
const fakePasswordValue = ["PASSWORD", "super-secret-demo"].join("=");
const longPromptBlob = "raw prompt body ".repeat(60); // ~960 chars, must be bounded
const sensitiveMetadataKey = ["to", "ken"].join("");

// 1) Primary preview for tenant-a / owner-a / task-1 with secrets + oversized input.
const preview = buildHermesInteractionMemoryPreview({
  tenant_id: "tenant-a",
  actor_user_id: "owner-a",
  task_id: "task-1",
  interaction_type: "content_idea_summary",
  summary: `${longPromptBlob} api_key=${fakeApiKeyValue} Bearer ${fakeTokenValue} card ${fakeCardValue} ${fakePasswordValue}`,
  metadata: {
    [sensitiveMetadataKey]: fakeTokenValue,
    secret_note: "plain-secret-like-value",
    ...Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`key_${index}`, `value-${index} api_key=${fakeApiKeyValue}`]),
    ),
  },
});
const previewJson = JSON.stringify(preview);

// Scope + source.
assert(preview.scope.tenant_id === "tenant-a", "Scope tenant must be tenant-a.");
assert(preview.scope.actor_user_id === "owner-a", "Scope user must be owner-a.");
assert(preview.scope.task_id === "task-1", "Scope task must be task-1.");
assert(preview.record.source === PHANTOM_AI_INTERACTION_SOURCE, "Record source must be phantom_ai_interaction.");
assert(preview.record.tenant_id === "tenant-a", "Record tenant must be bound to input tenant.");
assert(typeof preview.record.record_id === "string" && preview.record.record_id.length > 0, "Record id required.");
assert(typeof preview.record.captured_at === "string", "captured_at timestamp required.");

// Redaction: no raw secret/token/card/key/password may appear anywhere.
assert(!previewJson.includes(fakeApiKeyValue), "No raw API key may appear.");
assert(!previewJson.includes(fakeTokenValue), "No raw token may appear.");
assert(!previewJson.includes(fakeCardValue), "No raw card-like number may appear.");
assert(!previewJson.includes("super-secret-demo"), "No raw password value may appear.");
assert(preview.record.redaction.raw_secret_exposed === false, "Record must report no raw secret exposed.");

// No raw prompt stored: summary is bounded so the raw prompt body cannot be fully retained.
assert(preview.record.safe_summary.length <= 280, "Safe summary must be bounded to 280 chars.");
assert(!preview.record.safe_summary.includes(longPromptBlob), "Full raw prompt blob must not be stored.");
assert(preview.record.redaction.raw_prompt_stored === false, "Record must report no raw prompt stored.");

// Bounded metadata: at most 12 keys, oversized dropped, values capped.
assert(Object.keys(preview.record.metadata).length <= 12, "Metadata must be capped at 12 keys.");
assert(preview.record.metadata_keys_dropped > 0, "Oversized metadata must report dropped keys.");
assert(
  Object.values(preview.record.metadata).every((value) => value.length <= 200),
  "Metadata values must be capped at 200 chars.",
);
assert(
  !Object.values(preview.record.metadata).some((value) => value.includes(fakeApiKeyValue)),
  "Metadata values must be redacted.",
);
assert(
  preview.record.metadata[sensitiveMetadataKey] === "[redacted]",
  "Sensitive metadata key values must be fully redacted.",
);
assert(
  !previewJson.includes("plain-secret-like-value"),
  "Sensitive metadata values must be redacted even when the value itself has no recognizable pattern.",
);

// Preview-only ledger + all blocked safety flags.
assert(preview.ledger_write_preview_only === true, "Preview must be ledger-write preview only.");
assert(preview.production_ledger_write === false, "No production ledger write.");
assert(preview.provider_request_body_created === false, "No provider request body created.");
assert(preview.provider_called === false, "No provider call.");
assert(preview.network_call_performed === false, "No network call.");
assert(preview.queue_written === false, "No queue write.");
assert(preview.approval_executed === false, "No approval execution.");
assert(preview.live_call_allowed === false, "Live call must stay disallowed.");
assert(preview.execution_disabled === true, "Execution must be disabled.");
assert(preview.ready_for_send === false, "Nothing may be ready for send.");
assert(preview.provider_transport_allowed === false, "Provider transport must stay blocked.");
assert(preview.record.safety_flags.network_client_implemented === false, "No network client.");
assert(preview.record.safety_flags.ledger_written === false, "Record must report no ledger write.");

// 2) Cross-tenant isolation: a tenant-b input produces a tenant-b-bound record only.
const tenantB = buildHermesInteractionMemoryPreview({
  tenant_id: "tenant-b",
  actor_user_id: "owner-b",
  interaction_type: "content_idea_summary",
  summary: "Tenant-b private interaction.",
});
assert(tenantB.scope.tenant_id === "tenant-b", "Tenant-b input must scope to tenant-b.");
assert(tenantB.record.tenant_id === "tenant-b", "Tenant-b record must bind to tenant-b.");
assert(!JSON.stringify(tenantB).includes("tenant-a"), "Tenant-b preview must not contain tenant-a.");
assert(!previewJson.includes("tenant-b"), "Tenant-a preview must not contain tenant-b.");

// 3) Optional user/task scoping: omitting them yields null (no fabricated scope).
const minimalScope = buildHermesInteractionMemoryPreview({
  tenant_id: "tenant-c",
  interaction_type: "phantom_ai_activity",
  summary: "Minimal interaction.",
});
assert(minimalScope.scope.actor_user_id === null, "Omitted user must be null.");
assert(minimalScope.scope.task_id === null, "Omitted task must be null.");
assert(minimalScope.record.tenant_id === "tenant-c", "Record tenant must still be bound.");

// 4) Empty tenant: never falls back to another tenant's scope.
const emptyTenant = buildHermesInteractionMemoryPreview({
  tenant_id: "   ",
  interaction_type: "phantom_ai_activity",
  summary: "No tenant.",
});
assert(emptyTenant.record.tenant_id === "", "Empty tenant must remain empty (no cross-tenant fallback).");

console.log(
  JSON.stringify(
    {
      ok: true,
      source: preview.record.source,
      scopeTenant: preview.scope.tenant_id,
      scopeUser: preview.scope.actor_user_id,
      scopeTask: preview.scope.task_id,
      safeSummaryLen: preview.record.safe_summary.length,
      metadataKeys: Object.keys(preview.record.metadata).length,
      metadataDropped: preview.record.metadata_keys_dropped,
      rawPromptStored: preview.record.redaction.raw_prompt_stored,
      secretsLeaked:
        previewJson.includes(fakeApiKeyValue) ||
        previewJson.includes(fakeTokenValue) ||
        previewJson.includes(fakeCardValue) ||
        previewJson.includes("super-secret-demo"),
      crossTenantLeak: previewJson.includes("tenant-b") || JSON.stringify(tenantB).includes("tenant-a"),
      ledgerWritePreviewOnly: preview.ledger_write_preview_only,
      productionLedgerWrite: preview.production_ledger_write,
      providerRequestBodyCreated: preview.provider_request_body_created,
      queueWritten: preview.queue_written,
      approvalExecuted: preview.approval_executed,
      readyForSend: preview.ready_for_send,
    },
    null,
    2,
  ),
);
