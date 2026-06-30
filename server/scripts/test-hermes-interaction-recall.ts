import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory.js";
import { persistHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory-store.js";
import { recallHermesInteractionMemory } from "../src/phantom-ai/hermes-interaction-recall.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static source guards: recall must read only, never write or call out.
const source = readFileSync(new URL("../src/phantom-ai/hermes-interaction-recall.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Recall must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Recall must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Recall must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Recall must not write files.");
assert(!/\bpersistHermesInteractionMemoryPreview\b/i.test(source), "Recall must not persist store records.");
assert(!/\bappendHermesLedgerRecord\b/i.test(source), "Recall must not append the Hermes ledger.");

const fakeApiKeyValue = ["sk", "intrecall", "0123456789abcdef"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-interaction-recall-"));
const storePath = join(tempDir, "hermes-interaction-memory.jsonl");

async function seed(opts: {
  tenant: string;
  user: string | null;
  task: string | null;
  type: string;
  when: string;
  summary: string;
  metadata?: Record<string, string>;
}) {
  const preview = buildHermesInteractionMemoryPreview(
    {
      tenant_id: opts.tenant,
      actor_user_id: opts.user,
      task_id: opts.task,
      interaction_type: opts.type,
      summary: opts.summary,
      metadata: opts.metadata,
    },
    { now: opts.when },
  );
  const result = await persistHermesInteractionMemoryPreview(preview, { storePath });
  assert(result.persisted, "Seed persistence should succeed in local/dev mode.");
}

try {
  await seed({
    tenant: "tenant-a",
    user: "owner-a",
    task: "task-1",
    type: "content_idea_summary",
    when: "2026-06-29T10:00:00.000Z",
    summary: "Earlier carousel idea recap.",
  });
  await seed({
    tenant: "tenant-a",
    user: "owner-a",
    task: "task-1",
    type: "content_idea_summary",
    when: "2026-06-29T12:00:00.000Z",
    summary: `Most recent owner-a recap. api_key=${fakeApiKeyValue} card ${fakeCardValue}`,
    metadata: { token: fakeApiKeyValue, note: "plain-note" },
  });
  await seed({
    tenant: "tenant-a",
    user: "owner-a",
    task: "task-1",
    type: "inbox_followup",
    when: "2026-06-29T11:00:00.000Z",
    summary: "Owner-a inbox task (different type).",
  });
  await seed({
    tenant: "tenant-a",
    user: "employee-a",
    task: "task-9",
    type: "content_idea_summary",
    when: "2026-06-29T11:30:00.000Z",
    summary: "Employee-a task; must not appear for owner-a scope.",
  });
  await seed({
    tenant: "tenant-b",
    user: "owner-b",
    task: "task-b",
    type: "content_idea_summary",
    when: "2026-06-29T13:00:00.000Z",
    summary: "Tenant-b private recap; cross-tenant isolation check.",
  });

  const storeBytesBefore = statSync(storePath).size;

  // 1) Tenant-scoped recall.
  const tenantRecall = await recallHermesInteractionMemory({ tenantId: "tenant-a", storePath });
  assert(tenantRecall.source === "hermes_interaction_memory_store", "Recall source must be the interaction store.");
  assert(tenantRecall.matched_records === 4, "Tenant-a recall should match all 4 tenant-a records.");
  assert(tenantRecall.items.every((i) => i.tenant_id === "tenant-a"), "Tenant-a recall must only contain tenant-a.");
  assert(!JSON.stringify(tenantRecall).includes("Tenant-b"), "Cross-tenant isolation: no tenant-b memory.");
  assert(tenantRecall.safety_flags.read_only === true, "Recall must be read-only.");
  assert(tenantRecall.safety_flags.ledger_written === false, "Recall must not write the ledger.");
  assert(tenantRecall.safety_flags.production_ledger_written === false, "Recall must not write production ledger.");

  // 2) Per-user recall (the personalization unit) + most-recent-first.
  const userRecall = await recallHermesInteractionMemory({ tenantId: "tenant-a", actorUserId: "owner-a", storePath });
  assert(userRecall.matched_records === 3, "owner-a recall should match owner-a's 3 records.");
  assert(userRecall.items.every((i) => i.actor_user_id === "owner-a"), "owner-a recall must only contain owner-a.");
  assert(!JSON.stringify(userRecall).includes("Employee-a"), "owner-a recall must not include employee-a.");
  assert(userRecall.items[0]?.captured_at === "2026-06-29T12:00:00.000Z", "Recall must be most-recent-first.");

  // 3) Task + interaction-type scoping.
  const typeRecall = await recallHermesInteractionMemory({
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    interactionType: "content_idea_summary",
    storePath,
  });
  assert(typeRecall.matched_records === 2, "Type-scoped recall should match owner-a content_idea_summary records.");
  assert(
    typeRecall.items.every((i) => i.interaction_type === "content_idea_summary"),
    "Type-scoped recall must only contain the requested type.",
  );

  // 4) Redaction: no raw secret/card may appear (records are redacted at write; recall re-redacts).
  const userRecallJson = JSON.stringify(userRecall);
  assert(!userRecallJson.includes(fakeApiKeyValue), "Recall must not expose a raw API key.");
  assert(!userRecallJson.includes(fakeCardValue), "Recall must not expose a raw card-like number.");
  assert(!userRecall.compact_memory.includes(fakeApiKeyValue), "Compact memory must not expose a raw API key.");

  // 5) Bounded recall.
  const bounded = await recallHermesInteractionMemory({ tenantId: "tenant-a", limit: 2, storePath });
  assert(bounded.returned_records === 2, "Recall limit must cap returned items.");
  assert(bounded.matched_records === 4, "Bounded recall should still report full matched count.");

  // 6) Empty/unknown tenant: no cross-tenant fallback.
  const emptyTenant = await recallHermesInteractionMemory({ tenantId: "   ", storePath });
  assert(emptyTenant.returned_records === 0, "Empty tenant must recall nothing.");
  const unknownTenant = await recallHermesInteractionMemory({ tenantId: "tenant-zzz", storePath });
  assert(unknownTenant.returned_records === 0, "Unknown tenant recall should be empty.");

  // 7) Read-only: store file unchanged after all recalls.
  const storeBytesAfter = statSync(storePath).size;
  assert(storeBytesAfter === storeBytesBefore, "Recall must not modify the interaction store file.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: tenantRecall.source,
        tenantMatched: tenantRecall.matched_records,
        userMatched: userRecall.matched_records,
        userMostRecentFirst: userRecall.items[0]?.captured_at,
        typeScopedMatched: typeRecall.matched_records,
        boundedReturned: bounded.returned_records,
        crossTenantLeak: JSON.stringify(tenantRecall).includes("Tenant-b"),
        secretsLeaked: userRecallJson.includes(fakeApiKeyValue) || userRecallJson.includes(fakeCardValue),
        storeWritten: storeBytesAfter !== storeBytesBefore,
        hasCompactMemory: userRecall.compact_memory.length > 0,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
