import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendHermesLedgerRecord } from "../src/phantom-ai/hermes-ledger.js";
import { recallHermesMemory } from "../src/phantom-ai/hermes-memory-recall.js";
import type { HermesLedgerRecord } from "../src/phantom-ai/types.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Fake secret values that must never survive into recalled memory.
const fakeApiKeyValue = ["sk", "memrecall", "0123456789abcdef"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");

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
    context_chars: overrides.context_chars ?? 500,
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

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-memory-recall-"));
const ledgerPath = join(tempDir, "hermes-ledger.jsonl");

try {
  // Tenant A / user owner-a: three records (one with secrets in the summaries).
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
      task_type: "inbox_followup",
      user_request_summary: `Follow up on lead. api_key=${fakeApiKeyValue} card ${fakeCardValue}`,
      result_summary: `Drafted reply referencing api_key=${fakeApiKeyValue}.`,
    }),
    { ledgerPath },
  );
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "owner-a",
      timestamp: "2026-06-29T12:00:00.000Z",
      task_type: "content_idea_summary",
      result_summary: "Most recent tenant-a recap.",
    }),
    { ledgerPath },
  );
  // Tenant A / a different user.
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-a",
      actor_user_id: "employee-a",
      timestamp: "2026-06-29T11:30:00.000Z",
      result_summary: "Employee-a task; must not appear for owner-a scope.",
    }),
    { ledgerPath },
  );
  // Tenant B: completely separate tenant; must never leak into tenant-a recall.
  await appendHermesLedgerRecord(
    record({
      tenant_id: "tenant-b",
      actor_user_id: "owner-b",
      timestamp: "2026-06-29T13:00:00.000Z",
      result_summary: "Tenant-b private recap; cross-tenant isolation check.",
    }),
    { ledgerPath },
  );

  const ledgerBytesBefore = statSync(ledgerPath).size;

  // 1) Tenant-scoped recall (tenant-a, all users).
  const tenantRecall = await recallHermesMemory({ tenantId: "tenant-a", ledgerPath });
  assert(tenantRecall.matched_records === 4, "Tenant-a recall should match all 4 tenant-a records.");
  assert(
    tenantRecall.items.every((item) => item.tenant_id === "tenant-a"),
    "Tenant-a recall must only contain tenant-a items.",
  );
  assert(
    !tenantRecall.items.some((item) => item.result_summary.includes("Tenant-b")),
    "Tenant-a recall must never include tenant-b memory (cross-tenant isolation).",
  );
  assert(tenantRecall.has_memory === true, "Tenant-a recall should report memory present.");
  assert(tenantRecall.safety_flags.read_only === true, "Recall must be read-only.");
  assert(tenantRecall.safety_flags.ledger_written === false, "Recall must not write the ledger.");

  // 2) Per-user recall (tenant-a + owner-a) is the personalization unit.
  const userRecall = await recallHermesMemory({
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    ledgerPath,
  });
  assert(userRecall.matched_records === 3, "owner-a recall should match owner-a's 3 records.");
  assert(
    userRecall.items.every((item) => item.actor_user_id === "owner-a"),
    "owner-a recall must only contain owner-a items (per-user tailoring).",
  );
  assert(
    !userRecall.items.some((item) => item.result_summary.includes("Employee-a")),
    "owner-a recall must not include employee-a records.",
  );
  // Most recent first.
  assert(
    userRecall.items[0]?.timestamp === "2026-06-29T12:00:00.000Z",
    "Recall must return most-recent memory first.",
  );

  // 3) Redaction: secret-bearing summaries must be masked everywhere.
  const userRecallJson = JSON.stringify(userRecall);
  assert(!userRecallJson.includes(fakeApiKeyValue), "Recall must not expose a raw API key.");
  assert(!userRecallJson.includes(fakeCardValue), "Recall must not expose a raw card-like number.");
  assert(!userRecall.compact_memory.includes(fakeApiKeyValue), "Compact memory must not expose a raw API key.");

  // 4) Task-type scoping.
  const taskRecall = await recallHermesMemory({
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    taskType: "content_idea_summary",
    ledgerPath,
  });
  assert(taskRecall.matched_records === 2, "Task-scoped recall should match owner-a content_idea_summary records.");
  assert(
    taskRecall.items.every((item) => item.task_type === "content_idea_summary"),
    "Task-scoped recall must only contain the requested task type.",
  );

  // 5) Bounded recall: limit caps returned items even when more match.
  const boundedRecall = await recallHermesMemory({ tenantId: "tenant-a", limit: 2, ledgerPath });
  assert(boundedRecall.returned_records === 2, "Recall limit must cap returned items.");
  assert(boundedRecall.matched_records === 4, "Recall should still report the full matched count.");

  // 6) Empty-tenant guard: never falls back to cross-tenant data.
  const emptyTenant = await recallHermesMemory({ tenantId: "   ", ledgerPath });
  assert(emptyTenant.returned_records === 0, "Empty tenant must recall nothing.");
  assert(emptyTenant.has_memory === false, "Empty tenant must report no memory.");

  // 7) Unknown tenant returns empty, not an error.
  const unknownTenant = await recallHermesMemory({ tenantId: "tenant-zzz", ledgerPath });
  assert(unknownTenant.returned_records === 0, "Unknown tenant recall should be empty.");

  // 8) Read-only proof: ledger file is unchanged after all recalls.
  const ledgerBytesAfter = statSync(ledgerPath).size;
  assert(ledgerBytesAfter === ledgerBytesBefore, "Recall must not modify the ledger file.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantMatched: tenantRecall.matched_records,
        userMatched: userRecall.matched_records,
        userReturnedMostRecent: userRecall.items[0]?.timestamp,
        taskScopedMatched: taskRecall.matched_records,
        boundedReturned: boundedRecall.returned_records,
        crossTenantLeak: tenantRecall.items.some((item) => item.tenant_id !== "tenant-a"),
        secretsLeaked: userRecallJson.includes(fakeApiKeyValue) || userRecallJson.includes(fakeCardValue),
        ledgerWritten: ledgerBytesAfter !== ledgerBytesBefore,
        hasCompactMemory: userRecall.compact_memory.length > 0,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
