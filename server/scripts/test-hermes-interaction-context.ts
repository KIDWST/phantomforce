import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory.js";
import { persistHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory-store.js";
import { recallHermesInteractionMemory } from "../src/phantom-ai/hermes-interaction-recall.js";
import { buildHermesMemoryContextPreview } from "../src/phantom-ai/hermes-memory-context.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static guard: context prep must not write the interaction store or call out.
const ctxSource = readFileSync(new URL("../src/phantom-ai/hermes-memory-context.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(ctxSource), "Context prep must not add fetch calls.");
assert(!/\bpersistHermesInteractionMemoryPreview\b/i.test(ctxSource), "Context prep must not persist store records.");
assert(!/\bappendHermesLedgerRecord\b/i.test(ctxSource), "Context prep must not append the ledger.");

const fakeApiKeyValue = ["sk", "ctx1g", "0123456789abcdef"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");

const tempDir = mkdtempSync(join(tmpdir(), "phantom-hermes-interaction-context-"));
const storePath = join(tempDir, "hermes-interaction-memory.jsonl");
const ledgerPath = join(tempDir, "hermes-ledger.jsonl"); // intentionally never created (no ledger seed)

async function seed(opts: {
  tenant: string;
  user: string | null;
  task: string | null;
  type: string;
  when: string;
  summary: string;
}) {
  const preview = buildHermesInteractionMemoryPreview(
    {
      tenant_id: opts.tenant,
      actor_user_id: opts.user,
      task_id: opts.task,
      interaction_type: opts.type,
      summary: opts.summary,
    },
    { now: opts.when },
  );
  const result = await persistHermesInteractionMemoryPreview(preview, { storePath });
  assert(result.persisted, "Seed persistence should succeed in local/dev mode.");
}

function contextInput(tenant: string, user: string) {
  return {
    tenant_id: tenant,
    business_name: "West Loop Strength Lab",
    actor_user_id: user,
    request_id: `ctx-${tenant}-${user}`,
    task_type: "content_idea_summary",
    sensitivity_level: "low" as const,
    user_request: "Summarize today's safest trainer follow-ups for owner review only.",
    business_summary: "Owner-only personal training demo. External actions approval-only.",
    module_data: [],
  };
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
    type: "inbox_followup",
    when: "2026-06-29T12:00:00.000Z",
    summary: `Most recent owner-a interaction. api_key=${fakeApiKeyValue} card ${fakeCardValue}`,
  });
  await seed({
    tenant: "tenant-a",
    user: "employee-a",
    task: "task-9",
    type: "content_idea_summary",
    when: "2026-06-29T11:30:00.000Z",
    summary: "Employee-a interaction; must not appear for owner-a scope.",
  });
  await seed({
    tenant: "tenant-b",
    user: "owner-b",
    task: "task-b",
    type: "content_idea_summary",
    when: "2026-06-29T13:00:00.000Z",
    summary: "Tenant-b private interaction; cross-tenant isolation check.",
  });

  const storeBytesBefore = statSync(storePath).size;

  // 1) Context prep for tenant-a / owner-a includes recalled interaction memory.
  const ctx = await buildHermesMemoryContextPreview(contextInput("tenant-a", "owner-a"), { storePath, ledgerPath });
  const ctxJson = JSON.stringify(ctx);

  assert(ctx.interaction_memory.source === "hermes_interaction_memory_store", "Interaction memory source must be set.");
  assert(ctx.interaction_memory.has_memory === true, "Interaction memory should be present for owner-a.");
  assert(ctx.interaction_memory.recalled_count === 2, "owner-a should recall its 2 interactions only.");
  assert(
    ctx.interaction_memory.items.every((i) => i.tenant_id === "tenant-a" && i.actor_user_id === "owner-a"),
    "Interaction recall must be tenant + user scoped.",
  );
  // 2) Injected into the augmented context block.
  assert(
    ctx.augmented_context_preview.includes("Recalled PhantomAI interaction memory"),
    "Augmented context must include the interaction memory block.",
  );
  assert(
    ctx.augmented_context_preview.includes("Most recent owner-a interaction"),
    "Augmented context must include the recalled (redacted) interaction content.",
  );
  // Existing Phase 1b ledger block preserved.
  assert(
    ctx.augmented_context_preview.includes("Recalled Hermes memory"),
    "Existing ledger memory block must be preserved.",
  );

  // 3) No cross-tenant / cross-user leak.
  assert(!ctxJson.includes("Tenant-b"), "Context must not include tenant-b interaction memory.");
  assert(!ctxJson.includes("Employee-a"), "Context must not include employee-a interaction memory.");

  // 4) Redaction still applies.
  assert(!ctxJson.includes(fakeApiKeyValue), "Context must not expose a raw API key.");
  assert(!ctxJson.includes(fakeCardValue), "Context must not expose a raw card-like number.");

  // 5) Read-only: store + ledger files unchanged / not created.
  const storeBytesAfter = statSync(storePath).size;
  assert(storeBytesAfter === storeBytesBefore, "Context prep must not write the interaction store.");
  assert(!existsSync(ledgerPath), "Context prep must not create/write the ledger.");

  // 6) Safety flags remain blocked.
  assert(ctx.safety_flags.memory_read_only === true, "memory_read_only must be true.");
  assert(ctx.safety_flags.provider_called === false, "No provider call.");
  assert(ctx.safety_flags.network_call_performed === false, "No network call.");
  assert(ctx.safety_flags.queue_written === false, "No queue write.");
  assert(ctx.safety_flags.approval_executed === false, "No approval execution.");
  assert(ctx.safety_flags.production_ledger_write === false, "No production ledger write.");
  assert(ctx.safety_flags.live_call_allowed === false, "Live call must stay disallowed.");
  assert(ctx.safety_flags.ready_for_send === false, "Nothing ready for send.");
  assert(ctx.provider_request_body_created === false, "No provider request body created.");

  // 7) No memory case: context prep continues normally.
  const ctxEmpty = await buildHermesMemoryContextPreview(contextInput("tenant-empty", "owner-x"), {
    storePath,
    ledgerPath,
  });
  assert(ctxEmpty.interaction_memory.has_memory === false, "Empty tenant must have no interaction memory.");
  assert(ctxEmpty.interaction_memory.recalled_count === 0, "Empty tenant recall count must be 0.");
  assert(ctxEmpty.augmented_context_preview.length > 0, "Context prep must still produce context when no memory.");
  assert(
    ctxEmpty.augmented_context_preview.includes("Recalled PhantomAI interaction memory"),
    "Interaction block header should still render (empty) without breaking context prep.",
  );

  // 8) Filters narrow (never broaden): adding an interaction_type filter returns a subset.
  const userAll = await recallHermesInteractionMemory({ tenantId: "tenant-a", actorUserId: "owner-a", storePath });
  const userTyped = await recallHermesInteractionMemory({
    tenantId: "tenant-a",
    actorUserId: "owner-a",
    interactionType: "content_idea_summary",
    storePath,
  });
  assert(userAll.matched_records === 2, "Unfiltered owner-a recall should match 2.");
  assert(userTyped.matched_records === 1, "Type-filtered recall must narrow to 1 (never broaden).");
  assert(userTyped.matched_records <= userAll.matched_records, "A filter must never broaden scope.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        interactionRecalled: ctx.interaction_memory.recalled_count,
        interactionInjected: ctx.augmented_context_preview.includes("Recalled PhantomAI interaction memory"),
        ledgerBlockPreserved: ctx.augmented_context_preview.includes("Recalled Hermes memory"),
        crossTenantLeak: ctxJson.includes("Tenant-b") || ctxJson.includes("Employee-a"),
        secretsLeaked: ctxJson.includes(fakeApiKeyValue) || ctxJson.includes(fakeCardValue),
        storeWritten: storeBytesAfter !== storeBytesBefore,
        ledgerCreated: existsSync(ledgerPath),
        emptyContextStillBuilt: ctxEmpty.augmented_context_preview.length > 0,
        filterNarrows: userTyped.matched_records < userAll.matched_records,
        providerCalled: ctx.safety_flags.provider_called,
        productionLedgerWrite: ctx.safety_flags.production_ledger_write,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
