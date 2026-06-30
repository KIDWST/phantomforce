import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory.js";
import { persistHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory-store.js";
import { buildChicagoShotsLeadIntakePreview } from "../src/phantom-ai/ops-workflow.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static source guards: the ops workflow must not call out or write.
const source = readFileSync(new URL("../src/phantom-ai/ops-workflow.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "Ops workflow must not add fetch calls.");
assert(!/\bhttps?\.request\b/i.test(source), "Ops workflow must not add HTTP request calls.");
assert(!/\baxios\s*\(/i.test(source), "Ops workflow must not add axios calls.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "Ops workflow must not write files.");
assert(!/\bappendHermesLedgerRecord\b|\bpersistHermesInteractionMemoryPreview\b/i.test(source), "Ops workflow must not write memory/ledger.");

const fakeApiKeyValue = ["sk", "chishots", "0123456789abcdef"].join("-");
const fakeCardValue = ["4242", "4242", "4242", "4242"].join(" ");

const tempDir = mkdtempSync(join(tmpdir(), "phantom-chicagoshots-ops-"));
const storePath = join(tempDir, "hermes-interaction-memory.jsonl");

try {
  // Seed interaction memory for tenant chicagoshots + a different tenant (isolation).
  for (const [tenant, user, summary, when] of [
    ["chicagoshots", "owner-cs", "Prior wedding inquiry recap.", "2026-06-29T10:00:00.000Z"],
    ["other-co", "owner-other", "Other-co private interaction; must not appear.", "2026-06-29T11:00:00.000Z"],
  ] as const) {
    const mem = buildHermesInteractionMemoryPreview(
      { tenant_id: tenant, actor_user_id: user, task_id: null, interaction_type: "lead_intake", summary },
      { now: when },
    );
    const r = await persistHermesInteractionMemoryPreview(mem, { storePath });
    assert(r.persisted, "Seed should persist.");
  }
  const storeBytesBefore = statSync(storePath).size;

  // 1) Wedding lead with a secret in notes.
  const wedding = await buildChicagoShotsLeadIntakePreview(
    {
      tenant_id: "chicagoshots",
      actor_user_id: "owner-cs",
      client_name: "Maria Lopez",
      contact: "maria@example.com",
      event_type: "wedding",
      date_time: "2026-08-15 4pm",
      location: "Chicago, Lincoln Park",
      requested_service: "full day wedding photography",
      budget_rate: "$3500",
      notes: `Outdoor ceremony. api_key=${fakeApiKeyValue} card ${fakeCardValue}`,
      source_platform: "Instagram",
      urgency: "asap",
    },
    { storePath },
  );
  const weddingJson = JSON.stringify(wedding);

  assert(wedding.recommended_service_package.id === "event_coverage", "Wedding should map to event_coverage.");
  assert(wedding.deliverables_checklist.length > 0, "Deliverables checklist must be useful.");
  assert(wedding.task_draft.steps.length > 0, "Task draft must have steps.");
  assert(wedding.task_draft.priority === "high", "asap urgency should be high.");
  assert(wedding.follow_up_draft.body.includes("ChicagoShots"), "Follow-up draft must be ChicagoShots-branded.");
  assert(wedding.follow_up_draft.body.includes("Maria"), "Follow-up should address the client by name.");
  assert(wedding.follow_up_draft.would_send === false, "Follow-up must not be sendable.");
  assert(wedding.follow_up_draft.channel_hint === "email", "Email contact should hint email channel.");
  assert(wedding.approval_preview.status === "preview-only", "Approval must be preview-only.");
  assert(wedding.approval_preview.execution_disabled === true, "Approval execution must be disabled.");
  assert(wedding.approval_preview.requires_approval_before_send === true, "Send must require approval.");

  // Redaction: no raw secret/card anywhere.
  assert(!weddingJson.includes(fakeApiKeyValue), "No raw API key may appear.");
  assert(!weddingJson.includes(fakeCardValue), "No raw card-like number may appear.");
  assert(wedding.safety_flags.raw_secret_exposed === false, "raw_secret_exposed must be false.");

  // 2) Memory context (tenant-scoped, read-only).
  assert(wedding.memory_context_used.has_memory === true, "Should recall chicagoshots memory.");
  assert(wedding.memory_context_used.recalled_count >= 1, "Should recall at least one chicagoshots interaction.");
  assert(!weddingJson.includes("Other-co"), "Cross-tenant memory must not leak into chicagoshots context.");

  // 3) Classification matrix.
  const cases: Array<[string, string, string]> = [
    ["headshots", "professional headshots", "portrait_session"],
    ["real estate listing", "property photos + walkthrough", "real_estate_media"],
    ["sports tournament", "team action photos", "sports_action"],
    ["brand content", "product photos and reels", "brand_content"],
    ["something unusual", "not sure yet", "general_inquiry"],
  ];
  for (const [eventType, service, expected] of cases) {
    const p = await buildChicagoShotsLeadIntakePreview(
      { tenant_id: "chicagoshots", event_type: eventType, requested_service: service },
      { storePath },
    );
    assert(p.recommended_service_package.id === expected, `${eventType}/${service} should map to ${expected}.`);
    assert(p.deliverables_checklist.length > 0, `${expected} must have deliverables.`);
    assert(p.safety_flags.would_send === false, "would_send must stay false.");
    assert(p.safety_flags.provider_called === false, "provider_called must stay false.");
  }

  // 4) Read-only: store unchanged after all previews.
  const storeBytesAfter = statSync(storePath).size;
  assert(storeBytesAfter === storeBytesBefore, "Ops workflow must not write the interaction store.");

  // 5) Safety flags.
  for (const flag of [
    wedding.safety_flags.provider_called,
    wedding.safety_flags.network_call_performed,
    wedding.safety_flags.external_send,
    wedding.safety_flags.would_send,
    wedding.safety_flags.approval_executed,
    wedding.safety_flags.queue_written,
    wedding.safety_flags.production_ledger_write,
  ]) {
    assert(flag === false, "All execution/send safety flags must be false.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        package: wedding.recommended_service_package.id,
        urgency: wedding.task_draft.priority,
        deliverables: wedding.deliverables_checklist.length,
        followUpChannel: wedding.follow_up_draft.channel_hint,
        wouldSend: wedding.follow_up_draft.would_send,
        memoryRecalled: wedding.memory_context_used.recalled_count,
        crossTenantLeak: weddingJson.includes("Other-co"),
        secretsLeaked: weddingJson.includes(fakeApiKeyValue) || weddingJson.includes(fakeCardValue),
        storeWritten: storeBytesAfter !== storeBytesBefore,
        approvalExecutionDisabled: wedding.approval_preview.execution_disabled,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
