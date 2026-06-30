import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory.js";
import { persistHermesInteractionMemoryPreview } from "../src/phantom-ai/hermes-interaction-memory-store.js";
import { buildOpsDashboardContext, EMBEDDED_OPS_ACTIONS } from "../src/phantom-ai/ops-context.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Static source guard: the context brain is read-only and must not write or call out.
const source = readFileSync(new URL("../src/phantom-ai/ops-context.ts", import.meta.url), "utf8");
assert(!/\bfetch\s*\(/i.test(source), "ops-context must not call fetch.");
assert(!/\bwriteFile\b|\bappendFile\b|\bmkdir\b/i.test(source), "ops-context must not write files.");
assert(!/append(HermesLedgerRecord|.*Store)|persist[A-Z]/.test(source), "ops-context must not persist/append.");

const tempDir = mkdtempSync(join(tmpdir(), "phantom-ops-context-"));
const interactionStorePath = join(tempDir, "hermes-interaction-memory.jsonl");
const proposalHistoryPath = join(tempDir, "chicagoshots-proposal-history.jsonl"); // intentionally absent

try {
  // Seed one tenant-scoped interaction memory record.
  const mem = buildHermesInteractionMemoryPreview(
    { tenant_id: "client-chicagoshots", actor_user_id: "owner", task_id: null, interaction_type: "lead_intake", summary: "Prior packet recap." },
    { now: "2026-06-30T10:00:00.000Z" },
  );
  const seeded = await persistHermesInteractionMemoryPreview(mem, { storePath: interactionStorePath });
  assert(seeded.persisted, "seed memory should persist");
  const storeBytesBefore = statSync(interactionStorePath).size;

  // 1) Admin/operator context: full, with business + provider/tool-lane internals.
  const admin = await buildOpsDashboardContext({
    isAdmin: true,
    tenantId: "client-chicagoshots",
    actorUserId: "owner",
    module: "leads",
    interactionStorePath,
    proposalHistoryPath,
    now: "2026-06-30T10:05:00.000Z",
  });
  assert(admin.role === "admin", "admin role");
  assert(admin.admin_internals_included === true, "admin internals included");
  assert(admin.redacted_for_role === false, "admin not redacted");
  assert(admin.current_module === "leads", "module echoed");
  assert(admin.assistant.embedded === true && admin.assistant.separate_app === false, "assistant embedded, not separate app");
  assert(admin.available_actions.length === EMBEDDED_OPS_ACTIONS.length && admin.available_actions.length === 5, "5 embedded actions");
  assert(admin.chicagoshots !== null, "admin gets chicagoshots context");
  assert(admin.memory !== null && admin.memory!.has_memory === true && admin.memory!.recalled_count >= 1, "admin gets tenant memory");
  assert(admin.provider !== null, "admin gets provider status");
  assert(admin.tool_lane !== null, "admin gets tool-lane status");
  // Provider/GLM stays gated/off by default in tests (no live call).
  assert(admin.provider!.glm_live_call_ready === false, "glm not live by default");
  assert(admin.tool_lane!.n8n_running === false, "n8n not running in test");

  // Safety state: every execution/external flag is false (read_only is the only
  // allowed true); execute endpoint absent.
  const s = admin.safety_state;
  for (const [k, v] of Object.entries(s)) {
    if (k === "read_only") continue;
    if (typeof v === "boolean") assert(v === false, `safety flag ${k} must be false`);
  }
  assert(s.read_only === true, "read_only must be true");
  assert(s.approvals_execute_endpoint === "absent", "approvals execute endpoint absent");

  // 2) Standard/client context: embedded shell only, no business/provider/debug data.
  const client = await buildOpsDashboardContext({
    isAdmin: false,
    tenantId: "client-chicagoshots",
    actorUserId: "client-user",
    module: "leads",
    interactionStorePath,
    proposalHistoryPath,
  });
  assert(client.role === "standard", "standard role");
  assert(client.redacted_for_role === true, "standard redacted");
  assert(client.chicagoshots === null, "standard no business records");
  assert(client.memory === null, "standard no memory internals");
  assert(client.provider === null, "standard no provider internals");
  assert(client.tool_lane === null, "standard no tool-lane internals");
  // ...but the embedded assistant shell is still present.
  assert(client.assistant.embedded === true, "standard still gets embedded assistant");
  assert(client.available_actions.length === 5, "standard still gets action descriptors");
  assert(client.safety_state.approvals_execute_endpoint === "absent", "standard safety state present");

  // 3) Read-only: building contexts wrote nothing.
  assert(!existsSync(proposalHistoryPath), "absent proposal history must not be created");
  assert(statSync(interactionStorePath).size === storeBytesBefore, "interaction store must be unchanged (read-only)");

  console.log(
    JSON.stringify(
      {
        ok: true,
        adminRole: admin.role,
        adminSections: { chicagoshots: admin.chicagoshots !== null, memory: admin.memory !== null, provider: admin.provider !== null, tool_lane: admin.tool_lane !== null },
        adminMemoryRecalled: admin.memory!.recalled_count,
        clientRedacted: client.redacted_for_role,
        clientSectionsNull: client.chicagoshots === null && client.memory === null && client.provider === null && client.tool_lane === null,
        actions: admin.available_actions.length,
        executeEndpoint: s.approvals_execute_endpoint,
        storeWritten: statSync(interactionStorePath).size !== storeBytesBefore,
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
