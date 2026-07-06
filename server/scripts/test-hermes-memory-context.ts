import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendHermesLedgerRecord } from "../src/phantom-ai/hermes-ledger.js";
import { buildHermesMemoryContextPreview } from "../src/phantom-ai/hermes-memory-context.js";
import type { HermesLedgerRecord } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

const fakeApiKeyValue = ["sk", "memctx", "0123456789abcdef"].join("-");
const fakeTokenValue = ["token", "memctx", "0123456789"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");

const source = readFileSync(new URL("../src/phantom-ai/hermes-memory-context.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Memory context must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Memory context must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Memory context must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Memory context must not write files.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Memory context must not append Hermes ledger records.");
assert(!/\bpersistApprovalQueuePreview\b/i.test(source), "Memory context must not write approval queue records.");
assert(!/\bappendApprovalQueueTransition\b/i.test(source), "Memory context must not write approval transitions.");

function record(overrides: Partial<HermesLedgerRecord> & {
  tenant_id: string;
  actor_user_id: string;
  timestamp: string;
}): HermesLedgerRecord {
  return {
    timestamp: overrides.timestamp,
    tenant_id: overrides.tenant_id,
    business_name: overrides.business_name ?? "West Loop Strength Lab",
    actor_user_id: overrides.actor_user_id,
    actor_role: overrides.actor_role ?? "business_owner",
    request_id: overrides.request_id ?? `req-${overrides.timestamp}`,
    task_type: overrides.task_type ?? "content_idea_summary",
    sensitivity_level: overrides.sensitivity_level ?? "low",
    provider_route: overrides.provider_route ?? "mock",
    model_id: overrides.model_id ?? "phantomforce-mock-router",
    context_chars: overrides.context_chars ?? 480,
    estimated_tokens: overrides.estimated_tokens ?? 120,
    estimated_cost_usd: overrides.estimated_cost_usd ?? 0,
    user_request_summary: overrides.user_request_summary ?? "Summarize safe follow-ups.",
    result_summary: overrides.result_summary ?? "Drafted owner-review summary.",
    approval_required: overrides.approval_required ?? false,
    approval_status: overrides.approval_status ?? "not_required",
    risks: overrides.risks ?? [],
    next_action: overrides.next_action ?? "Keep as preview only.",
  };
}

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-memory-context-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");

try {
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "owner-a",
      timestamp: "2026-06-29T10:00:00.000Z",
      task_type: "content_idea_summary",
      result_summary: "Earlier carousel idea recap.",
    }),
    { ledgerPath },
  );
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "owner-a",
      timestamp: "2026-06-29T11:00:00.000Z",
      task_type: "content_idea_summary",
      user_request_summary: `Draft with api_key=${fakeApiKeyValue} Bearer ${fakeTokenValue} card ${fakeCardValue}`,
      result_summary: `Most recent owner-a recap referencing api_key=${fakeApiKeyValue}.`,
    }),
    { ledgerPath },
  );
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "owner-a",
      timestamp: "2026-06-29T10:30:00.000Z",
      task_type: "inbox_followup",
      result_summary: "Owner-a inbox task (different task type).",
    }),
    { ledgerPath },
  );
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "employee-a",
      timestamp: "2026-06-29T11:15:00.000Z",
      result_summary: "Employee-a task; must not appear for owner-a scope.",
    }),
    { ledgerPath },
  );
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-b",
      actor_user_id: "owner-b",
      timestamp: "2026-06-29T12:00:00.000Z",
      result_summary: "Tenant-b private recap; cross-tenant isolation check.",
    }),
    { ledgerPath },
  );

  const ledgerBytesBefore = statSync(ledgerPath).size;

  // Prepare memory-augmented context for tenant-a / owner-a / content_idea_summary.
  const preview = await buildHermesMemoryContextPreview(
    {
      tenant_id: "tenant-a",
      business_name: "West Loop Strength Lab",
      actor_user_id: "owner-a",
      request_id: "memctx-001",
      task_type: "content_idea_summary",
      sensitivity_level: "low",
      user_request: "Summarize today's safest trainer follow-ups for owner review only.",
      business_summary: "Owner-only personal training demo. External actions approval-only.",
      module_data: [],
    },
    { ledgerPath },
  );
  const previewJson = JSON.stringify(preview);

  // Scope reflects tenant/user/task.
  assert(preview.scope.tenant_id === "tenant-a", "Scope tenant must be tenant-a.");
  assert(preview.scope.actor_user_id === "owner-a", "Scope user must be owner-a.");
  assert(preview.scope.task_type === "content_idea_summary", "Scope task must be content_idea_summary.");

  // User + task scoping: only owner-a content_idea_summary records (2 of them).
  assert(preview.memory.matched_records === 2, "Should match owner-a content_idea_summary records only.");
  assert(preview.memory.recalled_count === 2, "Recalled count should be 2.");
  assert(preview.memory.has_memory === true, "Memory should be present.");
  assert(
    preview.memory.items.every((item) => item.actor_user_id === "owner-a"),
    "All recalled items must be owner-a (user scoping).",
  );
  assert(
    preview.memory.items.every((item) => item.task_type === "content_idea_summary"),
    "All recalled items must be content_idea_summary (task scoping).",
  );

  // Most-recent-first.
  assert(
    preview.memory.items[0]?.timestamp === "2026-06-29T11:00:00.000Z",
    "Recall must be most-recent-first.",
  );

  // Tenant isolation: tenant-b and employee-a content must not appear anywhere.
  assert(!previewJson.includes("Tenant-b"), "Tenant-b memory must never leak (tenant isolation).");
  assert(!previewJson.includes("Employee-a"), "Employee-a memory must not leak into owner-a scope.");

  // Redaction: no raw secret/token/card may appear anywhere.
  assert(!previewJson.includes(fakeApiKeyValue), "No raw API key may appear.");
  assert(!previewJson.includes(fakeTokenValue), "No raw token may appear.");
  assert(!previewJson.includes(fakeCardValue), "No raw card-like number may appear.");
  assert(preview.redaction.raw_secret_exposed === false, "Redaction flag must report no raw secret.");

  // Memory IS injected into the augmented context (recall wired into context prep).
  assert(
    preview.augmented_context_preview.includes("Recalled Hermes memory"),
    "Augmented context must include the recalled memory section.",
  );
  assert(
    preview.augmented_context_preview.includes("Most recent owner-a recap"),
    "Augmented context must contain the recalled (redacted) memory content.",
  );
  assert(!preview.augmented_context_preview.includes(fakeApiKeyValue), "Augmented context must not expose a raw key.");

  // No provider request body / transport / live call.
  assert(preview.provider_request_body_created === false, "No provider request body may be created.");
  assert(preview.safety_flags.provider_transport_allowed === false, "Provider transport must stay blocked.");
  assert(preview.safety_flags.network_client_implemented === false, "No network client.");
  assert(preview.safety_flags.provider_called === false, "No provider call.");
  assert(preview.safety_flags.network_call_performed === false, "No network call.");
  assert(preview.safety_flags.live_call_allowed === false, "Live call must stay disallowed.");
  assert(preview.safety_flags.execution_disabled === true, "Execution must be disabled.");
  assert(preview.safety_flags.ready_for_send === false, "Nothing may be ready for send.");
  assert(preview.safety_flags.queue_written === false, "No queue write.");
  assert(preview.safety_flags.approval_executed === false, "No approval execution.");
  assert(preview.safety_flags.production_ledger_write === false, "No production ledger write.");
  assert(preview.safety_flags.ledger_written === false, "No ledger write.");

  // Bounded recall: cap returned items even when more match.
  const bounded = await buildHermesMemoryContextPreview(
    {
      tenant_id: "tenant-a",
      business_name: "West Loop Strength Lab",
      actor_user_id: "owner-a",
      request_id: "memctx-002",
      task_type: "content_idea_summary",
      sensitivity_level: "low",
      user_request: "Summarize.",
      business_summary: "Owner-only demo.",
      module_data: [],
    },
    { ledgerPath, recallLimit: 1 },
  );
  assert(bounded.memory.recalled_count === 1, "Recall limit must cap returned memory.");
  assert(bounded.memory.matched_records === 2, "Bounded recall should still report full matched count.");

  // Read-only: ledger file unchanged after all context preparations.
  const ledgerBytesAfter = statSync(ledgerPath).size;
  assert(ledgerBytesAfter === ledgerBytesBefore, "Context preparation must not write the ledger.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        scopeTenant: preview.scope.tenant_id,
        scopeUser: preview.scope.actor_user_id,
        scopeTask: preview.scope.task_type,
        matchedRecords: preview.memory.matched_records,
        recalledCount: preview.memory.recalled_count,
        mostRecentFirst: preview.memory.items[0]?.timestamp,
        boundedRecalled: bounded.memory.recalled_count,
        memoryInjected: preview.augmented_context_preview.includes("Recalled Hermes memory"),
        crossTenantLeak: previewJson.includes("Tenant-b") || previewJson.includes("Employee-a"),
        secretsLeaked:
          previewJson.includes(fakeApiKeyValue) ||
          previewJson.includes(fakeTokenValue) ||
          previewJson.includes(fakeCardValue),
        providerRequestBodyCreated: preview.provider_request_body_created,
        liveCallAllowed: preview.safety_flags.live_call_allowed,
        readyForSend: preview.safety_flags.ready_for_send,
        providerTransportAllowed: preview.safety_flags.provider_transport_allowed,
        ledgerWritten: ledgerBytesAfter !== ledgerBytesBefore,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
